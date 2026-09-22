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
    close:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  };

  // Info-tooltip open/close (e.g. the Policy Menu's Match all/any info
  // button, Research Resources' "Is it still online" info button):
  // :hover/:focus-visible in CSS already reveal a .tooltip for mouse and
  // keyboard; touch has no :hover, so a tap needs to explicitly open
  // *and* close it. Delegated across every .info-btn on the page (more
  // than one on some pages) — a page with just one behaves identically,
  // delegation just costs nothing extra there.
  //
  // The nav tab tooltips (.nav-item-wrap) deliberately do NOT get this
  // tap-to-toggle treatment, unlike .info-btn: a .nav-item-wrap's <a> is
  // a real navigation link, not a decorative disclosure button, so
  // intercepting its first tap to show the tooltip instead of navigating
  // would force a tap-tap-to-navigate on touch — a broken nav for
  // something that should behave like a plain link. On touch, tapping a
  // nav tab navigates immediately with no tooltip step; the tooltip
  // there is hover-only (desktop mouse) plus :focus-visible (keyboard),
  // both handled entirely by CSS with no JS involvement.
  function setupInfoTooltips() {
    function closeAllExcept(keep) {
      document.querySelectorAll(".info-btn.info-open").forEach(function (b) {
        if (b !== keep) b.classList.remove("info-open");
      });
    }

    document.querySelectorAll(".info-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var wasOpen = btn.classList.contains("info-open");
        closeAllExcept(null);
        if (!wasOpen) btn.classList.add("info-open");
      });
    });

    document.addEventListener("click", function () {
      closeAllExcept(null);
    });
  }

  // Feedback/signup popup — shown once, ~45s after page load, unless
  // already dismissed this session. Originally Policy-Menu-only (lived
  // in app.js), now shared verbatim with Research Resources: the modal
  // has no dependency on either page's dataset/filtering state, only on
  // a fixed set of element IDs (feedback-modal-backdrop and friends —
  // see the markup comment in index.html/research-resources.html) that
  // both pages' HTML now defines identically, so this is a genuine
  // page-agnostic UI helper like setupInfoTooltips/createToast above
  // rather than something that needs to live in app.js or research.js.
  // storageKey is the one thing callers must pass distinctly per page
  // (e.g. "feedbackModalDismissed" for Policy Menu,
  // "feedbackModalDismissedResearch" for Research Resources) so
  // dismissing the popup on one page never suppresses it on the other —
  // see each page's own boot()/setup call site.
  function setupFeedbackModal(storageKey) {
    try {
      // Guarded on its own: some browsers' stricter privacy modes throw
      // on sessionStorage access entirely rather than just returning
      // null, which would otherwise trip the outer catch below and
      // silently cancel the popup before it ever got a chance to
      // schedule its timer. Defaulting to "not dismissed" here means it
      // still shows in that case — it just won't remember being
      // dismissed across reloads, same fallback dismiss() already uses.
      var alreadyDismissed = false;
      try {
        alreadyDismissed = !!sessionStorage.getItem(storageKey);
      } catch (e) {
        /* storage blocked/unavailable */
      }
      if (alreadyDismissed) return;

      var backdrop = document.getElementById("feedback-modal-backdrop");
      var closeBtn = document.getElementById("feedback-modal-close");
      var closeIcon = document.getElementById("feedback-modal-close-icon");
      var link = document.getElementById("feedback-modal-link");
      var signupLink = document.getElementById("feedback-modal-signup-link");
      if (!backdrop || !closeBtn || !link) return;

      if (closeIcon) closeIcon.innerHTML = ICONS.close;

      var dismissed = false;
      var lastFocused = null;

      function onKeydown(e) {
        if (e.key === "Escape") dismiss();
      }

      function dismiss() {
        if (dismissed) return;
        dismissed = true;
        try {
          sessionStorage.setItem(storageKey, "1");
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
      if (signupLink) signupLink.addEventListener("click", dismiss);
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) dismiss();
      });

      setTimeout(function () {
        if (dismissed || sessionStorage.getItem(storageKey)) return;
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
      }, 45000);
    } catch (e) {
      // Never let a feedback-popup issue affect the rest of the page —
      // still logged (not thrown/shown to the visitor) so a real
      // problem is visible in devtools instead of just silently never
      // showing the popup with no trace of why.
      if (typeof console !== "undefined" && console.error) {
        console.error("Feedback popup failed to set up:", e);
      }
    }
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
    setupFeedbackModal: setupFeedbackModal,
    clearSearchPlaceholderOnMobile: clearSearchPlaceholderOnMobile,
    createToast: createToast,
  };
})();
