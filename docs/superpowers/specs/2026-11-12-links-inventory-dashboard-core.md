# Linkability inventory: dashboard core (Live, Schedule, Stats, Weather, shell, Sources)

Repo: `/Users/jonahberg-ganzarain/bb-nov11/r128` (v1.28.1). This is a read-only audit. Every file in the slice was read whole, including `ErrorBoundary.tsx` and `touch-target.ts`.
The `src/app/map/*` rows were grepped, not read whole: LiveMap and RadarMap paint inside Live and Weather, and no other agent's slice lists them.
Example strings tagged "illustrative" follow a template that was read in the code. The exact values were not captured from a fixture.

**Correction to the brief.** `setScheduleHub` is **not** a `useUi()` action. It is a `useDeepLinks` dependency wired in `Dashboard.tsx:117` as `setCurrent({ hub })`. Inside a view, the in-app setter is `useSchedule().setCurrent({ hub })` (`ScheduleView.tsx:299`).

**Status codes** (each Today cell starts with one):
- **a**: real `<a href>`
- **b**: button (or Leaflet marker / tooltip-term button)
- **c**: plain text
- **d**: plain text painted in link colour (`text-primary`)

**Counting unit**: one table row is one kind of printed thing on one surface. The desktop Schedule table and the phone Schedule row are counted separately. Pure controls that name no entity are listed under each surface and are not counted. These are sort headers, Retry, Dismiss, Show more, Refresh, filter selects, layer toggles and tab bars. `text-primary` headings and the NOW divider are notes and are not counted as **d**.

**Hub-only** below means the value can only be one of ORD DEN IAH EWR SFO IAD LAX NRT GUM (`HUB_ORDER`, `src/lib/hub-health.js:15`; `WX_HUBS`, `src/lib/weather-cards.js:31-37`).

**Destinations for a hub code.** A hub code fits several destinations. All are listed and none is picked:
- `/hubs/<code>`. The precedent is `HubHealthStrip.tsx:121`.
- `?tab=schedule&hub=<CODE>`, or in-app `useSchedule().setCurrent({hub})` + `setTab('schedule')`
- `?hub=<CODE>` (Live map filter)
- `?tab=weather&hub=<CODE>` (hub card)

---

## 1. Live: sidebar (`src/app/views/live/LiveSidebar.tsx`)

| Thing | Kind | Today (a/b/c/d + detail) | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Search-result flight number | flight number | **a** `FlightLink` → `/flight/UA576`, `z-10` above the stretched row button | LiveSidebar.tsx:141-143 | /flight/<ident> (done) | Prints `f.flightIATA`, falling back to `f.callsign` (line 135). A callsign fallback (e.g. SKW…) prints as body text, by design. |
| Search-result row (rest of row) | flight | **b** stretched button (`after:absolute inset-0`) → `onSelect(f)` → flight sheet, closes the sheet | LiveSidebar.tsx:144-155 | in-app `select` (done) | The whole row is one click target. Any new link in it needs `relative z-10`, as FlightLink has. |
| Search-result route `ORD→SFO` | route (any airport both ends) | **c** muted mono, inside the row button | LiveSidebar.tsx:150-152 | none exists for a route. Hub ends fit the hub destinations. | It sits inside a button, so it cannot hold a link without being split out. |
| Search-result tail | tail | **c** muted, inside the row button | LiveSidebar.tsx:153 | `openAircraft(reg)` / `?aircraft=N…` | It cannot nest inside the button. Same split-out problem. |
| Search-result special-livery marker | livery (icon + sr-only words) | **c** `SpecialLiveryMarker` (inert icon) | LiveSidebar.tsx:154 | Fleet `?view=special` | Icon only; the component is owned by features. |
| "Filter map to ORD · N flights" | airport code (hub-only) + count | **b** button → `onHubFilter` (map filter + `focusOn`) | LiveSidebar.tsx:103-116 | The current action is right. `/hubs/<code>` is an alternative. | It appears only when the query equals a hub code. |
| "N flights found (showing 50)" | count of search set | **c** | LiveSidebar.tsx:127-132 | none (the set is the list below it) | |
| "Check the Schedule tab →" | tab | **b** `Button variant="link"`, which looks like a link → `setTab('schedule')` | LiveSidebar.tsx:121-123 | `#schedule` exists, but the query is not carried (no search deep link) | A button drawn as a link. No middle-click. |
| Hub-traffic row: hub code | airport code (hub-only) | **c** inside a whole-row toggle button (`aria-pressed`) → filter map + centre | LiveSidebar.tsx:183-193 | hub destinations | The row is already one click target, so a hub link cannot nest. |
| Hub-traffic row: `↗ out ↙ in` counts | counts of airborne flights at that hub | **c** inside the same button | LiveSidebar.tsx:202-204 | `?hub=<CODE>` (Live map filter) is what the button already does | |
| Hub-traffic row: BUSIEST badge, "✓ FILTERED", share bar | status / bar | **c**. The bar is `bg-primary`. | LiveSidebar.tsx:194-201, 206-214 | n/a | |
| Phase row: phase name + count | flight phase + count | **b** whole-row toggle → local `phaseFilter` | LiveSidebar.tsx:227-249 | in-app only. No deep link or `useUi` setter exists for phase. | |
| "Showing N of M flights" | count | **c** | LiveSidebar.tsx:254-257 | none | |

