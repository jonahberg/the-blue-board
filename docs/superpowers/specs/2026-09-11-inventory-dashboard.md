# The Blue Board — Exhaustive Dashboard Feature Inventory (React + shadcn/ui port checklist), 2026-09-11

Primary sources: `public/index.html` (1229 lines), `src/dashboard/main.js` (8666 lines), `public/css/style.css` (1371 lines), `public/sw.js`, `public/manifest.json`. `public/js/dashboard.js` is build output — do not port from it. Paths are repo-relative; `main.js` = `src/dashboard/main.js`.

---

## 0. BUILD / BUNDLING CONTRACT

- [ ] Dashboard bundle built by vite as an IIFE lib, entry `src/dashboard/main.js`, output `public/js/dashboard.js`, global `BB`, leaflet external → global `L` — `vite.dashboard.config.js:20-40`
- [ ] `VITE_CARTO_BASEMAP_KEY` inlined at build; missing key = warning, watermarked map — `vite.dashboard.config.js:5-17`, consumed `main.js:549` via `cartoBasemapUrl()` in `src/lib/basemap.js`
- [ ] Build-time SEO stamping: `scripts/stamp-seo-build-date.mjs` replaces `__HOME_LASTMOD__` in `dist/index.html` and the Starlink strings in `dist/index.html`, `dist/llms.txt`, `dist/llms-full.txt`; build fails if missing
- [ ] Strings that must survive verbatim for stamping: `"425+"` and `"mid-2026"` → `"500+"` / `"August 2026"` — `src/data/starlink-live.json`; occurrences `index.html:546` (sr-only fleet summary) and `:1127` (FAQ JSON-LD)
- [ ] CSP: no inline JS anywhere — every handler is `data-action` delegated or an external `/js/*.js` — `index.html:79`, `main.js:7358-7713`

---

## 1. GLOBAL — HEADER / CANOPY (`#header`)

- [ ] Floating top bar, `position:fixed`, z 770 — `index.html:221-260`, `style.css:58`
- [ ] Brand `h1` "THE BLUE BOARD" + tagline "FOR UNITED FLYERS, BY UNITED FLYERS"; `<a data-action="go-home">` → `switchToTab('tab-live')` + smooth scroll top — `index.html:222`, `main.js:7559-7563`
- [ ] `.cdiv` vertical dividers (hidden mobile) — `index.html:223,227,231,241,249`, `style.css:872`
- [ ] Live status chip `#status-dot` + `#status-text` + `#header-flight-count`; three states keyed to payload age — `index.html:226`, `main.js:1216-1270`
  - LIVE when `feedFreshness(age) === 'live'` (age < `FEED_FRESH_MS` 180 000) — `src/lib/feed-health.js:65-71`
  - STALE (`#EAB308`) + `"· N flights (stale)"` when flights exist but age ≥ 180 s
  - NO DATA + `showMapErrorOverlay()` when `allFlights.length === 0`
  - `X-BB-Feed-Stale` header (seconds) backdates `lastGoodFeedTs` — `main.js:1210-1234`, `parseStaleHeader`
- [ ] `#countdown` "Next refresh: Ns", 1 s tick, "Paused (tab hidden)" on visibilitychange — `main.js:1058-1080`
- [ ] `#clock` UTC HH:MM:SS + "Z", 1 s — `main.js:903-909`
- [ ] `#watch-header-btn` (👁️) + `#watch-badge`, `aria-expanded`/`aria-controls="watch-panel"` — `index.html:255`
- [ ] `#mobile-search-toggle` (🔍) toggles `.mobile-search-open` on `#global-search-wrap`, focuses input — `main.js:876-888`
- [ ] `#home-hub-btn` (`cycle-home-hub`) cycles `['', ORD, DEN, IAH, EWR, SFO, IAD, LAX, NRT, GUM]`, writes `bb_home_airport`, updates `#home-hub-display` + tracker briefing — `main.js:7577-7584`, `:298-309`
- [ ] `#onboarding-help` (`?`) reopens onboarding — `index.html:258`, `main.js:8252`
- [ ] Home hub drives: initial map center/zoom (`[lat,lon]` zoom 5 vs `[39,-98]` zoom 4) `main.js:1029-1032`; default Schedule hub `:4579-4583`; 🏠 marker + accent border in hub-health bar `:5699-5703`

---

## 2. GLOBAL — TICKER (`#ticker`)

- [ ] `updateTicker()` item priority — `main.js:2024-2073`:
  1. `deriveOpsHealth({hubOtps, faaIndex, hubCodes: 9 hubs, iropsScore})` → if `level !== 'normal'`, `⚠️ <text>` class `advisory`
  2. `"N United flights airborne"` (`info`)
  3. `"Fleet: N mainline aircraft"` + `"N Starlink-equipped aircraft (incl. United Express)"` only when `FLEET_DB.length > 0`
  4. One `critical` item per emergency squawk (7500/7600/7700) via `decodeSquawk()`
  5. `"✅ All systems normal — tracking N United flights"` unshifted only if every item is `info`
  6. Always-last `disclaimer`: `"Unofficial — not affiliated with United Airlines · Data: AeroDataBox · FR24 · AWC · FAA"`
- [ ] Ticker DOM = two duplicate `.ticker-cycle` blocks (second `aria-hidden`) — `main.js:2071`
- [ ] `aria-live="off"` on `#ticker` deliberately; the ONE polite announcer is `#irops-status-announcer` — `index.html:235-240`
- [ ] Two render modes: marquee (`initTickerAnimation` `main.js:2077-2132`, only >768 px AND ticker not inside `#header`; `--ticker-offset`, `tickerScroll` duration `max(15, width/50)`, rAF fallback at 50 px/s) and fade rotation (`main.js:777-874`; ≤768 px OR `#header .ticker-wrap` exists → **fade rotation is the live mode**; 5000 ms interval, `.mobile-fade-out` then 400 ms swap; `uniqueCount = ceil(items.length/2)`). MutationObserver re-runs setup 50 ms after content change; matchMedia change listener; initial kick 1000 ms.
- [ ] Keyframes `tickerScroll` `style.css:51`; reduced-motion disables — `:855-862`

---

## 3. GLOBAL — HUB HEALTH BAR (`#hub-health-bar`)

- [ ] Static initial markup (Loading… + `?` tooltip) — `index.html:230`; static tooltip text differs from runtime (`main.js:5692`)
- [ ] `renderHubHealthBar()` — `main.js:5685-5734`: fixed order ORD DEN IAH EWR SFO IAD LAX NRT GUM; OTP severity `>70 green / 50–70 amber / <50 red`; `SEV_COLOR = {red:#ef4444, amber:#f59e0b, green:#22c55e}`; blend = worse of OTP and `hubProgramMarker(faaDelayIndex, hub)` (⛔ ground stop/closure → red, ⚠ GDP/departure → amber) replacing the 🟢/🟡/🔴 circle; hub code is `<a href="/hubs/<lower>" title="<HUB> Hub Guide">`; home hub 🏠 + accent border; trailing average chip `>70 "Smooth Ops"`, `50–70 "Some Delays"`, `<50 "Rough Day"`; empty state `"Load schedule data for hub health"`
- [ ] `updateHubHealth()` client OTP from `schedRawByHub` — `main.js:5739-5802`: aggregates all loaded keys direction-aware; excludes `status.inferred`, `_source.liveFeedFallback`, `_source.scheduleTimeDerivedFromActual.*`; on-time = `realT <= schedT + 1800`; writes only when `operated >= 25` AND hub not in `hubHealthServerHubs`
- [ ] Server path `renderIropsFromAPI()` writes `hubHealthData[hub]` from `hubMetrics`, adds hub to `hubHealthServerHubs`: `operated<5 && cancelRate>=0.5 → 0`; `operated>=5 → round(onTime/operated*100)` — `main.js:6077-6094`
- [ ] `.hh-info` `?` tooltip keyboard-reachable, hidden below 600 px — `style.css:1110-1116`
- [ ] Mobile: own fixed row at `top:66px`, horizontally scrollable with mask gradient; label/explainer/info/sep/avg hidden — `style.css:887-892`

---

## 4. GLOBAL — GLOBAL SEARCH (`#global-search-wrap`)

- [ ] Input `#global-search-input`, results `#global-search-results`, inline error `#global-search-error` (role=alert) — `index.html:244-248`
- [ ] Static placeholder not rotated — `main.js:7814-7834`
- [ ] Debounced 150 ms — `main.js:5410-5471`: min 2 chars; `" TO "` → space; `qNorm = q.replace(/[\s\-→>]+/g,'')`; live match on callsign, flightIATA, reg, `origin+dest` and reversed; schedule match on ident / registration / dest / orig over `schedAllFlights`; if empty, searches `schedRawByHub` and kicks `preloadScheduleData()`, re-rendering late results only if query unchanged (F043)
- [ ] `renderGlobalSearchResults()` max 20; live rows `focus-flight`, schedule rows `goto-schedule-result` with `data-hub/data-dir/data-flight` — `main.js:5473-5503`
- [ ] FR24 lookup affordance when `/^(UA[L]?\s*\d{1,4}|\d{1,4})$/i` → `lookup-fr24` — `:5477-5480`
- [ ] Contextual empty states (flight-number → "check the Schedule tab →"; tail `/^N\d{3,5}[A-Z]{0,2}$/i` → "not found in live feed"; else generic) — `:5482-5493`
- [ ] Outside-click closes — `:5504`
- [ ] Keyboard bridge (F083): ArrowDown from input → first result; Escape clears + hides; ArrowUp/Down move; ArrowUp at 0 → input; Escape refocuses input — `:5508-5538`
- [ ] `goto-schedule-result`: switch tab, set `#sched-hub`/`#sched-dir`, `loadScheduleData()`, `scrollIntoView({block:'center'})` on `[data-flight-row=…]` + `.sched-row-highlight` 2000 ms (`CSS.escape`) — `main.js:7532-7558`; keyframes `style.css:850-851`
- [ ] Mobile: `position:fixed; top:108px`, hidden until `.mobile-search-open` — `style.css:877-878`

---

## 5. GLOBAL — SIDEBAR SEARCH (Live tab)

- [ ] `#search-input-side` + `#search-results-side`, 150 ms, min 2 chars, cap 50 with header `"N flights found (showing 50)"` — `main.js:1979-2009`, `index.html:380-381`
- [ ] Hub-code query adds "🏢 Filter map to XXX (N flights)" → `toggle-hub-filter` — `:1994-1995`
- [ ] Empty state links to Schedule via `switch-tab` — `:1999-2002`

---

## 6. GLOBAL — WATCH PANEL + PUSH

