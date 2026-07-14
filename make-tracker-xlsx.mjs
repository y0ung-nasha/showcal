#!/usr/bin/env node
/**
 * make-tracker-xlsx.mjs — build a styled, multi-tab venue-tracker.xlsx from the
 * registry, adapter configs, and current shows.json. Companion to coverage.mjs
 * (which emits the flat CSV); this produces the color-coded Excel workbook.
 *
 * DEPENDENCY: exceljs (not vendored — this is a no-build repo). Resolve it via
 * NODE_PATH so nothing lands in git:
 *   NODE_PATH=/path/to/node_modules node make-tracker-xlsx.mjs
 * In CI the workflow runs `npm i exceljs` and sets NODE_PATH to that install.
 *
 * OUTPUT: ./venue-tracker.xlsx  (sheets: Summary, All Venues, Established,
 *          Configured – No Data, No Source)
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs"); // honors NODE_PATH via CommonJS resolution

// ---- load data (same inputs + id-matching as coverage.mjs) ----
const [registry, do312, jsonld, shows] = await Promise.all([
  readFile("./venue-registry.json", "utf8").then(JSON.parse),
  readFile("./do312-venues.json", "utf8").then(JSON.parse),
  readFile("./jsonld-venues.json", "utf8").then(JSON.parse),
  readFile("./shows.json", "utf8").then(JSON.parse),
]);
const oneoffSrc = await readFile("./oneoff-adapter.mjs", "utf8");
const oneoffIds = new Set([...oneoffSrc.matchAll(/^\s*id:\s*"([a-z0-9-]+)"/gm)].map((m) => m[1]));

// notes: mirror coverage.mjs's audit table so the workbook is self-explaining
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
  "richard-j-daley-bridgeport-library": "CPL BiblioCommons events — identified, not implemented",
  "giant-penny-whistle-tavern": "Wix /shows page renders empty — IG flyers; Do312 configured as fallback",
  "la-nightclub": "Do312 + DICE profile exist but currently empty — nightclub one-offs",
  "the-mine": "Do312 (the-mine-music-hall); own site is JS-only",
  "bricktown": "Ask A Punk + IG (@bricktownchicago)",
  "casa-cafe": "Ask A Punk (Gancio API) — South Side DIY anchor",
  "broken-shaker": "Open (Freehand Hotel cocktail bar) — DJ one-offs on IG, no calendar feed",
  "cobb-hall": "UChicago classroom building (Renaissance Society upstairs) — Do312/Renaissance cover it",
  "judson-moore": "Events page is a DICE JS embed widget — no plain-fetch source; watch DICE browse",
};

const norm = (s) => String(s || "").toLowerCase().trim().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const byNorm = new Map();
for (const e of registry) { byNorm.set(norm(e.name), e.id); for (const a of e.aliases || []) byNorm.set(norm(a), e.id); }
const do312ById = new Map();
for (const c of do312) do312ById.set(byNorm.get(norm(c.name)) || c.id, c.do312Url);
const jsonldById = new Map();
for (const c of jsonld) jsonldById.set(byNorm.get(norm(c.name)) || c.id, c.url);

const showsByVenue = new Map(), sourcesByVenue = new Map();
for (const s of shows) {
  if (!s.venueId) continue;
  showsByVenue.set(s.venueId, (showsByVenue.get(s.venueId) || 0) + 1);
  const set = sourcesByVenue.get(s.venueId) || new Set();
  for (const src of s.sourceList || []) set.add(src);
  sourcesByVenue.set(s.venueId, set);
}

const entries = registry.map((e) => {
  const configured = [];
  if (do312ById.has(e.id)) configured.push("Do312");
  if (jsonldById.has(e.id)) configured.push("JSON-LD");
  if (oneoffIds.has(e.id)) configured.push("One-off");
  const returning = [...(sourcesByVenue.get(e.id) || [])].sort();
  if (returning.includes("dice") && !configured.includes("DICE")) configured.push("DICE");
  if (returning.includes("askapunk") && !configured.includes("AskAPunk")) configured.push("AskAPunk");
  const count = showsByVenue.get(e.id) || 0;
  const status = count > 0 ? "Established" : configured.length ? "Configured – No Data" : "No Source";
  return { e, configured, returning, count, status };
});
entries.sort((a, b) => b.count - a.count || a.e.name.localeCompare(b.e.name));

// ---- data-window facts for the summary sheet ----
const dates = shows.map((s) => s.date).filter(Boolean).sort();
const dataFrom = dates[0] || "—", dataTo = dates[dates.length - 1] || "—";
const counts = { "Established": 0, "Configured – No Data": 0, "No Source": 0 };
for (const x of entries) counts[x.status]++;

// ---- workbook ----
const FILL = {
  "Established": "FFC6EFCE",
  "Configured – No Data": "FFFFEB9C",
  "No Source": "FFFFC7CE",
};
const FONT = {
  "Established": "FF006100",
  "Configured – No Data": "FF9C6500",
  "No Source": "FF9C0006",
};
const HEADERS = ["Venue", "Neighborhood", "Address", "Website", "Source(s) configured", "Status", "Shows in shows.json", "Sources returning data", "Do312 URL", "JSON-LD URL", "Registry ID", "Notes"];
const WIDTHS = [28, 18, 26, 34, 20, 20, 10, 20, 40, 40, 26, 50];

const wb = new ExcelJS.Workbook();
wb.creator = "showcal coverage tool";

function rowFor({ e, configured, returning, count, status }) {
  return [
    e.name, e.hood || "", e.address || "", e.website || "",
    configured.join("; "), status, count, returning.join("; "),
    do312ById.get(e.id) || "", jsonldById.get(e.id) || "", e.id, NOTES[e.id] || "",
  ];
}

function buildSheet(name, tabColor, rows, { colorByStatus = false } = {}) {
  const ws = wb.addWorksheet(name, {
    properties: tabColor ? { tabColor: { argb: tabColor } } : {},
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = HEADERS.map((h, i) => ({ header: h, width: WIDTHS[i] }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2B2B2B" } };
  header.alignment = { vertical: "middle" };
  header.height = 20;
  for (const r of rows) {
    const row = ws.addRow(rowFor(r));
    row.alignment = { vertical: "top", wrapText: false };
    const statusCell = row.getCell(6);
    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[r.status] } };
    statusCell.font = { color: { argb: FONT[r.status] }, bold: true };
    if (colorByStatus) {
      row.getCell(1).font = { bold: true };
    }
    // make URL cells look like links
    for (const ci of [4, 9, 10]) {
      const c = row.getCell(ci);
      if (c.value) { c.value = { text: String(c.value), hyperlink: String(c.value) }; c.font = { color: { argb: "FF0563C1" }, underline: true }; }
    }
    row.getCell(7).alignment = { horizontal: "center" };
    row.getCell(12).alignment = { wrapText: true, vertical: "top" };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
  return ws;
}

// Summary sheet
const sum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF2B2B2B" } } });
sum.columns = [{ width: 30 }, { width: 16 }, { width: 60 }];
sum.mergeCells("A1:C1");
sum.getCell("A1").value = "Chicago Show Calendar — Venue Coverage Tracker";
sum.getCell("A1").font = { bold: true, size: 16 };
sum.getCell("A1").alignment = { vertical: "middle" };
sum.getRow(1).height = 26;
const meta = [
  ["", "", ""],
  ["Venues in registry", registry.length, ""],
  ["Shows in shows.json", shows.length, `date range ${dataFrom} → ${dataTo}`],
  ["", "", ""],
  ["Established (source + data)", counts["Established"], "green — venue is on the site with upcoming shows"],
  ["Configured – No Data", counts["Configured – No Data"], "yellow — source wired up but 0 upcoming shows in this snapshot"],
  ["No Source", counts["No Source"], "red — no source returning data (see Notes; most are closed / IG-only / JS-only)"],
];
for (const [k, v, note] of meta) {
  const r = sum.addRow([k, v, note]);
  if (k) r.getCell(1).font = { bold: true };
  if (k in FILL) {
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[k] } };
    r.getCell(1).font = { bold: true, color: { argb: FONT[k] } };
    r.getCell(2).font = { bold: true };
  }
}
sum.addRow(["", "", ""]);
sum.addRow(["Generated", "", "run `node coverage.mjs` (CSV) + `make-tracker-xlsx.mjs` (this workbook) after each pull"]).getCell(1).font = { italic: true };

// Data sheets
buildSheet("All Venues", "FF4472C4", entries, { colorByStatus: true });
buildSheet("Established", "FF00B050", entries.filter((x) => x.status === "Established"));
buildSheet("Configured – No Data", "FFFFC000", entries.filter((x) => x.status === "Configured – No Data"));
buildSheet("No Source", "FFFF0000", entries.filter((x) => x.status === "No Source"));

await wb.xlsx.writeFile("./venue-tracker.xlsx");
console.log(`✓ venue-tracker.xlsx · ${registry.length} venues · ${counts["Established"]} established · ${counts["Configured – No Data"]} configured-no-data · ${counts["No Source"]} no-source`);
