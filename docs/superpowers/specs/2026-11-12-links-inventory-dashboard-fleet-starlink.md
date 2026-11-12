# Linkability inventory: dashboard Fleet, Starlink, My Flights tabs and overlays

Repo: `/Users/jonahberg-ganzarain/bb-nov11/r128` (v1.28.1, origin/main). Read-only audit, Nov 12 2026.

Each Today cell starts with a status letter:

- **a**: a real `<a>`
- **b**: a button. "link-styled" means the button is painted like a link but is not one.
- **c**: plain text
- **d**: plain text painted in link colour (`text-primary` / `fill-primary`)

"Hub-only" means the value can only be one of ORD DEN IAH EWR SFO IAD LAX NRT GUM (`HUB_ORDER`, `src/lib/hub-health.js:15`). "Any" means any airport.

Two notes on "Fits destination":

- **(page load)** marks a query-param deep link that the island reads only once, at mount: `useDeepLinks` boot effect `src/app/state/deep-links.ts:135-190`, Fleet `readFleetDeepLinks` latch `src/app/views/FleetView.tsx:320-346`. In-island it is reachable only by a full navigation or a new click handler.
- **(in-app only)** marks a destination that is local view state with no URL. Examples: Starlink roster filters (`StarlinkView.tsx:130-136`), Express search (`FleetView.tsx:108`), Fleet search/Wi-Fi.

There is one cross-view in-app channel: the "Ask the board" store (`src/app/state/ask.tsx`). `setAskResult({view, filters}, source)` is a module-level function, followed by `setTab(view)`, as in `SearchPalette.tsx:250-258`. With it any code can, without a page load:

- Fleet (`useAskFleet`, `src/app/views/fleet/useAskFleet.ts:30-37`; `fleetAskPatch`, `src/lib/ask-apply.js:212-216`): put a tail, type or family into the **search** box (type/family become search text; the Type and Wi-Fi selects are reset to all), or set Status=Starlink. It always shows All Aircraft.
- Starlink (`useAskStarlink`, `src/app/views/starlink/useAskStarlink.ts:24-29`): set the departures board's **hub**, or put a **tail** into the roster search.

Side effects: the AskChips row appears ("Filters from your question"), and the answer must pass `validateAskResult`. Its `source` type is `'rules'|'model'`. It cannot reach Fleet `?view=airborne|special|express`, `?filter=stored|special|livery`, the Starlink roster Fleet/Type/Operator/New filters, or Express search. "(in-app only)" below means only reachable from inside that view, unless this note says the Ask channel covers it.

The one existing in-island link pattern is `BriefChip` (`src/app/features/BriefPanel.tsx:66-118`). It renders a real `href`, intercepts a plain left click through `resolveDeepLink()` (`deep-links.ts:113-124`) and calls `setTab`/`setCurrent`. It renders as text when following the link would do nothing. `resolveDeepLink` understands only `tab`, the weather scroll params and the schedule `hub`. It does not understand `?aircraft=`, `?flight=`, `?type=`, `?filter=`, `?view=` or `?watch=`.

---

## FLEET TAB

### F1. Aircraft Lookup sub-tabs (`src/app/views/FleetView.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "All Aircraft (N)" | count of the mainline DB | **b**: Radix TabsTrigger, switches sub-view | 493-495 | Fleet default view | Already navigational (in-tab). |
| "Airborne Now (N)" | count | **b**: sub-view | 496-499 | `?view=airborne` (page load) | |
| "⚡ Starlink (N)" | count | **b**: `setTab('starlink')` | 500-503, handler 481 | `#starlink` / `?view=starlink` | Already goes there. |
| "Special (N)" | count | **b**: sub-view | 504-506 | `?view=special` (page load) | |
| "United Express (N)" | count | **b**: sub-view | 507-509 | `?view=express` (page load) | |
| "United Fleet Site" | external source | **a**: external `https://unitedfleetsite.com/` | 457-464 | n/a | |

### F2. Fleet Pulse (`src/app/views/fleet/FleetPulse.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Airborne count (big figure) | count summarizing airborne rows | **c** | 54-58 | Fleet `?view=airborne` (page load) or in-app `setSubView('airborne')`; `#live` | |
| "N mainline matched · N not in fleet DB · N regional/partner" | 3 counts | **c** | 70-76 | matched → `?view=airborne`; regional/partner → `?view=express` (inferred: that panel lists Express tails, not the flights now airborne); not-in-DB → none exists | One string. Splitting it is needed to link the parts. |
| "X% fleet utilization (m/total)" | count | **c** | 78-82 | `?view=airborne` | |
| Per-type bar row: type label ("737 MAX 9") | aircraft type (fleet-DB `t`) | **c** | 88-90 | `/fleet/<slug>`: every DB type has a page (Q1); or Fleet `?type=<t>&view=airborne` (page load) | Rows only for types with ≥1 airborne (49). |
| Per-type bar row: "flying/total pct" + bar | count/bar | **c** | 91-99 | Fleet `?type=<t>&view=airborne` (page load) | |
| LIVE badge / "Updated HH:MM:SSZ" | timestamp | **c** | 105-116 | none | |

### F3. Fleet Health + Starlink chips (`src/app/views/fleet/FleetHealth.tsx`; chip data `FleetView.tsx:176-197`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Total Mainline Aircraft (big figure) | count | **c** | 85-89 | Fleet All Aircraft (`#fleet`) | |
| "N active (P%) · N out of service" | counts | **c** | 90-92 | `?filter=active`; `?filter=stored` (page load). `stored` = any non-empty status (`src/lib/fleet-utils.js:118`), i.e. stored + maintenance. | |
| Health bar rows (dot + category label + bar + "count (pct)") ×7 | count/bar per status category | **c** (`li` with aria-label) | 96-121 | Active → `?filter=active`. Stored/maintenance/painting/Starlink install/NEXT retrofit/future GUM → only the coarse `?filter=stored`; no per-category filter exists. | Categories from `FLEET_HEALTH_CATEGORIES` (fleet-utils.js:~9-17). |
| Starlink Equipped progress bar + "%" | count | **c** | 127-139 | Fleet `?filter=starlink` (page load) / `#starlink` | |
| Chip "Total" | Starlink count | **c** (`text-bb-ok`) | 147-158; data FleetView 185 | `#starlink` | |
| Chip "Mainline" | Starlink mainline count | **d**: `text-primary` (tone `primary`, FleetHealth.tsx:34) | 151; data FleetView 186 | Fleet `?filter=starlink` (page load) or roster Fleet=Mainline (in-app only) | **Plain text in link colour.** |
| Chip "Express" | Starlink Express count | **c** (`text-bb-starlink`) | 151; data FleetView 187 | roster Fleet=Express (in-app only) | |
| Chip "Mainline Fleet %" | share | **c** | data FleetView 190 | Fleet `?filter=starlink` | |
| Chip "Express Fleet %" | share | **c** | data FleetView 193 | none exact | |
| Chip "New (7d) +N" | count of recently found tails | **d**: `text-primary` (tone `new`, FleetHealth.tsx:37) | 151; data FleetView 195 | Starlink roster "New this week" toggle (`setNewOnly`, StarlinkView.tsx:134/409; in-app only, no URL) | **Plain text in link colour.** |