- [ ] `#watch-panel` (z 9999): header + `Clear All` (`clear-all-watched`) + `#watch-panel-list` — `index.html:255`
- [ ] `MAX_WATCHED = 20`; key `bb_watched_flights` `[{flight, route, status, ts}]`; legacy `watchedFlights` read only in weather preload — `main.js:6154, 6240-6247, 5869`
- [ ] `toggleWatchFlight(flightNum, route, currentStatus)` add/remove → save → `renderScheduleTable` → `renderWatchPanel` → `updateMarkers` → `renderMyFlights` (if active) → `syncWatchButtons` → toast → `syncPushSubscription()` — `:6253-6284`
- [ ] `syncWatchButtons()` re-renders every `[data-action="toggle-watch-flight"]`; label form only inside `.popup-links` or `.ac-modal-footer` — `:6286-6300`
- [ ] `#watch-badge` count, hidden at 0 — `:6302-6311`
- [ ] Outside-click closes panel — `:7716-7720`
- [ ] `showWatchNotification(msg)` `#watch-notification`, auto-hide 10 000 ms — `:7267-7272`; DOM `index.html:201`
- [ ] Push prompt `#push-prompt` 500 ms after FIRST watch add when `!bb_push_prompted` and permission `default`; auto-hide 15 000 ms — `main.js:6263-6270`; DOM `index.html:202`
- [ ] `enable-push` → `Notification.requestPermission()`; grant → toast + `syncPushSubscription()`; both actions set `bb_push_prompted='1'` — `main.js:7489-7505`
- [ ] `bbPushBootstrap()` `GET /api/push-subscribe` → `{configured, vapidPublicKey}`; failure → `{configured:false}` — `:6172-6182`
- [ ] `syncPushSubscription()` requires SW + PushManager + Notification + configured + granted; empty list → unsubscribe + `POST {action:'unsubscribe', subscription:{endpoint}}`; else subscribe with `urlBase64ToUint8Array(vapidPublicKey)` and `POST {subscription:{endpoint, keys}, watches:[{flight}]}`; never throws — `:6194-6238`
- [ ] `renderWatchAlertsFootnote()` 4 copy tiers — `:6336-6354`
- [ ] `checkWatchedFlightChanges(flights)` after every schedule load — `:7206-7258`: skips inferred + transitions into `unknown`; `isSignificantStatusChange()` gate (`:7191-7204`); `document.hidden` → native `Notification('The Blue Board', {body, icon:'/icons/icon-192.png', tag:'bb-watch-'+ident, data:{flight}})` whose onclick focuses + `focusWatchedFlight(ident)`; else banner; "landed" → `window.showBmacLandingToast(ident)`

---

## 7. GLOBAL — NEWS BANNER (`#news-banner`)

- [ ] DOM `index.html:208-215` (must precede `#tip-strip` — sibling selectors)
- [ ] `public/js/news-banner.js` loaded defer `index.html:1228`; `GET /data/news-latest.json` `[{title, slug}]`; scheduled via `requestIdleCallback({timeout:4000})` or `setTimeout 1500` after load
- [ ] Dismissal `localStorage.news_dismissed_slug` vs `d[0].slug`
- [ ] Rotates every 6000 ms when >1, 400 ms crossfade; pause on mouseenter
- [ ] Click fires `window.va.track('news_banner_click', {slug})` (try/catch)
- [ ] Links `#news-banner-link` / `#news-banner-read` → `/news/<slug>`

---

## 8. GLOBAL — TIP STRIP (`#tip-strip`)

- [ ] DOM `index.html:218`; logic `main.js:7729-7791`
- [ ] `TIPS` keyed by tab: `tab-live` (3), `tab-schedule` (2), `tab-myflight` (2), `tab-weather` (1), `tab-fleet` (1); fallback `tab-live` — `:7730-7750`
- [ ] Random pick, 300 ms `.tip-fade`; rotation 45 000 ms; starts 2000 ms after load; re-shows 100 ms after any `.tab-btn` click
- [ ] Dismiss → `bb_tips_dismissed = Date.now()`, 7 days — `:7754-7758, 7784-7788`
- [ ] Fixed capsule `top:80px`, max-width 600; mobile `top:102px` full width — `style.css:1126-1136`

---

## 9. GLOBAL — OFFLINE BANNER

- [ ] `#offline-banner` `aria-live="assertive" role="alert"` — `index.html:131`; toggled by `online`/`offline` events only, never proactively on load — `main.js:5395-5407`

---

## 10. GLOBAL — ONBOARDING OVERLAY

- [ ] `#onboarding-overlay` `role="dialog" aria-modal` + `#onboarding-card` — `index.html:100-130`
- [ ] Six feature rows (Live Map / AI Delay Prediction / Schedules / Weather & Hub Status / Fleet & WiFi / Stats) — `:105-110`
- [ ] `#onboarding-home-hub` select (No preference + 9 hubs) saved via `setHomeAirport()` on dismiss — `:112-126`, `main.js:7932`
- [ ] Footer "Built by a United flyer, for United flyers. Not affiliated with United Airlines." + `#onboarding-dismiss` "Let's Fly the Friendly Skies ✈️"
- [ ] Show/hide — `main.js:8243-8249`: first visit sets `bb-visited='1'`, hide only if `bb_onboarding_dismissed` within 7 days; return visit hide if `bb-onboarded` OR dismissed within 7 days
- [ ] Dismiss: save hub, `.ob-hidden`, `bb-onboarded='1'` + `bb_onboarding_dismissed=Date.now()`, `display:none` after 300 ms, disarm trap, restore focus after 310 ms — `:7931-7941`
- [ ] Reopen: store activeElement, double-rAF `obFadeIn .4s`, arm trap, focus first focusable after 50 ms — `:7942-7947`
- [ ] Focus trap (F079): AbortController keydown, Escape dismisses, Tab wrap — `:7906-7928`
- [ ] Backdrop click dismisses — `:8251`; `?aircraft=` suppressed while visible — `:7862`

---

## 11. GLOBAL — WAITLIST / ENGAGEMENT MODAL

- [ ] DOM-built `#waitlist-modal` (z 10001) — `main.js:8005-8167`: "✈ Stay in the loop", sub copy, email input, optional feature-request textarea (3 rows), error line, submit "Stay in the Loop", trust badge "✓ No spam, just launch updates"
- [ ] Validation `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; submit disables + "Submitting…" — `:8078-8089`
- [ ] `POST /api/waitlist` `{email, source:'popup', featureRequest?}`; success or `error==='duplicate'` → success card + `bb_waitlist_submitted='true'`; else inline error — `:8090-8132`
- [ ] Escape scoped by AbortController — `:7966-8000, 8151-8163`; backdrop closes; close writes `bb_waitlist_dismissed` (7 days) — `:7968-7977`
- [ ] Triggers — `:8169-8241`: T1 5 min; T2 clicks 20 (new visitor `!bb-visited`) / 30 (returning); T3 landing → BMAC card; T4 `?waitlist=1` force
- [ ] Suppression: submitted, shown this session, dismissed within 7 days, onboarding visible — `:7979-7984`; `close-waitlist` — `:7592-7596`

---

## 12. GLOBAL — BMAC LANDING TOAST

- [ ] `window.showBmacLandingToast()` no-op if `#bmac-toast` exists or `bb-bmac-dismissed` within 14 days; else `setTimeout(showLandedThanksCard, 3000)` — `main.js:8197-8205`
- [ ] `#bmac-toast` (`role="status"`), close (`close-bmac`), "Glad you landed ✈️ — if The Blue Board helped today, you can support the server costs.", link `https://buymeacoffee.com/notjbg` — `:8207-8235`; `close-bmac` writes `bb-bmac-dismissed` — `:7585-7591`; CSS `style.css:1336-1351`

---

## 13. GLOBAL — DISCLAIMER MODAL + LEGAL POPOVER + SUPPORT METER + ATTRIBUTION

- [ ] `#disclaimer-modal` (z 10000) — `index.html:961-1005`: affiliation disclaimer, sources list (AeroDataBox / FR24 / CARTO+OSM ODbL / AWC NOAA / FAA NAS / fleet records), **"Do not use this dashboard for operational or safety-critical decisions"**, open-source + X links, support/BMAC/membership/issue links, **Supporters Wall (17 named chips)** `:978-1001`, "Got it"
- [ ] Open/close via `show-disclaimer`/`hide-disclaimer` + backdrop — `main.js:7568-7573, 7722-7725, 7886-7892`
- [ ] `#legal-details` native `<details>`/`<summary id="legal-btn">ⓘ` popover `#legalpop` (z 780) — `index.html:283-319`: title, `#support-meter` mount, link grid (About, Disclaimer, Privacy, Fleet Database, Support/Feedback, ☕ Donate, @theblueboard), hub nav (9 + All Hubs + News + Trackers), data-source note. Pure `<details>` + CSS (comment at :282 claiming JS handlers is wrong).
- [ ] `public/js/support-meter.js`: lazily `GET /api/support-stats` on first open; up to 2 bars (`boards.used/budget` "Today's board refreshes"; `liveFeed.usedPct` when configured) + `monthlyCostNote`; `.sm-bar-fill-warn` ≥85 %; failure renders nothing
- [ ] `#attribution` fixed bottom-left `role="contentinfo"`, z 710, hidden mobile — `index.html:322-324`, `style.css:932`
- [ ] Leaflet attribution control ON (ODbL), prefix cleared, credit from `getBasemapTileOptions().attribution` — pinned by `tests/compliance.test.js` — `main.js:531-543, 1040, 3807`

---

## 14. GLOBAL — MOBILE NAV / CONTROLS

- [ ] `#mobile-bottom-nav` (`role="tablist"`, z 760): Live / Weather / Schedule / My Flights + overflow Starlink / Fleet / Stats / Sources + `#mobile-more-btn` — `index.html:327-337`
- [ ] `#mobile-more-menu` (z 781) — `index.html:338-343`
- [ ] Behaviour `main.js:699-758`; `switchToTab` monkey-patched to sync bottom-nav from the More menu's `[data-tab]` children — `:741-758`
- [ ] `#mobile-ctrl-toggle` toggles `.ctrl-menu-open` on `#controls`; outside click closes — `:760-775`; CSS `style.css:920-928`
- [ ] `#mobile-sidebar-toggle` toggles `.mobile-sidebar-open` on `#sidebar`, label `🔍 Filters ▾/▴`, `map.invalidateSize()` after 300 ms — `main.js:890-901`
- [ ] `#sidebar-filters-toggle` / `#sidebar-extra-filters` collapsible — `main.js:7293-7301`
- [ ] Mobile hides: `#tab-bar`, `#legal-details`, `#stats-bar`, `#attribution`, `#map-legend`, header clock/countdown/home-hub — `style.css:893-932`
- [ ] Sibling offsets when news banner/tip strip visible (96→138→176 / 102→144→182 px) — `style.css:913-918`

