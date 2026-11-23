# TODOS

Open work, checked against the code on 2026-11-10. Each entry names the file it concerns.

## Compliance

- [ ] **Starlink data terms.** Six server routes use the unitedstarlinktracker.com API:
  `api/cron/sync-starlink.ts` and `api/starlink-data.ts` (`/api/data`), `api/check-flight.ts`,
  `api/predict-flight.ts`, `api/fleet-summary.ts` and `api/starlink-mismatches.ts`. The data is
  credited on the Sources and Starlink tabs and on `/fleet`. Confirm the maintainer's terms for
  this use (@martinamps) and record the answer in `docs/`.
- [ ] **FR24 live feed terms.** `/api/fr24-feed` reads FR24's public live feed
  (`src/lib/united-feed.js`); flight lookup and aircraft history use the FR24 API
  (`api/fr24-flight.ts`, `api/aircraft-history.ts`). Confirm the terms that cover the live feed
  on a public dashboard.
- [x] **FlightAware scrape.** Removed from `api/flight-times.ts` in Nov 2026. Flight times come
  from the hub boards and the FR24 API.

## Correctness

- [x] **Stale FAA programs on the dashboard.** Fixed Nov 10 2026 (`src/lib/faa-freshness.js`):
  `fetchFaa` and the `/newark` widget read the header and `Age`; a program past its own end time
  (plus a 15-minute grace for extensions still in the edge cache) drops out; past 25 minutes nothing from the answer is current (`faaIndex` is empty, so the hub
  strip, ticker and delay risk agree) and the NAS panel says "FAA status as of HH:MMZ". Since
  v1.25.0 an empty index from a stale answer no longer reads as calm: unless something else shows a
  disruption, the ticker's fallback line and the hub strip's network chip say "FAA status unknown
  since HH:MM" (local time) instead of "All systems normal" / "Smooth Ops". A stale
  `/api/nas` answer's tiers are not drawn either. After a failed `/api/faa` refresh,
  `src/app/state/weather.tsx` keeps showing the last programs as current, indefinitely. Since
  Nov 2026 the endpoint answers a double upstream failure with its last good answer (up to
  30 minutes old) and an `X-BB-FAA-Stale: <age in seconds>` header. Both clients ignore the
  header (`fetchFaa` in `src/app/data/api.ts`, and `src/scripts/newark-live.ts`). They should
  read it, track the time of the last good answer, and show programs past a limit as stale or
  unavailable, so an expired ground stop never reads as a live one.
- [x] **`/api/schedule` can run past its 60-second limit.** Fixed Nov 10 2026: the handler derives
  one deadline at the start of the request and every await is bounded by it (`api/_bounded.ts`);
  every Supabase query in the three files below carries an abort signal; the FR24 body reads are
  inside their request timeout; the FR24 slot wait has a deadline
  (`tests/schedule-deadline.test.js`). Two paths could:
  - On a request, `fetchAllPages` runs to a deadline 57 seconds after the start. The handler then
    awaits `saveScheduleSnapshot`, and for a partial board a second `getPersistentFallback`.
    Neither has a bound.
  - In the background, `triggerBackgroundRefresh` gives `fetchAllPages` 55 seconds from the
    trigger rather than from the start of the request, then awaits `saveScheduleSnapshot`. The
    handler has already awaited `hydrateQuotaBlock()` and sometimes `getPersistentFallback()`
    before the trigger.

  None of the Supabase calls involved has a timeout (`api/_cost-state.ts`,
  `api/_schedule-snapshots.ts`, `api/_reg-sightings.ts`). Two invocations timed out at 60 seconds
  on Nov 7 2026 (12:17:55 UTC). Both were logged with status 200 and cache `STALE`, and nothing
  else was logged, so the logs do not show which path it was. Fix: derive every deadline from
  the request's start, leave room for the snapshot write, and put timeouts on the Supabase reads
  and writes.