### F4. Fleet Composition family cards (`src/app/views/fleet/FleetComposition.tsx`; data `FLEET_FAMILIES` fleet-utils.js:36-57)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Family name ("BOEING 737", "787 DREAMLINER") | aircraft family | **c** (h4) | 62 | `/fleet` index (it groups families, `src/pages/fleet/index.astro:38-45`; no per-family anchor found) | |
| "N aircraft" family total | count | **c** | 63-65 | none (no family filter; the type filter is single-type) | |
| Role ("Domestic backbone") | text | **c** | 66 | n/a | |
| Route callout: "ORD-LAX · EWR-SFO · West Coast-HNL" (757) and "EWR & IAD to Europe" (767) | airport codes (ORD LAX EWR SFO IAD are hubs; HNL is not) | **d**: `font-mono text-primary` | 70 | `/hubs/<code>` for the hub codes; HNL none exists | **Plain text in link colour.** Static strings, fleet-utils.js:45, 48. |
| Subgroup label (NG/MAX/Legacy/Neo) | family | **c** | 79-83 | none | |
| Variant card: count + type ("188 / 737 MAX 9") | aircraft type + count | **b**: `aria-pressed` toggle = type filter + scroll to table (FleetView.tsx:258-270). Active state is `text-primary`. | 88-103 | `/fleet/<slug>`: every type has a page | **A link cannot nest in this button.** A `/fleet` link would be a sibling, or the card stays a filter. |

### F5. Delivery Timeline (`src/app/views/fleet/DeliveryTimeline.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Year bar (stacked by family, SVG `<g>` + `<title>`) | count/bar per delivery year | **c** (inside one `role="img"` SVG) | 69-121 | none exists (no delivery-year filter) | SVG is a single image to AT. |
| Year count label over bar | count | **d**-ish: SVG text `fill-primary` | 81-92 | none | Link-coloured SVG text; not a row entity. |
| Year axis labels | year | **c** | 107-117 | none | |
| Legend: "737NG", "737 MAX", "A320 family", "A321neo", "757", "767", "777", "787" | aircraft family/type | **c** | 123-137; names fleet-view.js:32-35 | "A321neo" → `/fleet/a321neo`; others are families → `/fleet` | |
| "Average: Xy" | stat | **d**: `<strong text-primary>` | 140 | none | **Plain text in link colour.** |
| "Newest: N12345 (2026)" | tail | **c** | 141-148 | aircraft dialog (`openAircraft`) / `?aircraft=` (page load) | |
| "Oldest: N12345 (1997)" | tail | **c** | 149-156 | aircraft dialog / `?aircraft=` | |
| Decade buckets ("2020s: 412") | count | **c** | 158-164 | none | |

### F6. Seat Configuration gallery (`src/app/views/fleet/SeatConfigGallery.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Empty-state quick types (737-800, A321neo, 777-300ER) | aircraft type | **b**: selects type filter | 44-55 | also `/fleet/<slug>` | Button; a link can't nest. |
| "{type} Configurations" heading | aircraft type | **c** | 64 | `/fleet/<slug>` | |
| Config row: config code + "(N aircraft, S seats)" | count | **c** | 66-72 | Fleet search for the config string (in-app only, `setSearch`; search matches config per placeholder FleetControls.tsx:94) | |
| Cabin blocks ("50J") | seats | **c** | 73-90 | none | |

### F7. Fleet controls (`src/app/views/fleet/FleetControls.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Type select items "737-800 (141)" | type + count | **b** (Select item) | 104-111 | n/a (is the filter) | |
| Wi-Fi / Status select items | filter values | **b** | 114-143 | n/a | |

### F8. All Aircraft table (`src/app/views/fleet/FleetTable.tsx`), ~1,139 rows

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Reg | tail | **b**, link-styled (`text-primary` + hover underline) → `onOpenAircraft` (aircraft dialog) | 117-124 | `?aircraft=<reg>` (page load) | Painted as a link, behaves as a dialog button. It could be `<a href="?aircraft=…">` with a click intercept (inferred). |
| ★ special name chip | named aircraft | **c** | 125-129 | Fleet `?view=special` / `?filter=special` (page load) | |
| Livery badge (compact) | special livery | **b**: tooltip trigger (`SpecialLiveryBadge.tsx:55-74`) | 130 | `?view=special` / `?filter=livery` | |
| Type | aircraft type (fleet-DB `t`) | **c** | 132 | `/fleet/<slug>`: 1:1 via `typeCode` (Q1) | |
| AC# | fleet number | **c** | 133 | none | |
| Config | cabin code | **c** | 134 | none | |
| Seats | count | **c** | 135 | none | |
| WiFi | Wi-Fi system | **c** | 136 | Wi-Fi filter (in-app only); "Starlink" → `?filter=starlink` | |
| IFE | text | **c** | 137 | none | |
| Del | year | **c** | 138 | none | |
| Status | status text | **c** | 139 | `?filter=stored` (coarse) | |
| SL chip | Starlink flag | **c** (`text-bb-starlink`) | 140-146 | `#starlink` / `?filter=starlink` | |
| Empty state "Show it" / "Clear Filters" | control | **b** | 76-83 | n/a | |

### F9. Airborne Now table (`src/app/views/fleet/AirborneTable.tsx`; rows `src/lib/fleet-view.js:284-312`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Reg | tail | **b**, link-styled → aircraft dialog | 90-98 | `?aircraft=` | |
| Type | aircraft type (DB `t`) | **c** | 99 | `/fleet/<slug>` | |
| Flight | flight number (`flightIATA \|\| callsign`, fleet-view.js:301) | **a**: `FlightLink hit="inline"` → `/flight/UA…`; plain if no United prefix | 100-102 | done | Mainline only, so practically always linked; a `UAL…` fallback links too. |
| Route "ORD > DEN" | route, any airport (either end) | **c** | 103; built as one string at fleet-view.js:302 | `/hubs/<code>` for hub ends | Must split the string to link the ends. |
| Alt / Phase | data | **c** | 104-105 | none | |
| SL chip | Starlink flag | **c** | 106-112 | `#starlink` | |
| ★ special name chip | named aircraft | **c** | 113-118 | `?view=special` | |
| Livery badge | livery | **b**: tooltip | 119 | `?view=special` | |