---

## 15. GLOBAL — PWA / SERVICE WORKER

- [ ] Registration `public/js/sw-register.js` at `index.html:1008`
- [ ] `CACHE_VERSION='v10'`; caches pages(20)/data(80)/static(120) — `sw.js:1-26`; precache `['/', '/index.html']`; skipWaiting; claim + prune
- [ ] Fetch: navigation network-first `cache:'reload'` → cached → `/index.html` → 503; `/api/*` + `/data/*` network-first `no-store` → cached → 503 JSON; `/js/*` + `/css/style.css` network-first `no-cache`; else stale-while-revalidate
- [ ] `push` `{title, body, tag, url}`, icon/badge `/icons/icon-192.png` — `sw.js:172-196`; `notificationclick` `data.url || '/?flight=<flight>' || '/'` — `:200-223`
- [ ] `manifest.json`: id `/`, standalone, `#0a0e14`, 4 icons, categories travel/transportation
- [ ] iOS/Android meta — `index.html:38-46`

---

## 16. GLOBAL — DEEP LINKS, QUERY PARAMS, HASH

- [ ] `TAB_HASHES` `#myflight #live #schedule #fleet #starlink #weather #stats #sources` (`tab-analytics → #stats`) — `main.js:552-553`
- [ ] On load hash applied visually only; `initApp()` → `switchToTab(activeTab, false)` — `:596-603, 7868-7871`
- [ ] `switchToTab(tabId, updateHash)` `history.replaceState` unless false — `:566`
- [ ] `?tab=` (`myflight|live|schedule|fleet|starlink|weather|irops|stats|sources`; `irops` → weather + scroll `#irops-section`) — `:605-640`
- [ ] `?type=` / `?filter=` → `applyFleetDeepLinkFilter()` — `:642-645, 674-697`
- [ ] `?view=starlink|airborne|special` (starlink → Starlink tab; others poll 200 ms ≤10 s for `FLEET_DB`) — `:647-663`
- [ ] `?hub=XXX` with `tab=schedule` → `#sched-search` + input event after 500 ms — `:665-670`
- [ ] `?flight=` or `?q=` → after first successful poll match `flightIATA`/`callsign`/`UA+q`/`UAL+q` → `focusFlight()` 300 ms else `lookupFR24Flight()`; latched only when feed non-empty (F033) — `:1297-1323`
- [ ] `?aircraft=REG` → `showAircraftDetail()` 500 ms after fleet load — `:7842, 7862`
- [ ] `?waitlist=1` — `:8239-8241`
- [ ] Popup open sets `?flight=<id>` via replaceState; close removes — `:1458-1465, 1044-1053`
- [ ] Share: `share-flight` sets `?flight=` + clears hash; `share-aircraft` sets `?aircraft=` — `:7457-7488, 7680-7709`; clipboard with execCommand fallback + `window.prompt`
- [ ] SearchAction JSON-LD `https://theblueboard.co/?flight={flight_number}` — `index.html:1218-1225`

---

## 17. GLOBAL — KEYBOARD & A11Y

- [ ] Skip link `#skip-to-content` → `#tab-live`, z 100000 — `index.html:98`, `style.css:9-10`
- [ ] Tab-bar roving tabindex: Arrow keys wrap, Home/End; `aria-selected` + tabindex by `switchToTab` — `main.js:556-593`
- [ ] Enter/Space activation for `[data-action][role="button"]` — `:7352-7357`
- [ ] Escape closes schedule advanced-filter drawer (focus → `#sched-more-filters-btn`) — `:7341-7349`; onboarding (`:7915`), waitlist (`:7994`), delay-explain (`:8275-8277`), aircraft-detail (`:8375-8377`)
- [ ] Sortable `<th>` `tabindex="0"` + Enter/Space + `aria-sort` — fleet `:2353-2364`, airborne `:2503-2513`, Starlink `:2847-2858`, schedule `:4569-4577`
- [ ] Markers `role="img"` + `aria-label` "UA123 ORD to DEN, cruising" — `:1427-1454`
- [ ] `aria-live` inventory: `#offline-banner` assertive/alert; `#watch-notification` polite/status; `#news-banner` status; `#hub-health-bar` polite; `#ticker` off; `#irops-status-announcer` sr-only status polite (single writer `announceIropsLevelChange()` `main.js:5663-5674`); `#global-search-error` alert; `#stats-bar` status polite; `#sl-verify-alert` alert; `#irops-content` polite; `#tracker-briefing-watch` polite
- [ ] `<nav aria-label="Dashboard navigation">` wraps `#tab-bar` — `index.html:263-276`
- [ ] Scrollable table wrappers `tabindex="0"` + `aria-label "… scrollable region"` — `:517, 632, 640, 647, 726, 752`
- [ ] `.sr-only` — `style.css:840`; focus ring `:focus-visible{outline:2px solid var(--ua-accent)}` — `:13-14`

### Jargon tooltip system
- [ ] `JARGON_TERMS` = irops, otp, metar, gdp, groundstop, equipment, tail — `main.js:41-49`
- [ ] `jargonTerm(termKey, label)` → `.jargon-term-wrap > .jargon-term[tabindex=0][aria-describedby] + .jargon-tooltip[role=tooltip]`, ids `jgt-tip-N`; callers gate first-occurrence-per-panel — `:50-62`
- [ ] Pure CSS show/hide; delegated handler clamps in viewport — `:63-82`; CSS `style.css:1300-1315`
- [ ] Call sites: weather cards (metar/gdp/groundstop) `:3862-3922`; schedule OTP `:5358`; IROPS `:5996, 6104`; aircraft modal (tail, equipment) `:8420-8421`

---

## 18. TAB — LIVE OPS (`#tab-live`)

### Map
- [ ] `#map` `role="application"`, `position:fixed; inset:0; z-index:0` page background + `#map::after` vignette — `index.html:388`, `style.css:37-38`
- [ ] `initMap()`: `zoomControl:false`, `worldCopyJump:true`, zoom control bottomright, CARTO dark — `main.js:1028-1042`
- [ ] `getBasemapTileOptions()`: `maxZoom:18`, `tileSize:256`, subdomains `'ab'` ≤768 else `'abcd'`, `detectRetina` desktop hi-DPI only, ODbL attribution — `:531-543`
- [ ] Hub markers `drawHubs()`: circleMarker r=8 `#005DAA` fill .3 + permanent `hub-tooltip` + pulse circle `hub-pulse` — `:1083-1101`
- [ ] Great-circle route on popup open: 60-point `greatCirclePoints()`, `normalizeLonContinuity()`, traveled solid (w 2.5, .8), remaining dashed `6,4` (w 1.5, .4), origin dot filled, dest dot white, `IATA — City` tooltips — `:1680-1708, 1711-1751`
- [ ] Longitude normalization per marker relative to map center — `:1432-1437`

### Map controls (`#ctrl-panel` toolbar)
- [ ] `btn-hubs` `toggleHubs()` aria-pressed — `:1103`
- [ ] `btn-longhaul` — long-haul = GC distance > 2500 nm via `AIRPORT_COORDS`, fallback flight number < 100 — `:1104, 1338-1346`
- [ ] `btn-starlink` — disabled + `title="Starlink data unavailable"` when no tails; force-resets filter; hides `#map-legend` — `:1105-1133`
- [ ] `btn-wx` — NEXRAD `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png` opacity .5 — `:1134-1144`
- [ ] `btn-pacific` — flyTo `US_VIEW {[39,-98], 4}` ↔ `PACIFIC_VIEW {[25,145], 4}` 1.2 s — `:1146-1154`
- [ ] `btn-refresh` — label "⏳ Loading..." while in flight — `:1190, 1288`
- [ ] `#map-legend` Starlink violet dot, hidden until data; hidden mobile — `index.html:398`

### Live feed
- [ ] `GET /api/fr24-feed?airline=UAL` every 30 s (`startRefreshTimer`) — `main.js:1058-1067, 1193`
- [ ] visibilitychange: hidden → clear + "Paused"; visible → immediate refresh — `:1073-1080`
- [ ] `isRefreshing` gate — `:1184-1186`
- [ ] `parseFr24Feed` + `applyFeedResult`; 200 with zero aircraft = failure — `:1200-1201`
- [ ] Retry ladder `[5000,10000,20000,30000]`, countdown matches, skipped while hidden — `:1271-1288`
- [ ] `showMapErrorOverlay()` fixed inset-0 z 999, "Live flight feed unavailable / Retrying automatically…" + `map-error-retry` — `:1165-1182, 7443-7448`
- [ ] Post-refresh fan-out (each try/caught): updateMarkers, updateStats, updateHubStats, updateTicker, conditional renderMyFlights, updateLiveFleetPanel, Starlink re-render, updateAnalytics — `:1292-1296`
- [ ] `recordRegSightings(allFlights)` every poll — `:1206`

### Markers
- [ ] `createPlaneIcon(hdg, isLonghaul, phase, isWatched, isStarlink)` heading rounded 5°, cache key; fill priority watched `#22c55e` → Starlink `#A78BFA` → long-haul `#fbbf24` → phase (Ground `#64748B` else `#6BAAED`); size 16/14/10; drop-shadow; inline SVG rotated — `:1348-1373`
- [ ] Watched `zIndexOffset: 1000` — `:1441, 1445`
- [ ] `getFilteredFlights()` hub filter (origin/dest or onGround within 93 km), phase-group, Starlink-only — `:1375-1392`
- [ ] `getPhaseGroup()` Takeoff+Climb → Climb, Cruise+En Route → Cruise — `:1394-1401`
- [ ] `getPhase(alt, vr, spd)` (ft = m×3.28084, fpm = m/s×196.85, kts = m/s×1.944): Ground <100 ft & <50 kt; Takeoff <5000 ft & vr>500; Approach <5000 & vr<-300; Climb vr>300; Descent vr<-300; Cruise alt>25000; else En Route — `:982-995`
- [ ] `decodeSquawk()` 7500 HIJACK / 7600 RADIO FAILURE / 7700 EMERGENCY (`squawk-alert`), 1200 VFR — `:997-1006`
- [ ] `estimateRoute(lat,lon,hdg,alt,vr,flightNum)` — `UA_ROUTES` lookup (~220 pairs `:404-462`) else bearing match (90° <5000 ft / 60°, max 2000 nm; low-alt nearest within 50 nm as origin if vr>0 else dest; never origin===dest) — `:928-980`
- [ ] `isStarlinkFlight(f)` — `matchAircraft()` then raw reg; false in degraded tier — `:1015-1025`
- [ ] `matchAircraft(f)` → `src/lib/fleet-match.js` with `FLEET_BY_REG` — `:1008-1013`

