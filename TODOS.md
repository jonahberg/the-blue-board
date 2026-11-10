# TODOS

Open work, checked against the code on 2026-11-10. Each entry names the file it concerns.

## Owner actions

- [ ] [compliance] **Starlink data permission.** Six server routes call unitedstarlinktracker.com:
  `api/cron/sync-starlink.ts` and `api/starlink-data.ts` (`/api/data`), `api/check-flight.ts`,
  `api/predict-flight.ts`, `api/fleet-summary.ts` and `api/starlink-mismatches.ts`. The site's
  robots.txt allows `/api/data` and disallows the rest of `/api/`. The data is credited on the
  Sources and Starlink tabs and on `/fleet`, but no permission from the maintainer (@martinamps)
  is on record. Ask for it in writing and record the answer in `docs/`.
- [ ] [compliance] **FlightAware scrape.** Off by default since Nov 2026 (`FLIGHTAWARE_SCRAPE_ENABLED`,
  `api/flight-times.ts`): scraping FlightAware's pages is against its Terms of Use, and from Vercel
  it answered none of 24 live flights in the Nov 10 2026 check. Leave it off. Delete the tier, or
  replace it with FlightAware's licensed AeroAPI if its data is ever needed.
- [ ] [compliance] **FR24 live positions.** `/api/fr24-feed` reads FR24's public web feed
  (`data-cloud.flightradar24.com`, `src/lib/united-feed.js`), not the licensed FR24 API that
  `api/fr24-flight.ts` and `api/aircraft-history.ts` use. Confirm FR24's terms allow it for a
  public dashboard.
- [ ] [compliance] **CAN-SPAM postal address.** `EMAIL_POSTAL_ADDRESS` is not set in Vercel, so the
  email footer (`api/_email-footer.ts`) sends without one. Set a real postal address or PO Box.
- [ ] [ops] **Alerting is not connected.** `ALERT_WEBHOOK_URL` is not set in Vercel, so
  `api/_alert.ts` never sends, and the schedule-pipeline alert in `api/cron/warm-schedules.ts`
  does nothing.
- [ ] [ops] **FR24 credit budget.** `FR24_MONTHLY_CREDIT_BUDGET` is not set, so the support meter
  (`api/support-stats.ts`) assumes a 100,000-credit plan. Set it to the real plan size.
- [ ] [ops] **Unused env vars.** `ANTHROPIC_API_KEY` (Production, Preview) is never read: delay
  explanations go through the AI Gateway with `AI_GATEWAY_API_KEY` (`api/delay-explain.ts`).
  `SCHEDULE_SOURCE_PRIORITY` (Production) has been ignored since v1.9.0 (`api/schedule.ts`).
  Remove both.
- [ ] [ops] **DEP0169 log noise.** About 4,700 `url.parse()` deprecation warnings a week, at most
  one per process. They appear only on the routes whose handlers read `req.query`, including
  `/api/metar`, which loads no packages; routes that never read it (`/api/irops`, the crons) log
  none. App code never calls `url.parse`, so the likely caller is the platform's `req.query`
  helper. `NODE_OPTIONS=--trace-deprecation` on a Preview deploy would confirm it.
  `NODE_OPTIONS=--disable-warning=DEP0169` would silence the warnings, and would also hide any
  future first-party `url.parse` call.

## Correctness

- [ ] **Stale FAA programs on the dashboard.** After a failed `/api/faa` refresh,
  `src/app/state/weather.tsx` keeps showing the last programs as current, indefinitely. Since
  Nov 2026 the endpoint answers a double upstream failure with its last good answer (up to
  30 minutes old) and an `X-BB-FAA-Stale: <age in seconds>` header. Both clients ignore the
  header (`fetchFaa` in `src/app/data/api.ts`, and `src/scripts/newark-live.ts`). They should
  read it, track the time of the last good answer, and show programs past a limit as stale or
  unavailable, so an expired ground stop never reads as a live one.
- [ ] **`/api/schedule` can run past its 60-second limit.** Two paths can:
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
- [ ] **Hub proximity rule.** `HUB_PROXIMITY_NM = 93` (`src/lib/live-filters.js`) counts any
  grounded aircraft within the radius as at the hub, whatever its route. No single radius works
  (SFO–SJC is 26.5 NM, IAD–DCA 20.4 NM). Match on the route's hub first. For missing routes, use
  an airport-location assignment or a deliberately tight radius. Test other-airport flights and
  missing-route flights separately.

## Hardening

- [ ] **CSP `style-src 'unsafe-inline'`** (`vercel.json`). Drop it after an inline-style audit;
  `script-src` already has no `'unsafe-inline'`.
- [ ] **Spend alerting.** Nothing watches AI Gateway or FR24 credit spend. The only alert path
  covers the schedule pipeline, and it is not connected (see Owner actions).
- [ ] **Dependency audit in CI.** `.github/workflows/test.yml` runs typecheck, build and tests
  only. There is no `bun audit` step and no Dependabot config.
- [ ] **Secrets rotation.** No written procedure for rotating `SUPABASE_SERVICE_ROLE_KEY`,
  `RESEND_API_KEY`, `AI_GATEWAY_API_KEY`, `FR24_API_TOKEN`, `AERODATABOX_API_KEY`, `CRON_SECRET`
  and the VAPID keys.
- [ ] **Logs and PII.** Check what the function logs retain (watch-alert and waitlist paths in
  particular) and for how long.

## Tests

- [ ] **Integration tests against a local Supabase.** Nothing in `tests/` exercises the real
  service-role and anon clients, or checks that RLS is enforced. Every table has RLS enabled in
  `sql/`.
- [ ] **Focus return when the opener unmounts.** Opening the ⌘K palette, then the flight sheet,
  then closing it leaves focus on `<body>`. `shouldRestoreFocus` (`src/lib/focus-return.js`)
  gives up on a detached opener. Fall back to the "Find a flight" trigger, and drop or reword
  the `insideClosingContent` clause in `wasFocusLost`.
- [ ] **Engagement provider lifecycle.** Add coverage for `src/app/state/engagement.tsx`
  (initialisation order, subscription, dismissal sequencing), using the jsdom and
  testing-library setup the watch-provider tests use.

## Small cleanups

- [ ] `src/app/state/schedule.tsx:210`: the `aggCache` Map is never capped. Only Refresh deletes
  a key, so a long session keeps one board per hub, direction and day.
- [ ] `api/_schedule-snapshots.ts` `getSupabaseAdmin`: a failed `@supabase/supabase-js` import
  caches a `null` promise for the life of the instance. Reset it in the `.catch()`.
- [ ] `sql/001_waitlist.sql`: `idx_waitlist_email` duplicates the UNIQUE constraint's index.
  Drop it in the next migration.
- [ ] `api/irops.ts:378`: the error branch looks up its hub with `results.indexOf(result)`. Use
  the loop index.
- [ ] `src/lib/delay-risk.js:178`: `roleLabel` is `'at'` on both branches. Inline it, or give
  destinations their own wording.
- [ ] Waitlist: decide whether to stay on hand-rolled Supabase + Resend or move to a hosted list
  (Loops, Resend Audiences, ConvertKit).
