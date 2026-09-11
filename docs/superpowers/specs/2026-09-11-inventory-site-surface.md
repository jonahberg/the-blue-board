# The Blue Board — Non-Dashboard Site Inventory (2026-09-11)

Astro 6, `output: 'static'`, `build.format: 'file'` (`astro.config.mjs:1-9`), Vercel `cleanUrls: true`.

**Two facts that dominate the redesign cost:**

1. **There is no shared base layout.** 14 separate documents each re-declare `@font-face` ×3, the full `:root` token block, a CSS reset, and `body` styles inline. Three other documents `<link>` the 125 KB dashboard stylesheet.
2. **`--ua-dim` has drifted into two values** (`#7C8DA6` current vs `#64748B` stale in six token blocks). No test catches it.

---

## 1. Pages

### 1.1 Route surface — 65 URLs (from `src/pages/sitemap.xml.ts:35-89`)

| Count | Pattern | Source |
|---|---|---|
| 1 | `/` | dashboard (`public/index.html`) |
| 1 | `/fleet` | `src/pages/fleet/index.astro` |
| 19 | `/fleet/{slug}` | `src/pages/fleet/[type].astro` |
| 1 | `/hubs` | `src/pages/hubs/index.astro` |
| 9 | `/hubs/{iata}` | `src/pages/hubs/[hub].astro` |
| 1 | `/newark` | `src/pages/newark.astro` |
| 1 | `/tsa` | `src/pages/tsa.astro` (to delete) |
| 1 | `/trackers` | `src/pages/trackers/index.astro` |
| 2 | `/trackers/{atc,united-hubs}` | `src/pages/trackers/atc.astro`, `united-hubs.astro` |
| 7 | `/trackers/atc/{code}` | `src/pages/trackers/atc/[code].astro` |
| 8 | `/trackers/united-hubs/{code}` | `src/pages/trackers/united-hubs/[code].astro` |
| 1 | `/news` | `src/pages/news/index.astro` |
| 13 | `/news/{slug}` | `src/pages/news/[slug].astro` |

Not in the sitemap: `/404`, `/privacy` (a real indexable page with canonical — oversight).

Route guard: `src/lib/site-routes.js:14-17` `HTML_ROUTE_PATHS = ['/', '/404', '/newark', '/privacy', '/tsa']`, `HTML_ROUTE_PREFIXES = ['/fleet', '/hubs', '/news', '/trackers']`. Any new top-level route must be added here or `Accept: text/markdown` clients get a synthetic 404 (`agent-negotiation.js:54-56`). `tests/agent-readiness.test.js:131-146` pins this against the sitemap.

### 1.2 Endpoints (`.ts` routes)

- `src/pages/sitemap.xml.ts` → `/sitemap.xml`; lastmod from `git log -1 --format=%cs` per route file list (`buildMetadata.js:37-59`); news uses `a.date`.
- `src/pages/feed.xml.ts` → `/feed.xml` RSS: 13 news + 5 hardcoded static items (`:18-48`, "1,078 Aircraft" hardcoded at :26,:29; `TRACKED_BOARDS`/`HUB_LINE_*` from facts.js).
- `src/pages/news-sitemap.xml.ts` → Google News sitemap, 2-day window with fallback.
- `src/pages/data/news-latest.json.ts` → `/data/news-latest.json`, top 3 articles; consumed by `public/js/news-banner.js:7` (dashboard only). `robots.txt` disallows `/data/`; agent-readiness asserts llms never advertise it.
- Tracker downloads via `src/lib/tracker-downloads.js` (Cache-Control `public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`, attachment): `trackers/atc.json.ts`, `atc.csv.ts` (10 cols), `united-hubs.json.ts`, `united-hubs.csv.ts` (17 cols).

### 1.3 `src/pages/404.astro` (68 lines)
No layout; `hubOrder`/`hubNavLabels`; title only + `noindex`; preloads JetBrains Mono only; 8-token `:root`. 9 hub links, 6 section links, agent links to `/sitemap.xml`, `/llms.txt`, `/llms-full.txt`, `/feed.xml` — **these exact `href` strings are asserted by `tests/agent-readiness.test.js:89-99`** (plus `/fleet`, `/hubs`, `/trackers`, `/news`). VercelAnalytics only; own inline footer.

