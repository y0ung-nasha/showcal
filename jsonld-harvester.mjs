#!/usr/bin/env node
/**
 * jsonld-harvester.mjs — Venue-site JSON-LD harvester
 * Chicago Show Calendar pipeline · Tier 1 source (no API, no middleman)
 *
 * Reads each venue's OWN site and extracts schema.org/Event JSON-LD.
 * Covers the big rooms (their ticket link points at TM, but we never call TM),
 * the Etix family (Lincoln Hall / Schubas / Metro), and most WordPress/Squarespace bars.
 *
 * USAGE
 *   node jsonld-harvester.mjs --venues ./venues.json [--out ./data/venue-site-shows.json]
 *                             [--follow] [--max-events 80] [--delay 600]
 *
 *   venues.json: [{ "id","name"|null,"hood","url","eventPathIncludes"? }, ...]
 *     - name: canonical venue name; null = use each event's own location name
 *       (handy for multi-room operators like lh-st.com).
 *     - eventPathIncludes: if set (and --follow), the listing page is crawled for
 *       same-domain links containing this substring, and each is fetched for JSON-LD
 *       (covers sites that only embed Event data on detail pages).
 *
 * OUTPUT: JSON array in the common schema (same shape the app uses).
 *
 * ETIQUETTE: sets a real UA, throttles (--delay ms), caps follows (--max-events).
 * Honor each site's robots.txt / ToS before pointing it at them.
 */

import { pathToFileURL } from "node:url";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const EVENT_TYPES = /(?:^|[^a-z])(?:Music|Theater|Comedy|Dance|Social|Literary|Screening|Children)?Event$|^Festival$/;

// ---------------- JSON-LD extraction ----------------
export function extractJsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let raw = m[1].trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
    let parsed = tryParse(raw);
    if (parsed === undefined) parsed = tryParse(raw.replace(/,\s*([}\]])/g, "$1")); // strip trailing commas
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}
function tryParse(s) { try { return JSON.parse(s); } catch { return undefined; } }

// Flatten @graph/arrays and keep nodes that look like events.
export function collectEvents(parsed) {
  const nodes = [];
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      if (n["@graph"]) walk(n["@graph"]);
      if (n["@type"]) nodes.push(n);
    }
  })(parsed);
  return nodes.filter(isEventNode);
}
function isEventNode(n) {
  const t = n["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && EVENT_TYPES.test(x));
}

// ---------------- field mapping ----------------
const onlyDate = (s) => (typeof s === "string" && s.match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
const onlyTime = (s) => {
  const m = typeof s === "string" && s.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
};
function slotFromTime(t) {
  if (!t) return null;
  const h = parseInt(t.slice(0, 2), 10);
  if (h >= 22 || h < 4) return "late";
  if (h < 16) return "afternoon";
  return "evening";
}
function asArray(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
function performerName(p) { return typeof p === "string" ? p : p && p.name; }
function imageUrl(img) {
  const first = asArray(img)[0];
  return typeof first === "string" ? first : first && (first.url || first.contentUrl) || null;
}
function normalizeAge(s) {
  if (!s) return null;
  if (/all\s*ages/i.test(s)) return "ALL AGES";
  const m = String(s).match(/(\d{2})/);
  return m ? `${m[1]}+` : null;
}
function priceFromOffers(offers) {
  const list = asArray(offers).map((o) => (o && o.price != null ? Number(o.price) : null)).filter((p) => p != null && !Number.isNaN(p));
  if (!list.length) return null;
  const min = Math.min(...list);
  return min === 0 ? "FREE" : min;
}
function ticketUrlFromOffers(offers, fallback) {
  const o = asArray(offers).find((x) => x && x.url);
  return (o && o.url) || fallback || null;
}
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); }

export function mapEvent(ld, cfg = {}) {
  const date = onlyDate(ld.startDate);
  const time = onlyTime(ld.startDate);
  const performers = asArray(ld.performer).map(performerName).filter(Boolean);
  let headliners, openers;
  if (performers.length) {
    headliners = [{ name: performers[0], genre: "music", role: "headliner" }];
    openers = performers.slice(1).map((n) => ({ name: n, genre: "music", role: "opener" }));
  } else {
    headliners = [{ name: ld.name, genre: "music", role: "headliner" }];
    openers = [];
  }
  const venue = cfg.name || (ld.location && ld.location.name) || null;
  const loc = ld.location || {};
  const addr = loc.address || {};

  return {
    id: "vs_" + djb2(`${venue}|${date}|${ld.name}`),
    source: "venue-site",
    sourceList: ["venue-site"],
    date,
    time,
    slot: slotFromTime(time),
    venue,
    rawVenue: (ld.location && ld.location.name) || null,
    hood: cfg.hood || null,
    headliners,
    openers,
    genres: [],                                  // JSON-LD rarely carries genre — enrich later
    price: priceFromOffers(ld.offers),
    age: normalizeAge(ld.typicalAgeRange),
    ticketUrl: ticketUrlFromOffers(ld.offers, ld.url),
    poster: imageUrl(ld.image),
    venueInfo: {
      name: venue,
      address: typeof addr === "string" ? addr : addr.streetAddress || null,
      city: (typeof addr === "object" && addr.addressLocality) || null,
      url: loc.url || cfg.url || null,
    },
  };
}

// ---------------- fetching ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
function sameDomainEventLinks(html, baseUrl, includes) {
  const base = new URL(baseUrl);
  const found = new Set();
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (u.host === base.host && u.pathname.includes(includes)) found.add(u.href.split("#")[0]);
    } catch { /* skip bad href */ }
  }
  return [...found];
}

