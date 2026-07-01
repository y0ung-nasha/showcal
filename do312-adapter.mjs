#!/usr/bin/env node
/**
 * do312-adapter.mjs — Do312 venue-page adapter
 * Chicago Show Calendar pipeline · Tier 3 source (breadth net)
 *
 * Each Do312 venue page lists upcoming events as schema.org microdata
 * event-cards (itemtype="http://schema.org/Event") with name, startDate,
 * image, location, and a "Free" banner for free shows. One fetch per venue.
 *
 * USAGE
 *   node do312-adapter.mjs --venues ./do312-venues.json [--out ./data/do312-shows.json] [--delay 700]
 *   do312-venues.json: [{ "id","name","hood","do312Url":"https://do312.com/venues/<slug>" }]
 */

import { pathToFileURL } from "node:url";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); }

const onlyDate = (s) => (typeof s === "string" && s.match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
const onlyTime = (s) => { const m = typeof s === "string" && s.match(/T(\d{2}:\d{2})/); return m ? m[1] : null; };
function slotFromTime(t) {
  if (!t) return null;
  const h = parseInt(t.slice(0, 2), 10);
  if (h >= 22 || h < 4) return "late";
  if (h < 16) return "afternoon";
  return "evening";
}
const decodeEntities = (s) => String(s || "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

// ---- card extraction ----
// Split the page into one block per Event itemscope. Each card is a balanced
// <div class="ds-listing event-card ...">…</div>, but doing real depth-counting
// on regex is fragile — we slice from each card opener to the *next* card opener
// (or end of file). That's enough for the field-level extraction below.
function extractEventCards(html) {
  const opener = /<div[^>]*class="[^"]*ds-listing[^"]*event-card[^"]*"[^>]*itemtype="http:\/\/schema\.org\/Event"[^>]*>/g;
  const opens = [];
  let m;
  while ((m = opener.exec(html))) opens.push(m.index);
  const cards = [];
  for (let i = 0; i < opens.length; i++) {
    const start = opens[i];
    const end = i + 1 < opens.length ? opens[i + 1] : html.length;
    cards.push(html.slice(start, end));
  }
  return cards;
}

function field(card, re) { const m = card.match(re); return m ? decodeEntities(m[1]).trim() : null; }

function parseCard(card, cfg) {
  const permalink = field(card, /data-permalink="([^"]+)"/);
  const name = field(card, /itemprop="name"[^>]*>([^<]+)<\/span>/);
  const startISO = field(card, /itemprop="startDate"[^>]*(?:datetime|content)="([^"]+)"/);
  const venueName = field(card, /itemprop="location"[^>]*>[\s\S]*?itemprop="name"[^>]*>([^<]+)<\/span>/)
                 || field(card, /class="ds-venue-name"[^>]*>[\s\S]*?<span itemprop="name">([^<]+)<\/span>/);
  const streetAddress = field(card, /itemprop="streetAddress"[^>]*content="([^"]*)"/);
  const city = field(card, /itemprop="addressLocality"[^>]*content="([^"]*)"/);
  const isFree = /ds-listing-soldout[\s\S]*?>\s*Free\s*</i.test(card);
  const cover = field(card, /background-image:url\('([^']+)'\)/);

  const date = onlyDate(startISO);
  if (!date) return null;
  const time = onlyTime(startISO);

  // Split "Headliner / Opener A / Opener B" into a lineup.
  // Some bills also use " w/ " ("FREE MONDAY w/ Band1 / Band2") — split there too.
  const cleanName = (name || "").replace(/^\s*FREE\s+MONDAY\s+w\/\s*/i, "").trim();
  const lineup = cleanName.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  let headliners, openers;
  if (lineup.length) {
    headliners = [{ name: lineup[0], genre: "music", role: "headliner" }];
    openers = lineup.slice(1).map((n) => ({ name: n, genre: "music", role: "opener" }));
  } else {
    headliners = [{ name: name || cfg.name || "TBD", genre: "music", role: "headliner" }];
    openers = [];
  }

  const venue = cfg.name || venueName || null;
  const ticketUrl = permalink ? `https://do312.com${permalink}` : null;

  return {
    id: "do_" + djb2(`${venue}|${date}|${cleanName}`),
    source: "do312",
    sourceList: ["do312"],
    date,
    time,
    slot: slotFromTime(time),
    venue,
    rawVenue: venueName,
    hood: cfg.hood || null,
    headliners,
    openers,
    genres: [],
    price: isFree ? "FREE" : null,
    age: null,
    ticketUrl,
    poster: cover || null,
    venueInfo: {
      name: venue,
      address: streetAddress || null,
      city: city || null,
      url: cfg.do312Url || null,
    },
  };
}