### F10. Special panel card grid (`src/app/views/fleet/SpecialPanel.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Name (livery or named aircraft) | special livery / name | **c** | 75-80 | none exists (no per-livery page) | |
| Description | text | **c** | 81-83 | n/a | |
| Reg | tail | **b**, link-styled → aircraft dialog | 84-91 | `?aircraft=` | |
| "type · Del year" / "Not in the mainline fleet database" | aircraft type | **c** | 92-94 | `/fleet/<slug>` | Type and year are one string. |
| AIRBORNE chip | status | **c** | 99-106 | none | |
| Airborne flight ("UA123") | flight number (`flightIATA \|\| callsign`, fleet-view.js:376) | **c** | 107-109 | `/flight/UA…` via `FlightLink` | Not linked today. |
| Airborne route ("ORD > DEN") | route, any airport | **c** | 108; string from fleet-view.js:377 | `/hubs/<code>` for hub ends | Same `<p>` as the flight. |
| NAMED / LIVERY chip | kind | **c** | 111-115 | `?filter=special` / `?filter=livery` | |

### F11. United Express panel (`src/app/views/fleet/ExpressFleetPanel.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "N aircraft" | count | **c** | 116-119 | none | |
| "⚡ N Starlink" | count | **c** (`text-bb-starlink`) | 120-123 | Starlink roster Fleet=Express (in-app only) | |
| Operator count chips ("SkyWest 165") | operator + count | **c** | 126 → 61-73 | Express search for the operator (in-app only, `setExpressSearch`; search covers operator per placeholder :139) | No operator page exists. |
| Type count chips ("E175 251", "CRJ550 …") | regional type + count | **c** | 127 → 61-73 | Express search (in-app only) | **No `/fleet` page for any regional type.** |
| Coverage note | text | **c** | 128-132 | n/a | |
| Reg (sticky column) | tail | **b**, link-styled → aircraft dialog | 186-194 | `?aircraft=` | |
| Type | regional type (`E175`, `CRJ200`, `ERJ145`, `CRJ700/550`, `CRJ550`, `E170`; express-fleet.js:79-96) | **c** | 195 | none exists | |
| Operator | operator | **c** | 196-198 | none exists (in-app search only) | |
| WiFi | Starlink / No Wi-Fi / unknown | **c** | 199-211 | none | |
| Config (conditional column) | cabin | **c** | 212-216 | none | |
| Last UA flight | flight number: feed `flightIATA`, `UA…` or `G7…` (express-fleet.js:38-44) | **c** (font-mono) | 217 | `/flight/UA…` via `FlightLink`; `G7…` stays plain | Not linked today. |
| Last seen | date | **c** | 218-227 | none | |

---

## STARLINK TAB

### S1. Hero (`src/app/views/starlink/SlHero.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Equipped count (big) | count of roster | **c** | 70-72 | roster below (in-page) | |
| "N of M checked verified" | count | **c** | 74-77 | ledger (in-page) | |
| "N disputed" | count | **b**, link-styled (`underline`) → scroll to ledger | 77-88 | ledger (in-page) | Underlined, so it reads as a link. |
| Rollout bar label "Mainline" / "Express" | fleet segment | **c** | 95-97; labels `src/lib/starlink-roster.js:310,316` | Mainline → Fleet `?filter=starlink` (page load); Express → roster Fleet=Express (in-app only) or Fleet `?view=express` | Confirmed plain (brief). |
| Bar "installed / total · pct" + bar | count/bar | **c** | 98-106 | same as above | |
| Bars note | text | **c** | 109-113 | n/a | |
| "+N NEW THIS WEEK" chip | count of new tails | **c** (span with chip shape) | 120-125 | roster "New this week" toggle (`setNewOnly` / `onNewOnly`, StarlinkView.tsx:409; in-app only) | Confirmed plain. |
| "● N AIRBORNE NOW" | count | **b** → `setStarlinkFilter(true)` + `setTab('live')` | 126-144 | done | |
| Degraded "N AIRBORNE NOW" | count | **c** (deliberate) | 145-153 | none, by design | |

### S2. Installation Velocity chart (`src/app/views/starlink/VelocityChart.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Month bar (Express + Mainline stacked, `<title>`) | count/bar per month | **c** (SVG `role="img"`) | 171-213 | none exists (no install-month filter) | |
| Month count labels | count | **c** | 232-249 | none | |
| Axis ticks / cumulative end value | numbers | **c** | 149-169, 250-271 | none | |
| Legend Express / Mainline / Cumulative | series | **c** | 301-326 | roster Fleet filter (in-app only) | |
| sr-only month table rows | data | **c** | 277-299 | n/a | |
| Pace tiles "Avg / Wk", "Express · 100% ETA" | stats | **c** | 334-361 | none | |

### S3. Industry strip (`src/app/views/starlink/IndustryStrip.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Carrier code (UA, others) | operator/carrier | **c** | 35-41 | none exists (UA would be the same tab) | Confirmed plain. |
| Bar + "installed / total · pct" | count/bar | **c** | 42-53 | none | |

### S4. Hub Departures Board (`src/app/views/starlink/DeparturesBoard.tsx`; rows `src/lib/starlink-utils.js:264-345`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| 12H / 48H | control | **b** | 174-185 | n/a | |
| "ALL N" pill | count | **b**: filter | 194-201 | n/a | |
| Hub pill "ORD 12" | airport (hub-only) + count | **b**: `onHub` filter (aria-pressed) | 202-217 | also `/hubs/<code>`, `?tab=schedule&hub=` | **A link cannot nest in the pill.** The pill is the filter. |
| Bucket label + count ("NEXT HOUR 6") | time bucket | **c** | 225-233 | none | Buckets are time windows (`departureBucketLabel`), not hubs. |
| Departure time + relative | time | **c** | 55-58 | none | |
| Flight number | flight number (feed `flight_number`) | **a** when UA/UAL-prefixed (`FlightLink`, `linkClassName="z-10"`) → `/flight/UA…`; **c** for operating callsigns (SKW…, OO…) | 67-69 | done for UA; callsigns have none (Q2) | Confirmed. Test asserts SKW5408 is plain (`tests/starlink-panels.test.tsx:95-96`). |
| "Operator · Tail" (e.g. "SkyWest · N801SK") | operator + tail | **b** → `onOpenAircraft(tail)`. Stretched `after:absolute inset-0`: over the column with a mouse, over the **whole row** on touch (`pointer-coarse:static` on the wrapper, :65). | 70-78 | tail ✓ (dialog); operator → none exists | Confirmed. |
| Route "ORD → BOI" | route: origin **hub-only** (starlink-utils.js:296), destination any | **c** | 81-87 | origin `/hubs/<code>`; destination `/hubs/` only when a hub | Any new link here needs `relative z-10` to sit above the stretched aircraft button on touch. |
| Type (hidden below `sm`) | aircraft type (roster string) | **c** | 89 | `/fleet/<slug>` for mainline via a tail join (Q1); Express none | |
| Status "Airborne" / "SCHED" | status | **c** | 98-110 | none | |
| "SCHED · inbound on UA3508" | flight number (live feed `flightIATA \|\| callsign`, starlink-utils.js:288-290) | **c** | 103-107 | `/flight/UA3508` via `FlightLink` | Confirmed plain. The value is the FR24 feed's own IATA number, so `FlightLink` would link UA ones. |
| "Track" / "Track inbound" | control | **b** → select + focusOn + `setTab('live')` | 111-125 | done | |
| "Show all · N more departures" | count | **b** | 247-255 | n/a | |
| Footer disclosure | text | **c** | 260 | n/a | |

