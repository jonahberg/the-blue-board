# The Blue Board shadcn/ui Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One fresh Opus subagent per work package (WP); the orchestrator (Fable) reviews the diff and runs the gates between packages. Steps use `- [ ]` syntax.

**Goal:** Rebuild theblueboard.co on Astro + React islands + Tailwind v4 + shadcn/ui without losing any feature except TSA (removed), on branch `feat/shadcn-rebuild`, shipping as v1.8.0 in one PR.

**Architecture:** One `astro build`. `src/pages/index.astro` renders the crawlable SEO shell server-side and mounts the React dashboard island (`src/app/Dashboard.tsx`, `client:only="react"`). All content pages use a new `BaseLayout.astro` on the same tokens. All behaviour logic lives in `src/lib/*.js` (existing modules plus new ones extracted from `main.js`), imported by React via `allowJs`. The old bundle, stylesheet, fonts and `public/index.html` are deleted in the final package.

**Tech Stack:** Astro 6.4 (static), `@astrojs/react` 6, React 19, Tailwind 4.3 via `@tailwindcss/vite`, shadcn CLI 4 (`radix-nova` preset, Radix), `radix-ui`, `lucide-react`, `@fontsource-variable/geist` + `geist-mono`, Leaflet 1.9 from npm, vitest 4, TypeScript 6.

**Spec:** `docs/superpowers/specs/2026-09-11-shadcn-rebuild-design.md`
**Parity contract (the checklist every WP works from):**
- `docs/superpowers/specs/2026-09-11-inventory-dashboard.md` (35 sections)
- `docs/superpowers/specs/2026-09-11-inventory-site-surface.md`
- `docs/superpowers/specs/2026-09-11-inventory-tsa-removal.md`
**UI reference:** the Sep 10 prototype at `~/bb-shadcn` (read-only; copy patterns, not its `src/lib/*.ts` ports).

## Global Constraints (apply to every WP)

- Run tests ONLY with `bun run test` (vitest). Never bare `bun test`. `bun run typecheck` and `bun run build` must be green before each WP's commit. `node` on this Mac is a Bun wrapper.
- Never delete a test; update it. TSA tests are the only deletions (WP11).
- Public copy: the author is "Jonah Berg" only. Never write "Berg-Ganzarain" anywhere.
- Never commit `VITE_CARTO_BASEMAP_KEY`; keep reading it through `src/lib/basemap.js` (`cartoBasemapUrl(import.meta.env.VITE_CARTO_BASEMAP_KEY)`).
- CSP stays `script-src 'self' https://va.vercel-scripts.com`, `style-src 'self' 'unsafe-inline'`, `font-src 'self'`. No inline `<script>`, no `on*=` attributes, no CDN scripts. Bundle Leaflet from npm.
- Status is never colour-alone: every red/amber/green carries an icon or text label.
- Keep `build.format: 'file'`, `cleanUrls`, `middleware.ts` untouched. Every hashed asset lives under `_astro/`.
- Import behaviour from `src/lib/*.js`; do not re-implement it in TSX. New logic goes into a new `src/lib/*.js` module WITH a vitest file first.
- Keep all `localStorage`/`sessionStorage` keys and formats from inventory §29 byte-for-byte (returning users keep their watch lists, home hub, dismissals).
- Keep every `/api/*` contract from inventory §28 (params, fields, polling intervals, retry ladders).
- Commit per WP with a conventional message; do not push.
- Dark is the product default: `<html lang="en" class="dark" style="color-scheme:dark">`.

## File Structure (target)

```
astro.config.mjs                  + react() + tailwindcss()
tsconfig.json                     allowJs, jsx react-jsx, paths @/*, include src/**/*
components.json                   shadcn (radix-nova, css src/styles/global.css, aliases @/components, @/lib)
src/styles/global.css             tailwind + shadcn tokens + leaflet overrides + reduced-motion + content.css import
src/styles/content.css            styles for classes used inside data-file contentHtml strings
src/components/ui/*.tsx           shadcn components (owned)
src/components/site/BaseLayout.astro   <head> (meta, fonts, global.css, analytics), SiteHeader, slot, SiteFooter, JSON-LD slot
src/components/site/SiteHeader.astro, SiteFooter.astro, Seo.astro, JsonLd.astro, Breadcrumbs.astro
src/scripts/*.ts                  Astro-bundled page scripts (trackers, hub-live, newark-live, scroll-hint, sw-register)
src/lib/home-seo.js               the six homepage JSON-LD objects + brief copy (tested)
src/lib/<new modules>.js          extracted from main.js (WP1)
src/app/Dashboard.tsx             island root
src/app/tabs.ts                   tab registry {id, hash, label, icon, view}
src/app/state/*.ts                contexts + hooks (feed, fleet, schedule, weather, irops, watch, home-airport, prefs)
src/app/data/*.ts                 typed fetchers over /api and /data
src/app/shell/*.tsx               Header, Ticker, HubHealthStrip, TabBar, MobileNav, Banners, SearchPalette, WatchPanel, LegalPopover
src/app/views/*.tsx               LiveView, MyFlightsView, ScheduleView, FleetView, StarlinkView, WeatherView, StatsView, SourcesView
src/app/features/*.tsx            FlightSheet, AircraftDetailDialog, DelayExplainDialog, Fr24LookupDialog, Onboarding, WaitlistDialog, DisclaimerDialog, TipStrip, NewsBanner, BmacToast, SupportMeter
src/app/map/*.ts(x)               LiveMap, planeIcon, routeLayer, radarLayer, basemap
src/pages/index.astro             SEO shell + <Dashboard client:only="react"> + fallback skeleton
public/sw.js                      rewritten for hashed assets
```

