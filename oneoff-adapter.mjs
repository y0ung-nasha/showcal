#!/usr/bin/env node
/**
 * oneoff-adapter.mjs — per-venue "official site" scrapers
 * Chicago Show Calendar pipeline · venues whose calendar needs a bespoke pull
 * (Squarespace JSON, Wix warmup data, SpotHopper, turntabletickets, plain HTML).
 *
 * Emits the common show schema with source "venue-site" (highest merge priority).
 *
 * USAGE
 *   node oneoff-adapter.mjs [--out ./data/oneoff-shows.json] [--only <venueId>] [--delay 400]
 */

import { pathToFileURL } from "node:url";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); }

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/json,*/*" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
async function getJson(url) { return JSON.parse(await getText(url)); }

const decodeEntities = (s) => String(s || "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const stripTags = (s) => decodeEntities(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// ---- date/time helpers (everything renders in America/Chicago) ----
const CHI_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
// epoch ms or ISO string (with offset/Z) -> { date: "YYYY-MM-DD", time: "HH:MM" } in Chicago
function chiDateTime(input) {
  const d = typeof input === "number" ? new Date(input) : new Date(String(input));
  if (Number.isNaN(d.getTime())) return { date: null, time: null };
  const parts = Object.fromEntries(CHI_FMT.formatToParts(d).map((p) => [p.type, p.value]));
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
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function monthNum(name) { return MONTHS[String(name).slice(0, 3).toLowerCase()] || null; }
// "Jul 17" style with no year: assume the next occurrence (>= ~today - 7d grace)
function inferYear(month, day) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  let y = now.getFullYear();
  const candidate = new Date(y, month - 1, day);
  const grace = new Date(now); grace.setDate(grace.getDate() - 7);
  if (candidate < grace) y += 1;
  return y;
}
const pad = (n) => String(n).padStart(2, "0");
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
// guard for year-inferred dates scraped next to a weekday label: a stale page
// (e.g. Arbella still showing June in July) would otherwise mint phantom
// next-year shows — the weekday won't line up, so drop those.
function dowMatches(dowName, dateStr) {
  const want = DOW[String(dowName).slice(0, 3).toLowerCase()];
  if (want == null) return true;
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === want;
}
function to24h(s) {
  const m = String(s || "").match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return `${pad(h)}:${m[2] || "00"}`;
}
function todayChi() {
  const { date } = chiDateTime(Date.now());
  return date;
}

// ---- common record builder ----
function mkShow(v, { title, date, time = null, price = null, age = null, ticketUrl = null, poster = null, openers = [] }) {
  const name = decodeEntities(title).trim();
  if (!name || !date) return null;
  const lineup = name.replace(/\s+w\/\s*/gi, " / ").split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  const headliners = [{ name: lineup[0] || name, genre: "music", role: "headliner" }];
  const rest = [...lineup.slice(1).map((n) => ({ name: n, genre: "music", role: "opener" })), ...openers];
  return {
    id: "os_" + djb2(`${v.name}|${date}|${lineup[0] || name}`),
    source: "venue-site",
    sourceList: ["venue-site"],
    date, time, slot: slotFromTime(time),
    venue: v.name, rawVenue: v.name, hood: v.hood || null,
    headliners, openers: rest, genres: [],
    price, age, ticketUrl, poster,
    venueInfo: { name: v.name, address: v.address || null, city: "Chicago", url: v.site || null },
  };
}
const futureOnly = (shows) => { const t = todayChi(); return shows.filter((s) => s && s.date && s.date >= t); };
const firstMatch = (s, re) => (s.match(re) || [])[1] || null;

// ================= platform helpers =================

// Squarespace: <collection>?format=json -> { upcoming: [...] } (startDate = epoch ms)
async function squarespaceEvents(v, path, { ticketFromBody = false } = {}) {
  const j = await getJson(`${v.site}${path}?format=json`);
  const items = j.upcoming || j.items || [];
  return items.map((it) => {
    const { date, time } = chiDateTime(it.startDate);
    let ticketUrl = /^https?:/.test(it.sourceUrl || "") ? it.sourceUrl : (it.fullUrl ? `${v.site}${it.fullUrl}` : null);
    let price = null;
    if (ticketFromBody) {
      const body = `${it.excerpt || ""} ${it.body || ""}`;
      ticketUrl = firstMatch(body, /href="(https?:\/\/(?:www\.)?(?:ticketweb|eventbrite|dice|etix|seetickets)\.[^"]+)"/i) || ticketUrl;
      const p = firstMatch(stripTags(body), /(?:ticket price|price|cover)[:\s]*\$(\d+(?:\.\d{2})?)/i);
      if (p) price = Number(p);
    }
    return mkShow(v, { title: it.title, date, time, ticketUrl, price, poster: it.assetUrl || null });
  }).filter(Boolean);
}

