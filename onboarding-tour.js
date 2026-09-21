// First-time-visitor onboarding: a "New here?" prompt (5s after load,
// sessionStorage-gated) that offers a step-by-step guided tour of the
// filters and the two curated-resource shortcuts, then continues onto
// a second leg on the Research Resources page. Entirely self-contained
// — own storage keys, own element lookups, own try/catch — so it can
// never interfere with setupFeedbackModal in app.js (separate
// sessionStorage key, separate timer, no shared state, no calls into
// app.js/research.js at all). Loaded on both index.html and
// research-resources.html; IS_RESEARCH_PAGE below picks which page's
// step list and entry behavior apply.
(function () {
  var STORAGE_KEY = "onboardingTourSeen";
  // One-shot cross-page handoff: set right before navigating away from
  // the Policy Menu's own last (crossPage) step, read (and immediately
  // cleared) on the very next page load here. This sessionStorage key
  // is the *entire* mechanism carrying "the tour is mid-way, resume at
  // step N" across the navigation — nothing else does. If tour steps
  // are ever reordered, whatever step index gets written here (see the
  // "Next" handler's crossPage branch below) must still line up with
  // TOUR_STEPS_RESEARCH's own step 0 (or wherever a future crossPage
  // step is meant to resume) on the receiving page.
  var RESUME_KEY = "onboardingTourResume";
  var PROMPT_DELAY_MS = 5000;

  // #rr-grid only exists on research-resources.html — a page marker
  // that's already there rather than adding a new one just for this.
  var IS_RESEARCH_PAGE = !!document.getElementById("rr-grid");

  // Targets matched by selector against the live DOM (not cached), since
  // #quick-read-toggle only becomes visible once app.js resolves a
  // quick-read resource for the day's data — see the steps filter in
  // runTour() below, which drops any step whose target isn't there or
  // visible yet.
  var TOUR_STEPS_POLICY = [
    {
      selector: ".filter-bar-tags",
      text: "Use the Type and Organization filters to narrow the resource list down to specific resource types and specific organizations."
    },
    {
      selector: "#start-here-toggle",
      text: "A curated set of resources for people just getting started with policy engagement."
    },
    {
      selector: "#quick-read-toggle",
      text: "Jumps straight to the Federal Register, pre-filtered so you can act fast without digging."
    },
    {
      selector: '.site-nav a[href="research-resources.html"]',
      text: "There's also a companion Research Resources page: data sources, databases, and tools for environmental health research. This page covers policy and advocacy resources; Research Resources covers the data behind that work. Click Continue to see it.",
      crossPage: "research-resources.html"
    }
  ];

  // research-resources.html's own leg of the tour, resumed here after
  // the crossPage step above. ".status-badge" matches whichever card
  // happens to render first — always a real, valid example of the
  // thing being described, so no dedicated id is needed just for this.
  var TOUR_STEPS_RESEARCH = [
    {
      selector: "#rr-searchbox",
      text: "Search across resource names, creators, descriptions, and topics."
    },
    {
      selector: "#rr-filter-bar",
      text: "Filter by whether a resource is still live, its Type, or its Creator using these pill rows. Click a pill to filter, click it again to remove it."
    },
    {
      selector: ".status-badge",
      text: "Each card shows whether the original source is still online. See the info icon next to \"Is it still online?\" above: an offline resource often still has its data available through an archived mirror."
    },
    {
      selector: "#rr-random",
      text: "Not sure where to start? This picks a random resource from whatever's currently filtered."
    }
  ];

  var TOUR_STEPS = IS_RESEARCH_PAGE ? TOUR_STEPS_RESEARCH : TOUR_STEPS_POLICY;

  function markSeen() {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch (e) {
      // private browsing / storage disabled — same acceptable fallback
      // as the feedback popup: it just won't stay dismissed past this
      // page load.
    }
  }

  function alreadySeen() {
    try {
      return !!sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return false;
    }
  }

  /* ---------------- "New here?" prompt ---------------- */

  function setupPrompt() {
    var backdrop = document.getElementById("onboarding-modal-backdrop");
    var yesBtn = document.getElementById("onboarding-modal-yes");
    var noBtn = document.getElementById("onboarding-modal-no");
    if (!backdrop || !yesBtn || !noBtn) return;

    var shown = false;
    var lastFocused = null;

    function hidePrompt() {
      backdrop.classList.remove("show");
      setTimeout(function () {
        backdrop.hidden = true;
      }, 220);
      document.removeEventListener("keydown", onKeydown);
      if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus();
      }
    }

    function onKeydown(e) {
      if (e.key === "Escape") dismiss();
    }

    function dismiss() {
      if (!shown) return;
      shown = false;
      markSeen();
      hidePrompt();
    }

    function accept() {
      if (!shown) return;
      shown = false;
      markSeen();
      hidePrompt();
      startTour();
    }

    noBtn.addEventListener("click", dismiss);
    yesBtn.addEventListener("click", accept);
    // Clicking the dimmed backdrop itself (outside the card) counts as
    // "no thanks" here — unlike the tour below, this is a plain
    // yes/no prompt with no in-progress steps to accidentally lose.
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) dismiss();
    });

    setTimeout(function () {
      if (alreadySeen()) return;
      shown = true;
      lastFocused = document.activeElement;
      backdrop.hidden = false;
      // Double rAF so the pre-transition state actually paints before
      // .show flips the opacity — same reasoning as setupFeedbackModal.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          backdrop.classList.add("show");
        });
      });
      document.addEventListener("keydown", onKeydown);
      yesBtn.focus();
    }, PROMPT_DELAY_MS);
  }

  /* ---------------- guided tour ---------------- */

  function startTour(startIndex) {
    try {
      runTour(startIndex);
    } catch (e) {
      // Never let a tour bug strand the visitor mid-page — log it
      // (visible in devtools) rather than throw it into an unhandled
      // event-listener rejection.
      if (typeof console !== "undefined" && console.error) {
        console.error("Guided tour failed to start:", e);
      }
    }
  }

  function runTour(startIndex) {
    var overlay = document.getElementById("tour-overlay");
    var highlight = document.getElementById("tour-highlight");
    var tooltip = document.getElementById("tour-tooltip");
    var stepCountEl = document.getElementById("tour-step-count");
    var textEl = document.getElementById("tour-tooltip-text");
    var backBtn = document.getElementById("tour-back");
    var skipBtn = document.getElementById("tour-skip");
    var nextBtn = document.getElementById("tour-next");
    var closeBtn = document.getElementById("tour-close");
    if (
      !overlay || !highlight || !tooltip || !stepCountEl || !textEl ||
      !backBtn || !skipBtn || !nextBtn || !closeBtn
    ) {
      return;
    }

    // Only steps whose target actually exists and is visible right now.
    // (In practice all three are resolved by the time anyone can click
    // "Yes, show me" — the prompt itself waits 5s, and the quick-read
    // button's visibility is settled well before that — but this keeps
    // the tour honest instead of pointing at a hidden/missing element
    // in the rare case it isn't.)
    var steps = TOUR_STEPS.filter(function (step) {
      var target = document.querySelector(step.selector);
      return !!(target && !target.hidden && target.offsetParent !== null);
    });
    if (!steps.length) return;

    // Clamped against the *filtered* list, not raw TOUR_STEPS indices,
    // so a resumed tour still lands somewhere valid even if a step got
    // dropped above (missing/hidden target).
    var index = Math.min(Math.max(startIndex || 0, 0), steps.length - 1);
    var lastFocused = document.activeElement;
    var repositionPending = false;

    function currentTarget() {
      return document.querySelector(steps[index].selector);
    }

    function onViewportChange() {
      if (repositionPending) return;
      repositionPending = true;
      requestAnimationFrame(function () {
        repositionPending = false;
        place();
      });
    }

    // Positions the highlight cutout over the target and the tooltip
    // near it, picking whichever side (bottom/top/right/left, in that
    // preference order) actually has room, then clamping the result to
    // stay fully on-screen regardless of viewport size or orientation.
    function place() {
      var target = currentTarget();
      if (!target) {
        next();
        return;
      }
      var rect = target.getBoundingClientRect();
      var pad = 6;
      highlight.style.top = rect.top - pad + "px";
      highlight.style.left = rect.left - pad + "px";
      highlight.style.width = rect.width + pad * 2 + "px";
      highlight.style.height = rect.height + pad * 2 + "px";

      var margin = 14;
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var tw = tooltip.offsetWidth;
      var th = tooltip.offsetHeight;

      var fits = {
        bottom: vh - rect.bottom - pad >= th + margin,
        top: rect.top - pad >= th + margin,
        right: vw - rect.right - pad >= tw + margin,
        left: rect.left - pad >= tw + margin
      };
      var order = ["bottom", "top", "right", "left"];
      var placement = null;
      for (var i = 0; i < order.length; i++) {
        if (fits[order[i]]) {
          placement = order[i];
          break;
        }
      }
      if (!placement) {
        // Nothing fully fits (a very small or oddly-shaped viewport) —
        // fall back to whichever side has the most room and let the
        // edge clamp below keep it on-screen.
        var space = {
          bottom: vh - rect.bottom,
          top: rect.top,
          right: vw - rect.right,
          left: rect.left
        };
        placement = order.reduce(function (a, b) {
          return space[b] > space[a] ? b : a;
        });
      }

      var top, left;
      if (placement === "bottom") {
        top = rect.bottom + margin;
        left = rect.left + rect.width / 2 - tw / 2;
      } else if (placement === "top") {
        top = rect.top - margin - th;
        left = rect.left + rect.width / 2 - tw / 2;
      } else if (placement === "right") {
        left = rect.right + margin;
        top = rect.top + rect.height / 2 - th / 2;
      } else {
        left = rect.left - margin - tw;
        top = rect.top + rect.height / 2 - th / 2;
      }

      var edge = 10;
      left = Math.min(Math.max(left, edge), vw - tw - edge);
      top = Math.min(Math.max(top, edge), vh - th - edge);

      tooltip.style.top = top + "px";
      tooltip.style.left = left + "px";
      tooltip.setAttribute("data-placement", placement);
    }

    // Smoothly scrolls a target into view before measuring/placing
    // against it, so a step whose element starts off-screen (or was
    // reached by scrolling on mobile) never gets a tooltip pinned to
    // stale, off-screen coordinates. Prefers the 'scrollend' event where
    // supported; falls back to a fixed delay approximating scrollIntoView's
    // own animation elsewhere (e.g. Safari, which lacked 'scrollend'
    // until recently).
    function scrollToTarget(target, cb) {
      var rect = target.getBoundingClientRect();
      var inView =
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth;
      if (inView) {
        cb();
        return;
      }
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        window.removeEventListener("scrollend", finish);
        cb();
      }
      var fallback = setTimeout(finish, 500);
      function finishAndClearFallback() {
        clearTimeout(fallback);
        finish();
      }
      if ("onscrollend" in window) {
        window.addEventListener("scrollend", finishAndClearFallback, { once: true });
      }
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }

    function render() {
      var step = steps[index];
      stepCountEl.textContent = index + 1 + " of " + steps.length;
      textEl.textContent = step.text;
      backBtn.hidden = index === 0;
      // The crossPage step isn't really "the end" — it continues on the
      // next page — so it gets its own label rather than "Got it" even
      // though it's the last entry in TOUR_STEPS_POLICY.
      nextBtn.textContent = step.crossPage
        ? "Continue"
        : index === steps.length - 1
        ? "Got it"
        : "Next";

      var target = currentTarget();
      scrollToTarget(target, function () {
        place();
        // Re-measure one more frame out — tooltip's own offsetWidth/
        // Height above can still be mid-reflow the instant textEl's
        // content just changed, particularly on the very first step.
        requestAnimationFrame(place);
      });
    }

    function next() {
      var step = steps[index];
      if (step.crossPage) {
        // The entire cross-page handoff: write where the next page
        // should resume, then hand off via a normal navigation — no
        // local end()/render() here, the page unload takes over.
        try {
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({ step: 0 }));
        } catch (e) {
          // private browsing / storage disabled — the tour just won't
          // resume on the next page, same acceptable fallback used
          // elsewhere in this file.
        }
        window.location.href = step.crossPage;
        return;
      }
      if (index >= steps.length - 1) {
        end();
        return;
      }
      index += 1;
      render();
    }

    function back() {
      if (index === 0) return;
      index -= 1;
      render();
    }

    function end() {
      markSeen();
      overlay.classList.remove("show");
      setTimeout(function () {
        overlay.hidden = true;
      }, 220);
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      backBtn.removeEventListener("click", back);
      skipBtn.removeEventListener("click", end);
      nextBtn.removeEventListener("click", next);
      closeBtn.removeEventListener("click", end);
      if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus();
      }
    }

    function onKeydown(e) {
      if (e.key === "Escape") end();
    }

    backBtn.addEventListener("click", back);
    skipBtn.addEventListener("click", end);
    nextBtn.addEventListener("click", next);
    closeBtn.addEventListener("click", end);
    document.addEventListener("keydown", onKeydown);
    // Reposition on scroll (capture, so it also catches scrolling inside
    // an inner scrollable container, not just the window) and on
    // resize/orientation change, throttled to one recalculation per
    // frame. No click handler is attached to the overlay backdrop
    // itself — see the CSS comment on .tour-overlay for why tapping
    // outside the tooltip is intentionally inert.
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);

    overlay.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add("show");
      });
    });
    render();
  }

  // Reads and immediately clears the cross-page resume flag — one-shot,
  // so a later, unrelated reload of this page never re-triggers the
  // tour just because a stale flag was left behind.
  function readResumeStep() {
    try {
      var raw = sessionStorage.getItem(RESUME_KEY);
      sessionStorage.removeItem(RESUME_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return typeof data.step === "number" ? data.step : 0;
    } catch (e) {
      return null;
    }
  }

  // Waits for research.js's fetch to finish rendering real cards (not
  // just the loading skeleton) before starting the tour, since one step
  // targets ".status-badge" — a resumed tour landing here right after
  // navigation would otherwise almost always race that fetch. Falls
  // back to just calling cb() after timeoutMs regardless (the existing
  // per-step visibility filter in runTour() already drops a step whose
  // target never showed up, so this never hangs the tour, just possibly
  // starts it one step short in the rare case the fetch is unusually
  // slow or fails).
  function whenResearchCardsReady(cb, timeoutMs) {
    var grid = document.getElementById("rr-grid");
    if (!grid || grid.querySelector(".card")) {
      cb();
      return;
    }
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      cb();
    }
    var observer = new MutationObserver(function () {
      if (grid.querySelector(".card")) finish();
    });
    observer.observe(grid, { childList: true });
    var timer = setTimeout(finish, timeoutMs || 4000);
  }

  try {
    if (IS_RESEARCH_PAGE) {
      // This page never shows its own "New here?" prompt — the tour
      // only ever reaches here via the Policy Menu's crossPage step. A
      // second independent prompt+timer here would duplicate this
      // whole file's entry logic for a two-page tour that's only meant
      // to have one starting point; landing on this page directly (not
      // via the tour) just means no tour runs.
      var resumeStep = readResumeStep();
      if (resumeStep !== null) {
        whenResearchCardsReady(function () {
          startTour(resumeStep);
        });
      }
    } else if (!alreadySeen()) {
      setupPrompt();
    }
  } catch (e) {
    if (typeof console !== "undefined" && console.error) {
      console.error("Onboarding prompt failed to set up:", e);
    }
  }
})();
