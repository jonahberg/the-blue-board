# Handoff — v2.0 Review & Remediation Program

**Date:** 2026-07-08 · **Branch:** `claude/blue-board-personas-2ebjuv` (PR open against `main`)
**State:** all planned work COMPLETE and pushed. Gates at branch head: `bun run test` 1033/1033 (was 942 at baseline) · `tsc --noEmit` clean · `bun run build` green (43 pages).

## What happened (one paragraph)

A seven-persona hands-on review + five-domain code audit + independent fact-checking produced 93 adversarially-verified findings (`docs/reviews/2026-07-08-persona-review.md` — the canonical reference, finding IDs F001–F093 used everywhere below). All confirmed "fundamentally broken / incorrect data" findings were then fixed (Part 1), the polish layer applied (Part 2), and three v2.0 features built (Part 3), in 14 work packages executed by Sonnet/Opus agents under an advisor-review gate. Every commit passed tests + typecheck + build before merge.

## Commit map (oldest → newest)

| Commit | Package | Contents |
|---|---|---|
| `9394c24` | — | The review report itself |
| `d91d0be` | WP1 | Arrivals-OTP direction fix, AI riskScore coercion, fleet SEATS render, V.HIGH filter, squawk parsing, explain-cache key |
| `03fda31` | WP2 | `src/data/facts.js` single source of truth + site-wide truth sweep (8 hubs + NRT gateway incl. JSON-LD, Starlink 428/425+, TLV suspension, honest TSA gate, README) |
| `e32e802` | WP8 | FR24 official-API age gate, shared 402 quota block across all callers, board `generatedAt`/`dataAge`, METAR backfill TTL, function maxDurations |
| `7b3bbe3` | WP3 | IROPS single writer + held-flight (overdue) scoring, hub chips blend FAA programs (⛔/⚠), dual-program formatting, NOW divider effective times |
| `245a244` | WP6 | Real `registration` through all flight-times tiers (revives Where's-My-Plane/journey/inbound-risk), `date=` param + candidate re-ranking, `src/lib/connection-risk.js` (never SAFE on cancelled/NaN), Starlink badge fix, 6 smaller client-trust fixes |
| `b7b225d` | WP4 | Landscape onboarding lockout, news-banner z-index off tab-live controls, `#legalpop` containing-block fix (donate popover visible), stat-strip overlap, tooltip clipping |
| `f19b811` | WP7 | Space-tolerant + schedule-aware search, onboarding focus trap/Escape, `role=button`+`tabindex` across sort headers/reg links/risk badges/search results/hub rows, marker aria-labels |
| `6035d26` | P2-B | My Flights primary mobile nav, marker hit-slop, sticky mobile headers, safe-area + maskable icons, 12 per-page OG images (`public/og/`, `scripts/generate-og.py`), unsubscribe footer line |
| `9100003` | P2-A | Jargon tooltips, `src/lib/time-format.js` universal tz labels, data-age/provenance chips, donation-moment split (landed-payoff card, capped triggers) |
| `72d2859` | P2-C | Heading order, landmarks, `--ua-dim` → `#7C8DA6` (measured ≥4.8:1), blue-as-text eliminated, focus ring, drawer Escape, IROPS-change live region — **axe: 0 violations**; DESIGN.md updated |
| `9c24fff`+`1f3dbd3` | P3-EWR | `/newark` Operations Center (live status, cap timeline through Oct 30 2027, FAQ schema, sitemap/llms) |
| `990f4a2` | P3-METER | Public `/api/support-stats` (sanitized: counts + 5%-rounded pct only) + About-popover cost meter |
| `f8d7139` | P3-PUSH | Background watch alerts: `sql/014_watch_subscriptions.sql`, `/api/push-subscribe`, 5-min `api/cron/watch-alerts.ts` diff cron (free data tiers only), `sw.js` push handler, `api/_watch-diff.ts` (ported meaningful-change rules), graceful unconfigured fallback |

## Owner actions required (in order)

1. **Enable background push** (~5 min): follow `docs/setup-push-alerts.md` — generate VAPID keys, set 3 env vars in Vercel, run `sql/014` in Supabase, redeploy. Until then the watch feature honestly shows "in-tab only".
2. **Set `FR24_MONTHLY_CREDIT_BUDGET`** env to the real FR24 plan credit total (support-stats meter assumes 100,000).
3. **Before charging any money** (legal sequencing from the review — SWMonkey / Air Canada v. seats.aero precedents): replace the FlightAware HTML scrape (`api/flight-times.ts` FA tier) with licensed AeroAPI or drop it; obtain written permission for the unitedstarlinktracker.com upstream (TODOS.md items); confirm FR24 API tier covers a commercial dashboard; set `EMAIL_POSTAL_ADDRESS` (CAN-SPAM).

## Deferred / next work (specs in the review's Part 3)

- **Equipment-swap alert subscriptions** — the P3-PUSH cron already detects equipment changes per watched flight; "watch a route/fleet type" expansion is the natural next package.
- **OTP/IROPS history archive** (nightly snapshots → 7/30/90-day trends) — needs a cron + Supabase table decision.
- **Morning ops-brief email** — home-hub preference is collected in onboarding (localStorage only); needs server-side capture + Resend digest cadence decision.
- **Starlink prediction + `/starlink` page** — BLOCKED on upstream permission (see owner action 3).
- Review Part 2 leftovers intentionally not done: none material; the appendix table in the review marks every finding, and all confirmed critical/high items were addressed.

## Known environment/infra notes for the next agent

- **Tests:** ALWAYS `bun run test` (vitest), never bare `bun test` (CLAUDE.md explains why). Typecheck: `bun run typecheck`. Full build: `bun run build`.
- **Dev-server gotcha (TODOS #28, bit us during this program):** `scripts/run-astro-dev.mjs` stamps `public/index.html` and restores a startup snapshot on exit — if killed after other commits touched that file, it reverts them on disk. Run `bunx astro dev` directly for agent work, or fix the script to stamp a copy.
- **Review harness:** persona/verification testing used a session-local mock-API proxy (realistic FR24/schedule/METAR/FAA/IROPS payloads + seeded EWR-ground-stop scenario) serving the dashboard fully hydrated; it lived outside the repo and is gone with the session. Rebuilding it is documented by example in the review's "How this review was done" — a committed fixture harness is a worthwhile future package (the review's "dev/prod parity" recommendation).
- **`public/js/dashboard.js`** is a gitignored build artifact — `bun run build:dashboard` after editing `src/dashboard/main.js`.
- **Facts discipline:** page-level factual numbers come from `src/data/facts.js`; static files (index.html, llms*.txt, README) carry sync comments. When a fact changes, update facts.js then grep for stragglers.

## Key documents

- `docs/reviews/2026-07-08-persona-review.md` — the full review: all findings, verdicts, v2.0 strategy (monetization sequencing, freemium line, feature tiers).
- `docs/setup-push-alerts.md` — push-alert owner setup.
- `DESIGN.md` — design system (updated 2026-07-08: contrast tables, dim-token change, blue-is-never-text).
- `TODOS.md` — pre-existing backlog; compliance items there are now load-bearing for monetization (see owner action 3).
- `CHANGELOG.md` — not yet updated for this program; suggest one consolidated v1.8.0 entry summarizing the PR when merging.