### 1.4 `src/pages/privacy.astro` (81 lines)
No layout; links `/css/style.css` + scoped style. SEO: title/desc/canonical/og:* (no twitter, no OG image, no JSON-LD). "Effective June 10, 2026"; names Supabase / Resend / Vercel Web Analytics as processors (:62-64). Footer + VercelAnalytics.

### 1.5 `src/pages/newark.astro` (293 lines)
No layout; links `/css/style.css`; dead `fonts.googleapis.com` preconnect (:131). In-file `faqEntries` (6) and `timeline` (7). Full SEO, OG `og/og-hub-ewr.jpg`; JSON-LD BreadcrumbList (raw) + FAQPage (`set:html`). Live: `public/js/newark-live.js` → `/api/fr24-feed?airline=UAL` + `/api/faa`, targets `#newark-active`, `#newark-program-status`, `#newark-updated-time`. Links `/?hub=ewr`, `/?tab=schedule&hub=ewr`, `/hubs/ewr`, `/tsa#ewr`, `/hubs`.

### 1.6 `src/pages/tsa.astro` — DELETE (see TSA inventory).

### 1.7 `src/pages/hubs/index.astro` (256 lines)
No layout; mono-only 10-token `:root`, body in `var(--font-mono)`. Data: `hubOrder`, `hubNavLabels`, `hubs`, facts `HUB_LINE_LONG/SHORT`, `TRACKED_BOARDS`. JSON-LD ×3 raw: BreadcrumbList, FAQPage (4), ItemList (9 hubs). CTA → `/`, 9 hub cards (EWR extra `/newark` link), 3 prose sections, visible FAQ. Own inline footer (no donate button). VercelAnalytics only.

### 1.8 `src/pages/hubs/[hub].astro` (12 lines) → 9 pages via `HubLayout`; no null guard (TODOS:40).

### 1.9 `src/pages/fleet/index.astro` (482 lines)
No layout; full 19-token `:root`; `container 1100px`; unique top `.header` bar. Data: `fleetOrder/NavLabels/Types`, facts `STARLINK_TARGET_2026`, `FLEET_DB_COUNT`; `starlink-facts.js` `STARLINK_EQUIPPED(_LABEL)`, `STARLINK_AS_OF`. Family groupings hardcoded :22-29; seat-config order :43-48. JSON-LD ×4: BreadcrumbList (raw), Dataset (`set:html` template), ItemList (19), FAQPage (5). Hardcoded drift numbers: "1,078" everywhere, family totals 581/206/96/81/61/53 (:340-345), "211 aircraft with Polaris" (:156, :431). Own inline footer WITH donate button.

### 1.10 `src/pages/fleet/[type].astro` → 19 pages via `FleetTypeLayout`.

### 1.11 `src/pages/news/index.astro` (167 lines)
No layout; stale `--ua-dim`. Featured = `articles[0]`, rest 2-col grid; empty-state branch. JSON-LD BreadcrumbList only. Footer + VercelAnalytics.

### 1.12 `src/pages/news/[slug].astro` → 13 pages; `Astro.redirect('/404')` guard.

### 1.13 `src/pages/trackers/index.astro` (178 lines)
`trackers`, `trackerOrder`, `trackerParentSeo.index`. JSON-LD BreadcrumbList + ItemList. Two tracker cards with segmented bar viz from `t.segments`, latest changelog, `<LastUpdated>`. No `/js/trackers.js`.

### 1.14 `src/pages/trackers/atc.astro` (537 lines)
Data: `us-outline.json`, `atcMeta`/`atcAirports` (89), `unitedHubs`, `projectPoint`/`outlinePaths` (`tracker-map.js`). Build-time: status vocab, map points + off-map list, legend, sorted rows with evidence, 6 columns, 4 stats, 5 FAQ. OG title/desc computed from counts; OG `og/og-tracker-atc.jpg`. JSON-LD ×3: BreadcrumbList, FAQPage, Dataset with CSV+JSON DataDownload. Components: TrackerPulse, StatStrip, TrackerMap, TrackerSearch, TrackerTable, Changelog, LastUpdated, CrossLink, TrackerDataActions. `<body data-trk-page="atc">` + `/js/trackers.js`. Anchors `#map #check #all #whats-changing #paper-strips #faq #changelog`.

