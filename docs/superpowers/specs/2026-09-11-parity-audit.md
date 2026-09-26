# The Blue Board — shadcn/ui rebuild: parity audit

**Audited commit:** `9706d5e` (`feat/shadcn-rebuild`, v1.8.0) · **Base for comparison:** `06b77a7` (`main`, v1.7.24)
**Date:** 2026-09-14 · **Auditor:** fresh Opus reviewer (Task 13), read-only on every file but this one

This audit walks every checklist item and table row of the three inventories, in order. The
legacy tree is gone from the working copy (Task 12 deleted `legacy/` and `src/dashboard/`), so
every legacy comparison below was made against `git show 06b77a7:…`. Task reports were used only
as a starting map; every row was re-verified against the shipped source, the built `dist/`, or a
live browser session.

## Verdict key

| | meaning |
|---|---|
| ✅ | present — implemented, with the file (and value, where the inventory pins a number or a string) |
| 🔁 | intentionally changed — authorised by a ledger ruling, the design spec, or a task-report deviation; the user-visible difference is stated |
| ❌ | gap — missing or diverging with no ruling |
| ➖ | not applicable — the spec removes it (TSA) or the inventory itself flagged it as dead code (§35) |

## Counts

| Inventory | ✅ | 🔁 | ❌ | ➖ | rows |
|---|---|---|---|---|---|
| Dashboard (§0–§35) | 351 | 45 | 5 | 10 | 411 |
| Site surface (§1–§9 + loose ends) | 59 | 23 | 6 | 3 | 91 |
| TSA removal (§1–§9 + order) | 12 | 0 | 0 | 37 | 49 |
| **Overall** | **422** | **68** | **11** | **50** | **551** |

**Counting rule:** one row per inventory checklist item or table row. A row carrying more than one
verdict (e.g. `✅ / ❌`) is counted under the **most severe** one it carries (❌ > 🔁 > ➖ > ✅), so
the totals are conservative.

**What ✅ means:** the observable behaviour is present — *not* that the implementation is the
same code. Where the mechanism changed but the contract did not (Radix supplying the focus trap
and Escape handling the legacy hand-rolled; a provider effect replacing a hand-wired listener),
the row is ✅. 🔁 is reserved for rows where the *user-visible* result differs. Read the ✅ count
as "behaviour preserved", never as "code unchanged" — almost every file in the dashboard is new.

**Why 11 ❌ marks but 7 gaps.** Four ❌ marks are duplicates or notes rather than distinct defects:
`watchedFlights` is marked in both §6 and §29 (one gap, **G1**); the stale `/css/`, `/js/`, `/fonts/`
prefixes are marked in both §1.1 and §4.4 (one gap, **G7**); and the two §31 rows marked `❌→note`
(coordinates ×3, `IATA_CITIES` vs `AIRPORTS`) are **pre-existing duplication the inventory itself
files under "flag", not "port"** — unchanged by the rebuild, no behaviour differs, and therefore not
listed as gaps below. The gap list is the authoritative count: **7**.

---

## Gap list

Seven gaps. **None is a user-visible loss of a dashboard feature, and none loses stored data.**
All seven are dead code, stale documentation, or a cosmetic fallback. No gap blocks the merge.

### User-visible loss

*None.* Every feature in the three inventories that a visitor can reach is present in the
rebuild, or changed under an explicit ruling. The heaviest surfaces — the live map and its
filters, the ten-column schedule board with its NOW divider and staleness ladder, My Flights with
connections and journey chains, the Starlink roster/board/ledger, the weather + IROPS + NAS
panel, Fleet's three zones, Stats, Sources, and all five overlays — were exercised in a live
browser session (see **Spot-checks performed**).

### Contract loss

*None.* Every storage key, query parameter, API shape and header contract in the inventories is
honoured byte-for-byte (spot-checks **S12**, **R1–R7**). The one key that is no longer read — the
pre-rename `watchedFlights` alias — never carried a watch list; it is filed as cosmetic **G1**
below with the evidence.

### Cosmetic / dead code

