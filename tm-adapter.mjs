#!/usr/bin/env node
/**
 * tm-adapter.mjs — Ticketmaster Discovery API adapter
 * Chicago Show Calendar pipeline · Tier 1 source (free, authoritative, no scraping)
 *
 * Pulls music events in Chicago and maps them to the app's show schema.
 *
 * SETUP
 *   1. Get a free key at https://developer.ticketmaster.com (Discovery API).
 *   2. Provide it via env var or flag:
 *        export TICKETMASTER_API_KEY=xxxx
 *        node tm-adapter.mjs --since 2026-06-15
 *
 * USAGE
 *   node tm-adapter.mjs [--since YYYY-MM-DD] [--until YYYY-MM-DD]
 *                       [--out ./data/tm-shows.json] [--key <apikey>]
 *                       [--chunk-days 7] [--city Chicago] [--state IL]
 *
 * OUTPUT
 *   Writes a JSON array of shows in the common schema:
 *   { id, source, sourceList, date, time, slot, venue, rawVenue, hood,
 *     headliners[], openers[], genres[], price, age, ticketUrl, poster,
 *     venueInfo }
 *
 * NOTES
 *   - Quota: 5,000 calls/day, 5 req/sec. We throttle + window by date to dodge
 *     the deep-paging cap (size*page must stay < 1000).
 *   - TM is rich on name/date/venue/images, sparse on price/age for indie shows.
 *     Leave those gaps for DICE / venue-site sources to fill in the merge step.
 *   - `hood` is null here — neighborhood comes from the venue master list in
 *     the normalize step, keyed off the canonical venue name.
 */

const BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
const PAGE_SIZE = 200;            // TM max
const REACHABLE_PAGES = Math.floor(1000 / PAGE_SIZE); // deep-paging cap -> pages 0..4
const REQ_DELAY_MS = 230;         // stay under 5 req/sec

// ---------- args ----------
function parseArgs(argv) {
  const a = { chunkDays: 7, city: "Chicago", state: "IL", out: "./data/tm-shows.json" };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--since") { a.since = v; i++; }
    else if (k === "--until") { a.until = v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--key") { a.key = v; i++; }
    else if (k === "--chunk-days") { a.chunkDays = parseInt(v, 10); i++; }
    else if (k === "--city") { a.city = v; i++; }
    else if (k === "--state") { a.state = v; i++; }
  }
  return a;
}

// ---------- date helpers ----------
const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const localDateTime = (d) => `${isoDate(d)}T00:00:00`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- mapping helpers ----------
function bestImage(images = []) {
  if (!images.length) return null;
  // prefer wide, high-res
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  const wide = sorted.find((i) => i.ratio === "16_9") || sorted.find((i) => i.ratio === "3_2");
  return (wide || sorted[0]).url || null;
}

function extractAge(text = "") {
  const m = text.match(/\b(all\s*ages|all-ages|21\s*\+|18\s*\+|17\s*\+|16\s*\+)\b/i);
  if (!m) return null;
  const t = m[1].toLowerCase().replace(/\s+/g, "");
  if (t.startsWith("all")) return "ALL AGES";
  return t; // "21+", "18+", ...
}

function priceFrom(ev) {
  const pr = ev.priceRanges && ev.priceRanges[0];
  if (!pr || pr.min == null) return null;        // unknown — fill later
  return pr.min === 0 ? "FREE" : pr.min;
}

function slotFromTime(localTime) {
  if (!localTime) return null;
  const h = parseInt(localTime.slice(0, 2), 10);
  if (h >= 22 || h < 4) return "late";
  if (h < 16) return "afternoon";
  return "evening";
}

function genreOfAttraction(att) {
  const c = att.classifications && att.classifications[0];
  const g = c && (c.genre?.name || c.subGenre?.name);
  if (!g || g === "Undefined" || g === "Other") return null;
  return g.toLowerCase();
}

