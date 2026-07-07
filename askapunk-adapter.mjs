#!/usr/bin/env node
/**
 * askapunk-adapter.mjs — Chicago Ask A Punk (Gancio instance)
 * DIY punk/hardcore calendar covering registry venues like Casa Cafe and
 * Bricktown that publish nowhere else. Off-list venues drop out in normalize.
 *
 * USAGE: node askapunk-adapter.mjs [--out ./data/askapunk-shows.json]
 */

import { pathToFileURL } from "node:url";

const BASE = "https://chicago.askapunk.net";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); }

const CHI_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
function chiDateTime(epochSec) {
  const parts = Object.fromEntries(CHI_FMT.formatToParts(new Date(epochSec * 1000)).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}
function slotFromTime(t) {
  if (!t) return null;
  const h = parseInt(t.slice(0, 2), 10);
  if (h >= 22 || h < 4) return "late";
  if (h < 16) return "afternoon";
  return "evening";
}

async function main() {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "./data/askapunk-shows.json";

  const res = await fetch(`${BASE}/api/events`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${BASE}/api/events`);
  const events = await res.json();

  const shows = events.map((e) => {
    if (!e.start_datetime || !e.place?.name) return null;
    const { date, time } = chiDateTime(e.start_datetime);
    // the title is the bill ("BAND (MN), BAND (IA), BAND"); tags are unreliable (ages, misc)
    const lineup = String(e.title || "")
      .split(/\s*[,/]\s*|\s+w\/\s+/i)
      .map((s) => s.replace(/\s*\([A-Z]{2}\)\s*$/, "").trim())
      .filter(Boolean);
    if (!lineup.length) return null;
    return {
      id: "aap_" + djb2(`${e.place.name}|${date}|${lineup[0]}`),
      source: "askapunk",
      sourceList: ["askapunk"],
      date, time, slot: slotFromTime(time),
      venue: e.place.name, rawVenue: e.place.name, hood: null,
      headliners: [{ name: lineup[0], genre: "music", role: "headliner" }],
      openers: lineup.slice(1).map((n) => ({ name: n, genre: "music", role: "opener" })),
      genres: [],
      price: null, age: null,
      ticketUrl: e.slug ? `${BASE}/event/${e.slug}` : null,
      poster: e.media?.[0]?.url ? `${BASE}/media/${e.media[0].url}` : null,
      venueInfo: { name: e.place.name, address: e.place.address || null, city: "Chicago", url: BASE },
    };
  }).filter(Boolean);

  shows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(shows, null, 2));
  console.error(`✓ ${shows.length} Ask A Punk shows → ${out}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e.message || e); process.exit(1); });