Controls (not counted): "⊘ Show all" (`LiveSidebar.tsx:174-176`).
Mounted in the sidebar but owned by features (not inventoried here):
- `BriefSidebarPanel` (`LiveView.tsx:201`)
- `AskChips` (`LiveView.tsx:207-215`)

## 2. Live: stat strip, airborne chip, 24-hour graph (`StatsBar.tsx`, `AirborneHistory.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Airborne chip `645 airborne ⌇` (< 1081 px) | count | **b** opens the 24 h dialog | StatsBar.tsx:29-63 | n/a (the dialog is its destination) | |
| "24h" sparkline button | count graph | **b** opens the dialog | StatsBar.tsx:88-98 | n/a | |
| Stat tile: Airborne | count of the filtered map set | **c** | StatsBar.tsx:75, 105-110 | `#live` is this view. None beyond it. | Inside `role="status" aria-live="polite"` (99-104). StatsBar.tsx:17-18 says a control inside it would be re-read every 30 s, so links here are constrained. |
| Stat tile: Utilization | percentage | **c** | StatsBar.tsx:76 | Fleet `?view=airborne` (inferred fit) | same live-region constraint |
| Stat tile: ⚡ Starlink | count of Starlink aircraft airborne | **c** | StatsBar.tsx:77 | `setStarlinkFilter(true)` (map highlight), `?view=starlink` / `#starlink` | same |
| Stat tiles: Climbing / Cruising / Descending / Ground | counts by phase | **c** | StatsBar.tsx:78-81 | Sidebar phase filter is local state. None exists as a link. | same |
| Stat tiles: Avg Alt / Avg Spd | measures | **c** | StatsBar.tsx:82-83 | none | |
| Graph readout: count + sample time | count | **c** | AirborneHistory.tsx:419-430 | none | |
| Graph readout: "N mainline, N Express" | count by operator class | **c** | AirborneHistory.tsx:427-429 | Fleet `?view=express` is the Express fleet list, not the airborne Express set. Partial fit at best. | |
| Graph readout: "Live map now: N" | count | **c** | AirborneHistory.tsx:432-437, 443-446 | `#live` | It is inside the dialog, which opens over Live. |

The chart itself is a `role="slider"` over samples, not a list of entities (`AirborneHistory.tsx:193-209`).

## 3. Live: map key, map controls, map layer (`MapLegend.tsx`, `MapControls.tsx`, `src/app/map/LiveMap.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Key rows: Watching, Starlink Wi-Fi, Long-haul (> 2,500 nm), United Express, Mainline airborne, On the ground | marker category | **c** | MapLegend.tsx:74-92; labels at plane-icon.js:107-112 | "Starlink Wi-Fi" → `#starlink`. "United Express" → Fleet `?view=express`. "Watching" → `#myflight`. Others: none. | Low value: it is a legend. |
| Key row: United hub (ring) | category | **c** | MapLegend.tsx:93-110 | `/hubs` index. The page exists (`src/pages/hubs/index.astro`) but is outside the brief's destination list. | |
| "Smaller icon = United Express" | note | **c** | MapLegend.tsx:115-117 | n/a | |
| Region menu items (US, Caribbean, Europe…) | map region | **b** DropdownMenuRadioItem → `onRegion` (fly to) | MapControls.tsx:154-164 | n/a (no region page) | A control. Listed because it is a list. |
| Map hub labels (ORD, DEN…) | airport code (hub-only) | **c** permanent Leaflet tooltip on a non-clickable ring | LiveMap.tsx:394-400 | hub destinations | Inside the Leaflet canvas. A link would need a Leaflet tooltip with `interactive`, or a marker `on('click')`. |
| Plane markers | flight | **b** Leaflet marker `on('click')` → `select` flight sheet; `role=img`, `keyboard:false` | LiveMap.tsx:445-451, 463-466 | in-app `select` (done) | |
| Selected-route endpoint dots `ORD — Chicago` | airport (any) | **c** hover tooltip | LiveMap.tsx:535, 542 | hub ends fit the hub destinations. Non-hub: none. | |

Controls (not counted):
- the layer toggles Hubs, Long-haul, Starlink, Radar (`MapControls.tsx:231-253`)
- Refresh (`254-267`)
- Filters (`LiveView.tsx:263-269`)
- Key toggle (`MapLegend.tsx:122-131`)