export async function harvestVenue(cfg, opts = {}) {
  const { follow = false, maxEvents = 80, delay = 600 } = opts;
  const shows = [];
  const seen = new Set();
  const collect = (html, cfgForMap) => {
    for (const block of extractJsonLdBlocks(html)) {
      for (const ev of collectEvents(block)) {
        const show = mapEvent(ev, cfgForMap);
        if (!show.date || seen.has(show.id)) continue;
        seen.add(show.id);
        shows.push(show);
      }
    }
  };

  const listing = await getHtml(cfg.url);
  collect(listing, cfg);

  if (follow && cfg.eventPathIncludes) {
    const links = sameDomainEventLinks(listing, cfg.url, cfg.eventPathIncludes).slice(0, maxEvents);
    for (const link of links) {
      await sleep(delay);
      try { collect(await getHtml(link), cfg); }
      catch (e) { console.error(`    skip ${link}: ${e.message}`); }
    }
  }
  return shows;
}

// ---------------- CLI ----------------
function parseArgs(argv) {
  const a = { venues: "./venues.json", out: "./data/venue-site-shows.json", follow: false, maxEvents: 80, delay: 600 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--venues") { a.venues = v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--follow") { a.follow = true; }
    else if (k === "--max-events") { a.maxEvents = parseInt(v, 10); i++; }
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

  console.error(`JSON-LD harvest · ${venues.length} venues · follow=${args.follow}`);
  const all = [];
  for (const cfg of venues) {
    process.stderr.write(`  ${cfg.id} ...`);
    try {
      const got = await harvestVenue(cfg, args);
      all.push(...got);
      console.error(` ${got.length} shows`);
    } catch (e) {
      console.error(` ERROR ${e.message}`);
    }
    await sleep(args.delay);
  }
  all.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(all, null, 2));

  const venuesSeen = new Set(all.map((s) => s.venue).filter(Boolean));
  const noJsonLd = venues.length - new Set(all.map((s) => s.venue)).size;
  console.error(`\n✓ ${all.length} shows across ${venuesSeen.size} venues → ${args.out}`);
  console.error(`  venues with zero JSON-LD: ${Math.max(0, noJsonLd)} (route those to DICE / Do312)`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e.message || e); process.exit(1); });
