# Content pages: link inventory (The Blue Board v1.28.1, worktree `bb-nov11/r128`)

Read-only audit of every content page outside the dashboard island. All paths are relative to
`/Users/jonahberg-ganzarain/bb-nov11/r128`. Line numbers are from origin/main at v1.28.1.

**Today codes** (the first letter of every Today cell):
- **a**: a real `<a>`, with its href pattern. "a (card)" means the text sits inside a card made clickable by a stretched link (`after:absolute after:inset-0`), so a click on it follows that link.
- **b**: a button (or `role="button"`), and what it does.
- **c**: plain text.
- **d**: plain text painted in link colour (`text-primary`) or underlined, but not a link. **These rows are flagged LINK-COLOUR.**
- **missing**: a link that the page does not render at all: a cross-link with no element, or a link lost at render.

**Row counts** (one row = one kind of printed thing in one table or list, counted by script from the first letter of each Today cell):

| Status | Rows |
|---|---|
| a | 66 |
| b | 8 |
| c | 135 |
| d (names an entity or a figure) | 7 |
| missing | 9 |

Five rows are pointers or notes with no status (for example "see section 7"). Link-coloured labels and headings (about 17 instances) are listed once in section 18, not counted here. Mixed rows are counted by their first state: the hub-board flight number is "a" but stays "c" when `flightLink()` says no. A row is a kind of thing, not an instance: the one registry "Reg" row stands for about 1,154 tails across 19 pages.

**Fits destination** uses only destinations that exist today. Where the right target exists in code but is not on the caller's list, it is marked "exists in code" with a file:line. Anything I did not verify by reading the code is marked **inferred**.

Destinations found in code beyond the caller's list:
- `/trackers/atc#row-<id>`, all 89 airports (`src/pages/trackers/atc.astro:60`, `:153`; row ids from `src/components/trackers/TrackerTable.astro:104`).
- `/trackers/united-hubs#<project-id>` and `#hub-<code>` (`src/pages/trackers/united-hubs.astro:82`, `:187`, `:390`, `:423`).
- `/trackers/united-hubs/<code>#<project-id>` (`src/pages/trackers/united-hubs/[code].astro:170`, `:192`).
- `/?tab=weather&section=nas`, the NAS panel (`src/lib/tab-hash.js:63`).
- `/?tab=fleet&filter=starlink` (hub data, e.g. `src/data/hubs/ord.js:75`).
- `/?flight=<ident or reg>`, live map plus flight panel (`src/lib/fleet-live.js:83`).
- Hub-page anchors: `/hubs/<code>#overview`, `#delay-patterns`, `#starlink`, `#faq` (`src/data/hubs/ord.js:49-74`).

---

## 0. Cross-cutting findings

### One-way cross-links (what links one way but not back)

| From → to | Today | Evidence |
|---|---|---|
| Hub page → its tracker entries | YES: `/trackers/united-hubs/<code>` and `/trackers/atc/<code>` | `src/layouts/HubLayout.astro:146`, `:150` |
| Tracker pages (index, table, map, 15 detail pages) → `/hubs/<code>` | **NONE.** No `/hubs` href anywhere under `src/pages/trackers`, `src/components/trackers`, `src/lib/tracker-*.js` (grep). The ATC table's "United hub →" goes to the *tracker* page, not the hub page | `src/pages/trackers/atc.astro:144` |
| Fleet type page → hubs that base it | PARTIAL: 14 of 19 types link a hub inside `contentHtml`. **No hub link** on 737-800, 737-900ER, 737-700, 737-900 or 757-300 | `src/data/fleet/737-800.js:123`, `737-900er.js:123`, `737-700.js:118`, `737-900.js:119`, `757-300.js:118` |
| Hub page → fleet types flown there | **NONE. No hub page has a fleet table**, and hub data has no type field (read). Hub prose names "Boeing 737-800", "A321neo", "777", "787", "737 MAX 8", "Embraer 175s" as plain text. No `/fleet/` href in `src/data/hubs/*` | e.g. `src/data/hubs/ord.js:75` (Starlink section), `src/data/hubs/nrt.js:47`, `src/data/hubs/gum.js:43` |
| News article → hub / fleet | YES, through `tags` → "Related on The Blue Board". **5 of 25 articles have `tags: []`**, including `faa-certifies-boeing-737-max-10-united` | `src/layouts/NewsLayout.astro:19`, `:141-150`; `src/data/news/index.js:86-106` |
| News → tracker entries | **NONE.** `resolveTag` knows hub and fleet slugs only | `src/data/news/index.js:86-106` |
| Hub / fleet / tracker / Newark pages → `/news` | **NONE.** Only the header nav and 404 link `/news`. Trackers link only external news sites | grep `/news` in `src/pages`, `src/layouts`, `src/data/{hubs,fleet,trackers}` |
| Newark → EWR tracker entries | **NONE.** `/newark` links `/hubs/ewr` and the schedule but not `/trackers/united-hubs/ewr` or `/trackers/atc/ewr` | `src/pages/newark.astro:241-244`, `:260-273` |
| Flight page → hub / fleet / aircraft | **NONE.** Origin/destination codes, aircraft type and tail are all plain text | Section 9 |
| Static content → `/flight/<ident>` | **NONE.** No static `/flight/` href exists in `src/data`, `src/pages` or `src/layouts`. Flight numbers in prose stay plain: UA2940, UA14, UA328, UA154/UA155, and in news UA14, UA939, UA1 | Sections 3, 6, 16 |
| GUM / NRT pages → live map `/?hub=` | **LOST at render.** The `/?hub=gum` link sits inside the compact page's LIVE bar, and `splitCompactLiveBar` drops the whole bar (it keeps only `live-meta`). Built `dist/hubs/gum.html` and `dist/hubs/nrt.html` (Nov 11 16:11) have no `/?hub=` href. A regression | `src/data/hubs/gum.js:43`; `src/lib/hub-content.js:70-83`; `src/layouts/HubLayout.astro:123-128` |

### Data gaps (what a link would need that the data lacks)

1. **No aircraft-type → `/fleet/<slug>` function exists in `src/lib`.**
   - Grep found no `/fleet/${…}` builder. `resolveTag` maps slug → label (`src/data/news/index.js:96-102`), the reverse direction.
   - `fleetTypes[slug].typeCode` equals the `t` field in `public/data/fleet.json` for all 19 types (checked by script), so a build-time inversion of `fleetTypes` is enough for any registry or tail-derived type. The flight page's `aircraft.type` is that `t` for mainline tails (`src/lib/flight-page-data.js:248`).
   - Display names ("Boeing 737 MAX 9") are `fleetTypes[slug].displayName`; `aircraftTypeName()` rebuilds a similar string (`src/lib/flight-page-view.js:53-59`).
   - **ICAO codes are ambiguous.** B739 covers 737-900 and 737-900ER; B772 covers 777-200 and 777-200ER (`src/lib/fleet-live.js:8-11`; `src/lib/aircraft-type.js:18-27`). A schedule-feed model code needs the tail to choose the page.
   - United Express types (E175, CRJ…) have no fleet page.