## 4. Schedule: desktop table (`src/app/views/schedule/ScheduleTable.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Time `18:48` + date chip + "actual" + changed-time line | time | **c** | ScheduleTable.tsx:487-507 | none | |
| Flight number `UA576` | flight number | **a** `FlightLink ident={row.identDisplay} hit="inline"` → `/flight/UA576` | ScheduleTable.tsx:512-514 | done | It prints `identDisplay` (provider suffix stripped). `ident` `'—'` prints plain. |
| Route line `ORD → DEN` | route. The board's side is hub-only; the other end is any airport. | **c** mono | ScheduleTable.tsx:516-517 | Other end, when it is a hub: hub destinations (e.g. switch to that hub's board). Non-hub: none exists. | One pre-joined string (`schedule-row-model.js:153`). The codes are in the raw row (`airport.origin/destination.code.iata`). |
| Route sub-line (airport name) | airport name | **c** muted | ScheduleTable.tsx:518-520 | same as above | |
| Aircraft code `B39M` (title = provider text) | aircraft type (ICAO) | **c** mono, `title={acText}` | ScheduleTable.tsx:524-526 | `/fleet/<slug>` or Fleet `?type=<fleet t>` for mainline. Express types: none (Fleet `?view=express` partial). | Needs ICAO → fleet type (`equipment-swaps.js:15-23`) → slug (`src/data/fleet/*.js` `typeCode`). See the data-gap section. |
| Aircraft short name `737-900` / `A321 NEO` | aircraft type (provider text) | **c** muted | ScheduleTable.tsx:527-529 | as above | It is clipped provider text, not a fleet string. "A321 NEO" ≠ "A321neo". |
| Swap pill `737-900 → 737-800` | aircraft type ×2 (fleet names via `ICAO_TO_FLEET_TYPE`, raw ICAO when unmapped) | **c** coloured chip | ScheduleTable.tsx:530-551 | `/fleet/<slug>` for each side | The mapped names equal fleet `typeCode`, except `B739` → "737-900" (the -900ER is ambiguous). |
| Swap pill tail | tail | **b** `<button class="underline">` → `onOpenAircraft(reg)` | ScheduleTable.tsx:552-560 | `?aircraft=N…` exists as a URL but has no in-place follow path (see constraints) | A button, so no middle-click or copy link. |
| Swap impact chips ("Lost Polaris", "+N seats", "⚡ Starlink", "Lost Starlink"; templates in swap-impact.js:34-75) | impact | **c** chips | ScheduleTable.tsx:562-576 | none | |
| Reg / tail `N12345` | tail | **b** `<button class="underline">` → `onOpenAircraft(reg)`. A dotted-underline variant with a tooltip is used when the tail came from live tracking. | ScheduleTable.tsx:582-606 | in-app `openAircraft` (done). URL `?aircraft=` | A button styled as a link. Same no-href caveat. |
| "Not in our feed yet" | tail pending | **b** `JargonTerm` (tooltip term) | ScheduleTable.tsx:607-614 | n/a | |
| Special-livery icon badge | livery | **c** (icon; `SpecialLiveryBadge`, features) | ScheduleTable.tsx:618-620 | Fleet `?view=special` | The component belongs to the features agent (inferred inert). |
| "★ <name>" special badge | named aircraft / livery | **c** `Badge secondary` | ScheduleTable.tsx:621-625 | Fleet `?view=special` | |
| Enrich line `16F/42E+/96Y · ViaSat Ka · ⚡ Starlink · IFE · Del 2018` | config / Wi-Fi / Starlink | **c** muted. The Starlink part is violet. | ScheduleTable.tsx:626-651 | Starlink part → `#starlink`. Rest: none. | |
| Term / Gate `T1 · C18` | gate | **c** | ScheduleTable.tsx:654 | none | |
| Status word (`Departed`, `Delayed`…) + `*` | status | **c** status colour (not primary) | ScheduleTable.tsx:657-660 | none (the status filter is local state) | |
| LIVE badge | in the live feed | **c** | ScheduleTable.tsx:661-665 | in-app `select({kind:'ident'})` or `?flight=` (open on the map) | The row has no "show on map" action on desktop. |
| Evidence note ("seen airborne…"), "as of …" | evidence | **c** | ScheduleTable.tsx:666-680 | none | |
| FAA context `Ground Stop at EWR, avg 45 min` (illustrative; template `${label} at ${apt}${avg}`) | FAA program at an airport (any airport: origin or destination) | **c** `text-bb-warn` | ScheduleTable.tsx:681-683; text from faa-context.js:140-141 | `?tab=weather&section=nas`. A hub airport also fits `?tab=weather&hub=<CODE>`. | `resolveDeepLink` already follows both in place. |
| Delay figure `+38m` / `≥ +1h06m` | delay | **c** | ScheduleTable.tsx:687-688 | none | |
| Risk control `low risk` / `RISK: HIGH` | delay prediction | **b** → `openDelayExplain(context)` | ScheduleTable.tsx:689-710 | done (AI explanation) | |
| Fleet cell `✓ 16F/…` / `⚡ Starlink` / Express type | cabin badge / Starlink / Express type | **c** | ScheduleTable.tsx:716-729 | Starlink → `#starlink`. Express type: none. | |
| Watch eye | watch toggle | **b** → `onToggleWatch` | ScheduleTable.tsx:731-750 | done | |

Notes (not counted):
- The NOW divider "── NOW · 14:05 CST ──" is `text-primary`, but it is not an entity (`ScheduleTable.tsx:754-770`).

Controls (not counted):
- sort headers (`99-131`)
- Show earlier/later/all (`302-317`)
- Clear filters (`327-329`)

