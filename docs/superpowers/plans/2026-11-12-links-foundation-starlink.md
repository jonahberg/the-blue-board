# Links everywhere, part 1: foundation and the Starlink tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every name the Starlink tab prints that has a home on the site is a link to it, on top of one set of link rules and one in-place link component the next two pull requests reuse.

**Architecture:** One DOM-free rule per kind of thing in `src/lib` (flight, tail, hub, aircraft type), each tested. One resolver (`resolveDeepLink`) that understands every dashboard address this part needs, one hook that applies a resolved address without a reload, and one `<a>` component that uses both. The Starlink tab's tables then render through small per-kind wrappers.

**Tech Stack:** Astro static site, one React island (`src/app`), Tailwind v4, shadcn/ui, vitest (`bun run test`, never bare `bun test`), Playwright via `scripts/ui-audit.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-12-links-everywhere-design.md` (approved Nov 12 2026). Worklist rows: `docs/superpowers/specs/2026-11-12-links-inventory-dashboard-fleet-starlink.md`, the Starlink sections. Read both, and `DESIGN.md`, before Task 1.

This is part 1 of 3. Parts 2 (rest of the dashboard) and 3 (content pages) get their own plans after this merges. The spec lists the "newest/oldest tails" under the Starlink tab; they are in the Fleet tab's delivery timeline and belong to part 2. The Starlink tab's two fact fixes (Express bar, Alaska + Hawaiian row, target tile) are a separate branch, `fix/starlink-express-scope-alaska-row`; this branch is cut after that merges and does not touch those numbers.

## Global Constraints