### S5. Roster controls (`src/app/views/starlink/RosterControls.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Fleet / Type / Operator select items | filter values | **b** | 71-126 | n/a | Options come from the data (`rosterOptions`). |
| "★ New this week" | toggle | **b** (aria-pressed) | 128-137 | n/a | |
| "N of M" | count | **c** | 139-141 | none | |

### S6. Starlink Roster table (`src/app/views/starlink/RosterTable.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Tail (▸ N801SK) | tail | **b** → toggles the row's expansion (`aria-expanded`); hover underline, not `text-primary` | 255-266 | aircraft dialog / `?aircraft=`. Today that is reached through the expansion's "Aircraft Details" button (:150-157). | The tail cell is a disclosure. Linking the tail means a second control or a changed disclosure. |
| NEW badge | recency | **c** | 267-274 | roster New toggle (in-app only) | |
| Red "!" | integrity conflict | **c** | 275-285 | ledger (in-page) | |
| Fleet ("Mainline" / "Express") | fleet segment | **c** | 287 | roster Fleet filter (in-app only); Express → Fleet `?view=express` | |
| Type ("737-900ER", "ERJ-175", "E175SC", "CRJ-550", "777-224(ER)", "787-8 Dreamliner", "A321-271NY(XLR)") | aircraft type (tracker string) | **c** | 288 | mainline → `/fleet/<slug>` (map by tail, Q1); ERJ-175 / E175SC / CRJ-550 → none exists | Confirmed plain. |
| Operator ("SkyWest dba UAX") | operator | **c** | 289-291 | roster Operator filter (in-app only); no page | Confirmed plain. |
| Status "Airborne" / "Scheduled" (conditional column) | status | **c** | 292-303 | Airborne → Track (`trackByIcao`, in-app) | |
| Next Flight number | flight number (feed `flight_number`) | **c** (font-mono) | 304-308 | `/flight/UA…` via `FlightLink` when UA-prefixed; callsigns none | Confirmed plain. |
| Next Flight route "ORIG→DEST" | route, any airport | **c** | 309 | `/hubs/<code>` for hub ends | |
| Next Flight time | time | **c** | 310-312 | none | |

### S7. Roster row expansion (`src/app/views/starlink/RosterTable.tsx`, `Expansion`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Starlink Since | date | **c** | 88-95 | none | |
| Operator | operator | **c** | 96-99 | none exists | |
| Airframe | aircraft type (tracker string) | **c** | 100-103 | `/fleet/<slug>` for mainline (Q1) | |
| Fleet | segment | **c** | 104-107 | Fleet `?view=express` for Express | |
| "Upcoming Flights": flight number | flight number | **c** | 124 | `/flight/UA…` via `FlightLink`; callsigns none | Confirmed plain. |
| Upcoming route | route, any airport | **c** | 125-131 | `/hubs/<code>` for hub ends | |
| Upcoming dep–arr times | time | **c** | 132-135 | none | |
| "Track on Live Map" | control | **b** | 145-149 | done | |
| "Aircraft Details" | control | **b** → `openAircraft` | 150-157 | done | |
| "Planespotters ↗" | external | **a**: external | 158-166 | n/a | |

### S8. Verification Ledger (`src/app/views/starlink/VerificationLedger.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Stat tiles Verified Starlink / Disputed / Unverified | counts | **c** | 53-72 | Disputed → the table below; others none | |
| "The verifier's own tallies, as of …" | text | **c** | 76-82 | n/a | |
| Integrity alert ("N disputed tails … : N1, N2") | tails | **c** (`role="alert"`) | 84-93; text `starlink-roster.js:352-358` | aircraft dialog per tail / roster search (in-app only) | Tails are inside a sentence. |
| Tail | tail | **c** | 129-131 | aircraft dialog (`openAircraft`) / `?aircraft=` | Confirmed plain. |
| "!" still-served mark | integrity flag | **c** | 131-141 | roster row (in-app) | |
| Airframe | aircraft type (`claim.aircraft`, shape not in repo) | **c** | 143 | `/fleet/<slug>` if a mainline string (data gap) | |
| Verification "Disputed · Starlink → Viasat" | text | **c** | 144-153 | none | |
| Verified date | date | **c** | 154-156 | none | |

### S9. Starlink source line (`src/app/views/StarlinkView.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "unitedstarlinktracker.com" | external source | **a**: external | 606-613 | n/a | |
| "N aircraft" | count | **c** | 619 | roster (in-page) | |

---

## MY FLIGHTS TAB