## 5. Schedule: phone row (`SchedulePhoneRow.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Whole row | flight | **b** stretched `<button>` (`after:absolute inset-0`) → `select({kind:'ident'})` → flight sheet | SchedulePhoneRow.tsx:96-104 (`ScheduleView.tsx:248-253`) | done | The row is already one click target. Extra links need `relative z-10`. Line 198 states that inline extras are deliberately inert. |
| Flight number | flight number | **a** `FlightLink` → `/flight/<identDisplay>`, `z-10 relative` | SchedulePhoneRow.tsx:125-133 | done | |
| Time + changed time | time | **c** | SchedulePhoneRow.tsx:107-120 | none | |
| Route `ROC → ORD` | route (one end hub-only) | **c** | SchedulePhoneRow.tsx:134 | Other end, when a hub: hub destinations. Else none. | |
| Status pill, LIVE tag | status | **c** | SchedulePhoneRow.tsx:137-152 | none / `?flight=` for LIVE | |
| Delay figure | delay | **c** | SchedulePhoneRow.tsx:153-159 | none | |
| Risk control | prediction | **b** → `openDelayExplain`, `z-10` | SchedulePhoneRow.tsx:160-178 | done | |
| Tail `N57868` | tail | **d** **(call-out).** Plain, inert text. When the tail came from live tracking it gets `underline decoration-dotted underline-offset-2` (muted colour, not `text-primary`), and the underline reads as a link. Without `regFromLive` it is plain **c**. | SchedulePhoneRow.tsx:185-192 (underline at 188) | `openAircraft(reg)` / `?aircraft=` | Desktop's same tail is a button to the aircraft dialog. The phone has **no** way to open the aircraft dialog from the board. |
| "Tail not in feed yet" | tail pending | **c** (`title=` only; never shown on touch) | SchedulePhoneRow.tsx:193-197 | n/a | |
| Special-livery marker | livery | **c** icon | SchedulePhoneRow.tsx:199 | Fleet `?view=special` | |
| Aircraft type `757-300` / `B39M` | aircraft type (short provider text, or the ICAO code) | **c** | SchedulePhoneRow.tsx:200-201; wording from schedule-phone-row.js:76-87 | `/fleet/<slug>` (mainline, after mapping) | It is short text or ICAO, never a fleet string. |
| Seat config | config | **c** | SchedulePhoneRow.tsx:202-207 | none | |
| Wi-Fi / ⚡ Starlink | Wi-Fi | **c** (Starlink violet) | SchedulePhoneRow.tsx:208-223 | Starlink → `#starlink` | |
| Swap text `B739 → B738 · downgrade` | aircraft types | **c** chip | SchedulePhoneRow.tsx:228-230 | `/fleet/<slug>` ×2 | |
| "seen airborne" | evidence | **c** | SchedulePhoneRow.tsx:231 | none | |
| FAA context | FAA program (any airport) | **c** `text-bb-warn` | SchedulePhoneRow.tsx:232 | `?tab=weather&section=nas` / `?tab=weather&hub=` | |
| "★ <name>" | named aircraft | **c** | SchedulePhoneRow.tsx:233-238 | Fleet `?view=special` | |
| Watch eye | watch | **b** `z-10` | SchedulePhoneRow.tsx:244-257 | done | |

## 6. Schedule: stat strip, swap banner, staleness, view chrome

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Total `UA DEP · Nov 12` | count of the board's rows | **c** | ScheduleStats.tsx:264-273 (phone 231) | none (it is this board) | |
| On-Time % + "N operated" | percentage of the set | **c** (the label is a `JargonTerm` button for its explanation) | ScheduleStats.tsx:274-294 (phone 236-250) | none | |
| On Time count | count of a subset | **c** | ScheduleStats.tsx:295 (phone 186) | none. "On time" is only an ask-predicate, with no filter value or deep link. | |
| Late count | count of a subset | **c** | ScheduleStats.tsx:296 (phone 187) | none. Late is the 30-minute rule, not the `delayed` status filter. | |
| Departed · not timed | count | **c** (label is a `JargonTerm`) | ScheduleStats.tsx:297-303 (phone 188-195) | none | |
| Canceled + "+N unconfirmed" | count | **c** (label is a `JargonTerm`) | ScheduleStats.tsx:304-309 (phone 196-202) | Status filter `canceled` exists but is local `useState`. No deep link. | |
| In the air (arrivals) | count | **c** | ScheduleStats.tsx:310-316 (phone 203-210) | none | |
| Upcoming | count | **c** | ScheduleStats.tsx:317 (phone 211) | none | |
| Uncategorized | count | **c** | ScheduleStats.tsx:318-324 (phone 212-219) | none | |
| "N presumed" chip | count | **b** `JargonTerm` (tooltip) | ScheduleStats.tsx:154-165 | none | |
| "ORD under FAA delay program (avg N min)" | FAA program at the board's hub (hub-only) | **c** `text-bb-warn` | ScheduleStats.tsx:166-172 | `?tab=weather&hub=<CODE>` / `?tab=weather&section=nas` | |
| Cache note / "data as of …" | freshness | **c** | ScheduleView.tsx:351-366 | none | |
| Swap summary "3 equipment swaps · 1 downgrade · 2 upgrades · Filters →" | count of swap rows | **b** whole banner → opens the filter drawer | SwapSummary.tsx:37-58 | none. No "swaps only" filter exists. | |
| Staleness banner message | freshness | **c** (+ Retry button) | StalenessBanner.tsx:41-58 | n/a | |
| Footer "Schedule data via AeroDataBox" | data source | **a** external, `text-primary underline` | ScheduleView.tsx:398-407 | done | |
| Footer "All times ORD local (CST)" | airport code (hub-only) | **c** | ScheduleView.tsx:408-409 | hub destinations (low value) | |
| Loading / empty-state sentences ("Loading ORD departures…", "No United flights listed for today's ORD departures…") | airport code (hub-only) | **c** | ScheduleView.tsx:337-340; ScheduleTable.tsx:319-353 | none needed | |

