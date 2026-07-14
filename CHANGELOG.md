# Changelog

All notable changes ship here. Latest at the top. Dates are the day the
change went to `main` (auto-deploys to https://showcal.westindia.co within
~30 sec of push).

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