### 1.15 `src/pages/trackers/united-hubs.astro` (624 lines)
Same shape. Local activity-ranked `hubOrder` (:46) differs from `src/data/hubs/index.js:18`. `hubMapMeta` (:66-83) hand-written per-hub prose. `stats` (:176-181) + og:description (:236) carry hardcoded club math (MAINTENANCE.md:81-83 hand-sync). Anchors `#map #check #hubs #all #why #club-math #faq #changelog`.

### 1.16 `src/pages/trackers/atc/[code].astro` → 7 pages (`atcHubDetailCodes`, GUM excluded, pinned by `tests/tracker-seo.test.js:56-64`). `TrackerDetailLayout`; JSON-LD Article, Dataset, FAQPage via `schemas` prop; layout adds 4-level BreadcrumbList.

### 1.17 `src/pages/trackers/united-hubs/[code].astro` → 8 pages. JSON-LD Article, ItemList (projects), FAQPage. Conditional ATC cross-link (not GUM).

---

## 2. Layouts and components

### 2.1 `src/layouts/HubLayout.astro` (308 lines)
Props `data`. Two style variants by `data.variant`: `full` (7 US hubs) and `compact` (NRT/GUM). Head: theme-color `#0B1018`, inline data-URI favicon, canonical, full OG + Twitter, per-hub OG `og/og-hub-{iata}.jpg`. JSON-LD ×3 `set:html`: BreadcrumbList, FAQPage (`data.faqSchema`), **Airport** (:15-35 with icaoCode, PostalAddress, GeoCoordinates). `<body data-hub-iata={iata}>` read by `public/js/hub-live-data.js`. `full` renders breadcrumb, `headerTitle` (raw HTML), live panel `#active`/`#updated-time` + CTA `/?hub={iata}`, `#scrollHint`, jump nav from `data.jumpNav`. Always `<Fragment set:html={data.contentHtml} />` (:271) — **bulk of every hub page is a raw HTML string in the data file**. TSA box (:274-278, delete), tracker box (:281-285), hub nav (:290-294). Footer, VercelAnalytics, `/js/hub-live-data.js`, `/js/scroll-hint.js`.

### 2.2 `src/layouts/FleetTypeLayout.astro` (331 lines)
Imports `public/data/fleet.json` at build (:5), filters by `data.typeCode` → inlines registry table (8 cols). Canonical `/fleet/{slug}`, OG `og/og-fleet.jpg`. JSON-LD ×3: BreadcrumbList, FAQPage, **AboutPage** wrapper with 10 PropertyValue specs (deliberate vs Product, comment :14). Body: header + 4 stat cards + CTA `/?tab=fleet&type={typeCode}` + `#scrollHint` + jump nav + `contentHtml` + Specifications table + Registry table + FAQ + fleet nav (19). Footer, VercelAnalytics, scroll-hint.

### 2.3 `src/layouts/NewsLayout.astro` (206 lines)
Props `article`; `resolveTag()` cross-links. `og:type=article`, `article:published_time`, `article:section`, OG `article.ogImage || og/og-news.jpg`. JSON-LD BreadcrumbList + **NewsArticle** with publisher `@id https://theblueboard.co/#organization`. Body: header, `set:html={article.body}`, Sources, Related pills, buymeacoffee CTA (:186-188), **Blue Board Pro waitlist teaser** → `/?waitlist=1` (:192), back link. No client scripts.

### 2.4 `src/components/Footer.astro` (14 lines)
Inline-styled; depends on `--ua-*` tokens. Disclaimer + `/privacy` + "Open Dashboard"; credits FR24/AWC/FAA; buymeacoffee button; "Built by Jonah Berg" + `@theblueboard`. Used by 11 files; NOT by 404, hubs/index, fleet/index (divergent inline footers).

### 2.5 `src/components/VercelAnalytics.astro` (9 lines)
`<script is:inline defer src="/_vercel/insights/script.js">` — `is:inline` is load-bearing. Mounted in 14 files; `tests/web-analytics-integration.test.js:33-57` hardcodes that list.

