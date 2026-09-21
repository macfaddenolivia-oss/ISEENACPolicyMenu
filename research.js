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

  /* ---------------- state ---------------- */

  var ALL = [];
  var state = {
    q: "",
    terms: [],
    type: "",
    online: "",
  };
  var el = {};

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
    if (state.type && r.type !== state.type) return false;
    if (state.online && r.online !== state.online) return false;
    return true;
  }

  function currentResults() {
    return ALL.filter(passes);
  }

  /* ---------------- rendering ---------------- */

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
    var results = currentResults();

    el.count.innerHTML =
      "<strong>" + results.length + "</strong> of " + ALL.length + " resources";
    el.grid.setAttribute("aria-busy", "false");

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
  }

  function populateSelect(select, values, placeholder) {
    select.innerHTML =
      '<option value="">' + esc(placeholder) + "</option>" +
      values
        .map(function (v) {
          return '<option value="' + esc(v) + '">' + esc(v) + "</option>";
        })
        .join("");
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

    el.typeFilter.addEventListener("change", function () {
      state.type = el.typeFilter.value;
      render();
    });
    el.onlineFilter.addEventListener("change", function () {
      state.online = el.onlineFilter.value;
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

    var types = Object.keys(
      ALL.reduce(function (acc, r) {
        if (r.type) acc[r.type] = true;
        return acc;
      }, {})
    ).sort();
    populateSelect(el.typeFilter, types, "All types");

    var onlineValues = Object.keys(
      ALL.reduce(function (acc, r) {
        if (r.online) acc[r.online] = true;
        return acc;
      }, {})
    ).sort();
    populateSelect(el.onlineFilter, onlineValues, "All");

    wire();
    render();
  }

  function boot() {
    el = {
      searchbox: $("rr-searchbox"),
      search: $("rr-search"),
      clearSearch: $("rr-clear-search"),
      typeFilter: $("rr-type-filter"),
      onlineFilter: $("rr-online-filter"),
      count: $("rr-count"),
      grid: $("rr-grid"),
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
    } catch (e) {
      /* icon is decorative — never block startup on it */
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