---

## Task 0 — Toolchain, design tokens, BaseLayout (proof on `/privacy`)

**Files:** Modify `astro.config.mjs`, `tsconfig.json`, `package.json`; Create `components.json`, `src/styles/global.css`, `src/styles/content.css` (empty scaffold), `src/components/ui/*` (via CLI), `src/components/site/{BaseLayout,SiteHeader,SiteFooter,Seo,JsonLd,Breadcrumbs}.astro`, `src/scripts/sw-register.ts`; Modify `src/pages/privacy.astro`; Modify tests: `tests/web-analytics-integration.test.js`, `tests/csp.test.js` (only if they fail).

**Interfaces produced:**
- `BaseLayout.astro` props: `{ title, description, canonical, ogImage?, ogType?, noindex?, jsonLd?: object[] , bodyClass?, dataAttrs? }`. Renders `<html lang="en" class="dark" style="color-scheme:dark">`, full meta set (inventory §33 minus dashboard-only preloads), `<VercelAnalytics />` once, `<SiteHeader />`, `<main><slot /></main>`, `<SiteFooter />`, JSON-LD blocks via `<JsonLd data={…} />` (`set:html={JSON.stringify(data)}`), and `<slot name="head" />`.
- `SiteHeader.astro` props `{ current?: 'dashboard'|'hubs'|'fleet'|'news'|'trackers' }`: brand, primary nav (Dashboard, Hubs, Fleet, News, Trackers), mobile `<details>` menu. Tailwind + tokens only.
- `SiteFooter.astro`: the single footer (replaces the three variants): disclaimer, `/privacy`, data credits, Buy Me a Coffee `https://buymeacoffee.com/notjbg`, "Built by Jonah Berg", `@theblueboard`.
- `global.css`: copy tokens from `~/bb-shadcn/src/index.css` (dark primary `oklch(0.66 0.17 255)`), fonts via `@fontsource-variable/geist{,-mono}`, `--font-sans`/`--font-mono` literal names, Leaflet overrides from inventory §32 (marker hit-area `::after{inset:-5px}`, popup 44×44 close, attribution restyle, tooltip white-space), `.sr-only`, `prefers-reduced-motion` block, focus ring.

- [ ] `bun add @astrojs/react react react-dom @tailwindcss/vite tailwindcss leaflet lucide-react radix-ui class-variance-authority clsx tailwind-merge tw-animate-css @fontsource-variable/geist @fontsource-variable/geist-mono` and `bun add -d @types/react @types/react-dom @types/leaflet`.
- [ ] `astro.config.mjs`: `integrations: [react()]`, `vite: { plugins: [tailwindcss()] }`.
- [ ] `tsconfig.json`: extend `astro/tsconfigs/base`; `compilerOptions`: `allowJs: true, checkJs: false, jsx: "react-jsx", jsxImportSource: "react", paths: {"@/*": ["./src/*"]}, types: ["astro/client"]`; keep `noEmit`. Confirm `bun run typecheck` still covers `api/` and `src/`.
- [ ] `npx -y shadcn@latest init -b radix -p nova -y` from the repo root (it detects Astro). Then `npx -y shadcn@latest add button card badge tabs table sheet dialog alert-dialog command input select tooltip skeleton alert separator scroll-area progress dropdown-menu toggle-group popover checkbox label textarea switch -y`. Verify `components.json` css path is `src/styles/global.css`; move the generated CSS there if the CLI wrote elsewhere.
- [ ] Write `global.css` as specified; `@import "./content.css"` at the end.
- [ ] Build `BaseLayout`, `SiteHeader`, `SiteFooter`, `Seo` (head tags), `JsonLd`, `Breadcrumbs` (Tailwind classes; `Breadcrumbs` emits both visible nav and a BreadcrumbList JSON-LD via `JsonLd`).
- [ ] Convert `src/pages/privacy.astro` to `BaseLayout` (drop the `/css/style.css` link and scoped style). Add `/privacy` to `src/pages/sitemap.xml.ts` (inventory loose end 1) and to `buildMetadata.js` lastmod paths.
- [ ] `src/scripts/sw-register.ts` = the content of `public/js/sw-register.js` as a module (used by `index.astro` in WP2).
- [ ] Update `tests/web-analytics-integration.test.js`: the entrypoint list becomes `src/components/site/BaseLayout.astro` (must contain the exact `<script is:inline defer src="/_vercel/insights/script.js"></script>` via `VercelAnalytics.astro`) plus an assertion that every file under `src/pages/**/*.astro` and `src/layouts/*.astro` either imports `BaseLayout` or `VercelAnalytics` (so nothing ships un-instrumented). Keep the `public/index.html` assertions until WP2 (they still pass).
- [ ] Gates: `bun run test`, `bun run typecheck`, `bun run build`; verify `dist/privacy.html` contains no `<link href="/css/style.css">`, fonts resolve to `/_astro/*.woff2`, no inline `<script>` other than the analytics tag and JSON-LD.
- [ ] Commit: `feat(design-system): Tailwind v4 + shadcn tokens, BaseLayout, privacy on the new system`

---

## Task 1 — Extract dashboard logic from `main.js` into tested `src/lib` modules (zero UI change)

Runs in parallel with WP0 (touches only `src/lib`, `tests`, and import lines in `src/dashboard/main.js`).

**Files:** Create each module + test below; Modify `src/dashboard/main.js` to import from them (delete the inline copies). `bun run test` must stay green and `bun run build:dashboard` must still produce `public/js/dashboard.js`.