### 2.6 `src/components/trackers/*` (12)
| File | Provides | Client |
|---|---|---|
| `TrackerDetailLayout.astro` (178) | full head + `<style is:global>` + breadcrumb + header + slot + peer nav + TrackerDataActions + Footer + Analytics | `data-trk-page`, `/js/trackers.js` |
| `TrackerMap.astro` (245) | build-time inline SVG US map 960×600; markers by shape AND colour; legend; inspector card | markers `role=button tabindex=0 data-trk-marker`; cards `data-trk-card` |
| `TrackerTable.astro` (207) | sortable static table `data-trk-sort`, `data-trk-row`, `data-trk-search-text`, `data-sort`; sticky header | via trackers.js |
| `TrackerSearch.astro` (95) | hidden until JS; `#trk-search-input`, `data-trk-count`, `data-trk-empty` | progressive |
| `TrackerPulse.astro` (145) | briefing strip; `<script type="application/json" data-trk-config>` blob | watch button, home-airport row |
| `SourceDisclosure.astro` (177) | `<details>` sources, 23-entry publisher map; Watch + Share | `data-trk-watch`, `data-trk-share` |
| `StatusBadge.astro` (68) | 6 tones, glyph + label | — |
| `StatStrip.astro` (76) | 3–4 tiles, one amber featured | — |
| `Changelog.astro` (65) | reverse-chron `<ol>` `<time>` | — |
| `LastUpdated.astro` (39) | noon-UTC anchored `<time>` | — |
| `CrossLink.astro` (39) | highlight box | — |
| `TrackerDataActions.astro` (96) | CSV/JSON + prefilled GitHub issue URL | — |

---

## 3. Shared styling

### 3.1 Two delivery strategies
**A — inline block (14 docs):** HubLayout (full :97, compact :177), FleetTypeLayout :104, NewsLayout :88, TrackerDetailLayout :136 (`is:global`), trackers/index :74, atc :295, united-hubs :301, hubs/index :121 (mono, 10 tokens), fleet/index :191 (1100px), news/index :61, 404 :15 (8 tokens).
**B — `<link href="/css/style.css">` (3 docs):** privacy :21, newark :130, tsa :60. `tests/leaflet-required-styles.test.js:35` reads style.css by literal path.

### 3.2 Fonts
`public/fonts/{satoshi,dm-sans,jetbrains-mono}-latin.woff2`; CSP `font-src 'self'`.

### 3.3 Tokens (canonical, `trackers/atc.astro:300`)
`--ua-blue:#005DAA --ua-dark:#0B1018 --ua-panel:#111A27 --ua-panel-elevated:#152032 --ua-border:#1E2940 --ua-border-subtle:#172236 --ua-text:#E2E8F0 --ua-muted:#94A3B8 --ua-dim:#7C8DA6 --ua-accent:#6BAAED --ua-amber:#C4A35A --ua-amber-soft --ua-blue-soft --ua-green:#22C55E --ua-yellow:#EAB308 --ua-red:#EF4444` + three font vars. `--ua-dim` stale `#64748B` in HubLayout (both), NewsLayout, FleetTypeLayout, fleet/index, news/index.

---

## 4. Build pipeline

### 4.1 `package.json` scripts
```
dev     bun scripts/run-astro-dev.mjs
build   bun scripts/refresh-starlink-facts.mjs && vite build --config vite.dashboard.config.js && astro build && bun scripts/stamp-seo-build-date.mjs && bun scripts/build-agent-markdown.mjs
test    bunx vitest run        typecheck  tsc --noEmit        ui-audit  bun scripts/ui-audit.mjs
```
`vercel.json` `buildCommand: bun run build`, `outputDirectory: dist`. Node 24.x, bun 1.3.14.

### 4.2 Steps
1. `refresh-starlink-facts.mjs` → `src/data/starlink-live.json` (fetch unitedstarlinktracker.com, 8 s, validated, never fails build). Current `source {label:"425+", asOf:"mid-2026"}`, `live {count:513, label:"500+", asOf:"August 2026"}`.
2. `vite build --config vite.dashboard.config.js` → `public/js/dashboard.js` (IIFE, global `BB`, leaflet external `L`; gitignored).
3. `astro build` → `dist/` (copies `public/` verbatim; `build.format: 'file'` → `dist/fleet.html` etc.). Data validators fail the build at import (`trackers/index.js:104`, `news/index.js:28`).
4. `stamp-seo-build-date.mjs` — **hard-fail**: requires `__HOME_LASTMOD__` in `dist/index.html`; replaces Starlink `source.label/asOf` → `live.*` in `dist/index.html`, `dist/llms.txt`, `dist/llms-full.txt`; throws if any target string missing.
5. `build-agent-markdown.mjs` → `dist/_agent/{home,fleet,hubs,news,trackers}.md` from `agent-markdown.js:193-199`.