function mapEvent(ev) {
  const start = ev.dates?.start || {};
  const venue = ev._embedded?.venues?.[0] || {};
  const attractions = ev._embedded?.attractions || [];

  // headliner = first attraction; rest = openers. Fall back to the event name.
  let headliners = [];
  let openers = [];
  if (attractions.length) {
    headliners = [{ name: attractions[0].name, genre: genreOfAttraction(attractions[0]) || "music", role: "headliner" }];
    openers = attractions.slice(1).map((a) => ({ name: a.name, genre: genreOfAttraction(a) || "music", role: "opener" }));
  } else {
    headliners = [{ name: ev.name, genre: "music", role: "headliner" }];
  }
  const genres = [...new Set([...headliners, ...openers].map((a) => a.genre).filter(Boolean))];

  return {
    id: `tm_${ev.id}`,
    source: "ticketmaster",
    sourceList: ["ticketmaster"],
    date: start.localDate || null,
    time: start.localTime || null,             // kept in data layer; off the card face
    slot: slotFromTime(start.localTime),
    venue: venue.name || null,                 // canonicalized in normalize step
    rawVenue: venue.name || null,
    hood: null,                                // filled from venue master list later
    headliners,
    openers,
    genres,
    price: priceFrom(ev),                       // number | "FREE" | null(unknown)
    age: extractAge(`${ev.info || ""} ${ev.pleaseNote || ""}`),
    ticketUrl: ev.url || null,
    poster: bestImage(ev.images),
    venueInfo: {
      name: venue.name || null,
      address: venue.address?.line1 || null,
      city: venue.city?.name || null,
      postalCode: venue.postalCode || null,
      url: venue.url || null,
      location: venue.location ? { lat: venue.location.latitude, lng: venue.location.longitude } : null,
    },
  };
}

// ---------- fetch one window ----------
async function fetchWindow({ key, city, state, startDT, endDT }) {
  const events = [];
  let page = 0;
  let totalPages = 1;
  while (page < totalPages && page < REACHABLE_PAGES) {
    const params = new URLSearchParams({
      apikey: key,
      classificationName: "music",
      city,
      stateCode: state,
      countryCode: "US",
      localStartDateTime: localDateTime(startDT),
      localEndDateTime: localDateTime(endDT),
      size: String(PAGE_SIZE),
      page: String(page),
      sort: "date,asc",
    });
    const url = `${BASE}?${params}`;

    let res;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(url);
      if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
      break;
    }
    if (res.status === 401) throw new Error("401 Unauthorized — check your Ticketmaster API key.");
    if (!res.ok) throw new Error(`Ticketmaster ${res.status}: ${await res.text()}`);

    const data = await res.json();
    totalPages = data.page?.totalPages ?? 1;
    const batch = data._embedded?.events || [];
    events.push(...batch);

    if (totalPages > REACHABLE_PAGES) {
      console.warn(
        `  ! window ${isoDate(startDT)}→${isoDate(endDT)} has ${data.page?.totalElements} events ` +
        `(> ${REACHABLE_PAGES * PAGE_SIZE} reachable). Re-run with a smaller --chunk-days.`
      );
    }
    page++;
    await sleep(REQ_DELAY_MS);
  }
  return events;
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv);
  const key = args.key || process.env.TICKETMASTER_API_KEY;
  if (!key) {
    console.error("Missing API key. Set TICKETMASTER_API_KEY or pass --key <apikey>.");
    console.error("Get a free key at https://developer.ticketmaster.com");
    process.exit(1);
  }

  const since = args.since ? parseDate(args.since) : new Date();
  const until = args.until ? parseDate(args.until) : addDays(since, 60);
  console.error(`Ticketmaster · ${args.city}, ${args.state} · ${isoDate(since)} → ${isoDate(until)} · ${args.chunkDays}-day windows`);

  const raw = [];
  for (let w = new Date(since); w < until; w = addDays(w, args.chunkDays)) {
    const wEnd = addDays(w, args.chunkDays) < until ? addDays(w, args.chunkDays) : until;
    console.error(`  fetching ${isoDate(w)} → ${isoDate(wEnd)} ...`);
    const evs = await fetchWindow({ key, city: args.city, state: args.state, startDT: w, endDT: wEnd });
    raw.push(...evs);
  }

  // dedup by TM event id, then map
  const seen = new Set();
  const shows = [];
  for (const ev of raw) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    shows.push(mapEvent(ev));
  }
  shows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // write
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(shows, null, 2));

  // summary
  const venues = new Set(shows.map((s) => s.venue).filter(Boolean));
  const missingPrice = shows.filter((s) => s.price == null).length;
  const missingAge = shows.filter((s) => !s.age).length;
  console.error("");
  console.error(`✓ ${shows.length} shows across ${venues.size} venues → ${args.out}`);
  console.error(`  price unknown: ${missingPrice} · age unknown: ${missingAge}  (expected — fill from DICE/venue sources)`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