### M1. Watched flight card list (`src/app/views/myflight/FlightCard.tsx`; list `MyFlightsView.tsx:335-347`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Flight number (card h2) | flight number | **a**: `FlightLink` → `/flight/UA…` | 134-136 | done | |
| "City (ORIG) → City (DEST)" | route, any airport | **c** | 140-145 | `/hubs/<code>` for hub ends | |
| Countdown / "ETA from live position" | time | **c** | 151-164 | none | |
| Status chip | status | **c** | 166-171 | none | |
| "MOD RISK" badge | risk | **b** → `onExplain` (DelayExplainDialog) | 172-193 | done | |
| "RISK N/A" | risk | **b**: JargonTerm tooltip trigger | 194-201 | n/a | |
| "united.com" | external | **a**: external, `text-primary underline` | 210-217 | n/a | |
| Origin Gate / Dest Gate | gates | **c** | 222-227 | none | |
| Aircraft type (`aircraft.t`) | aircraft type (DB `t`) | **c** | 231-232 | `/fleet/<slug>` | |
| Reg | tail | **b**, link-styled (dotted underline, hover `text-primary`) → `onAircraftDetail` | 236-242 | done (dialog) / `?aircraft=` | |
| Config | cabin | **c** | 244-245 | none | |
| "⚡ Starlink Confirmed" badge | Starlink | **c** | 246-252 | `#starlink` | |
| StarlinkBadge (check/predict result) | Starlink claim | **c** (Badge) | 254, 263; `StarlinkBadge.tsx:70-89` | none | |
| `td.aircraft` (provider type text, no tail known) | aircraft type (provider string) | **c** | 258-264 | `/fleet/<slug>` only if the string maps (format not in repo, data gap) | |
| "Where's My Plane?" heading | heading | **d**: h3 `text-primary` in a `border-primary/40` box | 297-299 | n/a | **Link-coloured heading**, not an entity. |
| Inbound flight (`<strong>{inbound.flightIATA}`) | flight number (feed IATA) | **c** | 300 | `/flight/UA…` via `FlightLink` | |
| Inbound "ORIG → origCode" | route, any → (card origin) | **c** | 300-301 | `/hubs/<code>` for hub ends | |
| View on Map / Aircraft Details / Explain Delay Risk / Unwatch | controls | **b** | 316-354 | done | |

### M2. Aircraft Journey chain (`src/app/views/myflight/JourneyChain.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "Aircraft Journey (N12345)" heading | tail | **c** | 59-61 | aircraft dialog | |
| Prior leg flight number | flight number (`api/aircraft-history.ts:83`: `flight_iata \|\| flight_number.iata \|\| flight \|\| callsign`) | **c** | 72 | `/flight/UA…` via `FlightLink` (callsigns stay plain) | |
| Prior leg "ORIG → DEST" | route, any | **c** | 73-75 | `/hubs/<code>` | |
| Delay ("+12min" / "On time") | delay | **c** (tone colour) | 76-84 | none | |
| Status ("Airborne" / "Landed") | status | **c** | 85 | none | |
| Own flight number | flight number | **c**, body colour **on purpose** ("the card's header above is this flight's link", :90) | 91 | already linked in header | Deliberate. |
| Own route | route | **c** | 93-97 | `/hubs/` | |
| "Your flight" | label | **c**, deliberately not link colour (:98) | 99 | n/a | |

### M3. Connection cards (`src/app/views/myflight/ConnectionPanel.tsx` `ConnectionCard`; list `MyFlightsView.tsx:349-358`; also the manual result :206)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "Connection at HUB (City)" | airport. **Hub-only** for watched pairs (`connection-pairing.js:44` filters on HUB_CODES); **any airport** for the manual check (`connection-pairing.js:225,250` uses `arrHub` unchecked) | **c** | 62-64 | `/hubs/<code>` when a hub | |
| Risk chip | risk | **c** | 65-70 | none | |
| Inbound flight number | flight number | **c** | 74 | `/flight/UA…` via `FlightLink` | |
| Inbound origin | airport, any | **c** | 74 | `/hubs/` if hub | |
| Connection hub (bold) | airport (same rule as above) | **c** | 75, 78 | `/hubs/` | |
| Outbound flight number | flight number | **c** | 78 | `/flight/UA…` | |
| Outbound destination | airport, any | **c** | 79 | `/hubs/` if hub | |
| Detail line / label | text | **c** | 82-85 | none | |

### M4. Manual connection check and quick add

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "Check a Connection" heading | heading | **d**: h3 `text-primary` | ConnectionPanel.tsx:163-165 | n/a | **Link-coloured heading**, not an entity. |
| Check button / inputs | controls | **b** | ConnectionPanel.tsx:166-196 | n/a | |
| Quick-add field + empty-state prose | input | n/a (no list) | QuickAdd.tsx:60-113 | n/a | No repeated rows. |
| "Clear all watched flights" | control | **b** | MyFlightsView.tsx:361-371 | n/a | |

---

## OVERLAYS (`src/app/features/`)

### O1. Flight sheet (`FlightSheet.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Title ident ("UA929", "G73375") | flight number | **c** (SheetTitle, focus target) | 350-352 | `/flight/UA…` | The page link lives in the link row below (:669-676). |
| Phase / Cancelled / Diverted badges | status | **c** | 353-361 | none | |
| Description "City → City" | route | **c** | 374-378 | `/hubs/` for hub ends | |
| "Operated by SkyWest Airlines (United Express) · SKW5123" | operator + callsign | **c** | 382-389 | none exists | |
| Big route "ORD → LHR" | airports, any | **c** | 402-409 | `/hubs/<code>` when a hub | |
| Aircraft type (mainline) | aircraft type (DB `t`) | **c** | 486 | `/fleet/<slug>` | |
| Reg (mainline) | tail | **b**, link-styled: shadcn `variant="link"` (`text-primary hover:underline`, button.tsx:20) → `openAircraft` | 487-493 | done (dialog) | |
| "⚡ Starlink confirmed" badge | Starlink | **c** | 494-498 | `#starlink` | |
| ★ special name badge | named aircraft | **c** | 499-503 | `?view=special` | |
| Config · Wi-Fi · IFE line | text | **c** | 505-510 | none | |
| Seat chips | seats | **c** | 511-528 | none | |
| Express type | regional type | **c** | 535 | none exists | |
| Express reg | tail | **b**, link-styled `variant="link"` → `openAircraft` | 536-542 | done | |
| Express Starlink badge / operator line / cabin / "Seen flying United since" | text | **c** | 543-576 | none | |
| Unmatched "E75L · N123 (note)" | type (ICAO code) + tail | **c** | 579-590 | tail → aircraft dialog; ICAO code → none (ambiguous, see Q1) | |
| Livery badge | livery | **b**: tooltip | 592 | `?view=special` | |
| Time rows | times | **c** | 609-628 | none | |
| Watch / Share | controls | **b** | 645-664 | done | |
| "Open flight page" | flight page | **a** → `flightPagePath(parseFlightIdent(ident))`; shown only when `parseFlightIdent` accepts the ident (UA/UAL/bare digits) | 669-676 | done | Uses `parseFlightIdent`, not `flightLink`. |
| FlightAware / Planespotters / ADS-B Exchange | external | **a**: external | 677-708 | n/a | |