| Module | Exports (signatures) | Source in main.js |
|---|---|---|
| `src/lib/flight-phase.js` | `getPhase(altM, vrMs, spdMs) → 'Ground'|'Takeoff'|'Approach'|'Climb'|'Descent'|'Cruise'|'En Route'`, `getPhaseGroup(phase)`, `decodeSquawk(sq) → {label, cls}|null`, `PHASE_ICONS` | :982-1006 |
| `src/lib/geo.js` | `haversineNm(lat1,lon1,lat2,lon2)`, `bearing()`, `angleDiff()`, `greatCirclePoints(a, b, n=60)`, `normalizeLonContinuity(points)`, `isLonghaul(origin, dest, flightNum, coords) ` (> 2500 nm, fallback number < 100) | :912-927, 1330-1346, 1711-1751 |
| `src/lib/airports.js` | `AIRPORTS` (150 entries `{iata, lat, lon, hub?}`), `AIRPORT_COORDS` map, `IATA_CITIES`, `cityFor(iata)`, `nearestAirport(lat, lon, maxNm)` | :218-293, 465-498, 911-927 |
| `src/lib/route-estimate.js` | `UA_ROUTES`, `estimateRoute({lat, lon, hdg, altFt, vrFpm, flightNum}) → {origin, dest, estimated: boolean}` | :404-462, 928-980 |
| `src/lib/plane-icon.js` | `planeIconSpec(hdg, {longhaul, phase, watched, starlink}) → {size, fill, svg, key}` (pure; no Leaflet) | :1348-1373 |
| `src/lib/metar-explain.js` | `parseMetarQuick(raw)`, `applyStructuredMetarFallback(quick, rec)`, `formatStructuredVisibility()`, `hasRenderableMetarData()`, `explainMETAR(raw, hub, cat)`, `worstCategory(apiCat, computedCat)`, `CAT_COLORS`, `CAT_RANK` | :3542-3612, 3875-3880, 4331-4444 |
| `src/lib/faa-context.js` | `buildFaaIndex(list)`, `describeFaaProgram(entry) → {label, window, extras}`, `explainFAAStatus(code, delays, raw)`, `getFAADelayContext(faaIndex, orig, dest) → string|null` | :4446-4481, 5810-5821, 6133-6151 |
| `src/lib/nas-severity.js` | `SEV_LABELS`, `detectSevType(text)`, `sevBadgeClass(type)`, `tierNasEvents(nas, hubCodes) → {critical, active, monitoring}` | :3629-3785 (classifiers only) |
| `src/lib/hub-health.js` | `computeBoardOtp(schedRawByHub, {classify}) → {[hub]: pct}` (excludes inferred/liveFeedFallback/derived; operated ≥ 25), `mergeHubHealth(clientOtp, serverHubs)`, `serverOtpFromMetrics(m)`, `hubHealthSeverity(pct)`, `networkLabel(pcts)`, `HUB_ORDER` | :5739-5802, 6077-6094, 5685-5734 |
| `src/lib/starlink-view.js` | `isRecentlyFound(dateFound, now)`, `getServedConflictTails(disputed, tails, syncedAt)`, `formatFlightTime(ts, iata)`, `airborneByTail(flights)`, `boardCapPolicy({showAll, hub, windowH})` | :2779-2815, 2906-2923, 3176-3271 (cap rule) |
| `src/lib/watch-utils.js` | `MAX_WATCHED`, `readWatched()`, `writeWatched(list)`, `isSignificantStatusChange(prev, next)`, `flightTimesCacheTtl(td, ok, flight)` (+jitter) | :6154, 6240-6247, 6373-6391, 7191-7204 |
| `src/lib/journey.js` | `shapeJourney(segments, myFlight, orig, dest) → {prior: [...≤3 chronological], current}`, `journeyDelayClass(min)`, `buildJourneyContextStr(shaped)` | :6480-6548 |
| `src/lib/special-aircraft.js` | `indexSpecialAircraft(fleetDb) → Map<reg, {kind:'named'|'livery', name}>`, `ENGINE_BY_TYPE`, `SEAT_BAR_COLORS`, `CABIN_COLORS` | :185-215, 2598-2638, 8256-8260 |
| `src/lib/equipment-swaps.js` | `ICAO_TO_FLEET_TYPE`, `getTypicalFleetStats(icao, fleetDb, starlinkTails)`, `detectEquipmentSwaps(flights, key, storage) → {swaps, snapshot}` (storage injected) | :5541-5624 |
| `src/lib/hub-terminals.js` | `UNITED_HUB_TERMINALS`, `getUnitedTerminal(iata, orig, dest)` | :384-400 |
| `src/lib/home-airport.js` | `HOME_HUB_CYCLE`, `readHomeAirport()`, `writeHomeAirport(iata)`, `nextHomeAirport(current)` | :298-309, 7577-7584 |
| `src/lib/tips.js` | `TIPS` by tab, `pickTip(tabId, rng)`, `TIP_ROTATE_MS = 45000`, `TIP_DISMISS_DAYS = 7` | :7729-7791 |
| `src/lib/ticker.js` | `buildTickerItems({opsHealth, airborne, fleetCount, starlinkCount, squawks}) → [{cls, text}]` (priority order from inventory §2) | :2024-2073 |
| `src/lib/live-stats.js` | `computeLiveStats(flights, filtered, fleetSize, starlinkTails) → {airborne, utilization, starlink, climbing, cruising, descending, ground, avgAlt, avgSpd, note}` | :1853-1914 |
| `src/lib/analytics.js` | `typeUtilization(flights, fleetDb)`, `phaseBreakdown(flights)`, `hubMatrix(flights, hubs)`, `topRoutes(flights, 15)`, `avgAgeByType(fleetDb)` | :4105-4266 |
| `src/lib/global-search.js` | `normalizeQuery(q)`, `matchLiveFlights(flights, q)`, `matchScheduleFlights(rows, q)`, `classifyEmptyState(q)`, `FR24_LOOKUP_RE` | :5410-5493 |
| `src/lib/engagement.js` | `shouldShowOnboarding(storage, now)`, `waitlistState(storage, now, {clicks, forced})`, `bmacEligible(storage, now)`, TTL constants | :7979-7984, 8169-8249, 8197-8205 |

