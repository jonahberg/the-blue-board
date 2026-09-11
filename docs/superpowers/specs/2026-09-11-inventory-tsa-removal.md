# TSA / checkpoint feature — full reference audit (2026-09-11)

Search: case-insensitive `tsa|mytsa|precheck|checkpoint` across the repo, excluding `node_modules/`, `dist/`, `bun.lock`, `.git/`, `.astro/`, `.vercel/`, `.gstack/`, and `CHANGELOG.md`. 36 files matched; every one was opened and read.

## 1. API handlers and helpers

| File:Line | What it is | Action |
|---|---|---|
| `api/tsa.ts` (whole file) | `/api/tsa` endpoint (MyTSA fetch, cache, `computeTsaFeedDown`) | delete-file |
| `api/cron/refresh-tsa.ts` (whole file) | Hourly cron warming `/api/tsa` | delete-file |
| `api/waitlist.ts:20` | Comment `'tsa-page' (tsa.astro gate)` | edit-text |
| `api/waitlist.ts:31` | `'tsa-page'` in `VALID_SOURCES` | edit-text (API coerces unknown sources → `'popup'`, safe) |
| `api/_email-footer.ts:5` | Comment referencing tsa.astro copy | edit-text (comment) |

## 2. `vercel.json`

| File:Line | What | Action |
|---|---|---|
| `vercel.json:41` | `"api/tsa.ts": { "maxDuration": 30 }` | delete (same commit as the file — a `functions` glob matching no file fails the Vercel build) |
| `vercel.json:42` | `"api/cron/refresh-tsa.ts"` maxDuration | delete (same commit) |
| `vercel.json:51` | cron `/api/cron/refresh-tsa` | delete |
| `vercel.json:120-125` | `/tsa` Cache-Control header block | delete |

## 3. Astro pages/layouts/components

| File:Line | What | Action |
|---|---|---|
| `src/pages/tsa.astro` (whole file, self-contained inline style) | the `/tsa` page | delete-file |
| `src/data/tsa/united-terminals.js` (whole file) | TSA data; imported only by tsa.astro and `buildMetadata.js` `tsaLastmodPaths` | delete-file |
| `src/layouts/HubLayout.astro:273-277` | TSA cross-link box (domestic hubs) | delete-block |
| `src/components/trackers/CrossLink.astro:2` | comment | edit-text |
| `src/components/VercelAnalytics.astro:2` | comment listing "tsa" | edit-text |
| `src/lib/agent-markdown.js:32` | HOME prose "…a TSA checkpoint guide…" | edit-text |
| `src/lib/agent-markdown.js:67` | table row `/tsa` | delete row |
| `src/lib/agent-markdown.js:101` | freshness table row | delete row |
| `src/lib/buildMetadata.js:94-97` | `export const tsaLastmodPaths` | delete-block (after sitemap edit) |
| `src/lib/site-routes.js:14` | `'/tsa'` in `HTML_ROUTE_PATHS` | edit (after agent-readiness test edit) |
| `src/pages/404.astro:54` | link to /tsa | edit |
| `src/pages/newark.astro:281` | `<li>` link to /tsa#ewr | edit |
| `src/pages/privacy.astro:56` | "e.g. the TSA page" example | edit (cosmetic) |
| `src/pages/sitemap.xml.ts:16,53` | import + `renderUrl('/tsa', …)` | edit (before buildMetadata edit) |
| `public/og/` | none TSA-specific | clean |

## 4. Dashboard

| File:Line | What | Action |
|---|---|---|
| `public/index.html:176` | SEO brief `<li>` "…and a TSA checkpoint guide…" | edit-text (carries into index.astro brief) |
| `src/dashboard/main.js` | clean | — |
| `public/js/tsa-gate.js` (whole file) | email-gate modal for /tsa | delete-file |
| `public/css/style.css` | clean | — |

## 5. Data — keep general content

- `src/data/hubs/den.js:75` "East Security Checkpoint opened in August 2025" — general construction news, KEEP.
- `src/data/trackers/united-hubs.js:254,352,355` — SFO/DEN checkpoint construction + tsa.gov citation, KEEP.
- `src/data/news/*` — zero TSA mentions.
- `src/data/facts.js` — clean.

## 6. Tests

| File:Line | What | Action |
|---|---|---|
| `tests/tsa.test.js` | unit tests for api/tsa | delete-file |
| `tests/refresh-tsa.test.js` | unit tests for cron | delete-file |
| `tests/asset-cache.test.js:49-56` | "TSA cron cadence" describe | delete-block (same commit as vercel.json cron) |
| `tests/agent-readiness.test.js:124` | `/tsa` in real-page list | edit (before site-routes edit) |
| `tests/agent-readiness.test.js:170` | `/tsa` maps to null asset path | edit (non-blocking) |
| `tests/web-analytics-integration.test.js:10,44` | comment + `'src/pages/tsa.astro'` in entrypoints (readFileSync) | edit BEFORE deleting tsa.astro |
| False positives | `departsAny` contains `tsA` (api/nas.ts:103, tests/nas.test.js, fixtures) | none |

## 7. Scripts, docs, llms

| File:Line | What | Action |
|---|---|---|
| `scripts/*` | clean | — |
| `README.md:106,233` | cron diagram + file tree | edit |
| `TODOS.md:28` | `[tsa] Surface feedDown…` | delete line |
| `docs/HANDOFF.md:16`, `docs/reviews/2026-07-08-persona-review.md:68,179` | historical | leave |
| `public/llms.txt:27,44`, `public/llms-full.txt:40,57` | bullet + table row | edit / delete row |
| `public/robots.txt`, `.env.example`, `middleware.ts` | clean | — |

## 8. SQL

`sql/006_waitlist_checks.sql:26-27,44` has `'tsa-page'` in the CHECK constraint / RLS policy. Applied migration — LEAVE. Dropping `'tsa-page'` from `api/waitlist.ts` is safe independently. A new migration is optional cleanup, not required.

## 9. PR #247

No reference in the repo (only hit is an unrelated rgba colour in main.js).

## Deletion order (or one atomic commit)

1. Delete `tests/tsa.test.js`, `tests/refresh-tsa.test.js`.
2. Delete `api/tsa.ts`, `api/cron/refresh-tsa.ts` + all four `vercel.json` entries + `tests/asset-cache.test.js:49-56`, same commit.
3. Edit `tests/web-analytics-integration.test.js:44`, then delete `src/pages/tsa.astro` and `public/js/tsa-gate.js`.
4. Edit `src/pages/sitemap.xml.ts`, then delete `tsaLastmodPaths` from `buildMetadata.js`.
5. Edit `tests/agent-readiness.test.js:124`, then remove `'/tsa'` from `site-routes.js`.
6. Delete `src/data/tsa/united-terminals.js`.
7. Order-independent: HubLayout cross-link, 404/newark links, waitlist VALID_SOURCES, agent-markdown, llms txts, index brief, README, TODOS, privacy, comments.
8. Add a 301 `/tsa` → `/hubs` in `vercel.json` redirects (design decision, not in the audit).