### O2. Aircraft detail dialog (`AircraftDetailDialog.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Title reg | tail | **b**: `JargonTerm` tooltip trigger ("tail"), a `<button>` (JargonTerm.tsx:87-90) | 204-206 | n/a (this is the aircraft) | |
| Type (mainline) | aircraft type (DB `t`) | **b**: `JargonTerm` tooltip trigger ("equipment") | 213-214 | `/fleet/<slug>` | **The type is already a tooltip button**, so a link cannot share it. |
| "AC# 3501" | fleet number | **c** | 215-219 | none | |
| ★ name / livery / STARLINK badges | flags | **c** / **b** (livery tooltip) | 221-235 | `?view=special`, `#starlink` | |
| Express: type + "SkyWest · United Express" | regional type, operator | **c** | 237-250 | none exists | |
| Fallback: type + operator | type, operator | **c** | 251-266 | `/fleet/<slug>` for mainline strings | |
| Express facts Type / Operator / WiFi / Config / seats | facts | **c** | 312-327 | none | |
| Express "Last United flight" | flight number (`UA…`/`G7…`) | **c** (font-mono) | 325 | `/flight/UA…` via `FlightLink` | |
| Express/fallback airborne block: "Airborne — UA5712" + "ORIG → DEST" | flight number + route | **b**: the whole block is one button → map (`onViewOnMap`) | 329-345, 369-385 | `/flight/…`, `/hubs/…` | **A link cannot sit inside this button.** |
| Biography facts (Delivered, Seats, WiFi, IFE, Power, Engine, Starlink, Config) | facts | **c** | 413-443 | none | |
| Status badge + raw status | status | **c** | 447-468 | `?filter=stored` (coarse) | |
| Live status block: "Airborne — UA360", "Denver → Seattle", "DEN → SEA", metrics | flight number + route | **b**: whole block → map | 474-519 | `/flight/UA…`, `/hubs/<code>` | **Link can't nest.** |
| Seat chips + cabin bar | seats | **c** | 527-565 | none | |
| Watch | control | **b** | 570-588 | done | |
| Planespotters ↗ / FlightAware ↗ | external | **a**: external | 589-602 (also 301-305, 403-407) | n/a | |
| Share / Retry | control | **b** | 603-610, 297-300 | n/a | |

### O3. Search palette ⌘K (`SearchPalette.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "Ask: …" row / example rows | control | **b**: cmdk `CommandItem` (option) | 301-338 | n/a | |
| Airborne row: ident | flight number | **b**: the whole row is one option → `select` + `focusOn` | 373-391 | `/flight/UA…` | **Rows are `role=option` in a listbox. No nested links; one target per row.** |
| Airborne row: "ORIG → DEST" | route, any | (same option) | 392-394 | `/hubs/` | |
| Airborne row: "B39M N12345" | ICAO type + tail | (same option) | 395-397 | aircraft dialog | |
| Schedule row "📅 UA123 ORD→DEN N12345" | flight + route + tail in one label (`global-search.js:124`) | **b** → `goto` board row + `setTab('schedule')` | 403-419 | done (board) | |
| "Open aircraft details for N…" | tail | **b** → `openAircraft` | 431-443 | done | |
| "Look up UA123 times and gates" | flight number | **b** → `openFr24` | 444-456 | done (dialog); `/flight/UA123` is an alternative | |
| "Open the Schedule tab" | control | **b** | 457-466 | done | |

### O4. FR24 lookup dialog (`Fr24LookupDialog.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Title flight number | flight number | **a**: `FlightLink` | 198-200 | done | |
| Status badge | status | **c** | 201-213 | none | |
| Callsign (description) | callsign | **c** | 215-217 | none exists | |
| Origin IATA + airport name | airport, any | **c** | 231-236 | `/hubs/<code>` when a hub | |
| Destination IATA + airport name | airport, any | **c** | 240-247 | `/hubs/` when a hub | |
| "Aircraft: {type}" | FR24 type string | **c** | 275-278 | `/fleet/<slug>` if it maps (format not in repo) | |
| Reg | tail | **b**, link-styled (dotted underline, hover `text-primary`) → close + `openAircraft` | 279-292 | done | |
| Dep/Arr times | times | **c** | 297-306 | none | |
| "Fleet Match:" label | label | **d**: `<span text-primary>` | 310 | n/a | **Link-coloured label** in a `bg-primary/10` box. |
| Fleet-match type (`fleetMatch.t`) | aircraft type (DB `t`) | **c** | 310 | `/fleet/<slug>` | |
| Position line | data | **c** | 316-324 | none | |
| Share | control | **b** | 332-342 | n/a | |

### O5. Ops brief panel / sheet (`BriefPanel.tsx`, `BriefSheet.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Item sentence | model text (may name hubs) | **c** | BriefPanel 153-158 | n/a | Free text; entities are not tagged. |
| Evidence chip with a target | fact | **a**: real `href` (`/?tab=schedule&hub=ORD`, `/?tab=irops`, `/?tab=weather&hub=EWR`, `/?tab=weather&section=nas`, `/#weather`, `/#live`, `/#starlink`; `brief-chips.js:189-224`) with click intercept | BriefPanel 100-118 | done | The reference in-island link pattern. |
| Evidence chip without a target | fact | **c**: dashed span (deliberate, DESIGN 2026-11-10) | BriefPanel 72-91 | none, by rule | |
| Traveler note | text | **c** | BriefPanel 185-192 | n/a | |
| Source / freshness / radio caveat / "How this was written" steps | text | **c** (+ `<details>` summary **b**) | BriefPanel 194-216 | n/a | |
| Sheet Close | control | **b** | BriefSheet 47-53 | n/a | BriefSheet only hosts `BriefBody`. |

### O6. Delay explain dialog (`DelayExplainDialog.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Title flight number | flight number | **a**: `FlightLink` | 114-116 | done | |
| Risk badge | risk | **c** | 119-125 | none | |
| "ORD→DEN · Score 42/100" | route (from caller context) + score | **c** | 127-129 | `/hubs/<code>` for hub ends | One string. |
| Contributing factors list | free text | **c** | 155-169 | none | |

### O7. News banner (`NewsBanner.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Headline (rotating, one at a time) | news article | **a** → `/news/<slug>` | 120-128 | done | |
| "Read →" | news article | **a** → `/news/<slug>` (`text-primary`) | 129-135 | done | |
| Dismiss | control | **b** | 136-146 | n/a | |

### O8. Ask chips (`AskChips.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Summary line ("12 aircraft in the fleet list") | count | **c** | 74-78 | n/a | |
| Filter chip (label may name a hub, type, family, flight or tail) | filter | **b** → removes that filter | 79-97 | n/a | The chip **is** a remove control. Do not link. |
| Clear ✕ | control | **b** | 98-110 | n/a | |

### O9. Special livery badge (`SpecialLiveryBadge.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| `SpecialLiveryBadge` | livery | **b**: tooltip trigger | 53-81 | Fleet `?view=special` / `?filter=livery` (page load) | It is the tooltip's button, so a link can't share it. |
| `SpecialLiveryMarker` | livery | **c** (inert, used inside other buttons) | 84-99 | n/a | |

