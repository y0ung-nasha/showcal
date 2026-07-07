# Chicago Show Calendar — Claude notes

This file is the load-bearing onboarding doc for any Claude session that opens `~/Projects/showcal/`. Read it before doing anything.

## What this is

A single-page static calendar for Chicago live music, deployed at **https://showcal.westindia.co** (Cloudflare Pages, auto-deploys from GitHub `main`). The user maintains a curated master list of ~235 venues; a nightly pipeline scrapes several sources for their upcoming shows and drops the merged output at `shows.json` next to `index.html`. The frontend reads that one file.

**Live URL:** https://showcal.westindia.co
**GitHub:** https://github.com/y0ung-nasha/showcal
**Local:** `~/Projects/showcal/`

## Non-negotiable user rules

These are durable — every session inherits them. Do not break them without explicit permission.

1. **Never `git push` without explicit consent per push.** One prior approval doesn't carry forward — ask each time. Say "Ready locally at http://localhost:8080/ — say the word to push." after each meaningful change.
2. **Always pick the cheapest viable option** for tools, hosts, plans, dependencies. Free-tier > paid. Own scrapers > paid data APIs. Ask before committing to any recurring cost.
3. **Do not add the project back into iCloud.** iCloud has a history of corrupting `.git`. It lives at `~/Projects/showcal/` for a reason.

## Architecture in one paragraph

Two independent halves joined by one file. **Frontend**: `index.html` (React via CDN + Babel standalone — no build step) and `venues.html` (vanilla JS). Both fetch `shows.json` client-side. **Pipeline**: five Node scripts (`do312-adapter.mjs`, `jsonld-harvester.mjs`, `oneoff-adapter.mjs`, `askapunk-adapter.mjs`, `dice-adapter.mjs`) write raw output into `data/*.json`; `normalize.mjs` merges them with `venue-registry.json` as the master allow-list; anything not in the registry is dropped. `pull.sh` runs the whole pipeline end-to-end. Cloudflare Pages just serves the static files — nothing runs server-side.

```
[Do312 adapter]       ─┐
[JSON-LD harvester]   ─┤
[One-off scrapers]    ─┼→ data/*.json → [normalize.mjs] → shows.json ─→ [index.html]
[Ask A Punk (Gancio)] ─┤                        │                     ─→ [venues.html]
[DICE adapter]        ─┘                        ▲
                                    [venue-registry.json — master allow-list]
```

## Local dev

- **Node**: v26+ (via Homebrew).
- **Server**: `python3 -m http.server 8080`, then open http://localhost:8080/. Use `/index.html` and `/venues.html` explicitly locally — Python's server doesn't do the Cloudflare "clean URL" rewrites, so `/venues` (without extension) 404s locally but works on prod.
- **CDN dependency pins**: React and Babel URLs in `index.html` **must stay pinned** (`react@18.3.1`, `@babel/standalone@7.24.7`). The unpinned `@babel/standalone` URL now resolves to Babel 8, which emits ES modules and breaks the in-browser Babel setup — the whole app went blank when this happened. Don't unpin.

## Running the pipeline

```bash
./pull.sh              # fast: listing pages only (~2 min, no price/age enrichment)
./pull.sh --enrich     # full: adds per-event detail-page pass for price/age (~8-10 min)
```

Steps:
1. **Do312 harvest** — one HTTP fetch per venue in `do312-venues.json`, parses microdata event cards.
2. **JSON-LD (venue-site) harvest** — for venues that publish `schema.org/Event` on their own site (see `jsonld-venues.json`).
3. **One-off venue-site scrapers** — `oneoff-adapter.mjs`, ~21 bespoke parsers (Squarespace `?format=json`, Wix warmup-data, SpotHopper API, turntabletickets API, plain HTML) for venues with no aggregator coverage. Source id "venue-site" (top merge priority).
4. **Ask A Punk** — `askapunk-adapter.mjs`, Gancio JSON API at `chicago.askapunk.net/api/events`; covers DIY venues (Casa Cafe, Bricktown...). Off-list venues drop out in normalize.
5. **HTML entity decode** — `decode-entities.mjs` runs on venue-site + one-off output because sites emit `&#8217;` etc. inside strings.
6. **DICE browse** — fetches `dice.fm/browse/chicago-<id>` and parses `__NEXT_DATA__.pageProps.events`.
7. **Normalize** — merges all raw outputs, resolves against registry, drops off-list shows.
8. **Filter past** — drops shows with `date < today`.

## Data sources — status snapshot

