# ISEE NAC Resource Menu

A searchable, filterable card-based library of resources for members of the
[International Society for Environmental Epidemiology – North America
Chapter's Policy Committee](https://www.isee-northamerica.org/policy.php).
The site has two content pages:

- **Policy Menu** (`index.html`) — guides, legal resources, other databases,
  and advocacy tools for turning environmental health science into policy
  and action. This is the original page and the site's default/home page.
- **Research Resources** (`research-resources.html`) — databases, tools, and
  data sources to support environmental health research itself (the data
  behind the advocacy work, rather than the advocacy work). A companion page
  to the Policy Menu, not a replacement for it.

Both pages share the same search/filter/browse pattern (search, filter by
Type/Subtype/Topic/Organization, browse curated starting points) over their
own independent dataset. A third page, `privacy-policy.html`, explains the
site's analytics use and is linked from every page's footer.

Created and maintained by Olivia Macfadden and Ryan Dalforno.

**Live site:** [https://macfaddenolivia-oss.github.io/ISEENACPolicyMenu/](https://macfaddenolivia-oss.github.io/ISEENACPolicyMenu/)

---

## How the data works

Both pages are **maintained in the same Google Sheet**, but read different
**tabs** of it, each published to the web as its own live CSV:

| Page               | Sheet tab           | Fetched by            |
|---------------------|----------------------|------------------------|
| Policy Menu          | the original/first tab | `CSV_PATH` in `app.js` (no `gid` — Google's publish default tab) |
| Research Resources   | `Research_resources`  | `CSV_PATH` in `research.js` (`gid=1603679950`) |

The site fetches its published CSV directly at runtime on every page load —
there is no local data file involved and no rebuild/deploy step tied to data
changes.

**To edit a resource on either page:** edit that page's tab directly in the
Google Sheet (Policy Menu → the first tab; Research Resources →
`Research_resources`). Changes appear on the live site automatically once
Google's publish cache refreshes, typically within a few minutes. If you
don't see an update, hard-refresh the page. Editing the wrong tab is the most
likely way to "fix" the wrong page, so double-check which tab you're in
before saving.

The Sheet is the single source of truth for both datasets. Ask Ryan or Olivia
for edit access if you don't have it — the published (read-only) CSV
endpoints the site consumes are visible in `app.js`/`research.js`, but
that's not the editable Sheet itself.

### How new resources get added

Community members suggest resources through the same feedback survey on
either page, linked in that page's footer and in a popup that appears ~45s
after page load (`SharedUI.setupFeedbackModal` in `shared-ui.js` — shared
markup/behavior, called separately from `app.js` and `research.js` with
distinct sessionStorage keys so dismissing one page's popup doesn't dismiss
the other's). Both pages currently point at the same single survey form —
there's no separate Research-Resources-specific form yet. Ryan or Olivia
periodically review submissions and, for approved suggestions, manually add
a row to the relevant Sheet tab (first tab for Policy Menu,
`Research_resources` for Research Resources). The new resource then shows up
on the live site automatically — no code change needed.

---

## How the site is built

Plain HTML, CSS, and JavaScript — no framework, no build step, no
dependencies (no `npm install`, nothing to compile). The files that make up
the site:

- `index.html` — Policy Menu markup/structure
- `research-resources.html` — Research Resources markup/structure
- `privacy-policy.html` — static page explaining the GoatCounter analytics
  use described below; linked from every page's footer
- `styles.css` — styling for all three pages
- `app.js` — Policy Menu logic: CSV fetching/parsing, search, filtering,
  rendering
- `research.js` — Research Resources logic: its own CSV fetching/parsing,
  search, filtering, rendering
- `shared-ui.js` — page-agnostic UI helpers both `app.js` and `research.js`
  import (see below)
- `onboarding-tour.js` — the guided tour spanning both pages (see below)

### Why `app.js` and `research.js` are separate, non-communicating scripts

This is deliberate, not duplication that needs cleaning up. `app.js` and
`research.js` each own their own `CSV_PATH`, their own parsed dataset, and
their own DOM — neither script reads the other's data, state, or globals,
and neither is imported by the other. The point is to guarantee the two
datasets can never cross-contaminate: a bug in one page's filtering/rendering
logic can't leak the wrong page's resources onto the other, and editing one
script can't accidentally change the other page's behavior. Only
`index.html` loads `app.js`; only `research-resources.html` loads
`research.js`.

`shared-ui.js` is the deliberate exception: it holds logic that is genuinely
page-agnostic — meaning it never touches either page's dataset or filtering
state — like the info/nav-tab tooltip open/close behavior, clearing the
search placeholder on mobile, the shared icon set, the toast helper, and the
feedback/signup popup (`setupFeedbackModal`, parameterized by a per-page
sessionStorage key). Both `app.js` and `research.js` call into
`window.SharedUI` for this, so that UI plumbing isn't duplicated between
them. `privacy-policy.html` also loads `shared-ui.js` (for its nav tab
tooltips) even though it has no page-specific script of its own.

**Rule of thumb for future changes:** if it touches a dataset, a filter, or
either page's specific DOM, it belongs in `app.js` or `research.js`
respectively, never shared. If it's pure UI behavior with no data
dependency, it belongs in `shared-ui.js`.

### The guided tour (`onboarding-tour.js`)

A single shared file, loaded on both `index.html` and
`research-resources.html`, that shows a "New here?" prompt ~5s after load
(sessionStorage-gated) offering a step-by-step tour. Non-obvious behavior
worth knowing before touching this file:

- The tour can **start from either page** and always ends up covering both —
  it runs that page's own steps first, then hands off mid-tour to the other
  page (a real navigation, not a fake overlay), runs that page's steps, and
  finally returns to whichever page the tour was originally started from.
- The hand-off is a one-shot `sessionStorage` flag (`onboardingTourResume`)
  written right before navigating away and read/cleared on the very next
  load — it only remembers *which page the tour started on*, never a step
  index, so the two pages' step lists can be edited independently without
  getting out of sync.
- Popup-dismissal suppression is intentionally asymmetric between the two
  pages: declining the tour on the Research Resources popup suppresses both
  pages' popups for the session, while declining it on the Policy Menu popup
  only suppresses that page's own popup. See the comment block at the top of
  `onboarding-tour.js` for the reasoning.
- It's entirely self-contained (own storage keys, own element lookups) and
  never calls into `app.js` or `research.js`, so it can't interfere with
  `setupFeedbackModal`'s own separate popup/timer.

## Local development

From the project root:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000/](http://localhost:8000/) for the Policy
Menu, or [http://localhost:8000/research-resources.html](http://localhost:8000/research-resources.html)
for Research Resources. A local server is required for either page —
opening the HTML files directly from Finder won't work, since browsers block
the file read that would otherwise happen. Since both pages fetch their data
straight from their own published Google Sheet tab, your local copy always
shows live data for both; there's nothing to seed or sync locally.

---

## New conventions worth knowing before extending the site

- **Type-tag hue coding.** Both `app.js` and `research.js` carry an
  identical `HUES` array (a fixed, well-spaced list of hue values) and
  deterministically assign each Type its own hue by first-seen order, so a
  given Type keeps the same color across re-renders. The two pages' Type
  vocabularies are independent, so the same hue can land on a different Type
  name on each page — the goal is per-page visual consistency (card stripes
  match their filter pills), not a single global Type-to-color mapping
  across pages.
- **The `--fs-*` type scale.** `styles.css` defines seven font-size custom
  properties on `:root` (`--fs-page-title` down to `--fs-meta`), each tied
  to what the text *is* (a page title, a card title, scannable label text,
  caption/meta text, etc.) rather than which element happens to render it.
  Two elements serving the same purpose share the same variable on both
  pages. When adding new UI text, reach for the existing variable that
  matches its purpose rather than a new literal px value — see the comment
  block above the variable definitions in `styles.css` for the full
  breakdown of what each tier is for.

---

## Analytics

Basic traffic is tracked with [GoatCounter](https://www.goatcounter.com/),
loaded via a small script tag present on all three pages (`index.html`,
`research-resources.html`, `privacy-policy.html`). The dashboard lives at
`isee-policy-menu.goatcounter.com` — ask Olivia or Ryan for access. See
`privacy-policy.html` for what's collected and what isn't.