### Flight popup (`showFlightPopup` `:1458-1709`)
- [ ] Header: callsign, `City → City` (IATA_CITIES), `ORIG → DEST`, "estimated route" note, phase chip, squawk alert
- [ ] Grid: Altitude (+ `.alt-bar`), Speed, Heading, V/S via `getFlightPopupMetrics()` (`src/lib/flight-popup.js`)
- [ ] Aircraft block when matched: type + `.ac-reg-link` (`aircraft-detail`), `config | wifi | IFE`, `⚡ STARLINK CONFIRMED` or `⚡ Checking…` prediction badge, `⭐ special`, seat blocks NJ/NPP/NE+/NY + total
- [ ] Unmatched line: `type · reg (Loading aircraft data… | not in mainline fleet DB — likely United Express)` — `:1538-1549`
- [ ] Async times `#popup-times-<icao24>` from `/api/flight-times?flight=`; precedence actual → estimated → scheduled; delta `On time` (|Δ|≤5), `+Nm`, `Nm` early; "Sched HH:MM" when |Δ|>5; tz-labelled `formatTimeWithTz` — `:1572-1675`, `src/lib/time-format.js`
- [ ] Links: FlightAware `https://flightaware.com/live/flight/UAL<num>`, Planespotters `https://www.planespotters.net/search?q=<reg>`, ADS-B Exchange `https://globe.adsbexchange.com/?icao=<icao24>`, Watch, Share — `:1554-1566`
- [ ] Popup `{maxWidth:320, closeButton:true}` — `:1568-1569`; restyle dark, `min-width:280px`, 44×44 close — `style.css:234-238`; marker hit-area `::after{inset:-5px}` — `:225-231`; tooltip `white-space` (F093) — `:315`

### Sidebar + stats bar
- [ ] `#hub-stats` `updateHubStats()`: "⊘ SHOW ALL" + per hub `↗ out ↙ in`, `.hub-bar-fill` % of busiest, `BUSIEST`, `✓ FILTERED`; `role=button` → `toggle-hub-filter` — `main.js:1945-1976`
- [ ] `toggleHubFilter(iata)` `map.setView(hub, 7)` or reset `[39,-98]` 4 — `:1922-1934`
- [ ] `#phase-stats` 5 rows (🅿️ Ground, 🛫 Climb, ✈️ Cruise, ↘️ Descent, 🛬 Approach), `.phase-selected` — `:1907-1913`
- [ ] `clearAllFilters()` — `:1936-1943`
- [ ] `#stats-bar` 9 stats: Airborne, Utilization, ⚡ Starlink, Climbing, Cruising, Descending, Ground, Avg Alt, Avg Spd — `index.html:403-421`, `updateStats()` `:1853-1914`; Utilization = airborne / FLEET_DB.length, `--` without DB, `(filtered)`, `n/a (small sample)` when filtered and airborne < 10
- [ ] `#stats-bar` hidden 769–1080 px and mobile — `style.css:156, 930`

---

## 19. TAB — MY FLIGHTS (`#tab-myflight`)

- [ ] Empty state `#myflight-empty` + `#myflight-search` quick-add — `index.html:347-355`
- [ ] Quick-add Enter normalizes `UA` prefix — `main.js:7798-7807`
- [ ] Placeholder rotator on `#myflight-search` only: `['Add a flight (e.g. UA 1234)', 'Try a tail number (N37502)']`, 4000 ms, 300 ms `.ph-fade`, paused on focus — `:7814-7834`
- [ ] `renderMyFlights()` render-token guard; parallel `preloadWeatherAndFAA()`, `fetchIropsFromAPI()`, one `/api/flight-times?flight=` per watched — `:6393-6473`
- [ ] Flight-times cache TTL `getMyFlightTimeCacheTTL()` jitter `sum(charCodes) % 20000`: failure 30 s; cancelled/diverted/landed 300 s; dep <90 min 45 s; <6 h 60 s; else 120 s — `:6373-6391`
- [ ] `MY_FLIGHTS_FAIL_TERMINAL = 2` → "STATUS UNAVAILABLE" chip + united.com note — `:6370-6371, 6692-6706`
- [ ] `buildMyFlightCard()` — `:6611-6865`: status chip via `resolveFlightStatus(td, liveFlight)` (`src/lib/flight-status-resolve.js`) CANCELLED/DIVERTED/LANDED/EN ROUTE/DEPARTED/DELAYED/SCHEDULED; countdown to boarding (dep−30 min) then departure; "Expected to depart"; to-arrival/"Arriving"; "Landed"; backfills `watched.route`; gate grid `T<term> Gate <gate>` with `getUnitedTerminal()` fallback; equipment grid (matched type + `.ac-reg-link`, seats, `⚡ Starlink Confirmed` or `⚡ Checking…`; unmatched → forecast badge `data-mode="forecast"` + "Tail not yet assigned"); provenance chip `via schedule snapshot` when `source==='schedule-cache'`; actions View on Map, Aircraft Details, Explain Delay Risk, Unwatch
- [ ] `updateMyFlightsCountdowns()` 1 s while tab active, cleared on leave — `:6471-6472, 565, 6874-6908`
- [ ] Risk badge: `computeDelayRisk()` else `findBoardRiskForFlight()` else grey `RISK N/A` — `:6808-6832, 7021-7034`
- [ ] Risk/explain data-attrs: flight, route, status, riskLabel, riskScore, riskFactors (|), hub, otp, weather, destWeather, irops, faaStatus, connection, inbound — `:6829, 6861`
- [ ] Aircraft journey chain — `:6478-6609`: `fetchAircraftJourney(reg, …)` → `/api/aircraft-history?reg=`, `segments[{flightNumber, origin, destination, delayMin, status}]`; 5-min cache; failures cache `[]` ("Flight history unavailable"); `buildJourneyChainHtml()` up to 3 prior segments, delay classes on-time ≤5 / minor ≤45 / major; `buildJourneyContextStr()` back-fills `data-inbound`
- [ ] "Where's My Plane?" inbound card — same reg, different flight, `dest === origCode`, airborne; only when own flight not airborne — `:6763-6799`
- [ ] Connection risk — `detectAndRenderConnections()` cross-joins watched flights where `td1.destination.iata === td2.origin.iata`, hub in `HUB_CODES`, `0 < gap < 480` — `:7037-7076`
  - `computeConnectionRisk()` — `mctKey = (domIn?'d':'i')+(domOut?'d':'i')` using `INTL_AIRPORTS`; MCT `MIN_CONNECTION_TIMES[hub][key]` (default 60); walk 5 same terminal else `TERMINAL_WALK_TIMES[hub][sortedPair]` or default 10; verdict via `classifyConnection`

  - `computeConnectionRisk()` details — `main.js:7078-7108`
  - `MIN_CONNECTION_TIMES` (ORD dd:75, DEN/IAH/EWR/SFO/IAD/NRT dd:60, LAX dd:75, GUM dd:45; intl 90–120) and `TERMINAL_WALK_TIMES` in `src/lib/connection-risk.js:20-32`
  - Verdict states `scored` / `insufficient` (missing/NaN gate times → grey, never green) / `disrupted` (cancelled or diverted leg) — `connection-risk.js:34-40`
  - Card copy keeps the honesty clause "…our conservative guidance — United's published MCT is lower" — `main.js:7124`
  - `connectionIndex[flight]` populated for both legs, feeds AI `data-connection` — `:7064-7073, 6824-6827`
- [ ] Manual connection checker `#myflight-check` (`#conn-inbound`, `#conn-outbound`, Check, `#conn-manual-result`) — `index.html:358-366`; `checkManualConnection()` normalizes UA, fetches both `/api/flight-times`, distinguishes feed outage (`r === null` → "temporarily unavailable") from not-found (`success:false` → "Check the flight numbers") from not-connecting (hub mismatch) — `main.js:7146-7189`; Enter submits — `:7809-7812`

---

## 20. TAB — SCHEDULE (`#tab-schedule`)

### Controls
- [ ] Day buttons `-1/0/1` labelled `Yesterday/Today/Tomorrow (M/D)` hub-local via `getHubDayLabel()` — `index.html:430-434`, `main.js:4607-4623`
- [ ] `#sched-hub` (All Hubs + 9), `#sched-dir` (departures/arrivals) — `index.html:437-452`
- [ ] `#sched-find` "Find in board…" two-way mirrored with drawer `#sched-search`, one predicate — `main.js:4553-4567`
- [ ] `#sched-jump-now` pill (today board with ≥1 future row) → `scrollScheduleToNow(true)` — `:5297-5317`
- [ ] `#sched-refresh-btn` deletes local cache key then reloads — `:7406-7410`
- [ ] `#sched-more-filters-btn` / `#sched-adv-filters` drawer; label `Filters (N active) ▾/▴` accent, else `Filter: Fleet, Aircraft, Starlink… ▾` / `Less Filters ▴` — `:7303-7337`
- [ ] 7 advanced selects + search: `#sched-status` (8 values), `#sched-aircraft` (from board), `#sched-fleet-family` (737/A320/757/767/777/787), `#sched-route-type` (domestic/international), `#sched-starlink`, `#sched-timerange` (morning 5a–12p / afternoon 12p–5p / evening 5p–10p / redeye 10p–5a), `#sched-risk` (high/moderate/low), `#sched-search` — `index.html:457-505`
- [ ] Advanced filters (route-type, starlink, timerange, risk) reset on hub/dir/day change — `main.js:4776-4779`
- [ ] Render debounce 120 ms — `:4543`