| Adapter | Venues configured | Notes |
|---|---|---|
| Do312 | 162 | Primary source. `do312-venues.json`. Empty pages cost ~30s wasted per pull; kept anyway for future-proofing. Slug quirks: apostrophes → `-s-`, "&" dropped (`the-atlantic-bar-grill`), some renamed (`gold-star-bar`, `the-mine-music-hall`, `sovereign-liquors`, `illuminated-brew-works`, `necessary-and-sufficient-coffee`, `primary-night-club`, `workshop-4200`). |
| JSON-LD (venue site) | 8 | `jsonld-venues.json`. Venues that publish `schema.org/Event` on their own site (Sleeping Village, Andy's Jazz Club, Cole's Bar, etc.). |
| One-off scrapers | ~21 | `oneoff-adapter.mjs`. Per-venue parsers: Jazz Showcase (turntabletickets API), Rosa's (inline JSON-LD Place.Events), Buddy Guy's (RHP HTML), Garcia's (date from TM URL slug), Reggies Rock Club (`/venue/rock-club/`), Sound-Bar, Reed's Local (simcal microdata), Lee's/Le Piano (Wix warmup), Squarespace family (Joe's on Weed `/livemusic-events`, Punch House `/happenings`, Wild Hare `/lineup`, BlkRoom `/event-calendar`, IBW `/events`), The Atlantic (SpotHopper API spot 13541), text parses (Arbella `/music`, Beauty Bar `/events`). |
| Ask A Punk | city-wide | Gancio instance — clean JSON API. DIY punk/hardcore shows incl. Casa Cafe, Bricktown, Gold Star Bar. |
| DICE | city-wide | 30 curated events for Chicago via the browse page; all 12 type filters return the same 30. Per-venue pages (`dice.fm/venue/<slug>`) exist again but the ones checked were empty. |
| UChicago LiveWhale | ❌ | `events.uchicago.edu/live/json/events` works but search over-matches campus-wide — unusable per-building. Logan Center/Cobb Hall/Bond Chapel go through Do312. |
| Songkick | ❌ | 406 Not Acceptable — actively blocks scraping. Skip. |
| Bandsintown | ❌ | 403 Forbidden — Cloudflare blocks. Skip. |
| Etix direct | ❌ | HTTP 202 bot-challenge. Scrape the venue's own site instead (Buddy Guy's). |
| Ticketmaster API | ❌ | User has explicitly excluded it. Do not use even though Empty Bottle's widget hardcodes their API keys. (Reading TM URLs off a venue's own site for date/ticket-link fields is fine.) |

### Venues with no scrapeable source (documented, not a bug)
Closed: Golden Dagger (2023), Trace (remodel). IG-only: Wax, Sweethearts Bar, Cafe Modulaire, Los Globos, Giant Penny Whistle, Stardust Lounge. JS-only sites: TAO, Brudder's, Home Away From Home, Three Top Lounge. Not venues: Berwyn Stage (festival stage), 2153 W Irving Park Rd (rental hall), 868 N Franklin (private events). Full notes in `venue-coverage.csv` Notes column.

## Key files

**Root**
- `index.html` — calendar page (React via CDN + Babel standalone, one big self-contained file)
- `venues.html` — venues page (vanilla JS, 3-column sliding stage: list → venue → show)
- `shows.json` — the *only* live data file the frontend reads; git-tracked, updated by pull.sh
- `venue-registry.json` — 192-venue master allow-list (was 235; ~43 duplicate entries merged into canonical entries with `aliases` in July 2026); **any show at a venue not in this file is dropped**
- `venue-details.json` — hand-curated static content per venue id (blurb, facts, genres, notes); indexed by registry id
- `do312-venues.json`, `jsonld-venues.json` — adapter configs
- `venue-master-list.md` — the original ~190-venue plan doc (reference only, older than the registry)
- `sourcing-pipeline-plan.md` — the original 6-tier sourcing strategy (reference; several assumptions turned out wrong — see below)
- `venue-coverage.csv` — snapshot spreadsheet of which venues have working sources (per-venue status; regenerate on demand)

**Adapters + pipeline**
- `do312-adapter.mjs`, `jsonld-harvester.mjs`, `oneoff-adapter.mjs`, `askapunk-adapter.mjs`, `dice-adapter.mjs`, `tm-adapter.mjs` (unused per user directive), `normalize.mjs`, `decode-entities.mjs`, `pull.sh`
- `coverage.mjs` — regenerates `venue-coverage.csv` from registry + configs + shows.json
- `probe-venues.mjs` — fingerprints venue websites for scrapeable calendar tech (JSON-LD, platform signatures); feed it a TSV of `id<TAB>url`

**Data (raw)**
- `data/do312-shows.json`, `data/venue-site-shows.json`, `data/oneoff-shows.json`, `data/askapunk-shows.json`, `data/dice-shows.json` — raw adapter outputs, git-tracked so they diff cleanly and re-normalizing doesn't need re-fetching

## Non-obvious things I've learned