- [ ] For each module: write the vitest file first (fixtures copied from current behaviour — at least 3 cases per export incl. an edge case), run to see it fail, extract, run green, replace the inline code in `main.js` with an import, run the full suite.
- [ ] Add `tests/main-js-imports.test.js` asserting `src/dashboard/main.js` no longer defines any of the extracted function names (regex on `function <name>(`).
- [ ] Gates + commit: `refactor(lib): extract dashboard logic from main.js into tested modules`

---

## Task 2 — Dashboard island shell + Live tab, `index.astro`, test retargeting

**Depends on:** WP0, WP1.
**Files:** Create `src/pages/index.astro`, `src/lib/home-seo.js`, `src/app/**` (shell, state, data, map, LiveView, FlightSheet, SearchPalette, placeholders for the other views), `tests/home-seo.test.js`; Move `public/index.html` → `legacy/index.html` and `public/css/style.css` → `legacy/style.css` (reference only; `legacy/` is not copied to dist); Modify `package.json` build (drop `vite build --config vite.dashboard.config.js`; `dev` = `astro dev`), `scripts/stamp-seo-build-date.mjs` (stamp only `dist/llms.txt` and `dist/llms-full.txt`; delete the `__HOME_LASTMOD__` requirement), delete `scripts/run-astro-dev.mjs`, `src/lib/buildMetadata.js` (`homeLastmodPaths` = `['src/pages/index.astro', 'src/app', 'src/lib/home-seo.js', 'public/data/fleet.json', 'public/data/starlink.json']`); Modify tests: `agent-readiness`, `csp`, `compliance`, `fleet-consistency`, `web-analytics-integration`, `basemap`, `leaflet-required-styles`, `build-metadata`.

**Interfaces produced (used by WP3–WP8):**
- `src/app/tabs.ts`: `TABS: {id:'live'|'myflight'|'schedule'|'fleet'|'starlink'|'weather'|'stats'|'sources', hash, label, icon, mobilePrimary: boolean, View: React.LazyExoticComponent}[]` — all eight registered; non-Live views are placeholder components exporting `default function XView()` in their own files so later WPs replace only their file.
- `src/app/state/feed.tsx`: `<FeedProvider>` + `useFeed() → {flights, lastGoodTs, freshness, countdown, refresh(), retrying}` (30 s poll, ladder, visibility pause, stale header, reg-ledger recording).
- `src/app/state/fleet.tsx`: `useFleet() → {fleetDb, fleetByReg, starlink: {tails, flightsByTail, stats, aircraft, lastUpdated, syncedAt, degraded}, fleetSummary, special, loadFailed, retry()}`.
- `src/app/state/prefs.tsx`: `usePrefs() → {homeAirport, setHomeAirport, cycleHomeAirport}` (via `home-airport.js`).
- `src/app/state/watch.tsx`: `useWatch() → {watched, toggle(flight, route, status), clearAll(), isWatched(id), push: {configured, permission, enable()}}` (via `watch-utils.js`; push sync via `/api/push-subscribe`).
- `src/app/state/schedule.tsx`: store interface only (WP3 fills): `useSchedule() → {boards: Record<key, Board>, meta, load(hub, dir, day), preload(), current, setCurrent}`; `useHubHealth()` returns merged OTP via `hub-health.js` (server metrics from `useIrops`, client from boards).
- `src/app/state/weather.tsx`: `useWeather() → {metarByHub, faaIndex, nas, weatherOpsByHub, refresh(), updatedAt}` (WP4 fills; provider exists with 5-min timer stub).
- `src/app/state/irops.tsx`: `useIrops() → {data, fetchedAt, refresh()}`.
- `src/app/state/ui.tsx`: `useUi() → {tab, setTab(id, {hash?}), selection, select(sel), focus, focusOn(lat, lon), openAircraft(reg), openDelayExplain(ctx), openFr24(q), announce(text)}`.
- `src/app/data/api.ts`: typed fetchers for every endpoint in inventory §28 (params exactly as listed).
- `src/app/map/LiveMap.tsx` props `{flights, filtered, selectedId, onSelect, focus, layers: {hubs, wx, starlink}, view: 'us'|'pacific'}`; exports `US_VIEW`, `PACIFIC_VIEW`.

