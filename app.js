/* Resource Menu — shared app logic.
 *
 * Runs in two modes with no changes:
 *   hosted     -> fetches the published Google Sheet CSV at runtime (GitHub Pages, local server) [active]
 *   standalone -> reads window.__RESOURCES__ injected by legacy-offline-build/build.py [legacy, unused]
 */
(function () {
  "use strict";

  // Published Google Sheets CSV export — the team edits resources directly
  // in the Sheet, and the hosted site re-fetches this on every page load.
  // Google's publish endpoint sends Access-Control-Allow-Origin: * and
  // Cache-Control: private, max-age=300 (~5 min edge cache), confirmed via
  // curl; a stale local copy at legacy-offline-build/resources.csv remains
  // only as input to the unused legacy/build.py standalone build.
  var CSV_PATH =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFj-hZ-z0t1PGu6iK7VR4rOKfDsFtRiJuoWnoje-tiZ21fF7eC10hmPlTXt8PpsvGDypkh9Fi60qQh/pub?output=csv";

  /* ---------------- CSV parsing ---------------- */

  // Full RFC-4180-ish parser: quoted fields, embedded commas/newlines,
  // "" escapes, CRLF or LF, ragged rows, stray blank lines.
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;

    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

    function endField() {
      row.push(field);
      field = "";
    }
    function endRow() {
      endField();
      rows.push(row);
      row = [];
    }

    while (i < text.length) {
      var ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }

      if (ch === '"') {
        // Only treat as an opening quote at the start of a field; a stray
        // quote mid-field is kept literally rather than throwing.
        if (field === "") {
          inQuotes = true;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      if (ch === ",") {
        endField();
        i++;
        continue;
      }
      if (ch === "\r") {
        if (text[i + 1] === "\n") i++;
        endRow();
        i++;
        continue;
      }
      if (ch === "\n") {
        endRow();
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    if (field !== "" || row.length) endRow();

    // Drop rows that are entirely empty.
    return rows.filter(function (r) {
      return r.some(function (c) {
        return String(c).trim() !== "";
      });
    });
  }

  function rowsToRecords(rows) {
    if (!rows.length) return [];
    var header = rows[0].map(function (h) {
      return String(h).trim();
    });
    var idx = {};
    header.forEach(function (h, i) {
      if (!(h in idx)) idx[h] = i;
    });

    function pick(row, name) {
      var i = idx[name];
      if (i === undefined || i >= row.length) return "";
      return String(row[i] == null ? "" : row[i]).trim();
    }

    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var rec = {
        resource: pick(row, "Resource"),
        creator: pick(row, "Creator"),
        type: pick(row, "Type"),
        subtype: pick(row, "Subtype"),
        description: pick(row, "Description"),
        stem: pick(row, "STEM Yes/No"),
        link: pick(row, "Link"),
      };
      if (!rec.resource && !rec.link) continue; // nothing renderable
      if (!rec.resource) rec.resource = "(untitled resource)";
      out.push(rec);
    }
    return out;
  }

  /* ---------------- helpers ---------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function reEsc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function norm(s) {
    return String(s || "").toLowerCase();
  }

  // Escape text, wrapping every occurrence of any search term in <mark>.
  function highlight(text, terms) {
    var t = String(text == null ? "" : text);
    if (!terms.length) return esc(t);
    var rx = new RegExp("(" + terms.map(reEsc).join("|") + ")", "gi");
    var out = "";
    var last = 0;
    var m;
    while ((m = rx.exec(t)) !== null) {
      if (m[0].length === 0) {
        rx.lastIndex++;
        continue;
      }
      if (m.index > last) out += esc(t.slice(last, m.index));
      out += "<mark>" + esc(m[0]) + "</mark>";
      last = m.index + m[0].length;
    }
    return out + esc(t.slice(last));
  }

  function safeUrl(u) {
    var s = String(u || "").trim();
    if (!s) return "";
    // Allow only http(s)/mailto; anything else (javascript:, data:) is dropped.
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    if (/^www\./i.test(s)) return "https://" + s;
    return "";
  }

  // Deterministic, well-spaced hues so each Type keeps its colour across rebuilds.
  var HUES = [210, 145, 28, 340, 265, 190, 95, 12, 300, 45, 170, 240, 320, 70, 355, 225];

  /* ---------------- state ---------------- */

  var ALL = [];
  var typeHue = {};

  // "Start Here" pathways: curated shortcuts into the same Type/Subtype
  // filters the pills use, aimed at first-time visitors with no policy
  // background. matchMode "any" is only needed when a pathway mixes a Type
  // and a Subtype that don't co-occur on the same rows (so AND would yield
  // zero results) — see "new-to-advocacy" below.
  var PATHWAYS = [
    {
      id: "new-to-advocacy",
      types: ["Educational information"],
      subs: ["Community based engagement"],
      matchMode: "any",
    },
    {
      id: "contact-policymaker",
      types: [],
      subs: ["Policy Maker Outreach and/or comment writing"],
      matchMode: "all",
    },
    {
      id: "guides",
      types: ["Guide"],
      subs: [],
      matchMode: "all",
    },
    {
      id: "organizations",
      types: ["Network", "Advocacy", "Civic Engagement"],
      subs: [],
      matchMode: "all",
    },
  ];

  // "Only have 5 minutes?" hint next to search: a fixed shortcut to one
  // specific, short resource ("Federal Register" — note the sheet's
  // Resource cell is actually misspelled "Federal Reister"). Matched on
  // Creator/Type/Subtype rather than the resource name so that typo can't
  // break the lookup; this combination is unique in the live data (see
  // start() below), which resolves the link from the sheet at runtime
  // rather than duplicating it here — if the row is ever removed or
  // renamed, the hint just stays hidden instead of pointing at stale data.
  var QUICK_READ = {
    creator: "United States Government",
    type: "Letter writing",
    subtype: "Letter writing and signing petitions",
  };

  function findPathway(id) {
    for (var i = 0; i < PATHWAYS.length; i++) {
      if (PATHWAYS[i].id === id) return PATHWAYS[i];
    }
    return null;
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    var s = Object.create(null);
    a.forEach(function (v) {
      s[v] = true;
    });
    return b.every(function (v) {
      return s[v];
    });
  }

  function pathwayActive(p) {
    return (
      sameSet(p.types, state.types) &&
      sameSet(p.subs, state.subs) &&
      sameSet(p.orgs || [], state.orgs) &&
      (p.matchMode || "all") === state.matchMode
    );
  }

  var state = {
    q: "",
    terms: [],
    types: [], // selected Type values (OR within group)
    subs: [],  // selected Subtype values (OR within group)
    orgs: [],  // selected Organization (Creator) values (OR within group)
    matchMode: "any", // "all" (every active facet must match) or "any" (at least one does) — "any" is the default
  };

  var el = {};
  var toastTimer = null;

  // Set by "Random resource" to narrow the grid to that single pick; null
  // means show the normal filtered results. Any actual filter/search
  // change (not the random/back actions themselves) clears this — see
  // exitRandomPick, used by setSearch, applyFilterClick, and the
  // match-mode/crumb handlers below — so a stale single-card view never
  // survives a real state change.
  var randomPick = null;

  // Bumped by exitRandomPick() so pickRandom()'s in-flight flicker chain
  // (a run of setTimeout ticks — see wire()) can tell it's been superseded
  // and stop, instead of clobbering whatever the interrupting action just
  // rendered a moment later.
  var rollId = 0;

  function exitRandomPick() {
    randomPick = null;
    rollId++;
  }

  // Resolved once data loads (see start()) — the safe, validated link for
  // QUICK_READ, or "" if that resource can't be found in the live sheet.
  var quickReadUrl = "";

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------------- filtering ---------------- */

  function matchesSearch(r) {
    if (!state.terms.length) return true;
    var hay = norm(r.resource + "\n" + r.creator + "\n" + r.description);
    return state.terms.every(function (t) {
      return hay.indexOf(t) !== -1;
    });
  }

  // Type/Subtype/Organization are the three facets a resource is filtered
  // on. matchMode governs how the three combine; within a single facet,
  // multiple selected values are always OR'd together (see `passes`
  // below) regardless of matchMode.
  var FACETS = [
    { field: "type", list: "types" },
    { field: "subtype", list: "subs" },
    { field: "creator", list: "orgs" },
  ];

  function passes(r) {
    if (!matchesSearch(r)) return false;

    var active = [];
    for (var i = 0; i < FACETS.length; i++) {
      var f = FACETS[i];
      var values = state[f.list];
      if (!values.length) continue;
      active.push(values.indexOf(r[f.field]) !== -1);
    }

    if (!active.length) return true;
    if (state.matchMode === "any") {
      return active.indexOf(true) !== -1;
    }
    return active.indexOf(false) === -1;
  }

  function hasActiveFilters() {
    return !!(
      state.q.trim() ||
      state.types.length ||
      state.subs.length ||
      state.orgs.length
    );
  }

  function clearAll() {
    state.types.length = 0;
    state.subs.length = 0;
    state.orgs.length = 0;
    state.matchMode = "any";
    setSearch("");
    el.search.value = "";
  }

  function currentResults() {
    return ALL.filter(passes);
  }

  // For every distinct value in `field`, the live count shown on its
  // tag. Two cases, depending on whether *this facet* already has an
  // active selection:
  //
  // - Facet already active (e.g. another Type is picked, and this is a
  //   Type count): simulate adding the candidate to that selection —
  //   never replacing what's there — and recompute the full result
  //   count under the current matchMode. This is what lets a Type tag's
  //   count answer "how many results if I picked this one too," live,
  //   for tags in the *same* facet as each other (Type reacting to
  //   other Types, not just to Subtype/Organization).
  //
  // - Facet not yet active (e.g. no Organization is picked, and Type is
  //   what's currently narrowing things down): just intersect the
  //   *current* result set with the candidate value, rather than
  //   simulating and recombining via matchMode. In Match all these give
  //   the same number either way — but in Match any, simulating would
  //   OR the brand-new facet in, so every not-yet-active Organization
  //   would show roughly "current count + that org's own total"
  //   regardless of how relevant it actually is to what's already
  //   showing, which is what made Organization counts look disconnected
  //   from an active Type filter. Intersecting instead answers "of what
  //   I'm already seeing, how many are also this" — informative in both
  //   modes, and there's nothing yet active in this facet for matchMode
  //   to combine any other way regardless.
  //
  // A value already selected needs neither simulation: it's already
  // included, so its count is just the current, unmodified result
  // count. Both `current` and the per-value work below run against a
  // stable snapshot captured up front, before any temporary
  // state.types/subs/orgs mutation happens later in the same pass.
  function countIncluding(listKey, field) {
    var counts = Object.create(null);
    var original = state[listKey];
    var alreadyOn = Object.create(null);
    original.forEach(function (v) {
      alreadyOn[v] = true;
    });
    var current = currentResults();
    var facetActive = original.length > 0;

    ALL.forEach(function (r) {
      var v = r[field];
      if (!v || counts[v] !== undefined) return;
      if (alreadyOn[v]) {
        counts[v] = current.length;
        return;
      }
      if (!facetActive) {
        counts[v] = current.filter(function (rr) {
          return rr[field] === v;
        }).length;
        return;
      }
      state[listKey] = original.concat([v]);
      counts[v] = currentResults().length;
      state[listKey] = original;
    });

    return counts;
  }

  /* ---------------- rendering ---------------- */

  var ICON = {
    search:
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    person:
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    copy:
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check:
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    empty:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8.5 11h5"/></svg>',
    dice:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor"/></svg>',
    clock:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    compass:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
    close:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  };

  function pillHTML(value, count, active, kind) {
    var isEmpty = count === 0;
    // On mobile, a 0-count tag is otherwise hidden entirely (see
    // .pill.is-empty.pill-may-hide in styles.css) rather than just grayed
    // out, to keep the wall shorter to scroll. But in Match all, a
    // Subtype/Organization tag routinely hits 0 simply because it
    // doesn't overlap with whatever Type/Org is currently selected —
    // hiding it would erase the only visible cue that the combination is
    // unsatisfiable, leaving "Clear filters" as the only way back rather
    // than picking a different value. Match any doesn't have that
    // problem: adding filters there only ever adds matches, never
    // removes them, so a 0-count tag genuinely has zero matches across
    // the *entire* dataset — hiding stays the right default there, and
    // for Type in either mode (narrowing into a Type is the primary,
    // broader move, so its own 0-count case isn't given the same
    // "always visible" treatment as the finer-grained facets).
    var mayHide = isEmpty && (kind === "type" || state.matchMode === "any");
    // Purely a visual emphasis, not a hide/count change (see mayHide
    // above for that): in Match any, once at least one Type is active,
    // the *un*selected Type pills get muted so the active one(s) read as
    // the current selection at a glance instead of blending into a wall
    // of equally-bold color. Only kicks in for Match any — active is
    // meaningful there without narrowing anything else out (Match any
    // just adds matches), whereas in Match all every active Type is
    // already the sole determinant of which Types even have results, so
    // there's no "which one did I pick" ambiguity to resolve. Never
    // applies to the active pill(s) themselves, and never touches
    // clickability — still a plain opacity/saturation style on an
    // otherwise fully interactive button.
    var typeMuted =
      kind === "type" &&
      !active &&
      state.matchMode === "any" &&
      state.types.length > 0;
    var hue = kind === "type" ? typeHue[value] : null;
    var style = hue != null ? ' style="--type-h:' + hue + '"' : "";
    return (
      '<button class="pill' +
        (isEmpty ? " is-empty" : "") +
        (mayHide ? " pill-may-hide" : "") +
        (typeMuted ? " pill-type-muted" : "") +
        '"' +
      ' type="button"' +
      ' aria-pressed="' + (active ? "true" : "false") + '"' +
      ' data-filter="' + kind + '"' +
      ' data-value="' + esc(value) + '"' +
      ' data-tagkey="' + kind + ":" + esc(value) + '"' +
      style +
      ">" +
      (kind === "type" ? '<span class="dot"></span>' : "") +
      "<span>" + esc(value) + "</span>" +
      '<span class="n">' + count + "</span>" +
      "</button>"
    );
  }

  // Trailing "+N more" pill appended to a preview row whenever it's
  // hiding real values — styled like the other pills (via the shared
  // .pill class) so it reads as part of the same row, but it isn't a
  // filter itself: clicking it just opens "Browse filters" (see the
  // el.filterBar delegated click handler below), same as the button.
  function moreTagHTML(hiddenCount, label) {
    if (hiddenCount <= 0) return "";
    return (
      '<button class="pill pill-more" type="button" data-more-toggle="true"' +
      ' aria-label="Show ' + hiddenCount + " more " + esc(label) +
      " option" + (hiddenCount === 1 ? "" : "s") + '">' +
      "+" + hiddenCount + " more" +
      "</button>"
    );
  }

  // Default-visible pill preview: the top N by count, plus whatever's
  // already active (even if it'd otherwise fall outside the top N) — so an
  // active filter never silently drops out of view when the full wall is
  // collapsed. `sorted` is filtered rather than resliced so the preview
  // keeps the same count-based order as the full list.
  //
  // TRYING: counts sized to roughly fill a single row at a typical desktop
  // width instead of ~3 rows, paired with a matching CSS max-height clamp
  // on .filters-preview .pills as a backstop against spilling into a
  // partial second row. This is an approximation, not an exact fit — it
  // depends on viewport width and label lengths, and doesn't (yet) measure
  // actual layout to size the "+N more" count precisely. Subtype and
  // Organization get lower counts than Type because their labels run
  // longer (e.g. "Policy Maker Outreach and/or comment writing"), so fewer
  // fit per row.
  var PREVIEW_TYPE_COUNT = 6;
  var PREVIEW_SUB_COUNT = 4;
  var PREVIEW_ORG_COUNT = 3;

  // Corrects the guess above against the real, laid-out DOM: walks the
  // preview row that was just rendered and drops real pills from the end
  // (skipping any that are an active filter — those stay put even if it
  // means tolerating a wrap, same rule as previewSubset above) until the
  // trailing "+N more" pill actually lands within the allowed row budget
  // instead of being wrapped past it and clipped out of view by the
  // .filters-preview .pills max-height rule in styles.css. This is what
  // makes "+N more" show up reliably on mobile — a narrower viewport plus
  // bigger touch-target pill padding means the desktop-tuned counts above
  // often don't fit — without having to hardcode a second set of guessed
  // mobile counts (which would still break for the small number of
  // Subtype/Organization values, e.g. "Policy Maker Outreach and/or
  // comment writing", whose labels alone can approach a phone's full
  // width). Desktop stays visually unchanged: the guessed counts already
  // fit within its 1-row budget today, so this pass has nothing to trim.
  //
  // Mobile gets a 2-row budget (matching the taller max-height in that
  // media query in styles.css), not 1: a single long top-ranked label —
  // "Policy Maker Outreach and/or comment writing" is a real Subtype
  // value — can already fill an entire narrow-phone row by itself, and
  // capping at 1 row there meant Subtype/Organization often collapsed to
  // zero visible pills (just "+N more" alone) while Type, whose top
  // labels happen to be shorter, still showed one — an inconsistent
  // preview across the three categories for no reason a visitor could
  // see. A second row gives every category "however many top pills
  // actually fit in 1-2 lines" instead of hard-capping at 1.
  function fitPreviewRow(container, totalCount, label, isActiveFn) {
    var maxRows =
      window.matchMedia && window.matchMedia("(max-width: 720px)").matches ? 2 : 1;

    var pills = Array.prototype.slice
      .call(container.querySelectorAll(".pill:not(.pill-more)"))
      .filter(function (p) {
        return p.offsetParent !== null; // skip CSS-hidden (zero-count) pills
      });
    if (!pills.length) return;

    var hidden = totalCount - pills.length;
    var moreEl = container.querySelector(".pill-more");

    // The offsetTop where row (maxRows + 1) begins — anything at or past
    // it has spilled outside the allowed budget. Rows are a uniform
    // height (.pills doesn't override flexbox's default align-items:
    // stretch), so every pill sharing a visual row reports the same
    // offsetTop; the (maxRows + 1)-th distinct value marks the cutoff.
    // Recomputed after each removal since the remaining pills can reflow
    // to fill the freed slot, shifting later rows up.
    function cutoffTop() {
      var rows = [];
      for (var i = 0; i < pills.length; i++) {
        if (rows.indexOf(pills[i].offsetTop) === -1) rows.push(pills[i].offsetTop);
      }
      if (moreEl && rows.indexOf(moreEl.offsetTop) === -1) rows.push(moreEl.offsetTop);
      rows.sort(function (a, b) {
        return a - b;
      });
      return rows.length > maxRows ? rows[maxRows] : Infinity;
    }

    function tailOffsetTop() {
      return moreEl ? moreEl.offsetTop : pills[pills.length - 1].offsetTop;
    }

    function dropOneRealPill() {
      var idx = pills.length - 1;
      while (idx >= 0 && isActiveFn(pills[idx].getAttribute("data-value"))) idx--;
      if (idx < 0) return false;
      pills[idx].parentNode.removeChild(pills[idx]);
      pills.splice(idx, 1);
      hidden++;
      return true;
    }

    while (pills.length && tailOffsetTop() >= cutoffTop()) {
      if (!dropOneRealPill()) break;
    }

    if (hidden <= 0) {
      if (moreEl) moreEl.parentNode.removeChild(moreEl);
      return;
    }

    // Re-render "+N more" with the corrected count, then re-check: its
    // width can shift slightly (e.g. "+3 more" -> "+14 more"), rarely
    // enough to itself tip past the row budget.
    var guard = pills.length + 1;
    while (guard-- > 0) {
      if (moreEl) moreEl.parentNode.removeChild(moreEl);
      container.insertAdjacentHTML("beforeend", moreTagHTML(hidden, label));
      moreEl = container.querySelector(".pill-more");
      if (!moreEl || moreEl.offsetTop < cutoffTop()) break;
      if (!dropOneRealPill()) break;
    }
  }

  function previewSubset(sorted, active, count) {
    var keep = Object.create(null);
    sorted.slice(0, count).forEach(function (v) {
      keep[v] = true;
    });
    active.forEach(function (v) {
      keep[v] = true;
    });
    return sorted.filter(function (v) {
      return keep[v];
    });
  }

  // Selected values sort first (in click order doesn't matter — just
  // "selected" as a group, then alphabetical within it isn't needed
  // since there's rarely more than a couple), then everything else by
  // live count desc, alpha tiebreak — same ordering rule reused for
  // Type, Subtype, and Organization below.
  function bySelectionThenCount(counts, activeList) {
    return function (a, b) {
      var aActive = activeList.indexOf(a) !== -1;
      var bActive = activeList.indexOf(b) !== -1;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b);
    };
  }

  // "+N more" (and the preview row feeding it) only counts values worth
  // clicking — non-zero live count, or already active (an active value
  // stays visible even at 0, matching previewSubset's "active never
  // drops out" rule below, since it's the user's own current pick, not
  // a suggestion). The full wall further down (Browse filters) isn't
  // filtered this way — it still lists every value, 0-count ones grayed
  // out via .is-empty, since that "show me everything, including dead
  // ends" is exactly what expanding it is for.
  function relevantValues(values, counts, activeList) {
    return values.filter(function (v) {
      return (counts[v] || 0) > 0 || activeList.indexOf(v) !== -1;
    });
  }

  function renderFilters() {
    var typeCounts = countIncluding("types", "type");
    var subCounts = countIncluding("subs", "subtype");
    var orgCounts = countIncluding("orgs", "creator");

    var types = Object.keys(typeHue).sort(bySelectionThenCount(typeCounts, state.types));

    el.typePills.innerHTML = types
      .map(function (t) {
        return pillHTML(t, typeCounts[t] || 0, state.types.indexOf(t) !== -1, "type");
      })
      .join("");

    var typesForPreview = relevantValues(types, typeCounts, state.types);
    var typePreview = previewSubset(typesForPreview, state.types, PREVIEW_TYPE_COUNT);
    el.typePillsPreview.innerHTML =
      typePreview
        .map(function (t) {
          return pillHTML(t, typeCounts[t] || 0, state.types.indexOf(t) !== -1, "type");
        })
        .join("") + moreTagHTML(typesForPreview.length - typePreview.length, "Type");
    fitPreviewRow(el.typePillsPreview, typesForPreview.length, "Type", function (v) {
      return state.types.indexOf(v) !== -1;
    });

    // Subtype only makes sense once a Type has narrowed things down —
    // with none selected, "every Subtype in the whole dataset" is a
    // wall with little relation to what's actually being browsed, so
    // the section stays hidden entirely rather than showing it empty
    // or full. Once at least one Type is active, only Subtypes that
    // literally co-occur with one of the selected Type(s) *somewhere*
    // in the raw data are shown — a structural fact independent of
    // Match mode, search, or Organization, unlike subCounts (which
    // *does* respect all of those, and still drives the number on each
    // surviving tag). Some Types (e.g. "Data governance/ preservation")
    // have no Subtype values recorded at all — for those the section
    // must stay hidden too, not just render as an empty labeled box, so
    // the gate checks the resulting list's length rather than only
    // whether a Type is active.
    var subs = [];
    if (state.types.length > 0) {
      var subsForActiveTypes = Object.create(null);
      ALL.forEach(function (r) {
        if (r.subtype && state.types.indexOf(r.type) !== -1) {
          subsForActiveTypes[r.subtype] = true;
        }
      });
      subs = Object.keys(subsForActiveTypes).sort(
        bySelectionThenCount(subCounts, state.subs)
      );
    }
    el.subFgroup.hidden = subs.length === 0;
    el.subFgroupPreview.hidden = subs.length === 0;

    el.subPills.innerHTML = subs
      .map(function (s) {
        return pillHTML(s, subCounts[s] || 0, state.subs.indexOf(s) !== -1, "sub");
      })
      .join("");

    var subsForPreview = relevantValues(subs, subCounts, state.subs);
    var subPreview = previewSubset(subsForPreview, state.subs, PREVIEW_SUB_COUNT);
    el.subPillsPreview.innerHTML =
      subPreview
        .map(function (s) {
          return pillHTML(s, subCounts[s] || 0, state.subs.indexOf(s) !== -1, "sub");
        })
        .join("") + moreTagHTML(subsForPreview.length - subPreview.length, "Subtype");
    fitPreviewRow(el.subPillsPreview, subsForPreview.length, "Subtype", function (v) {
      return state.subs.indexOf(v) !== -1;
    });

    // "Organization" in the UI is the Creator column underneath — same
    // sort, preview, zero-count, and Match all/any pattern as Type and
    // Subtype (though it has no Type-style gating of its own).
    var allOrgs = {};
    ALL.forEach(function (r) {
      if (r.creator) allOrgs[r.creator] = true;
    });
    var orgs = Object.keys(allOrgs).sort(bySelectionThenCount(orgCounts, state.orgs));
    el.orgPills.innerHTML = orgs
      .map(function (o) {
        return pillHTML(o, orgCounts[o] || 0, state.orgs.indexOf(o) !== -1, "org");
      })
      .join("");

    var orgsForPreview = relevantValues(orgs, orgCounts, state.orgs);
    var orgPreview = previewSubset(orgsForPreview, state.orgs, PREVIEW_ORG_COUNT);
    el.orgPillsPreview.innerHTML =
      orgPreview
        .map(function (o) {
          return pillHTML(o, orgCounts[o] || 0, state.orgs.indexOf(o) !== -1, "org");
        })
        .join("") + moreTagHTML(orgsForPreview.length - orgPreview.length, "Organization");
    fitPreviewRow(el.orgPillsPreview, orgsForPreview.length, "Organization", function (v) {
      return state.orgs.indexOf(v) !== -1;
    });
  }

  function renderStartHere() {
    var cards = el.startHere.querySelectorAll(".start-card");
    for (var i = 0; i < cards.length; i++) {
      var pathway = findPathway(cards[i].getAttribute("data-pathway"));
      cards[i].setAttribute(
        "aria-pressed",
        pathway && pathwayActive(pathway) ? "true" : "false"
      );
    }
  }

  function renderCrumbs() {
    var parts = [];
    if (state.q.trim()) {
      parts.push(crumb("search", "Search", state.q.trim()));
    }
    state.types.forEach(function (v) {
      parts.push(crumb("type", "Type", v));
    });
    state.subs.forEach(function (v) {
      parts.push(crumb("sub", "Subtype", v));
    });
    state.orgs.forEach(function (v) {
      parts.push(crumb("org", "Organization", v));
    });
    el.crumbs.innerHTML = parts.join("");
  }

  function crumb(kind, label, value) {
    return (
      '<button class="crumb" type="button" data-crumb="' + kind + '"' +
      ' data-value="' + esc(value) + '"' +
      ' aria-label="Remove filter ' + esc(label) + ": " + esc(value) + '">' +
      '<span class="k">' + esc(label) + ":</span> " +
      "<span>" + esc(value) + "</span>" +
      '<span class="x" aria-hidden="true">×</span>' +
      "</button>"
    );
  }

  function cardHTML(r, i) {
    var terms = state.terms;
    var hue = typeHue[r.type] != null ? typeHue[r.type] : 220;
    var url = safeUrl(r.link);
    var delay = Math.min(i, 18) * 22;

    var tags = "";
    if (r.type) {
      tags +=
        '<button class="tag type" type="button" data-filter="type"' +
        ' data-value="' + esc(r.type) + '" data-tagkey="type:' + esc(r.type) + '"' +
        ' aria-pressed="' + (state.types.indexOf(r.type) !== -1 ? "true" : "false") + '"' +
        ' title="Filter by ' + esc(r.type) + '">' + esc(r.type) + "</button>";
    }
    if (r.subtype) {
      tags +=
        '<button class="tag sub" type="button" data-filter="sub"' +
        ' data-value="' + esc(r.subtype) + '" data-tagkey="sub:' + esc(r.subtype) + '"' +
        ' aria-pressed="' + (state.subs.indexOf(r.subtype) !== -1 ? "true" : "false") + '"' +
        ' title="Filter by ' + esc(r.subtype) + '">' + esc(r.subtype) + "</button>";
    }

    var meta = "";
    if (r.creator) {
      meta +=
        '<span class="meta-item">' + ICON.person +
        '<span class="v">' + highlight(r.creator, terms) + "</span></span>";
    }

    var title = url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
        highlight(r.resource, terms) + "</a>"
      : highlight(r.resource, terms);

    return (
      '<article class="card" style="--type-h:' + hue + ";--d:" + delay + 'ms"' +
      ' data-type="' + esc(r.type) + '" data-sub="' + esc(r.subtype) + '"' +
      ' data-org="' + esc(r.creator) + '"' +
      (url ? ' data-url="' + esc(url) + '" tabindex="0"' : "") +
      ">" +
      '<div class="card-head"><h3>' + title + "</h3>" +
      (url
        ? '<button class="copy" type="button" data-copy="' + esc(url) +
          '" title="Copy link" aria-label="Copy link to ' + esc(r.resource) + '">' +
          ICON.copy + "</button>"
        : "") +
      "</div>" +
      (tags ? '<div class="tagrow">' + tags + "</div>" : "") +
      '<p class="desc">' + highlight(r.description || "No description provided.", terms) + "</p>" +
      (meta ? '<div class="meta"><div><div class="meta-inner">' + meta + "</div></div></div>" : "") +
      "</article>"
    );
  }

  function render() {
    el.matchAllBtn.setAttribute("aria-pressed", state.matchMode === "all" ? "true" : "false");
    el.matchAnyBtn.setAttribute("aria-pressed", state.matchMode === "any" ? "true" : "false");

    renderFilters();
    renderStartHere();
    renderCrumbs();

    var filtered = currentResults();
    var results = randomPick ? [randomPick] : filtered;

    if (randomPick) {
      var scope = hasActiveFilters()
        ? filtered.length + " filtered"
        : "all " + ALL.length;
      var noun = filtered.length === 1 ? " resource" : " resources";
      el.count.innerHTML = "<strong>Random pick</strong> from " + scope + noun;
    } else {
      el.count.innerHTML =
        "<strong>" + filtered.length + "</strong> of " + ALL.length + " resources";
    }
    el.backToAll.hidden = !randomPick;
    el.anotherRandom.hidden = !randomPick;
    // Re-roll needs at least one match in the filtered set, regardless of
    // whether we're currently narrowed to a single random pick.
    el.random.disabled = filtered.length === 0;
    // While viewing a random pick, Clear filters exits that view even if
    // there's otherwise nothing to clear (see its handler below) — so it
    // must stay enabled in that case too, not just when a real filter is
    // active.
    el.clearFilters.disabled = !hasActiveFilters() && !randomPick;

    // Show how many pill filters are active, since they're collapsed on mobile
    var activePills = state.types.length + state.subs.length + state.orgs.length;
    el.filterBadge.textContent = activePills ? String(activePills) : "";

    if (!results.length) {
      el.grid.className = "";
      el.grid.innerHTML =
        '<div class="state">' +
        '<div class="icon">' + ICON.empty + "</div>" +
        "<h2>No resources match</h2>" +
        "<p>Try removing a filter or searching for something broader" +
        (state.q.trim() ? " than “" + esc(state.q.trim()) + "”" : "") +
        ".</p>" +
        '<button class="btn" type="button" data-crumb="all">Clear all filters</button>' +
        "</div>";
      return;
    }

    el.grid.className = "grid";
    el.grid.setAttribute("aria-busy", "false");
    el.grid.innerHTML = results
      .map(function (r, i) {
        return cardHTML(r, i);
      })
      .join("");
  }

  /* ---------------- interactions ---------------- */

  function toggleIn(list, value) {
    var i = list.indexOf(value);
    if (i === -1) list.push(value);
    else list.splice(i, 1);
  }

  function setSearch(v) {
    state.q = v;
    state.terms = norm(v).split(/\s+/).filter(Boolean);
    el.searchbox.classList.toggle("has-value", v.length > 0);
    exitRandomPick();
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove("show");
    }, 1900);
  }

  function copyText(text, btn) {
    function ok() {
      if (btn) {
        btn.classList.add("copied");
        btn.innerHTML = ICON.check;
        setTimeout(function () {
          btn.classList.remove("copied");
          btn.innerHTML = ICON.copy;
        }, 1400);
      }
      toast("Link copied");
    }
    // Clipboard API needs a secure context; fall back for file:// use.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () {
        legacyCopy(text) ? ok() : toast("Couldn't copy — press ⌘C");
      });
      return;
    }
    legacyCopy(text) ? ok() : toast("Couldn't copy — press ⌘C");
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      var okc = document.execCommand("copy");
      document.body.removeChild(ta);
      return okc;
    } catch (e) {
      return false;
    }
  }

  function applyFilterClick(kind, value) {
    if (kind === "type") toggleIn(state.types, value);
    else if (kind === "sub") toggleIn(state.subs, value);
    else if (kind === "org") toggleIn(state.orgs, value);
    exitRandomPick();
    render();
  }

  function clearTagHighlight() {
    el.grid.classList.remove("dimming");
    var marked = el.grid.querySelectorAll(".card.tag-match");
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove("tag-match");
  }

  function applyTagHighlight(tagkey) {
    var sep = tagkey.indexOf(":");
    var kind = tagkey.slice(0, sep);
    var value = tagkey.slice(sep + 1);
    var attr = kind === "type" ? "data-type" : kind === "org" ? "data-org" : "data-sub";
    var cards = el.grid.querySelectorAll(".card");
    var any = false;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute(attr) === value) {
        cards[i].classList.add("tag-match");
        any = true;
      }
    }
    if (any) el.grid.classList.add("dimming");
  }

  function wire() {
    // Search
    el.search.addEventListener("input", function () {
      setSearch(el.search.value);
      render();
    });
    el.clearSearch.addEventListener("click", function () {
      setSearch("");
      el.search.value = "";
      el.search.focus();
      render();
    });

    // "/" focuses search; Escape clears it
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        el.search.focus();
        el.search.select();
      } else if (e.key === "Escape" && e.target === el.search) {
        if (el.search.value) {
          setSearch("");
          el.search.value = "";
          render();
        } else {
          el.search.blur();
        }
      }
    });

    // Start Here disclosure: collapsed on every load, for every visitor —
    // no persistence, so this line is the only way back in once dismissed.
    // hidden is the source of truth; aria-expanded just mirrors it for
    // assistive tech, and the CSS chevron rotation reads that same attribute.
    el.startHereToggle.addEventListener("click", function () {
      var willOpen = el.startHereSection.hidden;
      el.startHereSection.hidden = !willOpen;
      el.startHereToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    // Quick-read disclosure: same collapsed-by-default, hidden-is-the-
    // source-of-truth pattern as Start Here just above.
    el.quickReadToggle.addEventListener("click", function () {
      var willOpen = el.quickReadPanel.hidden;
      el.quickReadPanel.hidden = !willOpen;
      el.quickReadToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    // Organization's mobile-only disclosure: aria-expanded is the whole
    // source of truth here (unlike startHereSection's .hidden above) —
    // the CSS attribute selector in styles.css does the actual
    // showing/hiding, since #filters-org's display is otherwise governed
    // by .filter-bar.filters-open, and toggling .hidden here would just
    // fight that existing rule instead of overriding it. Invisible and
    // inert above 720px (.org-mobile-toggle{display:none}), so this
    // listener is harmless to leave attached at every width.
    el.orgMobileToggle.addEventListener("click", function () {
      var willOpen = el.orgMobileToggle.getAttribute("aria-expanded") !== "true";
      el.orgMobileToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    // Type's mobile-only disclosure works like Organization's above, but
    // Type and Subtype share one #filters-typesub panel (Organization has
    // its own), so a CSS attribute selector alone can't show just Type's
    // half without also exposing Subtype. Inline styles always win over
    // the stylesheet regardless of selector specificity, so setting them
    // here layers safely on top of — never fights — the existing
    // .filter-bar.filters-open rule that still solely governs Subtype.
    var mobileFiltersQuery =
      window.matchMedia && window.matchMedia("(max-width: 720px)");

    function syncTypeSubtypeMobilePanel() {
      if (!mobileFiltersQuery || !mobileFiltersQuery.matches) {
        // Desktop (or matchMedia unsupported): strip any inline styles a
        // prior mobile-width visit left behind, so the stylesheet is the
        // only thing governing this panel again, same as before this
        // feature existed.
        el.filtersTypesub.style.display = "";
        el.typeFgroup.style.display = "";
        el.subFgroup.style.display = "";
        return;
      }
      var browseOpen = el.filterBar.classList.contains("filters-open");
      var typeOpen = el.typeMobileToggle.getAttribute("aria-expanded") === "true";
      el.filtersTypesub.style.display = browseOpen || typeOpen ? "grid" : "";
      el.typeFgroup.style.display = typeOpen ? "grid" : "none";
      // "" (defer to the stylesheet), not an explicit value, whenever
      // Browse filters is closed and Type isn't open either — combined
      // with the panel itself also reverting to "" in that same case,
      // the existing .filters{display:none} rule takes back over, so
      // Subtype (and its own separate zero-subtypes .hidden toggle in
      // renderFilters) ends up exactly as untouched as if this feature
      // didn't exist.
      el.subFgroup.style.display = browseOpen ? "" : "none";
    }

    syncTypeSubtypeMobilePanel();
    if (mobileFiltersQuery) {
      if (mobileFiltersQuery.addEventListener) {
        mobileFiltersQuery.addEventListener("change", syncTypeSubtypeMobilePanel);
      } else if (mobileFiltersQuery.addListener) {
        mobileFiltersQuery.addListener(syncTypeSubtypeMobilePanel); // Safari < 14
      }
    }

    el.typeMobileToggle.addEventListener("click", function () {
      var willOpen = el.typeMobileToggle.getAttribute("aria-expanded") !== "true";
      el.typeMobileToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
      syncTypeSubtypeMobilePanel();
    });

    // "Start Here" pathway cards: pre-apply Type/Subtype filters as a
    // guided shortcut into the same filter system the pills use, replacing
    // whatever filters/search were already active for a clean result.
    el.startHere.addEventListener("click", function (e) {
      var card = e.target.closest(".start-card");
      if (!card) return;
      var pathway = findPathway(card.getAttribute("data-pathway"));
      if (!pathway) return;
      state.types = pathway.types.slice();
      state.subs = pathway.subs.slice();
      state.orgs = (pathway.orgs || []).slice();
      state.matchMode = pathway.matchMode || "all";
      setSearch("");
      el.search.value = "";
      render();
      el.grid.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Clear-filters button (next to the search bar). While viewing a
    // random pick, this exits that view only — same as "Back to all
    // resources" — rather than also clearing search/filters the pick
    // itself doesn't touch; otherwise it's the normal full clear.
    el.clearFilters.addEventListener("click", function () {
      if (randomPick) {
        exitRandomPick();
      } else {
        clearAll();
      }
      render();
      el.search.focus();
    });

    // Filter pills (delegated on the filter bar — the pills' actual
    // container since it moved out of #controls to be a plain, never-
    // sticky sibling; #controls now holds only the compact search row).
    el.filterBar.addEventListener("click", function (e) {
      var more = e.target.closest(".pill-more");
      if (more) {
        el.filterToggle.click();
        return;
      }
      var p = e.target.closest(".pill");
      if (!p) return;
      applyFilterClick(p.getAttribute("data-filter"), p.getAttribute("data-value"));
    });

    // Match-mode toggle: how Type/Subtype/Organization selections combine
    el.matchMode.addEventListener("click", function (e) {
      var b = e.target.closest(".seg-btn");
      if (!b) return;
      var mode = b.getAttribute("data-mode");
      if (mode === state.matchMode) return;
      state.matchMode = mode;
      exitRandomPick();
      render();
    });

    // Match-mode info tooltip: :hover/:focus-visible in CSS already
    // reveal it for mouse and keyboard. Touch has no :hover, so a tap
    // needs to explicitly open *and* close it — toggle a class here, and
    // close it on any click elsewhere.
    el.matchInfo.addEventListener("click", function (e) {
      e.stopPropagation();
      el.matchInfo.classList.toggle("info-open");
    });
    document.addEventListener("click", function () {
      el.matchInfo.classList.remove("info-open");
    });

    // Breadcrumbs (and the empty-state "clear all" button)
    document.addEventListener("click", function (e) {
      var c = e.target.closest("[data-crumb]");
      if (!c) return;
      var kind = c.getAttribute("data-crumb");
      var value = c.getAttribute("data-value");
      exitRandomPick();
      if (kind === "all") {
        clearAll();
      } else if (kind === "search") {
        setSearch("");
        el.search.value = "";
      } else if (kind === "type") {
        toggleIn(state.types, value);
      } else if (kind === "sub") {
        toggleIn(state.subs, value);
      } else if (kind === "org") {
        toggleIn(state.orgs, value);
      }
      render();
    });

    // Card interactions
    el.grid.addEventListener("click", function (e) {
      var copyBtn = e.target.closest(".copy");
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        copyText(copyBtn.getAttribute("data-copy"), copyBtn);
        return;
      }
      var tag = e.target.closest(".tag");
      if (tag) {
        e.preventDefault();
        e.stopPropagation();
        clearTagHighlight();
        applyFilterClick(tag.getAttribute("data-filter"), tag.getAttribute("data-value"));
        return;
      }
      if (e.target.closest("a")) return; // let the title link work normally
      var card = e.target.closest(".card[data-url]");
      if (card) window.open(card.getAttribute("data-url"), "_blank", "noopener");
    });

    el.grid.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var card = e.target.closest(".card[data-url]");
      if (card && e.target === card) window.open(card.getAttribute("data-url"), "_blank", "noopener");
    });

    // Hovering any Type/Subtype tag highlights every card sharing it.
    // Skipped on touch devices: tapping there synthesises a mouseover and would
    // leave the grid dimmed with no way to un-hover.
    var canHover =
      !window.matchMedia || window.matchMedia("(hover: hover)").matches;

    if (canHover) {
      document.addEventListener("mouseover", function (e) {
        var t = e.target.closest("[data-tagkey]");
        if (!t) return;
        clearTagHighlight();
        applyTagHighlight(t.getAttribute("data-tagkey"));
      });
      document.addEventListener("mouseout", function (e) {
        var t = e.target.closest("[data-tagkey]");
        if (!t) return;
        var to = e.relatedTarget;
        if (to && to.closest && to.closest("[data-tagkey]") === t) return;
        clearTagHighlight();
      });
    }

    // Filters disclosure (visible on narrow screens only). .filter-bar is
    // plain in-flow content (never sticky, unlike the compact search bar
    // in #controls), so expanding it to its full, possibly-viewport-
    // exceeding height needs no special-casing here — it just pushes
    // page content down and scrolls normally.
    el.filterToggle.addEventListener("click", function () {
      var open = !el.filterBar.classList.contains("filters-open");
      el.filterBar.classList.toggle("filters-open", open);
      el.filterToggle.setAttribute("aria-expanded", open ? "true" : "false");
      el.filterToggleLabel.textContent = open ? "Hide filters" : "Browse filters";
      // Re-sync Subtype's inline-style-driven visibility (see
      // syncTypeSubtypeMobilePanel above) against this new filters-open
      // state — a no-op on desktop, where that function immediately
      // bails out and clears any inline styles instead.
      syncTypeSubtypeMobilePanel();
    });

    // Random resource: narrows the grid to a single pick drawn from the
    // *currently filtered* results, not always all 65 — so it stays
    // relevant to whatever search/filters are already active rather than
    // potentially handing back something outside the current narrowing.
    // Shared by the main button and "Another random resource" (shown only
    // while a pick is already up), so re-rolling works the same from
    // either place — currentResults() ignores randomPick, so this always
    // draws from the full filtered pool even while narrowed to one card.
    //
    // Before landing on the final pick, it flickers through a handful of
    // quick candidate frames (a plain rapid swap — each is a fresh DOM
    // node from render(), so there's no time for a per-frame transition to
    // play, which is what keeps it feeling like a strobe rather than a
    // series of slow fades). rollId lets an interruption (typing in
    // search, clearing filters, clicking Back to all, etc. — anything that
    // calls exitRandomPick) cancel an in-flight flicker instead of having
    // it clobber whatever that action just rendered a moment later.
    function pickRandom() {
      var results = currentResults();
      if (!results.length) return;

      // A rapid strobe of swapping content is itself a motion/flash
      // concern independent of CSS animation, so it's skipped outright
      // (not just slowed) for prefers-reduced-motion — landing on the
      // final pick immediately, same as before this feature existed.
      var reduced =
        window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      var myRoll = ++rollId;
      var flickers = reduced ? 0 : 5 + Math.floor(Math.random() * 3); // 5-7 frames, ~450-630ms
      var delay = 90;
      var count = 0;

      function tick() {
        if (myRoll !== rollId) return; // superseded — abort this chain
        count++;
        var landing = count > flickers;
        randomPick = results[Math.floor(Math.random() * results.length)];
        render();
        var card = el.grid.children[0];
        if (card) {
          if (landing) {
            void card.offsetWidth; // restart the animation
            card.classList.add("settle-in");
          } else {
            card.classList.add("cycling");
          }
        }
        if (landing) {
          toast("Random pick: " + randomPick.resource);
        } else {
          setTimeout(tick, delay);
        }
      }

      tick();
      el.grid.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    el.random.addEventListener("click", pickRandom);
    el.anotherRandom.addEventListener("click", pickRandom);

    // "Only have 5 minutes?" — opens QUICK_READ the same way clicking a
    // resource card does (see the .card[data-url] handler above), rather
    // than a special-cased navigation of its own.
    el.quickRead.addEventListener("click", function () {
      if (!quickReadUrl) return;
      window.open(quickReadUrl, "_blank", "noopener");
    });

    // Leaves the single-pick view without touching search/filter state.
    el.backToAll.addEventListener("click", function () {
      exitRandomPick();
      render();
    });

    // Sticky-header shadow, plus (mobile only — see the matching
    // max-width:720px media query in styles.css) hiding the compact
    // search bar on scroll-down and revealing it on scroll-up. This class
    // toggle runs unconditionally on every screen size, but only has any
    // visual effect where that media query applies, so "mobile only" is
    // guaranteed by CSS rather than by a JS width check here.
    //
    // Threshold + throttle, deliberately not a per-frame/per-pixel
    // handler: we only look at scroll position on a timer (every
    // SCROLL_CHECK_MS), and only act once the position has moved more
    // than SCROLL_THRESHOLD px since the last time we acted. Small
    // jitter — trackpad micro-movements, momentum-scroll deceleration —
    // never touches the class at all, which is what earlier per-pixel/
    // tiny-delta attempts got wrong and caused visible flicker. A slow
    // steady scroll still accumulates past the threshold and triggers
    // normally; it just takes a couple of checks to get there.
    var SCROLL_CHECK_MS = 120;
    var SCROLL_THRESHOLD = 24;
    var sentinel = el.controls.offsetTop;
    var lastActedY = window.scrollY;
    var scrollCheckTimer = null;

    function checkScroll() {
      scrollCheckTimer = null;
      var y = window.scrollY;
      var stuck = y > sentinel;
      el.controls.classList.toggle("is-stuck", stuck);

      if (!stuck) {
        el.controls.classList.remove("controls-hidden");
        lastActedY = y;
        return;
      }

      var delta = y - lastActedY;
      if (delta > SCROLL_THRESHOLD) {
        el.controls.classList.add("controls-hidden");
        lastActedY = y;
      } else if (delta < -SCROLL_THRESHOLD) {
        el.controls.classList.remove("controls-hidden");
        lastActedY = y;
      }
      // Otherwise: within the threshold, keep accumulating — lastActedY
      // stays put so small back-and-forth movement never fires either.
    }

    window.addEventListener(
      "scroll",
      function () {
        if (scrollCheckTimer) return;
        scrollCheckTimer = setTimeout(checkScroll, SCROLL_CHECK_MS);
      },
      { passive: true }
    );

    // Re-render the filter preview rows on resize — fitPreviewRow (see
    // above) measures actual pixel layout, so any width change (a phone
    // rotating, a desktop window being dragged narrower) can change how
    // many preview pills fit on one line, not just crossing the 720px
    // breakpoint.
    var resizeCheckTimer = null;
    window.addEventListener(
      "resize",
      function () {
        if (resizeCheckTimer) return;
        resizeCheckTimer = setTimeout(function () {
          resizeCheckTimer = null;
          renderFilters();
        }, SCROLL_CHECK_MS);
      },
      { passive: true }
    );
  }

  /* ---------------- boot ---------------- */

  // Deliberately reaches for the DOM directly rather than the cached `el`, so it
  // still works if boot() failed before those lookups happened.
  function showError(msg, detail) {
    var grid = document.getElementById("grid");
    var count = document.getElementById("count");
    if (count) count.textContent = "";
    if (!grid) return;
    grid.className = "";
    grid.setAttribute("aria-busy", "false");
    grid.innerHTML =
      '<div class="error-box"><strong>' + esc(msg) + "</strong>" +
      (detail ? "<p>" + detail + "</p>" : "") +
      "</div>";
  }

  function errText(e) {
    return esc((e && (e.message || e.name)) || String(e));
  }

  // Last resort: never leave the user staring at "Loading…" with no explanation.
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("error", function (ev) {
      var count = document.getElementById("count");
      if (count && count.textContent.indexOf("Loading") !== -1) {
        showError("The app hit an error while starting.", esc(ev.message || "Unknown error"));
      }
    });
  }

  // Feedback popup: shown once, ~60s after page load, unless already
  // dismissed this session (sessionStorage, not localStorage — it comes
  // back on a future visit, not just a future page load in the same
  // one). Entirely self-contained — its own element lookups, wrapped in
  // one outer try/catch — rather than routed through boot()'s strict
  // `el` validation above, so a missing or broken popup element can
  // never take down the core filtering app; it just quietly never
  // shows. Independent of whether resource data ends up loading
  // successfully, so it's called unconditionally from boot(), not from
  // start() (which only runs once data's in hand).
  function setupFeedbackModal() {
    try {
      var STORAGE_KEY = "feedbackModalDismissed";
      // Guarded on its own: some browsers' stricter privacy modes throw
      // on sessionStorage access entirely rather than just returning
      // null, which would otherwise trip the outer catch below and
      // silently cancel the popup before it ever got a chance to
      // schedule its timer. Defaulting to "not dismissed" here means it
      // still shows in that case — it just won't remember being
      // dismissed across reloads, same fallback dismiss() already uses.
      var alreadyDismissed = false;
      try {
        alreadyDismissed = !!sessionStorage.getItem(STORAGE_KEY);
      } catch (e) {
        /* storage blocked/unavailable */
      }
      if (alreadyDismissed) return;

      var backdrop = document.getElementById("feedback-modal-backdrop");
      var closeBtn = document.getElementById("feedback-modal-close");
      var closeIcon = document.getElementById("feedback-modal-close-icon");
      var link = document.getElementById("feedback-modal-link");
      if (!backdrop || !closeBtn || !link) return;

      if (closeIcon) closeIcon.innerHTML = ICON.close;

      var dismissed = false;
      var lastFocused = null;

      function onKeydown(e) {
        if (e.key === "Escape") dismiss();
      }

      function dismiss() {
        if (dismissed) return;
        dismissed = true;
        try {
          sessionStorage.setItem(STORAGE_KEY, "1");
        } catch (e) {
          /* private browsing / storage disabled — it just won't stay
             dismissed past this page load, which is an acceptable
             fallback rather than something to block on */
        }
        backdrop.classList.remove("show");
        // Let the fade-out finish before pulling it fully out of layout,
        // rather than having it vanish mid-transition.
        setTimeout(function () {
          backdrop.hidden = true;
        }, 220);
        document.removeEventListener("keydown", onKeydown);
        if (lastFocused && typeof lastFocused.focus === "function") {
          lastFocused.focus();
        }
      }

      closeBtn.addEventListener("click", dismiss);
      link.addEventListener("click", dismiss);
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) dismiss();
      });

      setTimeout(function () {
        if (dismissed || sessionStorage.getItem(STORAGE_KEY)) return;
        lastFocused = document.activeElement;
        backdrop.hidden = false;
        // Double rAF: guarantees the browser has painted the
        // pre-transition state (opacity 0, offset) after [hidden] comes
        // off before .show flips it — a single frame can occasionally
        // still coalesce with the class change and skip the transition
        // entirely.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            backdrop.classList.add("show");
          });
        });
        document.addEventListener("keydown", onKeydown);
        closeBtn.focus();
      }, 60000);
    } catch (e) {
      // Never let a feedback-popup issue affect the rest of the app —
      // still logged (not thrown/shown to the visitor) so a real
      // problem is visible in devtools instead of just silently never
      // showing the popup with no trace of why.
      if (typeof console !== "undefined" && console.error) {
        console.error("Feedback popup failed to set up:", e);
      }
    }
  }

  function start(records) {
    ALL = records;

    Object.keys(
      ALL.reduce(function (acc, r) {
        if (r.type) acc[r.type] = 1;
        return acc;
      }, {})
    )
      .sort()
      .forEach(function (t, i) {
        // Offset each wrap so new Types stay visually distinct past 16.
        var shift = 13 * Math.floor(i / HUES.length);
        typeHue[t] = (HUES[i % HUES.length] + shift) % 360;
      });

    if (!ALL.length) {
      showError("No resources found in the data file.", "Check that the CSV has rows below its header.");
      return;
    }

    var quickReadRecord = ALL.filter(function (r) {
      return (
        norm(r.creator) === norm(QUICK_READ.creator) &&
        norm(r.type) === norm(QUICK_READ.type) &&
        norm(r.subtype) === norm(QUICK_READ.subtype)
      );
    })[0];
    quickReadUrl = quickReadRecord ? safeUrl(quickReadRecord.link) : "";
    el.quickRead.hidden = !quickReadUrl;
    el.quickReadToggle.hidden = !quickReadUrl;
    // Plain text (not the highlight()/esc() HTML path cardHTML uses) —
    // there's no search-term highlighting relevant here, and textContent
    // means the Description cell can't inject markup even accidentally.
    if (quickReadUrl) {
      var quickReadDesc = quickReadRecord.description || "No description provided.";
      el.quickReadTooltip.textContent = quickReadDesc;
      el.quickReadPanelDesc.textContent = quickReadDesc;
      el.quickReadPanelLink.href = quickReadUrl;
    }

    wire();
    render();
  }

  function boot() {
    el = {
      controls: $("controls"),
      filterBar: $("filter-bar"),
      startHere: $("start-here"),
      startHereToggle: $("start-here-toggle"),
      startHereSection: $("start-here-section"),
      quickReadToggle: $("quick-read-toggle"),
      quickReadPanel: $("quick-read-panel"),
      quickReadPanelDesc: $("quick-read-panel-desc"),
      quickReadPanelLink: $("quick-read-panel-link"),
      search: $("search"),
      searchbox: $("searchbox"),
      clearSearch: $("clear-search"),
      typePills: $("type-pills"),
      subPills: $("sub-pills"),
      orgPills: $("org-pills"),
      typePillsPreview: $("type-pills-preview"),
      subPillsPreview: $("sub-pills-preview"),
      orgPillsPreview: $("org-pills-preview"),
      subFgroup: $("sub-fgroup"),
      subFgroupPreview: $("sub-fgroup-preview"),
      orgMobileToggle: $("org-mobile-toggle"),
      typeMobileToggle: $("type-mobile-toggle"),
      filtersTypesub: $("filters-typesub"),
      typeFgroup: $("type-fgroup"),
      clearFilters: $("clear-filters"),
      filterToggle: $("filter-toggle"),
      filterToggleLabel: $("filter-toggle-label"),
      filterBadge: $("filter-badge"),
      matchMode: $("match-mode"),
      matchAllBtn: $("match-all-btn"),
      matchAnyBtn: $("match-any-btn"),
      matchInfo: $("match-info"),
      crumbs: $("crumbs"),
      count: $("count"),
      grid: $("grid"),
      quickRead: $("quick-read"),
      quickReadTooltip: $("quick-read-tooltip"),
      random: $("random"),
      anotherRandom: $("another-random"),
      backToAll: $("back-to-all"),
      toast: $("toast"),
    };

    var missing = [];
    for (var k in el) {
      if (Object.prototype.hasOwnProperty.call(el, k) && !el[k]) missing.push(k);
    }
    if (missing.length) {
      showError(
        "This page is missing elements the app needs.",
        "Missing: <code>" + esc(missing.join(", ")) + "</code>"
      );
      return;
    }

    try {
      $("search-icon").innerHTML = ICON.search;
      // "beforeend" (not "afterbegin" like below) — text first, dice
      // icon after, on the right side of the label.
      el.random.insertAdjacentHTML("beforeend", ICON.dice);
      el.quickRead.insertAdjacentHTML("beforeend", ICON.clock);
      // Same dice icon as "Random resource" — visually ties the two
      // random-pick actions together now that "Another random resource"
      // has its own distinct pink/magenta styling (see .btn-random).
      el.anotherRandom.insertAdjacentHTML("afterbegin", ICON.dice);
      /* $("start-here-icon").innerHTML = ICON.compass; */
    } catch (e) {
      /* icons are decorative — never block startup on them */
    }

    try {
      // Mobile: drop the placeholder text so the search bar reads clean
      // and uncluttered next to the random-resource hint; desktop keeps
      // it. Purely cosmetic — the visually-hidden <label for="search">
      // already gives the input its accessible name either way, and
      // typing/searching is unaffected. Same 720px breakpoint used
      // elsewhere in this file and in styles.css. Listens for the query
      // crossing rather than every resize so it also handles rotation
      // and desktop windows being resized past the breakpoint live.
      var mobileQuery =
        window.matchMedia && window.matchMedia("(max-width: 720px)");
      if (mobileQuery) {
        var searchPlaceholder = el.search.placeholder;
        var syncSearchPlaceholder = function () {
          el.search.placeholder = mobileQuery.matches ? "" : searchPlaceholder;
        };
        syncSearchPlaceholder();
        if (mobileQuery.addEventListener) {
          mobileQuery.addEventListener("change", syncSearchPlaceholder);
        } else if (mobileQuery.addListener) {
          mobileQuery.addListener(syncSearchPlaceholder); // Safari < 14
        }
      }
    } catch (e) {
      /* placeholder text is cosmetic — never block startup on it */
    }

    setupFeedbackModal();

    // Standalone build: the data is already here, so render synchronously.
    // No promises, no network, nothing that can leave the page hanging.
    var embedded = typeof window !== "undefined" && window.__RESOURCES__;
    if (embedded && embedded.length) {
      try {
        start(embedded);
      } catch (e) {
        showError("Couldn't display the resources.", errText(e));
      }
      return;
    }

    // Fetches the published Google Sheet at runtime (hosted and dev-server
    // modes both hit the network here; only the standalone build above
    // skips this in favor of embedded data).
    var devHint = function (err) {
      var viaFile =
        typeof location !== "undefined" && location.protocol === "file:";
      return (
        "Reading the resource sheet failed (" + errText(err) + "). " +
        (viaFile
          ? "Some browsers block cross-origin fetches from local files, so this page " +
            "needs to be served over HTTP — run <code>python3 -m http.server 8000</code> " +
            "from the project folder and open <code>http://localhost:8000/</code>. For an " +
            "offline copy you can email, use <code>legacy-offline-build/resources-app.html</code> instead."
          : "Check that the Google Sheet is still published to the web (File → Share → " +
            "Publish to web) and try reloading.")
      );
    };

    try {
      if (typeof fetch !== "function") throw new Error("fetch unavailable");
      fetch(CSV_PATH, { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.text();
        })
        .then(function (text) {
          start(rowsToRecords(parseCSV(text)));
        })
        // A single .catch also covers anything start() throws, so a render
        // error surfaces instead of vanishing into an unhandled rejection.
        .catch(function (err) {
          showError("Couldn't load the resource data.", devHint(err));
        });
    } catch (e) {
      showError("Couldn't load the resource data.", devHint(e));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
