# Task 7 — My Flights + watch list + push + AI delay-explain + FR24 lookup

**Worktree:** `/Users/jonahberg-ganzarain/bb-audit/.claude/worktrees/agent-a1818aeb96ae33381`
**Branch:** `worktree-agent-a1818aeb96ae33381` (merged from `feat/shadcn-rebuild` @ `1ca5d08`; the
worktree was created from `main` @ `06b77a7`, so `git merge feat/shadcn-rebuild` ran first)

> Written in-worktree because the shared-checkout path
> `/Users/jonahberg-ganzarain/bb-feat/shadcn-rebuild/.superpowers/…` is outside this agent's
> worktree and is not writable from here. Same relative path — please copy it across.

**Commits (4):**

| SHA | Subject |
|---|---|
| `5f46043` | `feat(lib): My Flights, connection, delay-explain, FR24 and prediction models` |
| `f4637cb` | `feat(dialogs): AI delay explanation, FR24 lookup, and the push opt-in flow` |
| `d874390` | `feat(my-flights): the My Flights tab — cards, journey, connections, checker` |
| *(final)* | `feat(my-flights): port My Flights, watch list, push, AI explain, FR24 lookup` |

---

## What was implemented

Seven new pure `src/lib` modules with vitest files, two replaced dialogs, the replaced My
Flights view plus eight files under `src/app/views/myflight/`, and the completion of the
watch/push flow. Behaviour lives in `src/lib`; the TSX chooses layout.

**New `src/lib` modules** (all tested; 147 new tests):

- `my-flights.js` — countdown maths, status/pending chips, gate labels, route resolution +
  backfill flag, seat config, quick-add parsing, live-flight and inbound-aircraft lookups.
- `connection-pairing.js` — the cross-join, MCT key + walk time, the two-sided connection
  index, the AI context sentence, the manual checker's three-way outcome, the detail line
  (including the MCT honesty clause).
- `delay-explain-request.js` — the POST body (F011), `iropsContextStr`, `weatherContextStr`,
  `hubLocalTime`, `riskLabelColor`.
- `fr24-lookup.js` — query normalisation, status palette, F048 leg disclaimer, time
  formatting, attribution, the non-blocking failure sentence.
- `starlink-prediction.js` — the forecast badge bands and low-data demotion.
- `board-risk.js` — `computeScheduleRowRisk` / `findBoardRiskForFlight`, matching
  `useBoardModel.ts:311-350` input-for-input.
- `watch-utils.js` (additive) — `watchAlertsFootnote()`, the four §6 copy tiers.

---

> **On the line numbers below:** file paths are exact. Line numbers were written while
> building the map and only the anchors listed at the end of this report were re-grepped
> afterwards; the rest may drift by up to ~15 lines. Search for the quoted symbol or string
> rather than trusting the number.

## §19 — TAB: MY FLIGHTS

