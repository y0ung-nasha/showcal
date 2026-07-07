#!/usr/bin/env node
/**
 * coverage.mjs — regenerate venue-coverage.csv from the registry, adapter
 * configs, and the current shows.json. Run after any pipeline change.
 *
 * USAGE: node coverage.mjs   (writes ./venue-coverage.csv)
 */
import { readFile, writeFile } from "node:fs/promises";

const [registry, do312, jsonld, shows] = await Promise.all([
  readFile("./venue-registry.json", "utf8").then(JSON.parse),
  readFile("./do312-venues.json", "utf8").then(JSON.parse),
  readFile("./jsonld-venues.json", "utf8").then(JSON.parse),
  readFile("./shows.json", "utf8").then(JSON.parse),
]);
// one-off adapter's venue list (ids + sites)
const { default: oneoffIds } = await import("./oneoff-adapter.mjs").then(async () => {
  const src = await readFile("./oneoff-adapter.mjs", "utf8");
  const ids = [...src.matchAll(/^\s*id:\s*"([a-z0-9-]+)"/gm)].map((m) => m[1]);
  return { default: new Set(ids) };
});

// venues with no scrapeable source, and why (from the 2026-07 source audit)
const NOTES = {
  "golden-dagger": "CLOSED late 2023 (now Hunters on Halsted dog bar); goldendagger.com lapsed",
  "trace": "Temporarily closed — site says 'Closed for Remodel'; re-check later",
  "primary": "Open again; primarychi.com domain hijacked (spam) — sourced via Do312",
  "kimbark-fourth-state": "Hyde Park promoter collective, likely wound down (farewell show on RA)",
  "berwyn-stage": "Midsommarfest festival stage (Clark & Berwyn) — not a year-round venue",
  "2153-w-irving-park-rd": "Painters' union rental hall — one-off DIY shows, no calendar",
  "868-n-franklin-street": "Private-rental event space (Experience 868) — no public calendar",
  "wax": "IG-only (@waxvinylbar) — Wix site has no live events data",
  "sweethearts-bar": "IG-only (@sweetheartschicago) — no events page, no Do312",
  "cafe-modulaire": "IG-only (@cafe.modulaire) — Cargo site, no calendar",
  "los-globos": "IG-only (@losgloboschicago); Tickeri venue page exists but currently empty",
  "stardust-lounge": "Promo site only (stardustchi.com) — no listings feed found",
  "three-top-lounge": "No calendar anywhere (16\" On Center property) — IG @threetoplounge",
  "tao": "Events render via UrVenue/SevenRooms JS apps — no plain-fetch source",
  "brudder-s-sports-bar": "Site is a JS pizza-platform SPA — no events data",
  "home-away-from-home": "Site has prose only ('live music weekly'), no listings — socials",
  "parallel-play": "Roving community org — Eventbrite organizer page is JS-only",
  "richard-j-daley-bridgeport-library": "CPL BiblioCommons events (chipublib.bibliocommons.com) — identified, not implemented",
  "giant-penny-whistle-tavern": "Wix /shows page renders empty — IG flyers; Do312 configured as fallback",
  "la-nightclub": "Do312 + DICE profile exist but currently empty — nightclub one-offs",
  "the-mine": "Do312 (the-mine-music-hall); own site is JS-only",
  "bricktown": "Ask A Punk + IG (@bricktownchicago)",
  "casa-cafe": "Ask A Punk (Gancio API) — South Side DIY anchor",
  "broken-shaker": "Open (Freehand Hotel cocktail bar) — DJ one-offs on IG, no calendar feed",
  "cobb-hall": "UChicago classroom building (Renaissance Society upstairs) — no own calendar; Do312/Renaissance Society cover it",
  "judson-moore": "Events page is a DICE JS embed widget (widgets.dice.fm) — no plain-fetch source; watch DICE browse",
};

const norm = (s) => String(s || "").toLowerCase().trim().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const byNorm = new Map();
for (const e of registry) {
  byNorm.set(norm(e.name), e.id);
  for (const a of e.aliases || []) byNorm.set(norm(a), e.id);
}
const do312ById = new Map();
for (const c of do312) { const id = byNorm.get(norm(c.name)) || c.id; do312ById.set(id, c.do312Url); }
const jsonldById = new Map();
for (const c of jsonld) { const id = byNorm.get(norm(c.name)) || c.id; jsonldById.set(id, c.url); }

const showsByVenue = new Map();
const sourcesByVenue = new Map();
for (const s of shows) {
  if (!s.venueId) continue;
  showsByVenue.set(s.venueId, (showsByVenue.get(s.venueId) || 0) + 1);
  const set = sourcesByVenue.get(s.venueId) || new Set();
  for (const src of s.sourceList || []) set.add(src);
  sourcesByVenue.set(s.venueId, set);
}

const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rows = [["Venue", "Neighborhood", "Address", "Website", "Source(s) configured", "Source status", "Shows in shows.json", "Sources returning data", "Do312 URL", "JSON-LD URL", "Registry ID", "Notes"]];

const entries = registry.map((e) => {
  const configured = [];
  if (do312ById.has(e.id)) configured.push("Do312");
  if (jsonldById.has(e.id)) configured.push("JSON-LD");
  if (oneoffIds.has(e.id)) configured.push("One-off");
  const returning = [...(sourcesByVenue.get(e.id) || [])].sort();
  if (returning.includes("dice") && !configured.includes("DICE")) configured.push("DICE");
  if (returning.includes("askapunk") && !configured.includes("AskAPunk")) configured.push("AskAPunk");
  const count = showsByVenue.get(e.id) || 0;
  const status = count > 0 ? "Established" : configured.length ? "Configured but no data" : "No source";
  return { e, configured, returning, count, status };
});
entries.sort((a, b) => b.count - a.count || a.e.name.localeCompare(b.e.name));
for (const { e, configured, returning, count, status } of entries) {
  rows.push([
    e.name, e.hood || "", e.address || "", e.website || "",
    configured.join("; "), status, count, returning.join("; "),
    do312ById.get(e.id) || "", jsonldById.get(e.id) || "", e.id, NOTES[e.id] || "",
  ]);
}

await writeFile("./venue-coverage.csv", rows.map((r) => r.map(esc).join(",")).join("\n") + "\n");
const stat = { Established: 0, "Configured but no data": 0, "No source": 0 };
for (const { status } of entries) stat[status]++;
console.log(`✓ venue-coverage.csv · ${registry.length} venues · ${stat.Established} established · ${stat["Configured but no data"]} configured-no-data · ${stat["No source"]} no-source`);
