# Links everywhere: design

Date: 2026-11-12. Status: **draft, awaiting the owner's approval.** Written against `origin/main` at v1.28.1 (`c168f26`).

## Why

The owner, Nov 12 2026, about the Starlink tab and then the whole site: "Throughout all these tables and lists, I just feel like a lot of them should be linkable… I just want to make sure these things are linkable and that you can click and go to relevant sections throughout the site." Asked whether that meant the Starlink tab or every table, he said: "every table and list please".

Yesterday's work (v1.28.0) made every flight number that prints in link colour a real link. This extends the same idea from one kind of thing to all of them.

Three read-only audits covered every table and list on the site. Their inventories sit beside this file and are the builder's worklist:

- `2026-11-12-links-inventory-dashboard-core.md` (Live, Schedule, Stats, Weather, shell, Sources)
- `2026-11-12-links-inventory-dashboard-fleet-starlink.md` (Fleet, Starlink, My Flights, every overlay)
- `2026-11-12-links-inventory-content-pages.md` (every Astro page, layout and client script)

What they found, counting one row per kind of printed thing per surface:

| Slice | Links | Buttons | Plain | Plain but painted like a link |
|---|---|---|---|---|
| Dashboard core | 14 | 26 | 114 | 5 |
| Fleet, Starlink, My Flights, overlays | 15 | 59 | 176 | 8 |
| Content pages | 66 | 8 | 135 | 7, plus about 17 link-coloured labels |

## Goals

1. Every thing a table or list prints that has a home on this site is a link to that home.
2. The same kind of thing goes to the same place wherever it prints, by one tested rule per kind.
3. Nothing looks like a link unless it is one. The roughly 37 painted-but-inert places either become links or lose the colour.
4. A link clicked inside the dashboard never reloads the dashboard.

## Non-goals

- No new pages. There are no pages for non-hub airports, operators, fleet families, news categories or single tails, and this work adds none.
- No linking inside free text: news bodies, FAQ answers, tracker `details`, changelog entries and hub prose stay as they are. These are escaped strings or hand-written HTML, and the request was tables and lists. One exception is listed under Content pages (hub "Key Routes").
- No new "related" lists (for example news on hub pages). That is new content, not linking what is printed. Noted as a follow-up.
- No URL state for filters that are local today (Live phase, Schedule status and type filters). Things that drive those are buttons, see below.
- No change to data, scoring, or what any table prints, except the Express flight number (decision 2).

## Anti-goals

These make the work a failure even if every link works:

- A wall of blue. A Schedule row with four link-coloured cells reads as decoration, and DESIGN.md says this product does not decorate.
- A link to a place that does not show the thing (the brief-chip rule, DESIGN.md 2026-11-10).
- A dashboard link that reloads the page, or one that only works on a fresh load.
- A link inside a button, or a touch target under the DESIGN.md floors.
- A link built from a printed string where the data knows better (see aircraft types).

## The rule

**A name goes to the thing's home on the side of the site you are already on. If that side has no home for it, the link crosses over.** A hub code attached to a status goes to where that status is shown.

| Kind | In the dashboard | On a content page |
|---|---|---|
| Flight number | `/flight/<ident>` (the dashboard has no view of a flight that is not airborne) | `/flight/<ident>` |
| Tail | the aircraft dialog, in place | `/?aircraft=<reg>` |
| Hub code, as a name (route end, matrix header, table cell) | that hub's Schedule board, in place | `/hubs/<code>` |
| Hub code on a status (FAA tag, weather line, on-time chip) | where the dashboard shows that status: `?tab=weather&hub=`, `?tab=weather&section=nas` | the same dashboard link |
| Aircraft type with a fleet page | the Fleet tab filtered to that type, in place | `/fleet/<slug>` |
| A count, bar, tile or chip that summarizes rows | filters the list it summarizes | the dashboard view that lists them, where one exists |
| Tracker entry (ATC facility, hub project) | n/a | its tracker page or row anchor |
| News article | `/news/<slug>` | `/news/<slug>` |
| Starlink or Wi-Fi badge on a row | the Starlink tab | `/#starlink` |
| Special-livery or named-aircraft chip | the Fleet tab's special view | `/?tab=fleet&view=special` |
| A Sources card that names a dashboard view | that tab | n/a |
| Non-hub airport, operator, fleet family, regional type, news category | plain text, body colour | plain text, body colour |

**What "done" covers.** Goal 1 governs: where an inventory row names an existing destination for a printed thing, it gets linked, whether or not its kind has a row above. Three stated exceptions stay plain: lines in the rotating ticker (a target that changes every five seconds), map legend rows (a key, not a list of things), and tiles inside a `role="status"` live region whose filter has no address (they may become buttons where the filter exists; otherwise they stay text, so the region is not re-read with link names). The runtime guard enforces only what a machine can recognise: flight numbers, tails and hub codes.

Two doors join the sides, so nothing is a dead end:

- The Schedule board's header links once to that hub's page, and the Fleet tab's type filter, when one type is selected, links once to that type's page.
- Hub pages already have "one button into the board". Fleet type pages get the matching link: the "Aircraft" tile and the seat-configuration counts go to `/?tab=fleet&type=<typeCode>`.

**Owner decision 1 (default above is what gets built unless he says otherwise).** Earlier in the conversation he was shown "hub code → that hub's schedule board, the same wherever it prints". The table above changes that: on content pages a hub code goes to the hub's page, and only inside the dashboard to the Schedule board. The alternative is one destination everywhere (always the hub page, always the fleet page), which is simpler to state and leaves the dashboard on every click.

The hub strip under the header is part of this decision. Each chip ("● ORD 87%") links to `/hubs/<code>` today, with the tooltip "United at ORD — hub guide"; it is the link every dashboard visitor sees. Under the default it is a hub code on an on-time status, so it opens that hub's Schedule board, where the dashboard shows the flights behind the figure, and its tooltip, screen-reader words and DESIGN.md rows change with it. The hub guide is then one click further, through the Schedule board's header link. Under the alternative the strip stays exactly as it is.

### Links versus buttons

- Something that takes you to another view or page is an `<a href>` with a real address, so it opens in a new tab and can be copied.
- Something that changes the view you are in and has no address (a count that sets a local filter, a chip that toggles "New this week") is a `<button>`.
- Never one inside the other. Where a row is already one click target (Live search rows, hub traffic, phone Schedule, Watch panel, the Starlink departures row on touch), the link is split out and sits above it, the way `FlightLink` does now.

### In place, without a reload

Today only tab, scroll target and Schedule hub resolve in place (`resolveDeepLink`, used by the brief chips). `?aircraft=`, `?flight=`, `?hub=` for the Live map and the Fleet tab's `?type=`, `?filter=` and `?view=` are read once on load, so a link to them reloads the dashboard.

The foundation is one resolver and one link component:

- `resolveDeepLink` learns every published parameter and returns a full intent (tab, scroll target, Schedule hub, Live hub filter, aircraft, flight, Fleet type/filter/view, Starlink view).
- One dashboard link component renders `<a href>` and, on an unmodified primary click, applies the intent through the existing state (`setTab`, `openAircraft`, `useSchedule().setCurrent`, the Fleet view's own deep-link reader, and so on) instead of navigating. Modified clicks and "open in new tab" use the address as it is.
- A cold load of the same address must land in the same place as the in-place click. That equivalence is the test.

### One rule per kind, in `src/lib`

Each is a DOM-free function with a test, beside `flight-link.js`. The React components and the content pages' client script (`src/scripts/flight-link.ts` is the precedent) both call them, so the two sides cannot drift.

- **Flight.** `flightLink()` as it is, plus the Express change in decision 2.
- **Tail.** Any United or United Express registration the fleet database or the Starlink roster knows. The builder confirms the aircraft dialog has content for an Express tail before those link; if it does not, Express tails stay plain.
- **Hub.** One of the nine hub codes. Anything else is not a link.
- **Aircraft type.** No type → fleet page function exists today. Rules:
  - Where the row has a tail, the page comes from the fleet database's type for that tail, not from the printed string. The Starlink tracker lists N75436 as "737-900" while the fleet database says 737-900ER.
  - Otherwise the printed string must equal a fleet type's `typeCode` exactly (all 19 do, for fleet-database strings).
  - ICAO codes are ambiguous (`B739` is the 737-900 and the 737-900ER, `B772` the 777-200 and 777-200ER). Without a tail those print plain.
  - Clipped provider text ("Boeing 737", "Canadair CRJ") and regional types print plain.

**Owner decision 2: Express flight numbers.** The Starlink feed prints operating codes (SKW5415, OO5506, RPA3542, YX3506, GJS4541, G7…, ASH…, YV…), about 62% of its flights, and DESIGN.md (2026-11-11) says those never link. Checked Nov 12 against `flight_history`: 82 of 83 sampled flights matched a United flight by route and time, all 82 with the same number; a further 42 in the IATA forms (YV, G7, YX) matched 42 of 42 by number and route within the past week. `/api/flight?ident=UA5415` returns real history, so the pages are not empty. Default, unless he says otherwise:

- On a row the feed marks as United (`airline: 'UA'`) and whose prefix is one of the tested operator codes, the board prints the United number (UA5415) and links it. The operator name already prints under it.
- Everywhere else (the Live ticker, map callsigns) a callsign stays a callsign and stays plain.
- This reverses a dated DESIGN.md decision, so it needs his explicit yes and a new Decisions row. The builder repeats the check on a larger sample before shipping and records the result in the test.

### How a link looks

My call, his to veto on the first preview:

- One link per row takes link colour (`text-primary`): the thing the row is about. On a flight row that is the flight number, on a roster row the tail.
- Every other link in the row is body colour with a quiet underline that strengthens on hover and focus, the treatment prose links already have on content pages.
- A link-coloured thing that is not a link loses the colour. Headings and labels in `text-primary` that name no entity are listed in the content inventory, section 18; each either becomes a link or takes foreground.

### Touch

- Dashboard links keep the 44 px touch target with the `FlightLink` box pattern; dense content tables use the existing `touchRowLink` pattern.
- On a phone row that is already one tap target, only the row's identity link is split out (flight number or tail). Its other names (hub ends, type, tail) are reached one step on: through the flight page the number links to, and through what the row opens where that shows them (the roster expansion, the aircraft dialog, the flight sheet for an airborne flight). On a fine pointer every name in the row links.
  - Phone Schedule: for a flight that is not in the live feed the flight sheet has no route, aircraft or tail to show (`resolveFlightRoute(null)`, `FlightSheet.tsx:266-270`), so the flight page is the way to those names. The row's tail, dotted-underlined and inert today, loses the underline; it does not become a second link in the row. Teaching the sheet to show a scheduled flight from the board's row is a separate piece of work, not part of this.
  - Starlink departures on touch: the row keeps opening the aircraft dialog and the origin hub stays plain in the row; the board's own hub chips already select a hub.
- Chips in dense strips may use the 24 to 28 px chip sizes DESIGN.md already allows.

## Surfaces

The inventories give every row with file and line. The shape of the work per slice:

**Starlink tab (first).** Roster next-flight and upcoming-flight numbers; "inbound on UA3508"; Express numbers per decision 2; ledger tails and the newest/oldest tails; the departures board's hub origin; aircraft type by tail; the Mainline and Express bars and the "+N new this week" chip become buttons that set the roster's filters; industry rows stay plain (no home).

**Rest of the dashboard.** Stats utilization and fleet-age rows (38 type rows); the hub matrix headers; NAS hub tags and FAA mentions; Weather hub cards; the phone Schedule tail (dotted-underlined and inert today, and the phone board has no way to the aircraft dialog); Watch panel and banner numbers; Schedule route ends and types; Fleet and Airborne table types; My Flights numbers and hub ends; Express "last UA flight"; the flight sheet and aircraft dialog. The desktop Reg buttons become real `?aircraft=` links. The Watch panel prints a raw ident that can carry a provider suffix ("UA526H"); the link uses the display form.

**Content pages.** Fleet registry tails (19 pages, about 1,154 rows); tracker pages to hub pages (none today, and the ATC table's "United hub →" goes to the construction tracker); flight-page tail, type and hub ends; hub-board and FleetLive hub ends (FleetLive's single row link is split); construction-project names to their tracker rows; `StatTile` and `StatStrip` gain an optional `href` for tiles that summarize something listed elsewhere; Newark's tiles and its tracker entries; `/hubs` "What we track" to the dashboard tabs. The hub pages' "Key Routes" lists are the one free-text exception: hub codes in them are linked by a render-time transform (`demoteHubCtaRow` is the precedent), non-hub codes stay plain.

Two faults the audit found, fixed here because they are missing links:

- `/hubs/gum` and `/hubs/nrt` have no live-map link on production (checked Nov 12; `/hubs/ord` has `/?hub=ord`). `splitCompactLiveBar` drops the bar that carried it.
- "Starlink Tracker" on `/fleet` points at `/?tab=fleet`; it should open the Starlink tab.

## Guards

- **Static.** The existing link-colour guard grows: `text-primary` or an underline on an element that is not a link or button fails, with a short allowlist that states a reason per entry.
- **Runtime.** `scripts/ui-audit.mjs` gains a check at its four viewports: inside table and list rows, text that is a United flight number, a known tail or a hub code must sit inside a link or button, or be on an allowlist with a reason. This is what keeps the next new table honest.
- **Equivalence.** For each parameter the resolver knows, a test that an in-place click and a cold load of the same address reach the same state.

## Order of work

Three pull requests, each a preview he looks at before merging:

1. Foundation (resolver, link component, the per-kind rules) and the Starlink tab.
2. The rest of the dashboard.
3. Content pages.

Each adds its DESIGN.md Decisions rows and component-table rows, and passes `bun run build`, `bun run test` and `bun run typecheck`, in that order, plus `ui-audit`.

The Starlink tab's two fact fixes (the Express completion figure, and Alaska and Hawaiian as one row) are separate and small. They are being agreed in conversation and ship on their own, not under this document.

## Left to the builder

- File and component names; whether the content pages share the React link component or keep a script, as flight numbers do now.
- How the Fleet view's own deep-link reader is reached from the resolver.
- The exact allowlists, with reasons.
- Row layout details needed to split a link out of a whole-row button.
- Whether the hub board prints the tail and model it already receives. It may link them if it prints them; it need not start printing them.

## Calls I made, his to veto

- The look: one link-coloured link per row, the rest body colour with a quiet underline.
- On phones, only the identity link is split out of a whole-row target.
- "Key Routes" is the only free text that gets links.
- Related-news lists are out of scope.
- Three pull requests in the order above, Starlink tab first.