Notes (not counted):
- The desktop h2 "Flight Schedule" is `text-primary` (`ScheduleControls.tsx:282-284`). It is a heading, not an entity.

Controls (not counted):
- the hub `Select` listing the 9 hubs (`ScheduleControls.tsx:189-209`, `310-329`)
- day and direction toggles
- Find
- Jump to now, Refresh, Filters
- the seven advanced selects, including the Aircraft select (`AdvancedFilters.tsx:130-197`), whose options are built from the board as `"<code> — <provider text>"`, e.g. `"B739 — Boeing 737-900"` (`useBoardModel.ts:631-640`; fixture pair)

## 7. Stats tab (`StatsView.tsx`, `src/app/views/stats/*`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Metric: Flights Airborne | count | **c** | MetricCards.tsx:24-36; StatsView.tsx:120 | `#live` / Fleet `?view=airborne` | |
| Metric: Fleet Utilization + "N of M mainline aircraft" | percentage | **c** | StatsView.tsx:121-125 | Fleet `?view=airborne` | |
| Metric: Avg Fleet Age | measure | **c** | StatsView.tsx:126 | `#fleet` / `/fleet` | |
| Metric: Starlink Coverage + "N of M airborne" | percentage | **c** | StatsView.tsx:127-133 | `#starlink`, or Live with `setStarlinkFilter(true)` + `setTab('live')` | |
| Donut centre total | count | **c** (SVG text) | PhaseDonut.tsx:67-79 | none | |
| Phase legend row: phase + bar + count + % | count by phase | **c** | PhaseDonut.tsx:82-110 | none. The Live phase filter is local state in LiveView. | It has an sr-only table twin (112-130). |
| Live Fleet Utilization row: type `737 MAX 9` | aircraft type (fleet string) | **c** mono | UtilizationChart.tsx:26 | `/fleet/<slug>` **exact 1:1**. All 19 `TYPE_ORDER` strings (analytics.js:13) equal a fleet page `typeCode`. Also Fleet `?type=737 MAX 9`: `resolveFleetDeepLinkFilter` (fleet-view.js:345-349) matches against `typeCounts` keys, which are fleet `t` values (fleet-view.js:50-56). | It needs only a typeCode→slug table. |
| Utilization row: `flying/total pct%` + bar | count / percentage | **c** (`text-foreground`; bar `var(--primary)`) | UtilizationChart.tsx:27-40 | Fleet `?type=` (all of that type) | |
| Average Fleet Age row: type | aircraft type (fleet string) | **c** mono | RouteBars.tsx:48 | `/fleet/<slug>` exact 1:1, as above | |
| Average Fleet Age row: `N.Ny` + bar | measure | **c** | RouteBars.tsx:49-57 | none | |
| Hub matrix column headers `ORD … GUM` | airport code (hub-only) | **d** `text-primary` | HubMatrix.tsx:42-46 | hub destinations | |
| Hub matrix row headers | airport code (hub-only) | **d** `text-primary font-bold` | HubMatrix.tsx:55-57 | hub destinations | |
| Hub matrix cell counts | count of airborne ORIGIN→DEST flights | **c**. The background is a `--primary` tint. Bold when > 0. | HubMatrix.tsx:58-85 | none (no route view). `?hub=ORIGIN` is a partial fit. | |
| Hub matrix TOTAL column | count | **c** | HubMatrix.tsx:86-88 | `?hub=<ORIGIN>` partial | |
| Top Routes rank | rank | **c** | RouteBars.tsx:22-24 | n/a | |
| Top Routes route `ORD→SFO` | route (any airport both ends) | **c** mono semibold | RouteBars.tsx:25 | none for a route. Hub ends fit the hub destinations. | It is a pre-joined string (analytics.js:107). |
| Top Routes count | count of airborne flights on the route | **d** `text-primary` | RouteBars.tsx:32-34 | none | The bar is `bg-primary` (26-31). |