- [ ] `src/lib/home-seo.js`: export `HOME_BRIEF` (h1, intro, 5 "what you can check" bullets — TSA bullet removed, Starlink figures interpolated from `src/data/starlink-live.json` `live.label`/`live.asOf`, fleet count from `facts.js` `FLEET_DB_COUNT`), `HOME_NAV_LINKS` (15), `NOSCRIPT_LINKS`, and `homeJsonLd({lastmod}) → [Organization, WebPage, WebApplication, FAQPage, Dataset, WebSite]` with the exact field values from `legacy/index.html:1010-1227` (agent-readiness pins: `@id https://theblueboard.co/#organization`, contactPoint `hello@theblueboard.co`, PostalAddress Los Angeles/CA/US, SearchAction `?flight={flight_number}`). Test: `tests/home-seo.test.js` asserts those pins + 6 blocks + no "425+" literal (figures come from data).
- [ ] `src/pages/index.astro` on `BaseLayout` (dashboard variant: no SiteHeader; `<Dashboard client:only="react">` with a `slot="fallback"` skeleton), rendering in order: skip link, `<section class="sr-only" aria-labelledby="page-brief-title">` with `<h1 id="page-brief-title">` BEFORE any `<header>`, `<nav class="sr-only">`, `<noscript>` block, the island, then JSON-LD at end of body. Manifest link, theme-color, apple metas, `<script src="../scripts/sw-register.ts">` (bundled). Keep the sr-only fleet summary section (inventory §33) rendered from `facts.js` + `fleetTypes` + starlink-live.
- [ ] Shell: `Header` (brand, live chip keyed to payload age, countdown, UTC clock, watch button + badge, home-hub cycle button, `?` help, search button ⌘K), `Ticker` (fade rotation 5 s from `ticker.js`, `aria-live="off"`), `HubHealthStrip` (from `hub-health.js`; hub links to `/hubs/<x>`, home 🏠, program glyphs, network chip), `TabBar` (shadcn Tabs, roving tabindex, `<nav aria-label="Dashboard navigation">`), `MobileNav` (bottom bar: Live/Weather/Schedule/My Flights + More sheet with Starlink/Fleet/Stats/Sources), `OfflineBanner`, `IropsAnnouncer` (`role=status`, single writer), `WatchPanel` (Popover/Sheet, list + Clear All), `SearchPalette` (Command dialog; `global-search.js`; live + schedule results; FR24 lookup row; contextual empty states; ArrowUp back to input).
- [ ] `LiveView`: map (Leaflet, CARTO via `basemap.js` with the two keyed layers, `worldCopyJump`, zoom bottomright, attribution ON), hub circle markers + pulse, plane markers via `plane-icon.js` (diffed by fr24id, `role="img"` aria-label), great-circle route layer on select, controls toolbar (Hubs / Long-haul / Starlink (disabled state) / Radar / Pacific / Refresh) as a `ToggleGroup`, legend, sidebar (hub stats with bars + BUSIEST/FILTERED, phase rows, sidebar search with hub-filter row, `Filters` collapsible), stats bar (9 stats via `live-stats.js`, hidden 769–1080 px), map error overlay with retry, mobile: sidebar as bottom Sheet, controls speed-dial.
- [ ] `FlightSheet` (replaces the Leaflet popup): header, city line, codes, estimated-route note, phase chip, squawk alert, metrics grid via `flight-popup.js`, aircraft block (matched/unmatched), async `/api/flight-times` block with precedence + delta badges, links (FlightAware, Planespotters, ADS-B Exchange), Watch, Share (clipboard with fallback + prompt), `?flight=` set/remove on open/close.
- [ ] Deep links: `#hash` ↔ tab (`TAB_HASHES`), `?tab=` incl. `irops` → weather + scroll, `?flight=`/`?q=` after first non-empty poll (else FR24 lookup), `?hub=` with `tab=schedule`, `?type/?filter/?view` (forward to fleet store), `?aircraft=`, `?waitlist=1` (forward to WP8 engagement store). Popup close removes `?flight`.
- [ ] `legacy/`: add to `.gitignore`? NO — commit the two files under `legacy/` (reference for WP3–WP10); delete in WP12. Add `legacy/README.md` saying so.
- [ ] **CSP for islands (measured 2026-09-11):** Astro emits three inline scripts for React islands — the `astro:only` shim (130 B), the `astro-island` runtime (~4.4 KB) and the `astro:load` shim (130 B); their content is fixed per Astro version. Add `'sha256-<hash>'` tokens for every inline script found in `dist/*.html` to `script-src` in `vercel.json` (never `'unsafe-inline'`), and add `scripts/verify-csp-hashes.mjs` to the end of `bun run build`: it scans every `dist/**/*.html`, hashes each inline `<script>` body that is not `type="application/ld+json"` (and not the `is:inline` analytics `src=` tag), and exits non-zero naming the file + hash if any hash is missing from the header. Update `tests/csp.test.js` to accept `'sha256-…'` tokens and to require that guard script in `package.json` `scripts.build`. Prefer `client:only="react"` for the dashboard so only two hashes are needed.
- [ ] **Dependency pins from Task 0:** `@astrojs/react ^5.0.7` (the 6.x line targets Astro 7 / vite 8 and breaks `@tailwindcss/vite`), `vite ^7.3.2` declared explicitly so vitest cannot hoist vite 8. Do not bump either.
- [ ] **Leaflet overrides** in `global.css` were written for specificity but never browser-verified (no page had a map): verify the 44×44 popup close button, dark attribution pill and map background in the browse pass and fix in `global.css` if they lose to `leaflet.css`.
- [ ] Retarget tests: `agent-readiness` → read `src/pages/index.astro` for the h1-before-header, sr-only section, nav links, noscript links, and import `home-seo.js` for JSON-LD pins; `csp` → scan `src/pages/index.astro` + `src/app/**` for inline handlers (`on\w+=` in JSX is fine — scan `.astro` only) and keep the vercel.json directive checks; `compliance` → read `src/app/map/*.ts*` (never `attributionControl: false`, contains `OpenStreetMap`) and `src/app/views/SourcesView.tsx` (AeroDataBox, CARTO, OpenStreetMap; "Schedule data via AeroDataBox" ≥ 2 across `src/app`); `fleet-consistency` → sum equals `FLEET_DB_COUNT` from `facts.js`; `basemap` → the map module contains `cartoBasemapUrl(import.meta.env.VITE_CARTO_BASEMAP_KEY)` and two keyed layers (live + radar); `leaflet-required-styles` → read `src/styles/global.css`; `build-metadata` → new `homeLastmodPaths`; `web-analytics-integration` → drop the `public/index.html`/`main.js` assertions, assert `index.astro` uses `BaseLayout`.
- [ ] Update `scripts/build-agent-markdown.mjs` inputs if `agent-markdown.js` HOME copy changes (remove the TSA sentence now; WP11 finishes the rest).
- [ ] Gates + `bunx vite`-free check: `bun run build` produces `dist/index.html` with the island and no `/js/dashboard.js`; `curl`-style grep of `dist/index.html` for `page-brief-title`, `application/ld+json` ×6, `_astro/`.
- [ ] Browser check (gstack browse, `bun run preview`): Live tab renders flights via the prod proxy (`astro.config` `server.proxy` or `vite.server.proxy` `/api` → `https://theblueboard.co` for dev/preview only), sheet opens, ⌘K works, mobile 400 px layout, no console errors.
- [ ] Commit: `feat(dashboard): React island shell + Live tab on index.astro; retarget structural tests`

