// ═══ MARKDOWN REPRESENTATIONS FOR AGENTS ═══
// Served by the root middleware.ts when a client asks for `Accept: text/markdown`
// (acceptmarkdown.com). Same URL, same facts, no nav/scripts/layout markup.
// Why hand-authored strings rather than an HTML→Markdown conversion of dist/: the
// homepage is a JavaScript dashboard whose HTML is almost entirely chrome, so a
// conversion would emit tab labels and button text, not answers.
//
// FACTS: numbers here are literals because middleware is bundled separately from the
// Astro build and must not import src/data/facts.js — a bare JSON import (facts.js pulls
// in starlink-live.json) is the exact shape that crashed Vercel's Node-ESM functions in
// the 2026-06-01 incident. tests/agent-readiness.test.js pins every number below against
// facts.js so the two can't drift. Deliberately NO Starlink count: that figure is stamped
// into dist/ at build time by scripts/stamp-seo-build-date.mjs and any copy living
// outside that stamping pass ships stale.

const DISCLAIMER =
  'The Blue Board is independent and community-built. It is not affiliated with, '
  + 'endorsed by, or operated by United Airlines, Inc. All trademarks belong to their '
  + 'respective owners. Data may be delayed — do not use it as your only source for '
  + 'day-of-travel decisions.';

const HOME = `# The Blue Board — United Airlines Flight Tracker & Live Operations Dashboard

> A free, independent, real-time operations dashboard for United Airlines flights.
> Built for the United community. Not affiliated with United Airlines, Inc.

The Blue Board tracks every airborne United Airlines flight on a live map refreshed every
30 seconds, and monitors delays, cancellations, and ground stops across all 8 United hubs
plus the Tokyo-Narita gateway. It also carries a searchable database of 1,078 United
mainline airframes with seat configuration, WiFi type, and in-flight entertainment detail,
hub departure and arrival boards with equipment-swap detection, NEXRAD radar and METAR
weather, a TSA checkpoint guide, and long-running aviation trackers.

## When to use this site

Reach for The Blue Board when the question is **specific to United Airlines operations**
and needs an answer from the last few minutes rather than a schedule published months ago:

- **"Is United delayed at ORD / DEN / EWR / IAH / SFO / IAD / LAX / NRT / GUM right now?"**
  — live per-hub on-time percentage, cancellation counts, and active FAA ground stops.
- **"Where is UA 1234 and will it be late?"** — live position, altitude, route, delay
  status, and an 8-signal delay risk score with a plain-language explanation.
- **"Does my aircraft have Starlink WiFi?"** — equipment lookup by tail number, flight
  number, or fleet type, with the live equipped count.
- **"What aircraft does United fly on this route, and what is the cabin like?"** — fleet
  type guides with seat counts, Polaris/Premium Plus availability, and IFE detail.
- **"What is happening at Newark?"** — the FAA flight-cap regime, the ATC staffing
  timeline, and current conditions in one place.
- **"How far along is the FAA's paper-to-digital flight strip rollout at a given
  airport?"** — sourced, dated status for all 89 TFDM airports.

Do **not** use The Blue Board for other airlines (it is United-only), for booking or
ticket changes, or as the authoritative record for a flight you are about to board —
united.com and the airport display are the systems of record.

## How an agent should call it

Everything below is a plain HTTPS GET. There is no API key and no authentication.

| Job | URL |
| --- | --- |
| Live dashboard | \`https://theblueboard.co/\` |
| Deep-link a specific flight | \`https://theblueboard.co/?flight=UA1234\` |
| Hub status page | \`https://theblueboard.co/hubs/{ord\\|den\\|iah\\|ewr\\|sfo\\|iad\\|lax\\|nrt\\|gum}\` |
| Newark operations center | \`https://theblueboard.co/newark\` |
| Fleet index / one fleet type | \`https://theblueboard.co/fleet\` · \`https://theblueboard.co/fleet/{slug}\` |
| TSA checkpoint guide (lanes, hours) | \`https://theblueboard.co/tsa\` |
| United news · RSS | \`https://theblueboard.co/news\` · \`https://theblueboard.co/feed.xml\` |
| Trackers index | \`https://theblueboard.co/trackers\` |
| Tracker open data | \`/trackers/atc.json\` · \`/trackers/atc.csv\` · \`/trackers/united-hubs.json\` · \`/trackers/united-hubs.csv\` |
| Site summary for models | \`https://theblueboard.co/llms.txt\` |
| Full documentation for models | \`https://theblueboard.co/llms-full.txt\` |
| Every indexable URL | \`https://theblueboard.co/sitemap.xml\` |

Send \`Accept: text/markdown\` to get this Markdown representation instead of the HTML
dashboard. The JSON and CSV endpoints under \`/trackers/\` are the only structured-data
downloads; the live flight, delay, and schedule feeds are internal to the dashboard and
are not a public API, so please read the pages rather than scraping \`/api/\`.

## Coverage

- **Airports:** all 8 United hubs — Chicago O'Hare (ORD), Denver (DEN), Houston
  Intercontinental (IAH), Newark Liberty (EWR), San Francisco (SFO), Washington Dulles
  (IAD), Los Angeles (LAX), Guam (GUM) — plus the Tokyo Narita (NRT) gateway.
  9 tracked boards in total.
- **Fleet:** 1,078 United mainline airframes across 19 types.
- **Trackers:** all 89 airports in the FAA's TFDM electronic-flight-strip program, and
  every club, terminal, and gate project across United's hubs.

## Data freshness

| Feed | Refresh |
| --- | --- |
| Flight positions (ADS-B via Flightradar24) | every 30 seconds |
| Delays and cancellations | every 30 seconds |
| FAA NAS status and ground stops | every 60 seconds |
| Schedules (AeroDataBox) | hourly, warmed on a cron |
| METAR weather observations | every 5 minutes |
| Starlink equipment | every 4 hours |
| Fleet database | curated; updated as aircraft enter and leave the fleet |
| TSA checkpoint guide | static reference; no live wait-time feed exists |

## Sources

Flight positions from the Flightradar24 ADS-B network. Delays and ground stops from the
FAA National Airspace System status feed. Schedules from AeroDataBox. Weather from the
Aviation Weather Center (METAR) and Iowa State (NEXRAD). Fleet and equipment data curated
from public aviation databases and United fleet records.

## Contact

- Email: hello@theblueboard.co
- Built by Jonah Berg — https://jonahberg.com
- X/Twitter: https://x.com/theblueboard

## Disclaimer

${DISCLAIMER}
`;