| Spec item | Where |
|---|---|
| Empty state `#myflight-empty` + `#myflight-search` quick-add | `src/app/views/myflight/QuickAdd.tsx:78-116` |
| Quick-add Enter normalizes `UA` prefix | `src/lib/my-flights.js:199-207` (`parseQuickAdd`), wired `QuickAdd.tsx:69-75` |
| Placeholder rotator, 4000 ms, 300 ms fade, paused on focus | `QuickAdd.tsx:37-47, 60-68`; list `src/lib/my-flights.js:21-24` |
| `renderMyFlights()` render-token guard | Generation refs: `useFlightTimes.ts:84-113`, `useAircraftJourney.ts:52-73`, `DelayExplainDialog.tsx:56,70-71`, `Fr24LookupDialog.tsx:96-99` |
| Parallel `preloadWeatherAndFAA()` + `fetchIropsFromAPI()` | Now the providers' own eager load (`state/weather.tsx:115`, `state/irops.tsx:56`) — consumed at `MyFlightsView.tsx:70-73` |
| One `/api/flight-times?flight=` per watched flight | `useFlightTimes.ts:88-102` |
| Flight-times cache TTL ladder + jitter | `flightTimesCacheTtl()` imported at `useFlightTimes.ts:17`, applied `:107` |
| `MY_FLIGHTS_FAIL_TERMINAL = 2` → "STATUS UNAVAILABLE" chip | `src/lib/my-flights.js:18`, `:63-72`; rendered `FlightCard.tsx:108-112` |
| …+ united.com note | `FlightCard.tsx:176-190` |
| Status chip via `resolveFlightStatus` (7 states) | `MyFlightsView.tsx:141`; chips `src/lib/my-flights.js:45-58` |
| Countdown to boarding (dep−30 min) then departure | `src/lib/my-flights.js:99-109` |
| "Expected to depart" | `src/lib/my-flights.js:100, 106` |
| to-arrival / "Arriving" | `src/lib/my-flights.js:89-95` |
| "Landed" | `src/lib/my-flights.js:86` |
| Backfills `watched.route` | `MyFlightsView.tsx:243-254` via `watch.updateRoute` (effect, not render) |
| Gate grid `T<term> Gate <gate>` + `getUnitedTerminal()` fallback | `src/lib/my-flights.js:154-172`; rendered `FlightCard.tsx:192-197` |
| Equipment grid: matched type + reg link, seats | `FlightCard.tsx:199-216` |
| `⚡ Starlink Confirmed` / `⚡ Checking…` | `FlightCard.tsx:217-226`, `StarlinkBadge.tsx:76-92` |
| Unmatched → forecast badge `data-mode="forecast"` | `FlightCard.tsx:229-233` (`forecast` prop), `src/lib/starlink-prediction.js:36-68` |
| "Tail not yet assigned" | `FlightCard.tsx:235-237` |
| Provenance chip `via schedule snapshot` when `source==='schedule-cache'` | `FlightCard.tsx:241-245` |
| Actions View on Map / Aircraft Details / Explain Delay Risk / Unwatch | `FlightCard.tsx:283-320` |
| `updateMyFlightsCountdowns()` 1 s while active, cleared on leave | `MyFlightsView.tsx:76-83` (gated on `tab === 'myflight'`; interval cleared on leave) |
| Risk badge: `computeDelayRisk()` → `findBoardRiskForFlight()` → grey `RISK N/A` | `MyFlightsView.tsx:160-192`; rendered `FlightCard.tsx:146-172` |
| Risk/explain data-attrs (14 fields) | `MyFlightsView.tsx:196-214` (object form; `openDelayExplain`) |
| `fetchAircraftJourney(reg)` → `/api/aircraft-history?reg=`, 5-min cache | `useAircraftJourney.ts:24, 56-72, 76-80` |
| Failures cache `[]` → "Flight history unavailable" | `useAircraftJourney.ts:60-67`; rendered `JourneyChain.tsx:50-56` |
| `buildJourneyChainHtml()` ≤3 prior segments, delay classes | `JourneyChain.tsx:58-104`; shaping via `shapeJourney`/`journeyDelayClass` |
| `buildJourneyContextStr()` back-fills `data-inbound` | `MyFlightsView.tsx:147-149`, fed to `explainContext.inbound` `:213` |
| "Where's My Plane?" inbound card (same reg, diff flight, dest === origCode, airborne, own flight not airborne) | `src/lib/my-flights.js:231-248`; rendered `FlightCard.tsx:257-267` |
| `detectAndRenderConnections()` cross-join, hub in HUB_CODES, `0 < gap < 480` | `src/lib/connection-pairing.js:33-58`; wired `MyFlightsView.tsx:103-113` |
| `computeConnectionRisk()` mctKey via `INTL_AIRPORTS`, MCT default 60 | `src/lib/connection-pairing.js:72-84` |
| walk 5 same terminal else `TERMINAL_WALK_TIMES[hub][sortedPair]` or default 10 | `src/lib/connection-pairing.js:86-93` |
| Verdicts scored / insufficient / disrupted | delegated to `classifyConnection`, `connection-pairing.js:95-112` |
| Card copy honesty clause | `src/lib/connection-pairing.js:230-236` |
| `connectionIndex[flight]` for both legs → `data-connection` | `src/lib/connection-pairing.js:120-145`; consumed `MyFlightsView.tsx:194, 212` |
| Manual checker `#myflight-check` / `#conn-inbound` / `#conn-outbound` / Check / `#conn-manual-result` | `ConnectionPanel.tsx:150-196` (ids preserved) |
| `checkManualConnection()` normalizes UA, fetches both | `ConnectionPanel.tsx:99-118`; `normalizeConnectionFlight` |
| Three-way: feed outage vs not-found vs not-connecting | `src/lib/connection-pairing.js:178-215` |
| Enter submits | `ConnectionPanel.tsx:141-146` (both inputs) |

