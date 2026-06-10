# TODOS

## Deferred from ultrareview v1.5.5 ship (2026-04-24)

### v1.5.6 "Trust Infrastructure" sprint (2 weeks after v1.5.5)

**Class-of-bug prevention — the high-leverage work both CEO voices flagged:**

- [ ] Integration-test harness: real Supabase local instance, hit API routes with service-role + anon-key both, RLS enforcement tests, template-escaping snapshot tests.
- [ ] CI lint: ban inline `<script>` in public/index.html, ban raw `innerHTML` with template-literal interpolation, ban inline event handlers (`on*=` attributes).
- [ ] Migrate inline event handlers (`onclick`, `onkeydown`, `onload`) at `public/index.html:75`, `src/dashboard/main.js:2956/3704/3717` to delegated `data-action` attributes.
- [ ] Tighten CSP: drop `style-src 'unsafe-inline'` after inline-style audit.
- [ ] Cost alerting: Anthropic + FR24 spend anomaly detection via Vercel log drain.
- [ ] Circuit breakers / graceful degradation for FR24, Anthropic, Resend, Supabase. (partial: 60s negative cache + 4s timeout shipped for `api/predict-flight.ts` and `api/check-flight.ts` in v1.5.8)
- [ ] Feature kill-switches for non-core (waitlist, news-notify, delay-explain) via env flags.

### Security hygiene (backlog)

- [ ] [#6] CRON_SECRET timing-safe compare across `api/cron/refresh-tsa.ts:10`, `api/cron/sync-starlink.ts:11`, `api/news-notify.ts:50-51`. Bundle with auth hardening pass. (partial: warm-schedules + the /api/schedule forceRefresh gate shipped timing-safe fail-closed auth in v1.5.16 via `api/_cron-auth.ts` — reuse it for the remaining three)
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