2. **Hub "Key Routes" lists are free text inside `contentHtml`** (`<li><strong>Domestic:</strong> SFO, LAX, …`). Codes are not marked up.
   - Linking them needs either a render-time transform or edits to the data. There is a precedent for render-time rewrites: `demoteHubCtaRow` in `src/lib/hub-content.js:37-45`.
   - Non-hub airports (LHR, CUN, KIX, MAJ…) have no destination: there are no airport pages, and no route or airport deep link is among `DEEP_LINK_PARAMS` (`src/app/state/deep-links.ts:94`).
3. **These strings are rendered escaped and cannot carry links without a data-model change:**
   - FAQ answers: `{faq.answer}` (`src/layouts/FleetTypeLayout.astro:242`, `src/pages/newark.astro:253`); tracker FAQs (`atc.astro:472`, `united-hubs.astro:594`).
   - Tracker project `details` (`united-hubs.astro:440`).
   - Changelog `entry` (`src/components/trackers/Changelog.astro:27`).
   - **Changelog entries have no entity id or code field** (`{date, entry}` only), so "Denver (DEN) makes the switch" cannot reach `#row-den` without parsing.
4. **`StatTile` and `StatStrip` have no `href` prop** (`src/components/site/StatTile.astro:17-25`; `src/components/trackers/StatStrip.astro:10-12`). Every summary tile on the site is plain text.
5. **The hub board drops data it already has.** `/api/hub-board` rows keep `aircraft.registration` and `aircraft.model` (`src/lib/hub-board.js:96-99`), but the view model prints neither (`src/lib/hub-board-view.js:185-204`). A tail link or type link on the hub board needs no new fetch.
6. **There is no family-level destination.** Family sections on `/fleet` have no `id` (`src/pages/fleet/index.astro:359`). Whether the dashboard Fleet tab accepts a family in `?type=` or `?filter=` is **inferred/unknown** (resolved inside `src/app`).
7. **Express tails.** `/?aircraft=<reg>` opens the aircraft dialog for any reg (`src/app/state/deep-links.ts:168-169`). Whether the dialog has content for a United Express tail is **inferred** (dashboard code).
8. **News bodies contain no lists or tables at all** (0 `<ul>`, 0 `<ol>`, 0 `<table>` across 25 articles, by script). Entity mentions are prose only, and the only internal links are 6 links to other `/news/*` pages.

### DESIGN.md rules that constrain this

- **`DESIGN.md:197` and `:397` (Flight number row, 2026-11-11 decision).**
  - Every flight number *printed in link colour* is an `<a>` to `/flight/<ident>`, same tab, decided by `flightLink()`: a United prefix is required, and operating callsigns and bare numbers stay body text.
  - A number inside a control that does something else is split out of it.
  - Prose flight numbers in body colour are not required to link.
- **`DESIGN.md:364` (2026-11-10).** Brief chips link only where the destination *shows the fact*; otherwise plain text. This is the closest written rule to "link only to a place that shows the thing".
- **`DESIGN.md:393` (2026-11-11).**
  - In-page jumps are `rounded-full` uppercase pills; links to other pages are `rounded-md` bordered pills.
  - News, hub and fleet cards are clickable whole through a stretched primary link.
  - Amber is status only.
