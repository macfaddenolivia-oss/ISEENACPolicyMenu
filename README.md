# ISEE NAC Resource Menu

A searchable, filterable card-based library of resources for members of the
[International Society for Environmental Epidemiology – North America
Chapter's Policy Committee](https://www.isee-northamerica.org/policy.php).
Visitors can search, filter by Type/Subtype/Organization, and browse curated
starting points for environmental health advocacy.

Created and maintained by Olivia Macfadden and Ryan Dalforno.

**Live site:** [https://macfaddenolivia-oss.github.io/ISEENACPolicyMenu/](https://macfaddenolivia-oss.github.io/ISEENACPolicyMenu/)

---

## How the data works

Resources are **maintained in a Google Sheet**, published to the web as a live
CSV. The site fetches that published CSV directly at runtime (`CSV_PATH` in
`app.js`) — there is no local data file involved and no rebuild step.

**To edit a resource:** edit the Google Sheet directly. Changes appear on the
live site automatically once Google's publish cache refreshes, typically
within a few minutes. If you don't see an update, hard-refresh the page.

The Sheet is the single source of truth. Ask Ryan or Olivia for edit access if
you don't have it — the published (read-only) CSV endpoint the site consumes
is visible in `app.js`, but that's not the editable Sheet itself.

### How new resources get added

Community members suggest resources through a feedback survey, linked in the
site's footer and in the popup that appears ~60s after page load
(`setupFeedbackModal` in `app.js`). Ryan or Olivia periodically review
submissions and, for approved suggestions, manually add a row to the Google
Sheet. The new resource then shows up on the live dashboard automatically —
no code change needed.

---

## How the site is built

Plain HTML, CSS, and JavaScript — no framework, no build step, no
dependencies (no `npm install`, nothing to compile). The three files that
make up the app:

- `index.html` — markup and structure
- `styles.css` — styling
- `app.js` — CSV fetching/parsing, search, filtering, rendering

It's hosted on **GitHub Pages**, serving directly from this repo's `main`
branch at the live URL above. Pushing to `main` is the only deploy step.

## Local development

From the project root:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000/](http://localhost:8000/). A local server is
required — opening `index.html` directly from Finder won't work, since
browsers block the file read that would otherwise happen. Since the page
fetches resource data straight from the published Google Sheet, your local
copy always shows live data; there's nothing to seed or sync locally.

---

## Analytics

Basic traffic is tracked with [GoatCounter](https://www.goatcounter.com/),
loaded via a small script tag in `index.html`. The dashboard lives at
`isee-policy-menu.goatcounter.com` — ask Olivia or Ryan for access.

---

## Legacy / unused

`legacy-offline-build/` holds an earlier approach: a script that built a
single self-contained offline HTML file from a local CSV export of the
spreadsheet. That predates the switch to fetching resources live from the
published Google Sheet, and none of it is used by the live site today. It's
kept around (not deleted) in case the offline-file approach is ever needed
again — see the note at the top of `legacy-offline-build/build.py` for
details. Contents:

- `build.py` — builds `resources-app.html` (a self-contained, emailable copy)
- `xlsx_to_csv.py` — one-way export from `ListofResources.xlsx` to `resources.csv`
- `resources.csv` — working CSV, `build.py`'s input
- `resources-app.html` — last-generated output