### O10. Tip strip (`TipStrip.tsx`)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Tip text (one at a time) | free text | **c** | 92 | n/a | Not a list of entities. |
| Dismiss | control | **b** | 93-101 | n/a | |

---

## Q1. Aircraft type string → `/fleet/<slug>`

**No function anywhere maps an aircraft type string to a `/fleet/<slug>`.**

- **What was searched:** `src/lib`, `src/app` and `src/scripts`, for `fleetTypes`, `slug`, `typeSlug`, `fleetSlug`, `slugFor`, `fleetPath`, `family`, and for `'/fleet` / `` `/fleet/${ `` hrefs.
- **What exists:**
  - `src/data/fleet/index.js:71` `fleetTypes`: slug → per-type data. Each entry carries `.slug` and `.typeCode`, for example `"737 MAX 9"` (`src/data/fleet/737-max-9.js:8`).
  - The Astro pages build `/fleet/${t.slug}` from it (`src/pages/fleet/index.astro:301, 393, 425`; `src/pages/sitemap.xml.ts:41`).
  - `src/data/news/index.js:86` `resolveTag` maps the other way, slug → label.
- **Nearby helpers that map types but not to pages:**
  - `src/lib/equipment-swaps.js:15` `ICAO_TO_FLEET_TYPE` (ICAO → DB `t`)
  - `src/lib/aircraft-type.js:24` `FLEET_TYPE_TO_ICAO` and `:51` `fleetTypeForReg`
  - `src/lib/schedule-reg-guard.js:14` `fleetFamily`
  - `src/lib/schedule-filters.js:1` `getScheduleFleetFamily`
  - `src/lib/express-fleet.js:104` `normalizeExpressType` (roster regional strings → E175/CRJ550 labels)
  - `src/lib/ask-parse.js:68-95` (words → family/ICAO)

**The Fleet tab's strings are an exact 1:1 match.**

- The 19 distinct `t` values in `public/data/fleet.json` equal the 19 `typeCode` values in `src/data/fleet/*.js` (checked). `TYPE_ORDER` (`src/lib/analytics.js:13`) and `FLEET_FAMILIES` (`fleet-utils.js:36-57`) use the same 19.
- So DB type → slug is an inversion of `fleetTypes` by `typeCode`, and every Fleet-tab type has a page.
- Caveat: ICAO codes do not map uniquely. B739 covers the 737-900 and -900ER, and B772 the 777-200 and -200ER (`src/lib/fleet-live.js:8-11`, `aircraft-type.js:18-21`).

**Starlink roster strings, joined to `fleet.json` by tail.** Source: `public/data/starlink.json`, the 601-row static roster. This follows the repo's own rule: match by tail, never by type string (`fleet-live.js:8-11`).

| Roster string | Tails | Fleet DB `t` for those tails | Page |
|---|---|---|---|
| 737-900ER | 75 | 737-900ER | /fleet/737-900er |
| 737-800 | 94 | 737-800 | /fleet/737-800 |
| 737 MAX 9 | 11 | 737 MAX 9 | /fleet/737-max-9 |
| 737 MAX 8 | 1 | 737 MAX 8 | /fleet/737-max-8 |
| A321neo | 63 | A321neo | /fleet/a321neo |
| A321-271NY(XLR) | 2 | A321neo | /fleet/a321neo (the index counts XLRs under A321neo, fleet/index.astro:494) |
| 787-8 Dreamliner | 1 | 787-8 | /fleet/787-8-dreamliner |
| 777-224(ER) | 2 | 777-200ER | /fleet/777-200er |
| **737-900** | 1 (N75436) | **737-900ER** | A string match would send it to /fleet/737-900. **Wrong per the fleet DB.** |
| ERJ-175 | 153 | not in fleet.json | **none exists** |
| E175SC | 98 | not in fleet.json | **none exists** |
| CRJ-550 | 100 | not in fleet.json | **none exists** |

**Other printed type strings with no page:**

- Express panel, dialog and sheet labels: E175, E170, CRJ200, ERJ145, CRJ700/550, CRJ550 (`express-fleet.js:79-96`).
- FR24 ICAO `acType` codes for regionals (E75L, CRJ2, E145…).

Not verified: FR24-lookup, flight-times (`td.aircraft`) and ledger `claim.aircraft` strings. Their formats are not in the repo.

## Q2. Operating callsign → United marketing number

**No code turns an operating callsign into a United marketing number.**

- `src/lib/express-operators.js` exports only these:
  - `UNITED_OPERATORS` (:18)
  - `operatorFromCallsign` (:36)
  - `isExpressFlight` (:52)
  - `operatedByLine` (:63)
  - `flightAwareIdent` (:80). This goes the other way: it uses the operator callsign for Express.
- The module's header says "Display only. Nothing here may be used as a flight key … (a GoJet row's flightIATA is 'G73375')" (:10-11).
- `src/lib/flight-link.js:14-15` deliberately leaves operating callsigns unlinked.

The only callsign-to-number conversions in the repo are UAL → UA:

- `feedFlightIdent` (`src/lib/fleet-live.js:31-36`)
- `flightLink` / `parseFlightIdent` (`flight-link.js:23`, `flight-page.js:37`)
- `normalizeIdent` (`deep-links.ts`, '' / 'UAL123' / '123' → 'UA123')
- the F100 board rewrite (UAL callsign → UA ident)

None of them handles SKW/RPA/GJS/ASH/UCA/OO/YX/G7.

**No code or test asserts that SKW5750 flies as UA5750.** Searches for `5750`, `marketing number`, `toMarketing`, `callsignTo` and similar found nothing of the kind.

Tests that assert the opposite policy:

- `tests/flight-link.test.js:22-26`: SKW5123, RPA3508, OO4737, GJS4321 and ASH5800 → `null` (no link).
- `tests/starlink-panels.test.tsx:95-96`: the board prints SKW5408 as plain text.
- `tests/aerodatabox-board-integrity.test.js:383-391`: "leaves a real GoJet-flown Express row on its own ident" (G7 4321 stays `G74321`). The one rewrite (F100, :371-381) applies only when the callsign is `UAL60`.

How the server matches operator clones:

- The AeroDataBox operator-clone collapse matches on **route + time**, never on number (`api/_schedule-aerodatabox.ts:572-609`).
- `UNITED_EXPRESS_CARRIERS` holds the IATA operator codes OO, YV, YX, ZW, G7, C5, AX and EV (:501).

What the fixtures show (live-feed rows written by hand, not assertions of a rule):

- **Same digits:** UA5928/SKW5928 (`tests/flight-sheet.test.tsx:185`), UA5102/SKW5102 (:224), UA4226/UCA4226 (:234), UA5123/SKW5123 (:259), UA4422/GJS4422 (`tests/flight-history.test.js:88`), UA5300/SKW5300 (:139).
- **Counter-examples:** GJS3375 ↔ flightIATA `G73375` (`flight-sheet.test.tsx:266`, `express-operators.test.js:55`) and GJS929 ↔ `G7929` (`tests/reg-overlay.test.js:29`).

`ua_flight_number`:

- Declared on upstream segments at `api/check-flight.ts:29`.
- Appears in one fixture, `tests/check-flight.test.js:283-284`, where it equals `flight_number` ('UA5779').
- **Nothing reads it.**
- `api/_starlink-normalize.ts:193` keeps only `flight_number` (and `airline`) per leg in `flightsByTail`, so no UA number survives into the Starlink tab.

The repo holds **no sample of the Starlink feed's `flightsByTail`**. `src/data/starlink-live.json` has only `source`/`live`/`roster`, and `public/data/starlink.json` is the roster. The only callsign fixtures are `SKW5408` and `SKW1`. The brief's examples ("OO5750", "YX3508", G7…/RPA…/GJS…/ASH…, airline "UA") cannot be verified from the repo.

(Inferred) For a tail that is **airborne now**, the live FR24 feed carries both `flightIATA` (UA5123) and `callsign` (SKW5123). That is the source of "inbound on UA3508" (`starlink-utils.js:288-290`). For scheduled legs there is no in-repo source of the marketing number.

---

## Constraints that make linking awkward

- **A link cannot sit inside a button.** These surfaces are whole-button, so any link must be a sibling or the control must change:
  - Fleet variant cards (toggle filter)
  - Departures-board hub pills (filter)
  - The aircraft dialog's airborne/live blocks (one button → map)
  - Search palette rows (cmdk `role=option` in a listbox)
  - Ask chips (remove buttons)
  - JargonTerm type/tail in the aircraft dialog (tooltip button)
  - SpecialLiveryBadge (tooltip button)
  - The Starlink roster tail (disclosure button)

  DESIGN.md 2026-11-11 (row 397): "A number inside a control that does something else is split out of it (phone schedule row, Live search, Starlink board) or printed in body colour."
- **Whole-row targets.** On the departures board the aircraft button's `after:absolute inset-0` covers the whole row on a coarse pointer (`DeparturesBoard.tsx:65,73`). New links there need `relative z-10`, as `FlightLink` does with `linkClassName="z-10"` (:68).
- **Touch targets.** The rules come from DESIGN.md "A control may draw smaller than its target" (lines 266-274) and `FlightLink`'s `hit="box"|"inline"|"none"`:
  - 44 px unless `pointer-fine:md:`
  - Dense rows use an `after:` 44 px box
  - Width-only `h-*` under 44 px fails the guard (2026-11-11 row 401)
  - A compact list link a mouse uses is ≥24 px (row 411)

  The `after:` boxes are clipped inside sideways-scrolling strips (row 378, lines 270-271). The Fleet, Airborne, Express and roster tables are `overflow-auto` scroll regions. Edge clipping of `after:` boxes there is inferred, not measured.
- **Link colour means link.** `FlightLink.tsx:5-8`; DESIGN.md row 197 and 2026-11-11 row 397. The **d** items above break that:
  - FleetHealth Mainline / New(7d) chips
  - FleetComposition route callouts
  - DeliveryTimeline "Average" and its SVG counts
  - Fr24 "Fleet Match:"
  - The My Flights "Where's My Plane?" and "Check a Connection" headings

  Nine buttons are link-styled:

  - Eight reg buttons that open the aircraft dialog, not a URL: Fleet, Airborne, Special, Express, My Flights card, FR24, and FlightSheet ×2.
  - SlHero's "N disputed". JourneyChain deliberately keeps its own flight and "Your flight" out of link colour (:90, :98).
- **`?type=` takes the fleet-DB string** ("737 MAX 9", URL-encoded), not a `/fleet` slug and not an ICAO code. An unmatched value is ignored (`FleetView.tsx:333-344`, `resolveFleetDeepLinkFilter` fleet-view.js:345-350).
- **Chips link only where the destination shows the fact.** DESIGN.md 2026-11-10 (row 364). Brief chips are `<a>`, never a button (row 193).
- **Deep links are mostly mount-only.** `?aircraft=`, `?type=`, `?filter=`, `?view=`, `?flight=` and `?watch=` are read once at boot (`deep-links.ts:135-190`; Fleet latch `FleetView.tsx:320-346`). Only the hash is live (`hashchange`, `deep-links.ts:189-197`). An in-island `<a href="?aircraft=N1">` would reload the page unless it is intercepted the way `BriefChip` intercepts. `resolveDeepLink` would need to learn those params. The Ask store (top note) is the only existing cross-view setter for Fleet search/Starlink status and the Starlink board hub/roster tail, and it brings the AskChips row with it.
- **In-app actions available today** (`src/app/state/ui.tsx:35-64`):
  - `setTab`, `select`, `focusOn`, `setStarlinkFilter`, `openAircraft`, `openDelayExplain`, `openFr24`
  - Schedule hub: `setScheduleHub` lives in the deep-link deps (`Dashboard.tsx:117` → `useSchedule().setCurrent({hub})`). `useSchedule().goto({hub,dir,day,flight})` is used by SearchPalette :410. It is not on `useUi()`.
  - The Starlink roster's Fleet/Type/Operator/New filters and Express search are component state with no setter outside their view. Board hub and roster tail search are reachable only through the Ask store.

## Data gaps / scope

- **Starlink flight numbers:** the live `flightsByTail` flight-number formats (prefixes, an `airline` field) are not in the repo; see Q2.
- **Unseen type strings:** the formats of FR24-lookup `aircraft.type`, flight-times `td.aircraft`, ledger `claim.aircraft` and aircraft-history `flightNumber` are not in the repo. Whether they map to `/fleet` or link via `flightLink` is unverified.
- **Roster snapshot:** the counts in Q1 come from the static fallback roster (`public/data/starlink.json`), not the live `/api/starlink-data`.
- **Not inventoried:**
  - `src/app/views/fleet/SortableHeader.tsx`. Read: it is a `<th>` holding one sort `<button>` (:34-45), with no entities.
  - The hooks/helpers `src/app/views/myflight/useAircraftJourney.ts`, `useFlightTimes.ts` and `tone.ts` (they render nothing).
  - Features not in the brief: CoverADay, Onboarding, LegalPopover (it has a `/fleet` link at :98), DisclaimerDialog, WaitlistDialog/Strip, SupportStrip/Meter, BmacToast, EmailPrompt, BriefTone, JargonTerm (read only for its trigger).