- Logic lives in `src/lib` with a vitest test, not inline in a component (repo CLAUDE.md).
- A destination is an `<a href>` with a real address. A control that changes the current view and has no address is a `<button>`. Never one inside the other.
- A dashboard link clicked with an unmodified primary button never reloads the dashboard. Modified clicks and middle clicks use the address untouched.
- One link per row takes `text-primary`: the thing the row is about. Every other link in the row is body colour with a quiet underline that strengthens on hover and focus.
- Nothing that is not a link or button carries `text-primary` or an underline.
- No destination means plain body text: non-hub airports, operators, regional aircraft types, fleet families.
- Touch: 44 px targets through the existing `FlightLink` box pattern. On a touch row that is already one tap target, only the row's identity link is split out; hub and type links in that row render as plain text on a coarse pointer.
- `src/lib` must not import `src/data/fleet/index.js` (it carries every fleet page's HTML and would land in the dashboard bundle).
- `api/` never imports `src/data/facts.js` or a bare `.json`.
- Aircraft type links are decided by the tail's type in the fleet database when the row has a tail, never by the tracker's printed string (N75436 prints "737-900" and is a 737-900ER).
- Express numbers: a row the Starlink feed marks `airline: 'UA'` whose flight number starts with one of `SKW OO RPA YX GJS G7 ASH YV` prints and links the United number (`SKW5415` → `UA5415`). Anything else stays as printed and plain. The Live ticker and the map are untouched.
- Gates, in this order: `bun run build`, `git checkout -- src/data/starlink-live.json`, `bun run test`, `bun run typecheck`, then `node scripts/ui-audit.mjs` (needs `PLAYWRIGHT_CHROMIUM_PATH`, see `MAINTENANCE.md`).
- Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Do not push or open a pull request; the orchestrator does.

## Review Focus

1. **Modified and middle clicks.** Cmd/Ctrl/Shift/Alt + click and button 1 must open the address in a new tab, not be swallowed. Test in Task 3.
2. **A row that looks Express but is not United's.** `airline` missing or not `UA`, an untested prefix (`UCA5004`, `C55004`), a bare number, a provider suffix (`SKW5415A`): the board prints what the feed sent, plain. Test in Task 1.
3. **A tail the fleet database does not know** (every Express tail, a new delivery): the type prints plain, the tail still opens the aircraft dialog, nothing throws. A tail whose tracker type disagrees with the database links to the database's page. Tests in Tasks 1 and 5.
4. **A Fleet link followed before the fleet database has loaded,** or naming a type the controls do not offer: applied once the database arrives, ignored (not filtered to nothing) when unknown, and applied again when the same link is clicked twice. Test in Task 4.
5. **An address that is not the dashboard's** (`/flight/UA576`, `/hubs/ord`, `https://…`) passed to the in-place component: it must navigate normally. A dashboard address naming an unknown hub or tab must not half-apply. Tests in Tasks 2 and 3.

---

### Task 1: The per-kind link rules

**Files:**
- Modify: `src/lib/flight-link.js`
- Create: `src/lib/hub-link.js`, `src/lib/tail-link.js`, `src/lib/fleet-type-link.js`
- Test: `tests/flight-link.test.js` (extend), `tests/hub-link.test.js`, `tests/tail-link.test.js`, `tests/fleet-type-link.test.js`

**Interfaces:**
- Consumes: `flightLink(printed)` and `flightPagePath` as they are; `HUB_ORDER` (the nine hub codes; find its module from `StarlinkView.tsx`'s import).
- Produces:
  - `EXPRESS_OPERATING_PREFIXES: readonly string[]` = `['SKW','OO','RPA','YX','GJS','G7','ASH','YV']`
  - `unitedNumber(printed: unknown, row?: { airline?: string }): string | null` — `'UA5415'` for a tested prefix on a row with `airline === 'UA'`, else `null`
  - `hubLink(code: unknown, side: 'dashboard' | 'site'): { code: string, href: string } | null` — `/?tab=schedule&hub=ORD` or `/hubs/ord`
  - `tailLink(reg: unknown): { reg: string, href: string } | null` — `/?aircraft=N12345`; accepts a US registration (`/^N[1-9][0-9A-Z]{1,4}$/` after upper-casing and removing a hyphen)
  - `FLEET_TYPE_SLUGS: Readonly<Record<string, string>>` — the 19 pairs below
  - `fleetTypeLink(typeCode: unknown, side: 'dashboard' | 'site'): { typeCode: string, slug: string, href: string } | null` — `/?tab=fleet&type=<encoded typeCode>` or `/fleet/<slug>`
  - `fleetTypeCodeForTail(reg: unknown, fleetByReg: Record<string, { t?: string }> | null | undefined): string | null` — the database's `t` for that tail when it is a key of `FLEET_TYPE_SLUGS`

```js
// src/lib/fleet-type-link.js — the exact map (typeCode in /data/fleet.json → /fleet/<slug>)
export const FLEET_TYPE_SLUGS = Object.freeze({
  '737-700': '737-700', '737-800': '737-800', '737-900': '737-900', '737-900ER': '737-900er',
  '737 MAX 8': '737-max-8', '737 MAX 9': '737-max-9',
  '757-200': '757-200', '757-300': '757-300', '767-300ER': '767-300er', '767-400ER': '767-400er',
  '777-200': '777-200', '777-200ER': '777-200er', '777-300ER': '777-300er',
  '787-8': '787-8-dreamliner', '787-9': '787-9-dreamliner', '787-10': '787-10-dreamliner',
  A319: 'a319', A320: 'a320', A321neo: 'a321neo',
});
```

- [ ] **Step 1: Write the failing tests**

```js
// tests/flight-link.test.js (add)
describe('unitedNumber', () => {
  it.each([['SKW5415','UA5415'],['OO5506','UA5506'],['RPA3542','UA3542'],['YX3506','UA3506'],
           ['GJS4541','UA4541'],['G74612','UA4612'],['ASH3998','UA3998'],['YV4049','UA4049']])(
    '%s on a United row is %s', (printed, ua) => {
      expect(unitedNumber(printed, { airline: 'UA' })).toBe(ua);
      expect(flightLink(unitedNumber(printed, { airline: 'UA' }))).toEqual({ ident: ua, href: `/flight/${ua}` });
    });
  it.each([['SKW5415', {}], ['SKW5415', { airline: 'AA' }], ['UCA5004', { airline: 'UA' }],
           ['C55004', { airline: 'UA' }], ['5415', { airline: 'UA' }], ['SKW5415A', { airline: 'UA' }],
           ['UA576', { airline: 'UA' }], ['', { airline: 'UA' }], [null, { airline: 'UA' }]])(
    '%s with %o is not converted', (printed, row) => expect(unitedNumber(printed, row)).toBeNull());
});
// The check behind the rule, kept as data: 2026-11-12, flight_history joined on route and time.
it('records the sample that justified the rule', () => {
  expect(EXPRESS_NUMBER_CHECK).toMatchObject({ date: '2026-11-12', matched: 124, sameNumber: 124, sampled: 125 });
});
```

```js
// tests/hub-link.test.js
expect(hubLink('ord', 'dashboard')).toEqual({ code: 'ORD', href: '/?tab=schedule&hub=ORD' });
expect(hubLink('ORD', 'site')).toEqual({ code: 'ORD', href: '/hubs/ord' });
for (const bad of ['LHR', 'XYZ', '', null, 42]) expect(hubLink(bad, 'dashboard')).toBeNull();

// tests/tail-link.test.js
expect(tailLink('n78501')).toEqual({ reg: 'N78501', href: '/?aircraft=N78501' });
expect(tailLink('N-613UX')).toEqual({ reg: 'N613UX', href: '/?aircraft=N613UX' });
for (const bad of ['UA576', 'N0123', 'JA873A', '', null]) expect(tailLink(bad)).toBeNull();

// tests/fleet-type-link.test.js
import { fleetTypes } from '../src/data/fleet/index.js';   // the TEST may import it; the lib may not
it('is exactly the inversion of the fleet pages', () => {
  expect(FLEET_TYPE_SLUGS).toEqual(Object.fromEntries(Object.entries(fleetTypes).map(([slug, d]) => [d.typeCode, slug])));
});
expect(fleetTypeLink('737 MAX 9', 'site')).toEqual({ typeCode: '737 MAX 9', slug: '737-max-9', href: '/fleet/737-max-9' });
expect(fleetTypeLink('737 MAX 9', 'dashboard').href).toBe('/?tab=fleet&type=737%20MAX%209');
for (const bad of ['B739', 'ERJ-175', 'E175SC', 'CRJ-550', '777-224(ER)', 'Boeing 737', '', null])
  expect(fleetTypeLink(bad, 'site')).toBeNull();
expect(fleetTypeCodeForTail('N75436', { N75436: { t: '737-900ER' } })).toBe('737-900ER');
expect(fleetTypeCodeForTail('N613UX', { N75436: { t: '737-900ER' } })).toBeNull();
expect(fleetTypeCodeForTail('N75436', null)).toBeNull();
it('the lib does not import the fleet page data', () =>
  expect(readFileSync('src/lib/fleet-type-link.js', 'utf8')).not.toMatch(/data\/fleet/));
```

- [ ] **Step 2: Run them and see them fail**

Run: `bunx vitest run tests/flight-link.test.js tests/hub-link.test.js tests/tail-link.test.js tests/fleet-type-link.test.js`
Expected: FAIL, the new exports are undefined.

- [ ] **Step 3: Implement the four rules to the signatures above**

`unitedNumber` matches `^(PREFIX)(\d{1,4})$` against the trimmed, upper-cased text; longest prefix first so `G7` + `4612` is not read as `G` + `74612`. `EXPRESS_NUMBER_CHECK` is a frozen object in `flight-link.js` with the four values the test names and a one-line comment on the method. The orchestrator re-runs the check on a larger sample before release and may hand you new numbers for both the constant and the test; use them as given. Update the file-header comment in `flight-link.js`: the "operating callsign is not linked" paragraph now describes the United-row exception and where it does not apply.

- [ ] **Step 4: Run the tests and see them pass**

Run: the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(links): one rule each for hubs, tails, aircraft types and Express numbers"`

---

### Task 2: The resolver learns aircraft and Fleet addresses

**Files:**
- Modify: `src/app/state/deep-links.ts` (`DeepLinkIntent`, `resolveDeepLink`), `src/app/features/BriefPanel.tsx` (the intent's `tab` becomes nullable)
- Test: `tests/deep-links.test.ts` (extend; find the existing file that tests `resolveDeepLink` and add to it)

**Interfaces:**
- Consumes: `resolveTabParam`, `weatherScrollTarget`, `FleetDeepLinks`.
- Produces:

```ts
export type DeepLinkIntent = {
  tab: TabId | null;            // null: an overlay link that keeps the current tab
  scrollTo: string | null;
  scheduleHub: string | null;   // only when tab === 'schedule' and the hub is one of the nine
  aircraft: string | null;      // upper-cased registration from ?aircraft=
  fleet: FleetDeepLinks | null; // only when tab === 'fleet' and ?type=/?filter=/?view= is present
};
export function resolveDeepLink(href: string): DeepLinkIntent | null;
```

`resolveDeepLink` returns `null` when the address is not the dashboard's (origin other than the site's, or a path other than `/`), and when it names nothing the intent can carry.

- [ ] **Step 1: Write the failing tests**

```ts
expect(resolveDeepLink('/?aircraft=n78501')).toEqual({ tab: null, scrollTo: null, scheduleHub: null, aircraft: 'N78501', fleet: null });
expect(resolveDeepLink('/?tab=fleet&type=737%20MAX%209')).toMatchObject({ tab: 'fleet', fleet: { filter: '737 MAX 9', view: null } });
expect(resolveDeepLink('/?tab=fleet&view=special')).toMatchObject({ tab: 'fleet', fleet: { filter: null, view: 'special' } });
expect(resolveDeepLink('/?tab=schedule&hub=ord')).toMatchObject({ tab: 'schedule', scheduleHub: 'ORD' });
expect(resolveDeepLink('/?tab=schedule&hub=xyz')).toMatchObject({ tab: 'schedule', scheduleHub: null });
for (const outside of ['/flight/UA576', '/hubs/ord', '/fleet/a319', 'https://example.com/?tab=fleet', '/', '/?utm_source=x'])
  expect(resolveDeepLink(outside)).toBeNull();
// unchanged behaviour the brief chips rely on
expect(resolveDeepLink('/?tab=weather&hub=EWR')).toMatchObject({ tab: 'weather', scheduleHub: null });
expect(resolveDeepLink('/#live')).toMatchObject({ tab: 'live' });
```

- [ ] **Step 2: Run and see them fail.** `bunx vitest run tests/deep-links.test.ts` → FAIL on the new cases.
- [ ] **Step 3: Extend `DeepLinkIntent` and `resolveDeepLink`; in `BriefPanel.tsx` treat a `null` tab as "not a live chip" so its behaviour is unchanged.**
- [ ] **Step 4: Run** `bunx vitest run tests/deep-links.test.ts tests/brief-panel*.test.tsx` → PASS.
- [ ] **Step 5: Commit** `feat(links): the deep-link resolver reads aircraft and Fleet addresses`

---

### Task 3: Follow a link in place, and the link components

**Files:**
- Create: `src/app/state/follow-link.ts`, `src/app/features/link-style.ts`, `src/app/features/DashLink.tsx`, `src/app/features/EntityLinks.tsx`
- Modify: `src/app/state/ui.tsx` (one new field), `src/app/features/FlightLink.tsx` (takes its classes from `link-style.ts`, gains `tone`), `src/app/features/BriefPanel.tsx` (its `useFollow` calls the shared hook, then closes the sheet)
- Test: `tests/dash-link.test.tsx`, `tests/entity-links.test.tsx`

**Interfaces:**
- Consumes: Task 1 rules, Task 2 `resolveDeepLink` / `DeepLinkIntent`, `useUi()` (`setTab`, `openAircraft`), `useSchedule().setCurrent({ hub })`.
- Produces:
  - `ui.tsx`: `fleetLink: { filter: string | null; view: FleetDeepLinks['view']; seq: number } | null` and `followFleetLink(link: FleetDeepLinks): void` (increments `seq`, so the same link clicked twice applies twice)
  - `useFollowDeepLink(): (intent: DeepLinkIntent) => void` — order: schedule hub, fleet link, tab (with scroll target), aircraft dialog last
  - `link-style.ts`: `LINK_HIT` (the three `HIT` strings moved out of `FlightLink.tsx` unchanged) and `LINK_TONE = { identity: 'text-primary underline-offset-2 hover:underline', quiet: 'text-inherit underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-current focus-visible:decoration-current' }`
  - `dashLinkClick(follow: (intent: DeepLinkIntent) => void, href: string): (event: MouseEvent<HTMLAnchorElement>) => void` in `DashLink.tsx` — a plain function (not a hook, so a list can build one per item): on an unmodified primary click, when `resolveDeepLink(href)` is non-null, `preventDefault()` and `follow` it
  - `DashLink({ href, tone = 'quiet', hit = 'box', className, title, children, ...data })` — an `<a>` whose `onClick` is `dashLinkClick(useFollowDeepLink(), href)`
  - `FlightLink` gains `tone?: 'identity' | 'quiet'` (default `'identity'`, so every existing caller is unchanged)
  - `EntityLinks.tsx`:
    - `TailLink({ reg, tone = 'identity', hit, className, children })` — `DashLink` to `tailLink(reg).href`, or a `<span>`
    - `HubLink({ code, tone = 'quiet', hit, className })` — `DashLink` to `hubLink(code, 'dashboard').href`, or a `<span>`
    - `TypeLink({ typeCode, tone = 'quiet', hit, className, children })` — `DashLink` to `fleetTypeLink(typeCode, 'dashboard').href`, or a `<span>`; `children` is what prints (the row's own type text), `typeCode` decides the link
    - each takes `finePointerOnly?: boolean`: when true the link carries `pointer-coarse:pointer-events-none pointer-coarse:no-underline pointer-coarse:text-inherit` and `tabIndex` is left alone (a keyboard on a touch device can still reach it)

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/dash-link.test.tsx — render inside the app's real providers (copy the wrapper the
// existing tests/starlink-panels.test.tsx uses)
it('follows a dashboard address in place', async () => {
  // click <DashLink href="/?aircraft=N78501">, expect: default prevented, useUi().aircraftReg === 'N78501', tab unchanged
});
it('switches tab and board for a hub address', async () => {
  // click href="/?tab=schedule&hub=ORD": tab === 'schedule', useSchedule().current.hub === 'ORD'
});
it('queues a Fleet link and bumps seq on a repeat click', async () => {
  // click href="/?tab=fleet&type=A319" twice: fleetLink.filter === 'A319', seq 1 then 2, tab === 'fleet'
});
it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
  'leaves a modified click to the browser (%o)', (init) => {
    // fireEvent.click(link, init): defaultPrevented === false, state untouched
  });
it('does not intercept an address outside the dashboard', () => {
  // href="/hubs/ord": click is not prevented
});

// tests/entity-links.test.tsx
// TailLink reg="N78501" → <a href="/?aircraft=N78501"> with text-primary; reg="JA873A" → <span>, no text-primary, no underline
// HubLink code="ORD" → <a href="/?tab=schedule&hub=ORD"> without text-primary; code="LHR" → <span>
// TypeLink typeCode="737-900ER" children "737-900" → <a href="/?tab=fleet&type=737-900ER"> printing "737-900"
// TypeLink typeCode={null} children "ERJ-175" → <span>ERJ-175</span>
// FlightLink ident="UA576" tone="quiet" → <a> without text-primary; default tone keeps text-primary (existing tests still pass)
```

Write each comment line out as real assertions in the file's existing style.

- [ ] **Step 2: Run and see them fail.** `bunx vitest run tests/dash-link.test.tsx tests/entity-links.test.tsx`
- [ ] **Step 3: Implement to the interfaces above.**
- [ ] **Step 4: Run** the Step 2 command plus `tests/flight-link.test.ts tests/schedule-table.test.tsx tests/starlink-panels.test.tsx` → PASS.
- [ ] **Step 5: Commit** `feat(links): a dashboard link follows its address without a reload`

---

### Task 4: The Fleet tab takes a link, and the two doors

**Files:**
- Modify: `src/app/views/FleetView.tsx`, `src/app/views/ScheduleView.tsx` (or the header component it renders), `src/app/shell/HubHealthStrip.tsx`, and the `src/lib` helper that words the hub chip (find it from `hubChipNoFigure`)
- Test: `tests/fleet-view-link.test.tsx`, extend the existing Schedule view and hub strip tests

**Interfaces:**
- Consumes: `useUi().fleetLink`, `resolveFleetDeepLinkFilter` (already used at `FleetView.tsx:332`), `hubLink`, `fleetTypeLink`, `DashLink`.
- Produces: nothing later tasks call.

Behaviour:
- `FleetView` applies `fleetLink` whenever its `seq` changes and the fleet database has loaded, through the same `resolveFleetDeepLinkFilter` path as the cold-load effect: a known type sets the type filter and clears the status filter, an unknown value is ignored, a `view` sets the sub-view. A link that arrives before the database is held and applied when it loads.
- **Door 1.** The Schedule board's header, beside the hub name, gains one quiet link: text `<HUB> hub guide`, `href` `/hubs/<code>`, a plain `<a>` (it leaves the dashboard).
- **Door 2.** When exactly one aircraft type is selected in the Fleet tab and `fleetTypeLink(type, 'site')` is non-null, the filter summary gains one quiet link: text `About the <type>`, `href` `/fleet/<slug>`.
- **Hub strip.** Each chip's `href` becomes `hubLink(hub, 'dashboard').href`, and its `onClick` is `dashLinkClick(follow, href)` with `follow` from one `useFollowDeepLink()` call at the top of the strip (the chip keeps its own element, classes and sizes). Tooltip and screen-reader words change from "hub guide" to "today's board": tooltip `United at ORD · today's board`. The no-figure reason text is unchanged.

- [ ] **Step 1: Write the failing tests**
  - `fleet-view-link`: with a loaded database, `followFleetLink({ filter: 'A319', view: null })` filters the table to A319 rows; `{ filter: 'B789', view: null }` leaves it unfiltered; the same link twice after the user cleared the filter applies again; a link queued before the database loads applies after it loads.
  - Schedule: the header shows a link named `ORD hub guide` with `href="/hubs/ord"` when the board is ORD.
  - Fleet: selecting `737 MAX 9` shows a link `About the 737 MAX 9` to `/fleet/737-max-9`; no type selected, or a status filter only, shows none.
  - Hub strip: each chip is `href="/?tab=schedule&hub=<HUB>"`; clicking it sets the Schedule hub and tab without navigating; its accessible name contains the hub, its figure and "today's board".
  - Equivalence (the spec's third guard), in `tests/deep-link-equivalence.test.tsx`: for `/?tab=schedule&hub=DEN`, `/?tab=fleet&type=A319` and `/?tab=fleet&view=special`, mounting the dashboard providers cold on that address (through `useDeepLinks` and the Fleet view's own reader) and clicking a `DashLink` to the same address from another tab end with the same tab, Schedule hub, Fleet type filter and sub-view. For `/?aircraft=N78501` both open the dialog for N78501; the tab is the one stated difference (cold: the default tab; in place: the tab you were on).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three test files and `tests/hub-health*.test.*` → PASS.
- [ ] **Step 5: Commit** `feat(links): the Fleet tab follows a link; hub chips open today's board; one door each to the hub and fleet guides`

---

### Task 5: The Starlink tab's tables

**Files:**
- Modify: `src/lib/starlink-utils.js` (`buildDeparturesBoard` keeps each flight's `airline` on the row), `src/app/views/starlink/DeparturesBoard.tsx`, `RosterTable.tsx`, `VerificationLedger.tsx`, `SlHero.tsx`, `src/app/views/StarlinkView.tsx`
- Test: `tests/starlink-departures-board.test.js`, `tests/starlink-panels.test.tsx` (extend both)

**Interfaces:**
- Consumes: `unitedNumber`, `fleetTypeCodeForTail`, `FlightLink`, `TailLink`, `HubLink`, `TypeLink`; the fleet database index the view already builds (`fleetByReg`).
- Produces: `BoardRow.airline: string`; `SlHero` props `onShowFleet?: (fleet: 'Mainline' | 'Express') => void` and `onShowNew?: () => void`.

What each surface prints (inventory rows in brackets):

| Surface | Thing | Becomes |
|---|---|---|
| Departures board | flight number (`:68`) | `FlightLink ident={unitedNumber(row.flight_number, row) ?? row.flight_number}`, identity tone; the text printed is that same value, so an Express row reads `UA5415` |
| Departures board | "inbound on UA3508" (`:106`) | the number is a `FlightLink`, quiet, `z-10` |
| Departures board | origin (`:81`) | `HubLink`, quiet, `finePointerOnly`, `z-10`; destination stays plain unless it is a hub, then the same |
| Departures board | type (`:88`) | `TypeLink typeCode={fleetTypeCodeForTail(row.tail, fleetByReg)}` printing `row.type`, quiet, `finePointerOnly` |
| Roster row | Next Flight number (`:308`) | `FlightLink`, quiet, with `unitedNumber` applied (the roster's flights carry `airline` too) |
| Roster row | Type cell | `TypeLink` by tail, quiet |
| Roster expansion | Upcoming Flights numbers (`:124`) | `FlightLink`, identity (each line is about that flight), with `unitedNumber` |
| Roster expansion | Airframe | `TypeLink` by tail, quiet |
| Roster expansion | upcoming origin / destination | `HubLink`, quiet, when a hub |
| Verification ledger | tail (`:130`) | `TailLink`, identity |
| Hero | Mainline and Express bars | each row is a `<button>` that calls `onShowFleet`, which sets the roster's fleet filter and scrolls the roster into view; accessible name `Show Mainline aircraft in the roster below` |
| Hero | "+N NEW THIS WEEK" chip | a `<button>` calling `onShowNew` (turns the roster's "New this week" on and scrolls to it); same chip classes as the airborne button |
| Industry strip, operator cells, non-hub airports, regional types | — | unchanged, plain |

The roster's tail stays the disclosure button it is. On a coarse pointer the departures row keeps opening the aircraft dialog; only the flight number sits above it.

- [ ] **Step 1: Write the failing tests**

```js
// tests/starlink-departures-board.test.js
it('keeps the airline on each row', () => expect(board.rows[0].airline).toBe('UA'));
```

```tsx
// tests/starlink-panels.test.tsx — fixtures: a SkyWest row {flight_number:'SKW5415', airline:'UA', origin:'ORD', destination:'DSM', tail:'N638SY', type:'ERJ-175'},
// a mainline row {flight_number:'UA576', origin:'DEN', destination:'LHR', tail:'N75436', type:'737-900'} with fleetByReg {N75436:{t:'737-900ER'}}
// - the SkyWest row prints "UA5415" as <a href="/flight/UA5415">; "SKW5415" appears nowhere in the row
// - a row with airline '' and flight_number 'SKW5415' prints "SKW5415" as plain text
// - ORD and DEN are <a href="/?tab=schedule&hub=ORD|DEN"> without text-primary; DSM and LHR are plain text
// - the mainline type prints "737-900" and links to /?tab=fleet&type=737-900ER; "ERJ-175" is plain
// - each row has exactly one element with text-primary (the flight number)
// - "inbound on UA3508": UA3508 is <a href="/flight/UA3508">
// - roster: next-flight number is a link without text-primary; expansion numbers are links
// - ledger: tail N12345 is <a href="/?aircraft=N12345">; clicking it opens the dialog without navigating
// - hero: clicking the Mainline bar calls onShowFleet('Mainline'); the chip calls onShowNew; neither is an <a>
// - no <a> is a descendant of a <button> anywhere in the rendered tab
```

- [ ] **Step 2: Run and see them fail.** `bunx vitest run tests/starlink-departures-board.test.js tests/starlink-panels.test.tsx`
- [ ] **Step 3: Implement.** In `StarlinkView.tsx`, `onShowFleet` and `onShowNew` reuse `onFleet` / `onNewOnly` and scroll the roster section with the same `scrollBehavior()` the ledger jump uses.
- [ ] **Step 4: Run** the Step 2 command plus `tests/starlink-*.test.*` → PASS.
- [ ] **Step 5: Commit** `feat(starlink): flights, tails, hubs and types in the Starlink tab link to their homes`

---

### Task 6: Guards

**Files:**
- Modify: `tests/design-guards.test.js`, `scripts/ui-audit.mjs`
- Create: `src/lib/link-guard.js`, `tests/link-guard.test.js`

**Interfaces:**
- Produces: `findUnlinkedNames(rows: Array<{ text: string, linked: boolean, where: string }>, known: { hubs: string[], tails: Set<string> }, allow: Array<{ where: RegExp, reason: string }>): Array<{ text: string, kind: 'flight' | 'tail' | 'hub', where: string }>` and `LINK_GUARD_TABS = ['starlink']` (parts 2 and 3 add to it).

- [ ] **Step 1: Write the failing tests**
  - `link-guard`: `UA576` unlinked → reported as `flight`; linked → not; `N78501` unlinked and in `tails` → `tail`; `ORD` unlinked → `hub`; `LHR`, `SKW5415`, `UA` and `N78501` when not in `tails` → not reported; an allowlisted `where` → not reported, and an allowlist entry with an empty `reason` throws.
  - `design-guards`: in `src/app/views/starlink/*.tsx` and `StarlinkView.tsx`, no JSX element other than `a`, `button`, `DashLink`, `FlightLink`, `TailLink`, `HubLink`, `TypeLink`, `Button` carries a `text-primary` or bare `underline` class, except lines on an allowlist that states a reason per entry.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement `link-guard.js`; in `ui-audit.mjs`, for each tab in `LINK_GUARD_TABS` at each of its viewports, collect the text nodes inside table rows and list items with whether an `a` or `button` ancestor exists, run `findUnlinkedNames`, and count each result as a violation.** The allowlist starts with the two coarse-pointer cases this plan creates (departures-row hub and type on touch viewports), each with its reason.
- [ ] **Step 4: Run** `bunx vitest run tests/link-guard.test.js tests/design-guards.test.js` → PASS, then after a build `node scripts/ui-audit.mjs` → 0 violations.
- [ ] **Step 5: Commit** `test(links): a name in a Starlink table that is not a link fails the audit`

---

### Task 7: Records and release

**Files:** `DESIGN.md`, `CHANGELOG.md`, `package.json`, `MAINTENANCE.md` (if it describes `ui-audit` checks)

- [ ] **Step 1:** `DESIGN.md` component table: replace the "Flight number" row's rule text with the United-row exception; add rows for Tail, Hub code, Aircraft type and "A count that filters" naming their files. Decisions, dated 2026-11-12: (a) the rule "a name goes to its home on the side you are on", with the owner's words; (b) Express numbers print and link as United numbers on United rows, reversing 2026-11-11, with the sample; (c) hub chips open today's board, the hub guide is one link in the Schedule header; (d) one link-coloured link per row, the rest quiet.
- [ ] **Step 2:** `CHANGELOG.md` entry and version `1.29.0` in the file's existing voice (if `fix/starlink-express-scope-alaska-row` took 1.28.2, this follows it).
- [ ] **Step 3:** Run every gate in the order under Global Constraints. Expected: build clean, all tests pass, typecheck clean, ui-audit 0 violations and 0 tab errors.
- [ ] **Step 4: Commit** `release: v1.29.0, names in the Starlink tab link to their homes`
- [ ] **Step 5: Report** to the orchestrator: commits, test count, ui-audit result, every place the code differed from this plan and why, anything unverified (in particular: the aircraft dialog's content for an Express tail, and the links on a real touch device).