### 4.3 `run-astro-dev.mjs` stamps `__HOME_LASTMOD__` into tracked `public/index.html` and restores on exit.

### 4.4 `middleware.ts` matcher excludes `_agent/ _astro/ _vercel/ api/ css/ data/ fonts/ icons/ js/ og/ favicon.svg favicon.ico manifest.json og-image.png robots.txt sw.js`. Delegates to `resolveAgentResponse()` → html | markdown-asset (rewrite `/_agent/*.md`) | markdown 404 | 406. Throws degrade to `next()`.

### 4.5 What breaks if `public/index.html` is replaced
1. stamp script throws without `__HOME_LASTMOD__` in `dist/index.html`.
2. stamp script throws if `"425+"`/`"mid-2026"` absent from `dist/index.html`, `dist/llms.txt`, `dist/llms-full.txt`.
3. `run-astro-dev.mjs` throws without placeholder in `public/index.html`.
4. `buildMetadata.js:7` `homeLastmodPaths` includes `public/index.html`, `public/css/style.css`, `public/data/*.json`.
5. `public/sw.js:14` `APP_SHELL=['/','/index.html']`; `:87` offline fallback `/index.html`.
6. `vercel.json` `/index.html` + `/` no-store rules asserted by `tests/asset-cache.test.js:28-33`.
7. `site-routes.js` keeps `/`; `agent-markdown.js:193` maps `/` → `/_agent/home.md`; twin facts pinned by `agent-readiness:314-344`.
8. **Five tests read `public/index.html`**: `agent-readiness:23`, `csp:84`, `compliance:13`, `fleet-consistency:31`, `web-analytics-integration:25`. Two read `src/dashboard/main.js`: `compliance:14`, `basemap:9`.
9. `web-analytics-integration:23-31` asserts `src/dashboard/main.js` exists without analytics deps and `public/index.html` loads `/_vercel/insights/script.js` exactly once as a static tag.
10. CSP `script-src` has no `'unsafe-inline'`/nonce; `_astro/` bundles are `'self'`. `csp.test.js:31-39` blocks re-adding unsafe-*.
11. `build.format: 'file'` assumed by the `/index.html` header rule and `sw.js:68` `.html` heuristic.

### 4.6 `_agent/` twins generated; `public/llms.txt` (12,970 B) and `llms-full.txt` (19,812 B) hand-maintained, Starlink-stamped in dist; headings pinned by `agent-readiness:259-271` (`## When To Use This Site`, `## How An Agent Should Call It`, `?flight=UA1234`, `/trackers/atc.json`, `Accept: text/markdown`, `Do **not** use The Blue Board`).

### 4.7 `scripts/ui-audit.mjs` PAGES (17 routes, 3 viewports, Playwright + axe). 4.8 `generate-og.py`, `generate-maskable-icons.py`, `seed-schedules.mjs` hand-run.

---

## 5. Vercel config (`vercel.json`, 151 lines)
Redirects: www→apex (2), `/favicon.ico`→`/favicon.svg`, 4 apple-touch-icon → `/icons/icon-192.png`. No rewrites.
Global headers: X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, `Vary: Accept, Accept-Encoding`, HSTS preload, CSP:
| Directive | Allowed |
|---|---|
| default-src | 'self' |
| script-src | 'self' https://unpkg.com https://va.vercel-scripts.com |
| style-src | 'self' 'unsafe-inline' https://unpkg.com |
| font-src | 'self' |
| img-src | 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://mesonet.agron.iastate.edu https://theblueboard.co |
| connect-src | 'self' https://theblueboard.co https://va.vercel-scripts.com |
| frame-ancestors | 'none' |
`/api/(.*)`: ACAO theblueboard.co, expose `X-BB-Feed-Stale`, `X-Robots-Tag: noindex, nofollow`.
Cache-Control: `/index.html` + `/` no-store; `/_agent/(.*)` 300s; `/og-image.png` 86400; `/hubs/(.*)`, `/trackers/(.*)`, `/news/(.*)`, `/data/(.*).json` 3600/86400/swr600; `/_astro/(.*)` immutable 1y; `/tsa` (delete); `/css/(.*)`, `/js/(.*)` 3600 swr 86400. Gaps: `/fleet/*`, `/newark`, `/privacy`, `/fonts/*`, `/icons/*`, `/og/*`.
Functions maxDuration: 20 entries (irops 90, schedule 60, warm-schedules 300, watch-alerts 120, …, tsa 30, refresh-tsa 30).
Crons: warm-schedules `0 * * * *` (pinned by `tests/warm-config.test.js`), sync-starlink `0 */4 * * *`, refresh-tsa (delete), refresh-metar `*/5`, watch-alerts `*/5`.