## 8. Weather tab (`WeatherView.tsx`, `src/app/views/weather/*`, `src/app/map/RadarMap.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| IROPS label | term | **b** `JargonTerm` | IropsSection.tsx:195 | n/a | |
| IROPS severity word `NORMAL OPERATIONS` | network status | **c** chip | IropsSection.tsx:196-203 | none (this section is `?tab=irops`) | Inside `aria-live="polite"` (184). |
| "index 14.8 · United cancels + delays", "est · loaded boards" | measure | **c** | IropsSection.tsx:206-213 | none | |
| Metrics: Canceled (+unconfirmed), >30m, >60m, Diversions, Total Flights | network-wide counts across 9 hubs | **c** | IropsSection.tsx:241-249 | none. No cross-hub list exists. The Schedule status filter is per hub and local. | live region |
| Cancellation footnote | note | **c** | IropsSection.tsx:253-255 | none | |
| Coverage line `8 of 9 hub boards current · LAX board 3 h old` | airport code (hub-only), embedded in a sentence | **c** | IropsSection.tsx:257-259 | `?tab=schedule&hub=LAX` | One string from `iropsCoverageLine`. The hub is not separable without lib changes. |
| FAA lines `EWR: Ground Stop · LGA: Ground Delay Program` (client fallback only; labels from faa-context.js:30-36; codes illustrative) | airport code (**any** airport) + FAA program | **c** mono muted, joined with ` · ` | IropsSection.tsx:264-268; weather-cards.js:429-436 | Hub: `?tab=weather&hub=<CODE>`. Any: `?tab=weather&section=nas`. Non-hub airport page: none. | `faaIndex` covers any airport (fixture: EWR, LGA, RSW, SLC, DCA, BOS). |
| Tracker briefing title `EWR infrastructure briefing` | airport code (home hub) | **c** h3 | TrackerBriefing.tsx:56-58 | `/hubs/<code>` | |
| Tracker hub link `EWR projects →` | hub projects | **a** `/trackers/united-hubs/<code>` (or index) | TrackerBriefing.tsx:61-66; tracker-briefing.js:89-91 | done | |
| Tracker ATC link `EWR tower →` | ATC tower | **a** `/trackers/atc/<code>` or `/trackers/atc#row-<code>` (or index) | TrackerBriefing.tsx:67-72; tracker-briefing.js:92-98 | done | `/trackers/atc/<code>` exists only for `atcHubDetailCodes` (`src/pages/trackers/atc/[code].astro:10-12`). |
| Tracker watch text | state | **c** polite | TrackerBriefing.tsx:73-79 | none | |
| NAS item badge `GS` / `GDP` / `AFP` / `MIT` / `CDR` | FAA program type | **c** badge | NasPanel.tsx:79-88 | none | |
| NAS item title (illustrative: `EWR Ground stop`, built as facility + type label, or the raw program/event name) | FAA program. A facility code (airport or ARTCC) is embedded in the string. | **c** | NasPanel.tsx:92; nas-severity.js:107-112 | none for non-hubs. Hub tags carry the hub. | |
| NAS hub tags `EWR` | airport code (hub-only) | **d** `bg-primary/15 text-primary` chip | NasPanel.tsx:93-100 | `?tab=weather&hub=<CODE>` (same tab; `resolveDeepLink` follows it in place) or the other hub destinations | |
| NAS detail `reason · avg 62m · ends 2300Z` | detail | **c** | NasPanel.tsx:102-117 | none | |
| NAS count line / "FAA status as of HH:MMZ" | count / freshness | **c** | NasPanel.tsx:155, 157-162 | none | |
| "View full ATCSCC advisory →" | FAA advisory | **a** external, `text-primary underline` | NasPanel.tsx:166-175 | done | |
| Radar legend VFR / MVFR / IFR / LIFR / ⚠ ops impact | category | **c** | RadarPanel.tsx:49-64 | none | |
| Radar hub markers + labels | airport code (hub-only) | **b** Leaflet marker click → scroll to the hub card. The label is a permanent tooltip. | RadarMap.tsx:76-86, 137 | done in-tab. Hub destinations also fit. | |
| Hub card: hub code `EWR` | airport code (hub-only) | **c** mono | HubCard.tsx:98 | hub destinations | The card id is `hub-card-EWR`. |
| Hub card: De-ice badge, flight-category chip, airport name | weather / name | **c** | HubCard.tsx:99-114 | name → `/hubs/<code>` | |
| Hub card: Temperature / Wind / Visibility / Ceiling | weather | **c** `dl` | HubCard.tsx:116-123 | none | |
| Hub card: runway config | runway | **c** | HubCard.tsx:125-127 | none | |
| Hub card: status line (prefix + parts from `buildHubCardModel`; example wording not captured) | FAA program / weather status at the hub | **c**, with an embedded `JargonTerm` button for GDP / ground stop | HubCard.tsx:129-137, 71 | `?tab=weather&section=nas` | |
| Hub card details: explainer, FAA explainer, NOTAM, raw METAR | text | **c** | HubCard.tsx:164-191 | none | |
| Hub card details: "Advisory" links | FAA advisory | **a** external, `text-bb-warn underline` | HubCard.tsx:166-180 | done | |

Controls (not counted):
- the Details disclosure (`HubCard.tsx:153-162`)
- the IROPS "?" tooltip (`IropsSection.tsx:214-235`)
- Retry (`HubCards.tsx:68-76`)

