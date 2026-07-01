# Chicago Show Calendar — Data Sourcing & Pipeline Plan

**Constraints (your calls):** build your own pipeline · free APIs + your own scrapers (no paid actors) · periodic *manual* pulls (a script you run on demand — no scheduler/subscription needed) · **no Ticketmaster API** — keep the big Ticketmaster/Live Nation rooms in the calendar, but source them from their own sites + aggregators rather than TM's API.

**Core principle:** you are *not* writing ~180 scrapers. The venues funnel through a few ticketing backends, and they're also re-listed on a few aggregators that already normalize the data. The whole job collapses to **~4–6 source adapters + a dedup layer + a manual-pull CLI.**

---

## 1. What the spot-checks found (evidence, not assumption)

| Venue | Ticketing backend | Notes |
|---|---|---|
| Empty Bottle | **DICE** (`link.dice.fm`) | Also surfaced on Ticketmaster's venue page as "on partner site," Songkick (90 shows), Bandsintown (86). |
| Lincoln Hall / Schubas | **Etix / Rockhouse Partners** | Run their own site `lh-st.com`; on Do312, Songkick, Bandsintown, JamBase. |
| Metro (+ likely Smartbar) | **Etix / Rockhouse Partners** | `metrochicago.com`. |

Takeaways:
- The **indie tier leans DICE**; the **Audiotree/LH-ST + Metro family is Etix**; the **big rooms are Ticketmaster/Live Nation** (and TicketWeb, which TM owns).
- A **Chicago-local aggregator, Do312**, already lists most of these venues with per-venue calendars — potentially the single biggest breadth shortcut.
- Ticketmaster's Discovery API surfaced Empty Bottle (a DICE venue) as a listing, which means **TM Discovery aggregates more broadly than just TM-ticketed shows** — worth exploiting.

---

## 2. Source tiers (build in this order)

**Tier 0 — Local aggregator net (breadth, fast): Do312 + Songkick/Bandsintown venue pages.**
One adapter that walks per-venue calendar pages already gives you most venues with names/dates/venues pre-normalized. Best bang-for-buck first pull; treat as the wide net, then enrich.
*Trade-off:* lineups/openers and exact price/age are sometimes thinner here; aggregator ToS applies (you chose to scrape — honor robots.txt + rate limits).

**Tier 1 — Venue-site JSON-LD harvester (the backbone).**
Most venue sites — including the Ticketmaster/Live Nation big rooms, the Etix family (Lincoln Hall, Schubas, Metro), and the WordPress/Squarespace bars — embed **`schema.org/Event`** JSON-LD in their own pages. One generic extractor pulls name/date/venue/lineup/price/age/image/ticket-URL straight from the source, no API and no middleman. This is how we keep the big rooms *without* touching Ticketmaster's API: we read the venue's own published data, and the ticket link just happens to point at TM. Self-published and authoritative — do it first.

**Tier 2 — DICE (scrape the JSON, not the HTML).**
No public API. But DICE's web app loads listings from an internal JSON endpoint — open a venue's DICE page, watch the Network tab (Fetch/XHR), and target that JSON response per venue. Far more stable than parsing rendered HTML. Covers the Empty Bottle–style indie cohort.

**Tier 3 — Do312 + Songkick/Bandsintown venue pages (breadth backfill).**
For venues whose own sites don't expose clean JSON-LD, these aggregators already list Chicago shows per venue, pre-normalized. Use them to fill gaps — and to catch the big rooms if their own markup is thin. (Aggregator ToS applies; you chose to scrape, so honor robots.txt + rate limits.)

**Tier 4 — iCal/RSS feeds.** Some venue sites publish `.ics`/RSS — cheap to ingest where present.

**Tier 5 — Bespoke scrapers.** Only for high-value venues none of the above reach (likely a few See Tickets / AXS / Tixr stragglers).

**Skip:** Ticketmaster API (by choice), and Eventbrite for discovery (public search removed in 2020 — only retrievable by event/venue/org ID you already hold).

