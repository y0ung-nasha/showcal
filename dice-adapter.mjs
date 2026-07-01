#!/usr/bin/env node
/**
 * dice-adapter.mjs — DICE (dice.fm) adapter
 * Chicago Show Calendar pipeline · Tier 2 source (the indie cohort)
 *
 * DICE has no official public API. But DICE venue pages are server-rendered and
 * carry TWO useful payloads:
 *   (a) schema.org/Event JSON-LD  -> reliable name/date/venue/price/lineup/image
 *   (b) a Next.js __NEXT_DATA__ JSON blob -> DICE's richer fields: GENRES, AGE
 *       limit, lineup with headliner flags.
 * We use (a) as the backbone and enrich with (b). No API key, no api.dice.fm
 * reverse-engineering — just the venue's own public page.
 *
 * USAGE
 *   node dice-adapter.mjs --venues ./dice-venues.json [--out ./data/dice-shows.json]
 *                         [--delay 700]
 *   dice-venues.json: [{ "id","name","hood","diceUrl":"https://dice.fm/venue/<slug>" }]
 *
 * OUTPUT: common schema, source "dice" -> feed into normalize.mjs as another --in.
 *
 * ⚠ DICE FIELD NAMES: the __NEXT_DATA__ field names below are best-effort and may
 *   drift. They're centralized in the "DICE FIELD PROBES" block — inspect one real
 *   venue page's __NEXT_DATA__ and adjust there if genres/age come back empty.
 *   The JSON-LD backbone keeps the adapter useful even if enrichment misses.
 */

import { pathToFileURL } from "node:url";
import { extractJsonLdBlocks, collectEvents, mapEvent } from "./jsonld-harvester.mjs";
import { normName } from "./normalize.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onlyDate = (s) => (String(s || "").match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
const lower = (s) => String(s).toLowerCase().trim();

function normalizeAge(s) {
  if (s == null) return null;
  const str = String(s);
  if (/all\s*ages/i.test(str)) return "ALL AGES";
  const m = str.match(/(\d{2})/);
  return m ? `${m[1]}+` : null;
}

// ---------------- DICE FIELD PROBES (adjust here if DICE changes shape) ----------------
const diceGenres = (ev) =>
  [...new Set((ev.genre_tags || ev.genres || ev.tags || []).map(lower).filter(Boolean))];
const diceAge = (ev) => normalizeAge(ev.age_limit ?? ev.age_restriction ?? ev.age ?? ev.minimum_age);
const diceDate = (ev) =>
  onlyDate(ev?.dates?.event_start_date || ev.event_start_date || ev.start_date || ev.date || ev.started_at);
const diceName = (ev) => ev.name || ev.title;
const diceUrl = (ev) =>
  ev.perm_name ? `https://dice.fm/event/${ev.perm_name}` : ev.url || ev.share_url || ev.link || null;
const diceImage = (ev) => {
  const im = ev.event_images || ev.images || {};
  return im.landscape || im.portrait || im.square || im.brand || (typeof ev.image === "string" ? ev.image : null);
};
const diceLineup = (ev) => {
  // returns [{name, headliner:bool}] best-effort
  if (Array.isArray(ev.lineup)) {
    return ev.lineup
      .map((a) => ({ name: a.details || a.name || a.title, headliner: a.rank === 1 || a.headliner === true || a.top === true }))
      .filter((a) => a.name);
  }
  const tops = ev?.summary_lineup?.top_artists;
  if (Array.isArray(tops)) return tops.map((n, i) => ({ name: typeof n === "string" ? n : n.name, headliner: i === 0 })).filter((a) => a.name);
  return [];
};
const dicePrice = (ev) => {
  // DICE money is often in minor units (cents). Best-effort: collect candidates, take min, de-cent.
  const cands = [];
  const push = (v) => { const n = Number(v); if (!Number.isNaN(n) && n >= 0) cands.push(n); };
  if (ev.price && typeof ev.price === "object") push(ev.price.amount ?? ev.price.total ?? ev.price.face_value);
  if (typeof ev.price === "number") push(ev.price);
  push(ev.min_price); push(ev.from_price);
  for (const t of ev.ticket_types || []) push(t?.price?.total ?? t?.price?.amount ?? t?.price);
  if (!cands.length) return null;
  let min = Math.min(...cands);
  if (Number.isInteger(min) && min >= 100) min = min / 100; // looks like cents
  return min === 0 ? "FREE" : min;
};
// --------------------------------------------------------------------------------------