## 9. Shell

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Wordmark | site | **a** `#live` | Header.tsx:72-81 | done | |
| LIVE chip `· 642 flights` | count of feed rows | **c** badge | Header.tsx:84-103 | `#live` | |
| Watch button + count | count of watched flights | **b** → opens WatchPanel | Header.tsx:140-159 | `#myflight` (alternative) | |
| Home hub button `ORD` | airport code (hub-only) | **b** → `cycleHomeAirport` | Header.tsx:161-177 | It is a control. Leave it. | |
| Brief row headline | brief | **b** → opens the brief sheet / reveals the panel | Ticker.tsx:134-168 | done | The brief content and chips belong to the features agent. |
| Ticker: advisory `Disrupted: ground stop for flights into EWR` | airport code (hub-only), embedded | **c** in one rotating `<p>` | Ticker.tsx:196-216; ops-health.js:220-269; ticker.js:35 | `?tab=weather&hub=<CODE>` / `?tab=irops` | Rotates every 5 s, `aria-live="off"`. A link whose target swaps every 5 s is awkward. |
| Ticker: "N United flights airborne" | count | **c** | ticker.js:39 | `#live` | same |
| Ticker: "Fleet: N mainline aircraft" | count | **c** | ticker.js:42 | `#fleet` / `/fleet` | same |
| Ticker: "N Starlink-equipped aircraft" | count | **c** | ticker.js:43 | `#starlink` | same |
| Ticker: squawk `⚠️ EMERGENCY: UAL123 (7700)` (text from flight-phase.js:94; callsign illustrative) | flight (callsign first) | **c** | ticker.js:49; Ticker.tsx:80 | in-app `select` flight. `/flight/UA123` only for a UAL / UA callsign (`flightLink` maps UAL→UA). | It prints `callsign`, falling back to `flightIATA`. An Express squawk prints SKW…, which has no page. |
| Ticker: "All systems normal — tracking N" / "FAA status unknown since …" | network status | **c** | ticker.js:56-58 | `?tab=irops` | |
| Ticker: disclaimer "Data: AeroDataBox · FR24 · AWC · FAA" | data sources | **c** | ticker.js:63 | `#sources` | |
| Hub strip chips `● ORD 87%` | airport code (hub-only) + on-time % | **a** `/hubs/<code>`, with a tooltip | HubHealthStrip.tsx:117-191 | done | Inside `aria-live="polite"` (73). 28 px row, 27 px chips (DESIGN 2026-11-11). |
| Hub strip network chip `SOME DELAYS` / "FAA status unknown since …" | network status | **c** | HubHealthStrip.tsx:195-205 | `?tab=irops` | |
| Watch panel row: flight number + route | flight number + route | **b** one button → `select({kind:'ident'})` → flight sheet. The number is not link coloured. | WatchPanel.tsx:119-133 | `/flight/<ident>`, split out of the button per DESIGN 2026-11-11 ("A number inside a control that does something else is split out of it") | It prints the raw watched ident (`ScheduleView.tsx:240` passes `row.ident`, not `identDisplay`). |
| Watch panel row: status | status | **c** | WatchPanel.tsx:134-138 | none | |
| Watch panel "N of 20 slots used" | count of watched flights | **c** | WatchPanel.tsx:106-110 | `#myflight` | |
| Watch banner `🔔 UA1234 ORD→DEN: Departed (was: Scheduled)` | flight number + route + status | **c** one truncated string | WatchBanner.tsx:45-48 | `/flight/<ident>` | It gets only `message`. `obs.flight` is not passed (watch-alerts.tsx:84). |
| Phone nav: 4 primary tabs + More-sheet tabs | dashboard tab | **b** → `setTab` | MobileNav.tsx:100-114, 131-145 | `#live`, `#schedule`… already exist | Not entities. |
| More sheet: News | page | **a** `/news` | MobileNav.tsx:148-153 | done | |
| More sheet: About / What is this dashboard? | dialog | **b** | MobileNav.tsx:157-185 | n/a | |
| More sheet: Help cover a day; Built by Jonah Berg | external | **a** | MobileNav.tsx:186-209 | done | |
| Attribution strip: AeroDataBox, FR24, AWC, FAA, CARTO, OpenStreetMap, Jonah Berg | data source / author | **a** external | Attribution.tsx:39-116 | done | |
| "Not affiliated with United Airlines, Inc." | statement | **c** | Attribution.tsx:119 | n/a | |

Not counted:
- Controls: Find a flight (`Header.tsx:114-138`), Help (`201-208`), the phone support icon (`184-199`, an **a** external), WatchPanel Remove / Clear all / notification buttons, WatchBanner Dismiss, the More-sheet Home hub `Select` (`MobileNav.tsx:49-77`), TabBar (Radix tab triggers, `TabBar.tsx:20-25`).
- Read and found to hold no list:
  - `Status.tsx` (glyph only)
  - `IropsAnnouncer.tsx`, `OfflineBanner.tsx`
  - `ErrorBoundary.tsx` (an Alert with Try again / Reload)
  - `touch-target.ts` (a class constant)

## 10. Sources tab (`SourcesView.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Source card name (FR24, AeroDataBox, Fleet DB, Starlink tracker, AWC, NEXRAD, CARTO/OSM, FAA NAS, Route estimation, r/UnitedAirlines) | data source | **c** h3 | SourcesView.tsx:155-156 | The view that shows the data: FR24 → `#live`; AeroDataBox → `#schedule`; Fleet DB → `#fleet` / `/fleet`; Starlink → `#starlink`; AWC / NEXRAD → `#weather`; FAA NAS → `?tab=weather&section=nas`; others: none. | Low value. |
| Freshness badge LIVE / DAILY / SNAPSHOT… | freshness | **c** | SourcesView.tsx:157-164 | none | |
| Description | text | **c** | SourcesView.tsx:166 | none | |
| Source links `flightradar24.com →` etc. | external site | **a** external, `text-primary` | SourcesView.tsx:167-181 | done | |

Notes (not counted):
- The h2s "Data Sources & Credits" and "Community" are `text-primary` (`SourcesView.tsx:191-193`, `199-201`).
- "Disclaimer:" is a `text-primary` strong (`207`).

---

## Tally (rows above; unit = one kind of printed thing per surface; desktop and phone Schedule are separate)

| Status | Count |
|---|---|
| **a** linked | 14 |
| **b** button | 26 |
| **c** plain | 114 |
| **d** plain in link colour / underline | 5 |
| **Total** | **159** |