> Note on the big rooms: dropping the TM *API* does not drop the venues. Aragon, Riviera, the Vic, Salt Shed, Park West, House of Blues and the arenas all publish their schedules on their own sites and appear on Do312 — so Tiers 1 and 3 keep them in the calendar.

---

## 3. Auto-classify the 180 (so you don't hand-sort them)

Write a one-time `detect_backend(venue)` step instead of manually researching each venue. For each venue site, fetch the homepage/calendar and match signatures:

| Signature in page/links | Backend → adapter |
|---|---|
| `link.dice.fm`, `dice.fm/event` | DICE (Tier 2) |
| `ticketweb.com`, `livenation.com`, `ticketmaster.com` | TM family → still **Tier 1 JSON-LD** (read the venue's own page; ticket link just points at TM) |
| `etix.com`, Rockhouse markup | Etix venues → **Tier 1 JSON-LD** (their own sites) |
| `seetickets.us` | See Tickets (bespoke/Tier 5) |
| `eventbrite.com` | Eventbrite (ID-capture only) |
| `axs.com`, `tixr.com`, `prekindle.com` | note for Tier 5 |
| `<script type="application/ld+json">` with `"@type":"Event"` | JSON-LD (Tier 1) |
| `.ics` / `/feed` / RSS link | Feed (Tier 4) |

Output: each venue tagged with a backend + the URL to hit. *That table is the real "best way to scrape" answer — it tells you exactly how many adapters you need.*

---

## 4. Normalize + dedup (the part that actually makes it work)

The same show arrives from multiple sources (Do312 *and* DICE *and* TM). Resolve to one record:

- **Join key:** `canonical_venue_id` (from the venue master list) + `date` + `normalized_headliner`.
- **Venue resolution:** map every source's venue string to your canonical venue via an alias table — you already started this with the master-list variant clusters. Same technique, reused.
- **Artist/title normalization:** lowercase, strip punctuation, collapse "w/ / + / feat." into a lineup array; pick the source with the richest lineup as the winner, fill gaps from others (e.g., poster from DICE, price from the venue site).
- **Conflict rule:** prefer the venue's own/official source for price/age/time; prefer aggregators only to *fill* missing fields.

Target output = the shape your app already uses: `{ id, date, venue, hood, headliners[], openers[], genres[], price, age, ticketUrl, poster, sourceList[] }`.

---

## 5. Manual-pull workflow (no scheduler)

A small CLI you run when you want fresh data:

```
pull --since 2026-06-15 [--source all|jsonld|dice|do312] [--venue <id>]
  → 1. run each source adapter, write raw JSON to /raw/<source>/<date>.json
  → 2. normalize each raw record to the common schema
  → 3. dedup/merge on the join key
  → 4. diff against last pull (new / changed / cancelled) and print a summary
  → 5. write /data/shows.json  (what the app reads)
```

Keep raw payloads per pull so you can re-normalize without re-fetching, and so diffs are auditable.

---

## 6. Etiquette / legal

- Not using Ticketmaster's API (by choice). The TM/Live Nation rooms come in via their own sites' JSON-LD and the aggregators instead.
- Scraping (DICE JSON, venue sites, Do312/Songkick/Bandsintown pages): honor `robots.txt`, set a real User-Agent, rate-limit (≈1 req/sec/site), cache aggressively, pull only changed windows. JSON-LD is on the public page and lowest-risk, but ToS still applies.
- Songkick and Bandsintown have official APIs (partner-gated / artist-keyed) — if you later want a sanctioned path instead of scraping their pages, that's the upgrade.

---

## 7. Suggested build order

1. **Venue-site JSON-LD harvester** (Tier 1) — one adapter, the most venues at once: the big rooms, the Etix family, and the bars. *(built)*
2. **DICE JSON adapter** (Tier 2) — the indie cohort.
3. **Do312 breadth net** (Tier 3) — backfill venues with thin/no JSON-LD.
4. **Normalize + dedup layer** — wire all adapters into the common schema + alias table (+ neighborhood mapping from the venue master list).
5. **`detect_backend` pass** over all ~180 to assign each venue to an adapter and find Tier-5 stragglers.
6. **iCal/RSS + bespoke scrapers** for the remaining stragglers.