- [x] **Two body reads outside their timers.** Fixed in v1.25.0: both timers now cover the body
  read (`tests/body-read-timeouts.test.js`), and `/api/schedule`'s stored-snapshot read gets 6 s
  and serves a copy in memory rather than a metered fetch when it still runs out of time
  (`tests/schedule-read-timeout.test.js`). Was: `api/faa.ts` `fetchDisruptionMap` clears its
  5-second timer before `upstream.json()`, and `api/_schedule-aerodatabox.ts` `fetchWindow` clears
  its timer before `resp.json()` / `resp.text()`. `/api/schedule` now bounds both from its side
  (the FAA kick and the provider call are raced against the request deadline), but a hung FAA body
  still pins `disruptionInFlight` on that instance until it recycles, and every other caller of
  either function is unbounded. Fix: clear the timer after the body read, as `getFaaUpstream` does.
- [ ] **Hub proximity rule.** `HUB_PROXIMITY_NM = 93` (`src/lib/live-filters.js`) counts any
  grounded aircraft within the radius as at the hub, whatever its route. No single radius works
  (SFO–SJC is 26.5 NM, IAD–DCA 20.4 NM). Match on the route's hub first. For missing routes, use
  an airport-location assignment or a deliberately tight radius. Test other-airport flights and
  missing-route flights separately.

## Hardening

- [x] **DEP0169 log noise.** Fixed Nov 10 2026, confirmed Nov 23 2026: every handler reads its
  query through `getQuery(req)` (`api/_query.ts`), which parses `req.url` with `new URL()` and
  never touches the runtime's lazy `req.query`; `tests/query.test.js` fails if a file under `api/`
  reads `req.query` again. A full-text search of production runtime logs for `DEP0169` and
  `DeprecationWarning` over Nov 16–23 2026 returned no records (the same search finds other known
  strings, e.g. 13 `cost-state` lines in two days). Was: about 4,700 `url.parse()` deprecation
  warnings a week, at most one per process, only on the routes whose handlers read `req.query`
  (including `/api/metar`, which loads no packages); the likely caller was the platform's
  `req.query` helper. If it returns, `NODE_OPTIONS=--disable-warning=DEP0169` silences it.
- [ ] **CSP `style-src 'unsafe-inline'`** (`vercel.json`). Drop it after an inline-style audit;
  `script-src` already has no `'unsafe-inline'`.
- [ ] **Spend alerting.** Checked against the code Nov 23 2026. Capped in code: the brief's model
  call (`BRIEF_DAILY_USD_CAP`, default $0.50 a UTC day, `api/cron/brief.ts`) and Ask's
  (`ASK_DAILY_USD_CAP`, default $0.50, `api/ask.ts`), both counted across instances in
  `feature_spend_daily` (`sql/022`) and closed when it cannot be read; Enhanced Radar radio status
  (`ENHANCED_RADAR_DAILY_USD_CAP` / `ENHANCED_RADAR_MONTHLY_USD_CAP`, defaults $12 and $100,
  `api/_radio-status.ts`, booked in its ledger before each call); AeroDataBox
  (`AERODATABOX_DAILY_UNIT_BUDGET`, default 400 units, `api/_cost-state.ts`, across instances via
  `sql/009`, per instance when Supabase fails); the FR24 official API
  (`OFFICIAL_FR24_DAILY_CALL_CAP`, default 200 calls a UTC day, per instance, checked only by
  `api/schedule.ts`). Not capped by spend: delay explain (`api/delay-explain.ts`, an AI Gateway
  call bounded per request and per IP: 160 output tokens, 20 requests a minute, a 5-minute cache,
  a 5-minute pause after a gateway 402) and the official FR24 calls from `/api/fr24-flight`,
  `/api/flight-times` and `/api/aircraft-history` (rate limits and the shared 402 block only). Alerted: only AeroDataBox, at 80% of its budget,
  through the warm cron's pipeline alert (`api/cron/warm-schedules.ts` → `api/_alert.ts`, when
  `ALERT_WEBHOOK_URL` is set). A tripped brief, Ask or radio cap, an FR24 or gateway 402, and
  delay explain's spend show only in function logs.