const FLEET = `# United Airlines Fleet Database — The Blue Board

Searchable detail for 1,078 United mainline airframes across 19 aircraft types: tail
number, seat configuration by cabin, WiFi type (including Starlink equipment status),
in-flight entertainment, and delivery date.

- Fleet index, searchable: https://theblueboard.co/fleet
- Per-type guides: https://theblueboard.co/fleet/{slug} — for example
  \`737-800\`, \`737-900er\`, \`737-max-9\`, \`737-max-8\`, \`a319\`, \`a320\`, \`a321neo\`,
  \`757-200\`, \`757-300\`, \`767-300er\`, \`767-400er\`, \`777-200\`, \`777-200er\`,
  \`777-300er\`, \`787-8-dreamliner\`, \`787-9-dreamliner\`, \`787-10-dreamliner\`
- Live equipment lookup by tail or flight number: the Fleet tab on
  https://theblueboard.co/

The complete, current list of fleet URLs is in https://theblueboard.co/sitemap.xml.

${DISCLAIMER}
`;

const HUBS = `# United Airlines Hub Status — The Blue Board

Live operational status for all 8 United hubs plus the Tokyo-Narita gateway: on-time
percentage, delay and cancellation counts, active FAA ground stops and ground delay
programs, current weather, and the day's departure and arrival boards.

- All hubs: https://theblueboard.co/hubs
- One hub: https://theblueboard.co/hubs/{code} where code is one of
  \`ord\` (Chicago O'Hare), \`den\` (Denver), \`iah\` (Houston Intercontinental),
  \`ewr\` (Newark Liberty), \`sfo\` (San Francisco), \`iad\` (Washington Dulles),
  \`lax\` (Los Angeles), \`nrt\` (Tokyo Narita), \`gum\` (Guam)
- Newark's FAA flight caps and ATC timeline: https://theblueboard.co/newark

${DISCLAIMER}
`;

