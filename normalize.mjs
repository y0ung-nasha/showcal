#!/usr/bin/env node
/**
 * normalize.mjs — Normalize + dedup layer
 * Chicago Show Calendar pipeline · turns raw adapter output into the app's shows.json
 *
 * WHAT IT DOES
 *   1. Resolve each show's venue string -> canonical venue (via venue-registry.json),
 *      filling `hood` (neighborhood) and collapsing name variants.
 *   2. Merge duplicate shows across sources on  venueId | date | headliner.
 *   3. Apply conflict rules: the venue's own source wins for price/age/time/tickets;
 *      the richest lineup wins; sources only FILL each other's gaps.
 *   4. Write ./data/shows.json (what the app reads) + a report of unresolved venues.
 *
 * USAGE
 *   node normalize.mjs --in ./data/jsonld-shows.json [--in ./data/dice-shows.json ...]
 *                      [--registry ./venue-registry.json] [--out ./data/shows.json]
 */

import { pathToFileURL } from "node:url";

// venue-site (official) > dice > ticketmaster > do312/songkick/bandsintown (aggregators)
const SOURCE_PRIORITY = { "venue-site": 4, dice: 3, ticketmaster: 2, do312: 1, songkick: 1, bandsintown: 1 };
const prio = (s) => SOURCE_PRIORITY[s] ?? 0;

// ---------------- normalization helpers ----------------
export function normName(s) {
  return String(s || "")
    .toLowerCase().trim()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); }
function headlinerName(show) {
  const h = (show.headliners && show.headliners[0]) || (show.openers && show.openers[0]);
  return h ? h.name : show.title || "";
}
const lineupSize = (s) => (s.headliners?.length || 0) + (s.openers?.length || 0);
function slotFromTime(t) {
  if (!t) return null;
  const h = parseInt(t.slice(0, 2), 10);
  if (h >= 22 || h < 4) return "late";
  if (h < 16) return "afternoon";
  return "evening";
}

// ---------------- venue registry ----------------
export function buildRegistryIndex(entries) {
  const byKey = new Map();
  for (const e of entries) {
    byKey.set(normName(e.name), e);
    for (const a of e.aliases || []) byKey.set(normName(a), e);
  }
  return { byKey, entries };
}
export function resolveVenue(rawName, index) {
  return index.byKey.get(normName(rawName)) || null;
}

// ---------------- merge a group of duplicate shows ----------------
export function mergeGroup(records, venueEntry) {
  const byPrio = [...records].sort((a, b) => prio(b.source) - prio(a.source));
  // first non-empty value across records in priority order
  const pick = (fn) => { for (const r of byPrio) { const v = fn(r); if (v != null && v !== "" ) return v; } return null; };
  // richest lineup (then highest priority on ties)
  const richest = [...records].sort((a, b) => lineupSize(b) - lineupSize(a) || prio(b.source) - prio(a.source))[0];

  // genres: union, drop the "music" placeholder when real genres exist
  let genres = [...new Set(records.flatMap((r) => r.genres || []))];
  if (genres.some((g) => g !== "music")) genres = genres.filter((g) => g !== "music");

  const time = pick((r) => r.time);
  const venueName = venueEntry?.name || pick((r) => r.venue) || records[0].venue;
  const date = pick((r) => r.date);

  return {
    id: "show_" + djb2(`${venueEntry?.id || normName(venueName)}|${date}|${normName(headlinerName(richest))}`),
    date,
    time,
    slot: slotFromTime(time),
    venue: venueName,
    venueId: venueEntry?.id || null,
    hood: venueEntry?.hood ?? null,
    headliners: richest.headliners || [],
    openers: richest.openers || [],
    genres,
    price: pick((r) => r.price),
    age: pick((r) => r.age),
    ticketUrl: pick((r) => r.ticketUrl),
    poster: pick((r) => r.poster),
    venueInfo: pick((r) => r.venueInfo),
    sourceList: [...new Set(records.flatMap((r) => r.sourceList || [r.source]).filter(Boolean))],
    resolved: !!venueEntry,
  };
}

// ---------------- core normalize ----------------
// The registry is authoritative: any show whose venue does NOT resolve to a
// canonical entry is dropped. This is a hard filter — sources that surface
// shows at off-list venues are ignored per the master-list policy.
export function normalize(rawShows, registryEntries) {
  const index = buildRegistryIndex(registryEntries);
  const groups = new Map();
  const unresolved = new Map(); // rawVenue -> count (kept for the report only)
  let droppedCount = 0;

  for (const s of rawShows) {
    const entry = resolveVenue(s.venue, index);
    if (!entry) {
      unresolved.set(s.venue, (unresolved.get(s.venue) || 0) + 1);
      droppedCount++;
      continue; // drop shows at off-list venues
    }
    const key = `${entry.id}|${s.date}|${normName(headlinerName(s))}`;
    if (!groups.has(key)) groups.set(key, { entry, records: [] });
    groups.get(key).records.push(s);
  }

  const shows = [...groups.values()].map(({ entry, records }) => mergeGroup(records, entry));
  shows.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.venue || "").localeCompare(b.venue || ""));

  return {
    shows,
    stats: {
      rawCount: rawShows.length,
      mergedCount: shows.length,
      droppedOffList: droppedCount,
      duplicatesCollapsed: rawShows.length - droppedCount - shows.length,
      hoodMissing: shows.filter((s) => !s.hood).length,
      unresolvedVenues: [...unresolved.entries()].sort((a, b) => b[1] - a[1]),
    },
  };
}

// ---------------- CLI ----------------
function parseArgs(argv) {
  const a = { in: [], registry: "./venue-registry.json", out: "./data/shows.json" };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--in") { a.in.push(v); i++; }
    else if (k === "--registry") { a.registry = v; i++; }
    else if (k === "--out") { a.out = v; i++; }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.in.length) { console.error("Provide at least one --in <raw-source.json>"); process.exit(1); }
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");

  const registry = JSON.parse(await readFile(args.registry, "utf8"));
  const raw = [];
  for (const f of args.in) {
    const arr = JSON.parse(await readFile(f, "utf8"));
    raw.push(...arr);
    console.error(`  loaded ${arr.length} from ${f}`);
  }

  const { shows, stats } = normalize(raw, registry);

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(shows, null, 2));

  console.error(`\n✓ ${stats.mergedCount} shows → ${args.out}`);
  console.error(`  raw ${stats.rawCount} · dropped off-list ${stats.droppedOffList} · duplicates collapsed ${stats.duplicatesCollapsed} · hood missing ${stats.hoodMissing}`);
  if (stats.unresolvedVenues.length) {
    console.error(`\n  Off-list venues dropped (not in ${args.registry}):`);
    for (const [name, n] of stats.unresolvedVenues.slice(0, 40)) console.error(`    ${n.toString().padStart(3)}  ${name}`);
    if (stats.unresolvedVenues.length > 40) console.error(`    … +${stats.unresolvedVenues.length - 40} more`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e.message || e); process.exit(1); });