---

## Task 3 — Schedule tab

**Depends on:** WP2. Runs in parallel with WP4–WP8 (own worktree).
**Files:** `src/app/views/ScheduleView.tsx` (+ `schedule/*.tsx` subcomponents), fill `src/app/state/schedule.tsx`, `src/app/data/schedule.ts`; tests for any new lib helper.

- [ ] Controls: day ToggleGroup (hub-local labels), hub Select (All + 9), dir Tabs, `Find in board` Input mirrored with drawer search, Jump to NOW pill, Refresh (clears cache key), advanced-filter Sheet/Collapsible with 7 selects + search (`schedule-board-filters.js`, `schedule-filters.js`), active-count label, reset-on-context-change, Escape closes and refocuses.
- [ ] Loading per inventory §20 (60 s abort, `agg-` cache, server-clock offset from `Date`/`Age`, 3 retries with backoff, frozen context, pending reload, preload ORD/DEN/EWR sequential with 10-min session TTL, initial day via `defaultSchedDayOffset`).
- [ ] Staleness banner ladder + `data-age.js` palette + age chip + `formatBoardAsOf`.
- [ ] Table: 10 columns, sortable with `aria-sort`, time/date-chip/actual line, route name promotion, reg via provider-first + ledger backfill tooltip, terminal/gate via `hub-terminals.js`, status via `schedule-status.js` + `status-display.js` (+ LIVE chip, presumed `*`, as-of sub-line), Delay/Risk precedence (`delay-format.js`, `delay-risk.js`), fleet enrichment, equipment-swap badge (`equipment-swaps.js`, `swap-impact.js`), ⭐, FAA context line (`faa-context.js`), watch button, NOW divider (`board-now.js`) with one-shot scroll, empty state, AeroDataBox footer.
- [ ] Live-feed overlay via `reg-overlay.js` inside the filtered selector.
- [ ] Stat strip (`board-stats.js`) incl. Uncategorized + note chip + GDP warning.
- [ ] Equipment swap summary banner opening the drawer.
- [ ] Fan-out after load: hub health (via store), IROPS client fallback (`useIrops` fallback path, single-writer), watched-flight diffing (`watch-utils.js`; native Notification when hidden, banner otherwise, BMAC toast on landed).
- [ ] `goto-schedule-result` from the palette: set hub/dir, load, scroll + 2 s highlight.
- [ ] Commit: `feat(schedule): port Schedule tab`

## Task 4 — Weather / Delays tab

**Depends on:** WP2. **Files:** `src/app/views/WeatherView.tsx` (+ `weather/*.tsx`), fill `src/app/state/weather.tsx`, `src/app/map/RadarMap.tsx`.

- [ ] Two-panel layout; radar Leaflet instance (CARTO keyed + NEXRAD .6, hub markers coloured by category after METAR, permanent tooltips, click highlights card), `#radar-title` timestamp, legend, scroll hint with IntersectionObserver.
- [ ] Fetch `allSettled([metar chunks, faa, nas])`; hub→station map; worst-of category; `computeOpsImpact` into `weatherOpsByHub`; extra stations from watched routes + loaded boards (`getMetarStationForIata`).
- [ ] Hub cards (border, DE-ICE, cat badge, metrics via `metar-explain.js`, runway line, status precedence with jargon tooltips, Details collapsible with explainers/NOTAM/raw).
- [ ] Skeletons; total-failure retry; 5-minute refresh skipped when hidden; feeds hub-health strip + ticker.
- [ ] NAS panel via `nas-severity.js`.
- [ ] IROPS section: server render (`irops-score.js`, rate floor, single writer, announcer) + client fallback rendering from schedule store.
- [ ] Tracker briefing from `src/data/trackers/index.js` with home-hub branch and `bb_tracker_watches`.
- [ ] Commit: `feat(weather): port Weather/Delays tab incl. IROPS + NAS`

## Task 5 — Fleet tab + Aircraft detail dialog

**Depends on:** WP2. **Files:** `src/app/views/FleetView.tsx` (+ `fleet/*.tsx`), `src/app/features/AircraftDetailDialog.tsx`.

