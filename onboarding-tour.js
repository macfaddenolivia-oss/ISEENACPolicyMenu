// First-time-visitor onboarding: a "New here?" prompt (5s after load,
// sessionStorage-gated) that offers a step-by-step guided tour. Both
// pages show this popup — subject to the asymmetric suppression rules
// in shouldPrompt() below — and it's the only entry point into the
// tour on either page. The tour itself always covers both the Policy
// Menu and Research Resources, just in whichever order matches where
// it was started. Entirely self-contained — own storage keys, own
// element lookups, own try/catch — so it can never interfere with
// setupFeedbackModal in app.js (separate sessionStorage key, separate
// timer, no shared state, no calls into app.js/research.js at all).
// Loaded on both index.html and research-resources.html.
(function () {
  // Three sessionStorage keys, each meaning something distinct — this
  // used to be one shared "seen" flag, but the popup's suppression
  // rules are asymmetric between the two pages (see shouldPrompt()
  // below), so a single flag can no longer represent all of it:
  //
  // - ACCEPTED_KEY: the tour was actually started (prompt accepted) on
  //   EITHER page. Once true, neither page's prompt shows again this
  //   session — this is the one truly shared, symmetric flag, matching
  //   the tour's existing "fully seen" behavior.
  // - DISMISSED_KEY.policy / DISMISSED_KEY.research: the *popup* (not
  //   an in-progress tour) was closed/declined on that specific page
  //   without starting the tour. Dismissing the Policy Menu's popup
  //   only suppresses that page's own popup; dismissing Research
  //   Resources' popup suppresses BOTH pages' popups for the rest of
  //   the session (and also drops Policy Menu's step from any tour
  //   later started on Research Resources — see buildSteps). This
  //   asymmetry is intentional, not a bug: declining on the primary
  //   (Policy Menu) page doesn't rule out the secondary page's own,
  //   narrower ask; declining on the secondary page is read as "not
  //   interested in a tour" more broadly.
  //
  // Skipping/closing an *in-progress* tour is unrelated to any of this
  // — see end()'s own markAccepted() call, which already covers that
  // case as "engaged with," not "dismissed."
  var ACCEPTED_KEY = "onboardingTourAccepted";
  var DISMISSED_KEY = { policy: "onboardingTourDismissedPolicy", research: "onboardingTourDismissedResearch" };
  // One-shot cross-page handoff: written right before navigating away
  // from whichever page's own last (crossPage) step, read (and
  // immediately cleared) on the very next page load here. Only carries
  // *which page the tour started on* — never a step index. The
  // receiving page always resumes at the top of its own CORE_STEPS_*
  // list (see buildSteps below), so there is nothing list-length- or
  // order-dependent to get wrong here, and nothing to keep in sync if a
  // step list is ever edited. startedOn also doubles as "where to
  // navigate back to" once the tour ends — see end()'s returnTo.
  var RESUME_KEY = "onboardingTourResume";
  var PROMPT_DELAY_MS = 5000;

  // #rr-grid only exists on research-resources.html — a page marker
  // that's already there rather than adding a new one just for this.
  var IS_RESEARCH_PAGE = !!document.getElementById("rr-grid");
  var PAGE_ID = IS_RESEARCH_PAGE ? "research" : "policy";
  var PAGE_URL = { policy: "index.html", research: "research-resources.html" };

  // Each page's own steps, independent of which direction the tour is
  // running — reused as-is in both directions (see buildSteps below),
  // never copied. Targets matched by selector against the live DOM (not
  // cached), since e.g. #quick-read-toggle only becomes visible once
  // app.js resolves a quick-read resource for the day's data — see the
  // steps filter in runTour() below, which drops any step whose target
  // isn't there or visible yet.
  var CORE_STEPS_POLICY = [
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
    }
  ];

  // ".status-badge" matches whichever card happens to render first —
  // always a real, valid example of the thing being described, so no
  // dedicated id is needed just for this.
  var CORE_STEPS_RESEARCH = [
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

  var CORE_STEPS = { policy: CORE_STEPS_POLICY, research: CORE_STEPS_RESEARCH };

  // The one step whose content genuinely differs by direction — pointing
  // at "the other page" necessarily means different text/target depending
  // on which page that is. Appended only to a *first-leg* run (see
  // buildSteps), never to a resumed second leg.
  var CROSS_PAGE_STEP = {
    policy: {
      selector: '.site-nav a[href="research-resources.html"]',
      text: "There's also a companion Research Resources page: data sources, databases, and tools for environmental health research. This page covers policy and advocacy resources; Research Resources covers the data behind that work. Click Continue to see it.",
      crossPage: "research-resources.html"
    },
    research: {
      selector: '.site-nav a[href="index.html"]',
      text: "There's also the Policy Menu: guides, legal resources, and advocacy tools for turning environmental health science into policy and action. Click Continue to see it.",
      crossPage: "index.html"
    }
  };

  // isFirstLeg: true for a fresh start (append this page's crossPage
  // step so "Continue" hands off to the other page); false when resuming
  // as the second leg (just this page's own steps, ending the tour).
  // On Research Resources specifically, if the Policy Menu's popup was
  // already declined this session, the crossPage step is dropped even
  // on a first-leg run — the tour stays scoped to this page rather than
  // looping into a page whose tour was already turned down.
  function buildSteps(isFirstLeg) {
    var steps = CORE_STEPS[PAGE_ID].slice();
    var appendCrossPage = isFirstLeg;
    if (appendCrossPage && IS_RESEARCH_PAGE && isDismissed("policy")) {
      appendCrossPage = false;
    }
    if (appendCrossPage) steps.push(CROSS_PAGE_STEP[PAGE_ID]);
    return steps;
  }

  function markAccepted() {
    try {
      sessionStorage.setItem(ACCEPTED_KEY, "1");
    } catch (e) {
      // private browsing / storage disabled — same acceptable fallback
      // as the feedback popup: it just won't stay dismissed past this
      // page load.
    }
  }

  function isAccepted() {
    try {
      return !!sessionStorage.getItem(ACCEPTED_KEY);
    } catch (e) {
      return false;
    }
  }

  function markDismissed(pageId) {
    try {
      sessionStorage.setItem(DISMISSED_KEY[pageId], "1");
    } catch (e) {
      // private browsing / storage disabled — same fallback as above.
    }
  }

  function isDismissed(pageId) {
    try {
      return !!sessionStorage.getItem(DISMISSED_KEY[pageId]);
    } catch (e) {
      return false;
    }
  }

  // Whether THIS page's own popup is allowed to show right now — see
  // the DISMISSED_KEY comment above for why Research Resources' own
  // dismissal reaches back to suppress the Policy Menu's popup too, but
  // not the other way around.
  function shouldPrompt() {
    if (isAccepted()) return false;
    if (isDismissed(PAGE_ID)) return false;
    if (!IS_RESEARCH_PAGE && isDismissed("research")) return false;
    return true;
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
      markDismissed(PAGE_ID);
      hidePrompt();
    }

    function accept() {
      if (!shown) return;
      shown = false;
      markAccepted();
      hidePrompt();
      beginTour();
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
      if (!shouldPrompt()) return;
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

  function startTour(returnTo) {
    try {
      runTour(returnTo);
    } catch (e) {
      // Never let a tour bug strand the visitor mid-page — log it
      // (visible in devtools) rather than throw it into an unhandled
      // event-listener rejection.
      if (typeof console !== "undefined" && console.error) {
        console.error("Guided tour failed to start:", e);
      }
    }
  }

  // returnTo: omitted/falsy for a fresh, first-leg start (this page's
  // own steps, then a crossPage step handing off to the other page).
  // Given a page id ("policy"/"research"), this run is the *second*
  // leg, resumed here after that handoff — just this page's own steps,
  // no crossPage step, and end() (below) navigates back to returnTo
  // once the tour finishes or is exited, by any means.
  function runTour(returnTo) {
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
    // (In practice they're all resolved by the time anyone can reach
    // them — both pages' cards are explicitly waited for via
    // whenGridHasCards below — but this keeps the tour honest instead
    // of pointing at a hidden/missing element in the rare case one
    // isn't.)
    var steps = buildSteps(!returnTo).filter(function (step) {
      var target = document.querySelector(step.selector);
      return !!(target && !target.hidden && target.offsetParent !== null);
    });
    if (!steps.length) {
      // Nothing to show on this leg — still honor a pending return trip
      // rather than silently stranding the visitor on the wrong page.
      if (returnTo) window.location.href = PAGE_URL[returnTo];
      return;
    }

    // Always the top of the list just built above — a resumed (second)
    // leg gets its own fresh steps array starting at 0, never an index
    // carried over from the other page, so there's nothing to keep in
    // sync if a step list's order or length ever changes.
    var index = 0;
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
      // other page — so it gets its own label rather than "Got it" even
      // though it's the last entry in a first-leg run's steps.
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
        // The entire cross-page handoff: record which page THIS leg ran
        // on (so the other page knows where to eventually return),
        // then hand off via a normal navigation — no local end()/
        // render() here, the page unload takes over. Only ever reached
        // on a first-leg run — buildSteps() never appends a crossPage
        // step to a resumed (returnTo-having) run — so PAGE_ID here is
        // always the tour's true starting page.
        try {
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({ startedOn: PAGE_ID }));
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
      markAccepted();
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
      // Reached by finishing the last step normally OR by an early exit
      // (Skip/Close/Escape) — same return-trip rule either way. Only a
      // second-leg run has a returnTo at all; a first-leg run exiting
      // (for any reason) while still on its own starting page needs no
      // extra navigation, so this is a no-op there.
      if (returnTo) {
        window.location.href = PAGE_URL[returnTo];
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
  // tour just because a stale flag was left behind. Returns the page id
  // ("policy"/"research") the tour originally started on, or null.
  function readResumeState() {
    try {
      var raw = sessionStorage.getItem(RESUME_KEY);
      sessionStorage.removeItem(RESUME_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && (data.startedOn === "policy" || data.startedOn === "research")
        ? data.startedOn
        : null;
    } catch (e) {
      return null;
    }
  }

  // Waits for either page's own script (app.js or research.js) to
  // finish its fetch and render real cards (not just the loading
  // skeleton) before starting the tour. Both pages have a step whose
  // target only exists/unhides once that fetch resolves — Research
  // Resources' ".status-badge" (only renders inside a real card), and
  // the Policy Menu's own "#quick-read-toggle" (starts with the static
  // `hidden` attribute in the HTML; app.js's start() — called only
  // after its fetch resolves — is what clears it). A *resumed* (second-
  // leg) tour starts immediately on page load with no user-driven
  // delay to mask the race, unlike a fresh first-leg start via the 5s-
  // delayed prompt — that's what let this go unnoticed on the Policy
  // Menu side: #quick-read-toggle was still hidden when the resumed
  // tour's per-step visibility filter ran, silently dropping it and
  // leaving only 2 of the Policy Menu's 3 core steps. Falls back to
  // just calling cb() after timeoutMs regardless (the existing per-step
  // visibility filter in runTour() already drops a step whose target
  // never showed up, so this never hangs the tour, just possibly starts
  // it short in the rare case the fetch is unusually slow or fails).
  function whenGridHasCards(gridId, cb, timeoutMs) {
    var grid = document.getElementById(gridId);
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

  // Single entry point for starting the tour on this page, fresh or
  // resumed — used by the "Yes, show me" prompt and the cross-page
  // resume below, so both go through the same data wait rather than
  // each remembering to.
  function beginTour(returnTo) {
    whenGridHasCards(IS_RESEARCH_PAGE ? "rr-grid" : "grid", function () {
      startTour(returnTo);
    });
  }

  try {
    var startedOn = readResumeState();
    if (startedOn) {
      // Second leg: resume this page's own steps, and return to
      // whichever page the tour began on once it ends — normally or
      // via an early exit — see end()'s returnTo handling.
      beginTour(startedOn);
    } else if (shouldPrompt()) {
      setupPrompt();
    }
  } catch (e) {
    if (typeof console !== "undefined" && console.error) {
      console.error("Onboarding prompt failed to set up:", e);
    }
  }
})();