The counts were produced with awk over the Today column of this file. All 159 data rows were tallied.

The five **d** rows:
1. HubMatrix column headers (`HubMatrix.tsx:43`)
2. HubMatrix row headers (`:55`)
3. Top Routes count (`RouteBars.tsx:32-34`)
4. NAS hub tags (`NasPanel.tsx:94-99`)
5. Phone Schedule tail, dotted-underlined when it came from live tracking (`SchedulePhoneRow.tsx:188`)

## Data gaps and constraints

1. **Aircraft type comes in three dialects, and no single helper maps it to a `/fleet` slug.**
   - The dialects:
     - ICAO codes on the Schedule board and in the live feed: `B39M`, `B739`, `E75L`, `CRJ7`, blank.
     - Clipped provider text: `acShort`, e.g. "A321 NEO", "737-900", "Canadair CRJ", "175".
     - Fleet strings: Stats rows, swap names, "737 MAX 9".
   - The pieces of the chain: `ICAO_TO_FLEET_TYPE` (`src/lib/equipment-swaps.js:15-23`) → `typeCode` in `src/data/fleet/*.js` → slug.
   - Real fixture pairs (`tests/fixtures/ord-2026-10-03-future-actuals.json`, `schedule-board-rows.json`):
     - `('A21N','Airbus A321 NEO')`
     - `('B739','Boeing 737-900')`
     - `('','Boeing 737')`
     - `('E175','Embraer 175')`
     - `('','Canadair CRJ')`
   - `B739` maps only to "737-900", so the separate `/fleet/737-900er` page is unreachable from ICAO.
   - Regional types (E75L, E175, CRJ7, E45X, CRJ2) have no fleet page.
   - Blank codes cannot map.
   - Stats is the clean case: all 19 `TYPE_ORDER` strings equal a `typeCode`.
2. **Live idents can be blank or a callsign.**
   - Where:
     - `LiveSidebar.tsx:135` and `LiveMap.tsx:428` use `flightIATA` first, then `callsign`.
     - `Ticker.tsx:80` uses `callsign` first.
   - In `tests/fixtures/ual-feed-2026-10-04-trimmed.json`, 3 of 60 rows have an empty `flightIATA` **and** an empty callsign and dest. Those rows print blank idents; they are not a callsign fallback.
   - Express rows carry `flightIATA` `UA5575` with callsign `SKW5575`, so the sidebar and map print the linkable UA number.
   - The only evidenced operating-callsign print is the Ticker's squawk line: callsign first, so an Express emergency prints `SKW5575`, which has no page.
3. **Watch list and banner.**
   - WatchPanel prints the raw ident, which can carry a provider suffix. Whether `flightLink("UA526H")` returns a page is inferred, not tested here.
   - WatchBanner gets only a pre-composed string.
4. **Routes are pre-joined strings.**
   - Schedule `routeLine` `"ORD → DEN"` (`schedule-row-model.js:153`)
   - Stats `"ORD→SFO"` (`analytics.js:107`)
   - Watch `"ORD→DEN"`
   - The codes exist upstream (raw row and feed `origin`/`dest`). No route destination exists.
5. **Non-hub airports have no page.**
   - FAA mentions cover any airport.
   - `/trackers/atc/<code>` is built only for `atcHubDetailCodes`. Other towers have only the `/trackers/atc#row-<code>` anchor (tracker-briefing.js:95, inferred to work for any tracked tower).
6. **In-place follow path.**
   - Query deep links apply once, on mount (`deep-links.ts:143-187`).
   - The in-place click handler `resolveDeepLink` (`deep-links.ts:114-125`, used by `BriefPanel.tsx:67-98`) resolves only `tab`, `scrollTo` (weather hub / nas / irops) and `scheduleHub`.
   - A plain `<a href="/?aircraft=…">`, `?hub=` (Live filter), `?flight=`, `?type=` or `?view=` has no in-app follow path today. Clicking it reloads the island, unless `resolveDeepLink` is extended.
   - Fleet `?type=` takes fleet `t` strings (`fleet-view.js:345-349` against `typeCounts`, `fleet-view.js:50-56`), not ICAO.
7. **Local-only filters with no link or `useUi` setter.**
   - Live phase and search (`LiveView.tsx:77`, `LiveSidebar.tsx:68`)
   - Schedule status / aircraft / family / route / Wi-Fi / time / risk (`ScheduleView.tsx:83`)
   - So stat tiles and donut rows have no link target.
8. **Structural constraints.**
   - **Live regions.** These re-announce whatever is inside them, so links there are re-read:
     - StatsBar `role="status"` (`StatsBar.tsx:99-104`; its own comment at 17-18)
     - HubHealthStrip and IropsSection, both `aria-live="polite"`
   - **No links inside buttons.** A link cannot nest in a button, which affects:
     - the whole-row buttons in the Live search, hub-traffic, phase and WatchPanel rows
     - the Schedule phone stretched button
     - Each needs the `relative z-10` split-out pattern.
   - **Small sideways strips.** The hub strip is a 28 px sideways scroller whose chips are already links. Its hit box is clipped, so chips fill the row (DESIGN 2026-11-11).
   - **Leaflet tooltips.** Map hub labels are non-interactive Leaflet tooltips.