### Data loading
- [ ] `GET /api/schedule?hub=<HUB>&dir=<departures|arrivals>&timestamp=<startOfHubDaySec>` — `:4658-4685`
- [ ] AbortController timeout 60 000 ms → "Schedule request timed out" — `:4662-4663, 4682`
- [ ] In-memory `schedCache['agg-<hub>-<dir>-<ts>']`; partial responses not cached; `fromLocalCache` flag — `:4660, 4678`
- [ ] Server-clock offset from `Date` + `Age` headers → `schedClockOffsetSec`; `schedNow()` server-anchored — `:4518-4525, 4667-4674`
- [ ] Retry `MAX_RETRIES = 3`, backoff `min(1000 * 2^(attempt-1), 4000)`; retries `partial` except `partialReason === 'first_page_failed' && total === 0` — `:4727-4750`
- [ ] Frozen `loadHub/loadDir/loadDay` (F034); abort if user switched; `_schedPendingReload` — `:4717-4719, 4752-4758, 4862-4867`
- [ ] Fields read: `flights[]`, `total`, `cached`, `partial`, `degraded`, `stale`, `error`, `meta.{dataAge, completeness, partialReason, pagesFailed, liveFeedFallbackAdded, generatedAt, hubDisruptionMinutes}` — `:4739-4838`
- [ ] State: `schedRawByHub['<hub>-<dir>-<day>']` (raw), `schedMetaByHub`, `schedAllFlights` (overlaid), `schedBoardMeta`, `schedBoardFetchedAtMs` — `:4485-4497, 4766-4770`
- [ ] Post-load: `preloadWeatherAndFAA()`, `detectEquipmentSwaps()`, `populateAircraftFilter()`, `renderScheduleTable()`, `renderScheduleStats()`, `updateHubHealth()`, `updateIrops()`, `checkWatchedFlightChanges()` — `:4772-4858`
- [ ] Preload `preloadScheduleData()` hubs `['ORD','DEN','EWR']` sequential, per-hub `getStartOfHubDay(hub,0)` (F022), TTL 10 min via `sessionStorage.bb_sched_preload_ts` — `:4625-4656`
- [ ] Initial day = `defaultSchedDayOffset(hub)` — `:4587`, `src/lib/hubTz.js`

### Staleness / degradation banner (`#sched-loading`)
- [ ] Ladder — `:4781-4839`: `degraded && dataAge != null` → "Statuses as of <asOf> (<age> old) — showing the latest data we have." (+ partial variant); `stale && !partial && dataAge` → same; `liveFeedFallbackAdded` → "Added N live active flight(s) while the full schedule feed recovers."; `partialReason` → `live_feed_fallback` / `deadline_exceeded` / `first_page_failed` / `actual_only_official` / `page_fetch_failed`; fallback "Some flights may be missing."
- [ ] Completeness suffix `" N% loaded."` / `" N% previously loaded."` (suppressed for `actual_only_official`) — `:4817-4823`
- [ ] Palette via `dataAgeSeverity()` (`src/lib/data-age.js`): stale red ⚠️; aging (1–6 h) amber ⏳; degraded teal ⏳; else amber ⚠️ — `:4826-4837`
- [ ] Clean board older than 600 s → muted `.sched-age-chip` "data as of <time>" — `:4845-4851`
- [ ] `formatBoardAsOf()` `meta.generatedAt` → `fetchedAt - dataAge` → fetch time, hub-local `h:mm A TZ` — `:4895-4919`

### Table (`#sched-table`, 10 columns)
- [ ] Columns: Time, Flight, Route, Aircraft, Reg, Term/Gate, Status, Delay/Risk, Fleet, 👁️ — `index.html:520-531`
- [ ] Sortable time/flight/route/aircraft/reg/status; arrows `↑/↓/↕` + `aria-sort` — `main.js:4974-4999, 5038-5043`
- [ ] Time cell: hub-local `HH:MM`; `.sched-date-chip` for prior hub-local date; `→ HH:MM (+Nm)` actual line when |Δ|>5 (green early); `actual` tag when derived — `:5061-5082`
- [ ] Route cell promotes airport name when IATA missing (never bare `?`) — `:5086-5105`
- [ ] Reg cell `schedRegFor(fl)` = provider registration first, ledger backfill (`lookupReg`); backfilled tooltip "Tail from live flight tracking (not in the schedule feed)" — `:517-522, 5110-5117, 5246`
- [ ] Term/Gate: `T<t> · <g>` / `T<t>` / `Gate <g>` / `—`; fallback `getUnitedTerminal()` via `UNITED_HUB_TERMINALS` (ORD 1/1, DEN B/B, EWR C/C, IAH C/E, SFO 3/G, LAX 7/7, IAD C/D, NRT 1/1, GUM 1/1) — `:384-400, 5123-5131`
- [ ] Status cell: `classifySchedStatus()` + `displayScheduleStatus()`; presumed → `Departed*` + tooltip; unknown → "Scheduled" + `as of <time>`; live-confirmed → `LIVE` chip — `:5133-5239`
- [ ] Delay/Risk precedence (facts beat predictions) — `:5213-5231`: terminal rows → `—`; known delta (operated & not presumed, or Δ>5) → `formatDelayMinutes(Δ)` coloured `delayColorVar(Δ)`; else `RISK: <LABEL>` badge; else `—`
- [ ] Fleet cell `⚡`/`✓ <config|type>` or `—`; enrichment line `seats · wifi · ⚡ Starlink · IFE · Del YYYY` — `:5139-5162`
- [ ] Equipment-swap badge `🔴/🟢/⚠️ <old> → <new> <reg>` + impact chips — `:5164-5183`
- [ ] `⭐` special-livery badge in Reg — `:5185-5186, 5246`


- [ ] Delayed rows via `getFAADelayContext(orig, dest)` → "Ground Stop at EWR, avg 45 min · GDP at ORD" — `:5188-5195, 6133-6151`
- [ ] Watch button per row — `:5197-5201`
- [ ] NOW divider — today boards, sort=time asc only; anchor `effectiveRowTime()` = `max(scheduled, estimated)` when no real time (F075); `nowDividerIndex()` −1 when no past rows; label `── NOW · HH:MM TZ ──` — `:5255-5281`, `src/lib/board-now.js`
- [ ] One-shot auto-scroll to NOW after fresh today load only — `:4771, 5286-5293`; `scrollScheduleToNow()` scrolls `#sched-table-wrap` to `offsetTop - 60` — `:5305-5317`
- [ ] Empty state "🔍 No flights match your filters" colspan 10 — `:5045-5051`
- [ ] `#sched-tz-footer` DOM-built: "Schedule data via **AeroDataBox** · United flights only · All times <hub> local (**TZ**)" (crediting FR24 here was a ToS violation) — `:5001-5023`

### Live-feed overlay
- [ ] `applyLiveFeedOverlayToSchedule()` builds `flightNum → {reg, origin, dest, seenAtMs}` from `allFlights`, `applySightingsToBoard()` on `schedAllFlights` only — `:4927-4939`, `src/lib/reg-overlay.js`; applied inside `getFilteredScheduleFlights()` — `:4941-4972`

### Stat strip (`#sched-stats`)
- [ ] 6–7 cards: `UA DEP/ARR · <day>` total, On-Time % + `(N operated)`, On Time, Late, Canceled, Upcoming, muted Uncategorized — `:5319-5376`; OTP colours `≥70 #22c55e / ≥50 #f59e0b / #ef4444`, `—` undefined — `:5333-5335`; Canceled title notes likely-canceled — `:5340-5342`; bucketing `computeScheduleStatCounts()` (`src/lib/board-stats.js`)
- [ ] `#sched-stats-note`: "✈ N presumed departed/landed" chip; warning when `meta.hubDisruptionMinutes > 60` — `:5378-5392`

### Equipment swap detection
- [ ] `detectEquipmentSwaps(flights, hub, dir, day)` key `bb_sched_<hub>_<dir>_<day>` `{flightNumber: icaoAircraftCode}`; diff then overwrite — `:5598-5624`
- [ ] `ICAO_TO_FLEET_TYPE` (A319/A320/A21N/B737/B738/B739/B39M/B38M/B752/B753/B763/B764/B772/B77E/B77W/B788/B789/B78X) — `:5541-5549`
- [ ] `getTypicalFleetStats(icaoCode)` modal config among active aircraft, modal WiFi, any-Starlink, top cabin by `CABIN_RANK` — `:5555-5584`
- [ ] `analyzeSwapImpact()` → `src/lib/swap-impact.js` — `:5586-5594`
- [ ] `#equip-change-summary` "⚠️ N equipment swaps detected · N downgrades · N upgrades", `equipFlash 1.5s`, click opens drawer — `:5626-5646`; CSS `style.css:1139-1142`
- [ ] `#sched-pagination` exists in HTML but is dead — `index.html:537`

---

## 21. TAB — FLEET (`#tab-fleet`)

- [ ] sr-only fleet summary (1,078 aircraft, 19 types, "425+ … as of mid-2026" build-stamped) — `index.html:544-547`
- [ ] Zone 1 Fleet Pulse `#fleet-pulse-zone`: shimmer, LIVE badge + `#fleet-live-time`, `#fleet-airborne-count`, `#fleet-pulse-subtitle` "N mainline matched · N regional/partner", `#fleet-pulse-util` "N% fleet utilization (n/total)", `#fleet-type-utilization` per-type bars — `index.html:550-582`, `updateLiveFleetPanel()` `main.js:4270-4328`
- [ ] `#fleet-health-content` `renderFleetHealth()` (total, "N active (X.X%) · N out of service", bars per `FLEET_HEALTH_CATEGORIES`) — `:4367-4397`, `src/lib/fleet-utils.js`
- [ ] Starlink progress `#starlink-progress` + `#starlink-pct` "N% (m/total)" — `:2173-2178`
- [ ] `#starlink-fleet-stats` chips: Total, Mainline, Express (purple), Mainline %, Express %, `+N New (7d)` amber — `:2181-2204`
- [ ] Zone 2 Composition `renderFleetComposition()`: `FLEET_FAMILIES` with `WIDEBODY · POLARIS` divider, family header, `routeCallout`, subgroups, `.variant-card` (`filter-fleet-type`, role=button, aria-pressed) — `:2256-2310`
- [ ] Delivery Timeline `renderAgeChart()` stacked bars by year (1990–2030), 8-colour family map, 140 px, labels ≥15, year labels every 5 + first/last; stats "Average Xy · Newest REG (YYYY) · Oldest REG (YYYY)" + decade buckets — `:2654-2755`
- [ ] Seat Configuration `showConfigGallery(type)` / `showConfigEmpty()` cabin colours (`J #2563eb, PP/PE #0d9488, F #7c3aed, E+ #16a34a, Y #475569, Domestic #6366f1`), width `max(30, count/2)`; empty offers 737-800 / A321neo / 777-300ER — `:2598-2638`
- [ ] Zone 3 Lookup sub-tabs (All / Airborne Now / 🛰️ Starlink → redirect / Special) with counts — `index.html:617-622`, `switchFleetView()` `:2515-2542`, `updateFleetSubtabCounts()` `:2544-2562`
- [ ] Controls `#fleet-search`, `#fleet-filter-type` (19 fixed order), `#fleet-filter-wifi` (`normalizeWifi`), `#fleet-filter-status` (Active / Stored/Maint / Starlink / Special+Named), Refresh — `index.html:624-630`
- [ ] Filter/sort via `filterFleetData`/`sortFleetData` with `starlinkTails` + `specialAircraftSet` — `main.js:2313-2350`; row classes `.row-stored`/`.row-maint` — `:2338`
- [ ] `#fleet-zero-results` + "Clear Filters" — `index.html:637`, `:2640-2652`
- [ ] `filterFleetType(type)` toggles, syncs dropdown + cards, opens gallery, smooth-scrolls `#fleet-lookup-zone` — `:2565-2596`
- [ ] Debounced 120 ms listeners on 4 controls — `:2229-2253`
- [ ] Airborne table `#airborne-table` 8 cols (Reg/Type/Flight/Route/Alt/Phase/SL/Special), own sort — `:2451-2513`
- [ ] Special panel `renderSpecialAircraftPanel()` AIRBORNE pulse or NAMED/LIVERY — `:2399-2449`
- [ ] `SPECIAL_AIRCRAFT` from fleet.json `s`: `*Name*` → named; `/100 Year Sticker/i`, `/Eco Demonstrator/i` → livery — `:185-204`
- [ ] `ENGINE_BY_TYPE` — `:206-215`
- [ ] `refreshFleetData()` = `location.reload()` — `:3527-3531`
- [ ] Load-failure `renderFleetLoadError()` (F035) "Fleet database unavailable", "This is a load error — not zero aircraft", ↻ Retry — `:2141-2164`
- [ ] Source line "Fleet data via United Fleet Site, updated daily" — `index.html:615`