export function harvestDo312Page(html, cfg) {
  const out = [];
  const seen = new Set();
  for (const card of extractEventCards(html)) {
    const show = parseCard(card, cfg);
    if (!show) continue;
    if (seen.has(show.id)) continue;
    seen.add(show.id);
    out.push(show);
  }
  return out;
}

// ---- detail-page enrichment ----
// Event detail pages carry richer data than the venue listing: precise
// startDate (with time), Offer.price, and prose age hints ("21+", "All Ages").
// Doors/Show clocks are also embedded in the description text.
export function parseDetail(html) {
  const startDate = (html.match(/itemprop="startDate"[^>]*(?:datetime|content)="([^"]+)"/) || [])[1] || null;
  const priceTitle = (html.match(/itemprop="price"[^>]*title="([^"]+)"/)
                  || html.match(/title="([^"]+)"[^>]*itemprop="price"/) || [])[1] || null;
  const descBlock = (html.match(/class="ds-event-description-inner[^"]*"[^>]*>([\s\S]{0,4000}?)<\/div>/) || [])[1] || "";
  const descText = descBlock.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const ageMatch = descText.match(/\b(\d{2})\s*\+/) || (descText.match(/\ball\s*ages\b/i) ? [null, "ALL"] : null);
  const doorsMatch = descText.match(/Doors?:?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i);
  const showMatch = descText.match(/Show(?:time)?:?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i);

  let price = null;
  if (priceTitle) {
    const clean = priceTitle.replace(/[$,]/g, "").trim();
    if (/free/i.test(priceTitle)) price = "FREE";
    else if (clean && !Number.isNaN(Number(clean))) price = Number(clean);
  }

  let age = null;
  if (ageMatch) age = ageMatch[1] === "ALL" ? "ALL AGES" : `${ageMatch[1]}+`;

  const time = (startDate || "").match(/T(\d{2}:\d{2})/)?.[1] || null;

  return {
    startDate,
    time,
    price,
    age,
    doors: doorsMatch?.[1] || null,
    showtime: showMatch?.[1] || null,
  };
}

export async function enrichShow(show) {
  if (!show.ticketUrl || !show.ticketUrl.startsWith("http")) return show;
  const html = await getHtml(show.ticketUrl);
  const d = parseDetail(html);
  return {
    ...show,
    time: d.time || show.time,
    slot: slotFromTime(d.time || show.time),
    price: show.price ?? d.price,
    age: d.age ?? show.age,
    doors: d.doors,
    showtime: d.showtime,
  };
}

async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// ---- CLI ----
function parseArgs(argv) {
  const a = { venues: "./do312-venues.json", out: "./data/do312-shows.json", delay: 700, enrich: false, enrichDelay: 500, enrichMax: 0 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--venues") { a.venues = v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--delay") { a.delay = parseInt(v, 10); i++; }
    else if (k === "--enrich") { a.enrich = true; }
    else if (k === "--enrich-delay") { a.enrichDelay = parseInt(v, 10); i++; }
    else if (k === "--enrich-max") { a.enrichMax = parseInt(v, 10); i++; }
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

  console.error(`Do312 harvest · ${venues.length} venues`);
  const all = [];
  for (const cfg of venues) {
    process.stderr.write(`  ${cfg.id} ...`);
    try {
      const shows = harvestDo312Page(await getHtml(cfg.do312Url), cfg);
      all.push(...shows);
      console.error(` ${shows.length} shows`);
    } catch (e) {
      console.error(` ERROR ${e.message}`);
    }
    await sleep(args.delay);
  }
  all.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (args.enrich) {
    // Enrich only future shows — stale/past events aren't worth the round trip.
    const today = new Date().toISOString().slice(0, 10);
    let targets = all.filter((s) => s.date >= today);
    if (args.enrichMax > 0) targets = targets.slice(0, args.enrichMax);
    console.error(`\nEnriching ${targets.length}/${all.length} future shows (delay=${args.enrichDelay}ms)`);
    let ok = 0, fail = 0, pricedNew = 0, agedNew = 0;
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      try {
        const before = { p: s.price, a: s.age };
        const enriched = await enrichShow(s);
        Object.assign(s, enriched);
        if (before.p == null && s.price != null) pricedNew++;
        if (before.a == null && s.age != null) agedNew++;
        ok++;
      } catch (e) {
        fail++;
      }
      if ((i + 1) % 25 === 0) {
        process.stderr.write(`  ${i + 1}/${targets.length}  ok=${ok} fail=${fail} +price=${pricedNew} +age=${agedNew}\n`);
      }
      await sleep(args.enrichDelay);
    }
    console.error(`  done: ok=${ok} fail=${fail} price-filled=${pricedNew} age-filled=${agedNew}`);
  }

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(all, null, 2));
  console.error(`\n✓ ${all.length} Do312 shows → ${args.out}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e.message || e); process.exit(1); });
