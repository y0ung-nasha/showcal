# Changelog

All notable changes ship here. Latest at the top. Dates are the day the
change went to `main` (auto-deploys to https://showcal.westindia.co within
~30 sec of push).

## 2026-07-14

### Daily data refresh automation + venue tracker workbook

- Added `.github/workflows/daily-pull.yml` — a scheduled GitHub Actions job
  (09:00 UTC daily, ≈3–4am Chicago) that runs `./pull.sh --enrich`,
  regenerates the coverage CSV, builds the tracker workbook, and **auto-pushes
  the refreshed `shows.json` + raw data to `main`** so Cloudflare redeploys.
  This is the one sanctioned automated pusher (consent given 2026-07-14); all
  other pushes stay manual. Also runnable on demand via the Actions tab.
- Added `make-tracker-xlsx.mjs` — builds a styled, multi-tab
  `venue-tracker.xlsx` (Summary + All Venues + Established / Configured–No Data
  / No Source, color-coded by status, clickable URLs). Companion to
  `coverage.mjs` (which stays the flat-CSV generator). `exceljs` is resolved
  via `NODE_PATH`, not vendored — the repo stays build-free. The `.xlsx` is
  gitignored (on-demand export / CI artifact, not tracked).
- Ran a fresh enriched pull: `shows.json` now 1,699 shows (2026-07-14 →
  2028-11-07), price/age enrichment refreshed, past-date drift cleared.
  Tracker snapshot: 99 established · 75 configured-no-data · 18 no-source.

### JSON-LD harvester: false-alarm cleanup

Investigated the "empty `data/jsonld-shows.json`" follow-up. The harvester
was never broken — a live run parses all 8 configured venues (243 shows).
`pull.sh` writes the harvest to `data/venue-site-shows.json`; the empty
`jsonld-shows.json` was a stale orphan left by the CLI's old default
`--out` path.

- Aligned the harvester's default `--out` to `./data/venue-site-shows.json`
  so bare runs and `pull.sh` agree and the orphan can't reappear.
- Deleted the stale `data/jsonld-shows.json`.
- Fixed the stale usage-comment example in `normalize.mjs`.
- Marked the follow-up resolved in `CLAUDE.md`, with a note that Cole's Bar's
  `--follow` detail crawl 404s harmlessly (listing page already carries full
  Event JSON-LD, so no shows are lost).

## 2026-07-13

Big session: the calendar page and venues page merged into a single React
SPA, one adapter bug fixed, and a mobile / accessibility polish pass.

### SPA merge (`a61c3fe`)

- The calendar and venues pages now live in one React SPA in `index.html`.
  Hash routes pick the entry mode: `#/` opens the calendar, `#/venues`
  opens the venues list.
- Both modes share a **column stack** shell. Clicking any show or venue
  pushes a new column onto the stage; the BACK bar returns to the starting
  state in one click (it doesn't step back through the stack — this is
  intentional).
- 2 columns visible on desktop, 1 on mobile. Older columns slide off to
  the left as new ones push in.
- `venues.html` is now a ~10-line redirect stub that bounces to `#/venues`,
  preserving the historical `/venues` URL. Do **not** put page logic in
  `venues.html` — everything belongs in the SPA.

### Do312 age-gate parsing (`b493062`)

Do312's `itemprop="price"` attribute is overloaded — the same field can
hold a dollar amount, `"Free"`, `"Sold Out"`, or an age gate like
`"18 & Over"` or `"All Ages"`. Age-shaped titles were previously being
dropped as unparseable prices, losing the age signal entirely.

- `NN+` / `NN & Over` now lands in `age` as `"NN+"`.
- `All Ages` now lands in `age` as `"ALL AGES"`.
- Existing FREE / numeric price parsing paths are unchanged.
- Raw title values are HTML-entity-decoded before parsing (so
  `"18 &amp; Over"` matches the same as `"18 & Over"`).

### Pipeline data refresh (`813b2f2`)

Rerun of `pull.sh` — new `shows.json` plus updated raw source files.
Includes the age-gate fix above, so more shows now carry a proper `age`.

### Audit fixes: mobile, accessibility, dead facet (`1a2cebd`)

Small polish pass following a codebase audit.

**Functional**
- Hide the PLAYING slot in the mad-lib when only one distinct genre is
  present for the day. Every upstream artist currently carries
  `genre: "music"`, so the picker used to open a modal with a single
  option and no purpose. Now the slot simply doesn't render.
- The picker modal closes on **Escape**.

**Mobile**
- Fix iOS Safari bottom-clip: `html`/`body`/`#root` now use `100vh` with a
  `100dvh` override where supported, so the dynamic URL-bar chrome doesn't
  crop the app.
- Cap the show-detail poster at `max-height:45vh` so it stops dominating
  the fold on phones.
- Mad-lib filter on narrow screens (≤ 480px) now hides the connective
  lex words ("SHOWS IN", "PLAYING", "FOR") that were wrapping across
  four or five lines.
- Detail-facts row (Date/Time/Ages/Price) tightens padding + shrinks the
  display font on ≤ 400px so "ALL AGES" and long dates stop clipping.

**Touch + layout consistency**
- Bump `.chip` and `.slot` vertical padding (3px → 7px) for a friendlier
  tap target.
- Nest list-row tags inside a `.row .tags` container so the pill (price +
  age) stays right-aligned even when tags wrap to a new line.
- Remove pointless `.wordmark { gap:0 }`.

### Housekeeping

- `CLAUDE.md` gained a **Known follow-ups** section documenting threads
  left open by this session (empty `data/jsonld-shows.json`, sparse
  `venue-details.json`, missing venue hoods, past-shows drift), plus a
  babel-parse workflow for sanity-checking React edits.
- `chicago-show-calendar.jsx` is now explicitly documented as a stale
  mirror of the pre-SPA code. Do not sync it; leave it alone or delete
  when convenient.