- [ ] Zones 1–3 exactly per inventory §21 (`fleet-utils.js`, `special-aircraft.js`, `analytics.js` for utilization), age chart as inline SVG, config gallery, sub-tabs with counts, controls with 120 ms debounce, deep-link filters (`?type/?filter/?view`), airborne table, special panel, zero-results + Clear, load-error state with retry, "Refresh" = reload.
- [ ] `AircraftDetailDialog` (shadcn Dialog) per §27 incl. jargon terms, seat bar, live status click → focus map, footer actions, `?aircraft=` share.
- [ ] Commit: `feat(fleet): port Fleet tab + aircraft detail dialog`

## Task 6 — Starlink tab

**Depends on:** WP2. **Files:** `src/app/views/StarlinkView.tsx` (+ `starlink/*.tsx`).

- [ ] Hero, velocity SVG chart (outlier cap, footnotes, thinned labels), pace caption (`starlink-utils.js`), industry strip (`/api/fleet-summary`), hub departures board (`buildDeparturesBoard`, window toggle, cap policy from `starlink-view.js`, pills, show-all, Track buttons, freshness), roster table (filters, sort, hidden columns, NEW badge, integrity dot, one-row expansion), verification ledger (`/api/starlink-mismatches`, tripwire alert), degraded-tier behaviour, source footer.
- [ ] Commit: `feat(starlink): port Starlink tab`

## Task 7 — My Flights + watch + push + AI/FR24 dialogs

**Depends on:** WP2. **Files:** `src/app/views/MyFlightsView.tsx` (+ `myflight/*.tsx`), `src/app/features/{DelayExplainDialog,Fr24LookupDialog}.tsx`, finish `src/app/state/watch.tsx` push flow.

- [ ] Empty state + quick-add (UA normalisation) + placeholder rotator; cards per §19 (status via `flight-status-resolve.js`, countdowns 1 s while active, gates via `hub-terminals.js`, equipment/forecast badge, provenance chip, actions); flight-times TTL cache (`watch-utils.js`); fail-terminal chip; risk badge precedence (`delay-risk.js`, board reuse, RISK N/A); journey chain (`journey.js`, `/api/aircraft-history`, 5-min cache); Where's My Plane card; connection risk cards (`connection-risk.js`, honesty clause) + manual checker (three-way outcome).
- [ ] Watch panel/push: prompt after first add (500 ms, 15 s auto-hide), permission flow, `syncPushSubscription`, footnote tiers.
- [ ] `DelayExplainDialog` (POST `/api/delay-explain` with the exact body; shimmer; factors list; "Powered by Claude AI").
- [ ] `Fr24LookupDialog` (never blocking on failure → palette error slot; leg-date disclaimer; fleet cross-ref; Share).
- [ ] Commit: `feat(my-flights): port My Flights, watch list, push, AI explain, FR24 lookup`

## Task 8 — Stats + Sources + engagement surfaces + PWA

**Depends on:** WP2. **Files:** `src/app/views/{StatsView,SourcesView}.tsx`, `src/app/features/{Onboarding,WaitlistDialog,DisclaimerDialog,TipStrip,NewsBanner,BmacToast,LegalPopover,SupportMeter}.tsx`, `public/sw.js`, `tests/sw.test.js`, `tests/popup-triggers.test.js` (keep; engagement.js must satisfy it or the test is retargeted to `engagement.js`).

- [ ] Stats: 4 metric cards + 5 panels from `analytics.js` (util bars, phase donut SVG, hub matrix, top routes, avg age), refresh on poll while active.
- [ ] Sources: 10 cards + disclaimer; fix the Starlink tracker pill to a consistent DAILY label; must contain "AeroDataBox", "CARTO", "OpenStreetMap".
- [ ] Onboarding (Dialog with focus trap, home-hub Select, show/hide rules, `?` reopen), Waitlist dialog (`engagement.js` triggers T1/T2/T4, validation, POST, duplicate = success, suppression), BMAC toast (14-day cooldown), Tip strip (`tips.js`), News banner (`/data/news-latest.json`, rotation, dismissal, `va.track`), Disclaimer dialog (full copy + Supporters Wall 17 chips), Legal popover (link grid + hub nav) with Support meter (`/api/support-stats`, warn ≥85 %), Attribution micro-text.
- [ ] Share actions (flight/aircraft) with clipboard fallback + prompt.
- [ ] PWA: rewrite `public/sw.js` v11 — precache `['/']` + navigation network-first; `/api/*`,`/data/*` network-first no-store; `/_astro/*` cache-first immutable; everything else same-origin stale-while-revalidate; push + notificationclick unchanged. Update `tests/sw.test.js` (replace `/js/support-meter.js` & `/css/style.css` cases with a `/_astro/x-abc123.js` cache-first case and a navigation case; keep cross-origin pass-through using a CARTO tile URL instead of unpkg). Register from `src/scripts/sw-register.ts`.
- [ ] Commit: `feat(dashboard): Stats, Sources, engagement surfaces, PWA on hashed assets`

## Task 9 — Content pages on BaseLayout (hubs, fleet, news, newark, 404)

**Depends on:** WP0. Can run in parallel with WP2–WP8 (touches `src/pages`, `src/layouts`, `src/data` classes only).
**Files:** Modify `src/layouts/{HubLayout,FleetTypeLayout,NewsLayout}.astro`, `src/pages/{404,newark}.astro`, `src/pages/{hubs,fleet,news}/index.astro`; Create `src/scripts/{hub-live,newark-live,scroll-hint}.ts`, `src/styles/content.css`; Delete `src/components/Footer.astro` (replaced by `SiteFooter`); Modify `tests/build-metadata.test.js` only if paths change (keep layout file names).