// Wix: <script id="wix-warmup-data"> -> appsWarmupData[<guid>][widget].events.events
async function wixEvents(v, path) {
  const html = await getText(`${v.site}${path}`);
  const raw = firstMatch(html, /<script[^>]*id="wix-warmup-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!raw) return [];
  let warm;
  try { warm = JSON.parse(raw); } catch { return []; }
  const events = [];
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      if (Array.isArray(n.events) && n.events[0] && (n.events[0].scheduling || n.events[0].slug)) events.push(...n.events);
      else for (const val of Object.values(n)) walk(val);
    }
  })(warm.appsWarmupData || warm);
  return events
    .filter((e) => !/cancell?ed/i.test(e.status || ""))
    .map((e) => {
      const start = e.scheduling?.config?.startDate || e.scheduling?.startDate;
      if (!start) return null;
      const { date, time } = chiDateTime(start);
      return mkShow(v, {
        title: e.title, date, time,
        ticketUrl: e.slug ? `${v.site}/event-details/${e.slug}` : null,
        poster: e.mainImage?.url || null,
      });
    }).filter(Boolean);
}

// ================= venue parsers =================

const VENUES = [
  {
    id: "jazz-showcase", name: "Jazz Showcase", hood: "South Loop", site: "https://www.jazzshowcase.com",
    // turntabletickets public API: one record per set, exact datetimes
    async pull(v) {
      const shows = [];
      for (let page = 1; page <= 12; page++) {
        let j;
        try { j = await getJson(`https://jazzshowcase.turntabletickets.com/api/performance/?page_size=100&page=${page}`); }
        catch { break; }
        for (const r of j.results || []) {
          if (!r.datetime) continue;
          const { date, time } = chiDateTime(r.datetime);
          const showId = r.show_id ?? r.show?.id;
          shows.push(mkShow(v, {
            title: r.show?.name || r.name || "TBD", date, time,
            ticketUrl: showId ? `https://jazzshowcase.turntabletickets.com/shows/${showId}/?date=${date}` : "https://www.jazzshowcase.com/nowplaying",
          }));
        }
        if (page * (j.pageSize || 100) >= (j.count || 0)) break;
        await sleep(250);
      }
      // one set per show per day is enough for the calendar — keep the earliest set
      const byKey = new Map();
      for (const s of futureOnly(shows)) {
        const k = `${s.date}|${s.headliners[0].name}`;
        if (!byKey.has(k) || (s.time || "99") < (byKey.get(k).time || "99")) byKey.set(k, s);
      }
      return [...byKey.values()];
    },
  },
  {
    id: "rosa-s-lounge", name: "Rosa's Lounge", hood: "Logan Square", site: "https://www.rosaslounge.com", address: "3420 W Armitage Ave.",
    // inline JSON-LD Place with an Events array (startDate is UTC "Z")
    async pull(v) {
      const html = await getText(`${v.site}/calendar`);
      const raw = firstMatch(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (!raw) return [];
      const j = JSON.parse(raw);
      return futureOnly((j.Events || j.events || []).map((e) => {
        const { date, time } = chiDateTime(e.startDate);
        return mkShow(v, { title: e.name, date, time, ticketUrl: e.url || null, poster: e.image || null });
      }));
    },
  },
  {
    id: "buddy-guy-s-legends", name: "Buddy Guy's Legends", hood: "South Loop", site: "https://buddyguy.com", address: "700 S Wabash Ave",
    // Rockhouse (RHP) WordPress listing; date has no year -> infer
    async pull(v) {
      const html = await getText(`${v.site}/events/`);
      const blocks = html.split(/rhpSingleEvent/).slice(1);
      return futureOnly(blocks.map((b) => {
        const title = firstMatch(b, /<a[^>]*title="([^"]+)"[^>]*rel="bookmark"/) || firstMatch(b, /<a[^>]*rel="bookmark"[^>]*title="([^"]+)"/);
        const dateTxt = stripTags(firstMatch(b, /id="eventDate"[^>]*>([\s\S]*?)<\/div>/) || "");
        const m = dateTxt.match(/(?:([A-Za-z]{3,9}),\s*)?([A-Za-z]{3,9})\s+(\d{1,2})/);
        if (!title || !m) return null;
        const mo = monthNum(m[2]); if (!mo) return null;
        const date = `${inferYear(mo, +m[3])}-${pad(mo)}-${pad(+m[3])}`;
        if (m[1] && !dowMatches(m[1], date)) return null;
        const priceTxt = stripTags(firstMatch(b, /rhp-event__cost[^"]*"[^>]*>([\s\S]*?)<\//) || "");
        const price = priceTxt.includes("$") ? Number(priceTxt.replace(/[^0-9.]/g, "")) || null : null;
        const ticketUrl = firstMatch(b, /rhp-event-cta[^"]*"[^>]*>[\s\S]{0,300}?<a[^>]*href="([^"]+)"/);
        const time = to24h(stripTags(firstMatch(b, /rhp-event__time[^"]*"[^>]*>([\s\S]*?)<\//) || ""));
        return mkShow(v, { title, date, time, price, ticketUrl });
      }));
    },
  },
  {
    id: "garcia-s", name: "Garcia's", hood: "West Loop", site: "https://garciaschicago.live", address: "1001 W Washington Blvd",
    // date lives in the Ticketmaster URL slug: ...-MM-DD-YYYY/event/...
    async pull(v) {
      const html = await getText(`${v.site}/shows`);
      const blocks = html.split(/class=['"][^'"]*gct-event-item/).slice(1);
      return futureOnly(blocks.map((b) => {
        const tm = firstMatch(b, /href=['"]([^'"]+)['"][^>]*class=['"][^'"]*gct-event-ticket-btn/) || firstMatch(b, /href=['"]([^'"]*ticketmaster\.com[^'"]*)['"]/);
        const title = stripTags(firstMatch(b, /class=['"]gct-event-title['"][^>]*>([\s\S]*?)<\/h/) || "");
        if (!title) return null;
        // best date source: TM slug ...-MM-DD-YYYY/event/; fall back to the month/day tiles
        let date = null;
        const dm = (tm || "").match(/-(\d{2})-(\d{2})-(\d{4})\//);
        if (dm) date = `${dm[3]}-${dm[1]}-${dm[2]}`;
        else {
          const mo = monthNum(firstMatch(b, /m-date__month['"][^>]*>([A-Za-z]+)</) || "");
          const dd = firstMatch(b, /m-date__day['"][^>]*>\s*(\d{1,2})/);
          if (mo && dd) date = `${inferYear(mo, +dd)}-${pad(mo)}-${pad(+dd)}`;
        }
        if (!date) return null;
        const tagline = stripTags(firstMatch(b, /class=['"]gct-event-tagline['"][^>]*>([\s\S]*?)<\/p>/) || "");
        const openers = /^with\s/i.test(tagline) ? [{ name: tagline.replace(/^with\s+(?:opening act\s+)?/i, "").trim(), genre: "music", role: "opener" }] : [];
        const time = to24h(firstMatch(stripTags(b), /Show\s+(\d{1,2}(?::\d{2})?\s*[AP]M)/i) || "");
        return mkShow(v, { title, date, time, ticketUrl: tm, openers });
      }));
    },
  },
  {
    id: "dorian-s", name: "Dorian's", hood: "Wicker Park", site: "https://throughtherecordshop.com", address: "1939 W North Ave.",
    async pull(v) {
      const html = await getText(`${v.site}/events/`);
      const blocks = html.split(/class="[^"]*\bpost\b/).slice(1);
      return futureOnly(blocks.map((b) => {
        const dateTxt = stripTags(firstMatch(b, /class="[^"]*date-time[^"]*"[^>]*>([\s\S]*?)<\//) || "");
        const m = dateTxt.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
        const title = stripTags(firstMatch(b, /class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h/) || "");
        if (!m || !title) return null;
        const mo = monthNum(m[1]); if (!mo) return null;
        const desc = stripTags(firstMatch(b, /class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/) || "");
        return mkShow(v, {
          title, date: `${m[3]}-${pad(mo)}-${pad(+m[2])}`,
          time: to24h(firstMatch(desc, /(?:live\s+)?at\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i) || ""),
          price: Number(firstMatch(desc, /\$(\d+(?:\.\d{2})?)\s*cover/i)) || null,
          ticketUrl: firstMatch(b, /href="(https?:\/\/throughtherecordshop\.com\/events\/[^"]+)"/),
        });
      }));
    },
  },
  {
    id: "cary-s-lounge", name: "Cary's Lounge", hood: "Rogers Park", site: "https://caryslounge.com", address: "2251 W Devon Ave",
    async pull(v) {
      const html = await getText(`${v.site}/events/`);
      const blocks = html.split(/<li\b/).slice(1);
      return futureOnly(blocks.map((b) => {
        const dateTxt = stripTags(firstMatch(b, /class="cal-date"[^>]*>([\s\S]*?)<\/span>/) || "");
        const m = dateTxt.match(/(?:([A-Za-z]{3,9}),\s*)?([A-Za-z]{3,9})\s+(\d{1,2})/);
        const title = stripTags(firstMatch(b, /class="cal-title"[^>]*>([\s\S]*?)<\/span>/) || "");
        if (!m || !title) return null;
        const mo = monthNum(m[2]); if (!mo) return null;
        const date = `${inferYear(mo, +m[3])}-${pad(mo)}-${pad(+m[3])}`;
        if (m[1] && !dowMatches(m[1], date)) return null;
        const timeTxt = stripTags(firstMatch(b, /class="calTime"[^>]*>([\s\S]*?)<\/span>/) || "");
        return mkShow(v, { title, date, time: to24h(timeTxt), price: "FREE" });
      }));
    },
  },
  {
    id: "reggies-rock-club", name: "Reggies Rock Club", hood: "South Loop", site: "https://www.reggieslive.com", address: "2105 S State St.",
    async pull(v) {
      const html = await getText(`${v.site}/venue/rock-club/`);
      const blocks = html.split(/<article\b[^>]*type-show/).slice(1);
      return futureOnly(blocks.map((b) => {
        const date = firstMatch(b, /<time[^>]*datetime="(\d{4}-\d{2}-\d{2})/);
        const title = stripTags(firstMatch(b, /class="[^"]*show-title[^"]*"[^>]*>([\s\S]*?)<\/h/) || "");
        if (!date || !title) return null;
        const details = stripTags(firstMatch(b, /<ul[^>]*class="[^"]*details[^"]*"[^>]*>([\s\S]*?)<\/ul>/) || b);
        const age = firstMatch(details, /\b(\d{2}\+)/) || (/all\s*ages/i.test(details) ? "ALL AGES" : null);
        return mkShow(v, {
          title, date,
          time: to24h(firstMatch(details, /(\d{1,2}(?::\d{2})?\s*[ap]m)\s*Show/i) || firstMatch(details, /Show\s*:?\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i) || ""),
          age,
          ticketUrl: firstMatch(b, /class="[^"]*ticketfly[^"]*"[^>]*href="([^"]+)"/) || firstMatch(b, /href="([^"]*ticketweb\.com[^"]*)"/),
        });
      }));
    },
  },
  {
    id: "sound-bar", name: "Sound-Bar", hood: "River North", site: "https://sound-bar.com", address: "226 W Ontario",
    async pull(v) {
      const html = await getText(`${v.site}/`);
      const blocks = html.split(/<li[^>]*class="[^"]*ftr-event-boxes/).slice(1);
      return futureOnly(blocks.map((b) => {
        let title = stripTags(firstMatch(b, /<h5[^>]*class="[^"]*col10[^"]*"[^>]*>([\s\S]*?)<\/h5>/) || "");
        const m = stripTags(b).match(/\b([A-Za-z]{3}),\s*([A-Za-z]{3})\s+(\d{1,2})\s*::/);
        if (!title || !m) return null;
        const mo = monthNum(m[2]); if (!mo) return null;
        const date = `${inferYear(mo, +m[3])}-${pad(mo)}-${pad(+m[3])}`;
        if (!dowMatches(m[1], date)) return null;
        const time = to24h(firstMatch(title, /DOORS\s+(\d{1,2}(?::\d{2})?\s*[AP]M)/i) || "");
        title = title.replace(/\s*\/?\s*DOORS\s+\d{1,2}(?::\d{2})?\s*[AP]M.*$/i, "").trim();
        return mkShow(v, {
          title, date, time,
          ticketUrl: firstMatch(b, /href="(https?:\/\/[a-z0-9-]+\.eventbrite\.com[^"]*)"/i) || firstMatch(b, /href="(https?:\/\/sound-bar\.com\/events\/[^"]+)"/),
          age: "21+",
        });
      }));
    },
  },
  {
    id: "reed-s-local", name: "Reed's Local", hood: "Avondale", site: "https://reedslocal.com", address: "3017 W Belmont",
    // Simple Calendar (Google Calendar) microdata with full ISO startDate
    async pull(v) {
      const html = await getText(`${v.site}/events/`);
      const blocks = html.split(/<li[^>]*itemtype="https?:\/\/schema\.org\/Event"/).slice(1);
      return futureOnly(blocks.map((b) => {
        const title = stripTags(firstMatch(b, /itemprop="name"[^>]*>([\s\S]*?)<\//) || "");
        const iso = firstMatch(b, /itemprop="startDate"[^>]*content="([^"]+)"/);
        if (!title || !iso) return null;
        const { date, time } = chiDateTime(iso);
        return mkShow(v, { title, date, time, price: "FREE" });
      }));
    },
  },
  {
    id: "lee-s-unleaded-blues", name: "Lee's Unleaded Blues", hood: "Greater Grand Crossing", site: "https://www.leesunleadedblues.com", address: "7401 S South Chicago Ave",
    pull: (v) => wixEvents(v, "/event-list").then(futureOnly),
  },
  {
    id: "le-piano", name: "Le Piano", hood: "Rogers Park", site: "https://www.lepianochicago.com", address: "6970 N Glenwood Ave",
    pull: (v) => wixEvents(v, "/event-list").then(futureOnly),
  },
  {
    id: "the-atlantic", name: "The Atlantic", hood: "Lincoln Square", site: "https://theatlanticbarandgrill.com", address: "5062 N Lincoln Ave",
    // SpotHopper site platform — public events API
    async pull(v) {
      const j = await getJson("https://www.spothopperapp.com/api/spots/13541/events");
      return futureOnly((j.events || []).map((e) => {
        const date = String(e.event_date || "").slice(0, 10);
        const time = /^\d{2}:\d{2}/.test(e.start_time || "") ? e.start_time.slice(0, 5) : null;
        return mkShow(v, { title: e.name, date, time });
      }));
    },
  },
  // --- Squarespace family ---
  {
    id: "joe-s-on-weed", name: "Joe's on Weed", hood: "Goose Island", site: "https://www.joesbar.com", address: "940 W Weed St.",
    pull: (v) => squarespaceEvents(v, "/livemusic-events", { ticketFromBody: true }),
  },
  {
    id: "punch-house", name: "Punch House", hood: "Pilsen", site: "https://www.punchhousechicago.com", address: "18 S Allport",
    pull: (v) => squarespaceEvents(v, "/happenings"),
  },
  {
    id: "wild-hare", name: "Wild Hare", hood: "West Loop", site: "https://www.wildharemusic.com", address: "952 W Fulton St",
    pull: (v) => squarespaceEvents(v, "/lineup"),
  },
  {
    id: "the-blkroom", name: "The BlkRoom", hood: "East Garfield Park", site: "https://www.theblkroom.org", address: "4015 W Carroll Ave Unit 204",
    pull: (v) => squarespaceEvents(v, "/event-calendar"),
  },
  {
    id: "illuminated-brewery", name: "Illuminated Brewery", hood: "Norwood Park", site: "https://www.ibw-chicago.com", address: "6186 N Northwest Hwy",
    pull: (v) => squarespaceEvents(v, "/events"),
  },
  // --- best-effort text calendars ---
  // (UChicago venues — Logan Center, Cobb Hall, Bond Chapel — go through Do312:
  //  events.uchicago.edu's JSON search over-matches campus-wide, unusable per-building)
  {
    id: "arbella", name: "Arbella", hood: "River North", site: "https://arbellachicago.com", address: "112 W Grand Ave",
    // rich-text DJ lineup: "THU, JUN 4 :: NAME"
    async pull(v) {
      const text = stripTags(await getText(`${v.site}/music`));
      const out = [];
      const re = /\b((?:MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*),?\s+([A-Z]{3,9})\.?\s+(\d{1,2})\s*::\s*(.{2,80}?)(?=\s+(?:MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*,?\s+[A-Z]{3,9}\.?\s+\d{1,2}\s*::|$)/gi;
      let m;
      while ((m = re.exec(text))) {
        const mo = monthNum(m[2]);
        if (!mo) continue;
        const date = `${inferYear(mo, +m[3])}-${pad(mo)}-${pad(+m[3])}`;
        if (!dowMatches(m[1], date)) continue;   // stale month page -> phantom next-year dates
        out.push(mkShow(v, { title: m[4].trim(), date, price: "FREE" }));
      }
      return futureOnly(out);
    },
  },
  {
    id: "beauty-bar", name: "Beauty Bar", hood: "West Town", site: "https://www.beautybarchicago.com", address: "1444 W Chicago Ave",
    // events page is one flowing text block: "THURSDAY JULY 2 TITLE ..."
    async pull(v) {
      const text = stripTags(await getText(`${v.site}/events`));
      const day = "(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)";
      const mon = "(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)";
      const re = new RegExp(`${day}\\s+${mon}\\s+(\\d{1,2})\\s+(.{2,70}?)(?=\\s+${day.replace("(", "(?:")}\\s+${mon.replace("(", "(?:")}|$)`, "gi");
      const out = [];
      let m;
      while ((m = re.exec(text))) {
        const mo = monthNum(m[2]);
        if (!mo) continue;
        const date = `${inferYear(mo, +m[3])}-${pad(mo)}-${pad(+m[3])}`;
        if (!dowMatches(m[1], date)) continue;
        out.push(mkShow(v, { title: m[4].replace(/\s*(?:NO COVER|21\+).*$/i, "").trim(), date, age: "21+" }));
      }
      return futureOnly(out);
    },
  },
  {
    id: "never-have-i-ever", name: "Never Have I Ever", hood: "Lincoln Park", site: "https://neverhaveieverbar.com", address: "2247 N Lincoln Ave",
    // Dashtrack CMS embeds page JSON inline; events array is currently empty but wired for the future
    async pull(v) {
      const html = await getText(`${v.site}/events`);
      const idx = html.indexOf('"slug":"event-list"');
      if (idx === -1) return [];
      const evIdx = html.indexOf('"events":[', idx);
      if (evIdx === -1) return [];
      // bracket-match the array
      let depth = 0, i = evIdx + 9, start = i;
      for (; i < html.length; i++) {
        if (html[i] === "[") depth++;
        else if (html[i] === "]") { depth--; if (depth === 0) break; }
      }
      let events;
      try { events = JSON.parse(html.slice(start, i + 1).replace(/\\"/g, '"')); } catch { return []; }
      return futureOnly(events.map((e) => {
        const raw = e.start_date || e.date || e.starts_at;
        if (!raw) return null;
        const { date, time } = chiDateTime(raw);
        return mkShow(v, { title: e.title || e.name, date, time });
      }));
    },
  },
];

// ---- CLI ----
function parseArgs(argv) {
  const a = { out: "./data/oneoff-shows.json", only: null, delay: 400 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--out") { a.out = v; i++; }
    else if (k === "--only") { a.only = v; i++; }
    else if (k === "--delay") { a.delay = parseInt(v, 10); i++; }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");

  const targets = args.only ? VENUES.filter((v) => v.id === args.only) : VENUES;
  console.error(`One-off venue-site harvest · ${targets.length} venues`);
  const all = [];
  for (const v of targets) {
    process.stderr.write(`  ${v.id} ...`);
    try {
      const shows = await v.pull(v);
      all.push(...shows);
      console.error(` ${shows.length} shows`);
    } catch (e) {
      console.error(` ERROR ${e.message}`);
    }
    await sleep(args.delay);
  }
  all.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(all, null, 2));
  console.error(`\n✓ ${all.length} shows → ${args.out}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e.message || e); process.exit(1); });