function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// Deep-walk Next.js data and collect things that look like DICE events.
export function collectDiceEvents(root) {
  const out = [];
  const seen = new Set();
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      const looksLikeEvent = (n.perm_name || n.event_images || n.ticket_types || n.genre_tags) && (n.name || n.title);
      if (looksLikeEvent) {
        const key = n.perm_name || n.id || `${diceName(n)}|${diceDate(n)}`;
        if (!seen.has(key)) { seen.add(key); out.push(n); }
      }
      for (const k in n) walk(n[k]);
    }
  })(root);
  return out;
}

// Build a show purely from a DICE event (used when JSON-LD is absent).
export function diceMapNative(ev, cfg) {
  const lineup = diceLineup(ev);
  let headliners, openers;
  if (lineup.length) {
    const head = lineup.find((a) => a.headliner) || lineup[0];
    headliners = [{ name: head.name, genre: "music", role: "headliner" }];
    openers = lineup.filter((a) => a !== head).map((a) => ({ name: a.name, genre: "music", role: "opener" }));
  } else {
    headliners = [{ name: diceName(ev), genre: "music", role: "headliner" }];
    openers = [];
  }
  const date = diceDate(ev);
  return {
    id: "dc_" + (ev.perm_name || `${normName(diceName(ev))}-${date}`),
    source: "dice", sourceList: ["dice"],
    date, time: null, slot: null,
    venue: cfg.name || null, rawVenue: cfg.name || null, hood: cfg.hood || null,
    headliners, openers,
    genres: diceGenres(ev),
    price: dicePrice(ev),
    age: diceAge(ev),
    ticketUrl: diceUrl(ev),
    poster: diceImage(ev),
    venueInfo: { name: cfg.name || null, url: cfg.diceUrl || null },
  };
}

export function harvestDicePage(html, cfg) {
  const shows = [];
  const ldEvents = extractJsonLdBlocks(html).flatMap(collectEvents);
  const nextEvents = collectDiceEvents(extractNextData(html) || {});

  // index DICE events by name+date for enrichment matching
  const nextByKey = new Map();
  for (const ev of nextEvents) nextByKey.set(`${normName(diceName(ev))}|${diceDate(ev)}`, ev);

  if (ldEvents.length) {
    for (const ld of ldEvents) {
      const show = mapEvent(ld, cfg);
      show.source = "dice";
      show.sourceList = ["dice"];
      show.id = "dc_" + show.id.slice(3);
      const ev = nextByKey.get(`${normName(ld.name)}|${onlyDate(ld.startDate)}`);
      if (ev) {
        const g = diceGenres(ev);
        if (g.length) show.genres = g;                               // the enrichment win
        if (!show.age) show.age = diceAge(ev);
        if (show.price == null) show.price = dicePrice(ev);
        const lineup = diceLineup(ev);
        if (lineup.length > show.headliners.length + show.openers.length) {
          const head = lineup.find((a) => a.headliner) || lineup[0];
          show.headliners = [{ name: head.name, genre: "music", role: "headliner" }];
          show.openers = lineup.filter((a) => a !== head).map((a) => ({ name: a.name, genre: "music", role: "opener" }));
        }
        if (!show.poster) show.poster = diceImage(ev);
      }
      if (show.date) shows.push(show);
    }
  } else {
    // no JSON-LD on the page — fall back to DICE-native objects
    for (const ev of nextEvents) {
      const show = diceMapNative(ev, cfg);
      if (show.date) shows.push(show);
    }
  }
  return shows;
}

async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// ---------------- CLI ----------------
function parseArgs(argv) {
  const a = { venues: "./dice-venues.json", out: "./data/dice-shows.json", delay: 700 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--venues") { a.venues = v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--delay") { a.delay = parseInt(v, 10); i++; }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");

  let venues;
  try { venues = JSON.parse(await readFile(args.venues, "utf8")); }
  catch { console.error(`Could not read venues file: ${args.venues}`); process.exit(1); }

  console.error(`DICE harvest · ${venues.length} venues`);
  const all = [];
  for (const cfg of venues) {
    process.stderr.write(`  ${cfg.id} ...`);
    try {
      const shows = harvestDicePage(await getHtml(cfg.diceUrl), cfg);
      all.push(...shows);
      const withGenres = shows.filter((s) => s.genres.length).length;
      console.error(` ${shows.length} shows (${withGenres} w/ genres)`);
    } catch (e) {
      console.error(` ERROR ${e.message}`);
    }
    await sleep(args.delay);
  }
  all.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(all, null, 2));
  console.error(`\n✓ ${all.length} DICE shows → ${args.out}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e.message || e); process.exit(1); });
