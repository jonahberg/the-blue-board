# TODOS

## Deferred from ultrareview v1.5.5 ship (2026-04-24)

### v1.5.6 "Trust Infrastructure" sprint (2 weeks after v1.5.5)

**Class-of-bug prevention — the high-leverage work both CEO voices flagged:**

- [ ] Integration-test harness: real Supabase local instance, hit API routes with service-role + anon-key both, RLS enforcement tests, template-escaping snapshot tests.
- [ ] Tighten CSP: drop `style-src 'unsafe-inline'` after inline-style audit.
- [ ] Cost alerting: Anthropic + FR24 spend anomaly detection via Vercel log drain.
- [ ] Circuit breakers / graceful degradation for FR24, Anthropic, Resend, Supabase. (partial: 60s negative cache + 4s timeout shipped for `api/predict-flight.ts` and `api/check-flight.ts` in v1.5.8; FR24 live-feed last-known-good stale-serve + delay-explain gateway-403 circuit shipped in v1.7.14)
- [ ] Feature kill-switches for non-core (waitlist, news-notify, delay-explain) via env flags.

### Security hygiene (backlog)

- [ ] [compliance] FlightAware HTML scraping (`api/flight-times.ts`) uses a spoofed Chrome UA against FlightAware's Terms of Use — migrate to AeroAPI's free tier or rely on the tryFR24Summary fallback, and credit any FlightAware data shown. (Deferred from v1.5.17 compliance sweep.)
- [ ] [compliance] Starlink upstream (unitedstarlinktracker.com) is consumed against its robots.txt with no documented permission — ask @martinamps for written permission and record it in docs. (Deferred from v1.5.17.)
- [ ] [compliance] Set `EMAIL_POSTAL_ADDRESS` in Vercel env (real postal address / PO Box — CAN-SPAM requires it; the email footer renders it once set). Optional follow-up: an HTTPS one-click unsubscribe endpoint enables the RFC 8058 List-Unsubscribe-Post header.

- [ ] [#26 extension] Evaluate moving waitlist off hand-rolled Supabase+Resend → Loops/Resend Audiences/ConvertKit.
- [ ] [README drift] Audit README claims vs actual codebase ("strict CSP", "zero inline handlers", "fully escaped") and either fix the code or fix the docs.

### Quality

- [ ] [ops] Default SCHEDULE_SOURCE_PRIORITY to 'provider' (schedule.ts) so env loss fails closed to the working provider instead of the Cloudflare-dead scrape path. Audit ops-reliability item, not in the v1.5.20 batch.

- [ ] [#14] `api/irops.ts:193` — `results.indexOf(result)` O(n²) → index-based loop. Non-user-facing; 8 hubs so real impact minimal.
- [ ] [#21] `public/sw.js:84-85` — offline fallback serves `/index.html` for all unmatched routes. Route-aware fallback or proper offline screen.
- [ ] [#22] `src/app/state/schedule.tsx:206` — cap the `aggCache` Map (the rebuild's `schedCache`). Nothing evicts it; only Refresh deletes a key, so a long session accumulates one full board response per hub × direction × day.
- [ ] [#25] Drop `idx_waitlist_email` (redundant with UNIQUE constraint). Bundle with next SQL migration.

### LOW / noted cleanups (batch with any adjacent work)

- [ ] `src/pages/hubs/[hub].astro:10`, `src/pages/fleet/[type].astro:10` — defensive null guard + `/404` redirect (matches `news/[slug].astro`).
- [ ] `api/_schedule-snapshots.ts:80-87` — reset `supabaseClientPromise` to null on import failure inside `.catch()`.
- [ ] `src/lib/buildMetadata.js:1` — migrate `node:child_process` to `Bun.$` / `Bun.spawnSync` per CLAUDE.md.
- [ ] `src/lib/delay-risk.js:172-173` — dead `roleLabel` variable; decide: restore destination-label logic or remove.
- [ ] `.github/workflows/test.yml:13-15` — drop `actions/setup-node@v4` (redundant with `oven-sh/setup-bun@v2`).

### Audit surface gaps flagged in CEO review

- [ ] Dependency vulnerability audit (`bun audit` or `npm audit` in CI).
- [ ] Secrets rotation posture (SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ANTHROPIC_API_KEY, CRON_SECRET).
- [ ] Vercel log retention + PII exposure check.
- [ ] Anthropic prompt-injection defense on user-supplied flight data in `delay-explain.ts`.
- [ ] CORS audit on Anthropic-backed endpoints.

## From the independent review of PR #254 (Sep 2026)

- [ ] [correctness] Stale FAA programs: after a failed `/api/faa` refresh the last programs are shown as current forever. Track last-successful fetch time per source, render a stale/unavailable state, and stop an expired program from implying a confirmed live disruption (`src/app/state/weather.tsx`). Legacy had the same retention.
- [ ] [correctness] Hub proximity rule: `HUB_PROXIMITY_NM = 93` admits any grounded aircraft within the radius regardless of its route, and no single radius fixes it (SFO–SJC 26.5 NM, IAD–DCA 20.4 NM). Match on the route's hub first; for missing routes use an airport-location assignment or a deliberately tight radius. Test known other-airport flights and missing-route flights separately.
- [ ] [a11y] Focus return when the opener unmounts (⌘K palette → flight sheet → close lands on `<body>`): fall back to the stable "Find a flight" trigger. Also drop or reword the unreachable `insideClosingContent` clause in `src/lib/focus-return.js`.
- [ ] [test] Lifecycle coverage for `src/app/state/engagement.tsx` (initialisation order, subscription, dismissal sequencing) using the jsdom + testing-library setup added for the watch provider.