### The pipeline plan's original Tier assumptions didn't hold
- **Tier 1 (venue-site JSON-LD)** was supposed to be the backbone. In practice, most venue sites publish only `WebSite`/`LocalBusiness` JSON-LD, not `Event`. Only ~8 of ~230 venues probed had usable Event JSON-LD (Sleeping Village, Andy's Jazz Club, Cole's Bar, Winter's Jazz Club, Elastic Arts, Lee's Unleaded Blues, The Tonk, Carol's Pub).
- **Tier 2 (DICE)** — the original `dice.fm/venue/<slug>` URL pattern from `dice-venues.sample.json` is 100% dead. Current working pattern is the city browse page: `dice.fm/browse/chicago-5b238ca66e4bcd93783835b0` with `__NEXT_DATA__.pageProps.events`. Yields only 30 curated events, all filters return the same 30, no pagination.
- **Tier 3 (Do312)** — supposed to be the "breadth backfill" but turned out to be by far the strongest single source (152 venues, ~1500 shows). Use per-venue pages, parse microdata event cards (`itemtype="http://schema.org/Event"` blocks).

### Bot-UA gets blocked
`jsonld-harvester.mjs` and `dice-adapter.mjs` use a browser User-Agent (`Mozilla/5.0 (Macintosh...`). The original "ChicagoShowCalendarBot/0.1" UA returned 0-byte responses / 403s from most venue sites. **Do not revert.**

### macOS DNS cache
`curl` will fail with "Could not resolve host" for hostnames that were NXDOMAIN when the cache was populated, even after DNS propagates. `sudo dscacheutil -flushcache` or use `--resolve` explicitly.

### CF Pages "clean URLs"
`showcal.westindia.co/venues.html` 308-redirects to `.../venues`. In-app links use `/venues.html` for portability with local Python server.

### `python3 -m http.server` doesn't respect CF Pages rewrites
Locally, `/venues` 404s. Test with `.html` locally, unextensioned on prod.

## Common workflows

### Refresh data
```bash
cd ~/Projects/showcal && ./pull.sh --enrich
```

### Add a new venue to a Do312 harvest
1. Confirm it's on Do312: `curl -s https://do312.com/venues/<slug> | grep -c '"http://schema.org/Event"'`
2. Append to `do312-venues.json` with `{ id, name, hood, do312Url }`.
3. Run `./pull.sh`.

### Add a venue with JSON-LD on its own site
1. Test: `curl -sL <url> | grep -c 'application/ld+json'` — look for Event `@type`.
2. Append to `jsonld-venues.json` with `{ id, name, hood, url }` (and `eventPathIncludes` if events are on subpages, not homepage).
3. Run `./pull.sh`.

### Bulk-probe venues for JSON-LD
See how the code did it: read the probe scripts inline in earlier session output; or write a fresh one using `jsonld-harvester.mjs`'s `extractJsonLdBlocks` + `collectEvents` helpers.

### Regenerate `venue-coverage.csv`
```bash
node coverage.mjs
```
Run it whenever configs/registry/shows.json change. The Notes column carries the "why" for venues with no source.

### Push to production
**Ask first.** Then:
```bash
git add -A && git commit -m "..." && git push
```
Cloudflare Pages auto-deploys via GitHub webhook within ~30 sec. Verify with `curl -sI https://showcal.westindia.co/` and `md5 -q ~/Projects/showcal/index.html` against `curl -s https://showcal.westindia.co/ | md5`.

## Frontend gotchas

### `shows.json` schema (per record)
```json
{
  "id": "show_xxx", "date": "2026-07-01", "time": "21:00", "slot": "evening",
  "venue": "Empty Bottle", "venueId": "empty-bottle", "hood": "Ukrainian Village",
  "headliners": [{"name": "...", "genre": "music", "role": "headliner"}],
  "openers": [{"name": "...", "genre": "music", "role": "opener"}],
  "genres": [], "price": 23.48, "age": "21+",
  "ticketUrl": "...", "poster": "...",
  "sourceList": ["do312"]
}
```

### venues.html structure
Three-column flex stage inside `.panes`, 150% wide. `stage.venue-active` (mobile-only) and `stage.show-active` shift by `translateX(-33.33%)` per active class. Show detail matches calendar page's layout exactly: poster → tomato banner (with BUY TICKETS) → date/time/price/age tiles → lineup with Spotify links → venue info.

### The at-rest wall
Both `index.html` and `venues.html` show a flowing "PICK A SHOW / PICK A VENUE" wall when nothing is selected. It's ONE flowing block of ~800 spans joined by spaces; `white-space: nowrap` on spans, natural word wrap between them, `overflow: hidden` on parent clips overflow. **Do not** put each phrase on its own row — the earlier row-based approach was rejected by the user.

## Deployment stack (do not change without asking)

- **GitHub**: `y0ung-nasha/showcal`, public, `main` branch, HTTPS auth via `gh auth` on this machine
- **Cloudflare Pages**: project `showcal`, auto-deploys from GitHub `main`, output dir `/`, no build command
- **DNS**: `westindia.co` is at **GoDaddy** (nameservers `ns31/ns32.domaincontrol.com`). Do NOT recommend nameserver migration to Cloudflare — user picked "use current DNS provider" specifically to avoid that. Custom domain is a single CNAME: `showcal` → `showcal-2fa.pages.dev` at GoDaddy.
- **SSL**: auto-issued by Cloudflare (Google Trust Services CA), auto-renews

## Related paths

- Old iCloud copy (stale, ignore): `~/Library/Mobile Documents/com~apple~CloudDocs/GodVault/Projects/In Progress/csc/files/`
- Memory system for this project: `~/.claude/projects/<slug-of-this-path>/memory/`