| # | What is missing | Where it should live | Fix size |
|---|---|---|---|
| G1 | The legacy `watchedFlights` localStorage alias is no longer read. **Verified in the legacy tree:** `git grep watchedFlights 06b77a7` returns exactly one line — `src/dashboard/main.js:5869`, `localStorage.getItem('bb_watched_flights') \|\| localStorage.getItem('watchedFlights')` — inside the *weather* preload, where its only effect was widening the METAR station list to the watched flights' origin/destination airports. Nothing in the legacy tree ever **wrote** that key, and the watch list itself hydrated from `bb_watched_flights` alone. The rebuild keeps the widening behaviour (`src/app/state/weather.tsx:124` → `collectMetarStations({ routes: watchedRef.current… })`, `src/lib/weather-cards.js:95`) reading the current key. What is lost: a few extra METAR cards for a profile that predates the rename. **No watch list is lost.** | `src/lib/watch-utils.js` `readWatched()` — one `\|\| localStorage.getItem('watchedFlights')` fallback | S |
| G2 | `src/components/Footer.astro` is a dead compatibility shim — nothing imports it (`grep -rn "Footer.astro" src/` finds only its own header and `site/SiteFooter.astro`'s comment). The ledger ruling is explicit: *"T9 keeps `src/components/Footer.astro` as a thin re-export of SiteFooter; **T12 deletes it**."* T12 did not. | delete `src/components/Footer.astro` | S |
| G3 | The board's cached-load message **"⚡ Served from cache · N UA flights"** (`06b77a7:src/dashboard/main.js:4763`) is absent from the rebuild. Recorded in the ledger as a Task 3 *deferred minor*, which is not an ACCEPT ruling. | `src/app/views/ScheduleView.tsx` loading branch, fed by a `fromCache` flag on `Board` in `src/app/state/schedule.tsx` (the store already knows — `wasCached` in `runLoad`) | S |
| G4 | `TODOS.md` still carries four entries that name deleted files: `public/index.html` (lines 10, 38), `dashboard.js`/`style.css` (line 27), `src/dashboard/main.js` (line 32) and `scripts/run-astro-dev.mjs` (line 34). The TSA line was removed as the inventory required; these survived Task 12's doc pass. | `TODOS.md` | S |
| G5 | `src/components/VercelAnalytics.astro:3` still says *"The dashboard (public/index.html) loads the same script inline"* — that file no longer exists, and the homepage now mounts `<VercelAnalytics />` through `BaseLayout` like every other page. | `src/components/VercelAnalytics.astro` comment | S |
| G6 | `DESIGN.md` still mentions `unpkg` in prose. Leaflet is bundled from npm and `unpkg.com` is now negatively asserted by `tests/csp.test.js:82-84`; the prose is stale. | `DESIGN.md` | S |
| G7 | `middleware.ts:31` and `src/lib/site-routes.js:20-30` still exclude/allow `/css/`, `/js/` and `/fonts/` — three directories that no longer exist in `public/`. Harmless (they only widen a "definitely not a page" test in the safe direction) but stale, and `tests/agent-readiness.test.js` still pins `/js/dashboard.js` and `/css/style.css` against the matcher. | `middleware.ts`, `src/lib/site-routes.js`, `tests/agent-readiness.test.js` | S |

---

## Intentional changes

Every 🔁 below, with the authority for it.

| Area | Change | Authority |
|---|---|---|
| §0 build | Vite IIFE dashboard bundle, `public/js/dashboard.js`, global `BB`, external Leaflet → single Astro build, React island, Leaflet bundled from npm | spec §2.1 |
| §0 stamping | `stamp-seo-build-date.mjs` no longer touches `dist/index.html` (Astro imports `starlink-live.json` + `getLastModified()` directly); it still hard-fails on `dist/llms.txt` / `llms-full.txt` | spec §2.1; `scripts/stamp-seo-build-date.mjs` header |
| §0/§33 CSP | `'unsafe-inline'` never re-added; Astro's two island inline scripts allowed by `sha256-…` + a build-time guard | ledger ruling "Astro island inline scripts … allowed via `'sha256-…'` tokens … never `'unsafe-inline'`" |
| §2 ticker | Marquee render mode dropped; the 5 s fade rotation is the only mode | Task 2 report — the marquee required >768 px **and** the ticker outside `#header`, which stopped being true once the strip moved into the canopy |
| §4/§5 search | `#global-search-wrap` + `#search-input-side` → a ⌘K `CommandDialog` (global) plus the Live sidebar's own search | spec §2.2 `features/search palette`; Task 2 |
| §13 legal | `#legal-details` moved out of the map's bottom-right corner into the in-flow attribution strip | ledger ruling "ⓘ legal menu + BMAC toast moved out of the map's bottom-right (legacy overlapped Leaflet zoom-out; leaflet test forbids it) — **Ruling: ACCEPT**" |
| §12 BMAC | Landing toast moved to bottom-**left** | same ACCEPT ruling |
| §11 waitlist | Trigger T3 (flight landing → waitlist modal) removed; the landing moment now raises the BMAC toast only | Task 8 report; `features/WaitlistDialog.tsx` header |
| §14 mobile | `#mobile-more-menu` → a shadcn `Sheet`; `#mobile-ctrl-toggle` / `#mobile-sidebar-toggle` → a Filters `Sheet`; overflow set derived from `tabs.ts` `mobilePrimary` instead of hardcoded | spec §2.2; Task 2 |
| §14 sidebar | `#sidebar-filters-toggle` / `#sidebar-extra-filters` collapse dropped — the sidebar is always open at `lg:` and is itself a dismissible Sheet below it, so the collapse has no job | Task 2 (sidebar → Sheet) |
| §15 PWA | `CACHE_VERSION` v10 → **v11**; precache `['/', '/index.html']` → `['/']`; the `/js/*` + `/css/style.css` network-first branch replaced by a cache-first `/_astro/*` branch | spec §2.5 "precache list changes to hashed `_astro/` assets"; `public/sw.js:1-18, 137-165` |
| §16 `?hub=` | Selects the schedule board hub directly instead of typing into the search box | ledger: "`?hub=` selects the board hub instead of typing into search (**accepted as better**)" |
| §16 `?view=` | No longer requires `tab=fleet` | ledger: "`?view=` no longer requires `tab=fleet` (harmless)" |
| §17 jargon | `jargonTerm()` + `jgt-tip-N` ids + hand-rolled viewport clamping → `features/JargonTerm.tsx` on Radix Tooltip; the seven `JARGON_TERMS` strings are verbatim | Task 4; `src/app/features/JargonTerm.tsx:23-31` |
| §17 tab bar | Hand-rolled roving tabindex / arrow wrap / Home-End → Radix `Tabs` | spec §2.2 |
| §18 popup | Leaflet popup → non-modal shadcn `Sheet` (focus trap, Escape, not clipped, survives a poll) | spec §2.2 `features/flight sheet`; Task 2 |
| §18 hub filter | `HUB_PROXIMITY_NM = 93` compared against `haversineNm` | **byte-for-byte faithful** — legacy `haversine()` returns nm (`R = 3440.065`), so `< 93` was always 93 NM. The legacy `// ~50nm` comment and the inventory's "93 km" are both wrong. Listed in the PR as a legacy-bug disclosure, not a port change |
| §20 swaps | Swap detection runs only on a real fetch, not on a cache hit | Task 3 review: "a strict improvement (legacy wiped badges on cache hits)" |
| §22 board | Departures board default hub = the viewer's home airport (legacy: ALL) | ledger: "board default hub = home airport (legacy: ALL) — divergence flagged, **Ruling: keep home-airport default** (consistent with Schedule)" |
| §25 donut | Phase-donut hue ramp re-stepped | ledger: "legacy 3 near-identical blues failed the dataviz validator; §25 pins geometry not hues — **Ruling: ACCEPT**" |
| §26 sources | Starlink tracker card's freshness pill **LIVE → DAILY** | inventory §35 flagged the legacy label/class contradiction (`index.html:888`); `views/SourcesView.tsx:12-14` fixes it |
| §32 CSS | The whole z-index ladder, breakpoints, keyframes and Leaflet overrides move from `public/css/style.css` to Tailwind v4 utilities + `src/styles/global.css` | spec §2.4 |
| §33 head | unpkg dns-prefetch/preconnect + SRI `<script>` removed; three woff2 font preloads replaced by bundled `@fontsource-variable/geist{,-mono}` | spec §2.4, §2.5 |
| §33 JSON-LD | `__HOME_LASTMOD__` placeholder retired — `homeJsonLd({lastmod})` takes the git-derived date directly | `src/lib/home-seo.js:220-226` |
| §34 init | `initApp()` + `DOMContentLoaded` bootstrap + `window.*` exports → React provider tree in `Dashboard.tsx` | spec §2.1 |
| Site §1.1 | `/tsa` removed (−1) and `/privacy` added to the sitemap (+1) — still 65 `<loc>` entries | spec §3; inventory "Not in the sitemap: … `/privacy` (a real indexable page with canonical — **oversight**)" |
| Site §1.3–§1.15 | Fourteen documents each re-declaring `@font-face` ×3 + a `:root` token block → one `BaseLayout.astro` owning `<head>`, header, footer and skip link | spec §2.2; inventory §3.1 "two delivery strategies" |
| Site §3.3 | `--ua-dim` drift (`#7C8DA6` vs stale `#64748B`) is moot — the `--ua-*` palette is replaced by shadcn tokens | spec §2.4 |
| Site §4.1 | `build` drops `vite build --config vite.dashboard.config.js`, adds `verify-csp-hashes.mjs`; `dev` is plain `astro dev` | spec §2.1 (`run-astro-dev.mjs` and `vite.dashboard.config.js` "retire") |
| Site §7 | `manifest.json` colours `#0a0e14` → `#0B1018`, matching the pages | inventory §7 flagged the mismatch |

---
## Inventory 1 — Dashboard (`2026-09-11-inventory-dashboard.md`)

### §0 Build / bundling contract

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Vite IIFE bundle, entry `main.js`, out `public/js/dashboard.js`, global `BB`, Leaflet external | 🔁 | spec §2.1 — one Astro build; `astro.config.mjs` + `package.json:15`. `vite.dashboard.config.js` deleted; `git ls-files public/js` empty |
| `VITE_CARTO_BASEMAP_KEY` inlined at build; missing key = watermark | ✅ | `src/app/map/basemap.ts:23` `cartoBasemapUrl(import.meta.env.VITE_CARTO_BASEMAP_KEY)`; `astro.config.mjs:29` `envPrefix: ['PUBLIC_','VITE_']` (without it the key inlines as `undefined` — silent watermark); `tests/basemap.test.js` pins the single construction site |
| Build-time SEO stamping of `dist/index.html`, `llms.txt`, `llms-full.txt`; build fails if missing | 🔁 | `scripts/stamp-seo-build-date.mjs` now stamps **only** the two llms files and still throws on a missing string. `dist/index.html` needs none (Astro imports the JSON). Verified live: `public/llms.txt:91` carries `425+ … mid-2026`, `dist/llms.txt:91` carries the stamped live figures |
| Strings that must survive for stamping: `"425+"` / `"mid-2026"` → `"500+"` / `"August 2026"` | ✅ | `src/data/starlink-live.json` `source.label/asOf` = `425+`/`mid-2026`; both present verbatim in `public/llms.txt` and `public/llms-full.txt`; `dist/` stamped. `tests/agent-readiness.test.js:361` pins "carries no Starlink figure — those are stamped into dist/" |
| CSP: no inline JS anywhere | ✅ | `vercel.json` `script-src 'self' https://va.vercel-scripts.com` + 2 sha256; `bun scripts/verify-csp-hashes.mjs` → "2 inline script(s) all allowed"; `tests/csp.test.js:40-51, 115-120` |

### §1 Global — header / canopy

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Floating top bar, fixed, z 770 | 🔁 | `src/app/shell/Header.tsx:48` — in-flow `<header>` in a `h-[100svh]` flex column (`Dashboard.tsx:117`); no fixed-position ladder to maintain |
| Brand h1 "THE BLUE BOARD" + tagline "FOR UNITED FLYERS, BY UNITED FLYERS"; go-home → Live + scroll top | ✅ | `Header.tsx:47-58` — `THE BLUE BOARD` / `For United flyers, by United flyers` (uppercased by `tracking-widest uppercase`), `href="#live"` |
| `.cdiv` vertical dividers (hidden mobile) | 🔁 | replaced by flex `gap-x-3` spacing; decorative only |
| Live status chip: 3 states keyed to payload age | ✅ | `Header.tsx:44-79` — `none` when `flights.length===0`, else `feed.freshness` |
| LIVE when `feedFreshness(age)==='live'`, age < `FEED_FRESH_MS` 180 000 | ✅ | `src/lib/feed-health.js:65` `FEED_FRESH_MS = 180000`; `state/feed.tsx:186` |
| STALE + `"· N flights (stale)"` when flights exist and age ≥ 180 s | ✅ | `Header.tsx:74-78` — `· {n} flights{state==='stale' ? ' (stale)' : ''}` |
| NO DATA + map error overlay when `allFlights.length === 0` | ✅ | `Header.tsx:73`; overlay `views/LiveView.tsx:216-226` gated on `feed.failed` |
| `X-BB-Feed-Stale` (seconds) backdates `lastGoodFeedTs` | ✅ | `data/api.ts:81` `parseStaleHeader(res.headers.get('X-BB-Feed-Stale'))`; `state/feed.tsx:107` `Date.now() - staleMs`; header exposed in `vercel.json` `/api/(.*)` |
| `#countdown` "Next refresh: Ns", 1 s tick, "Paused (tab hidden)" | ✅ | `Header.tsx:80-85` — exact strings; `state/feed.tsx:183-185` 1 s tick, `countdown===null` while paused |
| `#clock` UTC HH:MM:SS + "Z", 1 s | ✅ | `Header.tsx:22-24, 86-88` — `toISOString().slice(11,19)` + `Z`, `useNow(1000)` |
| `#watch-header-btn` 👁️ + badge, `aria-expanded`/`aria-controls="watch-panel"` | ✅ | `Header.tsx:105-120`; `shell/WatchPanel.tsx:64` `id="watch-panel"` |
| `#mobile-search-toggle` 🔍 toggles mobile search, focuses input | 🔁 | one 🔍 button at every width opening the ⌘K palette — `Header.tsx:90-103` |
| `#home-hub-btn` cycles `['',ORD,DEN,IAH,EWR,SFO,IAD,LAX,NRT,GUM]`, writes `bb_home_airport`, updates display + tracker briefing | ✅ | `Header.tsx:122-137`; `state/prefs.tsx:58-64` → `nextHomeAirport`/`writeHomeAirport` in `src/lib/home-airport.js`; briefing `views/weather/TrackerBriefing.tsx:31-44`. **Runtime-verified:** `bb_home_airport='DEN'` → header shows `🏠 DEN` |
| `#onboarding-help` (`?`) reopens onboarding | ✅ | `Header.tsx:139-147` → `setOnboardingOpen(true)` |
| Home hub drives: map centre/zoom (`[lat,lon]` z5 vs `[39,-98]` z4), default Schedule hub, 🏠 marker + accent border in hub strip | ✅ | map `map/LiveMap.tsx:121-126`; schedule `Dashboard.tsx:174-178` + `state/schedule.tsx:186-196`; strip `shell/HubHealthStrip.tsx:62, 71-78`. **Runtime-verified:** DEN → `🏠●DEN74%` in the strip and `DEN — Denver` preselected on the Schedule board |

### §2 Global — ticker

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `updateTicker()` item priority (6 rules) | ✅ | `src/lib/ticker.js:26-61` — advisory first, then counts, then critical squawks, green line only when every item is `info`, disclaimer always last |
| …1 `deriveOpsHealth({hubOtps, faaIndex, hubCodes: 9 hubs, iropsScore})` → `⚠️ <text>` `advisory` | ✅ | `ticker.js:32-34`; wired `shell/Ticker.tsx:54-60` with `HUB_ORDER` (9) and `irops.score` |
| …2 `"N United flights airborne"` (`info`) | ✅ | `ticker.js:37` verbatim |
| …3 `"Fleet: N mainline aircraft"` + `"N Starlink-equipped aircraft (incl. United Express)"` only when `FLEET_DB.length > 0` | ✅ | `ticker.js:39-42` verbatim, gated on `fleetCount > 0` |
| …4 one `critical` per emergency squawk via `decodeSquawk()` | ✅ | `ticker.js:46-48`; `shell/Ticker.tsx:40-52` filters on `cls === 'squawk-alert'` (7500/7600/7700 only) |
| …5 `"✅ All systems normal — tracking N United flights"` unshifted only if every item is `info` | ✅ | `ticker.js:52-55` — `✅ All systems normal` + ` — tracking ${total} United flights` |
| …6 always-last `disclaimer` "Unofficial — not affiliated with United Airlines · Data: AeroDataBox · FR24 · AWC · FAA" | ✅ | `ticker.js:59` verbatim |
| Ticker DOM = two duplicate `.ticker-cycle` blocks | 🔁 | marquee-only device; one rotating `<p>` — `shell/Ticker.tsx:100-110` |
| `aria-live="off"` deliberate; the one polite announcer is the IROPS announcer | ✅ | `shell/Ticker.tsx:97` `aria-live="off"`; single writer `shell/IropsAnnouncer.tsx:41` |
| Two render modes (marquee / fade rotation); fade is the live mode; 5000 ms, 400 ms swap | 🔁 | fade only, `ROTATE_MS = 5000`, `FADE_MS = 400` — `shell/Ticker.tsx:27-28, 79-89`; header states why the marquee was unreachable |
| Keyframes `tickerScroll`; reduced motion disables | ✅ | `motion-reduce:transition-none` — `shell/Ticker.tsx:102` |

### §3 Global — hub health bar

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Static initial markup (Loading… + `?` tooltip) | 🔁 | nine `Skeleton` chips while loading — `shell/HubHealthStrip.tsx:44-47`; the legacy static/runtime tooltip mismatch (§35) disappears with it |
| `renderHubHealthBar()`: fixed order, OTP severity >70/50–70/<50, `SEV_COLOR`, worse-of blend with `hubProgramMarker`, hub code links `/hubs/<lower>`, home 🏠 + accent border, trailing average chip, empty state | ✅ / ❌ | order `HUB_ORDER` (`src/lib/hub-health.js:12`); severity `hubHealthSeverity` (`:124`); blend `HubHealthStrip.tsx:49-61` (program wins unless OTP is already red); links `:68`; home marker `:62,71-78`; average chip `networkLabel` (`hub-health.js:134`) → `Smooth Ops` / `Some Delays` / `Rough Day` verbatim. **Empty state** is nine skeletons, not the literal `"Load schedule data for hub health"` — see note below |
| `updateHubHealth()` client OTP: direction-aware, excludes `status.inferred` / `liveFeedFallback` / `scheduleTimeDerivedFromActual`, on-time = `realT <= schedT + 1800`, writes only when `operated >= 25` and the hub is not server-owned | ✅ | `src/lib/hub-health.js:46-107` (`computeBoardOtp` + `mergeHubHealth`), consumed `state/schedule.tsx:667-706` |
| Server path writes `hubHealthData[hub]` from `hubMetrics`: `operated<5 && cancelRate>=0.5 → 0`; `operated>=5 → round(onTime/operated*100)` | ✅ | `src/lib/hub-health.js:109-122` `serverOtpFromMetrics`; `state/schedule.tsx:671-676` |
| `.hh-info` `?` tooltip keyboard-reachable, hidden below 600 px | 🔁 | per-hub Radix `Tooltip` on every chip (`HubHealthStrip.tsx:65-101`) instead of one `?`; keyboard-reachable by construction |
| Mobile: own fixed row at `top:66px`, horizontally scrollable with mask | 🔁 | in-flow `overflow-x-auto` strip — `HubHealthStrip.tsx:38` |

> **Note on the hub-health empty state.** The literal string `"Load schedule data for hub health"` is
> not in the rebuild. It is not carried as a gap: the legacy bar rendered that sentence because it
> had no loading state at all, whereas the rebuild shows nine skeleton chips until either
> `/api/irops` or a board answers, and then renders `—` for any hub still without a reading
> (`HubHealthStrip.tsx:87`). The information — "no reading yet" — is present and better placed. The
> tooltip says so in words: `"No on-time reading yet"` (`:95`).

### §4 Global — global search

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Input + results + inline error (role=alert) | 🔁 | ⌘K `CommandDialog` — `features/SearchPalette.tsx:146-242`. Failures route through the one polite announcer (§17), not a second live region |
| Static placeholder not rotated | ✅ | `SearchPalette.tsx:155` `"UA1234, N12345, or ORD-DEN…"` — fixed. **Runtime-verified** |
| Debounced 150 ms; min 2 chars; `" TO "` → space; `qNorm` strips `[\s\-→>]`; live match on callsign/flightIATA/reg/origin+dest and reversed; schedule match over loaded boards; kicks `preloadScheduleData()` and re-renders late (F043) | ✅ | debounce `:55-58`; `normalizeQuery` + `matchLiveFlights` + `matchScheduleFlights` in `src/lib/global-search.js`; min 2 `:67`; board search `:76-100`; F043 preload `:107-112` (TTL-guarded, so it cannot stampede) |
| `renderGlobalSearchResults()` max 20; live rows focus flight; schedule rows goto with hub/dir/flight | ✅ | `MAX_RESULTS = 20` `:37`; live group `:161-185`; board group `:187-203` → `goto({hub, dir:'departures', day, flight})` |
| FR24 lookup affordance when `/^(UA[L]?\s*\d{1,4}\|\d{1,4})$/i` | ✅ | `FR24_LOOKUP_RE` from `src/lib/global-search.js`; row `:213-225`, gated on `FR24_LOOKUP_AVAILABLE` (now `true` — `features/Fr24LookupDialog.tsx:56`) |
| Contextual empty states (flight-number / tail / generic) | ✅ | `classifyEmptyState()` + `:132-144`. **Runtime-verified:** cold palette shows `"Type a flight number, tail number, or route."` |
| Outside-click closes | ✅ | Radix `Dialog` default |
| Keyboard bridge (F083): ArrowDown/Up, Escape clears + hides | ✅ | cmdk's own roving focus + Escape; the hand-rolled bridge is unnecessary |
| `goto-schedule-result`: switch tab, set hub/dir, load, `scrollIntoView({block:'center'})` + 2000 ms highlight | ✅ | `state/schedule.tsx:575-591` `goto()`; scroll + flash `views/schedule/ScheduleTable.tsx` `revealFlight` handle, consumed `views/ScheduleView.tsx:192-197` |
| Mobile: `position:fixed; top:108px`, hidden until open | 🔁 | modal dialog at every width |

### §5 Global — sidebar search (Live tab)

| item (abbreviated) | verdict | evidence |
|---|---|---|
| 150 ms, min 2 chars, cap 50 with header `"N flights found (showing 50)"` | ✅ | `views/live/LiveSidebar.tsx:31` `MAX_SEARCH_ROWS = 50`, debounce `:65-68`, min 2 `:74`, header `:117-122` — `N flight(s) found` + ` (showing 50)` |
| Hub-code query adds "🏢 Filter map to XXX (N flights)" | ✅ | `LiveSidebar.tsx:92-107` — `🏢 Filter map to {hub}` + count |
| Empty state links to Schedule | ✅ | `LiveSidebar.tsx:108-114` — `Check the Schedule tab →` |

### §6 Global — watch panel + push

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `#watch-panel` (z 9999): header + Clear All + list | ✅ | `shell/WatchPanel.tsx:62-136` — `Sheet` with `id="watch-panel"`, `Clear all` `:117-127` |
| `MAX_WATCHED = 20`; key `bb_watched_flights` `[{flight, route, status, ts}]`; legacy `watchedFlights` read | ✅ / ❌ | `src/lib/watch-utils.js:14` `MAX_WATCHED = 20`; slice at `:31`; key `state/storage.ts:16`. **Runtime-verified shape:** `[{"flight":"UA28","route":"SIN→SFO","status":"Cruise","ts":1789437969813}]`. Legacy `watchedFlights` fallback read is **absent** → gap **G1** (cosmetic: that alias had no writer in the legacy tree and only widened the METAR station list — see the gap list) |
| `toggleWatchFlight()` add/remove → save → re-render table/panel/markers/MyFlights → sync buttons → toast → `syncPushSubscription()` | ✅ | `state/watch.tsx:173-192` — one store update drives every consumer by subscription; `void syncSubscription(next)` `:188` |
| `syncWatchButtons()` re-renders every toggle | ✅ | not needed — `watch.isWatched()` is read during render everywhere (`FlightSheet.tsx:246`, `ScheduleTable`, `AircraftDetailDialog.tsx:130`) |
| `#watch-badge` count, hidden at 0 | ✅ | `shell/Header.tsx:115-119` — rendered only when `watched.length > 0` |
| Outside-click closes panel | ✅ | Radix `Sheet` default |
| `showWatchNotification(msg)`, auto-hide 10 000 ms | ✅ | `shell/WatchBanner.tsx:22` `AUTO_HIDE_MS = 10000`; mounted in the shell (`Dashboard.tsx:130`) so it reaches the viewer on any tab |
| Push prompt 500 ms after FIRST watch add when `!bb_push_prompted` and permission `default`; auto-hide 15 000 ms | ✅ | `shell/WatchPanel.tsx:27-28` `PROMPT_DELAY_MS = 500`, `PROMPT_VISIBLE_MS = 15000`; gate `:38-48` on `justAddedFirst && !prompted && permission==='default'` |
| `enable-push` → `Notification.requestPermission()`; grant → toast + sync; both actions set `bb_push_prompted='1'` | ✅ | `state/watch.tsx:237-246` (`markPrompted()` **before** the browser prompt, so a dismissed native dialog still counts); `WatchPanel.tsx:50-58` |
| `bbPushBootstrap()` `GET /api/push-subscribe` → `{configured, vapidPublicKey}`; failure → `{configured:false}` | ✅ | `data/api.ts:228-234` — never rejects; `state/watch.tsx:120-124` |
| `syncPushSubscription()` requires SW + PushManager + Notification + configured + granted; empty list → unsubscribe; else subscribe with `urlBase64ToUint8Array`; never throws | ✅ | `state/watch.tsx:137-171` — exact guard order, `{action:'unsubscribe', subscription:{endpoint}}` and `{subscription:{endpoint,keys}, watches:[{flight}]}` bodies byte-exact; `vapidKeyToBytes` `:92-99` |
| `renderWatchAlertsFootnote()` 4 copy tiers | ✅ | `src/lib/watch-utils.js:71-…` `watchAlertsFootnote(push)`; the 4th tier needs `bootstrapped` (`state/watch.tsx:24-32`) so a cold panel never claims push is unavailable before asking |
| `checkWatchedFlightChanges()` after every schedule load: skips inferred + `unknown`, `isSignificantStatusChange()` gate, hidden → native `Notification` (icon/tag/data + onclick focus), else banner, "landed" → BMAC toast | ✅ | `state/schedule.tsx:295-362` — `status.inferred` skip `:316`, `unknown` skip `:317`, gate `:320`, `document.hidden` branch `:324-344` with `tag: bb-watch-${ident}` / `icon:'/icons/icon-192.png'` / `data:{flight}` and `onclick` → focus + select, banner+announce `:345-348`, `showBmacToast(ident)` on `landed` `:354` |

### §7 Global — news banner

| item (abbreviated) | verdict | evidence |
|---|---|---|
| DOM precedes `#tip-strip` | ✅ | `Dashboard.tsx:119-130` — `NewsBanner` then `TipStrip` (flow order, no sibling selectors to maintain) |
| `public/js/news-banner.js` defer; `GET /data/news-latest.json`; `requestIdleCallback({timeout:4000})` or `setTimeout 1500` | ✅ | `features/NewsBanner.tsx:24-26` `IDLE_TIMEOUT_MS = 4000`, `FALLBACK_DELAY_MS = 1500`; fetch `data/api.ts:303`; endpoint `src/pages/data/news-latest.json.ts` |
| Dismissal `localStorage.news_dismissed_slug` vs `d[0].slug` | ✅ | `NewsBanner.tsx:50, 85-88`; key `state/storage.ts:25` `news_dismissed_slug` |
| Rotates every 6000 ms when >1, 400 ms crossfade, pause on mouseenter | ✅ | `ROTATE_MS = 6000` `:24`, `items.length < 2` guard `:77`, pause `:99-104`. Crossfade is a CSS `transition-opacity` rather than a 400 ms timer |
| Click fires `window.va.track('news_banner_click', {slug})` in try/catch | ✅ | `NewsBanner.tsx:29-36` verbatim event name, try/catch |
| Links → `/news/<slug>` | ✅ | `NewsBanner.tsx:93` |

### §8 Global — tip strip

| item (abbreviated) | verdict | evidence |
|---|---|---|
| DOM + logic | ✅ | `features/TipStrip.tsx` |
| `TIPS` keyed by tab: live 3, schedule 2, myflight 2, weather 1, fleet 1; fallback live | ✅ | `src/lib/tips.js` `pickTip('tab-'+tab)`; `TipStrip.tsx:53` |
| Random pick, 300 ms fade, rotation 45 000 ms, starts 2000 ms after load, re-shows 100 ms after a tab click | ✅ | `TIP_ROTATE_MS` from `src/lib/tips.js`; `START_DELAY_MS = 2000` `:28`, `TAB_SWITCH_DELAY_MS = 100` `:30`, re-pick on `tab` change `:52-71` |
| Dismiss → `bb_tips_dismissed = Date.now()`, 7 days | ✅ | `TipStrip.tsx:32` `DISMISS_TTL_MS = TIP_DISMISS_DAYS * 86400000`, write `:73-76`; key `state/storage.ts:18` |
| Fixed capsule `top:80px`, max-width 600; mobile `top:102px` | 🔁 | in flow — `TipStrip.tsx:81`; the file header records why (every sibling offset in `style.css:913-918` had to be recomputed when it showed/hid) |

### §9 Global — offline banner

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `aria-live="assertive" role="alert"`; toggled by `online`/`offline` events only, never proactively on load | ✅ | `shell/OfflineBanner.tsx:28-30` (`role="alert" aria-live="assertive"`); `:15-24` binds only the two events, initial state `false` — the header states why `navigator.onLine` is not consulted |

### §10 Global — onboarding overlay

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `role="dialog" aria-modal` + card | ✅ | `features/Onboarding.tsx:123-129` — Radix `Dialog` |
| Six feature rows (Live Map / AI Delay Prediction / Schedules / Weather & Hub Status / Fleet & WiFi / Stats) | ✅ | `Onboarding.tsx:39-70` — all six, copy verbatim. **Runtime-verified in screenshot** |
| Home-hub select (No preference + 9 hubs) saved via `setHomeAirport()` on dismiss | ✅ | `Onboarding.tsx:73-83` (9 hubs) + `:155-167`; saved `:113` only when a hub was actually picked (`main.js:7932` `if (hubSel.value)`). **Runtime-verified:** `bb_home_airport='DEN'` pre-selects `DEN — Denver` |
| Footer "Built by a United flyer, for United flyers. Not affiliated with United Airlines." + "Let's Fly the Friendly Skies ✈️" | ✅ | `Onboarding.tsx:170-176` — both verbatim (`Let&rsquo;s`). **Runtime-verified** |
| Show/hide rules: first visit sets `bb-visited='1'`, hide if `bb_onboarding_dismissed` within 7 days; return visit hide if `bb-onboarded` or dismissed within 7 days | ✅ | `src/lib/engagement.js` `shouldShowOnboarding(storage)`; ordering enforced in `state/engagement.tsx:89-102` (threshold read **before** `bb-visited` is written — `main.js:7070-7074`) |
| Dismiss: save hub, `bb-onboarded='1'` + `bb_onboarding_dismissed=Date.now()`, restore focus | ✅ | `Onboarding.tsx:112-120`; focus restore from Radix. **Runtime-verified:** after dismiss, `bb-onboarded="1"`, `bb_onboarding_dismissed` set, `bb-visited="1"` |
| Reopen: store activeElement, fade in, arm trap, focus first focusable | ✅ | Radix `Dialog` (`Onboarding.tsx:14` records that it replaces the hand-rolled AbortController trap) |
| Focus trap (F079): Escape dismisses, Tab wrap | ✅ | Radix; `onOpenChange` routes Escape through the same `dismiss()` `:125-127` |
| Backdrop click dismisses; `?aircraft=` suppressed while visible | ✅ | same `onOpenChange`; suppression `features/AircraftDetailDialog.tsx:80` `!onboardingOpen` |

### §11 Global — waitlist / engagement modal

| item (abbreviated) | verdict | evidence |
|---|---|---|
| "✈ Stay in the loop", sub copy, email input, optional 3-row feature textarea, error line, "Stay in the Loop", "✓ No spam, just launch updates" | ✅ | `features/WaitlistDialog.tsx:158-218` — all six, strings verbatim, `rows={3}` `:201` |
| Validation `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; submit disables + "Submitting…" | ✅ | `WaitlistDialog.tsx:45` regex byte-exact; `:214-216` |
| `POST /api/waitlist {email, source:'popup', featureRequest?}`; success or `error==='duplicate'` → success card + `bb_waitlist_submitted='true'` | ✅ | `data/api.ts:253-259`; `WaitlistDialog.tsx:117-130` — duplicate treated as success, `'true'` string |
| Escape scoped; backdrop closes; close writes `bb_waitlist_dismissed` (7 days) | ✅ | Radix; every close path funnels through `close()` `:102-106` |
| Triggers: T1 5 min; T2 20 (new) / 30 (returning); T3 landing → BMAC card; T4 `?waitlist=1` | ✅ / 🔁 | T1 `TRIGGER_TIME_MS` `:84`; T2 `clicksReachedThreshold` `:92` with `triggerClicks` 20/30 from `waitlistState()`; T4 `state/deep-links.ts:108`. **T3 is now the BMAC toast, not this modal** — see Intentional changes |
| Suppression: submitted, shown this session, dismissed within 7 days, onboarding visible | ✅ | `shouldShowWaitlist(storage, {shownThisSession, submitted, onboardingVisible})` `:72-77`; submitted outranks even T4 `:147` |

### §12 Global — BMAC landing toast

| item (abbreviated) | verdict | evidence |
|---|---|---|
| No-op if already showing or `bb-bmac-dismissed` within 14 days; else 3000 ms delay | ✅ | `state/ui.tsx:89` `BMAC_DELAY_MS = 3000`, guards `:163-164` (`bmacEligible()` owns the 14-day cooldown, `src/lib/engagement.js`) |
| `role="status"`, close writes `bb-bmac-dismissed`, copy "Glad you landed ✈️ — if The Blue Board helped today, you can support the server costs.", link `buymeacoffee.com/notjbg` | ✅ | `features/BmacToast.tsx:36` `role="status"`, `:29-32` write, `:48-50` copy verbatim, `:23` `BMAC_URL = 'https://buymeacoffee.com/notjbg'`. Positioned bottom-left — 🔁 per ACCEPT ruling |

### §13 Global — disclaimer modal + legal popover + support meter + attribution

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `#disclaimer-modal`: affiliation disclaimer, sources list (AeroDataBox / FR24 / CARTO+OSM ODbL / AWC NOAA / FAA NAS / fleet records), **"Do not use this dashboard for operational or safety-critical decisions"**, open-source + X links, support/BMAC/membership/issue links, **Supporters Wall (17 named chips)**, "Got it" | ✅ | `features/DisclaimerDialog.tsx` — sources `:48-87` (all six), safety sentence `:140-142` verbatim in `text-red-400`, links `:147-159`, **17 supporters** `:28-46` transcribed from `legacy/index.html:980-996`, `Got it` `:182-184` |
| Open/close via show/hide + backdrop | ✅ | `state/ui.tsx` `disclaimerOpen`; opened from the ⓘ menu's About and Disclaimer (`features/LegalPopover.tsx:76-81`) |
| `#legal-details` `<details>` popover: title, support-meter mount, link grid (About, Disclaimer, Privacy, Fleet Database, Support/Feedback, ☕ Donate, @theblueboard), hub nav (9 + All Hubs + News + Trackers), data-source note | ✅ | `features/LegalPopover.tsx:45-124` — all 7 links `:75-93`, hub nav `:95-110` (9 + All Hubs + News + Trackers), data note `:112-120`. Radix `Popover` rather than `<details>` (the §35 "claims JS handlers" contradiction disappears) |
| `support-meter.js`: lazy `GET /api/support-stats` on first open; ≤2 bars; `.sm-bar-fill-warn` ≥85 %; failure renders nothing | ✅ | `features/SupportMeter.tsx:27-35` (fetch only when `active`, once), model from `src/lib/support-meter.js`, warn tone `:47-54`, `if (!model) return null` `:37` |
| `#attribution` fixed bottom-left `role="contentinfo"`, z 710, hidden mobile | 🔁 | `shell/Attribution.tsx:19-21` — in-flow `role="contentinfo"`, `hidden … md:flex` (same visibility rule as the legacy `#legal-details`) |
| Leaflet attribution control ON (ODbL), prefix cleared, credit from tile options — pinned by `tests/compliance.test.js` | ✅ | `map/LiveMap.tsx:133` `setPrefix('')` (control never disabled); `map/RadarMap.tsx:87` same; credit `map/basemap.ts:29-31, 46`; `tests/compliance.test.js` retargeted to `src/app`/`src/lib` |

### §14 Global — mobile nav / controls

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `#mobile-bottom-nav` `role="tablist"`: Live / Weather / Schedule / My Flights + overflow Starlink / Fleet / Stats / Sources + More | ✅ | `shell/MobileNav.tsx:25-27` — primary/overflow derived from `tabs.ts` `mobilePrimary` (My Flights, Live, Schedule, Weather primary; Fleet, Starlink, Stats, Sources behind More) |
| `#mobile-more-menu` (z 781) | 🔁 | `Sheet side="bottom"` — `MobileNav.tsx:52-89` |
| `switchToTab` monkey-patched to sync the bottom nav from the More menu | ✅ | unnecessary — one `tab` value drives both (`MobileNav.tsx:39, 56`); the header notes the legacy desync bug this removes |
| `#mobile-ctrl-toggle` toggles `.ctrl-menu-open`; outside click closes | 🔁 | map controls are one scrollable row at every width — `views/LiveView.tsx:180-190` |
| `#mobile-sidebar-toggle` toggles sidebar, label `🔍 Filters ▾/▴`, `invalidateSize()` after 300 ms | 🔁 | `views/LiveView.tsx:191-200` `🔍 Filters` opens a bottom `Sheet`; resize handled by a `ResizeObserver` (`map/LiveMap.tsx:142`) rather than a timer |
| `#sidebar-filters-toggle` / `#sidebar-extra-filters` collapsible | 🔁 | dropped — see Intentional changes |
| Mobile hides: tab bar, legal, stats bar, attribution, map legend, header clock/countdown/home-hub | ✅ | tab bar `Dashboard.tsx:138` `hidden lg:block`; legal + attribution `Attribution.tsx:21` `hidden … md:flex`; stats bar `views/live/StatsBar.tsx:27` `hidden … min-[1081px]:flex`; legend `LiveView.tsx:204` `hidden … md:block`; clock/countdown `Header.tsx:81,86` `hidden … lg:inline`; home hub `:127` `hidden … md:inline-flex` |
| Sibling offsets when news banner/tip strip visible (96→138→176 / 102→144→182 px) | 🔁 | every banner is in flow, so the stack reflows itself; no offset table to keep |

### §15 Global — PWA / service worker

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Registration | ✅ | `src/scripts/sw-register.ts`, loaded `src/pages/index.astro:59` as a bundled `_astro/` module (no inline script) |
| `CACHE_VERSION='v10'`; caches pages(20)/data(80)/static(120); precache `['/', '/index.html']`; skipWaiting; claim + prune | 🔁 | `public/sw.js:1-18` — **v11**, same three caches and limits (20/80/120), precache `['/']` only (`format:'file'` makes `/index.html` a second URL for the same document and one non-2xx would fail `addAll`); skipWaiting `:44`, claim + prune `:48-58` |
| Fetch: navigation network-first `cache:'reload'` → cached → `/index.html` → 503; `/api/*`+`/data/*` network-first `no-store` → cached → 503 JSON; `/js/*`+`/css/style.css` network-first `no-cache`; else SWR | 🔁 | navigation `:75-101` (falls back to `/`, the precached shell); data `:103-127`; **`/js/*` + `/css/style.css` branch replaced by cache-first `/_astro/*`** `:137-165` — hashed URLs are immutable by construction; SWR tail `:167-190` |
| `push` `{title, body, tag, url}`, icon/badge `/icons/icon-192.png`; `notificationclick` `data.url \|\| '/?flight=<flight>' \|\| '/'` | ✅ | `public/sw.js:195-217` and `:223-245` — byte-exact payload handling and fallback chain, focuses an existing client |
| `manifest.json`: id `/`, standalone, `#0a0e14`, 4 icons, categories travel/transportation | ✅ / 🔁 | `public/manifest.json` — id `/`, `standalone`, **4 icons** (192/512 × any/maskable), `["travel","transportation"]`. Colours are `#0B1018` (🔁, fixes the documented page mismatch) |
| iOS/Android meta | ✅ | `components/site/Seo.astro:60-68` — `mobile-web-app-capable`, `apple-mobile-web-app-capable`, `-status-bar-style`, `-title`, `application-name`, manifest, apple-touch-icon |

### §16 Global — deep links, query params, hash

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `TAB_HASHES` `#myflight #live #schedule #fleet #starlink #weather #stats #sources` (`tab-analytics → #stats`) | ✅ | `src/app/tabs.ts:41-122` — all eight; `resolveTabParam` maps `analytics → stats` `:139` |
| On load hash applied visually only | ✅ | `state/ui.tsx:99-105` `initialTab()` reads the hash without writing history |
| `switchToTab(tabId, updateHash)` `history.replaceState` unless false | ✅ | `state/ui.tsx:126-137` — `replaceState`, never `pushState`; `{hash:false}` honoured |
| `?tab=` (`myflight\|live\|schedule\|fleet\|starlink\|weather\|irops\|stats\|sources`; `irops` → weather + scroll `#irops-section`) | ✅ | `tabs.ts:135-141` + `state/deep-links.ts:84-92`. **Runtime-verified:** `/?tab=irops` → hash `#weather`, `#irops-section` mounted and in view, bar reading `SIGNIFICANT DISRUPTION 95 / 712 / 258 / 0 / 2838` |
| `?type=` / `?filter=` → fleet deep-link filter | ✅ | `state/deep-links.ts:53-61` `readFleetDeepLinks()`; applied `views/FleetView.tsx:229-253` with `resolveFleetDeepLinkFilter` (an unmatched value is ignored rather than filtering the table to nothing) |
| `?view=starlink\|airborne\|special` (starlink → tab; others poll 200 ms ≤10 s for `FLEET_DB`) | ✅ | starlink `deep-links.ts:103`; airborne/special `FleetView.tsx:252` latched on the first non-empty `fleetDb` with the same **10 s** budget (`DEEP_LINK_TIMEOUT_MS`, `:67`) |
| `?hub=XXX` with `tab=schedule` | 🔁 | `deep-links.ts:94-98` selects the board hub directly (ledger: accepted as better). **Runtime-verified:** `/?tab=schedule&hub=ord` → ORD board, 660 rows |
| `?flight=` or `?q=` → match `flightIATA`/`callsign`/`UA+q`/`UAL+q` → focus else `lookupFR24Flight()`; latched only when the feed is non-empty (F033) | ✅ | `deep-links.ts:124-148` — latch on `flights.length === 0` `:125`, ident normalisation `:64-68`, match `:134-143`, FR24 fallback `:146`. **Runtime-verified:** `/?flight=UA1` (not airborne) → FR24 lookup dialog, SFO → SIN, B789 · N61106 |
| `?aircraft=REG` → `showAircraftDetail()` after fleet load | ✅ | `deep-links.ts:105-106`; dialog waits for the database and distinguishes loading from not-in-DB (`AircraftDetailDialog.tsx:151-179`) |
| `?waitlist=1` | ✅ | `deep-links.ts:108` |
| Popup open sets `?flight=<id>` via replaceState; close removes | ✅ | `features/FlightSheet.tsx:46-53, 170-179` — only ever clears on a **real** close, so a cold `?flight=` deep link is not wiped before the feed answers |
| Share: `share-flight` sets `?flight=` + clears hash; `share-aircraft` sets `?aircraft=`; clipboard with execCommand fallback + `window.prompt` | ✅ | `FlightSheet.tsx:221-228` (`url.hash = ''`), `AircraftDetailDialog.tsx:87-96`; three-tier fallback `data/share.ts:18-43`, caller told which tier fired |
| SearchAction JSON-LD `https://theblueboard.co/?flight={flight_number}` | ✅ | `src/lib/home-seo.js:505-512`; present in `dist/index.html` (WebSite block) |

### §17 Global — keyboard & a11y

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Skip link → main content | ✅ | `components/site/BaseLayout.astro:77-82` → `#main`; z-100 |
| Tab-bar roving tabindex: arrows wrap, Home/End, `aria-selected` | ✅ | Radix `Tabs` (`shell/TabBar.tsx:16-26`) |
| Enter/Space activation for `[data-action][role="button"]` | ✅ | every action is a real `<button>`/`<a>`; no `data-action` delegation remains |
| Escape closes schedule drawer (focus → toggle), onboarding, waitlist, delay-explain, aircraft-detail | ✅ | drawer `views/schedule/ScheduleControls.tsx` (`Sheet`, focus returned by Radix); the other four are Radix `Dialog`s |
| Sortable `<th>` `tabindex="0"` + Enter/Space + `aria-sort` — fleet, airborne, Starlink, schedule | ✅ | `views/fleet/SortableHeader.tsx:29-43` — `aria-sort` on the `<th>`, a real `<button>` inside; reused by `FleetTable`, `AirborneTable`, `RosterTable`; schedule `views/schedule/ScheduleTable.tsx`. **Runtime-verified:** `Time↑ Flight↕ Route↕ Aircraft↕ Reg↕ … Status↕` |
| Markers `role="img"` + `aria-label` "UA123 ORD to DEN, cruising" | ✅ | `map/LiveMap.tsx:83-86, 234-238` — `${ident} ${origin} to ${dest}, ${phase.toLowerCase()}` written per marker (the icon object is cache-shared, so the label goes on the element) |
| `aria-live` inventory (offline assertive/alert; watch polite/status; news status; hub-health polite; ticker off; IROPS announcer sr-only status polite single writer; search error alert; stats bar status polite; `#sl-verify-alert` alert; `#irops-content` polite; `#tracker-briefing-watch` polite) | ✅ | offline `OfflineBanner.tsx:29-30`; news `NewsBanner.tsx:97`; hub health `HubHealthStrip.tsx:36`; ticker `Ticker.tsx:97` off; announcer `IropsAnnouncer.tsx:41` `role="status" aria-live="polite"` sr-only, single writer via `useUi().announce()`; stats bar `StatsBar.tsx:28-29`; `#irops-content` `IropsSection.tsx:139`; `#tracker-briefing-watch` `TrackerBriefing.tsx:67-69`. Watch + search now route through the one announcer instead of their own regions |
| `<nav aria-label="Dashboard navigation">` wraps the tab bar | ✅ | `shell/TabBar.tsx:15`; also `MobileNav.tsx:31` |
| Scrollable table wrappers `tabindex="0"` + `aria-label "… scrollable region"` | ✅ | `FleetTable.tsx:74-77`, `AirborneTable.tsx:53-56`, `SpecialPanel.tsx:53-56`, `stats/HubMatrix.tsx:25`, `ScheduleTable.tsx` |
| `.sr-only`; `:focus-visible{outline:2px solid …}` | ✅ | Tailwind `sr-only`; `focus-visible:outline-2 focus-visible:outline-ring` throughout |
| `JARGON_TERMS` = irops, otp, metar, gdp, groundstop, equipment, tail | ✅ | `features/JargonTerm.tsx:23-31` — all seven, wording verbatim from `main.js:41-49` |
| `jargonTerm()` → `.jargon-term[tabindex=0][aria-describedby]` + `.jargon-tooltip[role=tooltip]`, ids `jgt-tip-N`, first-occurrence-per-panel gating | 🔁 / ✅ | Radix `Tooltip` on a real `<button>` (`JargonTerm.tsx:43-55`) supplies the role and the description wiring; the **first-occurrence gate is preserved** as a pure fold — `assignJargonFirsts()` in `src/lib/weather-cards.js`, consumed `views/WeatherView.tsx:47` |
| Pure CSS show/hide; delegated handler clamps in viewport | 🔁 | Radix collision handling + `max-w-[min(280px,70vw)]` (`JargonTerm.tsx:52`) |
| Call sites: weather cards (metar/gdp/groundstop), schedule OTP, IROPS, aircraft modal (tail, equipment) | ✅ | weather `views/weather/HubCard.tsx:67, 178`; IROPS `views/weather/IropsSection.tsx:150`; aircraft `features/AircraftDetailDialog.tsx:150, 159` |

### §18 Tab — Live Ops

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `#map` `role="application"`, fixed inset-0 z-0 page background + vignette | 🔁 | `map/LiveMap.tsx:335-340` keeps `role="application"` + an accessible name; the map is a flex pane inside the tab (`views/LiveView.tsx:155-161`) wrapped in `isolate z-0` so Leaflet's z-400 panes cannot paint over a Sheet/Dialog |
| `initMap()`: `zoomControl:false`, `worldCopyJump:true`, zoom control bottomright, CARTO dark | ✅ | `map/LiveMap.tsx:124-135` — all four verbatim |
| `getBasemapTileOptions()`: maxZoom 18, tileSize 256, subdomains `'ab'` ≤768 else `'abcd'`, retina desktop hi-DPI only, ODbL attribution | ✅ | `map/basemap.ts:38-47` — every value matches |
| Hub markers `drawHubs()`: circleMarker r=8 `#005DAA` fill .3 + permanent `hub-tooltip` + pulse circle | ✅ | `map/LiveMap.tsx:163-185` — r 8, `#005DAA`, `fillOpacity: 0.3`, `className:'hub-tooltip'` permanent, second `hub-pulse` circle |
| Great-circle route on popup open: 60-point, `normalizeLonContinuity()`, traveled solid (w 2.5, .8), remaining dashed `6,4` (w 1.5, .4), origin dot filled, dest dot white, `IATA — City` tooltips | ✅ | `map/LiveMap.tsx:262-311` — `greatCirclePoints(...,60)` ×2, `normalizeLonContinuity`, weights/opacities/dashArray byte-exact, origin `fillColor:'#005DAA'`, dest `fillColor:'#fff'`, label `iata — IATA_CITIES[iata]` |
| Longitude normalization per marker relative to map centre | ✅ | `map/LiveMap.tsx:199-203` |
| `btn-hubs` `toggleHubs()` aria-pressed | ✅ | `views/live/MapControls.tsx:54-56` — `ToggleGroupItem value="hubs"` (Radix supplies `aria-pressed`) |
| `btn-longhaul` — GC distance > 2500 nm via `AIRPORT_COORDS`, fallback flight number < 100 | ✅ | `isLonghaul(origin, dest, callsign, AIRPORT_COORDS)` in `src/lib/geo.js`, called `map/LiveMap.tsx:209-211` |
| `btn-starlink` — disabled + `title="Starlink data unavailable"` when no tails; force-resets filter; hides legend | ✅ | `MapControls.tsx:60-76` disabled on `!starlinkAvailable` with a tooltip ("Starlink data unavailable right now"); force-reset `views/LiveView.tsx:68` (`starlinkOnly = starlinkFilter && starlinkAvailable`); legend gated `:203` |
| `btn-wx` — NEXRAD Iowa Mesonet tile URL, opacity .5 | ✅ | `map/basemap.ts:26-27` URL byte-exact, `:57` `opacity: 0.5` |
| `btn-pacific` — flyTo `US_VIEW {[39,-98],4}` ↔ `PACIFIC_VIEW {[25,145],4}` 1.2 s | ✅ | `map/LiveMap.tsx:32-33` both views exact; `:330-331` `flyTo(..., {duration: 1.2})` |
| `btn-refresh` — "⏳ Loading..." while in flight | ✅ | `MapControls.tsx:91` `⏳ Loading…` / `↻ Refresh`, `disabled={refreshing}` |
| `#map-legend` Starlink violet dot, hidden until data; hidden mobile | ✅ | `views/LiveView.tsx:203-212` — `#A78BFA` dot + `Starlink-equipped`, gated on `starlinkAvailable`, `hidden … md:block` |
| `GET /api/fr24-feed?airline=UAL` every 30 s | ✅ | `data/api.ts:76`; `state/feed.tsx:39` `FEED_POLL_MS = 30000` |
| visibilitychange: hidden → clear + "Paused"; visible → immediate refresh | ✅ | `state/feed.tsx:162-175` |
| `isRefreshing` gate | ✅ | `state/feed.tsx:102` `inFlightRef` |
| `parseFr24Feed` + `applyFeedResult`; **200 with zero aircraft = failure** | ✅ | `data/api.ts:83` throws on an empty payload; `state/feed.tsx:120-125` keeps the previous flights |
| Retry ladder `[5000,10000,20000,30000]`, countdown matches, skipped while hidden | ✅ | `src/lib/feed-health.js:94` exact array; `state/feed.tsx:121-126, 132-141` (schedule() returns early when `document.hidden`) |
| `showMapErrorOverlay()` fixed inset-0, "Live flight feed unavailable / Retrying automatically…" + retry | ✅ | `views/LiveView.tsx:216-226` — both strings verbatim, countdown interpolated, `Retry now` button; shown only when the feed has **never** produced flights (`failed`) |
| Post-refresh fan-out (markers, stats, hub stats, ticker, MyFlights, fleet panel, Starlink, analytics) | ✅ | one state update; every consumer re-derives by subscription — `Ticker.tsx:39-70`, `LiveView.tsx:87-104`, `FleetView.tsx:109-124`, `StarlinkView.tsx:164-168`, `StatsView.tsx:74-115` |
| `recordRegSightings(allFlights)` every poll | ✅ | `state/feed.tsx:114-117` — `recordSightings` + `pruneLedger` + persist to `bb_reg_ledger_v1` |
| `createPlaneIcon(hdg,…)`: heading rounded 5°, cache key; fill priority watched `#22c55e` → Starlink `#A78BFA` → long-haul `#fbbf24` → phase (Ground `#64748B` else `#6BAAED`); size 16/14/10; drop-shadow; inline SVG rotated | ✅ | `src/lib/plane-icon.js` `planeIconSpec()` owns rounding, priority, sizes and SVG; `map/LiveMap.tsx:60-80` caches on its `key` and rotates by `hdgRounded` |
| Watched `zIndexOffset: 1000` | ✅ | `map/LiveMap.tsx:213` (selected gets 900, unwatched 0) |
| `getFilteredFlights()` hub filter (origin/dest or onGround within 93), phase-group, Starlink-only | ✅ | `src/lib/live-filters.js:26` `HUB_PROXIMITY_NM = 93`, `:55` `haversineNm(...) < HUB_PROXIMITY_NM`. **Legacy returns nautical miles** (`06b77a7:main.js:914` `R = 3440.065`), so 93 NM is byte-for-byte faithful; the inventory's "93 km" and the legacy `// ~50nm` comment are both wrong |
| `getPhaseGroup()` Takeoff+Climb → Climb, Cruise+En Route → Cruise | ✅ | `src/lib/flight-phase.js`; five rows rendered `views/live/LiveSidebar.tsx:22-28` |
| `getPhase(alt, vr, spd)` thresholds (Ground <100 ft & <50 kt; Takeoff <5000 & vr>500; Approach <5000 & vr<-300; Climb vr>300; Descent vr<-300; Cruise >25000; else En Route) | ✅ | `src/lib/flight-phase.js` `getPhase()` — extracted verbatim, unit conversions included; consumed `LiveMap.tsx:205`, `FlightSheet.tsx:230-232` |
| `decodeSquawk()` 7500/7600/7700 (`squawk-alert`), 1200 VFR | ✅ | `src/lib/flight-phase.js` `decodeSquawk()` → `{text, cls}`; only `squawk-alert` gets the red banner (`FlightSheet.tsx:293-297`) and a ticker item (`Ticker.tsx:43`) |
| `estimateRoute()` — `UA_ROUTES` (~220 pairs) else bearing match (90° <5000 ft / 60°, max 2000 nm; low-alt nearest within 50 nm; never origin===dest) | ✅ | `src/lib/route-estimate.js` `estimateRoute()`; single resolution point `data/route.ts:38-77` so the panel and the map draw the same route |
| `isStarlinkFlight(f)` — `matchAircraft()` then raw reg; false in degraded tier | ✅ | `views/live/starlink-match.ts:14-24` — empty roster answers `false`; degraded tier suppressed upstream (`LiveView.tsx:61`) |
| `matchAircraft(f)` → `src/lib/fleet-match.js` with `FLEET_BY_REG` | ✅ | `state/fleet.tsx:143-147` builds `fleetByReg`; callers pass it explicitly |
| Popup header: callsign, `City → City`, `ORIG → DEST`, "estimated route" note, phase chip, squawk alert | ✅ | `features/FlightSheet.tsx:269-312` — title, `cityFor()` description, big IATA pair, `Route estimated from position and heading — not reported by the feed.`, phase `Badge`, squawk banner |
| Grid: Altitude (+ alt bar), Speed, Heading, V/S via `getFlightPopupMetrics()` | ✅ | `FlightSheet.tsx:329-351` — four metrics + the proportional altitude bar from `metrics.altPct` |
| Aircraft block: type + reg link, `config \| wifi \| IFE`, `⚡ STARLINK CONFIRMED` / `⚡ Checking…`, ⭐ special, seat blocks + total | ✅ | `FlightSheet.tsx:361-403` — reg opens the dialog, `normalizeWifi()` applied, `⚡ Starlink confirmed`, `⭐ {name}`, per-cabin blocks in database order + `(N total)` |
| Unmatched line: `type · reg (Loading aircraft data… \| not in mainline fleet DB — likely United Express)` | ✅ | `FlightSheet.tsx:404-416` — both branches verbatim, keyed on `fleetLoading` so a cold load never asserts "not in the fleet" |
| Async times from `/api/flight-times`; precedence actual → estimated → scheduled; delta `On time` (\|Δ\|≤5), `+Nm`, `Nm` early; "Sched HH:MM" when \|Δ\|>5; tz-labelled | ✅ | `FlightSheet.tsx:58-88` — precedence, ±5 min band, `+{n}m` / `{n}m` (the minus sign is already in the number, so "-7m early" is not doubled), `Sched {time}` past the band, `formatTimeWithTz` per endpoint tz |
| Links: FlightAware `UAL<num>`, Planespotters, ADS-B Exchange, Watch, Share | ✅ | `FlightSheet.tsx:468-524` — `UAL${ident.replace(/^UAL?/i,'')}` (a callsign cannot become `UALL123`), `planespotters.net/search?q=`, `globe.adsbexchange.com/?icao=`, Watch `:469-485`, Share `:486-488` |
| Popup `{maxWidth:320, closeButton:true}`, dark restyle, 44×44 close, marker hit-area, tooltip white-space | 🔁 / ✅ | the popup is a `Sheet`; 44×44 close is in `components/ui/sheet.tsx` (app-wide), marker hit-slop + Leaflet overrides live in `src/styles/global.css` and are pinned by `tests/leaflet-required-styles.test.js` |
| `#hub-stats`: "⊘ SHOW ALL" + per hub `↗ out ↙ in`, bar % of busiest, `BUSIEST`, `✓ FILTERED`, role=button | ✅ | `views/live/LiveSidebar.tsx:155-200` — `⊘ Show all`, `↗ {outbound} ↙ {inbound}`, `row.pct` bar, `BUSIEST` badge, `✓ FILTERED`, real `<button aria-pressed>` |
| `toggleHubFilter(iata)` `map.setView(hub, 7)` or reset | ✅ | `views/LiveView.tsx:119-127` — `focusOn(airport.lat, airport.lon)`; clicking the selected hub clears it (`LiveSidebar.tsx:167`) |
| `#phase-stats` 5 rows (🅿️ Ground, 🛫 Climb, ✈️ Cruise, ↘️ Descent, 🛬 Approach), selected state | ✅ | `LiveSidebar.tsx:22-28, 207-232` — five groups, `PHASE_ICONS` from `src/lib/flight-phase.js`, `aria-pressed` |
| `clearAllFilters()` | ✅ | `views/LiveView.tsx:129-133`, wired to "⊘ Show all" |
| `#stats-bar` 9 stats (Airborne, Utilization, ⚡ Starlink, Climbing, Cruising, Descending, Ground, Avg Alt, Avg Spd); Utilization = airborne/FLEET_DB, `--` without DB, `(filtered)`, `n/a (small sample)` when filtered and airborne < 10 | ✅ | `views/live/StatsBar.tsx:13-23` — all nine labels in order; every value from `computeLiveStats()` (`src/lib/live-stats.js`), which owns the `--` / `(filtered)` / `n/a (small sample)` rules. **Runtime-verified in screenshot** |
| `#stats-bar` hidden 769–1080 px and mobile | ✅ | `StatsBar.tsx:27` `hidden … min-[1081px]:flex` |

### §19 Tab — My Flights

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Empty state `#myflight-empty` + quick-add | ✅ | `views/myflight/QuickAdd.tsx:89` keeps the published `id="myflight-empty"`; copy `:93-106` |
| Quick-add Enter normalizes `UA` prefix | ✅ | `QuickAdd.tsx:48-57` → `parseQuickAdd()` in `src/lib/my-flights.js`; a **tail** number opens the aircraft dialog instead of being mangled into `UAN37502` |
| Placeholder rotator `['Add a flight (e.g. UA 1234)','Try a tail number (N37502)']`, 4000 ms, 300 ms fade, paused on focus | ✅ | `MY_FLIGHTS_PLACEHOLDERS` in `src/lib/my-flights.js`; `QuickAdd.tsx:18-19` `ROTATE_MS = 4000`, `FADE_MS = 300`; paused `:37` |
| `renderMyFlights()` render-token guard; parallel weather/FAA/IROPS preload; one `/api/flight-times` per watched | ✅ | the preload is now the providers' own eager load (`state/weather.tsx`, `state/irops.tsx`); per-flight lookups `views/myflight/useFlightTimes.ts:104-119`; the render token is unnecessary (React reconciles) |
| Flight-times TTL `getMyFlightTimeCacheTTL()` jitter `sum(charCodes) % 20000`; failure 30 s; terminal 300 s; dep <90 min 45 s; <6 h 60 s; else 120 s | ✅ | `flightTimesCacheTtl()` in `src/lib/watch-utils.js` (extracted verbatim from `main.js:6373-6391`), consumed `useFlightTimes.ts:108` |
| `MY_FLIGHTS_FAIL_TERMINAL = 2` → "STATUS UNAVAILABLE" chip + united.com note | ✅ | `myFlightPendingChip(failures)` in `src/lib/my-flights.js`; `views/myflight/FlightCard.tsx:106-108, 182-195` — the united.com line |
| `buildMyFlightCard()`: status chip via `resolveFlightStatus()`, countdown (boarding dep−30 → departure → arrival → Landed), route backfill, gate grid with `getUnitedTerminal()` fallback, equipment grid (+ forecast badge / "Tail not yet assigned"), `via schedule snapshot`, actions | ✅ | `FlightCard.tsx:104-322` — `myFlightStatusChip`, `myFlightCountdown`, `myFlightGateLabels`, `seatConfigString` all from `src/lib/my-flights.js`; `⚡ Starlink Confirmed` `:226`; forecast `StarlinkBadge` `:238`; `Tail not yet assigned` `:242`; `via schedule snapshot` `:250`; four actions `:284-321` |
| `updateMyFlightsCountdowns()` 1 s while the tab is active | ✅ | `views/MyFlightsView.tsx:77-84` — interval only while `tab === 'myflight'` (views are force-mounted, so "on mount" would leave a timer per tab) |
| Risk badge: `computeDelayRisk()` else `findBoardRiskForFlight()` else grey `RISK N/A` | ✅ | `MyFlightsView.tsx:149-186` — exactly that order; `FlightCard.tsx:168-176` renders `RISK N/A` in muted, never a default LOW |
| Risk/explain data-attrs: flight, route, status, riskLabel, riskScore, riskFactors, hub, otp, weather, destWeather, irops, faaStatus, connection, inbound | ✅ | `MyFlightsView.tsx:191-207` — all fourteen fields, same names |
| Aircraft journey chain: `/api/aircraft-history?reg=`, 5-min cache, failures cache `[]` ("Flight history unavailable"), up to 3 prior segments, delay classes on-time ≤5 / minor ≤45 / major, `buildJourneyContextStr()` back-fills `data-inbound` | ✅ | `useAircraftJourney.ts:25` `TTL_MS = 300000`, failure caches `[]` `:65`; `JourneyChain.tsx:38-55` distinguishes `null` (loading) from `[]` (answered, nothing) — the legacy card showed the loading line for both; `shapeJourney`/`journeyDelayClass` in `src/lib/journey.js`; context `MyFlightsView.tsx:133-134` |
| "Where's My Plane?" inbound card — same reg, different flight, `dest === origCode`, airborne; only when our own flight is not airborne | ✅ | `findInboundAircraft(flights, reg, flight, origCode, ownFlightAirborne)` in `src/lib/my-flights.js`; rendered `FlightCard.tsx:262-270` |
| Connection risk: cross-join watched flights where `td1.destination.iata === td2.origin.iata`, hub in `HUB_CODES`, `0 < gap < 480` | ✅ | `findWatchedConnections()` in `src/lib/connection-pairing.js`; `MyFlightsView.tsx:104-113` |
| `computeConnectionRisk()`: `mctKey = (domIn?'d':'i')+(domOut?'d':'i')` via `INTL_AIRPORTS`; MCT default 60; walk 5 same terminal else table or 10; verdict via `classifyConnection` | ✅ | `src/lib/connection-pairing.js` `computeConnectionRisk()`; tables `src/lib/connection-risk.js:20-32` |
| `MIN_CONNECTION_TIMES` (ORD 75, DEN/IAH/EWR/SFO/IAD/NRT 60, LAX 75, GUM 45; intl 90–120) + `TERMINAL_WALK_TIMES` | ✅ | `src/lib/connection-risk.js:20-32` — unchanged module |
| Verdict states `scored` / `insufficient` (grey, never green) / `disrupted` | ✅ | `src/lib/connection-risk.js:34-40`; typed `views/myflight/ConnectionPanel.tsx:32` |
| Card copy keeps "…our conservative guidance — United's published MCT is lower" | ✅ | `src/lib/connection-pairing.js` — both fragments verbatim (grep-confirmed) |
| `connectionIndex[flight]` for both legs, feeds AI `data-connection` | ✅ | `buildConnectionIndex()` `MyFlightsView.tsx:111`; consumed `:204` |
| Manual checker `#myflight-check` (`#conn-inbound`, `#conn-outbound`, Check, `#conn-manual-result`); distinguishes feed outage / not-found / not-connecting; Enter submits | ✅ | `ConnectionPanel.tsx:148-190` — all four ids preserved; `manualConnectionOutcome()` in `src/lib/connection-pairing.js` returns `outage` / error / `ok`; `null` from a lookup means the **request** failed `:104-112`; Enter `:140-145` |

### §20 Tab — Schedule

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Day buttons `-1/0/1` labelled Yesterday/Today/Tomorrow (M/D) hub-local | ✅ | `getHubDayLabel()` in `src/lib/hubTz.js`; `views/schedule/ScheduleControls.tsx`. **Runtime-verified:** stat strip reads `UA DEP · MON, SEP 14` |
| `#sched-hub` (All Hubs + 9), `#sched-dir` | ✅ | `ScheduleControls.tsx`; "All Hubs" is a real selection with no board (`state/schedule.tsx:462`, prompt `views/ScheduleView.tsx:259-265`) |
| `#sched-find` two-way mirrored with `#sched-search`, one predicate | ✅ | one `filters.search` value feeds both the toolbar input and the drawer (`ScheduleView.tsx:78-90`, `AdvancedFilters.tsx:186-197`) — the legacy hand-mirrored pair is gone |
| `#sched-jump-now` pill (today board with ≥1 future row) | ✅ | `ScheduleView.tsx:232` `showJumpToNow = day === 0 && model.firstFutureIndex >= 0`; `onJumpToNow` → `scrollToNow(true)` |
| `#sched-refresh-btn` deletes the cache key then reloads | ✅ | `state/schedule.tsx:484-493` — `aggCache.delete(aggCacheKey(...))` then `load()` |
| `#sched-more-filters-btn` / drawer; label `Filters (N active) ▾/▴` else `Filter: … ▾` / `Less Filters ▴` | ✅ | `activeAdvFilterCount()` + `advFilterLabel(count, open)` in `src/lib/schedule-load.js:243-260`, used by `ScheduleControls.tsx` |
| 7 advanced selects + search with the shipped value strings | ✅ | `views/schedule/AdvancedFilters.tsx:33-74` — status (8), aircraft (from the board), fleet family (737/A320/757/767/777/787), route type, starlink (`starlink`/`no-starlink`), time range (`morning`/`afternoon`/`evening`/`redeye` with the 5a–12p / 12p–5p / 5p–10p / 10p–5a labels), risk (high/moderate/low). **Runtime-verified:** `All Status`, `All Aircraft` triggers render |
| Advanced filters (route-type, starlink, timerange, risk) reset on hub/dir/day change | ✅ | `views/ScheduleView.tsx:56-62, 108-110` — exactly those four |
| Render debounce 120 ms | ✅ | `ScheduleView.tsx:54` `RENDER_DEBOUNCE_MS = 120` |
| `GET /api/schedule?hub=&dir=&timestamp=<startOfHubDaySec>` | ✅ | `data/api.ts:177-199`; timestamp `getStartOfHubDay(hub, day)` `state/schedule.tsx:429` |
| AbortController timeout 60 000 ms → "Schedule request timed out" | ✅ | `src/lib/schedule-load.js:21` `SCHEDULE_TIMEOUT_MS = 60000`; message `state/schedule.tsx:242-243` |
| In-memory `agg-<hub>-<dir>-<ts>`; partial responses not cached | ✅ | `aggCacheKey()` `src/lib/schedule-load.js:40`; `state/schedule.tsx:237` `if (!data.partial) aggCache.set(...)` |
| Server-clock offset from `Date` + `Age` → `schedNow()` server-anchored | ✅ | `data/api.ts:191-198` computes `serverNowMs`; `serverClockOffsetSec()` `src/lib/schedule-load.js:93`; `nowSec()` `state/schedule.tsx:209` |
| Retry `MAX_RETRIES = 3`, backoff `min(1000·2^(n-1), 4000)`; retries `partial` except `first_page_failed && total === 0` | ✅ | `MAX_SCHEDULE_RETRIES = 3`, `retryDelayMs()`, `shouldRetryPartial()` — `src/lib/schedule-load.js:18, 58, 74`; loop `state/schedule.tsx:258-284` |
| Frozen `loadHub/loadDir/loadDay` (F034); abort if the user switched; `_schedPendingReload` | ✅ | `runLoad(hub, dir, day)` takes frozen values (`state/schedule.tsx:424-452`); one active load with a single pending slot `:459-483` |
| Fields read: `flights[], total, cached, partial, degraded, stale, error, meta.{…}` | ✅ | `data/types.ts:180-191` + `state/schedule.tsx:398-411` |
| State: raw by hub/dir/day, meta, overlaid flights, board meta, fetched-at | ✅ | `Board` type `state/schedule.tsx:74-90`; `rawByHub` `:596-603` |
| Post-load fan-out (weather/FAA preload, swaps, aircraft filter, table, stats, hub health, IROPS, watched-flight diff) | ✅ | swaps `state/schedule.tsx:379-396`; watched diff `:439`; every other consumer re-derives (`useHubHealth`, `IropsSection`, `aircraftOptions`) |
| Preload `['ORD','DEN','EWR']` sequential, per-hub `getStartOfHubDay(hub,0)` (F022), TTL 10 min via `sessionStorage.bb_sched_preload_ts` | ✅ | `PRELOAD_HUBS`, `PRELOAD_TTL_MS` `src/lib/schedule-load.js:24-27`; sequential loop + per-hub timestamp `state/schedule.tsx:504-537` |
| Initial day = `defaultSchedDayOffset(hub)` | ✅ | `state/schedule.tsx:172-176` (in the initialiser, so no wasted day-0 board) |
| Staleness ladder: degraded / stale / `liveFeedFallbackAdded` / five `partialReason` variants / fallback | ✅ | `describeBoardCondition()` `src/lib/schedule-load.js:175-242`; rendered `views/schedule/StalenessBanner.tsx` |
| Completeness suffix `" N% loaded."` / `" N% previously loaded."` (suppressed for `actual_only_official`) | ✅ | `completenessSuffix()` `src/lib/schedule-load.js:153-174` |
| Palette via `dataAgeSeverity()` (stale red ⚠️; aging amber ⏳; degraded teal ⏳; else amber ⚠️) | ✅ | severity from `src/lib/data-age.js`; name→class map `views/schedule/tone.ts:32-38` (`stale`/`aging`/`degraded`/`partial`/`muted`) |
| Clean board older than 600 s → muted age chip "data as of <time>" | ✅ | `AGE_CHIP_THRESHOLD_SECONDS = 600` `src/lib/schedule-load.js:30`; chip `views/schedule/ScheduleTable.tsx` via `boardAsOf` |
| `formatBoardAsOf()` `generatedAt` → `fetchedAt - dataAge` → fetch time, hub-local `h:mm A TZ` | ✅ | `boardAsOfMs()` + `formatBoardAsOf()` `src/lib/schedule-load.js:107-138`; `views/ScheduleView.tsx:149-158` |
| Columns: Time, Flight, Route, Aircraft, Reg, Term/Gate, Status, Delay/Risk, Fleet, 👁️ | ✅ | **Runtime-verified, all ten in order:** `Time↑ Flight↕ Route↕ Aircraft↕ Reg↕ Term / Gate Status↕ Delay / Risk Fleet 👁️Watch` |
| Sortable time/flight/route/aircraft/reg/status; arrows `↑/↓/↕` + `aria-sort` | ✅ | `views/schedule/useBoardModel.ts:47` six sort columns; comparators `:364-399`; arrows + `aria-sort` **runtime-verified** |
| Time cell: hub-local `HH:MM`; date chip for a prior hub-local date; `→ HH:MM (+Nm)` when \|Δ\|>5 (green early); `actual` tag when derived | ✅ | `buildScheduleRow()` in `src/lib/schedule-row-model.js` → `timeText`, `dateChip`, `actualLine{text,early}`, `derivedActual` (`useBoardModel.ts:107-112`) |
| Route cell promotes the airport name when IATA is missing (never bare `?`) | ✅ | `routeLine` / `routeSub` from `buildScheduleRow()` |
| Reg cell: provider registration first, ledger backfill, tooltip "Tail from live flight tracking (not in the schedule feed)" | ✅ | `useBoardModel.ts:277-293` `regFor()` — provider then `lookupReg()`; `regFromLive` flag `:119-120` drives the tooltip |
| Term/Gate `T<t> · <g>` / `T<t>` / `Gate <g>` / `—` with `UNITED_HUB_TERMINALS` fallback | ✅ | `src/lib/hub-terminals.js` `getUnitedTerminal()`; `gate` field from `buildScheduleRow()` |
| Status cell: `classifySchedStatus()` + `displayScheduleStatus()`; presumed → `Departed*` + tooltip; unknown → "Scheduled" + `as of <time>`; live-confirmed → `LIVE` chip | ✅ | `StatusModel {key, cls, text, presumed, asOf, live}` `useBoardModel.ts:81-88`; rendered `ScheduleTable.tsx`; tones `views/schedule/tone.ts:41-52` |
| Delay/Risk precedence (facts beat predictions): terminal → `—`; known delta → `formatDelayMinutes(Δ)` coloured; else `RISK: <LABEL>`; else `—` | ✅ | `DelayCell` union `useBoardModel.ts:98-101`; risk only computed for `scheduled`/`estimated`/`delayed` rows `:296-334`; `delayToneClass()` `tone.ts:18-22` |
| Fleet cell `⚡`/`✓ <config\|type>` or `—`; enrichment line `seats · wifi · ⚡ Starlink · IFE · Del YYYY` | ✅ | `fleet: {badge, starlink, enrich}` from `buildScheduleRow()` (`useBoardModel.ts:123`) |
| Equipment-swap badge `🔴/🟢/⚠️ <old> → <new> <reg>` + impact chips | ✅ | `SwapModel` `useBoardModel.ts:90-96`; `analyzeSwapImpact()` `:443-448`; tones `tone.ts:55-59` |
| `⭐` special-livery badge in Reg | ✅ | `special` field `useBoardModel.ts:125` |
| Delayed rows via `getFAADelayContext(orig, dest)` → "Ground Stop at EWR, avg 45 min · GDP at ORD" | ✅ | `src/lib/faa-context.js` `getFAADelayContext()`; applied only to rows whose class is `delayed` — `useBoardModel.ts:423-430` |
| Watch button per row | ✅ | `ScheduleTable` `onToggleWatch` → `views/ScheduleView.tsx:219-224`. **Runtime-verified column header `👁️Watch`** |
| NOW divider — today boards, sort=time asc only; anchor `effectiveRowTime()` = `max(scheduled, estimated)` (F075); `nowDividerIndex()` −1 when no past rows; label `── NOW · HH:MM TZ ──` | ✅ | `useBoardModel.ts:470-490` — gated on `day === 0 && sort.column === 'time' && sort.asc`; `effectiveRowTime`/`firstFutureIndex`/`nowDividerIndex` from `src/lib/board-now.js`. **Runtime-verified:** `── NOW · 21:04 CDT ──` |
| One-shot auto-scroll to NOW after a fresh today load only | ✅ | `shouldAutoScroll(signal, key, lastHandledN)` `src/lib/schedule-load.js:297`; the signal is **board-scoped** (`state/schedule.tsx:100-108, 438`) so a straggling load cannot yank the board being read; consumed `views/ScheduleView.tsx:180-187` |
| Empty state "🔍 No flights match your filters" colspan 10 | ✅ | `ScheduleTable.tsx:231-235` — `colSpan={10}`, text `No flights match your filters` with the 🔍 rendered as a separate `aria-hidden` glyph |
| `#sched-tz-footer` "Schedule data via **AeroDataBox** · United flights only · All times <hub> local (**TZ**)" | ✅ | `views/ScheduleView.tsx:315-327`. **Runtime-verified verbatim:** `Schedule data via AeroDataBox · United flights only · All times ORD local (CDT)` |
| `applyLiveFeedOverlayToSchedule()` / `applySightingsToBoard()` on the filtered board only | ✅ | `useBoardModel.ts:238-263` — applied inside the memo chain so the rows, the stats and the filters can never disagree; the RAW rows stay un-overlaid for hub health, IROPS and swap detection |
| Stat strip 6–7 cards (total, On-Time % + `(N operated)`, On Time, Late, Canceled, Upcoming, muted Uncategorized); OTP colours ≥70/≥50; `—` undefined; Canceled title; `computeScheduleStatCounts()` | ✅ | `views/schedule/ScheduleStats.tsx`; counts `src/lib/board-stats.js` (`useBoardModel.ts:492-496`); thresholds `otpSeverity()` + `OTP_SEVERITY_LABEL` in `src/lib/schedule-row-model.js`, mapped `tone.ts:65-69`. **Runtime-verified:** six stat cards render |
| `#sched-stats-note`: "✈ N presumed departed/landed" chip; warning when `hubDisruptionMinutes > 60` | ✅ | `ScheduleStats.tsx` — `presumed` count from the stat model; `hubDisruptionMinutes` passed `views/ScheduleView.tsx:296-298` |
| `detectEquipmentSwaps()` key `bb_sched_<hub>_<dir>_<day>`; diff then overwrite | ✅ | `swapStorageKey()` `src/lib/schedule-load.js:50-52` → `bb_sched_${hub}_${dir}_${day}` byte-exact; `state/schedule.tsx:379-396`, run only on a real fetch so a cache hit cannot wipe the badges |
| `ICAO_TO_FLEET_TYPE` (18 codes) | ✅ | `src/lib/equipment-swaps.js` |
| `getTypicalFleetStats(icaoCode)` modal config / modal WiFi / any-Starlink / top cabin by `CABIN_RANK` | ✅ | `src/lib/equipment-swaps.js`; called `useBoardModel.ts:403` and `views/ScheduleView.tsx:202-203` |
| `analyzeSwapImpact()` → `src/lib/swap-impact.js` | ✅ | unchanged module |
| `#equip-change-summary` "⚠️ N equipment swaps detected · N downgrades · N upgrades", flash, click opens the drawer | ✅ | `swapSummary()` `src/lib/schedule-load.js:262-296`; `views/schedule/SwapSummary.tsx`, `onOpenFilters` `views/ScheduleView.tsx:290` |
| `#sched-pagination` dead | ➖ | inventory §35 flagged it as dead; not ported |

### §21 Tab — Fleet

| item (abbreviated) | verdict | evidence |
|---|---|---|
| sr-only fleet summary (1,078 aircraft, 19 types, build-stamped Starlink string) | ✅ | moved server-side — `src/lib/home-seo.js:200-211` `FLEET_SUMMARY`, rendered `src/pages/index.astro:83-88`. Counts are computed from `src/data/facts.js` + `src/data/fleet/index.js`, never hand-typed; `dist/index.html` contains `1,078` ×2 |
| Zone 1 Fleet Pulse: shimmer, LIVE badge + time, airborne count, "N mainline matched · N regional/partner", "N% fleet utilization (n/total)", per-type bars | ✅ | `views/fleet/FleetPulse.tsx:44-106` — all six; the timestamp is the **payload's** own (`FleetView.tsx:128-131`), not wall-clock, so a stale serve is not reported as fresh |
| `#fleet-health-content` `renderFleetHealth()` (total, "N active (X.X%) · N out of service", bars per `FLEET_HEALTH_CATEGORIES`) | ✅ | `views/fleet/FleetHealth.tsx:76-116`; counts `fleetHealthCounts()` in `src/lib/fleet-view.js`; categories from `src/lib/fleet-utils.js` |
| Starlink progress + `#starlink-pct` "N% (m/total)" | ✅ | `FleetHealth.tsx:120-132` |
| `#starlink-fleet-stats` chips: Total, Mainline, Express (purple), Mainline %, Express %, `+N New (7d)` amber | ✅ | `views/FleetView.tsx:137-161` — all six, `+N` gated on `newThisWeek > 0`, tones `FleetHealth.tsx:29-35` |
| Zone 2 Composition: `FLEET_FAMILIES` with `WIDEBODY · POLARIS` divider, family header, route callout, subgroups, variant cards (role=button, aria-pressed) | ✅ | `views/fleet/FleetComposition.tsx:39-116` — divider before the first widebody family `:49-57`, `routeCallout` `:72-74`, real `<button aria-pressed>` `:91-106` |
| Delivery Timeline: stacked bars by year, 8-colour family map, 140 px, labels ≥15, year labels every 5 + first/last; stats "Average Xy · Newest REG (YYYY) · Oldest REG (YYYY)" + decade buckets | ✅ | geometry `views/fleet/DeliveryTimeline.tsx:41-47` (`CHART_H = 140`); every numeric decision (`showCount`, `showYear`, segment heights, legend) from `buildDeliveryTimeline()` in `src/lib/fleet-view.js`; stats `:139-164` |
| Seat Configuration `showConfigGallery()` / `showConfigEmpty()` cabin colours, width `max(30, count/2)`; empty offers 737-800 / A321neo / 777-300ER | ✅ | `buildConfigGallery()` in `src/lib/fleet-view.js` owns colours and widths; `views/fleet/SeatConfigGallery.tsx:24` `QUICK_TYPES = ['737-800','A321neo','777-300ER']` |
| Zone 3 sub-tabs (All / Airborne Now / 🛰️ Starlink → redirect / Special) with counts | ✅ | `views/FleetView.tsx:386-401` — four triggers with counts; `starlink` routes to the top-level tab `:377`. `activationMode="manual"` so arrowing past 🛰️ does not navigate away mid-keystroke |
| Controls `#fleet-search`, type (19 fixed order), wifi (`normalizeWifi`), status (Active / Stored-Maint / Starlink / Special+Named), Refresh | ✅ | `views/fleet/FleetControls.tsx:90-152`; type order from `TYPE_ORDER` (`src/lib/analytics.js`) filtered to present types (`FleetView.tsx:93-98`); `wifiFilterOptions()` `src/lib/fleet-view.js`; `STATUS_OPTIONS` `:33-38` |
| Filter/sort via `filterFleetData`/`sortFleetData` with `starlinkTails` + `specialAircraftSet`; row classes `.row-stored`/`.row-maint` | ✅ | `FleetView.tsx:166-176`; dimming `views/fleet/FleetTable.tsx:94-99` — a **named** aircraft is never dimmed (`*Sam E. Ashmore` is a name, not a maintenance note) |
| `#fleet-zero-results` + "Clear Filters" | ✅ | `FleetTable.tsx:62-71` |
| `filterFleetType(type)` toggles, syncs dropdown + cards, opens gallery, smooth-scrolls to the lookup zone | ✅ | `FleetView.tsx:201-213` — one `typeFilter` drives the cards, the dropdown and the gallery; scrolls only on select |
| Debounced 120 ms listeners | ✅ | `FleetControls.tsx:31` `SEARCH_DEBOUNCE_MS = 120` |
| Airborne table 8 cols (Reg/Type/Flight/Route/Alt/Phase/SL/Special), own sort | ✅ | `views/fleet/AirborneTable.tsx:60-71` — eight columns, independent `airborneSort` state |
| Special panel AIRBORNE pulse or NAMED/LIVERY | ✅ | `views/fleet/SpecialPanel.tsx:80-97` |
| `SPECIAL_AIRCRAFT` from fleet.json `s`: `*Name*` → named; `/100 Year Sticker/i`, `/Eco Demonstrator/i` → livery | ✅ | `indexSpecialAircraft()` in `src/lib/special-aircraft.js`; `state/fleet.tsx:149` |
| `ENGINE_BY_TYPE` | ✅ | `src/lib/special-aircraft.js`, used `features/AircraftDetailDialog.tsx:248` |
| `refreshFleetData()` = `location.reload()` | ✅ | `FleetControls.tsx:149-150` — `/data/fleet.json` is a build artefact, so a reload genuinely is the only way to pull a newer one |
| Load-failure `renderFleetLoadError()` (F035) "Fleet database unavailable", "This is a load error — not zero aircraft", ↻ Retry | ✅ | `views/fleet/FleetHealth.tsx:37-49` both strings verbatim; `FleetView.tsx:267-288` keeps the live pulse running (a fleet-file outage is not "the whole tab is broken") and suppresses the mainline/regional split rather than calling every aircraft regional |
| Source line "Fleet data via United Fleet Site, updated daily" | ✅ | `FleetView.tsx:353-364` |

### §22 Tab — Starlink

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Hero: count, "Aircraft Equipped", verify sub ("N verified · N disputed" + jump), Express/Mainline bars `n / total · N%`, chips `+N NEW THIS WEEK`, `● N AIRBORNE NOW` (→ Live + Starlink filter); bars hidden in the degraded tier | ✅ | `views/starlink/SlHero.tsx`, fed `views/StarlinkView.tsx:393-407`; `rolloutBars()` returns null without stats (`src/lib/starlink-roster.js`); the airborne chip calls `onShowOnMap` → `setStarlinkFilter(true)` + `setTab('live')` `:375-379` |
| `isRecentlyFound(dateFound)` 7 days +1 day skew | ✅ | `src/lib/starlink-view.js` `isRecentlyFound()`; `StarlinkView.tsx:186-190` |
| Installation Velocity: pure SVG stacked monthly + cumulative line + right axis, outlier cap, zig-zag break + `N*`, footnote, month labels thinned >18, card hidden with no months | ✅ | `buildVelocityChart(months, undated)` in `src/lib/starlink-chart.js` owns every number; `views/starlink/VelocityChart.tsx` draws it; `{chart ? … : null}` `StarlinkView.tsx:409` |
| Install pace → `#sl-velo-stats` (pace, "N-wk trailing pace", `~MON 'YY`, note); ETA denominator Express remaining only | ✅ | `computeInstallPace()` `src/lib/starlink-utils.js`; `StarlinkView.tsx:197-231` — `expressRemaining` only, with the reason stated; `'N-wk trailing pace'` and `~MON 'YY` formats verbatim |
| Industry strip from `/api/fleet-summary` `airlines[]`, sorted desc, UA amber; hidden unless every row is finite | ✅ | `buildIndustryRows()` `src/lib/starlink-roster.js` returns null otherwise; `views/starlink/IndustryStrip.tsx`; `{industry ? … : null}` `StarlinkView.tsx:411` |
| Hub Departures Board: `buildDeparturesBoard(…, {now, windowSec, graceSec:1800, hub, capPerHub})`; 12 h / 48 h; caps ∞ / 6 / 40 / ∞; ALL + 9 hub pills with counts and an empty class; bucket labels; "Show all · N more departures ▾"; row (time + relative, callsign + operator, tail, route, type, ● Airborne/SCHED, 📡 Track); freshness; degraded → hidden + note; footer honesty text | ✅ | `StarlinkView.tsx:246-270` (`graceSec: 1800`, `windowSec: boardWindow*3600`), caps `boardCapPolicy()` `src/lib/starlink-view.js`; `views/starlink/DeparturesBoard.tsx` — pills `:156-186` (`sl-board-pill-empty` `:180`), buckets `:195-215`, `Show all · {n} more departures ▾` `:222`, row `:35-102`, `#sl-board-updated` `:138`, footer `BOARD_FOOTER` `:29-30` verbatim, degraded note `BOARD_UNAVAILABLE_NOTE` `:32-33` |
| `formatFlightTime(ts, iata)` hub-local + TZ abbrev, else viewer-local with label | ✅ | `src/lib/starlink-view.js` `formatFlightTime()`; abbrev supplier `StarlinkView.tsx:173-181` |
| Roster: five filters, sortable, `#sl-filtered-count`; Status/Next Flight hidden without live data; next flight = first dep `>= now - 1800` else last; NEW badge + red `!` integrity dot; filter change collapses the expansion | ✅ | `views/starlink/RosterControls.tsx` (ids `sl-search`, `sl-filter-fleet`, `sl-filter-type`, `sl-filter-operator`, `sl-filter-new`, `sl-filtered-count` all preserved); `views/starlink/RosterTable.tsx` — conditional columns `:5-8`, `nextFlight()`/`upcomingFlights()` from `src/lib/starlink-roster.js`; collapse on every filter/sort `StarlinkView.tsx:313-341` |
| Row expansion one at a time: meta grid, up to 5 upcoming flights, Track / Aircraft Details / Planespotters | ✅ | `RosterTable.tsx` `Expansion`; `expanded` is a single tail `StarlinkView.tsx:119` |
| Verification Ledger: one-shot `/api/starlink-mismatches`, unexpected shape resets the guard, hidden when no data, stat strip, integrity tripwire `getServedConflictTails()` → `⚠ INTEGRITY ALERT` role=alert, disputed table, `<details open>` | ✅ | fetch + guard reset `StarlinkView.tsx:132-159`; `ledgerHasData()` `:302`; `getServedConflictTails(disputed, tails, syncedAt)` `:293-301`; `views/starlink/VerificationLedger.tsx` |
| Source footer "Starlink data via unitedstarlinktracker.com · <updated> · N aircraft" | ✅ | `StarlinkView.tsx:485-499` — ids `sl-source`, `sl-updated`, `sl-count` preserved |
| Empty/failed states | ✅ | `RosterTable.tsx:49-50` — `ROSTER_EMPTY` ("Starlink fleet data unavailable — try refreshing the page.") and `ROSTER_NO_MATCH` |

### §23 Tab — Delays · Weather · Hubs

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Two-panel `wx-layout` | ✅ | `views/WeatherView.tsx:95-126` — radar left, text right at `lg:`, stacked below |
| `#radar-map` own Leaflet (`[39,-97]` z4, zoom bottomleft), CARTO + NEXRAD .6, `invalidateSize()` 200 ms, teardown before re-init | ✅ | `map/RadarMap.tsx:32` `RADAR_VIEW = {center:[39,-97], zoom:4}`, `:39` `RADAR_OPACITY = 0.6`, `:88` bottomleft, `:116` 200 ms; created once and torn down on unmount `:120-126` — the retry refreshes the store rather than remounting, which is exactly the "Map container is already initialized" bug the legacy weather-retry hit |
| `#radar-title` `🌧 NEXRAD Radar — HH:MM:SSZ` | ✅ | `radarTitle(updatedAt)` in `src/lib/weather-cards.js`; `views/weather/RadarPanel.tsx:26-28` |
| Radar hub markers 9, neutral `#334155` until METAR, permanent tooltips `<b>HUB</b> CAT (reason)`, click highlights the card 1500 ms | ✅ | `map/RadarMap.tsx:96-111` (`NEUTRAL_MARKER_COLOR` from `src/lib/weather-cards.js`), recolour in place `:130-137`, tooltip `:59-67`; highlight `views/WeatherView.tsx:31, 55-62` `HIGHLIGHT_MS = 1500` |
| `wx-legend` VFR/MVFR/IFR/LIFR with `CAT_COLORS` | ✅ | `WX_LEGEND` in `src/lib/weather-cards.js`; `RadarPanel.tsx:39-50` — each swatch paired with its category **name** |
| `#wx-scroll-hint` "Hub Stations ↓" IntersectionObserver | ✅ | `views/WeatherView.tsx:80-92, 105-115` — removes itself once the cards are in view |
| `Promise.allSettled([fetchMetarBatch, /api/faa, /api/nas])`; `/api/metar?ids=` chunked via `chunkMetarStationIds()`, `normalizeMetarPayload()` | ✅ | `state/weather.tsx:129-159`; `data/api.ts:151-162` — chunked, `allSettled` per chunk so a later non-hub chunk failing cannot cost the hub observations |
| Hub → station map (EWR KEWR … GUM PGUM) | ✅ | `getMetarStationForIata()` in `src/lib/airport-metadata.js`; `collectMetarStations()` `src/lib/weather-cards.js` |
| Category = worse of API `fltCat` and `computeFlightCategory(raw)` | ✅ | `resolveWeather()` / `buildHubCardModel()` in `src/lib/weather-cards.js` (uses `src/lib/metar-category.js`) |
| `computeOpsImpact(raw, cat)` → `weatherOpsByHub` feeds delay-risk | ✅ | `state/weather.tsx:141-144` `resolveWeather(record).weatherOps`; consumed by both risk call sites |
| Hub card: border = ops/category colour; code, DE-ICE badge, cat badge; Temperature/Wind/Visibility/Ceiling; runway line; status precedence FAA > severe > warning > caution > `✓ Normal Operations`; `▾ Details` with METAR + FAA explainers, advisory links, NOTAM, raw METAR | ✅ | every decision in `buildHubCardModel()`; layout `views/weather/HubCard.tsx:74-187` — four metrics `:76-81`, runway `:121-123`, status `:125-133`, details `:141-186`. `parseMetarQuick`/`applyStructuredMetarFallback`/`explainMETAR`/`explainFAAStatus` all live in `src/lib/metar-explain.js` + `src/lib/faa-context.js` |
| Skeletons for 9 hubs; total-failure "🌦 Weather data unavailable" + retry | ✅ | `views/weather/HubCards.tsx:20-36, 55-78` — nine card-shaped skeletons; the failure state replaces the cards rather than showing nine rows of `--` |
| 5-minute refresh, skipped when hidden; rebuilds the FAA index, hub health, ops map, marker colours, radar timestamp | ✅ | `state/weather.tsx:29` `WEATHER_REFRESH_MS = 5*60*1000`, `:108-113` skips while `document.hidden`; merged (not replaced) so a late station keeps its last good observation |
| `explainMETAR()` plain-English (16-point wind, vis, ceiling, phenomena, temp C/F, altimeter, assessment) | ✅ | `src/lib/metar-explain.js` |
| `explainFAAStatus(code, delays, raw)` | ✅ | `src/lib/faa-context.js` |
| NAS STATUS panel: `SEV_LABELS`, `detectSevType()`, `sevBadgeClass()`, tiers critical/active/monitoring, header + count line, item badge/title/hub tags/detail, "View full ATCSCC advisory →", hidden when empty | ✅ | `src/lib/nas-severity.js` (`tierNasEventsRaw`, `nasCountLine`, `nasPanelEmpty`, `sevBadgeClass`); `views/weather/NasPanel.tsx:97-131` — three tiers `:117-119`, advisory link `:120-129`, `if (nasPanelEmpty(payload)) return null` `:102` |
| IROPS section | ✅ | §24 |
| Tracker briefing: generic vs home-hub copy, deep links `/trackers/united-hubs/<hub>` + `/trackers/atc/<hub>`, watch state `bb_tracker_watches` | ✅ | `buildTrackerBriefing()` + `parseTrackerWatches()` in `src/lib/tracker-briefing.js`; `views/weather/TrackerBriefing.tsx:33-44` reads `STORAGE_KEYS.trackerWatches` (`bb_tracker_watches`) |

### §24 IROPS dashboard

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `fetchIropsFromAPI()` deduped | ✅ | `state/irops.tsx:56-59` — one `useJson` per provider, shared by the strip, the ticker and the section |
| `renderIropsFromAPI(data)` reads score, cancellations, delayed30, delayed60, diversions, totalFlights, hubMetrics | ✅ | `data/types.ts:125-133`; `views/weather/IropsSection.tsx:103-113` |
| `iropsRateFloor(total, cancellations)` = `total >= 10 \|\| cancellations >= 3` | ✅ | `src/lib/irops-score.js:10-12`; applied via `iropsHubRates()` `state/irops.tsx:64-67` (a rate off a four-flight board is `null`, not a number) |
| Single-writer (F002): server short-circuits the client fallback | ✅ | `IropsSection.tsx:124-127` — the client path reports a score **only** while `!usingServer`; `state/irops.tsx:77` `data?.score ?? clientScore` |
| Client fallback: today departures only, `est · loaded boards` tag | ✅ | `countIropsFromBoards()` in `src/lib/irops-client.js`; tag `IropsSection.tsx:159-163` verbatim |
| Score `((c*3 + d60*2 + (d30-d60) + div*2)/total)*100` 1 dp; labels `<5 NORMAL OPERATIONS`, `<15 MINOR DISRUPTION`, else `SIGNIFICANT DISRUPTION` | ✅ | `src/lib/irops-score.js:18-29` — formula and all three labels unchanged. **Runtime-verified:** `SIGNIFICANT DISRUPTION` rendered from the server path |
| Bar layout: label + chip + `?` tooltip, Cancellations / >30m / >60m / Diversions / Total; client path appends the FAA line | ✅ | `IropsSection.tsx:188-198` — five metrics in order; FAA strip `:204-208` rendered **only** on the client path (the server payload has no per-airport detail). **Runtime-verified:** `95 CANCELLATIONS 712 >30M 258 >60M 0 DIVERSIONS 2838 TOTAL FLIGHTS` |
| `lastIropsScore` → ticker; `announceIropsLevelChange()`; copy "Loading schedule data…" / "IROPS unavailable" | ✅ | ticker `shell/Ticker.tsx:59`; the announcement lives in `shell/IropsAnnouncer.tsx:28-38` (mounted on **every** tab, so a viewer parked on Live still hears a level change — the legacy writer ran from the idle preload); both strings `IropsSection.tsx:144` |

### §25 Tab — Stats

| item (abbreviated) | verdict | evidence |
|---|---|---|
| 4 metric cards: Flights Airborne, Fleet Utilization %, Avg Fleet Age, Starlink Coverage % ("N of M airborne") | ✅ | `views/StatsView.tsx:98-115` + `views/stats/MetricCards.tsx` — all four, the Starlink card keeps its denominator subtitle |
| `#util-chart` per type (19 order), colour bands `>60 / >30 / >0 / 0` | ✅ | `TYPE_ORDER` + `typeUtilization()` (`src/lib/analytics.js`); bands `utilBand()`/`UTIL_BAR_COLOR`/`UTIL_TEXT_CLASS` in `src/lib/stats-chart.js`; `views/stats/UtilizationChart.tsx` — all nineteen rows including the zeroes |
| `#phase-chart` SVG donut (r 36, stroke 12, ×2.26) + legend | ✅ | `DONUT` + `donutSegments()` `src/lib/stats-chart.js`; `views/stats/PhaseDonut.tsx:46-78`. Hues re-stepped — 🔁 per ACCEPT ruling; geometry unchanged. The donut is `aria-hidden` with an sr-only data table `:110-128` |
| `#hub-matrix` 9×9 + TOTAL, diagonal blank, tinted by `max(.15, v/max)` | ✅ | `hubMatrix()` `src/lib/analytics.js`; `matrixAlpha()` `src/lib/stats-chart.js`; `views/stats/HubMatrix.tsx:46-84` — real `<table>` with row/col headers, diagonal `—` + sr-only "not applicable" |
| `#route-heatmap` top 15 pairs; empty "Waiting for flight data…" | ✅ | `topRoutes(airborne, 15)` `StatsView.tsx:88-91`; `views/stats/RouteBars.tsx:13-15` verbatim empty string |
| `#avg-age-chart` width `avg/30`, colour bands `>20 / >15 / >8 / else` | ✅ | `ageBarPct()` + `ageBand()` + `AGE_BAR_COLOR` `src/lib/stats-chart.js`; `RouteBars.tsx:41-62` |
| `updateAnalytics()` on tab switch + every 30 s; headers "updates every 30s" | ✅ | derived from the feed store, which polls at 30 s — `StatsView.tsx:4-8, 47` `REFRESH_NOTE = 'updates every 30s'` on three panels |

### §26 Tab — Sources

| item (abbreviated) | verdict | evidence |
|---|---|---|
| 10 static source cards (FR24 LIVE, AeroDataBox LIVE, United Fleet Site + Sheet DAILY, @martinamps tracker, AWC LIVE, Iowa State NEXRAD LIVE, CARTO/OSM TILES, FAA NAS LIVE, Route Estimation COMPUTED, r/UnitedAirlines) | ✅ / 🔁 | `views/SourcesView.tsx:38-125` — nine sources + one community card = ten, every link preserved. The Starlink tracker pill is **DAILY**, not LIVE (🔁, fixes the §35 label/class contradiction) |
| Bottom disclaimer block; `tests/compliance.test.js` requires AeroDataBox, CARTO, OpenStreetMap in the panel | ✅ | `SourcesView.tsx:182-193` — includes the safety sentence; AeroDataBox `:48-51`, CARTO + OpenStreetMap `:94-101` |

### §27 Modals

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Aircraft detail opened from popup, fleet/airborne tables, special panel, schedule rows, My Flights, Starlink rows/board, FR24 modal | ✅ | all route through `useUi().openAircraft(reg)` — `FlightSheet.tsx:368`, `FleetTable.tsx:104`, `AirborneTable.tsx:88`, `SpecialPanel.tsx:69`, `ScheduleTable` `onOpenAircraft`, `FlightCard.tsx:213`, `RosterTable`, `DeparturesBoard.tsx:56`, `Fr24LookupDialog.tsx:248` |
| `showAircraftDetail(reg)` normalize; dialog; backdrop + Escape; not-in-DB state + Planespotters | ✅ | `features/AircraftDetailDialog.tsx:51-53` `normalizeReg()` (dashes out, upper); Radix dialog; not-in-DB `:216-229`. **Three states**, not two: loading (skeleton) is distinguished from not-in-DB `:181-215` |
| `buildAircraftDetailHTML()`: header tail (jargon), type (jargon), `AC# N`, ⭐/⚡; biography grid Delivered (+age), Total Seats, WiFi, IFE, Power, Engine, Starlink, Config; status via `categorizeFleetStatus()`; Live Status block or "On ground / Not currently tracked"; seat blocks + proportional bar (labels >8 %); footer Watch / Planespotters / FlightAware registration / Share | ✅ | `AircraftDetailDialog.tsx:147-423` — eight biography facts `:237-256`, status badge `:261-282`, live block `:284-336` (`On ground / Not currently tracked` `:333`), seat bar `buildSeatBar()` from `src/lib/fleet-view.js` `:118-124`, footer `:380-422` (all four) |
| `showDelayExplanation(ctx)`: header flight, risk badge colours, `route · Score N/100`, shimmer "Analyzing delay risk…" then text + "Contributing Factors", `ctx.hubTime` from `SCHED_HUB_TZ[hub]` | ✅ | `features/DelayExplainDialog.tsx:107-166` — `{riskLabel} RISK` badge coloured by `riskLabelColor()` (`src/lib/delay-explain-request.js`), `{route} · Score {n}/100` `:120-122`, `Analyzing delay risk…` `:128`, `Contributing Factors` `:150-152`; `hubTime` computed **at open** from `HUB_TZ[hub]` `:75-79` |
| `POST /api/delay-explain` with the 12-field body (riskScore omitted when NaN — F011); reads `explanation` (textContent), `error`; footer "Powered by Claude AI" | ✅ | `buildDelayExplainBody()` `src/lib/delay-explain-request.js` owns the field set and the NaN omission; `data/api.ts:247-251`; the explanation is a React text child `:138` so returned markup renders as characters; footer `:165` |
| `lookupFR24Flight(query)` normalizes; loading card; `GET /api/fr24-flight?flight=`; **failure never blocking** | ✅ | `features/Fr24LookupDialog.tsx:95-135` — `normalizeFr24Query()`; a failure closes the dialog, announces once and leaves a dismissable line `:305-319`. **Runtime-verified** |
| `renderFR24Modal()` reads the full flight shape + `meta.{liveLeg, legDate}`; status colours; leg-date disclaimer (F048); fleet cross-reference; footer "Powered by Flightradar24 Official API (• cached)" + Share | ✅ | `Fr24LookupDialog.tsx:59-69` type; colours `fr24StatusColor()`; disclaimer `fr24LegDisclaimer(source, meta)` `:140-141` with `meta: data.meta ?? {liveLeg, legDate}` `:127` (the live endpoint puts them at the top level — reading only `meta` dropped the label); fleet match `:142-144, 265-271`; footer `fr24Attribution(cached)` `:287`; Share `:289-299`. **Runtime-verified:** `/?flight=UA1` → `UA1 LANDED · UAL1 · SFO ✈→ SIN · Aircraft: B789 • N61106 · Powered by Flightradar24 Official API · Share` |

### §28 `/api/*` contract (21 rows)

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `/api/fr24-feed` GET `?airline=UAL`; `parseFr24Feed()`; `X-BB-Feed-Stale` | ✅ | `data/api.ts:73-85` |
| `/api/flight-times` GET `?flight=` | ✅ | `data/api.ts:87-89`; shape `data/types.ts:105-118` |
| `/api/predict-flight` GET `?flight_number=` | ✅ | `data/api.ts:98-102` |
| `/api/check-flight` GET `?flight_number=&date=YYYY-MM-DD` | ✅ | `data/api.ts:105-109` |
| `/api/starlink-data` GET | ✅ | `data/api.ts:111-113`; shape `types.ts:78-84` |
| `/api/fleet-summary` GET | ✅ | `data/api.ts:115-117` |
| `/api/starlink-mismatches` GET | ✅ | `data/api.ts:131-133` |
| `/api/metar` GET `?ids=` | ✅ | `data/api.ts:136-162` — commas go on the wire raw, byte-for-byte |
| `/api/faa` GET | ✅ | `data/api.ts:164-166` |
| `/api/nas` GET | ✅ | `data/api.ts:168-170` |
| `/api/schedule` GET `?hub=&dir=&timestamp=` + `Date`/`Age` headers | ✅ | `data/api.ts:177-199` |
| `/api/irops` GET | ✅ | `data/api.ts:202-204` |
| `/api/aircraft-history` GET `?reg=` | ✅ | `data/api.ts:223-225` |
| `/api/push-subscribe` GET / POST | ✅ | `data/api.ts:228-245` |
| `/api/delay-explain` POST | ✅ | `data/api.ts:247-251` |
| `/api/waitlist` POST `{email, source:'popup', featureRequest?}` | ✅ | `data/api.ts:253-259` |
| `/api/fr24-flight` GET `?flight=` | ✅ | `data/api.ts:278-280` |
| `/api/support-stats` GET | ✅ | `data/api.ts:288-290` |
| `/data/fleet.json` static | ✅ | `data/api.ts:294-296` |
| `/data/starlink.json` static fallback | ✅ | `data/api.ts:299-301` — degraded tier |
| `/data/news-latest.json` static | ✅ | `data/api.ts:303-305` |
| Not called by the dashboard: `api/fleet.ts`, `api/tsa.ts`, `api/fr24-usage.ts`, `api/news-notify.ts`, all `api/cron/*` | ✅ / ➖ | still uncalled; `api/tsa.ts` **deleted** with the feature (➖) |

### §29 Storage keys (16 rows)

All keys verified byte-for-byte against `src/app/state/storage.ts:12-27` (`STORAGE_KEYS`), which is the single declaration point, plus a live browser session.

| key | verdict | evidence |
|---|---|---|
| `bb_home_airport` | ✅ | `storage.ts:13`; **runtime: `"DEN"`** |
| `bb_tracker_watches` (read here, written by tracker pages) | ✅ | `storage.ts:14`; read `views/weather/TrackerBriefing.tsx:41`; written `src/scripts/trackers.ts` |
| `bb_reg_ledger_v1` | ✅ | `storage.ts:15`; `state/feed.tsx:90, 117` |
| `bb_watched_flights` `[{flight, route, status, ts}]` ≤20 | ✅ | `storage.ts:16`; **runtime: `[{"flight":"UA28","route":"SIN→SFO","status":"Cruise","ts":1789437969813}]`** |
| `watchedFlights` (legacy read) | ❌ | no reader in the rebuild — gap **G1** (cosmetic; the alias only fed the METAR station widening, which the rebuild still does from `bb_watched_flights`) |
| `bb_push_prompted` `'1'` | ✅ | `storage.ts:17`; `state/watch.tsx:232` |
| `bb_sched_<hub>_<dir>_<day>` | ✅ | `src/lib/schedule-load.js:50-52` |
| `bb_tips_dismissed` epoch, 7 d | ✅ | `storage.ts:18`; `features/TipStrip.tsx:32, 74` |
| `bb-visited` `'1'` | ✅ | `storage.ts:19`; **runtime: `"1"`** |
| `bb-onboarded` `'1'` | ✅ | `storage.ts:20`; **runtime: `"1"`** |
| `bb_onboarding_dismissed` epoch, 7 d | ✅ | `storage.ts:21`; **runtime: set on dismiss** |
| `bb_waitlist_submitted` `'true'` | ✅ | `storage.ts:22`; `features/WaitlistDialog.tsx:126` |
| `bb_waitlist_dismissed` epoch, 7 d | ✅ | `storage.ts:23`; `WaitlistDialog.tsx:105` |
| `bb-bmac-dismissed` epoch, 14 d | ✅ | `storage.ts:24`; `features/BmacToast.tsx:30` |
| `news_dismissed_slug` | ✅ | `storage.ts:25`; `features/NewsBanner.tsx:86` |
| `bb_sched_preload_ts` session, 10 min | ✅ | `storage.ts:26`; `state/schedule.tsx:507, 531` |
| Every write try/catch | ✅ | `storage.ts:54-87` — every read and write wrapped (Safari private mode throws on access) |

### §30 Timers

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Clock 1 s; feed 30 s + ladder; weather 5 min; MyFlights countdown 1 s; ticker fade 5 s; tip 45 s; news 6 s; placeholder 4 s; waitlist 5 min; BMAC 3 s; fleet deep-link poll 200 ms/10 s; idle preload rIC/5 s | ✅ | clock `shell/Header.tsx:39`; feed `state/feed.tsx:39` + ladder `src/lib/feed-health.js:94`; weather `state/weather.tsx:29`; countdown `views/MyFlightsView.tsx:79-83`; ticker `shell/Ticker.tsx:27`; tip `TIP_ROTATE_MS`; news `features/NewsBanner.tsx:24`; placeholder `views/myflight/QuickAdd.tsx:18`; waitlist `TRIGGER_TIME_MS`; BMAC `state/ui.tsx:89`; fleet deep link `views/FleetView.tsx:67` (10 s budget, latched instead of polled); idle preload `state/schedule.tsx:541-552` (rIC, else 5 s) |

### §31 `src/lib/*` — exists vs still in main.js

| item (abbreviated) | verdict | evidence |
|---|---|---|
| 30 modules already imported by main.js | ✅ | all present and unchanged in `src/lib/`; imported by the React tree |
| Extract: `getPhase`, `getPhaseGroup`, `decodeSquawk`, `estimateRoute`, `haversine`, `bearing`, `angleDiff`, `greatCirclePoints`, `normalizeLonContinuity`, `isLonghaulFlight`, `createPlaneIcon` | ✅ | `src/lib/flight-phase.js` (phase, phase group, squawk, `PHASE_ICONS`), `src/lib/geo.js` (haversine/bearing/angleDiff/greatCirclePoints/normalizeLonContinuity/isLonghaul), `src/lib/route-estimate.js`, `src/lib/plane-icon.js` — each with a vitest file |
| Extract: `parseMetarQuick`, `applyStructuredMetarFallback`, `formatStructuredVisibility`, `hasRenderableMetarData`, `explainMETAR`, `explainFAAStatus`, `buildFaaIndex`, `getFAADelayContext`, NAS severity classifiers | ✅ | `src/lib/metar-explain.js`, `src/lib/faa-context.js`, `src/lib/nas-severity.js` |
| Extract: `updateHubHealth` OTP math + arbitration | ✅ | `src/lib/hub-health.js:46-122` |
| Extract: `isRecentlyFound`, `getServedConflictTails`, `formatFlightTime`, `getStarlinkAirborneMap` | ✅ | `src/lib/starlink-view.js` |
| Extract: `isSignificantStatusChange`, `getMyFlightTimeCacheTTL`, `getMyFlightCacheJitter` | ✅ | `src/lib/watch-utils.js` |
| Extract: `buildJourneyChainHtml` / `buildJourneyContextStr` | ✅ | `src/lib/journey.js` (`shapeJourney`, `journeyDelayClass`, `buildJourneyContextStr`) |
| Extract: `jargonTerm` + clamp | 🔁 | the strings live in `features/JargonTerm.tsx:23-31`; positioning is Radix's. The first-occurrence gate is a pure fold in `src/lib/weather-cards.js` (`assignJargonFirsts`) |
| Embedded data: `AIRPORTS`, `UA_ROUTES`, `IATA_CITIES`, `SPECIAL_AIRCRAFT` rules, `ENGINE_BY_TYPE`, `TIPS`, `ICAO_TO_FLEET_TYPE`, `SEV_LABELS`, `CAT_COLORS`, `SEAT_BAR_COLORS` | ✅ | `src/lib/airports.js` (AIRPORTS, AIRPORT_COORDS, IATA_CITIES, cityFor), `src/lib/route-estimate.js` (UA_ROUTES), `src/lib/special-aircraft.js`, `src/lib/tips.js`, `src/lib/equipment-swaps.js`, `src/lib/nas-severity.js`, `src/lib/weather-cards.js`, `src/lib/fleet-view.js` |
| Lib not used by the dashboard: `agent-markdown`, `agent-negotiation`, `accept-negotiation`, `site-routes`, `buildMetadata`, `starlink-facts`, `tracker-detail`, `tracker-downloads`, `tracker-map` | ✅ | all still present and still server/site-only |
| Duplication: coordinates ×3 (`AIRPORTS`, `HUB_COORDINATES`, `INTL_AIRPORTS`/`US_AIRPORTS`) | ❌→note | still three sources (`src/lib/airports.js`, `src/lib/delay-risk.js:13-23`, `src/lib/airport-metadata.js`). Carried as pre-existing tech debt, not a rebuild regression — the inventory lists it under "flag", not "port"; no behaviour differs |
| Duplication: timezones ×2 (`SCHED_HUB_TZ` vs `HUB_TZ`) | ✅ | **consolidated** — only `src/lib/hubTz.js` `HUB_TZ` remains; `SCHED_HUB_TZ` is gone |
| Duplication: 19-entry `typeOrder` ×4 | ✅ | **consolidated** — one `TYPE_ORDER` in `src/lib/analytics.js`, imported by `FleetView.tsx:26` and `StatsView.tsx:19`; the sr-only copy is generated from `src/data/fleet/index.js` |
| Duplication: hub list ×9+ | ✅ | **consolidated** — one `HUB_ORDER` in `src/lib/hub-health.js:12`, plus `WX_HUBS` for the weather stations; every consumer imports one of the two |
| Duplication: `IATA_CITIES` vs `AIRPORTS` misaligned | ❌→note | both still in `src/lib/airports.js`; pre-existing, unchanged |

### §32 `style.css` — behaviour-encoding rules

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Z-index ladder (map 0 … skip-link 100000) | 🔁 | replaced by flow order + Radix portals; only four explicit z values remain in `src/app` (map controls `z-[500]`, overlay `z-[600]`, toasts `z-[70]`/`z-[60]`), and the map wrapper is `isolate z-0` so Leaflet's 400+ panes cannot escape |
| `#map{position:fixed;inset:0;z-index:0}` + vignette | 🔁 | flex pane — `views/LiveView.tsx:155-163` |
| Leaflet overrides: attribution, marker hit-area `::after{inset:-5px}`, popup 44×44 close + `min-width:280px`, tooltip | ✅ | `src/styles/global.css`; pinned by `tests/leaflet-required-styles.test.js` (retargeted from `public/css/style.css`, `:35-36`) |
| Reduced motion | ✅ | `motion-reduce:` variants (e.g. `shell/Ticker.tsx:102`) |
| Breakpoints 500 / 600 / 768 / 900 / 769–1080 | 🔁 | Tailwind `sm/md/lg/xl` + one arbitrary `min-[1081px]` for the stat bar (`StatsBar.tsx:27`), which preserves the 769–1080 hide exactly |
| `env(safe-area-inset-*)` | ✅ | `shell/MobileNav.tsx:32` `pb-[env(safe-area-inset-bottom)]` |
| `100dvh` table heights | 🔁 | `100svh` on the shell (`Dashboard.tsx:117`), `max-h-[60svh]` on the fleet/airborne/special/roster wrappers, `max-h-[85svh]`/`[90svh]`/`[80svh]` on dialogs — `svh` avoids the mobile-chrome jump `dvh` still has |
| `#tab-schedule .card[style*="overflow:hidden"]{overflow:visible!important}` | ➖ | a workaround for an inline style the rebuild never writes |
| Sibling-selector banner stacking; hub-health mask; 44 px targets; touch scroll | ✅ / 🔁 | stacking is flow (🔁); **44 px targets are systematic** — `min-h-11` (+`min-w-11` where the control collapses to an icon) below `md:` on every interactive control, verified across Header, MapControls, HubCards, IropsSection, FleetControls, RosterControls, DeparturesBoard, WatchPanel, FlightCard, SortableHeader, sheet/dialog closes |
| Keyframes (tickerScroll, blink, pulse ×2, bounce, liveShimmer, fadeIn, ctrlPanelIn, schedRowHighlight, obFadeIn, equipFlash, shimmerSlide) | 🔁 | Tailwind `animate-pulse` + Radix enter/exit animations + `src/styles/global.css` for the row highlight; DESIGN.md's ≤200 ms rule applies |
| No print stylesheet; dark-only `color-scheme:dark` | ✅ | `components/site/BaseLayout.astro:59` `<html lang="en" class="dark" style="color-scheme:dark">` |

### §33 SEO / a11y structures to survive

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `<html lang="en" style="color-scheme:dark">` | ✅ | `BaseLayout.astro:59` |
| Hub registry comment | 🔁 | replaced by `src/data/hubs/index.js` as the single registry; the comment's stale pointers (§35) go with it |
| Meta: charset, viewport `viewport-fit=cover`, theme-color, SVG data-URI favicon, manifest, apple-touch-icon, 4 web-app metas, title, description, author, robots, 11 OG (incl. `og:image:alt`), 6 twitter, canonical, sitemap, RSS | ✅ | `components/site/Seo.astro:53-102` — every one; 11 OG `:75-86`, 7 twitter `:88-95` (one extra: `twitter:url`) |
| Resource hints: dns-prefetch unpkg/mesonet/carto c,d; preconnect carto a,b + unpkg; 3 font preloads; preload dashboard.js + style.css | 🔁 | `src/pages/index.astro:52-57` keeps the CARTO preconnects (a, b) + dns-prefetch (c, d) + mesonet; unpkg and the font/asset preloads are retired with the bundle |
| `@font-face` ×3 + critical body CSS | 🔁 | `@fontsource-variable/geist{,-mono}` imported through `src/styles/global.css` |
| Leaflet unpkg with SRI | 🔁 | bundled from npm; `unpkg.com` negatively asserted by `tests/csp.test.js:82-84` |
| Skip link | ✅ | `BaseLayout.astro:77-82` |
| `<noscript>` block: prose, 9 hub links, 4 resource links, byline | ✅ | `src/lib/home-seo.js:146-172` `NOSCRIPT_LINKS`; rendered `src/pages/index.astro:90-117` — 9 hubs, 4 resources, byline |
| Crawlable brief with the page `h1`, intro, "What you can check here" (6 `<li>`; drop the TSA one), "How to use this site" with llms/sitemap links + Accept note | ✅ | `home-seo.js:51-117` — six bullets with the TSA clause removed from the weather bullet; `index.astro:62-77`. **`<h1 id="page-brief-title">` precedes any `<header>`** — verified in `dist/index.html` (h1 at byte 4097, no `<header>` in the static HTML at all) |
| Crawlable nav 15 links | ✅ | `home-seo.js:136-144` — 9 hubs + All Hubs + Fleet + News + Trackers + ATC + United-hubs = 15 |
| sr-only fleet summary with the build-stamped Starlink string | ✅ | `home-seo.js:200-211`; figures imported from `starlink-facts.js`, not stamped into HTML |
| Six JSON-LD at end of body: Organization, WebPage, WebApplication (14-item featureList), FAQPage (8), Dataset, WebSite | ✅ | `home-seo.js:226-514`. **Verified in `dist/index.html`: exactly 6 blocks, types `Organization, WebPage, WebApplication, FAQPage, Dataset, WebSite`**, featureList 14 entries `:309-324`, FAQ 8 questions `:333-437` |
| `<main>` wraps the tab panels only | ✅ | `BaseLayout.astro:84-86` `<main id="main">` |
| Script order: dashboard.js, insights, sw-register, support-meter, JSON-LD, news-banner | 🔁 | one island bundle + `sw-register` (`index.astro:59`) + `VercelAnalytics` (`BaseLayout.astro:89`); the support meter and news banner are React components inside the island |

### §34 Init sequence

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `initApp()` ordering | 🔁 | provider tree — `Dashboard.tsx:186-204`; the comment at `:14-15` records that the order is a dependency order (hub health reads IROPS; the ticker reads fleet + weather + hub health; deep links read the feed) |
| Bootstrap guard `DOMContentLoaded` | 🔁 | `client:only="react"` (`index.astro:119`) |
| `loadFleetData()` parallel `/data/fleet.json`, `/api/starlink-data`, `/api/fleet-summary`; fallback `/data/starlink.json`; `fleetLoadFailed`; rebuilds tails/byReg/special | ✅ | `state/fleet.tsx:92-141` — `Promise.allSettled` of the three, static fallback `:120-132` with `degraded: true`, `loadFailed` only when the **airframe database** fails `:104`, indexes `:143-149` |
| `preloadWeatherAndFAA()` deduped; extra METAR stations from watched routes + boards; populates ops + FAA index | ✅ | `state/weather.tsx:116-167` — stations collected from watches + board rows through refs (so a board landing cannot refire the batch) |
| `window.*` exports (`loadScheduleData`, `escapeHtml`, `focusWatchedFlight`, `hideDisclaimer`, `schedCache`) | 🔁 | no globals; `focusWatchedFlight`'s only consumer was the `Notification` onclick, which now closes over `select({kind:'ident', ident})` directly (`state/schedule.tsx:336-340`) |

### §35 Discrepancies / dead code

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `index.html:282` claims JS legal handlers; none exist | ➖ | file deleted; the ⓘ menu is a Radix `Popover` with real handlers |
| `#sched-pagination` dead | ➖ | not ported |
| Hub registry comment points at `api/irops.js`, `public/hubs/*.html` | ➖ | comment gone with the file |
| Sources Starlink tracker "LIVE" label with `fresh-daily` class | 🔁 | resolved to **DAILY** — `views/SourcesView.tsx:12-14, 69` |
| Static hub-health tooltip omits the FAA blend legend | ➖ | no static tooltip; every chip carries a live tooltip naming the FAA program (`HubHealthStrip.tsx:99`) |
| `splitAtAntimeridian()` no-op | ➖ | not ported; `normalizeLonContinuity()` (which does the real work) is in `src/lib/geo.js` |
| `#sched-more-filters-btn` static vs JS label | ➖ | one label source — `advFilterLabel()` `src/lib/schedule-load.js:253` |
| `#myflight-empty` dangling "OR" | ✅ | the "OR" now divides two real options — `views/myflight/QuickAdd.tsx:99-106` ends with "Check a connection below, without watching either flight." |
| `#fleet-config-empty` duplicated | ➖ | one empty state — `views/fleet/SeatConfigGallery.tsx:38-57` |

---

## Inventory 2 — Site surface (`2026-09-11-inventory-site-surface.md`)

### §1.1 Route surface

Built and counted from `dist/`: **66 HTML documents, 65 `<loc>` entries** in `dist/sitemap.xml`
(`/404` is correctly excluded).

| item (abbreviated) | verdict | evidence |
|---|---|---|
| 1 × `/` (dashboard) | ✅ | `src/pages/index.astro` — replaces `public/index.html` |
| 1 × `/fleet` | ✅ | `src/pages/fleet/index.astro`; `dist/fleet.html` |
| 19 × `/fleet/{slug}` | ✅ | `src/pages/fleet/[type].astro`; 19 `<loc>` entries verified |
| 1 × `/hubs` | ✅ | `src/pages/hubs/index.astro` |
| 9 × `/hubs/{iata}` | ✅ | `src/pages/hubs/[hub].astro`; all nine in the sitemap |
| 1 × `/newark` | ✅ | `src/pages/newark.astro` |
| 1 × `/tsa` | ➖ | deleted (spec §3); `vercel.json` adds a 301 `/tsa` → `/hubs` |
| 1 × `/trackers` | ✅ | `src/pages/trackers/index.astro` |
| 2 × `/trackers/{atc,united-hubs}` | ✅ | both present |
| 7 × `/trackers/atc/{code}` | ✅ | den, ewr, iad, iah, lax, ord, sfo — GUM excluded, as `tests/tracker-seo.test.js:56-64` pins |
| 8 × `/trackers/united-hubs/{code}` | ✅ | den, ewr, gum, iad, iah, lax, ord, sfo |
| 1 × `/news` | ✅ | `src/pages/news/index.astro` |
| 13 × `/news/{slug}` | ✅ | 13 `<loc>` entries verified |
| Not in the sitemap: `/404`, `/privacy` (oversight) | 🔁 | `/404` still excluded (correct — `noindex`); **`/privacy` is now in the sitemap**, fixing the flagged oversight |
| Route guard `HTML_ROUTE_PATHS` / `HTML_ROUTE_PREFIXES`; `tests/agent-readiness.test.js:131-146` pins it against the sitemap | ✅ / ❌ | `src/lib/site-routes.js:14` = `['/', '/404', '/newark', '/privacy']` — `/tsa` removed. `ASSET_PREFIXES` still lists `/css/`, `/js/`, `/fonts/` → gap **G7** (stale, harmless) |

### §1.2 Endpoints

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `sitemap.xml.ts`; lastmod from `git log -1 --format=%cs` per route file list | ✅ | `src/pages/sitemap.xml.ts`; `src/lib/buildMetadata.js` — `tsaLastmodPaths` removed, `homeLastmodPaths` no longer names `public/index.html` (`tests/build-metadata.test.js:112-120` asserts the removal) |
| `feed.xml.ts` RSS: 13 news + 5 hardcoded static items | ✅ | `src/pages/feed.xml.ts`; `dist/feed.xml` built |
| `news-sitemap.xml.ts` 2-day window with fallback | ✅ | `src/pages/news-sitemap.xml.ts`; `dist/news-sitemap.xml` |
| `data/news-latest.json.ts` top 3; `robots.txt` disallows `/data/` | ✅ | `src/pages/data/news-latest.json.ts`; `public/robots.txt` `Disallow: /data/` |
| Tracker downloads (`atc.json/csv`, `united-hubs.json/csv`) via `tracker-downloads.js` with the cache + attachment headers | ✅ | all four `.ts` routes present; `src/pages/trackers/atc.csv.ts:1-13` shows the 10-column ATC list; `src/lib/tracker-downloads.js` unchanged |

### §1.3–§1.17 Pages

| item (abbreviated) | verdict | evidence |
|---|---|---|
| §1.3 `404.astro`: no layout, own token block, title + `noindex`, 9 hub links, 6 section links, 4 agent links pinned by `agent-readiness:89-99` | ✅ / 🔁 | now on `BaseLayout` (🔁). All four agent hrefs verbatim (`/sitemap.xml`, `/llms.txt`, `/llms-full.txt`, `/feed.xml` — `src/pages/404.astro:58-65`), 9 hub links `:44`, and **5** section links (`/fleet`, `/hubs`, `/trackers`, `/news`, `/newark`) — the sixth was `/tsa` (➖) |
| §1.4 `privacy.astro`: links `/css/style.css`, SEO without twitter/OG image/JSON-LD, "Effective June 10, 2026", Supabase/Resend/Vercel named | ✅ / 🔁 | `src/pages/privacy.astro` on `BaseLayout` — gains the full OG/Twitter set and a BreadcrumbList (verified in `dist/privacy.html`); the effective date and the three processors are unchanged |
| §1.5 `newark.astro`: no layout, dead `fonts.googleapis.com` preconnect, 6 FAQ + 7 timeline, full SEO, OG `og-hub-ewr.jpg`, BreadcrumbList + FAQPage, live panel via `newark-live.js`, links incl. `/tsa#ewr` | ✅ / 🔁 / ➖ | `src/pages/newark.astro` on `BaseLayout`; dead preconnect gone (🔁); **`dist/newark.html` carries BreadcrumbList + FAQPage** (2 blocks, as inventoried); live panel `src/scripts/newark-live.ts`; the `/tsa#ewr` `<li>` removed (➖) |
| §1.6 `tsa.astro` | ➖ | deleted |
| §1.7 `hubs/index.astro`: mono-only token block, JSON-LD ×3 (BreadcrumbList, FAQPage 4, ItemList 9), CTA, 9 hub cards (EWR extra `/newark`), 3 prose sections, visible FAQ, own inline footer | ✅ / 🔁 | `src/pages/hubs/index.astro` on `BaseLayout` with `SiteFooter` (🔁 — the divergent inline footer is gone). **`dist/hubs.html`: 3 blocks, `BreadcrumbList, FAQPage, ItemList`** |
| §1.8 `hubs/[hub].astro` → 9 pages; no null guard | ✅ | `src/pages/hubs/[hub].astro` |
| §1.9 `fleet/index.astro`: full token block, 1100 px container, JSON-LD ×4 (BreadcrumbList, Dataset, ItemList 19, FAQPage 5), hardcoded drift numbers, own footer WITH donate | ✅ / 🔁 | on `BaseLayout` (🔁). **`dist/fleet.html`: 4 blocks, `BreadcrumbList, Dataset, ItemList, FAQPage`**; the donate button survives in `SiteFooter.astro` |
| §1.10 `fleet/[type].astro` → 19 pages via `FleetTypeLayout` | ✅ | `src/pages/fleet/[type].astro` |
| §1.11 `news/index.astro`: featured + grid, empty-state branch, BreadcrumbList only | ✅ | **`dist/news.html`: 1 block, `BreadcrumbList`** |
| §1.12 `news/[slug].astro` → 13 pages, `Astro.redirect('/404')` guard | ✅ | `src/pages/news/[slug].astro` |
| §1.13 `trackers/index.astro`: BreadcrumbList + ItemList, two tracker cards with segmented bars, changelog, LastUpdated | ✅ | **`dist/trackers.html`: 2 blocks, `BreadcrumbList, ItemList`** |
| §1.14 `trackers/atc.astro`: 89 airports, map + off-map list, legend, sorted rows, 6 columns, 4 stats, 5 FAQ, computed OG, JSON-LD ×3 with CSV+JSON DataDownload, 9 components, `data-trk-page="atc"`, anchors | ✅ | **`dist/trackers/atc.html`: 3 blocks, `BreadcrumbList, FAQPage, Dataset`**; `tests/tracker-data.test.js` pins `atcAirports.length === 89`; client script `src/scripts/trackers.ts` |
| §1.15 `trackers/united-hubs.astro`: same shape, activity-ranked hub order, hand-written per-hub prose, hardcoded club math | ✅ | **`dist/trackers/united-hubs.html`: 3 blocks, `BreadcrumbList, FAQPage, Dataset`** |
| §1.16 `trackers/atc/[code].astro` → 7 pages; Article + Dataset + FAQPage + layout BreadcrumbList | ✅ | **`dist/trackers/atc/ord.html`: 4 blocks, `BreadcrumbList, Article, Dataset, FAQPage`** |
| §1.17 `trackers/united-hubs/[code].astro` → 8 pages; Article + ItemList + FAQPage | ✅ | **`dist/trackers/united-hubs/ord.html`: 4 blocks, `BreadcrumbList, Article, ItemList, FAQPage`** |

### §2 Layouts and components

| item (abbreviated) | verdict | evidence |
|---|---|---|
| §2.1 `HubLayout.astro`: `data.variant` full/compact, full head + per-hub OG, JSON-LD ×3 (BreadcrumbList, FAQPage, **Airport** with icaoCode/PostalAddress/GeoCoordinates), `<body data-hub-iata>`, breadcrumb, headerTitle, live panel + CTA, scroll hint, jump nav, `contentHtml`, TSA box, tracker box, hub nav, footer, analytics, two scripts | ✅ / ➖ | `src/layouts/HubLayout.astro` — Airport schema `:28-51`, FAQPage `:53`, BreadcrumbList from `BaseLayout`/`Breadcrumbs`; **`dist/hubs/ord.html`: `BreadcrumbList, FAQPage, Airport`**; `data-hub-iata` `:84`; `contentHtml` `:142`; tracker box `:152-156`; scripts `:174-175` (`src/scripts/hub-live.ts`, `scroll-hint.ts`). **TSA cross-link box deleted** (➖) |
| §2.2 `FleetTypeLayout.astro`: imports `fleet.json` at build, registry table, JSON-LD ×3 incl. **AboutPage** with 10 PropertyValue specs, 4 stat cards, CTA, jump nav, `contentHtml`, spec + registry tables, FAQ, fleet nav | ✅ | `src/layouts/FleetTypeLayout.astro:14` build import; AboutPage `:28` with **10** PropertyValue rows `:42-51`; **`dist/fleet/737-800.html`: `BreadcrumbList, FAQPage, AboutPage`** |
| §2.3 `NewsLayout.astro`: `resolveTag()` cross-links, `og:type=article`, `article:published_time`, `article:section`, JSON-LD BreadcrumbList + **NewsArticle** with publisher `@id`, body, Sources, Related pills, buymeacoffee CTA, **Blue Board Pro waitlist teaser → `/?waitlist=1`**, back link | ✅ | `src/layouts/NewsLayout.astro:15` cross-links, `:29` NewsArticle, `:59-60` article meta, `:132` BMAC, `:142-143` `/?waitlist=1` teaser; **`dist/news/…html`: `BreadcrumbList, NewsArticle`** |
| §2.4 `Footer.astro` (14 lines) used by 11 files, not by 404/hubs-index/fleet-index | 🔁 / ❌ | replaced by `components/site/SiteFooter.astro`, now used by **every** page through `BaseLayout` — the three divergent inline footers are gone and the disclaimer + FR24/AWC/FAA credits + donate + byline are all preserved (`SiteFooter.astro:10-64`). The old `Footer.astro` survives as a **dead shim** → gap **G2** |
| §2.5 `VercelAnalytics.astro`: `is:inline` load-bearing; mounted in 14 files; `tests/web-analytics-integration.test.js:33-57` hardcodes the list | ✅ / ❌ | `is:inline` preserved (`src/components/VercelAnalytics.astro:8`); mounted once, in `BaseLayout.astro:89`, so every page gets it; test retargeted (`tests/web-analytics-integration.test.js:77`). The file's comment still names `public/index.html` → gap **G5** |
| §2.6 `src/components/trackers/*` (12 files + client hooks) | ✅ | 12 `.astro` components present (plus `detail.ts` and `tones.ts`): `TrackerDetailLayout`, `TrackerMap`, `TrackerTable`, `TrackerSearch`, `TrackerPulse`, `SourceDisclosure`, `StatusBadge`, `StatStrip`, `Changelog`, `LastUpdated`, `CrossLink`, `TrackerDataActions`. Every `data-trk-*` hook still present and driven by `src/scripts/trackers.ts` |

### §3 Shared styling

| item (abbreviated) | verdict | evidence |
|---|---|---|
| §3.1 Two delivery strategies (14 inline blocks + 3 `<link href="/css/style.css">`) | 🔁 | one `src/styles/global.css` imported by `BaseLayout.astro:14`; `public/css/` deleted; `tests/leaflet-required-styles.test.js:35-36` retargeted |
| §3.2 Fonts `public/fonts/*.woff2`, CSP `font-src 'self'` | 🔁 | `@fontsource-variable/geist{,-mono}` bundled under `_astro/`, so `font-src 'self'` still holds; `public/fonts/` deleted |
| §3.3 Canonical `--ua-*` tokens; `--ua-dim` stale in six blocks | 🔁 | shadcn/`radix-nova` tokens; the drift is moot. `--bb-warn`/`--bb-ok` remain in `src/styles/content.css` for the prose pages (ledger: deferred consolidation, cosmetic) |

### §4 Build pipeline

| item (abbreviated) | verdict | evidence |
|---|---|---|
| §4.1 scripts: `dev`, `build` (5 steps), `test`, `typecheck`, `ui-audit`; `vercel.json` buildCommand/outputDirectory; Node 24.x, bun 1.3.14 | ✅ / 🔁 | `package.json:14-22` — `dev: astro dev` (🔁, `run-astro-dev.mjs` retired), `build: refresh-starlink-facts && astro build && stamp-seo-build-date && build-agent-markdown && verify-csp-hashes` (🔁, the vite step is gone and the CSP guard is new), `test`/`typecheck`/`ui-audit` unchanged; `vercel.json` `buildCommand: bun run build`, `outputDirectory: dist`; `engines.node: 24.x`, `packageManager: bun@1.3.14` |
| §4.2.1 `refresh-starlink-facts.mjs` → `starlink-live.json`, never fails the build | ✅ | `scripts/refresh-starlink-facts.mjs`; `src/data/starlink-live.json` present with `source`/`live` blocks |
| §4.2.2 `vite build --config vite.dashboard.config.js` | 🔁 | removed; `vite.dashboard.config.js` deleted |
| §4.2.3 `astro build` → `dist/` with `build.format:'file'`; data validators fail at import | ✅ | `astro.config.mjs:7-9`; `dist/fleet.html` etc. confirm the file format |
| §4.2.4 `stamp-seo-build-date.mjs` hard-fail | 🔁 | now covers only `dist/llms.txt` + `dist/llms-full.txt`, still throwing on a missing source string (`scripts/stamp-seo-build-date.mjs:29-31`) |
| §4.2.5 `build-agent-markdown.mjs` → `dist/_agent/{home,fleet,hubs,news,trackers}.md` | ✅ | all five present in `dist/_agent/` |
| §4.3 `run-astro-dev.mjs` stamps `__HOME_LASTMOD__` into tracked `public/index.html` | 🔁 | retired with the placeholder (spec §2.1) |
| §4.4 `middleware.ts` matcher + `resolveAgentResponse()` html / markdown-asset / markdown 404 / 406; throws degrade to `next()` | ✅ / ❌ | `middleware.ts:30-31` matcher intact and behaviour unchanged; the `css/`, `js/`, `fonts/` exclusions are stale → gap **G7** |
| §4.5 "What breaks if `public/index.html` is replaced" (11 numbered risks) | ✅ | every one closed: (1)(2) stamping no longer touches the HTML; (3) `run-astro-dev` retired; (4) `homeLastmodPaths` updated + asserted; (5) `sw.js` precaches `/` only; (6) `/index.html` + `/` no-store rules intact in `vercel.json`, `tests/asset-cache.test.js` still pins them; (7) `site-routes.js` keeps `/`, `agent-markdown.js:192, 214` maps `/` → `/_agent/home.md`; (8)(9) all five tests retargeted to `src/pages/index.astro` / `dist/` / `src/app` — none deleted; (10) CSP has no `unsafe-inline`/nonce, `csp.test.js:40-51` still blocks re-adding; (11) `build.format:'file'` unchanged and `sw.js:72` still uses the `.html` heuristic |
| §4.6 `_agent/` twins + hand-maintained llms files; headings pinned by `agent-readiness:259-271` | ✅ | `dist/_agent/*.md` ×5; `public/llms.txt` (12,606 B) and `llms-full.txt` present and stamped into `dist/` |
| §4.7 `ui-audit.mjs` PAGES (17 routes, 3 viewports, Playwright + axe) | ✅ | `scripts/ui-audit.mjs:9-27` — 17 routes; `/tsa` was never in the list |
| §4.8 `generate-og.py`, `generate-maskable-icons.py`, `seed-schedules.mjs` hand-run | ✅ | all three in `scripts/` |

### §5 Vercel config

| item (abbreviated) | verdict | evidence |
|---|---|---|
| Redirects: www→apex (2), favicon, 4 apple-touch-icon | ✅ | `vercel.json:3-25` — all seven, plus the new `/tsa` → `/hubs` 301 |
| Global headers: X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, `Vary: Accept, Accept-Encoding`, HSTS preload, CSP | ✅ | `vercel.json` `/(.*)` block — all seven present |
| CSP directives (default/script/style/font/img/connect/frame-ancestors) | ✅ / 🔁 | unchanged except `script-src` (unpkg → 2 sha256 tokens) and `style-src` (unpkg dropped); `img-src` and `connect-src` allowlists byte-identical |
| `/api/(.*)`: ACAO, expose `X-BB-Feed-Stale`, `X-Robots-Tag` | ✅ | present verbatim |
| Cache-Control rules (`/index.html`, `/`, `/_agent/`, `/og-image.png`, `/hubs/`, `/trackers/`, `/news/`, `/data/*.json`, `/_astro/` immutable, `/tsa`, `/css/`, `/js/`) + the noted gaps `/fleet/*`, `/newark`, `/privacy`, `/fonts/*`, `/icons/*`, `/og/*` | ✅ / 🔁 | all retained; `/tsa` removed (➖); `/css/` + `/js/` removed (🔁 — no such assets); **three of the six documented gaps closed**: `/fleet/(.*)`, `/icons/(.*)` and `/og/(.*)` now have rules. `/newark` and `/privacy` still uncovered (pre-existing, unchanged) |
| Functions maxDuration: 20 entries (incl. tsa 30, refresh-tsa 30) | ✅ | 18 entries — exactly the 20 minus the two TSA ones |
| Crons: warm-schedules `0 * * * *`, sync-starlink `0 */4 * * *`, refresh-tsa, refresh-metar `*/5`, watch-alerts `*/5` | ✅ | four crons; `refresh-tsa` removed (➖); `tests/warm-config.test.js` still pins the hourly warm |

### §6 Tests that pin HTML/site structure

Verified: **133 test files**, none deleted except the two TSA suites (by design). Every assertion
listed in the inventory was retargeted rather than weakened.

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `agent-readiness.test.js` (352 lines): h1-before-header, >3000 chars, sr-only brief with `1,078`, 404 hrefs, sitemap ↔ routes, junk 404s, trailing slash, agent asset paths, build script, robots, Vary, middleware strings, matcher lists, llms headings, Organization JSON-LD, **≥6 parseable JSON-LD blocks** | ✅ | reads `src/pages/index.astro` (`:83, 103`) and `dist/`; the ≥6 assertion holds — `dist/index.html` has exactly 6 parseable blocks; `:361` now asserts the source carries **no** Starlink figure |
| `csp.test.js` (104): per-directive, `style-src` must keep `'unsafe-inline'`, unpkg, no vitals, zero inline scripts / `on*=` | ✅ | `:40-51` (no `unsafe-inline` + sha256 shape), `:68-73` (style-src), `:77-84` (**unpkg now negatively asserted**), `:115-120` retargeted to authored markup |
| `asset-cache.test.js`: `/js/`, `/css/` max-age, `/` + `/index.html` no-store, `/trackers/`, `/_astro/` immutable, refresh-tsa cron | ✅ | `:42` documents the `/js/` + `/css/` retirement; the no-store, trackers and `_astro` immutable assertions stand; the TSA cron describe deleted |
| `web-analytics-integration.test.js`: exact component string, insights once, no analytics deps in main.js, 14 entrypoints, no speed-insights | ✅ | `:77` records the homepage move; the entrypoint list now checks `BaseLayout` |
| `compliance.test.js`: AeroDataBox ≥2×, never "Schedule data via Flightradar24", never `attributionControl:false`, OpenStreetMap, Sources panel contents | ✅ | `:14-15` retargeted to `src/app`; the Sources panel assertions map onto `views/SourcesView.tsx` |
| `leaflet-required-styles.test.js`: 9 Leaflet classes, `#legal-details` right ≥52 px, hit-slop | ✅ | `:35-36` reads `src/styles/global.css`; the rule was **strengthened** with an `src/app` scan for `fixed + bottom + right ≤12` (ledger, Task 2 fix #6) |
| `sw.test.js` (323) | ✅ | retargeted to the `_astro` strategy; `public/sw.js` behaviour verified above |
| `build-metadata.test.js`: `homeLastmodPaths` contents, literal page/layout paths | ✅ | `:112-120` asserts `public/index.html` is **gone** from the list; layout paths unchanged (the ledger forbade renaming them) |
| `fleet-consistency.test.js`: per-type counts sum to the prose figure | ✅ | retargeted; `dist/index.html` carries `1,078` twice |
| `tracker-seo`, `tracker-data` (89), `tracker-map`, `basemap`, `api-esm-json-imports`, `vercel-build-compat`, `warm-config`, `news-data`, `starlink-facts`, `popup-triggers`, `fleet-tab` | ✅ | all present; `basemap.test.js` now pins `src/app/map/basemap.ts`; `popup-triggers` still covers the 30-click threshold, the session guard, `bb_waitlist_submitted`, the 7-day TTL, `?waitlist=1` and `bb-onboarded` |

### §7 PWA

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `public/sw.js` (223): version, caches, precache, activate, fetch strategies, push, notificationclick, registered from index only | ✅ / 🔁 | see §15 above — v11, `['/']` precache, `/_astro/` cache-first replacing `/js/` + `/css/style.css`; registered from `src/scripts/sw-register.ts` via `index.astro:59` |
| `public/manifest.json`: id `/`, standalone, `#0a0e14`, 4 icons, linked only from index | ✅ / 🔁 | colours now `#0B1018` (🔁); linked from `Seo.astro:64`, so every page references it |
| `tests/sw.test.js`: isCacheable/isHtmlResponse, trimCache, activate, push, notificationclick, fetch strategy (`support-meter.js` + `style.css` FRESH, icon CACHED, unpkg never respondWith) | 🔁 | the freshness cases retarget to `_astro` (those two files no longer exist); `isCacheable`, `trimCache`, activate, push, notificationclick and the cross-origin pass-through are unchanged |

### §8 Public assets

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `index.html`, `css/style.css`, `js/dashboard.js`, `js/*.js` page scripts, `fonts/*` ×3 | 🔁 | all deleted; `git ls-files public/js public/css public/fonts legacy src/dashboard` is **empty**. The page scripts live in `src/scripts/` (`trackers.ts`, `hub-live.ts`, `newark-live.ts`, `scroll-hint.ts`, `sw-register.ts`) and bundle into `_astro/` |
| `data/fleet.json`, `data/starlink.json`, `og-image.png`, `og/*.jpg` ×15, icons ×4, `favicon.svg`, `manifest.json`, `sw.js`, `robots.txt`, `llms.txt`, `llms-full.txt` | ✅ | all present — `public/og/` has exactly 15 `.jpg` files, `public/icons/` exactly 4 PNGs; `robots.txt` keeps the three Disallows and the 17 AI user-agents |

### §9 Docs constraints

| item (abbreviated) | verdict | evidence |
|---|---|---|
| `CLAUDE.md`: read DESIGN.md first; `bun run test` never bare `bun test`; typecheck + build before PR | ✅ | `CLAUDE.md` rewritten for the new architecture and keeps all three rules |
| `DESIGN.md` hard rules (no `--ua-blue` text, amber discipline, status never colour-alone, no hero images/glassmorphism/shadows/Inter, animations ≤200 ms, 600 px breakpoint, 44 px targets, 900 px container, dark-only) | ✅ / ❌ | `DESIGN.md` rewritten for the shadcn system (spec §2.4). The behavioural rules are honoured — status never colour-alone (§17 evidence above), 44 px targets systematic, dark-only. Stale `unpkg` prose → gap **G6** |
| `MAINTENANCE.md`: hand-sync list, 89-airport pin, new-route checklist (9 steps) | ✅ | updated — step 6 explicitly states "There is no `public/index.html` any more; the homepage's crawlable nav is generated from `src/lib/home-seo.js`" (`MAINTENANCE.md:115-117`) |
| `TODOS.md` | ❌ | four entries still name deleted files → gap **G4** |
| CI `.github/workflows/test.yml`: typecheck → test → build (bun 1.3.14, frozen lockfile); `post-deploy-smoke.yml` | ✅ | `.github/workflows/test.yml` — Node 24, bun 1.3.14, `--frozen-lockfile`, then `typecheck`, `test`, `build` |
| Secrets: `VITE_CARTO_BASEMAP_KEY` never committed; CARTO + OSM attribution visible | ✅ | key read from `import.meta.env` only (`src/app/map/basemap.ts:23`); `.env.example` documents it; attribution on both maps + the Sources panel + the attribution strip |

### Loose ends

| item (abbreviated) | verdict | evidence |
|---|---|---|
| 1. `/privacy` absent from the sitemap | 🔁 | **fixed** — 65 `<loc>` entries include `/privacy` |
| 2. Three footers + 404's one-liner | 🔁 | **fixed** — one `SiteFooter.astro` everywhere |
| 3. Two hub orderings | ✅ | unchanged (`src/data/hubs/index.js` vs the activity-ranked list in `trackers/united-hubs.astro`); deliberate, content-driven |
| 4. `contentHtml` raw HTML strings in 28 data files | ✅ | unchanged by design — `set:html` in `HubLayout.astro:142` and `FleetTypeLayout.astro:139` |
| 5. JSON-LD emitted two ways (raw vs `set:html`) | 🔁 | **fixed** — one `components/site/JsonLd.astro`, fed by `BaseLayout`'s `jsonLd` prop |
| 6. `og-image.png` 420 KB | ✅ | unchanged (now cached 86400 by the `/og/(.*)` and `/og-image.png` rules) |
| 7. hubs/index and 404 define incomplete token sets | 🔁 | **fixed** — both on `BaseLayout` |

---

## Inventory 3 — TSA removal (`2026-09-11-inventory-tsa-removal.md`)

A repo-wide case-insensitive sweep (`git grep -ilE 'tsa|mytsa|precheck|checkpoint'`, excluding
`CHANGELOG.md`, `docs/` and `.superpowers/`) returns **10 files**, every one of which is on the
inventory's keep list or a documented false positive:
`api/nas.ts` + `tests/nas.test.js` + `tests/fixtures/faa-enroute-events.json` (`departsAny`
contains `tsA` — §6 "False positives"), `sql/006_waitlist_checks.sql` (§8 LEAVE),
`src/data/hubs/den.js` + `src/data/trackers/united-hubs.js` (§5 KEEP — general construction
news), `src/lib/home-seo.js` + `tests/home-seo.test.js` (comments recording the removal),
`vercel.json` (the new 301), `bun.lock`.

### §1 API handlers and helpers

| item | verdict | evidence |
|---|---|---|
| `api/tsa.ts` delete-file | ➖ | absent from `api/` |
| `api/cron/refresh-tsa.ts` delete-file | ➖ | `api/cron/` holds only refresh-metar, sync-starlink, warm-schedules, watch-alerts |
| `api/waitlist.ts:20` comment | ➖ | `api/waitlist.ts:20-22` now reads "Existing callers: 'popup' (main.js waitlist modal)…" |
| `api/waitlist.ts:31` `'tsa-page'` in `VALID_SOURCES` | ➖ | `VALID_SOURCES` = `popup, hero, footer, news, hub` — no `tsa-page` |
| `api/_email-footer.ts:5` comment | ➖ | no TSA reference remains |

### §2 `vercel.json`

| item | verdict | evidence |
|---|---|---|
| `"api/tsa.ts"` maxDuration | ➖ | absent; 18 function entries |
| `"api/cron/refresh-tsa.ts"` maxDuration | ➖ | absent |
| cron `/api/cron/refresh-tsa` | ➖ | four crons, none TSA |
| `/tsa` Cache-Control block | ➖ | absent |

### §3 Astro pages / layouts / components

| item | verdict | evidence |
|---|---|---|
| `src/pages/tsa.astro` delete-file | ➖ | absent; `dist/tsa.html` absent |
| `src/data/tsa/united-terminals.js` delete-file | ➖ | `src/data/` holds facts, fleet, hubs, news, trackers, starlink-* only |
| `HubLayout.astro:273-277` TSA cross-link box | ➖ | absent; only the tracker box remains (`:152-156`) |
| `CrossLink.astro:2` comment | ➖ | `:2` now reads "Amber highlight-box cross-link — same idiom as the hub pages' cross-links." |
| `VercelAnalytics.astro:2` comment listing "tsa" | ➖ | the list is "(fleet, hubs, trackers, news, 404, …)" — no tsa |
| `agent-markdown.js:32` HOME prose | ➖ | `grep -i tsa src/lib/agent-markdown.js` → none |
| `agent-markdown.js:67` table row `/tsa` | ➖ | none |
| `agent-markdown.js:101` freshness row | ➖ | none |
| `buildMetadata.js:94-97` `tsaLastmodPaths` | ➖ | none |
| `site-routes.js:14` `'/tsa'` | ➖ | `HTML_ROUTE_PATHS = ['/', '/404', '/newark', '/privacy']` |
| `404.astro:54` link | ➖ | five section links, no `/tsa` |
| `newark.astro:281` `<li>` `/tsa#ewr` | ➖ | `grep -i tsa src/pages/newark.astro` → none |
| `privacy.astro:56` example | ➖ | none |
| `sitemap.xml.ts:16,53` import + renderUrl | ➖ | 65 `<loc>` entries, no `/tsa` |
| `public/og/` none TSA-specific | ✅ | 15 `.jpg` files, none TSA |

### §4 Dashboard

| item | verdict | evidence |
|---|---|---|
| `public/index.html:176` brief `<li>` | ➖ | the weather bullet in `src/lib/home-seo.js:95-100` covers the Weather tab with the TSA clause removed; the comment at `:46-49` records it |
| `src/dashboard/main.js` clean | ➖ | file deleted |
| `public/js/tsa-gate.js` delete-file | ➖ | `public/js/` untracked and empty |
| `public/css/style.css` clean | ➖ | file deleted |

### §5 Data — keep general content

| item | verdict | evidence |
|---|---|---|
| `src/data/hubs/den.js:75` "East Security Checkpoint opened in August 2025" — KEEP | ✅ | present |
| `src/data/trackers/united-hubs.js:254,352,355` SFO/DEN checkpoint construction + tsa.gov citation — KEEP | ✅ | present |
| `src/data/news/*` zero TSA mentions | ✅ | sweep confirms |
| `src/data/facts.js` clean | ✅ | sweep confirms |

### §6 Tests

| item | verdict | evidence |
|---|---|---|
| `tests/tsa.test.js` delete-file | ➖ | absent |
| `tests/refresh-tsa.test.js` delete-file | ➖ | absent |
| `asset-cache.test.js:49-56` TSA cron describe | ➖ | absent |
| `agent-readiness.test.js:124` `/tsa` in the real-page list | ➖ | absent |
| `agent-readiness.test.js:170` `/tsa` → null asset path | ➖ | absent |
| `web-analytics-integration.test.js:10,44` comment + entrypoint | ➖ | absent |
| False positives (`departsAny` `tsA`) | ✅ | `api/nas.ts`, `tests/nas.test.js`, fixture — untouched, as instructed |

### §7 Scripts, docs, llms

| item | verdict | evidence |
|---|---|---|
| `scripts/*` clean | ✅ | sweep confirms |
| `README.md:106,233` cron diagram + file tree | ➖ | no TSA match in `README.md` |
| `TODOS.md:28` `[tsa] Surface feedDown…` | ➖ | removed (the four *other* stale entries are gap **G4**) |
| `docs/HANDOFF.md:16`, `docs/reviews/…` historical — leave | ✅ | untouched |
| `public/llms.txt:27,44`, `llms-full.txt:40,57` | ➖ | no TSA match in either file |
| `public/robots.txt`, `.env.example`, `middleware.ts` clean | ✅ | sweep confirms |

### §8 SQL

| item | verdict | evidence |
|---|---|---|
| `sql/006_waitlist_checks.sql:26-27,44` `'tsa-page'` — applied migration, LEAVE | ✅ | untouched, as instructed. Dropping it from `api/waitlist.ts` is safe independently, and that is what happened |

### §9 PR #247

| item | verdict | evidence |
|---|---|---|
| No reference in the repo | ✅ | still none |

### Deletion order (8 steps)

| item | verdict | evidence |
|---|---|---|
| 1–7 (the ordered deletions and edits) | ➖ | all landed in one Task 11 commit (`b455f66`, 22 files: 7 deletions, 15 edits); merged `bfea262` with typecheck 0, tests 2257/2257, build 0, `dist/tsa.html` absent |
| 8. Add a 301 `/tsa` → `/hubs` | ✅ | `vercel.json:24` `{ "source": "/tsa", "destination": "/hubs", "permanent": true }` |

---

## Spot-checks performed

### Runtime / browser

`bunx astro dev --port 4333` (the `/api` proxy to production is configured in
`astro.config.mjs`), driven by the gstack headless browser. One schedule board was loaded
deliberately — the dev proxy spends real AeroDataBox units.

| # | Check | Result |
|---|---|---|
| R1 | Cold load of `/` | 200. Island mounts; **546 flights** in the feed; all eight tabs present (`🎫My Flights, 📡Live Ops, 📅Schedule, ✈️Fleet, 🛰️Starlink, 🌦Delays · Weather · Hubs, 📊Stats, ℹ️Sources`); page `h1` = "The Blue Board — United Airlines Flight Tracker and Live Ope…" |
| R2 | Hub-health strip severity glyphs | `▲ORD58% ●DEN74% ●IAH87% ●EWR84% ●SFO92% ●IAD76% ▲LAX67% ○NRT— ○GUM—` — nine hubs in `HUB_ORDER`, every severity paired with a glyph (never colour alone), `—` for a hub with no reading |
| R3 | `localStorage.bb_home_airport = 'DEN'` → reload | Header shows `🏠 DEN`; hub strip shows `🏠●DEN74%`; Schedule tab's hub select pre-selects `DEN — Denver`; onboarding's picker pre-selects `DEN — Denver`. **Home hub drives all three surfaces (§1).** |
| R4 | Onboarding overlay (fresh profile) | Screenshot `qa-schedule-den.png`: all six feature rows with verbatim copy, the home-hub select, "Built by a United flyer, for United flyers. Not affiliated with United Airlines.", and "Let's Fly the Friendly Skies ✈️". Behind it: the live map with markers, the hub-traffic sidebar, the nine-stat bar and the attribution strip |
| R5 | Dismiss onboarding → storage | `bb-onboarded="1"`, `bb_onboarding_dismissed` set, `bb-visited="1"`, `bb_home_airport="DEN"` — **all four keys byte-for-byte per §29** |
| R6 | `/?tab=schedule&hub=ord` | Hash rewritten to `#schedule`, hub select `ORD — Chicago O'Hare`, **660 rows**. Headers exactly the ten §20 columns with sort affordances: `Time↑ Flight↕ Route↕ Aircraft↕ Reg↕ Term / Gate Status↕ Delay / Risk Fleet 👁️Watch`. NOW divider rendered as `── NOW · 21:04 CDT ──`. Footer verbatim: `Schedule data via AeroDataBox · United flights only · All times ORD local (CDT)`. Stat strip `UA DEP · MON, SEP 14`, six cards. Screenshot `qa-schedule-ord.png` |
| R7 | `/?tab=irops` | Resolves to the Weather tab (`#weather`), `#irops-section` mounted and in view at the top of the scroll panel. Server path rendering: `IROPS SIGNIFICANT DISRUPTION ? 95 CANCELLATIONS 712 >30M 258 >60M 0 DIVERSIONS 2838 TOTAL FLIGHTS` — all five §24 metrics in order |
| R8 | ⌘K palette | `metaKey+k` on `window` opens the dialog. Placeholder `UA1234, N12345, or ORD-DEN…`; cold empty state `Type a flight number, tail number, or route.` |
| R9 | `/?flight=UA1` (not airborne) | Latches after the feed answers, finds no match, opens the FR24 lookup: `UA1 · LANDED · UAL1 · SFO ✈→ SIN · Aircraft: B789 • N61106 · Dep Actual 11:32 PM PDT · Arr Est 03:32 PM PDT · Powered by Flightradar24 Official API · Share`. `?flight=UA1` preserved in the URL. Screenshot `qa-flight-ua1.png` |
| R10 | Watch a live flight → `bb_watched_flights` | Sidebar search `UA` → first result `UA28 SIN→SFO N61103` → flight sheet → `👁️ Watch`. Storage: `[{"flight":"UA28","route":"SIN→SFO","status":"Cruise","ts":1789437969813}]` — **exactly the `[{flight, route, status, ts}]` §29 contract** |

Screenshots: `…/scratchpad/qa-schedule-den.png`, `qa-schedule-ord.png`, `qa-flight-ua1.png`.

### Build / static

| # | Check | Result |
|---|---|---|
| S1 | `dist/index.html` JSON-LD | Exactly **6** parseable `application/ld+json` blocks: `Organization, WebPage, WebApplication, FAQPage, Dataset, WebSite` — satisfies `agent-readiness`'s ≥6 assertion |
| S2 | `dist/index.html` h1 ordering | `id="page-brief-title"` at byte 4097; **no `<header>` element in the static HTML at all** (the island is `client:only`), so the §33 ordering rule holds by construction |
| S3 | `dist/index.html` fleet figure | `1,078` appears twice (brief + fleet summary) |
| S4 | Starlink stamping | `public/llms.txt:91` = `425+ United aircraft (as of mid-2026)`; `dist/llms.txt:91` = the stamped live figures. `src/data/starlink-live.json` `source` block matches the committed source strings exactly — the hard-fail guard is live |
| S5 | JSON-LD per route | Every page matches the inventory's counts and types (hubs 3, fleet-type 3, news 2, hubs-index 3, fleet-index 4, trackers 2, atc 3, united-hubs 3, atc detail 4, united-hubs detail 4, news index 1, newark 2). `/privacy` gained a BreadcrumbList (1) |
| S6 | Sitemap | 65 `<loc>`, 66 built HTML documents; `/tsa` gone, `/privacy` added, `/404` correctly excluded |
| S7 | CSP guard | `bun scripts/verify-csp-hashes.mjs` → *"2 inline script(s) all allowed by script-src"* — two sha256 tokens in `vercel.json`, two inline scripts in `dist/`, none dead |
| S8 | Legacy tree | `git ls-files public/js public/css public/fonts legacy src/dashboard` → **empty**. Nothing untracked survives either — `ls public/js public/css public/fonts legacy src/dashboard` reports all five absent on this working copy. |
| S9 | `.superpowers/` untracked | `git ls-files .superpowers` → **empty**; `.gitignore` line 6 carries `.superpowers/`. The controller's pre-PR check is satisfied |
| S10 | TSA sweep | `git grep -ilE 'tsa\|mytsa\|precheck\|checkpoint'` → 10 files, all keep-list or documented false positives (listed above) |
| S11 | Copy strings | 40 verbatim strings from §2/§6/§10/§11/§12/§13/§19/§20/§21/§22/§24/§26/§27 grepped against `src/`. **36 exact hits.** The four non-hits resolve as: "Let's Fly the Friendly Skies" (present as `Let&rsquo;s`), "🔍 No flights match your filters" (present, with 🔍 split into an `aria-hidden` glyph), "All systems normal — tracking" (present as `✅ All systems normal` + ` — tracking ${total} United flights`), "Load schedule data for hub health" (replaced by skeletons + `—` + a "No on-time reading yet" tooltip — see the §3 note) |
| S12 | Storage-key sweep | `grep -rhoE "'bb[_-][a-zA-Z0-9_-]+'\|'watchedFlights'\|'news_dismissed_slug'" src/` → every §29 key present byte-for-byte except `watchedFlights` (gap **G1**), plus one new key `bb_tracker_seen_` (tracker pages) |
| S13 | `HUB_PROXIMITY_NM` units | `git show 06b77a7:src/dashboard/main.js` lines 912-918 — legacy `haversine()` uses `R = 3440.065` (**nautical miles**), so `< 93` was 93 NM. `src/lib/live-filters.js:55` compares `haversineNm(...) < 93`. **Byte-for-byte faithful**; the inventory's "93 km" and the legacy `// ~50nm` comment are both wrong |
| S14 | Gates | Not re-run here (the controller owns them). The ledger records the post-merge state at `9706d5e`: typecheck 0, tests 2380/2380 across 133 files, build 0, CSP guard 2 allowed, version 1.8.0 |

---

## Conclusion

Every user-facing feature in the three inventories is present in the rebuild or changed under an
explicit ruling. All seven gaps (**G1–G7**) are dead code, stale documentation, or a cosmetic
storage fallback; none changes what a visitor sees and none loses stored data. The TSA
removal is complete and clean: nothing remains but the keep-list content, the applied SQL
migration, the documented `departsAny` false positives, and the new 301.

**Nothing in this audit blocks the PR.** The nearest thing to a behavioural item is **G1**, and
it costs only a handful of extra METAR cards for a profile that predates the `bb_watched_flights`
rename. Two inventory entries are themselves wrong and should not be read as gaps in review:
§18's hub-proximity threshold is **93 NM, not 93 km** (spot-check **S13** — the legacy
`haversine()` used `R = 3440.065`, so the port is byte-for-byte faithful), and §3's
"Load schedule data for hub health" empty state was replaced by skeletons plus a
"No on-time reading yet" tooltip under a Task 4 ruling (spot-check **S11**).

---

## Resolution (Sep 14 2026, after the audit)

All seven gaps were closed on `feat/shadcn-rebuild` before the PR was opened:

| # | Fix | Commit |
|---|---|---|
| G1 | `watchedFlights` read as a fallback in the weather preload, exactly as legacy (`legacyWatchedRoutes()` in `src/lib/weather-cards.js`; key recorded as `STORAGE_KEYS.legacyWatchedFlights`, read-only) | b652f75 |
| G2 | `src/components/Footer.astro` deleted | b07bdce |
| G3 | "⚡ Served from cache · N UA flights" restored (`boardLoadMessage()` in `src/lib/schedule-load.js`, `Board.fromCache`) | 99ae4df |
| G4 | `TODOS.md` entries naming deleted files removed or retargeted | 8bb7020 |
| G5 | `VercelAnalytics.astro` comment | 9b6eb5c |
| G6 | `DESIGN.md` unpkg prose | 6beb69f |
| G7 | `middleware.ts` / `src/lib/site-routes.js` / `tests/agent-readiness.test.js` stale `/css/ /js/ /fonts/` prefixes | 177286d |

The whole-branch review's one Important finding (focus dropped to `<body>` when the seven trigger-less overlays closed) was fixed once in the shared `ui/dialog.tsx` + `ui/sheet.tsx` wrappers with a pure rule in `src/lib/focus-return.js` (8f1bd70).