---

## 22. TAB — STARLINK (`#tab-starlink`)

- [ ] Hero: `#sl-hero-count`, "Aircraft Equipped", `#sl-hero-verify-sub` ("397 verified · 3 disputed" + `sl-jump-verify`), Express/Mainline bars `n / total · N%`, chips `+N NEW THIS WEEK`, `● N AIRBORNE NOW` (→ LIVE tab Starlink filter) — `index.html:657-668`, `renderSlHero()` `main.js:3307-3346`; chip `:7388-7393`; bars hidden in degraded tier — `:3314-3326`
- [ ] `isRecentlyFound(dateFound)` 7 days +1 day skew — `:2779-2785`
- [ ] Installation Velocity `renderSlChart()` pure SVG 940×280 (pad 40/46/18/34), stacked monthly (Express green, Mainline accent) + amber cumulative line + right axis — `:3059-3174`; outlier cap (`max > 2×second` → `second×1.2` rounded to 5, min 5; zig-zag break + `N*`); footnote (Dec 2025 117-aircraft catch-up note; undated count); month labels thinned >18; card hidden with no months
- [ ] Install pace `renderSlTrend()` → `#sl-velo-stats` (`#sl-trend-pace`, `-pace-note` "N-wk trailing pace", `-eta` `~MON 'YY`, `-eta-note`); ETA denominator Express remaining only — `:3011-3057`; `computeInstallPace()` (`src/lib/starlink-utils.js`)
- [ ] Industry strip `renderSlIndustry()` from `/api/fleet-summary` `airlines[]`, sorted desc, UA amber; hidden unless every row finite — `:3353-3388`
- [ ] Hub Departures Board `renderSlRoutesBoard()` client-side from `STARLINK_FLIGHTS_BY_TAIL` — `:3176-3271`: `buildDeparturesBoard(flightsByTail, aircraftByTail, airborneByTail, HUB_CODES, {now, windowSec, graceSec:1800, hub, capPerHub})`; window 12 h / 48 h (`#sl-board-windows`); caps showAll ∞ / all-hubs 6 / single+48h 40 / single+12h ∞; pills ALL + 9 hubs with counts, `.sl-board-pill-empty`; bucket labels; "Show all · N more departures ▾"; row: hub-local time + relative, callsign + operator (strip " dba …") + tail (modal), route, type, `● Airborne`/`SCHED`, `📡 Track`; `#sl-board-updated` freshness; degraded → hidden + `#sl-board-note`; footer honesty text `index.html:716`
- [ ] `formatFlightTime(ts, iata)` hub-local + TZ abbrev, else viewer-local with label — `:2793-2803`
- [ ] Roster `renderSlTable()`: filters `#sl-search`, `#sl-filter-fleet`, `#sl-filter-type`, `#sl-filter-operator`, `#sl-filter-new`; sortable `[data-sl-sort]`; `#sl-filtered-count` — `:3391-3474`; Status/Next Flight columns hidden without live data; next flight = first dep `>= now - 1800` else last; `NEW` badge + red `!` integrity dot; filter change collapses expansion
- [ ] Row expansion `renderSlExpand()` one at a time: meta grid, up to 5 upcoming flights, actions Track / Aircraft Details / Planespotters — `:3477-3525`
- [ ] Verification Ledger `#sl-verification` — `:2869-3009`, `index.html:739-764`: `fetchStarlinkMismatches()` one-shot `/api/starlink-mismatches` (`disputed[]`, `summary{verifiedStarlink, disputed, unverified, totalPlanes, generatedAt}`), unexpected shape resets guard; hidden when no data; stat strip; integrity tripwire `getServedConflictTails()` (excluding `verifiedAt` after `STARLINK_SYNCED_AT`) → `⚠ INTEGRITY ALERT` role=alert; disputed table; `<details open>`
- [ ] Source footer "Starlink data via unitedstarlinktracker.com · <updated> · N aircraft" — `index.html:765`
- [ ] Empty/failed states — `:3395-3397, 3433-3436`

---

## 23. TAB — DELAYS · WEATHER · HUBS (`#tab-weather`)

- [ ] Two-panel `wx-layout` — `index.html:770-819`
- [ ] `#radar-map` own Leaflet (`[39,-97]` zoom 4, zoom bottomleft), CARTO + NEXRAD .6, `invalidateSize()` 200 ms; teardown before re-init — `main.js:3800-3812`
- [ ] `#radar-title` `🌧 NEXRAD Radar — HH:MM:SSZ` — `:3812, 4079-4081`
- [ ] Radar hub markers 9, neutral `#334155` until METAR, permanent tooltips `<b>HUB</b> CAT (reason)`, click highlights `.hub-card` 1500 ms — `:3814-3831, 4000-4006`
- [ ] `wx-legend` VFR/MVFR/IFR/LIFR, `CAT_COLORS = {VFR:#22c55e, MVFR:#eab308, IFR:#ef4444, LIFR:#c026d3}` — `index.html:777-782`, `:3542`
- [ ] `#wx-scroll-hint` "Hub Stations ↓" IntersectionObserver — `:4017-4029`
- [ ] `Promise.allSettled([fetchMetarBatch, /api/faa, /api/nas])` — `:3833-3842`; `fetchMetarBatch()` `/api/metar?ids=` chunks via `chunkMetarStationIds()`, `normalizeMetarPayload()` — `:3614-3625`, `src/lib/metar.js`
- [ ] Hub → station: EWR KEWR, IAH KIAH, ORD KORD, DEN KDEN, SFO KSFO, LAX KLAX, IAD KIAD, NRT RJAA, GUM PGUM — `:3793`
- [ ] Category = worse of API `fltCat` and `computeFlightCategory(raw)` (LIFR 0 < IFR 1 < MVFR 2 < VFR/UNK 3) — `:3875-3880`
- [ ] `computeOpsImpact(raw, cat)` → `weatherOpsByHub` feeds delay-risk — `:3886-3890`
- [ ] Hub card — `:3978-3998`: border = ops colour or category colour; code, `DE-ICE` badge, `cat-badge`; metrics Temperature/Wind/Visibility/Ceiling via `parseMetarQuick()` + `applyStructuredMetarFallback()` (`:3548-3600`); runway line `RWY: arr/dep · N/hr`; status precedence FAA programs (`describeFaaProgram()`) > severe > warning > caution > `✓ Normal Operations`; `▾ Details` (`hub-card-toggle`) with METAR explainer, FAA explainer, advisory links, NOTAM, raw METAR
- [ ] Skeletons for 9 hubs — `:3796-3798`; total-failure "🌦 Weather data unavailable" + `weather-retry` — `:4009-4011, 7449-7453`
- [ ] 5-minute refresh, skipped when hidden; rebuilds `faaDelayIndex`, hub-health bar, `weatherOpsByHub`, marker colours, radar timestamp — `:4031-4085`
- [ ] `explainMETAR(raw, hub, cat)` plain-English (16-point wind, vis, ceiling, phenomena, temp C/F, altimeter; assessment) — `:4331-4444`
- [ ] `explainFAAStatus(code, delays, raw)` — `:4446-4481`
- [ ] NAS STATUS panel `renderNasPanel()` inserted before `#wx-scroll-hint` — `:3629-3785`: `SEV_LABELS` GS/GDP/AFP/MIT/MINIT/CDR/SWAP/EDCT/FCA/DSP; `detectSevType()`; `sevBadgeClass()`; tiers critical/active/monitoring; header + count line; item badge, title, hub tags, detail; "View full ATCSCC advisory →" when `advisoryUrl`; hidden when empty
- [ ] IROPS section — §24
- [ ] Tracker briefing `#tracker-briefing` `updateTrackerBriefing()` — `:328-376`, `index.html:802-811`: data from `src/data/trackers/index.js`; generic copy vs home-hub briefing (`TRACKER_STATUS_LABEL`), deep links `/trackers/united-hubs/<hub>`, `/trackers/atc/<hub>` or `#row-<hub>`; watch state `localStorage.bb_tracker_watches`

---

## 24. IROPS DASHBOARD (Weather tab)

- [ ] `fetchIropsFromAPI()` `/api/irops` deduped `_iropsPromise` — `main.js:6031-6051`
- [ ] `renderIropsFromAPI(data)` reads `score, cancellations, delayed30, delayed60, diversions, totalFlights, hubMetrics{…}` — `:6053-6130`
- [ ] `iropsRateFloor(total, cancellations)` = `total >= 10 || cancellations >= 3` — `src/lib/irops-score.js:10-12`, applied `:6062-6075`
- [ ] Single-writer (F002): `iropsServerValuePresent` short-circuits `updateIrops()` — `:5681, 5943, 6119-6121`
- [ ] Client fallback `updateIrops()` today departures only, `est · loaded boards` tag — `:5939-6024`
- [ ] Score `((c*3 + d60*2 + (d30-d60) + div*2)/total)*100` 1 dp — `irops-score.js:18-22`; labels `<5 low NORMAL OPERATIONS`, `<15 med MINOR DISRUPTION`, else `high SIGNIFICANT DISRUPTION` — `:24-29`
- [ ] Bar layout: label + chip + `?` tooltip, Cancellations / >30m / >60m / Diversions / Total — `:5991-6007, 6102-6115`; client path appends `.irops-bar-faa` — `:6009-6018`
- [ ] `lastIropsScore` → ticker; `announceIropsLevelChange()` + `updateTicker()` — `:6021-6023, 6122-6124`; copy "Loading schedule data…" / "IROPS unavailable" — `:5961, 6049`

