#!/usr/bin/env node
/**
 * dice-adapter.mjs — DICE city-browse adapter
 * Chicago Show Calendar pipeline · Tier 2 source
 *
 * DICE's public web is an SPA that ships __NEXT_DATA__ with a fully-hydrated
 * event list for a given city page. The browse URL for Chicago is:
 *   https://dice.fm/browse/chicago-5b238ca66e4bcd93783835b0
 * Each type-filter (?type=gigs, ?type=dj, ?type=party, ...) returns the same
 * 30-event window, so we walk all filters and dedupe by perm_name.
 *
 * USAGE
 *   node dice-adapter.mjs --city chicago-5b238ca66e4bcd93783835b0 \
 *                        [--out ./data/dice-shows.json] [--delay 500]
 *
 * OUTPUT: common schema, source "dice" — feed to normalize.mjs as --in.
 */

import { pathToFileURL } from "node:url";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FILTERS = ["gigs", "dj", "party", "art", "comedy", "social", "theatre", "workshop", "film", "sport", "talk", "wellbeing"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const onlyDate = (s) => (String(s || "").match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
const onlyTime = (s) => { const m = String(s || "").match(/T(\d{2}:\d{2})/); return m ? m[1] : null; };
function slotFromTime(t) {
  if (!t) return null;
  const h = parseInt(t.slice(0, 2), 10);
  if (h >= 22 || h < 4) return "late";
  if (h < 16) return "afternoon";
  return "evening";
}
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); }

function normalizeAge(v) {
  if (v == null) return null;
  const s = String(v);
  if (/all\s*ages/i.test(s)) return "ALL AGES";
  const m = s.match(/(\d{2})/);
  return m ? `${m[1]}+` : null;
}
function normalizePrice(ev) {
  const cands = [];
  const push = (x) => { const n = Number(x); if (!Number.isNaN(n) && n >= 0) cands.push(n); };
  if (ev.price && typeof ev.price === "object") push(ev.price.amount ?? ev.price.total ?? ev.price.face_value);
  if (typeof ev.price === "number") push(ev.price);
  push(ev.min_price); push(ev.from_price);
  for (const t of ev.ticket_types || []) push(t?.price?.total ?? t?.price?.amount ?? t?.price);
  if (!cands.length) return null;
  let min = Math.min(...cands);
  if (Number.isInteger(min) && min >= 100) min = min / 100;
  return min === 0 ? "FREE" : min;
}

function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

async function fetchBrowse(cityId, filter) {
  const url = `https://dice.fm/browse/${cityId}${filter ? `?type=${filter}` : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const html = await res.text();
  const data = extractNextData(html);
  return data?.props?.pageProps?.events || [];
}

export function mapDiceEvent(ev) {
  const venue = ev.venues?.[0] || {};
  const startISO = ev.dates?.event_start_date;
  const date = onlyDate(startISO);
  const time = onlyTime(startISO);

  const tops = ev.summary_lineup?.top_artists || [];
  const headliners = tops.length
    ? [{ name: tops[0].name, genre: (ev.genre_tags?.[0]) || "music", role: "headliner" }]
    : [{ name: ev.name, genre: "music", role: "headliner" }];
  const openers = tops.slice(1).map((a) => ({ name: a.name, genre: "music", role: "opener" }));

  const venueName = (venue.name || "").trim();
  const ticketUrl = ev.perm_name ? `https://dice.fm/event/${ev.perm_name}` : null;
  const poster = ev.event_images?.landscape || ev.event_images?.portrait
                  || tops[0]?.image?.url || null;

  return {
    id: "dc_" + djb2(`${venueName}|${date}|${ev.name}`),
    source: "dice",
    sourceList: ["dice"],
    date,
    time,
    slot: slotFromTime(time),
    venue: venueName || null,
    rawVenue: venue.name || null,
    hood: null,
    headliners,
    openers,
    genres: [...new Set((ev.genre_tags || []).map((s) => String(s).toLowerCase()))],
    price: normalizePrice(ev),
    age: normalizeAge(ev.age_limit),
    ticketUrl,
    poster,
    venueInfo: {
      name: venueName,
      address: venue.address || null,
      city: venue.city?.name || null,
      url: null,
    },
  };
}

// ---- CLI ----
function parseArgs(argv) {
  const a = { city: "chicago-5b238ca66e4bcd93783835b0", out: "./data/dice-shows.json", delay: 500 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--city") { a.city = v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--delay") { a.delay = parseInt(v, 10); i++; }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");

  console.error(`DICE browse harvest · city=${args.city}`);
  const seen = new Map(); // perm_name -> raw event
  for (const f of FILTERS) {
    process.stderr.write(`  filter=${f} ...`);
    try {
      const evs = await fetchBrowse(args.city, f);
      let added = 0;
      for (const ev of evs) {
        const key = ev.perm_name || `${ev.name}|${ev.dates?.event_start_date}`;
        if (!seen.has(key)) { seen.set(key, ev); added++; }
      }
      console.error(` +${added} (${evs.length} on page)`);
    } catch (e) {
      console.error(` ERROR ${e.message}`);
    }
    await sleep(args.delay);
  }

  const mapped = [...seen.values()].map(mapDiceEvent).filter((s) => s.date);
  mapped.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(mapped, null, 2));

  const uniqueVenues = new Set(mapped.map((s) => s.venue).filter(Boolean));
  console.error(`\n✓ ${mapped.length} DICE shows across ${uniqueVenues.size} venues → ${args.out}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e.message || e); process.exit(1); });