- **`DESIGN.md:394` (2026-11-11).** Content links are 44 px on touch, relaxed only by `pointer-fine:md:`. This is costly for dense tables: the 188-row registry or the 89-row ATC table. The existing pattern is `touchRowLink` with negative margin (`src/pages/fleet/index.astro:229-230`).
  - The counterweight is `DESIGN.md:365` and `:378`. Chip links in a dense strip are 24-28 px (WCAG 2.5.8's 24 px floor): the brief chips at 28 px, the hub strip at 27 px.
- **`DESIGN.md:359` (2026-11-10).** Hub pages show a board slice with "one button into the board". Per-row links to other places should not compete with that button.
- **`DESIGN.md:27-29`.** "Colour that is not a status signal is decoration, and this product does not decorate." This argues that each (d) row below either becomes a link or drops `text-primary`.
- **Two link treatments exist today.**
  - Prose links in `.bb-content` are foreground and underlined (`src/styles/content.css:75-77`). So are the breadcrumb, footer and news "Read" links.
  - Table, tracker and flight-number links are `text-primary` (`TrackerTable.astro:157`, `HubBoard.astro:100`, tracker prose `atc.astro:252`).
  - A design should pick one per context.

---

## 1. Site chrome (every content page)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Primary nav: Dashboard, Hubs, Fleet, News, Trackers | section | a: `/`, `/hubs`, `/fleet`, `/news`, `/trackers` | src/components/site/SiteHeader.astro:67-76 | — | Mobile `<details>` copy at :120-131 |
| Footer links | section | a: `/`, `/privacy`, `/` | src/components/site/SiteFooter.astro:24-30 | — | Data credits are external |
| Breadcrumb ancestors | section | a: crumb.href | src/components/site/Breadcrumbs.astro:42-48 | — | The last crumb is a `<span aria-current>` (:50) |
| JumpNav pills | in-page section | a: `#anchor` | src/components/site/JumpNav.astro:36-40 | — | |
| PillNav (all hubs / all fleet types) | hub code + city / type + count | a: `/hubs/<h>` or `/fleet/<t>` | src/components/site/PillNav.astro:22-30 | — | Labels from `hubNavLabels` / `fleetNavLabels` ("MAX 9 (188)") |

## 2. `/fleet` (src/pages/fleet/index.astro)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "Explore Interactive Fleet Database" CTA | section | a: `/?tab=fleet` | src/pages/fleet/index.astro:261-263 | — | |
| Stat tile "Mainline Aircraft" | count | c | src/pages/fleet/index.astro:273 | `/?tab=fleet` (or `/#fleet`) | StatTile has no href prop |
| Stat tile "Polaris Aircraft" | count | c | src/pages/fleet/index.astro:274 | none known (a Fleet filter for Polaris is **inferred/unknown**) | |
| Stat tile "Mainline with Starlink" | count | c | src/pages/fleet/index.astro:275 | `/?tab=fleet&filter=starlink` (exists in hub data) or `/?view=starlink` | |
| Stat tile "Widebody Aircraft" | count | c | src/pages/fleet/index.astro:276 | none known (**inferred**) | |
| Family table: family name ("Boeing 737") | aircraft family | d: LINK-COLOUR. `<td class="font-semibold text-primary">` | src/pages/fleet/index.astro:295 | none exists (family sections below have no id, :359; dashboard family filter **inferred**) | Either link it or drop `text-primary` (DESIGN.md:27-29) |
| Family table: type labels ("-800", "MAX 9") | aircraft type | a: `/fleet/<slug>` | src/pages/fleet/index.astro:301 | — | Hand-maintained `FAMILY_ROWS` (:99-119) |
| Family table: aircraft total | count | c | src/pages/fleet/index.astro:305 | none known | Hand-typed totals (:100-117) |
| Family table: role | other | c | src/pages/fleet/index.astro:306 | none | |
| What's New list: linked types (787-9, 757-200, 737-800, 777-200ER as "Boeing 777", A321neo, 737 MAX 9) | aircraft type | a: `/fleet/<slug>` | src/pages/fleet/index.astro:318-320, 328-330, 334, 335-337, 343, 348 | — | |
| What's New: "SFO to Singapore and London… Zurich and Seoul… Houston" | route / city | c | src/pages/fleet/index.astro:321-323 | `/hubs/sfo`, `/hubs/iah` (hub ends only) | Prose inside `<li>` |
| What's New: "Washington Dulles to Dublin and Amsterdam" | route / city | c | src/pages/fleet/index.astro:330 | `/hubs/iad` | |
| What's New: "737 MAX jets", "Boeing 737 MAX 10" / "737-10" | aircraft type | c | src/pages/fleet/index.astro:343, 346 | `/fleet/737-max-8` or `/fleet/737-max-9` (no MAX 10 page) | |
| What's New: "United Express regional jets" | operator | c | src/pages/fleet/index.astro:334 | `/?tab=fleet&view=express` | Exists (src/app/state/deep-links.ts:57, :74) |
| Family section count (e.g. "640") | count | d: LINK-COLOUR. `<span class="… text-primary">` | src/pages/fleet/index.astro:361-363 | none known | Not inside a link |
| Family section heading and role | family | c | src/pages/fleet/index.astro:364-367 | none | |
| Type card: count, display name, body chip, seats, role | type + count | a (card): stretched link `/fleet/<slug>` | src/pages/fleet/index.astro:373-396 (count `text-primary` :374) | — | Whole card is the link (DESIGN.md:393) |
| Seat-config table: type code | aircraft type | a: `/fleet/<slug>` | src/pages/fleet/index.astro:425 | — | Uses `touchRowLink` 44 px |
| Seat-config table: count | count | c | src/pages/fleet/index.astro:426 | `/?tab=fleet&type=<typeCode>` | That URL form is already used at src/layouts/FleetTypeLayout.astro:151 |
| Seat-config table: cabin tags | other | c | src/pages/fleet/index.astro:428-433 | none | |
| Seat-config table: total seats | count | c | src/pages/fleet/index.astro:435 | none | |
| FAQ: "Embraer E175, Bombardier CRJ550 … SkyWest and Republic" | type / operator | c | src/pages/fleet/index.astro:452-454 | `/?tab=fleet&view=express` | |
| FAQ: Polaris type list | aircraft type | a: `/fleet/<slug>` ×7 | src/pages/fleet/index.astro:460-465 | — | |
| FAQ: "interactive fleet database" | section | a: `/?tab=fleet` | src/pages/fleet/index.astro:466 | — | |
| FAQ: "Starlink Tracker" | section | a: `/?tab=fleet`. **The words and the target disagree** | src/pages/fleet/index.astro:472-474 | `/?view=starlink` or `/#starlink` | Weak target |
| FAQ: 777-300ER, Newark (EWR), San Francisco (SFO) | type / hub | a: `/fleet/777-300er`, `/hubs/ewr`, `/hubs/sfo` | src/pages/fleet/index.astro:479-484 | — | |
| FAQ: "Boeing 757" | aircraft type | c | src/pages/fleet/index.astro:492 | `/fleet/757-200` | |
| FAQ: A321XLR / A321neo / MAX 9 / 787-9 | aircraft type | a: `/fleet/<slug>` | src/pages/fleet/index.astro:489-497 | — | |
| Hubs nav | hub code + city | a: `/hubs/<slug>` | src/pages/fleet/index.astro:508-510 | — | |

## 3. `/fleet/<type>` (src/layouts/FleetTypeLayout.astro + src/data/fleet/*.js)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Stat tile "Aircraft" | count | c | src/layouts/FleetTypeLayout.astro:140 | `/?tab=fleet&type=<typeCode>` | Exists; the page's CTA uses it |
| Stat tiles Total Seats / Deliveries / Body Type | other | c | src/layouts/FleetTypeLayout.astro:141-143 | none | |
| CTA "Explore … in Interactive Database" | aircraft type | a: `/?tab=fleet&type=<typeCode>` | src/layouts/FleetTypeLayout.astro:149-154 | — | |
| contentHtml config-table rows (cabin, seats, layout, pitch) | other | c | e.g. src/data/fleet/737-max-9.js:123 | none | All 19 types |
| contentHtml "Routes & Hubs" `<ul>`: hub names | hub | a: `/hubs/<code>` | src/data/fleet/737-max-9.js:123; 777-200er.js:128; 777-300er.js:123; 787-9-dreamliner.js:127; 757-200.js:118; 767-300er.js:123; 767-400er.js:123 | — | Only these 7 types have a routes `<ul>`; the rest use prose |
| Routes list text after the dash ("Hong Kong and Sydney", "SFO–Singapore …") | route / city | c | src/data/fleet/777-300er.js:123; 787-9-dreamliner.js:127 | none (non-hub ends) | |
| 757-200 "Hawaii routes from West Coast hubs" | route | c | src/data/fleet/757-200.js:118 | `/hubs/lax`, `/hubs/sfo` (**inferred** wording) | |
| 787-9 / 787-10 / 757-200 body prose hub codes ("SFO", "ORD", "LAX") | hub | c | src/data/fleet/787-9-dreamliner.js:127; 787-10-dreamliner.js:119; 757-200.js:118 | `/hubs/<code>` | Same codes are linked elsewhere in the same string |
| "Related Aircraft" sibling types | aircraft type | a: `/fleet/<slug>` | e.g. src/data/fleet/737-max-9.js:123 | — | |
| Flight numbers in body (UA14, UA328, UA2940) | flight number | c | src/data/fleet/777-200er.js:128; 777-300er.js:123 (UA14); 777-200.js:118 (UA328); 737-800.js:123 (UA2940) | `/flight/UA14`, etc. | Body colour, so DESIGN.md:397 does not require a link |
| Tails in body (N64321, N64324, N777UA) | tail | c | src/data/fleet/a321neo.js:127; 777-200.js:118 | `/?aircraft=<reg>` | |
| FleetLive strip | — | see section 4 | src/layouts/FleetTypeLayout.astro:146 | — | |
| Specs table (manufacturer, model, engines…) | other | c | src/layouts/FleetTypeLayout.astro:175-182 | none | |
| **Registry: Reg** | tail | c | src/layouts/FleetTypeLayout.astro:218 | `/?aircraft=<reg>` | ~1,154 rows across 19 pages. The data is present (`ac.r`) |
| Registry: AC# | fleet number | c | src/layouts/FleetTypeLayout.astro:219 | none | |
| Registry: Config | other | c | src/layouts/FleetTypeLayout.astro:220 | none | |
| Registry: WiFi ("Starlink" in violet `.starlink-on`) | other (Starlink fact) | c (violet `bb-starlink`, not link colour) | src/layouts/FleetTypeLayout.astro:223 | `/?view=starlink` (**inferred** fit) | |
| Registry: IFE / Power / Year | other | c | src/layouts/FleetTypeLayout.astro:224-226 | none | |
| Registry: Status (stored, maint…) | status | c (status-toned) | src/layouts/FleetTypeLayout.astro:227 | none | |
| FAQ answers: hub codes (EWR, IAH, DEN, ORD, SFO, LAX, IAD, GUM) | hub | c | src/layouts/FleetTypeLayout.astro:242 (data e.g. src/data/fleet/737-max-9.js:84) | `/hubs/<code>` | Escaped plain string, so links need a data-model change |
| FAQ answers: flight numbers (UA2940, UA328) | flight number | c | src/layouts/FleetTypeLayout.astro:242 (data src/data/fleet/737-800.js:76; 777-200.js:75) | `/flight/<ident>` | |
| FAQ answers: tail N777UA | tail | c | src/layouts/FleetTypeLayout.astro:242 (data src/data/fleet/777-200.js:79) | `/?aircraft=N777UA` | |
| All Types pills | type + count | a: `/fleet/<t>` | src/layouts/FleetTypeLayout.astro:256 (items :99-103) | — | |
| "Back to Fleet Overview" | section | a: `/fleet` | src/layouts/FleetTypeLayout.astro:257 | — | |
| (missing) hubs that base this type | hub | missing on 5 types | Section 0 | `/hubs/<code>` | |
| (missing) news tagged with this type | news | missing | — | `/news/<slug>` | Invert `tags` at build. No function exists |

## 4. FleetLive strip (src/components/site/FleetLive.astro, src/scripts/fleet-live.ts, src/lib/fleet-live.js)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Count "N of total airborne" | count | c | src/components/site/FleetLive.astro:56-57; src/scripts/fleet-live.ts:47-48 | `/?tab=fleet&type=<typeCode>&view=airborne` (**inferred**: whether type and airborne combine) | |
| Row flight number | flight number | a: `/flight/UA857` via `setFlightLink`; c when `flightLink()` says no (no href) | src/components/site/FleetLive.astro:75-78; src/scripts/fleet-live.ts:57-58 | — | Matches DESIGN.md:397 |
| Row origin → dest | airport codes (hub or any) / route | a: part of one stretched link to `/?flight=<ident or reg>` (live map) | src/components/site/FleetLive.astro:79-85; src/scripts/fleet-live.ts:59-73; src/lib/fleet-live.js:83 | `/hubs/<code>` for hub ends | Endpoints are not separately linkable today |
| Row tail | tail | a: same `/?flight=` link | src/components/site/FleetLive.astro:84; src/scripts/fleet-live.ts:74-75 | `/?aircraft=<reg>` | Today it opens the map, not the aircraft dialog |
| Stamp "Live feed · time" | other | c | src/components/site/FleetLive.astro:38-42; src/scripts/fleet-live.ts:86-92 | none | |

## 5. `/hubs` (src/pages/hubs/index.astro)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "Open The Blue Board Dashboard" CTA | section | a: `/` | src/pages/hubs/index.astro:117-120 | — | |
| Hub card: IATA (`text-primary`), airport name, subtitle | hub | a (card): stretched link `/hubs/<key>` | src/pages/hubs/index.astro:135-158 (IATA :136) | — | |
| EWR card "FAA cap explained" | other | a: `/newark` | src/pages/hubs/index.astro:145-152 | — | |
| Hub Network list: hub names | hub | a: `/hubs/<code>` | src/pages/hubs/index.astro:182-200 | — | |
| Hub Network list: "Tokyo Haneda" | airport (non-hub) | c | src/pages/hubs/index.astro:197 | none | |
| "What we track" list: Live flight counts | dashboard feature | c | src/pages/hubs/index.astro:207-210 | `/#live` | |
| "What we track": Delay monitoring | dashboard feature | c | src/pages/hubs/index.astro:211-214 | `/?tab=irops` | |
| "What we track": Ground stops & FAA alerts | dashboard feature | c | src/pages/hubs/index.astro:215 | `/?tab=weather&section=nas` (exists in code) | |
| "What we track": Departure & arrival schedules | dashboard feature | c | src/pages/hubs/index.astro:216-219 | `/#schedule` | |
| "What we track": Starlink WiFi fleet | dashboard feature | c | src/pages/hubs/index.astro:220-223 | `/#starlink` or `/?tab=fleet&filter=starlink` | |
| "What we track": Weather conditions | dashboard feature | c | src/pages/hubs/index.astro:224 | `/#weather` | |
| "What we track": Seasonal delay patterns | content | c | src/pages/hubs/index.astro:225-228 | `/hubs/<code>#delay-patterns` | |
| FAQ 1 and 2: hub codes and cities (ORD, DEN, IAH, EWR, SFO, IAD, LAX, GUM, NRT) | hub | c | src/pages/hubs/index.astro:235-238, 243-246 | `/hubs/<code>` | FAQ 4 links the same names (:260-263) |
| FAQ 3: "theblueboard.co" | section | a: `/` | src/pages/hubs/index.astro:252 | — | |
| FAQ 4: "Tokyo Haneda (HND)" | airport (non-hub) | c | src/pages/hubs/index.astro:264 | none | |

## 6. `/hubs/<hub>` (src/layouts/HubLayout.astro + src/data/hubs/*.js)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| HubBoard | — | see section 7 | src/layouts/HubLayout.astro:111, 128 | — | |
| Dive Deep "More on the dashboard": Live ORD Map / Schedules / Starlink Fleet / IROPS Monitor | dashboard views | a: `/?hub=ord`, `/?tab=schedule&hub=ord`, `/?tab=fleet&filter=starlink`, `/?tab=irops&hub=ord` | src/lib/hub-content.js:37-45 (data src/data/hubs/ord.js:75) | — | 7 full hubs. Not on NRT/GUM |
| **Key Routes list: hub codes** ("SFO, LAX, DEN, EWR, IAD, IAH"; "NRT"; "GUM") | hub | c | src/data/hubs/ord.js:75, den.js:75, iah.js:75, ewr.js:79, sfo.js:75, iad.js:75, lax.js:75, nrt.js:47, gum.js:43 | `/hubs/<code>` | Free text in contentHtml (data gap 2). 9 pages, 6-8 codes each |
| Key Routes list: non-hub airports (LHR, CUN, KIX, MAJ…) | airport (any) | c | same lines | none exists | |
| Key Routes list: region labels ("Domestic:") | other | c | same lines | none | |
| NRT "Terminal & Lounges" list | other | c | src/data/hubs/nrt.js:47 | none | |
| GUM Island Hopper list "HNL → MAJ → … → GUM" | route | c | src/data/hubs/gum.js:43 | none (route) | |
| GUM flight numbers UA154 / UA155 | flight number | c | src/data/hubs/gum.js:43 (also FAQ :21) | `/flight/UA154`, `/flight/UA155` | Body colour |
| EWR flight number UA2940 | flight number | c | src/data/hubs/ewr.js:79 | `/flight/UA2940` | |
| Starlink section: "Boeing 737-800 … EWR→IAH", "A321neo", "777", "Embraer 175s" | aircraft type / route | c | src/data/hubs/ord.js:75 (and the other 6 full hubs) | `/fleet/737-800`, `/fleet/a321neo`, `/fleet/777-200er` (**inferred** pick); route: hub ends only | Hub → fleet: zero links today |
| Starlink section "The Blue Board's Fleet tab" | dashboard view | a: `/?tab=fleet&filter=starlink` | src/data/hubs/ord.js:75 | — | |
| Delay Patterns prose: "Newark (EWR) and JFK" | hub / airport | c | src/data/hubs/ord.js:75 | `/hubs/ewr` | |
| Visible FAQ: other hubs named ("ahead of Denver (DEN) and Houston (IAH)") | hub | c | src/data/hubs/ord.js:75 (FAQ section of the string) | `/hubs/<code>` | Same pattern in the other hub strings |
| FAQ "open ORD on The Blue Board" | dashboard view | a: `/?hub=ord` | src/data/hubs/ord.js:75 | — | |
| NRT / GUM FAQ links | dashboard views | a: `/?tab=weather`, `/?tab=fleet&filter=starlink` | src/data/hubs/nrt.js:47; gum.js:43 | `/?tab=weather&hub=NRT` or `&hub=GUM` would land on the card (exists: tab-hash.js:49, :61) | |
| GUM / NRT live-bar link "Open GUM on The Blue Board" (`/?hub=gum`) | dashboard view | missing: link removed at render (in the data, not on the page) | src/data/hubs/gum.js:43; src/lib/hub-content.js:70-83 | `/?hub=gum`, `/?hub=nrt` | Regression. Confirmed in built `dist/hubs/gum.html` and `dist/hubs/nrt.html`: neither has a `/?hub=` href |
| Tracker cross-link: "ORD projects", "ORD paper strips status" | tracker entry | a: `/trackers/united-hubs/<code>`, `/trackers/atc/<code>` | src/layouts/HubLayout.astro:146, 150 | — | 8 and 7 hubs. None on NRT |
| All United Hubs pills | hub | a: `/hubs/<h>` | src/layouts/HubLayout.astro:166 | — | |
| (missing) news tagged with this hub | news | missing | — | `/news/<slug>` | 20 of 25 articles carry hub or fleet tags |
| (missing) fleet types at this hub | type | missing | — | `/fleet/<slug>` | **No hub page has a fleet table** (read: no `<table>` in any hub `contentHtml`). No hub → type field exists: the fields are iata, variant, title, description, keywords, og*, twitter*, breadcrumbName, faqSchema, airportSchema, headerTitle, subtitle, jumpNav, contentHtml |

## 7. Hub departures board (src/components/site/HubBoard.astro, src/scripts/hub-board.ts, src/lib/hub-board-view.js)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Stamp "Data as of …" | other | c | src/components/site/HubBoard.astro:45-49; src/scripts/hub-board.ts:68-80 | none | |
| Day truth line: scheduled / departed / presumed / on-time % / canceled | count | c | src/components/site/HubBoard.astro:56; src/scripts/hub-board.ts:82-113 | `/?tab=schedule&hub=<hub>` | DESIGN.md:359: one button into the board |
| Row time / changed time | time | c | src/components/site/HubBoard.astro:96-97; src/scripts/hub-board.ts:120-131 | none | |
| Row flight number | flight number | a: `/flight/UAxxx` via `setFlightLink`; c (no href) when `flightLink()` says no | src/components/site/HubBoard.astro:99-102; src/scripts/hub-board.ts:135 | — | Compliant with DESIGN.md:197 |
| **Row destination code** | airport code (hub or any) | c | src/components/site/HubBoard.astro:103-105; src/scripts/hub-board.ts:136-137 | `/hubs/<code>` when it is one of the 9 hubs; none otherwise | ~8 rows × 9 hub pages |
| Row destination city | city | c | src/components/site/HubBoard.astro:106-109; src/scripts/hub-board.ts:138-139 | as above | |
| Row gate | other | c | src/components/site/HubBoard.astro:110-113; src/scripts/hub-board.ts:140-144 | none | |
| Row status pill, LIVE tag, delay | status | c | src/components/site/HubBoard.astro:114-123; src/scripts/hub-board.ts:146-174 | none | |
| (not printed) tail and aircraft model | tail / type | missing: not rendered (in payload) | src/lib/hub-board.js:96-99; src/lib/hub-board-view.js:185-204 | `/?aircraft=<reg>`, `/fleet/<slug>` | Data gap 5 |
| "Open the full ORD board" | dashboard view | a: `/?tab=schedule&hub=<hub>` | src/components/site/HubBoard.astro:77-83 | — | |

## 8. `/newark` (src/pages/newark.astro, src/scripts/newark-live.ts)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Stat tile "Active United Flights (EWR)" | count | c | src/pages/newark.astro:156; src/scripts/newark-live.ts:79-80 | `/?hub=ewr` | |
| FAA program line ("Ground Delay Program — …") | status / program | c | src/pages/newark.astro:157-162; src/scripts/newark-live.ts:90-121 | `/?tab=weather&section=nas` (exists in code) or `/?tab=weather&hub=EWR` | |
| CTAs "Open EWR", "View EWR Schedule" | dashboard views | a: `/?hub=ewr`, `/?tab=schedule&hub=ewr` | src/pages/newark.astro:165-166 | — | |
| Timeline: date, event label, detail (runway 4L-22R, Philadelphia TRACON, FAA order 2026-12589) | other entity | c | src/pages/newark.astro:186-208 (data :44-87) | none internal (TRACON is not a tracker entry; the ATC tracker covers towers) | |
| "Your flight" list items ("check the live board…") | dashboard view | c | src/pages/newark.astro:218-239 (live board :236-237) | `/?tab=schedule&hub=ewr` | |
| Paragraph links: EWR Schedule, EWR Hub Guide | views | a: `/?tab=schedule&hub=ewr`, `/hubs/ewr` | src/pages/newark.astro:241-244 | — | |
| FAQ answers | prose | c | src/pages/newark.astro:250-255 (data :9-40) | — | Escaped strings |
| More list: EWR Hub Guide, Live EWR Schedule, All United Hubs | views | a: `/hubs/ewr`, `/?tab=schedule&hub=ewr`, `/hubs` | src/pages/newark.astro:261-272 | — | |
| More list: "ORD, DEN, IAH, EWR, SFO, IAD, LAX, NRT, and GUM" | hub | c | src/pages/newark.astro:270-271 | `/hubs/<code>` | |
| (missing) EWR tracker entries | tracker entry | missing | — | `/trackers/united-hubs/ewr`, `/trackers/atc/ewr` | EWR is "planned" in ATC |

## 9. `/flight` and `/flight/<ident>` (src/pages/flight/index.astro, Flight* components, src/scripts/flight-page.ts, src/lib/flight-page*.js)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| h1 ident | flight number (this page) | c | src/pages/flight/index.astro:48; src/scripts/flight-page.ts:366 | none (it is this page) | |
| Route line "Chicago O'Hare to London Heathrow · Tue, Nov 10" | city / route | c | src/pages/flight/index.astro:49; src/scripts/flight-page.ts:367; src/lib/flight-page-view.js:62-71 | `/hubs/<code>` for hub ends | |
| "Watch this flight" | action | a: `/?watch=UA929…` | src/pages/flight/index.astro:52-59; src/scripts/flight-page.ts:322-328 | — | |
| Share | action | b: Web Share or copy link | src/pages/flight/index.astro:60-67; src/scripts/flight-page.ts:431-452 | — | |
| Verdict sentence | status | c | src/pages/flight/index.astro:72-77; src/scripts/flight-page.ts:113-118 | none | |
| Lookup example "UA929" (and "5103") | flight number | c (mono, body colour) | src/pages/flight/index.astro:106 | `/flight/UA929` | Bare "5103" stays text by rule |
| **Trip: origin code** | airport (hub or any) | c | src/components/site/FlightTrip.astro:28; src/scripts/flight-page.ts:159 | `/hubs/<code>` when a hub (every flight page has at least one hub end: src/lib/flight-page-data.js:35-39) | |
| Trip: origin city, time | city / time | c | src/components/site/FlightTrip.astro:29-30; src/scripts/flight-page.ts:160-161 | as above | |
| **Trip: destination code** | airport (hub or any) | c | src/components/site/FlightTrip.astro:51; src/scripts/flight-page.ts:162 | `/hubs/<code>` when a hub | |
| Trip: destination city, time | city / time | c | src/components/site/FlightTrip.astro:52-53; src/scripts/flight-page.ts:163-164 | as above | |
| Track note "… mi to go · live position" | other | c | src/components/site/FlightTrip.astro:56; src/scripts/flight-page.ts:176 | `/?flight=<ident>` (live map) | |
| Timeline step: inbound flight number "(UA5442)" | flight number | a: `/flight/UA5442` (text-primary) | src/scripts/flight-page.ts:197-203; src/lib/flight-page-view.js:159-165 | — | Its own page's number stays text (:199) |
| Timeline step: inbound city ("Tulsa") | city | c | src/lib/flight-page-view.js:160-164 | `/hubs/<code>` only if a hub | |
| Timeline step: gate / terminal / times | other | c | src/components/site/FlightTrip.astro:60-65; src/lib/flight-page-view.js:167-207 | none | |
| History card route label "ORD → LHR" | route | c | src/components/site/FlightHistoryCard.astro:15; src/scripts/flight-page.ts:222 | hub ends: `/hubs/<code>` | |
| History day squares | other (per-day outcome) | c (li with title) | src/components/site/FlightHistoryCard.astro:25-30; src/scripts/flight-page.ts:226-237 | none | |
| History key, count, typical, note | count | c | src/components/site/FlightHistoryCard.astro:20-23; src/scripts/flight-page.ts:240-252 | none | |
| **Aircraft card: tail** | tail | c | src/components/site/FlightAircraftCard.astro:16; src/scripts/flight-page.ts:264 | `/?aircraft=<reg>` | Express tail behaviour **inferred** |
| **Aircraft card: type ("Boeing 737 MAX 9 · 179 seats")** | aircraft type | c | src/components/site/FlightAircraftCard.astro:18; src/scripts/flight-page.ts:265; src/lib/flight-page-view.js:272-275 | `/fleet/<slug>` for 19 mainline types | Needs a typeCode→slug helper (data gap 1) |
| Aircraft card: operator ("United Express, flown by SkyWest") | operator | c | same summary line; src/lib/flight-page-view.js:273 | `/?tab=fleet&view=express` | |
| Aircraft card: Wi-Fi ("Starlink Wi-Fi") | Starlink fact | c (violet icon) | src/components/site/FlightAircraftCard.astro:19-22; src/scripts/flight-page.ts:266-274 | `/?view=starlink` (**inferred** fit) | |
| Aircraft card: cabin line, note (delivered, IFE) | other | c | src/components/site/FlightAircraftCard.astro:24, 30; src/scripts/flight-page.ts:286, 306 | none | |
| "Its recent flights": flight number | flight number | a: `/flight/UAxxx` via `setFlightLink`; c for this page's own number | src/components/site/FlightAircraftCard.astro:38-41; src/scripts/flight-page.ts:296 | — | |
| "Its recent flights": route "ORD → LAX" | route / airports | c | src/components/site/FlightAircraftCard.astro:42; src/scripts/flight-page.ts:297 | hub ends: `/hubs/<code>` | |
| "Its recent flights": result ("+12 min") | status | c | src/components/site/FlightAircraftCard.astro:43; src/scripts/flight-page.ts:298-300 | none | |
| The read: "Explain the delay risk" | action | b: fetches inputs, then `/api/delay-explain` | src/components/site/FlightReadCard.astro:23-30; src/scripts/flight-page.ts:455-517 | — | |
| The read: risk line "Board risk: MOD (42/100) · ORD weather…" | status / hub | c | src/components/site/FlightReadCard.astro:33; src/lib/flight-page-read.js:79-83 | `/?tab=schedule&hub=<hub>` (the board shows this risk) | |
| Not found: "It last flew Chicago to X on Nov 9" and lastSeen route "ORD → LHR" | city / route | c | src/lib/flight-page-view.js:317, 322 | hub ends: `/hubs/<code>` | |
| Share card image (card.png) | — | n/a (image) | src/lib/flight-page-card.js:75-112 | — | Not interactive |

## 10. `/trackers` (src/pages/trackers/index.astro)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Tracker card: name, question, description, metric, segment counts, latest change, entry count, "Open tracker →" | tracker | a (card): the whole card is `<a href={t.href}>` | src/pages/trackers/index.astro:61-115 | — | The latest-change text names airports (e.g. "Atlanta (ATL)"), but the card goes to the tracker, not the row |

## 11. `/trackers/atc` (src/pages/trackers/atc.astro)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Briefing "Latest:" entry | tracker entry (prose) | c | src/components/trackers/TrackerPulse.astro:40-43 | `/trackers/atc#row-<id>` | No entity id in changelog data (data gap 3) |
| Briefing personal line: home airport code + summary | airport | c | src/components/trackers/TrackerPulse.astro:49-50; src/scripts/trackers.ts:308-309 | `/trackers/atc/<code>` for hubs | |
| Briefing "Open entry →" | tracker entry | a: `/trackers/atc#row-<id>` (entities :46-64) | src/components/trackers/TrackerPulse.astro:51-55; src/scripts/trackers.ts:310 | for hubs, `/trackers/atc/<code>` | |
| "Watch this airport" | action | b: toggles localStorage watch | src/components/trackers/TrackerPulse.astro:68-75 | — | |
| Stat tiles: live count, still on paper, fiber, target | count | c | src/pages/trackers/atc.astro:312 (stats :173-178) | `#all` (in-page) | |
| Map marker | airport | b: `role="button"`, shows inspector card | src/components/trackers/TrackerMap.astro:59-68; src/scripts/trackers.ts:149-186 | — | |
| Map inspector card title "ORD — Chicago O'Hare…", city/date line, note | airport (hub or any) | c | src/components/trackers/TrackerMap.astro:162-180 (data src/pages/trackers/atc.astro:92-97) | hubs: `/trackers/atc/<code>`, `/hubs/<code>`; others: `#row-<id>` | |
| "Beyond the map" airports | airport | c | src/components/trackers/TrackerMap.astro:189-194 | `#row-<id>` | |
| **Table: airport code + name** | airport (hub or any) | c | src/components/trackers/TrackerTable.astro:132-154 (data src/pages/trackers/atc.astro:130-133) | hubs: `/hubs/<code>`; others: none (the row is the destination) | 89 rows |
| Table: "ORD status →" | tracker entry | a: `/trackers/atc/<code>`, hubs only | src/pages/trackers/atc.astro:134-136; src/components/trackers/TrackerTable.astro:155-161 | — | |
| Table: location "Chicago, IL" | city | c | src/pages/trackers/atc.astro:138 | none | |
| Table: status badge, date | status | c | src/pages/trackers/atc.astro:139-140 | none | |
| Table: notes | prose | c | src/pages/trackers/atc.astro:141-142 | — | |
| Table: "United hub →" | tracker entry | a: `/trackers/united-hubs/<code>`, hubs only. **The label says "United hub" but the target is the construction tracker, not `/hubs/<code>`** | src/pages/trackers/atc.astro:143-145 | `/hubs/<code>` would match the label | |
| Table: Sources (n) | sources | b: `<details>` disclosure, then a: external | src/components/trackers/SourceDisclosure.astro:75-97 | — | |
| Table: Watch / Share | action | b | src/components/trackers/SourceDisclosure.astro:100-119 | — | |
| Sort headers | control | b | src/components/trackers/TrackerTable.astro:79-85 | — | |
| FAQ: list of live airport codes ("CLE, PHX, …, DEN") | airport | c | src/pages/trackers/atc.astro:181, 190 (rendered :472) | `#row-<id>`; hubs: `/trackers/atc/<code>` | |
| FAQ: "Washington National" / "DCA" | airport | c | src/pages/trackers/atc.astro:205 | `#row-dca` (**inferred** id) | |
| CrossLink "United Hub Tracker" | tracker | a: `/trackers/united-hubs` | src/pages/trackers/atc.astro:458-463 | — | |
| Changelog entries ("Atlanta (ATL) becomes the 26th…") | tracker entry | c | src/components/trackers/Changelog.astro:27 (data src/data/trackers/atc.js changelog) | `#row-<id>` | No entity id field |
| Prose (STL, Cleveland, Austin…) | airport | c | src/pages/trackers/atc.astro:395-453 | `#row-<id>` | Prose links are external |

## 12. `/trackers/atc/<code>` (src/pages/trackers/atc/[code].astro + TrackerDetailLayout)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| "← Open the complete Modern Skies Tracker" | tracker | a: `/trackers/atc` | src/components/trackers/TrackerDetailLayout.astro:105-108 | — | |
| Tile "Airport: ORD" | hub | c | src/pages/trackers/atc/[code].astro:136 | `/hubs/<code>` | |
| Tiles status / date | status | c | src/pages/trackers/atc/[code].astro:137-138 | none | |
| Airport card: name, city, status sentence, note | hub | c | src/pages/trackers/atc/[code].astro:146-154 | `/hubs/<code>` | |
| "See every tracked United project at ORD →" | tracker entry | a: `/trackers/united-hubs/<code>` | src/pages/trackers/atc/[code].astro:188-192 | — | |
| Peer links (other hub towers) | tracker entry | a: `/trackers/atc/<peer>` | src/components/trackers/TrackerDetailLayout.astro:117-121 | — | |
| (missing) hub page | hub | missing | — | `/hubs/<code>` | |

## 13. `/trackers/united-hubs` (src/pages/trackers/united-hubs.astro)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Briefing personal line and "Open entry →" | hub | c, then a: `/trackers/united-hubs#hub-<code>` | src/components/trackers/TrackerPulse.astro:49-55 (entities src/pages/trackers/united-hubs.astro:73-86) | `/trackers/united-hubs/<code>` | |
| Stat sub "IAH · IAD · SFO" | hub | c | src/pages/trackers/united-hubs.astro:208 | `/trackers/united-hubs/<code>` or `/hubs/<code>` | |
| Stat subs naming "IAH" / "IAD" / "IAH Terminal B North" | hub / project | c | src/pages/trackers/united-hubs.astro:213, 215 | `/trackers/united-hubs/iah#iah-terminal-b` (exists) | |
| Map marker | hub | b: `role="button"`, shows card | src/components/trackers/TrackerMap.astro:59-68 | — | |
| Map card "IAH — George Bush…", summary line | hub | c | src/components/trackers/TrackerMap.astro:162-180 (data src/pages/trackers/united-hubs.astro:90-121) | `/trackers/united-hubs/<code>`, `/hubs/<code>` | |
| **Hub-by-hub group: code ("IAH")** | hub | d: **LINK-COLOUR** (`<span class="… text-primary">`, right beside the linked hub name) | src/pages/trackers/united-hubs.astro:392 | `/hubs/<code>` | |
| Hub-by-hub group: airport name | hub | a: `/trackers/united-hubs/<code>` | src/pages/trackers/united-hubs.astro:393-398 | — | |
| Hub-by-hub: "City, ST · N projects" | city / count | c | src/pages/trackers/united-hubs.astro:399-401 | none | |
| Hub-by-hub: "also in the FAA paper-strips rollout →" | tracker entry | a: `/trackers/atc/<code>` | src/pages/trackers/united-hubs.astro:402-409 | — | |
| Project card: type chip, status, builder chip | other / status | c | src/pages/trackers/united-hubs.astro:426-432 | none | |
| Project card: name | project | c | src/pages/trackers/united-hubs.astro:434 | `/trackers/united-hubs/<code>#<id>` (exists) | |
| Project card: meta line "Opened … · 54,000 sq ft · $… · 22 gates" | other | d: **LINK-COLOUR** (`text-primary` on figures) | src/pages/trackers/united-hubs.astro:435-439 | none (figures) | Drop the colour (DESIGN.md:27-29) |
| Project card: details | prose | c | src/pages/trackers/united-hubs.astro:440 | — | |
| Table: project name | project | c | src/pages/trackers/united-hubs.astro:166 | `/trackers/united-hubs/<code>#<id>` | 26 rows |
| Table: hub code | hub | c (mono) + a: "IAH projects →" to `/trackers/united-hubs/<code>` | src/pages/trackers/united-hubs.astro:167-172 | code to `/hubs/<code>` | |
| Table: type, status, date, scale | other | c | src/pages/trackers/united-hubs.astro:173-180 | none | |
| Club math figures (54,000 / ~119,000 / 4,000 / 600+) | count | d: **LINK-COLOUR** | src/pages/trackers/united-hubs.astro:540, 550, 559, 568 | none | |
| Club math: "Houston club", "SFO club", "Dulles club" | project | c | src/pages/trackers/united-hubs.astro:544, 563, 571-572 | `/trackers/united-hubs/<code>#<id>` | |
| Club math: "787-10s (N seats each)" | aircraft type | c | src/pages/trackers/united-hubs.astro:572 | `/fleet/787-10-dreamliner` | The data is already imported (:67) |
| CrossLink "Modern Skies Tracker" | tracker | a: `/trackers/atc` | src/pages/trackers/united-hubs.astro:580-585 | — | |
| FAQ answers (hubs, projects) | hub / project | c | src/pages/trackers/united-hubs.astro:590-597 (data :219-245) | `/trackers/united-hubs/<code>#<id>` | |
| Changelog entries | tracker entry | c | src/components/trackers/Changelog.astro:27 | `#<project-id>` | No id field |

## 14. `/trackers/united-hubs/<code>` (src/pages/trackers/united-hubs/[code].astro)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Kicker "United hub · Houston" (and on `/trackers/atc/<code>`, "FAA modernization · Chicago") | city | d: LINK-COLOUR (`text-primary`) | src/components/trackers/TrackerDetailLayout.astro:94-96 | `/hubs/<code>` | One shared layout, counted once for both detail page types |
| Summary tiles (projects, building, open, gates) | count | c | src/pages/trackers/united-hubs/[code].astro:157-162 | in-page anchors | |
| Project card: name, badges, meta, details | project | c | src/pages/trackers/united-hubs/[code].astro:170-186 | — (it is the destination: `#<id>`) | |
| "The read on IAH" | prose | c | src/pages/trackers/united-hubs/[code].astro:201-205 | — | |
| "Open the sourced IAH electronic flight strips status →" | tracker entry | a: `/trackers/atc/<code>` | src/pages/trackers/united-hubs/[code].astro:216-220 | — | |
| FAQ: project list | project | c | src/pages/trackers/united-hubs/[code].astro:68-72, 227-232 | `#<id>` | |
| Peer hub links | tracker entry | a: `/trackers/united-hubs/<peer>` | src/components/trackers/TrackerDetailLayout.astro:117-121 | — | |
| (missing) hub page / news | hub / news | missing | — | `/hubs/<code>`, `/news/<slug>` | |

## 15. Shared tracker components (summary)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| StatStrip tile label / value / sub | count | c | src/components/trackers/StatStrip.astro:24-26 | — | No href prop |
| TrackerDataActions: CSV / JSON / Report a correction | data | a | src/components/trackers/TrackerDataActions.astro:36-47 | — | |
| TrackerSearch empty state: "United's hubs are IAH, IAD, SFO, DEN, ORD, EWR, LAX, and GUM" | hub | c | src/pages/trackers/united-hubs.astro:379 | `/trackers/united-hubs/<code>` or `/hubs/<code>` | Shown only on a search with no match |

## 16. News (src/pages/news/index.astro, src/layouts/NewsLayout.astro, src/data/news/index.js)

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| Index card: category (`text-primary`), date, title, summary | news | a (card): stretched title link `/news/<slug>` | src/pages/news/index.astro:83-97, 103-119 (category :85, :105) | — | |
| Index card: "Read more" / "Read" | news | a: `/news/<slug>` | src/pages/news/index.astro:94-96, 116-118 | — | |
| **Article header: category ("Fleet")** | category | d: **LINK-COLOUR** (`text-primary`, not in a card) | src/layouts/NewsLayout.astro:86 | none exists (no category filter on `/news`) | |
| Article Sources list | source | a: external | src/layouts/NewsLayout.astro:114-130 | — | |
| Related on The Blue Board | hub / type | a: `/hubs/<tag>` or `/fleet/<tag>` (from `tags`) | src/layouts/NewsLayout.astro:141-150; src/data/news/index.js:86-106 | — | 5 of 25 articles have no tags |
| "All News" | section | a: `/news` | src/layouts/NewsLayout.astro:176-182 | — | |
| Body: tables / lists | — | none: 0 ul, 0 ol, 0 table in 25 bodies (script count) | src/data/news/index.js:110-740 | — | |
| Body: flight numbers (UA14 in 2 articles, UA939, UA1) | flight number | c (prose) | src/data/news/index.js:343, 497, 507-526, 711 | `/flight/<ident>` | Body colour |
| Body: tails (N61101, N64321) | tail | c (prose) | src/data/news/index.js:482-497, 574 | `/?aircraft=<reg>` | |
| Body: hub codes / names, aircraft types | hub / type | c, mostly (only 6 internal links, all to `/news/*`) | src/data/news/index.js (bodies) | `/hubs/<code>`, `/fleet/<slug>` | The script found 33 unlinked type mentions and 9 unlinked hub codes |

## 17. Other pages

| Thing | Kind | Today | file:line | Fits destination | Notes |
|---|---|---|---|---|---|
| 404 hub pills | hub | a: `/hubs/<hub>` | src/pages/404.astro:43-45 | — | |
| 404 section pills | section | a | src/pages/404.astro:48-54 | — | |
| Privacy processor lists (Supabase, Resend, Vercel, Anthropic, Stripe, BMC) | company | c | src/pages/privacy.astro:31-45, 52-86 | none internal | |
| Thanks | — | no list | src/pages/thanks.astro | — | |
| Home `sr-only` brief checks (incl. text "/?flight=UA1234") | feature | c (sr-only) | src/pages/index.astro:74-82 (data src/lib/home-seo.js:62) | dashboard tabs | |
| Home `noscript` hub and resource links | hub / section | a (`text-primary`) | src/pages/index.astro:91-104 | — | |
| Home `sr-only` nav | hub / section | a | src/pages/index.astro:128-130 | — | |
| Home `sr-only` fleet summary (type list) | aircraft type | c (sr-only) | src/pages/index.astro:132-136 (data src/lib/home-seo.js:201-213) | `/fleet/<slug>` | |

## 18. Link-coloured labels and headings (not entities, not counted above)

These are `text-primary` text that is not a link and names no entity with a destination. They matter only for DESIGN.md:27-29 ("colour that is not a status signal is decoration") and for a design that wants link colour to mean "clickable". They are listed here once instead of as table rows:

- Kickers, section labels and subheads:
  - `src/pages/hubs/index.astro:103` ("Hub Airports" in the h1)
  - `src/pages/trackers/index.astro:43` ("Living Pages")
  - `src/pages/trackers/atc.astro:253` (subhead class, used at :384, :393, :406), `:273`, `:426` ("Sidebar")
  - `src/pages/trackers/united-hubs.astro:293` (subhead class, used at :506, :515), `:316`, `:534` ("Sidebar")
  - `src/components/trackers/TrackerPulse.astro:35` ("Your tracker briefing") and `:41` ("Latest:")
  - `src/components/trackers/TrackerDataActions.astro:29` ("Use the data")
  - `src/components/trackers/CrossLink.astro:14` (the box title; the link sits under it at :16-18)
  - `src/components/trackers/TrackerSearch.astro:19` (label) and `:43` (empty-state title)
- Page-identity accents in h1, which name the current page:
  - `.iata` on hub pages (`src/layouts/HubLayout.astro:104-106`)
  - `.type-badge` on fleet pages (`src/layouts/FleetTypeLayout.astro:132-134`)
  - Both are `text-primary` through `src/styles/content.css:224-226`.
- Decoration: the "404" figure (`src/pages/404.astro:26-28`).
- Not in this list because they sit inside a link and so follow it:
  - `src/pages/trackers/index.astro:65`, `:101`, `:113` (inside the card `<a>`)
  - `src/pages/hubs/index.astro:136` and `src/pages/fleet/index.astro:374` (stretched-link cards)
  - `src/pages/news/index.astro:85`, `:105` (stretched-link cards)