---

## 6. Tests that pin HTML/site structure
- **`agent-readiness.test.js`** (352): reads `public/index.html`, llms files, `404.astro` source, vercel.json, middleware.ts, package.json, robots. Asserts: `<h1 id="page-brief-title">` BEFORE `<header id="header">`; visible text >3000 chars; `<section class="sr-only" aria-labelledby="page-brief-title">` containing `1,078`; 404.astro literal hrefs; every sitemap loc is a known route (>40); junk 404s; trailing slash; `agentMarkdown` asset paths; build script contains `build-agent-markdown.mjs`; robots `Disallow: /_agent/`; vercel Vary contains accept; middleware literal strings + no X-Robots-Tag; matcher regex skip/match lists (incl. `/js/dashboard.js`, `/css/style.css`); llms headings; Organization JSON-LD (`@id #organization`, contactPoint `hello@theblueboard.co`, PostalAddress LA/CA/US); **≥6 parseable JSON-LD blocks** with extractor regex exactly `<script type="application/ld+json">`; agent markdown facts.
- **`csp.test.js`** (104): per-directive checks incl. `style-src` MUST contain `'unsafe-inline'`, `unpkg.com` in script+style (to update when Leaflet is bundled), no `vitals.vercel-insights.com`; `public/index.html` zero inline executable scripts and zero `on*=`.
- **`asset-cache.test.js`**: `/js/(.*)`, `/css/(.*)` max-age ≥3600 + swr; `/` and `/index.html` no-store; `/trackers/(.*)`; `/_astro/(.*)` immutable; refresh-tsa cron (delete block).
- **`web-analytics-integration.test.js`**: VercelAnalytics.astro exact string; `public/index.html` loads insights exactly once; `src/dashboard/main.js` no analytics deps; 14 hardcoded entrypoints each import + mount `<VercelAnalytics />`; no speed-insights.
- **`compliance.test.js`**: reads index.html + main.js; AeroDataBox named ≥2×; never "Schedule data via Flightradar24"; main.js never `attributionControl: false`, contains `OpenStreetMap`; `id="tab-sources"` panel contains AeroDataBox, CARTO, OpenStreetMap.
- **`leaflet-required-styles.test.js`**: reads `public/css/style.css`; 9 Leaflet classes must not have `position` overridden; `#legal-details` fixed with `right ≥ 52px`; `.leaflet-marker-icon…::after{inset:-Npx}` hit-slop rule.
- **`sw.test.js`** (323): see §7.
- **`build-metadata.test.js`**: `homeLastmodPaths` contains `public/index.html` AND `public/css/style.css`; literal page/layout paths asserted (`src/pages/fleet/[type].astro`, `hubs/[hub].astro`, `layouts/NewsLayout.astro`, trackers pages, `TrackerDetailLayout.astro`).
- **`fleet-consistency.test.js`**: per-type counts sum equals `/Fleet Database[^0-9]*([0-9,]+)\s*Aircraft/i` in `public/index.html`.
- **`tracker-seo.test.js`**, **`tracker-data.test.js`** (`atcAirports.length === 89`), **`tracker-map.test.js`**, **`basemap.test.js`** (`src/dashboard/main.js` must contain `cartoBasemapUrl(import.meta.env.VITE_CARTO_BASEMAP_KEY)` and exactly 2 keyed tile layers; `.env.example` documents the key), **`api-esm-json-imports.test.js`**, **`vercel-build-compat.test.js`**, **`warm-config`**, **`news-data`**, **`starlink-facts`**, **`popup-triggers`** (waitlist modal at 30 clicks, session guard, `bb_waitlist_submitted`, 7-day TTL, `?waitlist=1`, `bb-onboarded`), **`fleet-tab`** (`categorizeFleetStatus`, `FLEET_FAMILIES`, `sortFleetData`, `filterFleetData`, `normalizeWifi`).