---

## 25. TAB — STATS / ANALYTICS (`#tab-analytics`)

- [ ] `#analytics-metrics` 4 cards: Flights Airborne, Fleet Utilization %, Avg Fleet Age, Starlink Coverage % ("N of M airborne") — `main.js:4105-4110`
- [ ] `#util-chart` per type (19 order), colour `>60 #22c55e / >30 #005DAA / >0 #f59e0b / 0 #334155`; small stat text uses amber not blue — `:4112-4139`
- [ ] `#phase-chart` SVG donut (r 36, stroke 12, ×2.26) + legend — `:4141-4181`
- [ ] `#hub-matrix` 9×9 + TOTAL, diagonal blank, bg `rgba(0,93,170, max(.15, v/max))` — `:4183-4222`
- [ ] `#route-heatmap` top 15 pairs; empty "Waiting for flight data…" — `:4224-4243`
- [ ] `#avg-age-chart` width `avg/30`, colour `>20 #ef4444 / >15 #f59e0b / >8 #005DAA / #22c55e` — `:4245-4266`
- [ ] `updateAnalytics()` on tab switch + every 30 s while active — `:575, 1296`; headers "updates every 30s" — `index.html:827, 832`

---

## 26. TAB — SOURCES (`#tab-sources`)

- [ ] 10 static `.source-item` cards (icon, name, freshness pill, description, links) — `index.html:854-955`: FR24 (LIVE), AeroDataBox (LIVE), United Fleet Site + Google Sheet (DAILY), @martinamps Starlink tracker (label LIVE, class `fresh-daily` — `:888`), AWC (LIVE), Iowa State NEXRAD (LIVE), CARTO/OSM (TILES), FAA NAS (LIVE), Route Estimation (COMPUTED), r/UnitedAirlines
- [ ] Bottom disclaimer block — `:952-954`. `tests/compliance.test.js` requires the panel to contain AeroDataBox, CARTO, OpenStreetMap.

---

## 27. MODALS (lazy JS)

### Aircraft detail (`#aircraft-detail-modal`)
- [ ] Opened by `aircraft-detail` from popup, fleet/airborne tables, special panel, schedule rows, My Flights, Starlink rows/board, FR24 modal — `main.js:7661-7665`
- [ ] `showAircraftDetail(reg)` normalize; dialog; backdrop + Escape — `:8362-8399`; not-in-DB state + Planespotters — `:8382-8395`
- [ ] `buildAircraftDetailHTML()` — `:8401-8521`: header tail (jargon), type (jargon), `AC# N`, ⭐/⚡ badges; biography grid Delivered (+age), Total Seats, WiFi, IFE, Power, Engine, Starlink, Config; status via `categorizeFleetStatus()`; Live Status block (`focus-live-flight`) or "On ground / Not currently tracked"; seat blocks + proportional bar `SEAT_BAR_COLORS` (labels >8 %) — `:8256-8260`; footer Watch (airborne), Planespotters, FlightAware registration, Share

### AI delay explanation (`#delay-explain-modal`)
- [ ] `showDelayExplanation(ctx)` dialog z 10001 — `:8263-8315`; header flight, risk badge (`V.HIGH #dc2626`, `HIGH #ef4444`, `MOD #eab308`, else `#22c55e`), `route · Score N/100`; shimmer "Analyzing delay risk…" then text + "Contributing Factors" list; `ctx.hubTime` from `SCHED_HUB_TZ[hub]` — `:8281-8286`
- [ ] `POST /api/delay-explain` `{flight, route, status, riskLabel, riskScore (omitted when NaN — F011), factors, hub, otp, weather, destWeather, faaStatus, inbound, irops, hubTime, connection}`; reads `explanation` (textContent), `error` — `:8317-8360`; footer "Powered by Claude AI"

### FR24 lookup (`#fr24-modal`)
- [ ] `lookupFR24Flight(query)` normalizes; loading card; `GET /api/fr24-flight?flight=` — `:8524-8566`; failure never blocking: writes into `#global-search-error` — `:8544-8565`
- [ ] `renderFR24Modal(f, source, cached, meta)` reads `flight.{flightNumber, callsign, status, origin{iata,name}, destination{…}, aircraft{type,reg}, departure{scheduled,actual}, arrival{scheduled,estimated}, position{lat,lon,alt,speed,heading}}` + `meta.{liveLeg, legDate}` — `:8568-8659`; status colours `en-route #22c55e`, `on-ground #f59e0b`, `landed #3b82f6`, else `#6b7280`; leg-date disclaimer (F048); fleet cross-reference; footer "Powered by Flightradar24 Official API (• cached)" + Share

---

## 28. `/api/*` CONTRACT (frontend view)

| Endpoint | Params/body | Fields read | Caller |
|---|---|---|---|
| `/api/fr24-feed` | GET `?airline=UAL` | `parseFr24Feed()`; header `X-BB-Feed-Stale` | main.js:1193 |
| `/api/flight-times` | GET `?flight=` | `success, source, registration, aircraft, cancelled, diverted, departure.{gate,takeoff}.{actual,estimated,scheduled}, arrival.{gate,landing}.{…}, origin.{iata,terminal,gate,tz}, destination.{…}` | :1580, 6419, 7158 |
| `/api/predict-flight` | GET `?flight_number=` | `probability, n_observations, confidence` | :1779 |
| `/api/check-flight` | GET `?flight_number=&date=YYYY-MM-DD` | same; `confidence:'predicted'` → forecast | :1780 |
| `/api/starlink-data` | GET | `aircraft[], flightsByTail{}, fleetStats{mainline, express, total, mainlineTotal, expressTotal, mainlinePct, expressPct}, lastUpdated, syncedAt` | :140 |
| `/api/fleet-summary` | GET | `airlines[{code,name,installed,total,percentage}]` | :141 |
| `/api/starlink-mismatches` | GET | `disputed[{tail, aircraft, operator, verifiedAs, verifiedAt, dateFound}], summary{…}` | :2875 |
| `/api/metar` | GET `?ids=` | normalized `{icaoId, rawOb, fltCat, temp, wspd, wdir, visib, clouds[], cover}` | :3619 |
| `/api/faa` | GET | `[{airportCode, delays[{type, reason, avgDelay, minDelay, maxDelay, startTime, endTime, trend}], programs[{type, reason, advisoryUrl, probabilityOfExtension}], runwayConfig{…}, deicing, notam, groundStop, groundDelay, departureDelay, arrivalDelay, closure}]` | :3837, 4040, 5899 |
| `/api/nas` | GET | `active[{name, reason, avgDelay, endTime, affectedFacilities[]}], planned[{event, decoded, time, type, affectedAirports[]}], advisoryUrl` | :3838, 4041 |
| `/api/schedule` | GET `?hub=&dir=&timestamp=` | `flights[], total, cached, partial, degraded, stale, error, meta{dataAge, completeness, partialReason, pagesFailed, liveFeedFallbackAdded, generatedAt, hubDisruptionMinutes}` + headers `Date`, `Age` | :4661 |
| `/api/irops` | GET | `score, cancellations, delayed30, delayed60, diversions, totalFlights, hubMetrics{…}` | :6043 |
| `/api/aircraft-history` | GET `?reg=` | `success, segments[{flightNumber, origin, destination, delayMin, status}]` | :6568 |
| `/api/push-subscribe` | GET / POST | `{configured, vapidPublicKey}` / subscribe+unsubscribe bodies | :6175, 6210, 6227 |
| `/api/delay-explain` | POST | `explanation`, `error` | :8326 |
| `/api/waitlist` | POST `{email, source:'popup', featureRequest?}` | `success`, `error` | :8090 |
| `/api/fr24-flight` | GET `?flight=` | `success, flight{…}, source, cached, error, meta{liveLeg, legDate}` | :8541 |
| `/api/support-stats` | GET | `boards{used,budget}, liveFeed{configured, usedPct}, monthlyCostNote` | support-meter.js:71 |
| `/data/fleet.json` | static | `[{r, t, a, c, tot, w, i, d, s, p, seats{}}]` | :139 |
| `/data/starlink.json` | static fallback | `[{tail, fleet, type, operator, dateFound}]` | :160 |
| `/data/news-latest.json` | static | `[{title, slug}]` | news-banner.js:7 |

- [ ] Not called by the dashboard: `api/fleet.ts`, `api/tsa.ts`, `api/fr24-usage.ts`, `api/news-notify.ts`, all `api/cron/*`.

---

## 29. STORAGE KEYS

| Key | Store | Value | Written |
|---|---|---|---|
| `bb_home_airport` | local | IATA | main.js:299-302 |
| `bb_tracker_watches` | local | `[{slug,id}]` (read here; written by tracker pages) | :321 |
| `bb_reg_ledger_v1` | local | `{flightNum:{reg, seenAt}}` | :505-511 |
| `bb_watched_flights` | local | `[{flight, route, status, ts}]` ≤20 | :6241-6245 |
| `watchedFlights` | local | legacy read | :5869 |
| `bb_push_prompted` | local | `'1'` | :7499, 7503 |
| `bb_sched_<hub>_<dir>_<day>` | local | swap snapshot | :5599-5621 |
| `bb_tips_dismissed` | local | epoch, 7 d | :7754-7785 |
| `bb-visited` | local | `'1'` | :8243 |
| `bb-onboarded` | local | `'1'` | :7934 |
| `bb_onboarding_dismissed` | local | epoch, 7 d | :7935 |
| `bb_waitlist_submitted` | local | `'true'` | :8101 |
| `bb_waitlist_dismissed` | local | epoch, 7 d | :7976 |
| `bb-bmac-dismissed` | local | epoch, 14 d | :7589 |
| `news_dismissed_slug` | local | slug | news-banner.js |
| `bb_sched_preload_ts` | session | epoch, 10 min | :4628-4652 |

- [ ] Every write try/catch — `:511, 5622, 6245`

---

## 30. TIMERS

Clock 1 s (:908); feed 30 s + ladder (:1058-1067, 1271-1286); weather 5 min (:4031-4085); My Flights countdown 1 s (:6471); ticker fade 5 s (:833-850); tip 45 s (:7777); news 6 s; placeholder 4 s (:7829); waitlist 5 min (:8178); BMAC 3 s (:8204); fleet deep-link poll 200 ms/10 s (:655-661); idle preload rIC/5 s → `preloadScheduleData`, `fetchIropsFromAPI`, `preloadWeatherAndFAA` (:7872-7875)

