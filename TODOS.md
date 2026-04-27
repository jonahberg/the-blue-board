# TODOS

## Pro v1 — bundled in 1.6.0 (DONE 2026-05-05)

- [x] CRON_SECRET timing-safe compare via `api/_cron-auth.ts` (was item #6) — migrated 5 endpoints
- [x] Integration-test harness scaffold at `tests/pro-rls.integration.test.js` — runs against real Supabase when `TEST_SUPABASE_*` env vars are set
- [x] Anthropic prompt-injection defense — `isValidFlightNumber` regex on user input + structured prompts in cron
- [x] Feature kill-switches for Pro tier (`PRO_ENABLED`, `PRO_FEATURE_*_ENABLED`) — see PRO_ENV_VARS.md
- [x] Service worker cache invalidation tied to commit SHA — eliminates the v1.5.6 cache-break bug class

## Deferred to v1.6.x / v1.7

### Pro v1.1 (after first cohort feedback, ~2 weeks post-launch)

- [ ] Wire real signal-fetch into `api/cron/risk-monitor.ts` `processFlight` — currently stub records last_checked. v1.1 fetches FR24 + FAA NAS + METAR, uses `computeSignalsHash` for delta detection, calls `dispatchAlert` on threshold cross.
- [ ] Anthropic + FR24 spend anomaly detection via Vercel log drain (D15 from eng review — deadline: before 100 paying customers)
- [ ] Shareable flight status cards (cut from v1 per Codex review challenge — add as growth feature)
- [ ] Annual pricing ($49.99/yr) — validate monthly conversion first
- [ ] Free trial for regular ($7.99) pricing — once founding price is gone
- [ ] HttpOnly cookie auth via `@supabase/ssr` — replaces localStorage tokens (XSS hardening)
- [ ] Per-user notification preferences (quiet hours, frequency, severity threshold)
- [ ] Admin view of subscription state (currently use Stripe dashboard directly)

### Class-of-bug prevention (still deferred from ultrareview v1.5.5)

- [ ] CI lint: ban inline `<script>` in public/index.html, ban raw `innerHTML` with template-literal interpolation, ban inline event handlers (`on*=` attributes).
- [ ] Migrate inline event handlers (`onclick`, `onkeydown`, `onload`) at `public/index.html:75`, `src/dashboard/main.js:2956/3704/3717` to delegated `data-action` attributes.
- [ ] Tighten CSP: drop `style-src 'unsafe-inline'` after inline-style audit.
- [ ] Circuit breakers / graceful degradation for FR24, Anthropic, Resend, Supabase.
- [ ] Feature kill-switches for non-core free-tier features (waitlist, news-notify, delay-explain top-level) — Pro features now have them, free features still don't.

### Security hygiene (backlog — closed Pro-related items)
- [ ] [#26 extension] Evaluate moving waitlist off hand-rolled Supabase+Resend → Loops/Resend Audiences/ConvertKit.
- [ ] [README drift] Audit README claims vs actual codebase ("strict CSP", "zero inline handlers", "fully escaped") and either fix the code or fix the docs.

### Quality

- [ ] [#14] `api/irops.ts:193` — `results.indexOf(result)` O(n²) → index-based loop. Non-user-facing; 8 hubs so real impact minimal.
- [ ] [#21] `public/sw.js:84-85` — offline fallback serves `/index.html` for all unmatched routes. Route-aware fallback or proper offline screen.
- [ ] [#22] `src/dashboard/main.js` — cap `schedCache` size; scope `.starlink-predict` selector to current popup container.
- [ ] [#25] Drop `idx_waitlist_email` (redundant with UNIQUE constraint). Bundle with next SQL migration.
- [ ] [#28] `scripts/run-astro-dev.mjs` — stamp a copy under `.dev-scratch/` instead of tracked `public/index.html` to avoid SIGKILL leaving dirty tree.

### LOW / noted cleanups (batch with any adjacent work)

- [ ] `public/index.html:18-23` — doc-drift comments reference `api/irops.js` (actually `.ts`) and `public/hubs/` (actually `src/pages/hubs/`).
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