const TRACKERS = `# Trackers — The Blue Board

Living, sourced, data-driven pages that follow aviation's long-running stories. Every
status label carries a date and a citation.

- Trackers index: https://theblueboard.co/trackers
- **Modern Skies Tracker** — the FAA's paper-to-digital flight strip (TFDM) rollout across
  all 89 program airports: https://theblueboard.co/trackers/atc
- **United Hub Tracker** — every United club, terminal, and gate project across the hubs:
  https://theblueboard.co/trackers/united-hubs

Open data downloads (no key required):

- https://theblueboard.co/trackers/atc.json · https://theblueboard.co/trackers/atc.csv
- https://theblueboard.co/trackers/united-hubs.json ·
  https://theblueboard.co/trackers/united-hubs.csv

${DISCLAIMER}
`;

const NEWS = `# United Airlines News — The Blue Board

Curated coverage of United fleet, route, and operations news, each story written up with
its primary sources linked.

- News index: https://theblueboard.co/news
- Individual stories: https://theblueboard.co/news/{slug} — the current list is in
  https://theblueboard.co/news-sitemap.xml
- RSS feed: https://theblueboard.co/feed.xml

${DISCLAIMER}
`;

/**
 * Canonical path → Markdown representation of that page.
 * Paths must be normalised (no trailing slash) — see site-routes.js.
 */
export const agentMarkdown = Object.freeze({
  '/': HOME,
  '/fleet': FLEET,
  '/hubs': HUBS,
  '/news': NEWS,
  '/trackers': TRACKERS,
});

/**
 * Prerendered asset path for a route's Markdown twin.
 *
 * Why an asset and not a body synthesised in middleware: Vercel drops Content-Type from
 * any middleware-authored response to a HEAD request (it strips the header along with the
 * body), and `curl -sI -H 'Accept: text/markdown'` is the check acceptmarkdown.com
 * prescribes. Rewriting to a real static file keeps HEAD honest and lets the edge cache
 * the Markdown variant. scripts/build-agent-markdown.mjs writes these files from the same
 * strings above, so the two can never drift.
 *
 * @param {string} path normalised route path
 * @returns {string|null} asset path under /_agent/, or null when the route has no twin
 */
export function agentMarkdownAssetPath(path) {
  if (!Object.prototype.hasOwnProperty.call(agentMarkdown, path)) return null;
  return path === '/' ? '/_agent/home.md' : `/_agent${path}.md`;
}

/**
 * Markdown body for a 404. An agent that walked into a dead URL should be able to recover
 * from the response alone, so this names the machine-readable indexes rather than just
 * apologising.
 *
 * @param {string} pathname the path that missed
 * @returns {string}
 */
export function notFoundMarkdown(pathname) {
  const safePath = String(pathname ?? '/').replace(/[\r\n]/g, ' ').slice(0, 200);
  return `# 404 — Not Found

\`${safePath}\` is not a page on The Blue Board.

## Where to look next

- **Every indexable URL:** https://theblueboard.co/sitemap.xml
- **Site summary for models:** https://theblueboard.co/llms.txt
- **Full documentation for models:** https://theblueboard.co/llms-full.txt
- **Live dashboard:** https://theblueboard.co/
- **Hub status:** https://theblueboard.co/hubs
- **Fleet database:** https://theblueboard.co/fleet
- **Trackers and open data:** https://theblueboard.co/trackers
- **News and RSS:** https://theblueboard.co/news · https://theblueboard.co/feed.xml

## Common shapes

- A flight: https://theblueboard.co/?flight=UA1234
- A hub: https://theblueboard.co/hubs/{ord|den|iah|ewr|sfo|iad|lax|nrt|gum}
- A fleet type: https://theblueboard.co/fleet/{slug}
`;
}

/**
 * Plain-text body for a 406, listing what this server can produce so the client knows
 * which Accept value to retry with (RFC 9110 §15.5.7).
 *
 * @param {string|null|undefined} accept the Accept header that could not be satisfied
 * @param {string[]} produces media types this server can emit
 * @returns {string}
 */
export function notAcceptableText(accept, produces) {
  const requested = String(accept ?? '').replace(/[\r\n]/g, ' ').slice(0, 200);
  return [
    'This resource is available in:',
    ...produces.map((type) => `- ${type}`),
    '',
    `You requested: ${requested || '(none)'}`,
    '',
    'See https://acceptmarkdown.com/ for the Markdown negotiation convention.',
    '',
  ].join('\n');
}