---

## 31. `src/lib/*` — EXISTS vs STILL IN main.js

### Imported by main.js (30 imports, `main.js:1-30`)
`delay-risk.js` (`computeDelayRiskModel`, `HUB_COORDINATES`, `HUB_RISK_PROFILES`; main.js builds inputs `:6953-6981, 6983-7014, 6912-6951, 7021-7034`), `connection-risk.js` (`classifyConnection`, `MIN_CONNECTION_TIMES`, `TERMINAL_WALK_TIMES`; main.js keeps MCT key/walk/card `:7078-7144`, pairing `:7037-7076`), `irops-score.js`, `swap-impact.js`, `ops-health.js`, `starlink-utils.js`, `schedule-status.js` (`classifySchedStatus`, `OPERATED_GRACE_SECONDS` 3600 extended under GDP; `classifyOptsFor/ForKey/metaForHubDir` `:4503-4514`), `schedule-board-filters.js`, `schedule-filters.js`, `board-stats.js`, `board-now.js`, `status-display.js`, `feed-health.js`, `reg-ledger.js`, `reg-overlay.js`, `fleet-utils.js`, `fleet-match.js`, `metar.js`, `metar-category.js`, `airport-metadata.js`, `hubTz.js`, `time-format.js`, `data-age.js`, `delay-format.js`, `delay-explain-context.js`, `flight-popup.js`, `flight-status-resolve.js`, `escape.js`, `basemap.js`, `src/data/trackers/index.js`.

### Still only in main.js (extract first)
- [ ] `getPhase`, `getPhaseGroup`, `decodeSquawk`, `estimateRoute`, `haversine`, `bearing`, `angleDiff`, `greatCirclePoints`, `normalizeLonContinuity`, `isLonghaulFlight`, `createPlaneIcon` — `:912-1006, 1330-1373, 1711-1751`
- [ ] `parseMetarQuick`, `applyStructuredMetarFallback`, `formatStructuredVisibility`, `hasRenderableMetarData`, `explainMETAR`, `explainFAAStatus`, `buildFaaIndex`, `getFAADelayContext`, NAS severity classifiers — `:3548-3612, 3629-3785, 4331-4481, 5810-5821, 6133-6151`
- [ ] `updateHubHealth` OTP math + arbitration — `:5739-5802`
- [ ] `isRecentlyFound`, `getServedConflictTails`, `formatFlightTime`, `getStarlinkAirborneMap` — `:2779-2815, 2906-2923`
- [ ] `isSignificantStatusChange`, `getMyFlightTimeCacheTTL`, `getMyFlightCacheJitter` — `:6373-6391, 7191-7204`
- [ ] `buildJourneyChainHtml` / `buildJourneyContextStr` — `:6480-6548`
- [ ] `jargonTerm` + clamp — `:50-82`
- [ ] Also embedded data: `AIRPORTS` (150, `:218-293`), `UA_ROUTES` (`:404-462`), `IATA_CITIES` (`:465-498`), `SPECIAL_AIRCRAFT` rules, `ENGINE_BY_TYPE`, `TIPS`, `ICAO_TO_FLEET_TYPE`, `SEV_LABELS`, `CAT_COLORS`, `SEAT_BAR_COLORS`

### Lib not used by dashboard: `agent-markdown.js`, `agent-negotiation.js`, `accept-negotiation.js`, `site-routes.js`, `buildMetadata.js`, `starlink-facts.js`, `tracker-detail.js`, `tracker-downloads.js`, `tracker-map.js`

### Duplication to consolidate (flag)
- [ ] Coordinates ×3: `AIRPORTS`, `HUB_COORDINATES` (`delay-risk.js:13-23`), `INTL_AIRPORTS`/`US_AIRPORTS` (`airport-metadata.js`)
- [ ] Timezones ×2: `SCHED_HUB_TZ` (`:4484`) vs `HUB_TZ` (`hubTz.js`)
- [ ] 19-entry `typeOrder` ×4 (`:2171, 4113, 4272`, index.html:546)
- [ ] Hub list ×9+ (`:2034, 3627, 3794, 4184, 5687, 5740, 5853, 7578`, index.html:230)
- [ ] `IATA_CITIES` vs `AIRPORTS` misaligned

---

## 32. `style.css` — BEHAVIOUR-ENCODING RULES

- [ ] Z-index ladder — `style.css:25-35`: `#map 0` · `.tab-content` 750 · `#attribution` 710 · `#controls` 712 · `#stats-bar` 715 · `#tab-bar` 760 · `#legal-details` 760 · banners 765 · `#header` 770 · `#global-search-results` 775 · `#legalpop` 780 · `#mobile-more-menu` 781 · `#watch-panel` 9999 · modals 10000/10001/10002 · skip-link 100000. Leaflet panes (200-700) below chrome because `#map{z-index:0}` and `.tab-content.active{z-index:1}` create stacking contexts.
- [ ] `#map{position:fixed;inset:0;z-index:0}` + vignette — `:37-38`
- [ ] Leaflet overrides: attribution `:216-218`; marker hit-area `::after{inset:-5px}` `:225-231`; popup (44×44 close, `min-width:280px`) `:234-238`; tooltip `:315`
- [ ] Reduced motion — `:855-862`, `:1315`, `:1371`
- [ ] Breakpoints 500 / 600 / 768 / 900 / 769–1080 — `:156, 368, 675, 782, 865, 1087, 1116, 1134, 1220, 1238, 1268, 1351`
- [ ] `env(safe-area-inset-*)` — `:1001, 1012`
- [ ] `100dvh` table heights `#sched-table-wrap{max-height:calc(100dvh - 320px)}` / mobile 360; `.sl-table-wrap` — `:847, 944-945`
- [ ] `#tab-schedule .card[style*="overflow:hidden"]{overflow:visible!important}` — `:852`
- [ ] Sibling-selector banner stacking — `:913-918`; hub-health mask — `:887-888`; 44 px targets — `:936-938, 927, 237`; `.fleet-table-wrap` touch scroll — `:945`
- [ ] Keyframes: `tickerScroll, blink, pulse ×2, bounce, liveShimmer, fadeIn, ctrlPanelIn, schedRowHighlight, obFadeIn, equipFlash, shimmerSlide`
- [ ] No print stylesheet. Dark-only `color-scheme:dark` + `body{background:#0B1018}` — `index.html:2, 94`

---

## 33. SEO / A11Y STRUCTURES TO SURVIVE

- [ ] `<html lang="en" style="color-scheme:dark">` — `index.html:2`
- [ ] Hub registry comment (lines 3-34)
- [ ] Meta: charset, viewport `viewport-fit=cover`, theme-color, SVG data-URI favicon, manifest, apple-touch-icon, 4 web-app metas, title, description, author, robots, 11 OG (incl. `og:image:alt`), 6 twitter, canonical, sitemap, RSS — `:36-71`
- [ ] Resource hints: dns-prefetch unpkg/mesonet/carto c,d; preconnect carto a,b + unpkg; 3 font preloads; preload dashboard.js + style.css — `:72-89` (unpkg goes away when Leaflet is bundled)
- [ ] `@font-face` ×3 + critical body CSS — `:90-95`
- [ ] Leaflet unpkg with SRI — `:85-86` (retire)
- [ ] Skip link — `:98`
- [ ] `<noscript>` block: prose, 9 hub links, 4 resource links, byline — `:132-157`
- [ ] Crawlable brief `<section class="sr-only" aria-labelledby="page-brief-title">` with the page `h1`, intro, "What you can check here" (6 `<li>`; drop the TSA one), "How to use this site" with llms/sitemap links + `Accept: text/markdown` note; keep `agent-markdown.js` in step — `:158-180`
- [ ] Crawlable nav `<nav class="sr-only">` 15 links — `:181-198`
- [ ] sr-only fleet summary with build-stamped Starlink string — `:544-547`
- [ ] Six JSON-LD at end of body: Organization, WebPage (`__HOME_LASTMOD__`), WebApplication (14-item featureList), FAQPage (8; one Starlink-stamped), Dataset (`__HOME_LASTMOD__`, `variableMeasured`), WebSite (SearchAction) — `:1010-1227`
- [ ] `<main>` wraps tab panels only (`:346`–`:959`)
- [ ] Script order: dashboard.js (defer), insights, sw-register, support-meter, JSON-LD, news-banner — `:957, 1007-1009, 1228`

---

## 34. INIT SEQUENCE

- [ ] `initApp()` — `main.js:7793-7876`: badge/home-hub/tracker briefing → My Flights wiring → `initMap()` (drawHubs, refreshFlights, timer) → `await loadFleetData()` (awaited; then Starlink control state, stats, popup re-render, ticker, `initFleetTab()`, `?aircraft=`, config gallery) → `switchToTab(activeTab, false)` → idle preload
- [ ] Bootstrap guard `DOMContentLoaded` — `:7880-7884`
- [ ] `loadFleetData()` parallel `/data/fleet.json`, `/api/starlink-data`, `/api/fleet-summary`; fallback `/data/starlink.json`; `fleetLoadFailed`; rebuilds `STARLINK_TAILS`, `FLEET_BY_REG`, `SPECIAL_AIRCRAFT` — `:133-181`
- [ ] `preloadWeatherAndFAA()` deduped; extra METAR stations from watched routes + `schedRawByHub` via `getMetarStationForIata()`; populates `weatherOpsByHub`, `faaDelayIndex` — `:5843-5937`
- [ ] `window.*` exports (`loadScheduleData`, `escapeHtml`, `focusWatchedFlight`, `hideDisclaimer`, `schedCache`); `focusWatchedFlight` still used by Notification onclick — `:8661-8666`

---

## 35. DISCREPANCIES / DEAD CODE (decide during port)

- [ ] `index.html:282` claims JS legal handlers; none exist
- [ ] `#sched-pagination` dead — `index.html:537`
- [ ] Hub registry comment points at `api/irops.js`, `public/hubs/*.html`
- [ ] Sources tab Starlink tracker "LIVE" label with `fresh-daily` class — `index.html:888`
- [ ] Static hub-health tooltip omits FAA blend legend
- [ ] `splitAtAntimeridian()` no-op — `main.js:1748-1751`
- [ ] `#sched-more-filters-btn` static vs JS label — `index.html:456` vs `main.js:7325`
- [ ] `#myflight-empty` dangling "OR" — `index.html:354`
- [ ] `#fleet-config-empty` duplicated (HTML `:598-605` vs `showConfigEmpty()` `:2628-2638`)