## §6 — WATCH PANEL + PUSH

| Spec item | Where |
|---|---|
| `#watch-panel` header + `Clear All` + list | `shell/WatchPanel.tsx:84-140` |
| `MAX_WATCHED = 20`, key `bb_watched_flights` `[{flight,route,status,ts}]` | `state/watch.tsx:16,149` via `watch-utils.js` (untouched) |
| Legacy `watchedFlights` read in weather preload | Task 2/Weather — **not mine**, unchanged |
| `toggleWatchFlight` fan-out → save → re-render → markers → toast → `syncPushSubscription()` | `state/watch.tsx:139-158` (+ `announce` at the call sites: `MyFlightsView.tsx:268,278`, `WatchPanel.tsx:129`) |
| `syncWatchButtons()` re-render of every toggle | React re-render off the shared store — no DOM sweep needed |
| `#watch-badge` count, hidden at 0 | `shell/Header.tsx` (Task 2) — verified live, shows `2` |
| Outside-click closes panel | Radix `Sheet` |
| `showWatchNotification(msg)`, auto-hide 10 000 ms | `views/schedule/WatchBanner.tsx:21,30-34` (Task 3; reused) |
| Push prompt 500 ms after FIRST add when `!bb_push_prompted` and permission `default` | `WatchPanel.tsx:27` (`PROMPT_DELAY_MS`), applied `:37-46` |
| …auto-hide 15 000 ms | `WatchPanel.tsx:28` (`PROMPT_VISIBLE_MS`), applied `:43` |
| `enable-push` → `requestPermission()`; grant → toast + sync | `state/watch.tsx:212-222`, `WatchPanel.tsx:72-80` |
| both actions set `bb_push_prompted='1'` | `state/watch.tsx:206-210` (`markPrompted`), called by `enable()` and `dismissPrompt` |
| `bbPushBootstrap()` GET → `{configured, vapidPublicKey}`; failure → `{configured:false}` | `state/watch.tsx:87-95`; `data/api.ts:222-228` (never throws) |
| `syncPushSubscription()` guards + unsubscribe/subscribe POST bodies | `state/watch.tsx:110-145`; bodies typed `data/api.ts:230-239` |
| …never throws | `state/watch.tsx:141-143` |
| `renderWatchAlertsFootnote()` 4 copy tiers | `src/lib/watch-utils.js:71`; rendered `WatchPanel.tsx:131` |
| `checkWatchedFlightChanges(flights)` semantics | **Task 3's** — verified: `state/schedule.tsx:309` (`isSignificantStatusChange`), `:318` (native `Notification` when hidden), `:341` (`updateStatus`), `watchAlert` → `WatchBanner`. Not duplicated. |

## §27 — AI delay explanation

| Spec item | Where |
|---|---|
| Dialog `aria-label="AI delay risk explanation"` | `DelayExplainDialog.tsx:104` |
| Header flight + risk badge coloured by label (`V.HIGH`/`HIGH`/`MOD`/else) | `DelayExplainDialog.tsx:108-121`; colours from `RISK_BANDS` via `riskLabelColor()` |
| `route · Score N/100` | `DelayExplainDialog.tsx:122-124` |
| Shimmer "Analyzing delay risk…" | `DelayExplainDialog.tsx:128-137` |
| Explanation via `textContent` | `DelayExplainDialog.tsx:140` (React text child — never HTML) |
| "Contributing Factors" from `\|`-split factors | `DelayExplainDialog.tsx:149-165`; `asFactors()` |
| `ctx.hubTime` from hub tz at OPEN time | `DelayExplainDialog.tsx:76-79`; `hubLocalTime()` |
| POST body exact, `riskScore` omitted when NaN (F011) | `src/lib/delay-explain-request.js:110-133` |
| Error field | `DelayExplainDialog.tsx:82-86, 143-148` |
| Footer "Powered by Claude AI" | `DelayExplainDialog.tsx:165` |
| Escape closes | Radix `Dialog` — verified live |