- [ ] **Dependency audit in CI.** Checked Nov 23 2026. On, in the repository's settings:
  Dependabot alerts, Dependabot security updates, and CodeQL default setup (weekly and on pull
  requests, the "Analyze (javascript-typescript)" checks). Missing: a `.github/dependabot.yml` (no
  version updates) and an audit step: `.github/workflows/test.yml` runs typecheck, build and tests
  only. Dependabot shows no open alerts, but the dependency graph lists 46 entries, the
  `package.json` ranges, not the packages `bun.lock` resolves. `bun audit` (Bun 1.4.5; CI pins
  1.3.14) exits 1 on this lockfile: 29 advisories (7 high, 15 moderate, 7 low), 18 of them undici
  through `@vercel/node`, jsdom, astro and shadcn; 5 with `--prod` (astro 7.3.8, fast-xml-parser
  5.11.2, fflate via satori, minimatch via `@vercel/nft` and ts-morph). Fix or `--ignore` them
  before adding `bun audit` to CI, or the step fails every run.
- [ ] **Secrets rotation.** No written procedure for rotating `SUPABASE_SERVICE_ROLE_KEY`,
  `RESEND_API_KEY`, `AI_GATEWAY_API_KEY`, `FR24_API_TOKEN`, `AERODATABOX_API_KEY`, `CRON_SECRET`
  and the VAPID keys.
- [ ] **Logs and PII.** Check what the function logs retain (watch-alert and waitlist paths in
  particular) and for how long.

## Tests

- [ ] **Integration tests against a local Supabase.** Nothing in `tests/` exercises the real
  service-role and anon clients, or checks that RLS is enforced. Every table has RLS enabled in
  `sql/`.
- [x] **Focus return when the opener unmounts.** Fixed Nov 23 2026: when an overlay's opener has
  left the document, the dialog and sheet wrappers give focus to the header's "Find a flight"
  button (`focusReturnTarget` and `FOCUS_FALLBACK_ATTR` in `src/lib/focus-return.js`); an overlay
  opened with nothing focused still restores nothing. The `insideClosingContent` clause is gone:
  Radix runs the close handler after the content has unmounted, so it could never be true
  (`tests/focus-return.test.js`, `tests/focus-return-palette.test.tsx`). Was: opening the ⌘K
  palette, then the flight sheet, then closing it left focus on `<body>`.
- [x] **Engagement provider lifecycle.** Covered Nov 23 2026 (`tests/engagement-store.test.tsx`):
  the threshold read before the visit is recorded, init once per page, fail-closed stores; a
  subscriber re-rendered only by a real change, one click listener, removed on reset; the waitlist
  dialog's close reading its source before resetting it, keeping the session's "shown" and a
  signup. Was: no coverage of `src/app/state/engagement.tsx` itself.

## Small cleanups

- [x] `src/app/state/schedule.tsx`: Fixed Nov 23 2026: the `aggCache` Map holds at most
  `AGG_CACHE_MAX_BOARDS` (54: 9 hubs × 2 directions × 3 days, every board the controls can reach)
  and evicts the least recently used (`aggCacheGet` / `aggCacheSet` in `src/lib/schedule-load.js`,
  `tests/schedule-load.test.js`). Was: never capped. Only Refresh deleted a key, so a long session
  kept one board per hub, direction and day.
- [x] `api/_schedule-snapshots.ts` `getSupabaseAdmin`: Fixed Nov 23 2026: the `.catch()` resets
  the cached promise, so the next call retries (`tests/schedule-snapshots-client-retry.test.js`).
  Was: a failed `@supabase/supabase-js` import cached a `null` promise for the life of the instance.
- [x] `sql/001_waitlist.sql`: Written Nov 23 2026 as `sql/025_drop_duplicate_waitlist_index.sql`,
  not yet applied (the owner applies it in the Supabase SQL editor; the file has the checks and
  the undo). Was: `idx_waitlist_email` duplicates the UNIQUE constraint's index
  (`waitlist_email_key`).
- [x] `api/irops.ts`: Fixed Nov 23 2026: the error branch names its hub by the loop index. Was:
  `results.indexOf(result)`.
- [x] `src/lib/delay-risk.js`: Fixed Nov 23 2026: `roleLabel` is gone and the five FAA factors
  read "at <airport>" for origin and destination alike, the wording they already had
  (`tests/delay-risk.test.js` pins both). Was: `'at'` on both branches of a ternary.
- [ ] Waitlist: decide whether to stay on hand-rolled Supabase + Resend or move to a hosted list
  (Loops, Resend Audiences, ConvertKit).