---

## 7. PWA
`public/sw.js` (223): `CACHE_VERSION='v10'`; caches pages(20)/data(80)/static(120); precache `['/', '/index.html']`; activate deletes stale `blueboard-*`; fetch: non-GET pass; cross-origin pass; navigation network-first → cached → `/index.html` → 503; `/api/*`,`/data/*` network-first no-store; `/js/*` or exactly `/css/style.css` network-first no-cache (not content-hashed); else stale-while-revalidate. `push` `{title, body, tag, url}` icon `/icons/icon-192.png`; `notificationclick` `data.url` → `/?flight=` → `/`, focuses existing client. Registered by `public/js/sw-register.js` from `index.html:1008` only.
`public/manifest.json`: id `/`, standalone, colours `#0a0e14` (pages use `#0B1018`), 4 icons, linked only from index.html.
`tests/sw.test.js`: isCacheable/isHtmlResponse; trimCache; activate deletions; push payloads; notificationclick; **fetch strategy: `/js/support-meter.js` and `/css/style.css` FRESH over STALE; `/icons/icon-192.png` CACHED; `unpkg.com` never respondWith**.

---

## 8. Public assets
`index.html` 95,581 B; `css/style.css` 125,443 B; `js/dashboard.js` 343,426 B (generated, gitignored); `js/trackers.js` 11,523; `js/tsa-gate.js`; `js/newark-live.js`; `js/support-meter.js`; `js/news-banner.js`; `js/hub-live-data.js`; `js/scroll-hint.js`; `js/sw-register.js`; fonts ×3; `data/fleet.json` 172,647 B (build import + runtime fetch); `data/starlink.json` 34,945 B (runtime fetch; sync-starlink cron writes Supabase, not here); `og-image.png` 420 KB; `og/*.jpg` ×15 (generated, committed); icons ×4; `favicon.svg`; `manifest.json`; `sw.js`; `robots.txt` (Disallow /api/, /data/, /_agent/; 17 AI UAs allowed llms); `llms.txt`; `llms-full.txt`.

---

## 9. Docs constraints
- `CLAUDE.md`: read DESIGN.md before UI decisions; `bun run test` never bare `bun test`; typecheck + build before PR.
- `DESIGN.md` hard rules: `--ua-blue` never text; amber discipline; status never colour-alone; no hero images/glassmorphism/card shadows/colourful badges/Inter; animations ≤200 ms; single 600 px breakpoint; 44 px targets; container 900 px; dark-only.
- `MAINTENANCE.md`: hand-sync list (generate-og.py sublines, united-hubs stats + og:description, `unitedHubsMeta.stats`); 89-airport pin; **new-route checklist**: sitemap, buildMetadata lastmod paths, vercel cache rule, analytics test, ui-audit PAGES, llms files, generate-og, index navs, feed.xml.
- `TODOS.md`: drop `style-src 'unsafe-inline'` (currently required by csp test); content-hash js/css; sw route-aware fallback; run-astro-dev scratch; null guards on `[hub]`/`[type]`.
- CI `.github/workflows/test.yml`: typecheck → test → build (bun 1.3.14, frozen lockfile). `post-deploy-smoke.yml`: curls `/`, `/api/starlink-data`, `/api/schedule` only.
- Secrets: `VITE_CARTO_BASEMAP_KEY` never committed; CARTO + OSM attribution must stay visible (`compliance.test.js:58-68`).

---

## Loose ends
1. `/privacy` absent from sitemap.
2. Three footers + 404's one-liner.
3. Two hub orderings (hubs/index.js vs united-hubs.astro activity-ranked).
4. `contentHtml` raw HTML strings in `src/data/hubs/*.js` and `src/data/fleet/*.js` (28 files) rendered via `set:html`.
5. JSON-LD emitted two ways (raw vs `set:html`).
6. `og-image.png` 420 KB.
7. hubs/index and 404 define incomplete token sets.
