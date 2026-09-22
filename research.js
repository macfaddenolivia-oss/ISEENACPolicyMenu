/* Research Resources page — separate data pipeline from app.js.
 *
 * Fetches a DIFFERENT tab ("Research_resources") of the same published
 * Google Sheet the Policy Menu uses, at a distinct gid. This is a fully
 * separate fetch/parse/render cycle from app.js — it never touches
 * app.js's CSV_PATH, ALL, or DOM, and this data never renders anywhere
 * but this page.
 */
(function () {
  "use strict";

  var CSV_PATH =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFj-hZ-z0t1PGu6iK7VR4rOKfDsFtRiJuoWnoje-tiZ21fF7eC10hmPlTXt8PpsvGDypkh9Fi60qQh/pub?gid=1603679950&single=true&output=csv";

  /* ---------------- CSV parsing (same approach as app.js) ---------------- */

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
      var topicsRaw = pick(row, "Topics");
      var onlineRaw = pick(row, "Is it still online");
      var rec = {
        resource: pick(row, "Resource"),
        creator: pick(row, "Creator"),
        type: pick(row, "Type"),
        subtype: pick(row, "Subtype"), // kept in the data; not rendered on the card
        description: pick(row, "Description"),
        topics: topicsRaw
          .split(";")
          .map(function (t) {
            return t.trim();
          })
          .filter(Boolean),
        level: pick(row, "Level"),
        location: pick(row, "Location"),
        govSite: pick(row, "Is it a governmental site?"),
        online: onlineRaw,
        // Groups "Yes" and "Yes, only data through 2020" together for
        // the filter pill (see ONLINE_BUCKET_LABEL/pillHTML) — the card
        // badge still shows the raw value's own qualifier via
        // onlineLabel(r.online), unaffected by this grouping.
        onlineBucket: classifyOnline(onlineRaw),
        link: pick(row, "Link"),
      };
      if (!rec.resource && !rec.link) continue; // nothing renderable
      if (!rec.resource) rec.resource = "(untitled resource)";
      out.push(rec);
    }
    return out;
  }

  /* ---------------- helpers ---------------- */

  // esc/norm/safeUrl/$ live in shared-ui.js (identical in app.js) —
  // aliased here so every existing call site below is unchanged.
  var esc = SharedUI.esc;
  var norm = SharedUI.norm;
  var safeUrl = SharedUI.safeUrl;

  // Buckets the free-text "Is it still online" cell into online/offline/
  // unknown so the badge can be color-coded.
  function classifyOnline(v) {
    var n = norm(v).trim();
    if (!n) return "unknown";
    if (n.indexOf("yes") === 0) return "online";
    if (n.indexOf("no") === 0) return "offline";
    return "unknown";
  }

  // Turns the raw "Is it still online" cell into a badge label that reads
  // on its own, since a bare "Yes"/"No" doesn't say what it's answering.
  // A plain "Yes" becomes "Live"; a qualified one (e.g. "Yes, only data
  // through 2020") keeps the qualifier as "Live (data through 2020)"; any
  // "No" becomes "No longer live" regardless of what follows it.
  function onlineLabel(v) {
    var raw = String(v || "").trim();
    if (!raw) return "Unknown";
    var lower = raw.toLowerCase();
    if (lower === "yes") return "Live";
    if (lower.indexOf("yes") === 0) {
      var detail = raw.replace(/^yes,?\s*(only\s+)?/i, "").trim();
      return detail ? "Live (" + detail + ")" : "Live";
    }
    if (lower.indexOf("no") === 0) return "No longer live";
    return raw;
  }

  // Same icons app.js uses (see shared-ui.js) — no research-page-only
  // icons exist, unlike app.js's copy/check/compass/close.
  var ICON_PERSON = SharedUI.ICONS.person;
  var ICON_SEARCH = SharedUI.ICONS.search;
  var ICON_EMPTY = SharedUI.ICONS.empty;
  var ICON_DICE = SharedUI.ICONS.dice;

  // Deterministic, well-spaced hues so each Type keeps its color across
  // rebuilds — same palette app.js uses for its own Type pills/dots.
  var HUES = [210, 145, 28, 340, 265, 190, 95, 12, 300, 45, 170, 240, 320, 70, 355, 225];

  /* ---------------- state ---------------- */

  var ALL = [];
  var typeHue = {};
  var state = {
    q: "",
    terms: [],
    types: [], // selected Type values (OR within this facet, same as the Policy Menu's Type pills)
    onlineValues: [], // selected "Is it still online" raw values (OR within this facet)
    topics: [], // selected Topic values (OR within this facet) — a resource can carry several Topics, so matching one is enough (see countIncluding's multi flag / passes below)
    creators: [], // selected Creator values (OR within this facet, same as the Policy Menu's Organization pills)
  };
  var el = {};
  // Bound to el.toast once boot() has resolved it — see the shared
  // createToast() factory in shared-ui.js.
  var toast;

  // Set by "random resource" to narrow the grid to that single pick;
  // null means show the normal filtered results — same pattern as
  // app.js's own random-pick feature on the Policy Menu. Any real
  // search/filter change (not the random actions themselves) clears
  // this — see exitRandomPick, used by setSearch and the pill click
  // handler (Type/Online/Creator all share one delegated listener).
  var randomPick = null;

  // Bumped by exitRandomPick() so pickRandom()'s in-flight flicker chain
  // can tell it's been superseded and stop, instead of clobbering
  // whatever the interrupting action just rendered a moment later.
  var rollId = 0;

  function exitRandomPick() {
    randomPick = null;
    rollId++;
  }

  var $ = SharedUI.$;

  /* ---------------- filtering ---------------- */

  function matchesSearch(r) {
    if (!state.terms.length) return true;
    var hay = norm(
      r.resource + "\n" + r.creator + "\n" + r.description + "\n" + r.topics.join(" ")
    );
    return state.terms.every(function (t) {
      return hay.indexOf(t) !== -1;
    });
  }

  function passes(r) {
    if (!matchesSearch(r)) return false;
    if (state.types.length && state.types.indexOf(r.type) === -1) return false;
    if (state.onlineValues.length && state.onlineValues.indexOf(r.onlineBucket) === -1) return false;
    // Topic is multi-valued (r.topics is an array) — matching *any* one
    // of the selected Topics is enough, not an exact single-value match.
    if (
      state.topics.length &&
      !r.topics.some(function (t) {
        return state.topics.indexOf(t) !== -1;
      })
    ) {
      return false;
    }
    if (state.creators.length && state.creators.indexOf(r.creator) === -1) return false;
    return true;
  }

  function currentResults() {
    return ALL.filter(passes);
  }

  function hasActiveFilters() {
    return !!(
      state.q.trim() ||
      state.types.length ||
      state.onlineValues.length ||
      state.topics.length ||
      state.creators.length
    );
  }

  function toggleIn(list, value) {
    var i = list.indexOf(value);
    if (i === -1) list.push(value);
    else list.splice(i, 1);
  }

  /* ---------------- rendering ---------------- */

  /* -------- Online/Type/Creator pill filters (ported from app.js's own
     Type and Organization pills — one generic implementation shared by
     all three facets here, the same way app.js's countIncluding/
     pillHTML already serve Type, Subtype, and Organization there). -------- */

  // Live count per candidate value in `field` under the *other* active
  // filters — same simulate-add approach as app.js's countIncluding.
  // `multi`, when true, treats r[field] as an array a record can have
  // several values in (Topic) rather than one scalar value — the "does
  // this record count toward v" check becomes membership
  // (indexOf(v) !== -1) instead of equality, and a record contributes
  // every one of its own values as its own candidate rather than just
  // one.
  function countIncluding(listKey, field, multi) {
    var counts = Object.create(null);
    var original = state[listKey];
    var alreadyOn = Object.create(null);
    original.forEach(function (v) {
      alreadyOn[v] = true;
    });
    var current = currentResults();
    var facetActive = original.length > 0;

    function matches(rr, v) {
      return multi ? rr[field].indexOf(v) !== -1 : rr[field] === v;
    }

    ALL.forEach(function (r) {
      var values = multi ? r[field] : [r[field]];
      values.forEach(function (v) {
        if (!v || counts[v] !== undefined) return;
        if (alreadyOn[v]) {
          counts[v] = current.length;
          return;
        }
        if (!facetActive) {
          counts[v] = current.filter(function (rr) {
            return matches(rr, v);
          }).length;
          return;
        }
        state[listKey] = original.concat([v]);
        counts[v] = currentResults().length;
        state[listKey] = original;
      });
    });

    return counts;
  }

  // Selected values sort first, then everything else by live count desc,
  // alpha tiebreak — same ordering rule app.js uses for Type/Sub/Org.
  function bySelectionThenCount(counts, activeList) {
    return function (a, b) {
      var aActive = activeList.indexOf(a) !== -1;
      var bActive = activeList.indexOf(b) !== -1;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b);
    };
  }

  // Only values worth clicking (non-zero count, or already active) count
  // toward "+N more" and the preview row — the full wall further down
  // still lists every value, 0-count ones dimmed via .is-empty.
  function relevantValues(values, counts, activeList) {
    return values.filter(function (v) {
      return (counts[v] || 0) > 0 || activeList.indexOf(v) !== -1;
    });
  }

  // Default-visible preview: the top N by count, plus whatever's already
  // active (so an active filter never silently drops out of view).
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

  // Maps an "onlineBucket" value ("online"/"offline"/"unknown") to its
  // filter-pill label ("Live"/"No longer live"/"Unknown"). The filter
  // pill groups every raw sheet value sharing a bucket together (e.g.
  // "Yes" and "Yes, only data through 2020" both count toward one "Live"
  // pill) — the per-row qualifier stays on the card badge
  // (onlineLabel(r.online), using the raw value), just not on this
  // collapsed filter pill.
  var ONLINE_BUCKET_LABEL = { online: "Live", offline: "No longer live", unknown: "Unknown" };

  // kind is "type" (hue dot, data-filter="type"), "org" (Creator,
  // data-filter="org"), or "online" (Is it still online, data-filter=
  // "online"). Type/Creator pick up the Policy Menu's existing pill
  // color treatment for that kind directly, see styles.css. "online" is
  // built from the exact same classes the card's own status badge uses
  // (.status-badge status-online/status-offline) rather than a second
  // color definition — see .pill.status-badge in styles.css — plus
  // .status-filter for the interactive/selected-state additions a
  // clickable pill needs on top of that read-only badge look. Its value
  // is the bucket key ("online"/"offline"), not a raw CSV string.
  function pillHTML(value, count, active, kind) {
    var isEmpty = count === 0;

    if (kind === "online") {
      return (
        '<button class="pill status-badge status-' + value + ' status-filter' +
        (isEmpty ? " is-empty" : "") + '"' +
        ' type="button"' +
        ' aria-pressed="' + (active ? "true" : "false") + '"' +
        ' data-filter="online"' +
        ' data-value="' + esc(value) + '">' +
        "<span>" + esc(ONLINE_BUCKET_LABEL[value] || value) + "</span>" +
        '<span class="n">' + count + "</span>" +
        "</button>"
      );
    }

    var hue = kind === "type" ? typeHue[value] : null;
    var style = hue != null ? ' style="--type-h:' + hue + '"' : "";
    return (
      '<button class="pill' + (isEmpty ? " is-empty" : "") + '"' +
      ' type="button"' +
      ' aria-pressed="' + (active ? "true" : "false") + '"' +
      ' data-filter="' + kind + '"' +
      ' data-value="' + esc(value) + '"' +
      style +
      ">" +
      (kind === "type" ? '<span class="dot"></span>' : "") +
      "<span>" + esc(value) + "</span>" +
      '<span class="n">' + count + "</span>" +
      "</button>"
    );
  }

  // Corrects the preview row's guessed pill count against the real,
  // laid-out DOM, trimming real pills from the end (skipping active
  // ones) until "+N more" lands within the row budget — ported as-is
  // from app.js's fitPreviewRow.
  var PREVIEW_ONLINE_COUNT = 6;
  var PREVIEW_TYPE_COUNT = 6;
  var PREVIEW_TOPIC_COUNT = 4;
  var PREVIEW_CREATOR_COUNT = 3;

  function fitPreviewRow(container, totalCount, label, isActiveFn) {
    var maxRows =
      window.matchMedia && window.matchMedia("(max-width: 720px)").matches ? 2 : 1;

    var pills = Array.prototype.slice
      .call(container.querySelectorAll(".pill:not(.pill-more)"))
      .filter(function (p) {
        return p.offsetParent !== null;
      });
    if (!pills.length) return;

    var hidden = totalCount - pills.length;
    var moreEl = container.querySelector(".pill-more");

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

    var guard = pills.length + 1;
    while (guard-- > 0) {
      if (moreEl) moreEl.parentNode.removeChild(moreEl);
      container.insertAdjacentHTML("beforeend", moreTagHTML(hidden, label));
      moreEl = container.querySelector(".pill-more");
      if (!moreEl || moreEl.offsetTop < cutoffTop()) break;
      if (!dropOneRealPill()) break;
    }
  }

  // One facet's pills, full wall + preview row — shared by Online, Type,
  // Topic, and Creator below, same as app.js reuses its own rendering
  // for Type/Subtype/Topic/Organization rather than writing one version
  // per facet. `precomputedCounts`, when given, is used instead of
  // calling countIncluding again — render() passes the Type counts it
  // already computed for itself, so the same numbers reach the Type
  // filter pills and each card's Type tag without computing them
  // twice. `multi`, when true, treats r[field] as an array (Topic)
  // rather than one scalar value, same meaning as in countIncluding.
  function renderFacetPills(listKey, field, kind, label, previewCount, pillsEl, previewEl, precomputedCounts, multi) {
    var counts = precomputedCounts || countIncluding(listKey, field, multi);
    var values = Object.keys(
      ALL.reduce(function (acc, r) {
        if (multi) {
          r[field].forEach(function (v) {
            if (v) acc[v] = true;
          });
        } else if (r[field]) {
          acc[r[field]] = true;
        }
        return acc;
      }, {})
    ).sort(bySelectionThenCount(counts, state[listKey]));

    pillsEl.innerHTML = values
      .map(function (v) {
        return pillHTML(v, counts[v] || 0, state[listKey].indexOf(v) !== -1, kind);
      })
      .join("");

    var forPreview = relevantValues(values, counts, state[listKey]);
    var preview = previewSubset(forPreview, state[listKey], previewCount);
    previewEl.innerHTML =
      preview
        .map(function (v) {
          return pillHTML(v, counts[v] || 0, state[listKey].indexOf(v) !== -1, kind);
        })
        .join("") + moreTagHTML(forPreview.length - preview.length, label);
    fitPreviewRow(previewEl, forPreview.length, label, function (v) {
      return state[listKey].indexOf(v) !== -1;
    });
  }

  // Combined badge on the single "Browse filters" button — total active
  // pills across all four facets, same as app.js's #filter-badge
  // counting Type + Subtype + Topic + Organization together. typeCounts
  // is computed once by render() and passed in so the Type filter pill
  // and each card's Type tag (see cardHTML) always show the same
  // number.
  function renderFilterPills(typeCounts) {
    renderFacetPills("onlineValues", "onlineBucket", "online", "Live status", PREVIEW_ONLINE_COUNT, el.onlinePills, el.onlinePillsPreview);
    renderFacetPills("types", "type", "type", "Type", PREVIEW_TYPE_COUNT, el.typePills, el.typePillsPreview, typeCounts);
    renderFacetPills("topics", "topics", "topic", "Topic", PREVIEW_TOPIC_COUNT, el.topicPills, el.topicPillsPreview, null, true);
    renderFacetPills("creators", "creator", "org", "Creator", PREVIEW_CREATOR_COUNT, el.creatorPills, el.creatorPillsPreview);

    var activePills = state.types.length + state.onlineValues.length + state.topics.length + state.creators.length;
    el.filterBadge.textContent = activePills ? String(activePills) : "";
  }

  function metaItem(icon, text) {
    return (
      '<span class="meta-item">' +
      (icon || "") +
      '<span class="v">' + esc(text) + "</span></span>"
    );
  }

  function cardHTML(r) {
    var url = safeUrl(r.link);
    var onlineClass = classifyOnline(r.online);
    var badgeText = onlineLabel(r.online);

    // Same --type-h this type's filter pill and .tag.type tag use (see
    // pillHTML/typeHue) — set on the article itself too so the card's
    // existing .card::before left-edge stripe (ported as-is from
    // app.js's Policy Menu cards, see that rule in styles.css) picks up
    // the same color rather than a second value that could drift out
    // of sync. Same 220 fallback app.js's cardHTML uses for a card
    // with no Type.
    var hue = typeHue[r.type] != null ? typeHue[r.type] : 220;

    var tags = "";
    if (r.type) {
      var hueStyle = ' style="--type-h:' + hue + '"';
      tags +=
        '<span class="tag type tag-static"' + hueStyle + '>' +
        esc(r.type) +
        "</span>";
    }

    // Level/Location/Is it a governmental site? stay parsed on the
    // record (see rowsToRecords) but are no longer shown on the card —
    // only Creator renders here now.
    var meta = "";
    if (r.creator) meta += metaItem(ICON_PERSON, r.creator);

    var topicsHTML = "";
    if (r.topics.length) {
      topicsHTML =
        '<div class="topic-pills">' +
        r.topics
          .map(function (t) {
            return '<span class="topic-pill">' + esc(t) + "</span>";
          })
          .join("") +
        "</div>";
    }

    var title = url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(r.resource) + "</a>"
      : esc(r.resource);

    return (
      '<article class="card rr-card" style="--type-h:' + hue + '">' +
      '<div class="card-head"><h3>' + title + "</h3>" +
      '<span class="status-badge status-' + onlineClass + '">' + esc(badgeText) + "</span>" +
      "</div>" +
      (tags ? '<div class="tagrow">' + tags + "</div>" : "") +
      '<p class="desc">' + esc(r.description || "No description provided.") + "</p>" +
      (meta ? '<div class="meta"><div class="meta-inner">' + meta + "</div></div>" : "") +
      topicsHTML +
      "</article>"
    );
  }

  function render() {
    var typeCounts = countIncluding("types", "type");
    renderFilterPills(typeCounts);

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
    el.grid.setAttribute("aria-busy", "false");

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

    if (!results.length) {
      el.grid.className = "";
      el.grid.innerHTML =
        '<div class="state">' +
        '<div class="icon">' + ICON_EMPTY + "</div>" +
        "<h2>No resources match</h2>" +
        "<p>Try clearing the search or filters.</p>" +
        "</div>";
      return;
    }

    el.grid.className = "grid";
    el.grid.innerHTML = results
      .map(function (r) {
        return cardHTML(r);
      })
      .join("");
  }

  /* ---------------- interactions ---------------- */

  function setSearch(v) {
    state.q = v;
    state.terms = norm(v).split(/\s+/).filter(Boolean);
    el.searchbox.classList.toggle("has-value", v.length > 0);
    exitRandomPick();
  }

  function clearAll() {
    state.types.length = 0;
    state.onlineValues.length = 0;
    state.topics.length = 0;
    state.creators.length = 0;
    setSearch("");
    el.search.value = "";
  }

  function wire() {
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

    // "Is it still online" info tooltip (two instances — preview row +
    // full row — the shared helper delegates across both).
    SharedUI.setupInfoTooltips();

    // Online/Type/Creator pills (delegated on the filter bar, same
    // pattern app.js uses for its Type/Subtype/Organization pills).
    // data-filter tells us which facet a given pill belongs to.
    el.filterBar.addEventListener("click", function (e) {
      var more = e.target.closest(".pill-more");
      if (more) {
        el.filterToggle.click();
        return;
      }
      var p = e.target.closest(".pill");
      if (!p) return;
      var kind = p.getAttribute("data-filter");
      var value = p.getAttribute("data-value");
      if (kind === "type") toggleIn(state.types, value);
      else if (kind === "topic") toggleIn(state.topics, value);
      else if (kind === "org") toggleIn(state.creators, value);
      else if (kind === "online") toggleIn(state.onlineValues, value);
      exitRandomPick();
      render();
    });

    // "Browse filters" disclosure — reveals all three facets' full pill
    // walls at once, same as the Policy Menu's single toggle for its two
    // boxes (Type+Subtype and Organization).
    el.filterToggle.addEventListener("click", function () {
      var open = !el.filterBar.classList.contains("filters-open");
      el.filterBar.classList.toggle("filters-open", open);
      el.filterToggle.setAttribute("aria-expanded", open ? "true" : "false");
      el.filterToggleLabel.textContent = open ? "Hide filters" : "Browse filters";
    });

    // Clear-filters button. While viewing a random pick, this exits that
    // view only — same as "Back to all resources" — rather than also
    // clearing search/filters the pick itself doesn't touch; otherwise
    // it's the normal full clear.
    el.clearFilters.addEventListener("click", function () {
      if (randomPick) {
        exitRandomPick();
      } else {
        clearAll();
      }
      render();
      el.search.focus();
    });

    // Random resource: narrows the grid to a single pick drawn from the
    // *currently filtered* results, not always the full set — same
    // behavior as the Policy Menu's own random-pick feature. Shared by
    // the main hint button and "Another random resource" (shown only
    // while a pick is already up), so re-rolling works the same from
    // either place.
    function pickRandom() {
      var results = currentResults();
      if (!results.length) return;

      var reduced =
        window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      var myRoll = ++rollId;
      var flickers = reduced ? 0 : 5 + Math.floor(Math.random() * 3); // 5-7 frames
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

    // Leaves the single-pick view without touching search/filter state.
    el.backToAll.addEventListener("click", function () {
      exitRandomPick();
      render();
    });
  }

  /* ---------------- boot ---------------- */

  function showError(msg, detail) {
    var grid = document.getElementById("rr-grid");
    var count = document.getElementById("rr-count");
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

  function start(records) {
    ALL = records;

    if (!ALL.length) {
      showError("No research resources found in the data file.", "Check that the CSV has rows below its header.");
      return;
    }

    Object.keys(
      ALL.reduce(function (acc, r) {
        if (r.type) acc[r.type] = 1;
        return acc;
      }, {})
    )
      .sort()
      .forEach(function (t, i) {
        var shift = 13 * Math.floor(i / HUES.length);
        typeHue[t] = (HUES[i % HUES.length] + shift) % 360;
      });

    wire();
    render();
  }

  function boot() {
    el = {
      searchbox: $("rr-searchbox"),
      search: $("rr-search"),
      clearSearch: $("rr-clear-search"),
      random: $("rr-random"),
      count: $("rr-count"),
      grid: $("rr-grid"),
      backToAll: $("rr-back-to-all"),
      anotherRandom: $("rr-another-random"),
      toast: $("rr-toast"),
      filterBar: $("rr-filter-bar"),
      onlinePills: $("rr-online-pills"),
      onlinePillsPreview: $("rr-online-pills-preview"),
      typePills: $("rr-type-pills"),
      typePillsPreview: $("rr-type-pills-preview"),
      topicPills: $("rr-topic-pills"),
      topicPillsPreview: $("rr-topic-pills-preview"),
      creatorPills: $("rr-creator-pills"),
      creatorPillsPreview: $("rr-creator-pills-preview"),
      filterToggle: $("rr-filter-toggle"),
      filterToggleLabel: $("rr-filter-toggle-label"),
      filterBadge: $("rr-filter-badge"),
      clearFilters: $("rr-clear-filters"),
    };

    var missing = [];
    for (var k in el) {
      if (Object.prototype.hasOwnProperty.call(el, k) && !el[k]) missing.push(k);
    }
    if (missing.length) {
      showError(
        "This page is missing elements it needs.",
        "Missing: <code>" + esc(missing.join(", ")) + "</code>"
      );
      return;
    }

    toast = SharedUI.createToast(el.toast);

    try {
      $("rr-search-icon").innerHTML = ICON_SEARCH;
      // "beforeend" (not "afterbegin") — text first, dice icon after, on
      // the right side of the label, matching the Policy Menu's version.
      el.random.insertAdjacentHTML("beforeend", ICON_DICE);
      el.anotherRandom.insertAdjacentHTML("afterbegin", ICON_DICE);
    } catch (e) {
      /* icons are decorative — never block startup on them */
    }

    try {
      SharedUI.clearSearchPlaceholderOnMobile(el.search);
    } catch (e) {
      /* placeholder text is cosmetic — never block startup on it */
    }

    // Shown once, ~45s after the "New here?" tour prompt is resolved
    // (declined, or the tour itself finishes/is skipped), unless already
    // dismissed this session — same modal markup/behavior as the Policy
    // Menu's (see SharedUI.setupFeedbackModal), reusing the same
    // feedback-survey and sign-up links since there's no
    // Research-Resources-specific survey yet. A distinct storage key
    // keeps dismissal independent of the Policy Menu's own popup and of
    // the onboarding tour's popup.
    SharedUI.setupFeedbackModal("feedbackModalDismissedResearch");

    var devHint = function (err) {
      var viaFile =
        typeof location !== "undefined" && location.protocol === "file:";
      return (
        "Reading the research resources sheet failed (" + errText(err) + "). " +
        (viaFile
          ? "Some browsers block cross-origin fetches from local files, so this page " +
            "needs to be served over HTTP — run <code>python3 -m http.server 8000</code> " +
            "from the project folder and open <code>http://localhost:8000/</code>."
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
        .catch(function (err) {
          showError("Couldn't load the research resources data.", devHint(err));
        });
    } catch (e) {
      showError("Couldn't load the research resources data.", devHint(e));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
