#!/usr/bin/env node
// decode-entities.mjs — decode HTML entities in headliner/opener names.
// Many venue-site pages emit &#8217; (’), &amp;, etc. inside their JSON-LD strings.
// Called in pull.sh after jsonld-harvester so downstream normalize sees clean text.
//
// USAGE
//   node decode-entities.mjs <file.json>

import { readFile, writeFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) { console.error("usage: node decode-entities.mjs <file.json>"); process.exit(1); }

function decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#8217;/g, "’").replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“").replace(/&#8221;/g, "”")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

const raw = JSON.parse(await readFile(file, "utf8"));
for (const s of raw) {
  s.headliners = (s.headliners || []).map((a) => ({ ...a, name: decode(a.name) }));
  s.openers = (s.openers || []).map((a) => ({ ...a, name: decode(a.name) }));
}
await writeFile(file, JSON.stringify(raw, null, 2));
console.error(`decoded entities in ${raw.length} records → ${file}`);
