#!/usr/bin/env bash
# pull.sh — one-shot Chicago Show Calendar refresh
# Fetches Do312, optionally enriches from detail pages, normalizes to shows.json,
# filters out past dates. Run from the folder containing index.html.
#
# USAGE
#   ./pull.sh                # fast: listing pages only (no price/age)
#   ./pull.sh --enrich       # slow (~6 min): full detail-page pass for price/age/time
#   ./pull.sh --enrich --enrich-max 100    # cap enrichment (for smoke tests)

set -euo pipefail
cd "$(dirname "$0")"

ENRICH=""
ENRICH_MAX=""
DELAY=400
for arg in "$@"; do
  case "$arg" in
    --enrich) ENRICH="--enrich" ;;
    --enrich-max) ENRICH_MAX="--enrich-max" ;;
    --enrich-max=*) ENRICH_MAX="--enrich-max ${arg#*=}" ;;
    --delay=*) DELAY="${arg#*=}" ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

echo "== 1/3 · Do312 harvest =="
# shellcheck disable=SC2086
node do312-adapter.mjs --venues ./do312-venues.json --out ./data/do312-shows.json --delay "$DELAY" $ENRICH $ENRICH_MAX

echo
echo "== 2/3 · normalize =="
node normalize.mjs --in ./data/do312-shows.json --registry ./venue-registry.json --out ./shows.json

echo
echo "== 3/3 · filter past dates =="
node -e '
const fs = require("fs");
const all = JSON.parse(fs.readFileSync("./shows.json", "utf8"));
const today = new Date().toISOString().slice(0, 10);
const future = all.filter(s => s.date && s.date >= today);
fs.writeFileSync("./shows.json", JSON.stringify(future, null, 2));
console.log(`kept ${future.length}/${all.length} shows (date >= ${today})`);
'

echo
echo "✓ done → shows.json ready. Reload http://localhost:8080/"
