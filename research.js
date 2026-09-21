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
      var rec = {
        resource: pick(row, "Resource"),
        creator: pick(row, "Creator"),
        type: pick(row, "Type"),
        subtype: pick(row, "Subtype"),
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
        online: pick(row, "Is it still online"),
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

  function norm(s) {
    return String(s || "").toLowerCase();
  }

  function safeUrl(u) {
    var s = String(u || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    if (/^www\./i.test(s)) return "https://" + s;
    return "";
  }

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
  // "No" becomes "Offline" regardless of what follows it.
  function onlineLabel(v) {
    var raw = String(v || "").trim();
    if (!raw) return "Unknown";
    var lower = raw.toLowerCase();
    if (lower === "yes") return "Live";
    if (lower.indexOf("yes") === 0) {
      var detail = raw.replace(/^yes,?\s*(only\s+)?/i, "").trim();
      return detail ? "Live (" + detail + ")" : "Live";
    }
    if (lower.indexOf("no") === 0) return "Offline";
    return raw;
  }

  var ICON_PERSON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  var ICON_SEARCH =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  var ICON_EMPTY =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8.5 11h5"/></svg>';
  var ICON_DICE =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor"/></svg>';

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
    online: "",
    creators: [], // selected Creator values (OR within this facet, same as the Policy Menu's Organization pills)
  };
  var el = {};
  var toastTimer = null;

  // Set by "random resource" to narrow the grid to that single pick;
  // null means show the normal filtered results — same pattern as
  // app.js's own random-pick feature on the Policy Menu. Any real
  // search/filter change (not the random actions themselves) clears
  // this — see exitRandomPick, used by setSearch, the online dropdown's
  // change handler, and the Type/Creator pill click handler.
  var randomPick = null;

  // Bumped by exitRandomPick() so pickRandom()'s in-flight flicker chain
  // can tell it's been superseded and stop, instead of clobbering
  // whatever the interrupting action just rendered a moment later.
  var rollId = 0;

  function exitRandomPick() {
    randomPick = null;
    rollId++;
  }

  function $(id) {
    return document.getElementById(id);
  }

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
    if (state.online && r.online !== state.online) return false;
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
      state.online ||
      state.creators.length
    );
  }

  function toggleIn(list, value) {
    var i = list.indexOf(value);
    if (i === -1) list.push(value);
    else list.splice(i, 1);
  }

  /* ---------------- rendering ---------------- */

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove("show");
    }, 1900);
  }

  /* -------- Type/Creator pill filters (ported from app.js's own Type
     and Organization pills — one generic implementation shared by both
     facets here, the same way app.js's countIncluding/pillHTML already
     serve Type, Subtype, and Organization there). -------- */

  // Live count per candidate value in `field` under the *other* active
  // filters — same simulate-add approach as app.js's countIncluding.
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

  // kind is "type" (gets the hue dot, via data-filter="type") or "org"
  // (Creator, via data-filter="org") so these pills pick up the Policy
  // Menu's existing Type/Organization pill styling directly — see
  // .pill[data-filter="type"] / .pill[data-filter="org"] in styles.css.
  function pillHTML(value, count, active, kind) {
    var isEmpty = count === 0;
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
  var PREVIEW_TYPE_COUNT = 6;
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

  // One facet's pills, full wall + preview row — shared by Type and
  // Creator below, same as app.js reuses its own rendering for Type/
  // Subtype/Organization rather than writing one version per facet.
  function renderFacetPills(listKey, field, kind, label, previewCount, pillsEl, previewEl) {
    var counts = countIncluding(listKey, field);
    var values = Object.keys(
      ALL.reduce(function (acc, r) {
        if (r[field]) acc[r[field]] = true;
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
  // pills across both facets, same as app.js's #filter-badge counting
  // Type + Subtype + Organization together.
  function renderFilterPills() {
    renderFacetPills("types", "type", "type", "Type", PREVIEW_TYPE_COUNT, el.typePills, el.typePillsPreview);
    renderFacetPills("creators", "creator", "org", "Creator", PREVIEW_CREATOR_COUNT, el.creatorPills, el.creatorPillsPreview);

    var activePills = state.types.length + state.creators.length;
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

    var tags = "";
    if (r.type) tags += '<span class="tag type tag-static">' + esc(r.type) + "</span>";
    if (r.subtype) tags += '<span class="tag sub tag-static">' + esc(r.subtype) + "</span>";

    var meta = "";
    if (r.creator) meta += metaItem(ICON_PERSON, r.creator);
    if (r.level) meta += metaItem(null, "Level: " + r.level);
    if (r.location) meta += metaItem(null, "Location: " + r.location);
    if (r.govSite) meta += metaItem(null, "Government site: " + r.govSite);

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
      '<article class="card">' +
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
    renderFilterPills();

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
    el.grid.innerHTML = results.map(cardHTML).join("");
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
    state.creators.length = 0;
    state.online = "";
    el.onlineFilter.value = "";
    syncOnlineFilterColor();
    setSearch("");
    el.search.value = "";
  }

  // Maps the same online/offline/unknown bucket classifyOnline() uses for
  // the card badge to the exact color that badge renders in, so the
  // dropdown's option text can match it. The <option value="..."> stays
  // the raw CSV value (e.g. "Yes, only data through 2020") — only the
  // displayed text and color change; filtering still matches on that
  // raw value (see passes()).
  var ONLINE_OPTION_COLOR = {
    online: "#0a7d55",
    offline: "#b3261e",
    unknown: "var(--text-2)",
  };

  function populateOnlineSelect(select, values, placeholder) {
    select.innerHTML =
      '<option value="">' + esc(placeholder) + "</option>" +
      values
        .map(function (v) {
          var color = ONLINE_OPTION_COLOR[classifyOnline(v)];
          return (
            '<option value="' + esc(v) + '" style="color:' + color + '">' +
            esc(onlineLabel(v)) +
            "</option>"
          );
        })
        .join("");
  }

  // Progressive enhancement: syncs the *closed* select box's own text
  // color to the selected option's color. Browsers that already color
  // individual <option> rows in the open dropdown (Chrome, Firefox, Edge
  // desktop) get this for free from populateOnlineSelect above; this
  // extra step is what makes the closed box reflect it too, since a
  // <select> always renders its own color for the closed state, not the
  // selected <option>'s. Known gap: Safari (desktop and iOS) and mobile
  // OS-native pickers generally ignore <option> color styling entirely,
  // so there this select just stays plain text in all states.
  function syncOnlineFilterColor() {
    var opt = el.onlineFilter.options[el.onlineFilter.selectedIndex];
    el.onlineFilter.style.color = (opt && opt.style.color) || "";
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

    el.onlineFilter.addEventListener("change", function () {
      state.online = el.onlineFilter.value;
      syncOnlineFilterColor();
      exitRandomPick();
      render();
    });

    // Type/Creator pills (delegated on the filter bar, same pattern
    // app.js uses for its Type/Subtype/Organization pills). data-filter
    // tells us which facet a given pill belongs to ("type" or "org").
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
      else if (kind === "org") toggleIn(state.creators, value);
      exitRandomPick();
      render();
    });

    // "Browse filters" disclosure — reveals both facets' full pill walls
    // at once, same as the Policy Menu's single toggle for its two boxes
    // (Type+Subtype and Organization).
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

    var onlineValues = Object.keys(
      ALL.reduce(function (acc, r) {
        if (r.online) acc[r.online] = true;
        return acc;
      }, {})
    ).sort();
    populateOnlineSelect(el.onlineFilter, onlineValues, "All");
    syncOnlineFilterColor();

    wire();
    render();
  }

  function boot() {
    el = {
      searchbox: $("rr-searchbox"),
      search: $("rr-search"),
      clearSearch: $("rr-clear-search"),
      random: $("rr-random"),
      onlineFilter: $("rr-online-filter"),
      count: $("rr-count"),
      grid: $("rr-grid"),
      backToAll: $("rr-back-to-all"),
      anotherRandom: $("rr-another-random"),
      toast: $("rr-toast"),
      filterBar: $("rr-filter-bar"),
      typePills: $("rr-type-pills"),
      typePillsPreview: $("rr-type-pills-preview"),
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

    try {
      $("rr-search-icon").innerHTML = ICON_SEARCH;
      // "beforeend" (not "afterbegin") — text first, dice icon after, on
      // the right side of the label, matching the Policy Menu's version.
      el.random.insertAdjacentHTML("beforeend", ICON_DICE);
      el.anotherRandom.insertAdjacentHTML("afterbegin", ICON_DICE);
    } catch (e) {
      /* icons are decorative — never block startup on them */
    }

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