- [ ] `content.css`: grep every `class="…"` used inside `contentHtml`/`body` strings in `src/data/hubs/*.js`, `src/data/fleet/*.js`, `src/data/news/index.js`; style each class on the new tokens (`@apply`), plus element defaults (h2/h3/p/ul/table/blockquote) scoped under `.bb-content`. No data-file HTML edits unless a class is unstyleable.
- [ ] Each page/layout: `BaseLayout` + shadcn-style Tailwind markup (cards, badges, stat tiles, jump-nav pills, highlight boxes, breadcrumbs via `Breadcrumbs.astro`), keep every SEO/JSON-LD block (via `JsonLd`), every cross-link, hub nav, fleet nav, per-hub OG images, `data-hub-iata`, CTA links `/?hub=`, `/?tab=fleet&type=`, `/?waitlist=1`. Remove the TSA highlight box from `HubLayout` now (WP11 does the rest).
- [ ] Port `public/js/{hub-live-data,newark-live,scroll-hint}.js` into `src/scripts/*.ts` loaded with `<script src>` (bundled; same DOM ids or updated selectors); delete the public copies.
- [ ] Add null guards + `/404` redirect in `hubs/[hub].astro` and `fleet/[type].astro` (TODOS:40).
- [ ] Gates + a browse screenshot pass of `/hubs`, `/hubs/ord`, `/hubs/nrt`, `/fleet`, `/fleet/737-800`, `/news`, one article, `/newark`, `/404` at 1440 and 400 px.
- [ ] Commit: `feat(pages): hubs, fleet, news, newark, 404 on the new design system`

## Task 10 — Trackers on BaseLayout

**Depends on:** WP0. Parallel with WP9. **Files:** `src/components/trackers/*.astro` (12), `src/pages/trackers/**`, Create `src/scripts/trackers.ts` (from `public/js/trackers.js`), delete the public copy.

- [ ] Restyle all 12 components + 4 pages on tokens; keep all `data-trk-*` hooks, the JSON config blob, map SVG semantics (shape + colour), sticky table, search progressive enhancement, downloads, GitHub issue link, peer nav, Dataset/Article/FAQ JSON-LD, anchors.
- [ ] `tracker-seo`, `tracker-data`, `tracker-map` tests stay green untouched.
- [ ] Commit: `feat(trackers): trackers on the new design system`

## Task 11 — TSA removal (one atomic commit)

**Depends on:** WP2, WP9. Follow `2026-09-11-inventory-tsa-removal.md` deletion order; additionally add `{ "source": "/tsa", "destination": "/hubs", "permanent": true }` to `vercel.json` redirects, remove the `/tsa` header block, cron, both function entries, and update `tests/asset-cache.test.js`, `tests/agent-readiness.test.js`, `tests/web-analytics-integration.test.js`, `README.md`, `TODOS.md`, `public/llms*.txt`, `src/lib/agent-markdown.js`, `api/waitlist.ts`. Gates. Commit: `feat!: remove the TSA checkpoint guide`.

## Task 12 — Cleanup, config, docs, version

**Depends on:** WP3–WP11.
- [ ] Delete `src/dashboard/`, `vite.dashboard.config.js`, `legacy/`, `public/js/*` (all ported), `public/fonts/*`, `public/css/`, `scripts/run-astro-dev.mjs`; `package.json` scripts `dev: astro dev`, `build: bun scripts/refresh-starlink-facts.mjs && astro build && bun scripts/stamp-seo-build-date.mjs && bun scripts/build-agent-markdown.mjs`, remove `build:dashboard`; remove `tests/main-js-imports.test.js`.
- [ ] `vercel.json`: CSP drop `https://unpkg.com` from script-src/style-src; remove `/css/(.*)` and `/js/(.*)` cache rules; add `/fonts` not needed; add cache rule for `/fleet/(.*)` (same as hubs) and `/icons/(.*)`, `/og/(.*)` (1 day). Update `tests/csp.test.js` (no unpkg expectation) and `tests/asset-cache.test.js`.
- [ ] `DESIGN.md` rewritten for the shadcn system (tokens, fonts, components map, status rule, motion, breakpoints, anti-patterns). `README.md` project structure + tech stack + features (no TSA). `MAINTENANCE.md` new-route checklist updated (BaseLayout, no `public/index.html` navs). `scripts/ui-audit.mjs` PAGES unchanged minus `/tsa`. `.env.example` unchanged. `public/llms*.txt` reviewed for stale claims.
- [ ] `CHANGELOG.md` 1.8.0 entry; `package.json` version 1.8.0; `src/data/facts.js` untouched.
- [ ] Commit: `chore(release): v1.8.0 — shadcn/ui rebuild, TSA removed`

## Task 13 — Parity audit, browser QA, PR

- [ ] Fresh Opus reviewer: walk all three inventories, tick each item with a file reference in `docs/superpowers/specs/2026-09-11-parity-audit.md`; unticked = gap list. Fix gaps (new WP if large).
- [ ] Browse QA (`bun run preview` behind the `/api` proxy): every tab desktop + 400 px, every content page, ⌘K, sheet, dialogs, deep links (`/?flight=UA1`, `/?tab=irops`, `/?hub=ord&tab=schedule`, `/?aircraft=`, `/?waitlist=1`, `#stats`), offline banner toggle, console clean.
- [ ] `bun run test && bun run typecheck && bun run build` green; `git diff --stat main`.
- [ ] Push branch, open PR (title `feat: shadcn/ui rebuild (v1.8.0)`), body: summary, parity audit link, screenshots, "TSA removed", the CARTO preview note, local build evidence, and the required post-merge check (`postmerge-check.sh`). Jonah merges.
- [ ] Hand-off packet for the ChatGPT review: PR URL + `docs/superpowers/specs/*` + `git diff --stat`.
