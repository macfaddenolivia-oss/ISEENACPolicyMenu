/* Shared UI plumbing — page-agnostic interaction/visual behavior used
 * identically by both app.js (Policy Menu) and research.js (Research
 * Resources). Nothing here touches CSV_PATH, ALL, or either page's own
 * filtering/rendering — that separation is deliberate (so the two
 * datasets never cross-contaminate) and stays completely intact.
 * app.js/research.js each read from window.SharedUI; load this script
 * before either of them.
 */
(function () {
  "use strict";

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
    // Allow only http(s)/mailto; anything else (javascript:, data:) is dropped.
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    if (/^www\./i.test(s)) return "https://" + s;
    return "";
  }

  function $(id) {
    return document.getElementById(id);
  }

  // Icons genuinely used by both pages. app.js additionally keeps a few
  // Policy-Menu-only icons (copy/check/compass/close) locally — those
  // aren't used anywhere on Research Resources, so they stay put rather
  // than moving here just because they could.
  var ICONS = {
    search:
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    person:
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    empty:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8.5 11h5"/></svg>',
    dice:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor"/></svg>',
  };

  // Info-tooltip open/close (e.g. the Policy Menu's Match all/any info
  // button, Research Resources' "Is it still online" info button):
  // :hover/:focus-visible in CSS already reveal a .tooltip for mouse and
  // keyboard; touch has no :hover, so a tap needs to explicitly open
  // *and* close it. Delegated across every .info-btn on the page, since
  // Research Resources has more than one instance (preview row + full
  // filter row) — a page with just one (the Policy Menu) behaves
  // identically, delegation just costs nothing extra there.
  function setupInfoTooltips() {
    document.querySelectorAll(".info-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var wasOpen = btn.classList.contains("info-open");
        document.querySelectorAll(".info-btn.info-open").forEach(function (b) {
          b.classList.remove("info-open");
        });
        if (!wasOpen) btn.classList.add("info-open");
      });
    });
    document.addEventListener("click", function () {
      document.querySelectorAll(".info-btn.info-open").forEach(function (b) {
        b.classList.remove("info-open");
      });
    });
  }

  // Mobile: drop the placeholder text so the search bar reads clean and
  // uncluttered next to the random-resource hint; desktop keeps it.
  // Purely cosmetic — each page's own visually-hidden <label for="...">
  // already gives the input its accessible name either way, and typing/
  // searching is unaffected. Same 720px breakpoint both pages'
  // stylesheets use. Listens for the query crossing rather than every
  // resize so it also handles rotation and desktop windows being
  // resized past the breakpoint live.
  function clearSearchPlaceholderOnMobile(inputEl) {
    if (!inputEl) return;
    var mobileQuery = window.matchMedia && window.matchMedia("(max-width: 720px)");
    if (!mobileQuery) return;
    var fullPlaceholder = inputEl.placeholder;
    function sync() {
      inputEl.placeholder = mobileQuery.matches ? "" : fullPlaceholder;
    }
    sync();
    if (mobileQuery.addEventListener) {
      mobileQuery.addEventListener("change", sync);
    } else if (mobileQuery.addListener) {
      mobileQuery.addListener(sync); // Safari < 14
    }
  }

  // Returns a toast(msg) function bound to toastEl, each call resetting
  // its own auto-hide timer. A factory (not a single module-level
  // function) so each page's timer state stays private to its own
  // toast element rather than living here as shared mutable state —
  // harmless in practice since only one of app.js/research.js ever runs
  // on a given page, but keeps this file itself free of page state.
  function createToast(toastEl) {
    var timer = null;
    return function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout(timer);
      timer = setTimeout(function () {
        toastEl.classList.remove("show");
      }, 1900);
    };
  }

  window.SharedUI = {
    esc: esc,
    norm: norm,
    safeUrl: safeUrl,
    $: $,
    ICONS: ICONS,
    setupInfoTooltips: setupInfoTooltips,
    clearSearchPlaceholderOnMobile: clearSearchPlaceholderOnMobile,
    createToast: createToast,
  };
})();