## §27 — FR24 flight lookup

| Spec item | Where |
|---|---|
| Normalise query (`UAL123`→`UA123`, bare digits → `UA<n>`) | `src/lib/fr24-lookup.js:36-42` |
| Loading card | `Fr24LookupDialog.tsx:186-192` |
| `GET /api/fr24-flight?flight=` | `Fr24LookupDialog.tsx:113` |
| Failure never blocking → closes + writes the error out | `Fr24LookupDialog.tsx:103-110` (`announce` + non-modal line `:287-302`) |
| Status colours from a `src/lib` constant | `src/lib/fr24-lookup.js:13-19`; used `Fr24LookupDialog.tsx:135-136` |
| Leg-date disclaimer (F048) | `src/lib/fr24-lookup.js:57-79`; rendered `Fr24LookupDialog.tsx:216-229` |
| Fleet cross-reference | `Fr24LookupDialog.tsx:142-144, 261-267` |
| Footer "Powered by Flightradar24 Official API (• cached)" | `src/lib/fr24-lookup.js:107-109`; `Fr24LookupDialog.tsx:287` |
| Share | `Fr24LookupDialog.tsx:146-160, 289-299` |
| `FR24_LOOKUP_AVAILABLE = true` | `Fr24LookupDialog.tsx:56` |
| Other §27 modals (aircraft detail) | **Task 5** — unchanged, verified opening from a card |

## §1 / §4 / §16 / §17 / §28 / §29 / §30 touchpoints

| Item | Status |
|---|---|
| §1 `#watch-header-btn` + badge | Task 2's; verified live (badge `2`) |
| §4 palette FR24 row gated on `FR24_LOOKUP_AVAILABLE` | Lit up by the flag flip; no edit to `SearchPalette.tsx` |
| §16 `?flight=` → FR24 when no live match | `state/deep-links.ts:146` — unchanged; verified live with `?flight=UA9999` and `?flight=UA200` |
| §17 Escape closes both dialogs | Radix; verified |
| §17 single polite announcer | FR24 failure line is plain markup with **no** `aria-live` — `announce()` is the one writer |
| §28 `/api/flight-times`, `/api/aircraft-history`, `/api/push-subscribe`, `/api/delay-explain`, `/api/fr24-flight` | Unchanged wire shapes; see "Deviations" 5–6 |
| §29 `bb_watched_flights` cap 20, `bb_push_prompted` | Byte-for-byte via `watch-utils.js`; verified in `localStorage` live |
| §30 1 s countdown while the tab is active | `MyFlightsView.tsx:76-83` |

---

## Additive edits outside my files (all listed, all deliberate)

1. **`src/lib/delay-risk.js`** — one word: `const RISK_BANDS` → `export const RISK_BANDS`, plus a
   comment. No behaviour change; the existing `tests/delay-risk.test.js` still passes unchanged,
   and `tests/delay-explain-request.test.js:14-23` now pins the table's contents. Needed because
   the AI dialog is handed a context (a LABEL), not a score, and must colour its badge to agree
   with the badge that was clicked — one table, two readers.
