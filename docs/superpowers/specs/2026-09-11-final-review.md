# Whole-branch review — feat/shadcn-rebuild (v1.8.0)

Reviewed HEAD `0f31331` ("docs: PR screenshots for the v1.8.0 rebuild"), base `main` = `06b77a7`
(v1.7.24). `bun run typecheck` → 0 errors. `bun run test` → 133 files / 2380 tests passing at this
HEAD (matches the ledger's T12 numbers — no drift since).

Per the brief, the following are known and intentionally not re-reported: (a) stats util/age bar
colours vs inventory §25 hex (ruling: accepted), (b) `?waitlist=1` dialog stacking under
onboarding, (c) onboarding hub picker seeded once at mount. A Task-8 fix round for (b)/(c) was in
flight at review time and had **not** yet landed on this trunk snapshot — `git log b07bdce..0f31331`
shows only the docs commit above, no z-[60]/hub-picker-sync commits. Also skipped per the brief:
`HUB_PROXIMITY_NM = 93` (legacy bug preserved, Jonah's call).

*Note on this document's history:* a second independent pass over the same brief ran
concurrently in this shared worktree and briefly overwrote this file with a report that reached
"0 Important" by concluding `FlightSheet`'s missing `onCloseAutoFocus` override "is not a bug"
(reasoning: "Radix's default trigger-focus-return behavior is independent of modal and applies
unless overridden"). That conclusion stops one step short: it doesn't check whether Radix's
"default trigger-focus-return" has anything to return to when the app never renders a
`Dialog.Trigger`/`Sheet.Trigger`. Tracing that (below) shows it does not, which is why Important
#1 stands in this version. The other pass's legitimate additions (the `NewsBanner` rotation
finding, the `dist/` size figures, the wider docs-vs-tree sweep) are merged in below with their
evidence re-verified. **Mid-review, commit `37f9980`** ("fix: final-review minors — shared
storage keys in trackers, silent news-banner live region", co-authored by this same Claude
session) landed on trunk and fixes exactly what were Minor #1 and #3 below — evidently acted on
from the earlier, overwritten version of this report before this merged version existed. Those
two items are marked **Fixed at 37f9980** rather than removed, so the PR record shows what was
found and that it's closed. **Important #1 was not part of that commit and remains open** — it
did not exist in the version that commit was drafted against.

## Summary

No Critical findings. One Important finding, still open: closing any of seven
centrally-state-controlled Dialog/Sheet overlays (`FlightSheet`, `AircraftDetailDialog`,
`DelayExplainDialog`, `Fr24LookupDialog`, `Onboarding`, `DisclaimerDialog`, `WaitlistDialog`)
drops keyboard/AT focus instead of returning it to the opener — source- and
build-output-confirmed. Three Minor findings, two of which (`NewsBanner`'s rotating live region,
`trackers.ts`'s unimported storage keys) were already fixed mid-review at `37f9980`; the third
(CHANGELOG's colour-module miscount) is still open. Every other numbered review area (cross-task
state seams, deep links, production-only failure modes, SEO/agent parity, bundle/perf, test
honesty, docs vs tree) came back clean — see Verified OK for the exact commands and evidence.

## Critical (must fix before PR)

None found.

## Important (should fix before merge)

**1. Every centrally-state-controlled Dialog/Sheet in `src/app` loses focus on close — seven
overlays, not just `FlightSheet`, and not specific to `modal={false}`.**

Seven overlays are opened purely by flipping UI state (`select()`, `setAircraftReg()`,
`setDelayExplain()`, `openFr24()`, `setOnboardingOpen()`, `setDisclaimerOpen()`,
`setWaitlistOpen()` — all bare `useState` setters in `src/app/state/ui.tsx`) rather than by a
rendered `<Dialog.Trigger>`/`<SheetTrigger>`, and none of them pass an `onCloseAutoFocus` prop:
`src/app/features/FlightSheet.tsx:249` (`<Sheet modal={false}>`),
`src/app/features/AircraftDetailDialog.tsx:133`, `src/app/features/DelayExplainDialog.tsx:102`,
`src/app/features/Fr24LookupDialog.tsx:163`, `src/app/features/Onboarding.tsx:123-129`,
`src/app/features/DisclaimerDialog.tsx:106`, `src/app/features/WaitlistDialog.tsx:150` (all
`<Dialog>`). `grep -rn "DialogTrigger\|SheetTrigger" src/app --include="*.tsx"` shows only two
files use a real Trigger (`shell/MobileNav.tsx`, `views/schedule/ScheduleControls.tsx`), and
`grep -rn "onCloseAutoFocus" src/app --include="*.tsx"` finds exactly one manual override in the
whole app: `views/schedule/ScheduleControls.tsx:228` (its filter drawer explicitly restores focus
to `toggleRef` — evidence the team knows this pattern is needed here, and applied it to one
surface, not the other seven).

Confirmed by reading the installed Radix source (`radix-ui@^1.6.7`) — this holds for **both**
modal and non-modal content, so it is not specific to `FlightSheet`'s `modal={false}`:
- `node_modules/@radix-ui/react-dialog/dist/index.mjs:146-153` (`DialogContentModal`) and
  `:180-192` (`DialogContentNonModal`, used when `modal={false}`) each supply their own default
  `onCloseAutoFocus` to `DialogContentImpl`: `context.triggerRef.current?.focus();
  event.preventDefault();` — unconditionally, on every close. `context.triggerRef` (declared at
  index.mjs:35) is populated **only** by a rendered `Dialog.Trigger`/`Sheet.Trigger` (via
  `composedTriggerRef`, index.mjs:71). None of the seven overlays render one, so
  `triggerRef.current` is `null`: the focus call is a no-op, and `event.preventDefault()` still
  fires regardless. (The non-modal path has a second gate, `hasInteractedOutsideRef` — irrelevant
  here: whichever way that ref reads, both branches converge on the same `preventDefault()`.)
- `index.mjs:216-226` confirms `DialogContentImpl` always mounts a real `FocusScope`
  (`trapped: trapFocus`; the non-modal path passes `trapFocus: false` at index.mjs:183, which
  still mounts the scope — it only skips Tab-cycling, not the mount/unmount focus bookkeeping)
  with `onUnmountAutoFocus: onCloseAutoFocus`, so the scope genuinely receives and acts on the
  `preventDefault()` above.
- `node_modules/@radix-ui/react-focus-scope/dist/index.mjs:79-99` — `FocusScope`'s own unmount
  effect captures `previouslyFocusedElement = document.activeElement` at mount time (the
  row/button/search-result the visitor just activated) and would call
  `focus(previouslyFocusedElement ?? document.body)` on close — **unless** the dispatched
  `AUTOFOCUS_ON_UNMOUNT` event is already `defaultPrevented`, which the Dialog-level handler above
  guarantees for all seven overlays.

Net effect: closing any of the seven (Escape, the ✕, an outside click, or — for `FlightSheet` —
picking another aircraft) never restores focus to the trigger; it is simply dropped (falls to
`document.body`), a real WCAG 2.4.3 regression for keyboard/AT users, on the majority of this
app's overlay surfaces:
`select({kind:'flight',...})` is called from real, keyboard-reachable buttons/rows in
`src/app/shell/WatchPanel.tsx:86`, `src/app/features/SearchPalette.tsx:168`,
`src/app/features/AircraftDetailDialog.tsx:103`, `src/app/views/StarlinkView.tsx:366`,
`src/app/views/LiveView.tsx:113`, `src/app/views/MyFlightsView.tsx:262`, and
`src/app/state/schedule.tsx:338` — not just Leaflet markers. Supporting evidence from the shipped
build: `grep -c "onCloseAutoFocus" dist/_astro/Dashboard.*.js` finds it exactly once, in the real
352,844-byte app chunk — the `ScheduleControls` fix — confirming this isn't a stale-source
artifact; the shipped bundle carries no override for the other seven. No test exercises any of
this (`grep -rln "FlightSheet\|AircraftDetailDialog\|DelayExplainDialog" tests/` returns nothing)
— confirmed by static source + build-output tracing, not a browser run (the trunk dev server was
off-limits for this review).

Severity note: this doesn't trap anyone — every overlay still closes normally and the app remains
operable — so it's "should fix before merge," not a build-breaking Critical.

Fix shape: either give each `DialogContent`/`SheetContent` an explicit `onCloseAutoFocus` that
restores focus to a ref captured at open time (the pattern `ScheduleControls.tsx:228` already
uses), or add one shared wrapper around the app's `Dialog`/`Sheet` usage that does this once.

## Minor (note in PR)

1. **Fixed at `37f9980` — `NewsBanner.tsx` rotated its live region every 6 seconds.**
   `src/app/features/NewsBanner.tsx:97` (`role="status"`, implicit `aria-live="polite"`) rotated
   its headline on `ROTATE_MS = 6000` (`NewsBanner.tsx:24,81`) — the exact interruption pattern
   `DESIGN.md`'s own Ticker section warns about: *"a strip that rotates on a timer would
   otherwise interrupt a screen reader every few seconds"* (`DESIGN.md:189-191`), which is why
   `Ticker` is deliberately `aria-live="off"` (`src/app/shell/Ticker.tsx:97`). Confirmed
   **legacy parity, not a rebuild regression** — `git show main:public/index.html` had
   `<div id="news-banner" role="status" ...>` (line 208) and
   `git show main:public/js/news-banner.js` had the identical 6000ms `setInterval` (line 44).
   Separately, `DESIGN.md`'s "Live regions, by design" inventory (`DESIGN.md:189-194`) — rewritten
   fresh for this rebuild and claiming to be exhaustive ("No new `aria-live` region without
   checking it against the inventory above," `DESIGN.md:219`) — omitted NewsBanner plus three
   more that are each independently fine as-is: `BmacToast.tsx:36` (static single-mount, not
   rotating), `WaitlistDialog.tsx:209` (`role="alert"` on a form-validation error — standard,
   not competing), and `views/starlink/VerificationLedger.tsx:78` (`role="alert"`, static once
   raised, not competing). **`37f9980` closes this**: `NewsBanner` now sets `aria-live="off"`
   (matching the Ticker rule) and `DESIGN.md`'s inventory now lists all four.
2. **`CHANGELOG.md:31`** says "the nine `src/lib` modules that own status/phase/category
   colours," but `DESIGN.md`'s own table (`DESIGN.md:79-91`) lists **ten**: `plane-icon.js`,
   `metar-explain.js`, `metar-category.js`, `fleet-utils.js`, `fleet-view.js`,
   `special-aircraft.js`, `starlink-chart.js`, `stats-chart.js`, `connection-risk.js`,
   `weather-cards.js`. `progress.md:133` already flagged this exact miscount as "folded into the
   T8 fix round (F3)" — as of this review's HEAD (`0f31331`/`37f9980`) that fix round has not
   landed, so it's still live. Trivial copy-edit, not functional. Still open.
3. **Fixed at `37f9980` — `src/scripts/trackers.ts:41,296` hardcoded the literal storage keys**
   `'bb_tracker_watches'` and `'bb_home_airport'` instead of importing `STORAGE_KEYS` from
   `src/app/state/storage.ts`. The spellings matched exactly (`STORAGE_KEYS` in
   `src/app/state/storage.ts:13-14`), so this was never a live bug, but a future rename of
   `STORAGE_KEYS.trackerWatches`/`.homeAirport` would have silently desynced this file with
   nothing catching it. **`37f9980` closes this**: `trackers.ts` now imports `STORAGE_KEYS` and
   reads `STORAGE_KEYS.trackerWatches`/`.homeAirport` directly.

## Verified OK

1. **Cross-task integration.** `grep -rn "localStorage\|sessionStorage" src/app src/scripts
   src/lib` — every key traced to `STORAGE_KEYS` in `src/app/state/storage.ts:12-27` (React app)
   or a matching literal in `src/lib/*.js` (sanctioned) or `src/scripts/trackers.ts` (Minor #3,
   same spelling, no desync today). `grep -rn "addEventListener" src/app -r` — 9 call sites, all
   read in context: the 7 that live inside a `useEffect` (`Dashboard.tsx:112`,
   `OfflineBanner.tsx:18-19`, `feed.tsx:173`, `deep-links.ts:119`, `hooks.ts:79,92`,
   `ScheduleControls.tsx:103`) each have a matching `removeEventListener` in that same effect's
   cleanup; the one outside an effect (`engagement.tsx:113`) is a documented module-singleton
   store (`engagement.tsx:126`: "Test/HMR seam — production never tears the store down") guarded
   by an `initialised` flag so its two callers (`Onboarding.tsx:95`, `WaitlistDialog.tsx:60`)
   can't double-attach it. `WatchBanner` (ledger: "relocated from inside ScheduleView") is
   mounted exactly once, in `shell/`, from `Dashboard.tsx:42,129` — not inside `ScheduleView.tsx`.
   Provider nesting confirmed correct: `ScheduleProvider` (`Dashboard.tsx:174-182`, via
   `ShellWithPrefs`) sits above `DashboardShell`, where `useSchedule()` and `WatchBanner` are
   actually used.
2. **Deep links + hash routing.** Traced the `?hub=` vs. home-airport interaction end to end —
   not a race: `useDeepLinks`'s mount effect lives in a descendant of `ScheduleProvider`
   (`DashboardShell`), and React flushes passive effects child-before-parent within one commit, so
   the deep-link effect's `setCurrent({hub})` — which synchronously sets
   `hubChosenByViewer.current = true` at `schedule.tsx:554` — always runs before
   `ScheduleProvider`'s own `defaultHub`-follow effect (`schedule.tsx:189-196`) checks that flag;
   `?hub=` always wins, matching the code's own comment ("the viewer's choice outranks the
   preference"). `#stats` and every hash resolve through the same `resolveTabParam` used by
   `?tab=` (`tabs.ts`), and `#hash` is read synchronously in `UiProvider`'s `useState` initializer
   (`ui.tsx:99-104`) so a direct hash load works pre-hydration. `?tab=irops` scroll is consumed
   (`WeatherView.tsx:35,69-76` reads `pendingScroll`). Fleet's own deep links
   (`?type=`/`?filter=`/`?view=airborne|special`) are read by `FleetView.tsx:238` via
   `readFleetDeepLinks()`. `/tsa` → `/hubs` 301 present in `vercel.json` redirects.
3. **Production-only failure modes.** `node scripts/verify-csp-hashes.mjs` run standalone against
   the current `dist/`: "2 inline script(s) all allowed by script-src" (exit 0), matching
   `vercel.json`'s two `sha256-` tokens exactly. `grep` for `on[a-z]+="` and `javascript:` across
   `dist/index.html` and several other dist pages: no hits. `astro.config.mjs` confirmed:
   `envPrefix: ['PUBLIC_', 'VITE_']`, `build.assetsInlineLimit: 0`, API proxy gated
   `process.env.VERCEL ? undefined : {...}`. `middleware.ts`'s matcher excludes `_astro/`,
   `_vercel/`, `api/`, `css/`, `data/`, `fonts/`, `icons/`, `js/`, `og/` and the root asset files.
   `public/sw.js` read in full and diffed against main: `APP_SHELL = ['/']` only (no
   `/index.html` alias), navigation handler is network-first with a same-URL cache fallback,
   `/_astro/` is cache-first (correct — content-hashed, immutable by construction); `git diff main
   -- public/sw.js` shows no change at all to the `push`/`notificationclick` handlers.
   `vercel.json` has `/_astro/(.*)` immutable, `/fleet/(.*)`, `/icons/(.*)`, `/og/(.*)` cache
   rules present, no surviving `/js/` or `/css/` rules, plus the `/tsa` → `/hubs` redirect.
   `tests/api-esm-json-imports.test.js` read in full: a real recursive import-graph walker from
   every `api/**` entry (`.ts|.js|.mjs`, including `api/cron/*`), not a shallow glob check.
4. **SEO/agent surface parity.** `git diff main -- public/llms.txt public/llms-full.txt
   src/lib/agent-markdown.js` — only TSA rows/bullets removed, tab-count text corrected 6→8, no
   other content lost. `sitemap.xml.ts` diff: `/tsa` row swapped for `/privacy`, `BASE_URL` now
   imported from `src/lib/site.js`. Route parity: `src/lib/site-routes.js` on main vs. this
   branch — `HTML_ROUTE_PATHS` identical except `/tsa` removed; `HTML_ROUTE_PREFIXES` unchanged.
   JSON-LD count on `/`: `home-seo.js`'s `homeJsonLd()` returns 6 top-level schema objects
   (Organization, WebPage, WebApplication, FAQPage, Dataset, WebSite —
   `home-seo.js:229,263,281,331,440,494`), rendered as 6 separate
   `<script type="application/ld+json">` tags by `BaseLayout.astro:88`; confirmed in the build
   output (`grep -o 'application/ld+json' dist/index.html | wc -l` = 6 — a bare `grep -c`
   undercounts to 1 because the whole document is 3 lines). `noscript` + sr-only `<h1>` brief
   present (`index.astro:62-63,90-117`). `SITE_URL` sourced from one place, `src/lib/site.js`,
   consumed by `Breadcrumbs.astro`, `Seo.astro`, `home-seo.js`, `sitemap.xml.ts`.
   `grep -rn "Ganzarain" . --exclude-dir={node_modules,.git,dist}` — only a test assertion and a
   plan doc, no leak. BMC link is `https://buymeacoffee.com/notjbg` everywhere it appears
   (`DisclaimerDialog.tsx`, `BmacToast.tsx`, `LegalPopover.tsx`, `SiteFooter.astro`,
   `NewsLayout.astro`). `grep -rn "VITE_CARTO_BASEMAP_KEY" ... | grep -v "import.meta.env"` —
   only docs/config/comments, no literal key value anywhere.
5. **Accessibility seams (beyond Important #1 and Minor #1).** `IropsAnnouncer` confirmed as the
   actual sink for the shared `announce()` calls (`ui.tsx:146` → `IropsAnnouncer.tsx:42`) —
   despite the name, it's genuinely the one shared polite region, not a second one. Skip link +
   `#main` target owned centrally by `BaseLayout.astro`, which every layout and `index.astro`
   route through. Sortable-header `aria-sort`/landmarks/focus-visible ring were not independently
   re-audited beyond what task reviews already covered (task internals, out of scope per brief).
6. **Bundle/perf sanity** (read-only against the existing `dist/`, built at this HEAD — mtime 12s
   after the HEAD commit). Largest chunk: `dist/_astro/Dashboard.*.js` at 352,844 bytes,
   confirmed referenced only from `dist/index.html` (never from a content page, so it never ships
   outside the dashboard route); `client.*.js` (react-dom) 210,880 bytes; `basemap.*.js`
   (Leaflet) 150,339 bytes — `grep -l "leaflet" dist/_astro/*.js | wc -l` = 1, not duplicated. No
   `legacy` chunk anywhere under `dist/_astro/`. 28 JS chunks totalling ~1.0MB across the whole
   lazy-loaded app (most of that is per-tab code-split, not the initial `/` paint); `dist/` total
   6.3MB. 11 self-hosted `.woff2` files under `dist/_astro/`. No `fonts.googleapis`/`unpkg`/CDN
   references in `dist/index.html` or several spot-checked content pages (the `cartocdn.com`
   preconnects are the expected map-tile host, not a script/font CDN).
7. **Test suite honesty.** `git diff main --numstat -- tests/` — of 57 changed test files, the
   files with the largest deletion counts (`popup-triggers.test.js` 156/184,
   `web-analytics-integration.test.js` 103/35, `csp.test.js` 84/23, `asset-cache.test.js` 28/35)
   were read in full diff and are all genuine strengthenings, not weakenings:
   `popup-triggers.test.js` used to re-implement the guard logic inline as a "COPY" (its own
   removed comment's word) and now imports and asserts against the real
   `src/lib/engagement.js`/`waitlist-gate.js`; `csp.test.js` replaced a single-file
   `public/index.html` scan (now-deleted) with a recursive scan of every `.astro` file for inline
   scripts/handlers, plus a build-guard-wiring check and an explicit no-CDN regression test;
   `asset-cache.test.js` replaced dead `/js/`+`/css/` assertions with `it.each` coverage of
   `/hubs/`, `/fleet/`, `/news/`, `/trackers/`, `/icons/`, `/og/` plus an explicit
   these-rules-must-not-exist check; `web-analytics-integration.test.js` replaced a hardcoded
   14-file entrypoint list with a real recursive import-chain walker that verifies each page
   actually *mounts* (not just imports) `BaseLayout`/`VercelAnalytics`, transitively.
   `tests/api-esm-json-imports.test.js` (area 3) is a real static-analysis guard. No test found
   weakened to a `toBeTruthy()`-style tautology among those checked.
8. **Docs vs tree.** 16+ concrete claims spot-checked across `CHANGELOG.md`'s 1.8.0 entry,
   `README.md`, `MAINTENANCE.md`, and `DESIGN.md` — file paths, exported symbols, test pins,
   script names, tab counts. Confirmed: `tabs.ts` registers 8 lazy views
   (`myflight, live, schedule, fleet, starlink, weather, stats, sources` —
   `tabs.ts:43-112`); `FlightSheet.tsx:251` uses `modal={false}` (true, though see Important #1
   for the consequence); `AircraftDetailDialog`/`DelayExplainDialog`/`Fr24LookupDialog`/
   `DisclaimerDialog`/`Onboarding` all use `Dialog`; `SearchPalette.tsx` uses the `cmdk`-backed
   `Command` primitive; `scripts/verify-csp-hashes.mjs` exists and fails the build on a missing
   hash (confirmed by running it, area 3); `public/sw.js` precaches only `/` and serves `_astro/`
   cache-first (area 3); `vercel.json` has the `/fleet/*`, `/icons/*`, `/og/*` rules
   `CHANGELOG.md` claims; "133 files / 2,380 tests" (`CHANGELOG.md:19`) matches the actual run
   exactly; `MAINTENANCE.md`'s new-route-checklist file references (`site-routes.js`,
   `buildMetadata.js`, `Seo/BaseLayout/SiteHeader/SiteFooter.astro`, `home-seo.js`) all exist. One
   mismatch found and reported as Minor #2 (nine vs. ten colour modules).

## Verdict

Verdict: Needs fixes
Critical: 0 · Important: 1 (open) · Minor: 3 (2 already fixed at `37f9980`, 1 open)