2. **`src/lib/watch-utils.js`** — added `watchAlertsFootnote()` (§6's four tiers). It began in
   `WatchPanel.tsx`, but vitest has no `@` alias so an app-file export is untestable; `watch-utils.js`
   is the §6 module and is where the project rule says behaviour belongs. Covered by
   `tests/watch-footnote.test.js` (6 assertions).
3. **`src/app/state/watch.tsx`** — `bootstrapped`, `backgroundActive`, `updateRoute()`, and
   `enable()` now returns the browser's answer. All additive; no existing field changed shape.
4. **`src/app/shell/WatchPanel.tsx`** — footnote tiers; prompt moved outside the Sheet; the
   `configured` gate on the prompt removed; per-entry status text shown. See "Deviations".
5. **`src/app/data/api.ts`** — `AircraftHistory.segments[].delayMin`/`status` made required, and
   `Fr24FlightLookup` gained top-level `liveLeg`/`legDate`. Both are type-only corrections that
   match what the endpoints actually return.

Not edited: `Dashboard.tsx`, `tabs.ts`, `state/ui.tsx`, `state/deep-links.ts`,
`features/SearchPalette.tsx`, any other view or store.

---

## Deviations from a literal reading, and why

1. **Push prompt is no longer gated on `push.configured`.** Neither §6 nor legacy
   `toggleWatchFlight` gates it. The prompt buys two things: server push with the tab closed,
   and the browser `Notification` Task 3's diff fires while the tab is merely backgrounded. The
   second needs nothing from the server, so a deployment without VAPID keys still benefits.
2. **Push prompt renders outside `SheetContent`.** Flights are watched from the map, a schedule
   row or a card — almost never from inside the watch panel — so nested in the Sheet it was
   invisible at exactly the moment it fired.
3. **Quick-add: a tail number opens the aircraft dialog.** The shipped box turned `N37502` — the
   input its own rotating placeholder advertises — into the flight `UAN37502`. Flight-number
   behaviour is unchanged.
4. **`UAL123` folded to `UA123` in quick-add and the manual checker.** Both used
   `startsWith('UA')`, which let the ICAO spelling through to an IATA-keyed endpoint; the checker
   then blamed the passenger ("Check the flight numbers") for a flight number that was fine.
   `?flight=` and the FR24 lookup already folded it.
5. **`otp` is sent as a string.** `api/delay-explain.ts:89` returns `''` for any non-string, so the
   rebuilt board's numeric OTP was being dropped from the prompt silently. Confirmed fixed live —
   the returned analysis reads "ORD holding only 58% OTP".
6. **FR24 `liveLeg`/`legDate` read from the top level.** The endpoint returns them there, not under
   `meta`; legacy passed the whole response as its meta argument. Reading only `data.meta` meant
   the F048 leg-date label could never render. Now `data.meta ?? {liveLeg, legDate}`.
7. **FR24 failure surface.** §27 says "writes into `#global-search-error`". That slot does not
   exist in the rebuilt palette and `SearchPalette.tsx` is outside my file list, so the dialog
   closes and shows a small dismissable line of its own plus one `announce()`. Non-blocking and
   visible, which is what the Jul 3 audit asked for.
8. **`myflight-connection-risk` / `myflight-cards` container ids** are not reproduced — nothing
   addresses them any more. `#myflight-check`, `#conn-inbound`, `#conn-outbound`,
   `#conn-manual-result`, `#myflight-search` and `#watch-panel` **are** kept.

---

## Tests

```
$ bun run test
 Test Files  131 passed (131)
      Tests  2360 passed (2360)
   Duration  39.69s

$ bun run typecheck
$ tsc --noEmit          # clean

$ bun run build
 [build] 67 page(s) built
 verify-csp-hashes: 2 inline script(s) all allowed by script-src.
```

New test files, 147 tests: `tests/my-flights.test.js` (45),
`tests/connection-pairing.test.js` (27), `tests/delay-explain-request.test.js` (21),
`tests/fr24-lookup.test.js` (22), `tests/starlink-prediction.test.js` (16),
`tests/board-risk.test.js` (10), `tests/watch-footnote.test.js` (6).

Three bugs were found BY the tests before any browser run: the two `UAL` normalisation misses
and the tail-number mangling.

**Anchors re-grepped after the tables were written** (the rest are approximate — see the note
above §19): `DelayExplainDialog.tsx` aria-label / shimmer / factors / footer / hubTime;
`Fr24LookupDialog.tsx` `FR24_LOOKUP_AVAILABLE` / fetch / disclaimer / fleet match / attribution;
`FlightCard.tsx` united.com note / "Tail not yet assigned" / "via schedule snapshot" / "Where's
My Plane?"; `MyFlightsView.tsx` `findBoardRiskForFlight` / `updateRoute` / `tab === 'myflight'`;
`watch-utils.js` and `WatchPanel.tsx` footnote + prompt timings. Those rows are corrected; the
"STATUS UNAVAILABLE" chip row still points at `FlightCard.tsx:108-112`, which is the chip
selection — the literal string lives in `src/lib/my-flights.js:69`.

`src/data/starlink-live.json` reverted after every build; the tree is clean at each commit.

---

## Browser verification

`bunx astro dev --port 4329` + the gstack headless browser. Screenshots in
`/private/tmp/claude-501/-Users-jonahberg-ganzarain/94862a98-7b27-4bcb-a075-eb91554860f3/scratchpad/`.

| Check | Result | Evidence |
|---|---|---|
| `/?tab=myflight` deep link + empty state | PASS — rotator, OR divider, checker | `mf-empty2.png` |
| Quick-add a real airborne flight (UA341, from `/api/fr24-feed`) | PASS — card renders, route backfilled to `ORD→SEA` in `localStorage` | `mf-card.png` |
| Card with live data | PASS — EN ROUTE chip, `T1` gate via `getUnitedTerminal` fallback, `737 MAX 9` + `N37522`, `20F/45E+/114Y`, journey chain with 3 prior segments | `mf-card.png` |
| Push prompt after the FIRST add | PASS — appeared ~500 ms later, outside the Sheet | `mf-card.png` |
| Risk badge precedence (board reuse) | PASS — UA1049 has no gate times, so `findBoardRiskForFlight` supplied the score and "Explain Delay Risk" appeared only after the ORD board was loaded | `mf-risk.png` |
| Explain Delay Risk (one real POST) | PASS — `MOD RISK` badge, `ORD→LAX · Score 42/100`, real analysis citing the LAX ground stop, ORD 58% OTP, the N57869 inbound and LAX weather (so `faaStatus`, `otp`, `inbound`, `weather` all reached the server), factors list, "Powered by Claude AI" | `mf-explain.png` |
| Escape closes the explain dialog | PASS | `[role=dialog]` count → 0 |
| Aircraft dialog from the card | PASS — full biography, live status, seat bar, footer reads "Watching" | `mf-aircraft.png` |
| Manual checker, two real flights (`UA580` / `341`) | PASS — Enter submits, bare digits normalised, verdict **NO DATA / "Insufficient data"** (correctly never green without gate times) | DOM text |
| Manual checker, not-connecting branch (`UA285` / `UA341`) | PASS — "These flights don't connect — UA285 arrives at ICN, UA341 departs from ORD." | DOM text |
| `/?flight=UA9999` (no live match) | PASS — FR24 dialog opened, lookup 404'd, dialog **closed itself** and left "Lookup failed for UA9999 — try again in a moment. [Dismiss]" | `fr24.png` |
| FR24 success card (`?flight=UA200` — resolvable, not airborne) | PASS — `LANDED` chip, GUM→PHNL, `B77W • N2737U`, times, **Fleet Match: 777-300ER • 60J/24PE/62E+/204Y • WiFi: Satellite Ku**, footer + Share | `fr24-ok2.png` |
| Watch panel + footnote tier | PASS — "2 of 20 slots used", both routes, Clear all, tier 2: "Alerts work while this tab is open. Enable notifications for background alerts." (prod `/api/push-subscribe` returns `configured:true`) | DOM text |
| 400 px | PASS — no horizontal overflow (`scrollWidth === clientWidth === 400`), cards stack, actions wrap | `mf-400.png` |
| Console | CLEAN on a fresh load — the only 404 is `_vercel/insights/script.js`, absent in local dev and pre-existing | `browse console --errors` |

**Fixes made during the browser pass** (in the final commit):

1. `src/app/features/Fr24LookupDialog.tsx` + `src/app/data/api.ts` — F048 leg metadata read from
   the top level, not `data.meta`. Found by comparing the live payload against the code.
2. `src/app/views/myflight/FlightCard.tsx` and `Fr24LookupDialog.tsx` — the inline registration
   links measured 14 px tall at 400 px. Now `inline-flex min-h-11 … md:min-h-0`; re-measured: zero
   sub-44 px targets in the tab panel.
3. `tests/board-risk.test.js` — a wall-clock-dependent assertion (the model carries a time-of-day
   signal, so a "calm" ORD row scores 0 at one hour and 2 at another; it passed at 22:11 and
   failed at 08:58). **Two clock-dependent tests were replaced by two deterministic ones** stating
   the same rule as an invariant — "any returned result has `score > 0`", i.e. a zero is filtered
   to null so no badge is painted — plus a label check. Nothing was dropped: the file's test count
   is unchanged at 10, and the rule under test is strictly stronger than before.

Two React "an error occurred in the `<ScheduleProvider>` / `<DashboardShell>` component" warnings
appeared in the console mid-session; both landed immediately after a Vite HMR hot update and do
not reproduce on a clean load. Dev-only HMR remount artifacts.

**Could not be verified headlessly, and why:**

- **Notification permission / real push.** `Notification.requestPermission()` cannot be granted in
  this headless session, so `enable()`'s granted branch, the server subscribe POST and the
  `backgroundActive` footnote tier were not exercised on screen. Reasoned instead: the GET
  bootstrap was confirmed against production (`{configured:true, vapidPublicKey:…}`), the tier-2
  footnote rendering proves `bootstrapped && configured` is wired, `syncPushSubscription` is
  guarded on `Notification.permission !== 'granted'` and wrapped so it cannot throw, and the four
  tiers are pinned by `tests/watch-footnote.test.js`.
- **The F048 disclaimer rendering.** Verified by unit test and code read, not on screen: a live
  leg means the aircraft is airborne, which means it IS in the live feed, and the palette's lookup
  row (the only route to the FR24 dialog for a live flight) renders only when there is no feed
  match. Every candidate probed that was absent from the feed came back `liveLeg: false`.
- **The terminal "STATUS UNAVAILABLE" chip.** Requires two consecutive `/api/flight-times`
  failures for one flight; production answered every request. Covered by
  `tests/my-flights.test.js:63-77`.

---

## Self-review

- Every §19, §6 and §27 line item is mapped above; none is silently dropped. The eight deviations
  are each argued, and seven of them are corrections of shipped defects rather than new licence.
- No behaviour was re-implemented in TSX. Each view file imports its decisions; the one place
  that looked like an exception — the risk precedence chain — is `MyFlightsView.tsx:160-192`
  calling `computeDelayRiskModel` and `findBoardRiskForFlight`, which is the composition the spec
  describes rather than a reimplementation of either.
- Storage keys and formats are untouched: `bb_watched_flights` still goes through
  `readWatched`/`writeWatched`, and the live `localStorage` dump confirmed the exact
  `{flight, route, status, ts}` shape with the route backfilled.
- No `--ua-*` and no hex literal in TSX except values that come from `src/lib` data (`RISK_BANDS`
  via `riskLabelColor`, `CONN_COLORS` via `classifyConnection`, `FR24_STATUS_COLORS`). Status is
  never colour-alone: every coloured chip carries its word.
- Three caches are module-level (`useFlightTimes`, `useAircraftJourney`, `StarlinkBadge`). That is
  deliberate — views are force-mounted and merely hidden, so component state would re-spend every
  lookup on each tab switch — but it does mean they survive until a reload.

## Concerns

1. **`WatchBanner` is still mounted inside the Schedule view** (Task 3's stopgap). A watched flight
   changing status while the visitor is on My Flights shows no banner. Task 8 relocates it to the
   shell; I did not touch it, per the brief.
2. **`findBoardRiskForFlight` only sees boards already loaded.** On a cold session nothing is
   loaded, so a card without gate times shows "RISK N/A" until the visitor opens Schedule — visible
   in `mf-400.png`. Legacy had the same dependency on `schedRawByHub`. Worth considering whether
   My Flights should trigger `preload()` for the origin hubs of watched flights.
3. **`/api/flight-times` currently returns empty gate times for live flights** (verified against
   production for UA341 and UA1049 — only `takeoff.actual` is populated). Countdowns, gate
   numbers and the card's own risk score therefore degrade to their honest empty states for
   airborne flights. That is upstream, not a port defect, but it means a large part of §19's
   surface cannot be seen working right now.
4. **The FR24 dialog's own failure line** is a new UI element rather than a slot that already
   existed. If Task 8 gives the shell a general error/toast region, this should move there.

---

## Fix round 1 (review response)

**Commit:** `fix(my-flights): 44px risk badge target; restore #myflight-empty`

### The Important finding, and why my own check missed it

The risk badge was a real `<button>` carrying only `rounded-md border px-1.5 py-0.5 text-[9px]`
— about 18 px tall, and the single most tapped control on the card.

My "zero sub-44 px targets" claim was not a mis-measurement but an **over-broad conclusion from a
measurement that could not see the element**. The query ran against the live DOM at 400 px, and in
that state no card rendered a risk badge at all: no schedule board had been loaded, so
`findBoardRiskForFlight` returned null (`riskNA`), and both watched flights were EN ROUTE, which
suppresses the badge by `showRisk`. An empty result from a DOM query is evidence about what was
rendered, not about what the component can render — I reported it as the latter. The lesson for
the remaining rounds: a negative UI assertion is only as wide as the states actually put on screen,
and the state matrix has to be driven deliberately.

### Changes

| File | Change |
|---|---|
| `views/myflight/FlightCard.tsx:146-166` | Risk badge button now `inline-flex min-h-11 min-w-11 items-center justify-center md:min-h-0 md:min-w-0`, with the 9 px coloured chip moved into an inner `<span>` so the target grows without the badge becoming a slab. |
| `views/myflight/QuickAdd.tsx:81` | `id="myflight-empty"` restored on the empty-state container (§19's published id). |
| `shell/WatchPanel.tsx:82` | Flight-select button `flex min-h-11 items-center … md:min-h-0`. |
| `shell/WatchPanel.tsx:104` | `Remove` was `h-8` (32 px) → `min-h-11 md:h-8 md:min-h-0`. |
| `shell/WatchPanel.tsx:119` | `Clear all` → `min-h-11 md:min-h-0`. |

The three `WatchPanel` ones came out of the requested sweep. They are not My Flights files, but I
rewrote that file in `f4637cb`, so they are mine; two of the three predate this task.

**Sweep performed** over every `<button>`, `<Button>`, `<Input>` and `role="button"` in
`views/myflight/*.tsx`, `views/MyFlightsView.tsx`, `features/{Fr24LookupDialog,DelayExplainDialog}.tsx`
and `shell/WatchPanel.tsx`. Everything not listed above already carried the floor.

### Verification

Driven deliberately into the state the first pass never reached: Schedule tab loaded first (so
`findBoardRiskForFlight` has a board), then `UA4587` — a SCHEDULED ORD departure — watched at
400 px, which renders the badge.

```
$ bun run typecheck        # clean
$ bun run test             # 131 files, 2360 tests passed
$ bun run build            # 67 pages; verify-csp-hashes: 2 inline script(s) all allowed
                           # src/data/starlink-live.json reverted after
```

Measured in the live DOM at 400 px:

```
{ "riskBadge": "57x44", "small": [], "overflow": false }
```

`small` is every interactive element in the tab panel under 44 px in either axis — now empty, this
time with the badge actually on screen.

**Screenshot:**
`/private/tmp/claude-501/-Users-jonahberg-ganzarain/94862a98-7b27-4bcb-a075-eb91554860f3/scratchpad/mf-400-badge.png`
— UA4587 ORD→MDT at 400 px showing the `LOW RISK` badge beside the `SCHEDULED` chip. The same shot
incidentally gives first live confirmation of two §19 items the earlier pass could not exercise,
both of which need a schedule-sourced flight: the **"via schedule snapshot" provenance chip** and
the **"Expected to depart"** countdown state.

Deferred per instruction, untouched: inline UI timing constants in `WatchPanel` and
`useAircraftJourney`.
