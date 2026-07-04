# Changelog

All notable changes to The Blue Board are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioned per [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-07-04

### Added
- Schedule: blank registrations backfill from live flight tracking (seen-today ledger; provider values never overwritten)

### Fixed
- Schedule: stale-board banner now says "showing the latest data we have" instead of "live updates paused"
- Live Ops: Starlink aircraft render violet (#A78BFA) — glow halo removed
- Delays: IROPS chip shows plain-language severity (Normal/Minor/Significant) instead of a 0–100 score; radar map opens framed to CONUS

## [1.5.26] - 2026-07-03

### Fixed
- **Flight time lookups work again** (`/api/flight-times`): FlightAware's bot-wall returns a parseable-but-empty response, which was treated as "no active flight" for every flight — silently breaking My Flights card statuses ("LOADING..." forever, "() → ()" routes) and the Check-a-Connection tool. An empty parse now falls back to the FR24 Official API (only when the official-API kill switch is on) and then to the schedule snapshot layer, so times survive even with FlightAware blocked and FR24 credits exhausted. Failures now say why.
- **Parked aircraft are no longer shown as "Departed" during delay programs.** The one-hour time-inference grace was systematically wrong under a ground-delay program (162 false "Departed" rows at ORD during the Jul 3 GDP; spot-checked aircraft were physically parked 3-4 hours). Boards now carry the hub's live FAA disruption magnitude, the inference grace stretches with it, and every time-inferred row is labeled "Departed*" with an explanation instead of masquerading as confirmed.
- **"CanceledUncertain" is no longer a hard cancellation** (UA4809 was shown Canceled and flew on time — and the status rendered as the literal string "Canceleduncertain"). It is now its own soft "Likely Canceled" state, amber not red, grouped under the Canceled filter, overridden the moment real times arrive.
- **One takeoff, one row, one OTP entry.** Schedule revisions produced duplicate rows for the same physical departure (counted both On Time and 2h48m Late), operating-carrier clones duplicated United Express flights ("GoJet to London Heathrow"), and foreign airlines leaked onto United boards (a Spirit flight on EWR). Boards now collapse revision and operator-code duplicates and drop foreign rows, with the collapse counts exposed in `meta.dedupe`.
- **The stat strip no longer hides a third of the board.** Canceled flights (70 at ORD on Jul 3) were computed and thrown away; the cards did not sum to the total. There is now a CANCELED card, a presumed-departed chip, and an explicit "uncategorized" remainder — the cards reconcile with the total by construction, with a unit-tested invariant.
- **The header ticker can no longer say "All systems normal" beside a red IROPS wall.** Ticker state now derives from the same hub-health/FAA/IROPS inputs as the Delays tab (ground stop > low OTP > GDP precedence), and the bare IROPS number is labeled ("IROPS 56.7/100") with an explainer.
- **The DELAY column now contains the delay.** Departed/landed rows show the real delta (tabular figures, `+2h20m` formatting) instead of hiding it as fine print in the TIME cell, and AI predictions are labeled as predictions ("RISK: HIGH") instead of reading as facts. Column renamed "Delay / Risk".
- **Today boards anchor at NOW.** A sticky "── NOW · 9:12 PM CDT ──" divider separates flown from upcoming, the board auto-scrolls there on load, yesterday's delayed-overnight rows carry a date chip ("Jul 2") instead of being indistinguishable from tonight's same-numbered flights, and a "Jump to now" pill returns you there.
- **"Unknown" is no longer a passenger-facing status.** Rows the stale pipeline could not refresh (168 in one evening) render as "Scheduled · as of 7:12 PM CDT" instead of "Unknown"; the stale banner states an absolute as-of time and consequence instead of a vague age.
- **OTP has a single writer.** The header hub percentages flapped (DEN 68→100→68) because a client-side recomputation with a 5-flight floor overwrote the server value on every refresh; the server IROPS value is now authoritative, and the client only fills gaps with a 25-flight minimum.
- **Risk badges agree with themselves.** The same flight showed V.HIGH on the Schedule board and LOW on its My Flights card (missing inputs defaulted to LOW); cards now reuse the board's computed score, or say "RISK N/A" — never a fabricated LOW.
- The dead "Delayed" status filter works: the provider's Delayed status now maps to the delayed key instead of disappearing into "Estimated".
- Aircraft registrations are validated (a model string like "B737M9" served in the registration field now renders as "—" instead of passing through).
- Starlink departures board times are hub-local with a timezone label, matching the Schedule tab (they were unlabeled viewer-local — the same flight showed two different wall clocks on one page).
- Schedule search is findable and consistent: a "Find in board" input on the toolbar filters rows live (the only board filter used to hide inside the collapsed Filter drawer), the header search placeholder no longer switches to aircraft-lookup wording on the Schedule tab, and a failed lookup shows inline feedback instead of a blocking modal.
- Watch notifications no longer fire on transitions into "Unknown" ("UA675: Unknown (was: Departed)" was pure noise); only meaningful status changes notify.
- The Check-a-Connection inputs submit on Enter.
- The GATE column is honestly labeled TERMINAL, both OTP tooltips state the same definition ("% of operated departures within 30 min of schedule"), "(412 opr)" reads "(412 operated)", and the mobile first viewport now shows the data-attribution and not-affiliated disclaimer via the ticker rotation.

### Added
- **IROPS-aware cache warming**: when a hub has an active FAA program, its today board jumps the warm-cron queue every run (displacing lower-priority slots, never growing the cron's budget) — attacking the root cause of stale boards during disruptions.

## [1.5.25] - 2026-07-03

### Fixed
- Cold-loading the dashboard can no longer strand it on "NO DATA": the FR24 live feed occasionally 200s with a meta-only body (zero aircraft), which the API cached and the client treated as a valid empty feed — wiping the map and hub boards for over a minute with a "Retrying automatically" banner that never retried. The API now rejects empty feed bodies as a 503 (`no-store`, never cached), and the client treats a zero-flight payload exactly like a failed fetch: it keeps the previously rendered data and retries fast (5s → 10s → 20s → 30s cap), so "Retrying automatically" is now true.
- The NO-DATA message no longer renders clipped behind the fixed header. It was absolutely positioned inside a zero-height container, pinning the one message that explains an empty dashboard to the top edge where the header covered it; it now centers in the viewport below the header at all widths.
- The floating news banner and tip strip no longer cover or intercept board controls (the Schedule "Tomorrow" date pill was unclickable until the banner was dismissed, and Starlink table rows scrolled underneath them). Non-map tabs now reserve a layout band for visible capsules instead of letting them overlap content.
- The header LIVE/STALE freshness chip no longer flaps on every poll. It mirrored the CDN's stale-while-revalidate cache header, flagging 12-second-old data as STALE; it is now keyed to actual payload age (LIVE under 3 minutes since the last good feed). The mobile mixed-signal bug (yellow dot next to "LIVE") is fixed the same way — the failure tint is reset on recovery so dot and label always agree.
- `SCHEDULE_OFFICIAL_FALLBACK_ENABLED=false` now actually disables every FR24 Official API caller. The flag was read only by the targeted same-day rescue, so the general scraping-outage fallback — plus `/api/fr24-flight` and `/api/aircraft-history` — kept calling the paid API (and logging 402s roughly every half hour while credits were exhausted). All official-API paths now gate on one shared helper (`api/_official-fr24.ts`); the two user-facing endpoints return an honest 503 instead of silently failing upstream.
- Restored the `[1.5.17]` changelog entry (including its Security section), which was silently dropped by a June merge-conflict resolution.

### Security
- All cron/webhook endpoints (`sync-starlink`, `refresh-metar`, `refresh-tsa`, `news-notify`) now authenticate through the shared timing-safe, fail-closed helper. Three of them compared the raw header against `Bearer ${CRON_SECRET}` directly — a pattern that authenticates anyone sending `Bearer undefined` if the secret were ever unset (latent only; the secret is set in prod).
- `sql/012` documents the true access contract on `cep_review_comments`: the anon INSERT path is INTENTIONAL and load-bearing — it serves the external krpd design-review site (krpd-cep-site.vercel.app), which submits comments via this database's public anon key. The audit briefly revoked it as a spam vector (finding zero consumers in this repo), which broke krpd comment submission; it was restored the same hour, owner-approved, and the accepted risk plus the check-external-consumers-first lesson are now recorded in the migration itself. Anon UPDATE stays revoked (sql/011); public SELECT stays intentional.
- Upgraded `astro` 6.4.2 → 6.4.8, clearing a high-severity SSRF advisory (GHSA-2pvr-wf23-7pc7) and a moderate XSS advisory (GHSA-jrpj-wcv7-9fh9) — the only vulnerabilities in the dependency tree reachable from production surface.

### Changed
- Added the standard `mobile-web-app-capable` meta tag alongside the deprecated `apple-` variant, silencing the Chrome deprecation warning.

## [1.5.24] - 2026-07-02

### Fixed
- The STARLINK tab no longer raises a false "INTEGRITY ALERT" during the normal sync window. The served fleet comes from a 4-hourly snapshot while the disputed-tails ledger is near-live, so a tail verified minutes ago could look like a pipeline fault for up to 4 hours (observed live for N34131). The alert now fires only when the served snapshot post-dates the verification and still contains the tail — a genuine pipeline problem.
- Schedule status text no longer mixes casings: provider-confirmed rows ("departed", "expected") are capitalized to match the inferred statuses ("Departed", "Landed") in the same column.
- The FR24 official fallback no longer attempts tomorrow-window boards it can never serve — FR24 rejects any window starting tomorrow (UTC) with a validation 400, so each attempt only wasted an upstream call, a circuit-breaker slot, and produced recurring error-log noise (222 occurrences for EWR alone since April).
- Quota-block log lines no longer print nonsense negative durations ("active for -1783016316s") on serverless instances that learned of the block from the Supabase mirror rather than seeing the 402 themselves.

### Changed
- The sync-starlink cron now logs a one-line success summary (aircraft count + sync time), so a silently shrinking fleet or a snapshot write degrading to a no-op is visible in runtime logs instead of hiding behind a bare 200.

## [1.5.23] - 2026-06-29

### Fixed
- The Schedule tab no longer shows flights that have already departed as "Scheduled." The data provider marks many flights "Expected" and never sends an actual-departure time, so a flight that left hours ago kept its "Scheduled" badge indefinitely — and the "Upcoming" count and the Scheduled status filter counted it as still to come. A pilot sorting EWR departures at night saw ~29 "scheduled" flights when over half were already airborne. Now a flight whose departure (or arrival) time is more than an hour past, with no actual time reported, is shown as Departed/Landed, so the Scheduled filter and the Upcoming count reflect what is genuinely still to go. The reclassification is anchored to the schedule server's clock, so a device with a wrong local time can't hide upcoming flights, and a watched flight only fires a "departed/landed" alert on a real provider update, never on this time-based inference.

## [1.5.22] - 2026-06-29

### Changed
- The "Explain Delay Risk" AI analysis now runs through Vercel AI Gateway instead of calling Anthropic directly, so its spend is tracked in one shared dashboard alongside the project's other AI features — at zero markup, with the same Claude Haiku model and prompt caching preserved. Graceful degradation is unchanged: a budget or credit outage (the gateway's `402`, the analog of Anthropic's billing `400`) trips the same circuit breaker and shows the calm "AI delay analysis is temporarily unavailable" message, with the risk score and contributing factors still visible.

## [1.5.21] - 2026-06-19

### Fixed
- Stale schedule boards show a staleness banner again. A complete board served from cache past its fresh window is correctly flagged `stale` but `degraded:false`, and the dashboard banner only checked `partial`/`degraded` — so an hours-old complete board (e.g. an 18h-old arrivals board) rendered with no warning at all. The banner now also fires on `stale`, with amber (1–6h) → red (6h+) age escalation and an honest "Showing complete data from Xh ago" message instead of the misleading "Some flights may be missing."
- The manual connection checker no longer blames the user for a backend outage. While the flight-times feed is unavailable (an HTTP error) it now shows "Flight times are temporarily unavailable" rather than "Could not find one or both flights. Check the flight numbers." — which it displayed for every valid input while the feed was down. A genuine 200-but-not-found still shows the check-the-numbers message.

### Changed
- `/api/aircraft-history` returns HTTP 200 with `success:false` (instead of 502) when the upstream FR24 API declines on billing/auth/rate limits (402/403/429). The frontend degrades identically, but this stops a known-dead upstream from being the site's only 5xx — which polluted the error dashboard and would trip any uptime canary. Genuine upstream 5xx and network faults still return 502.
- The "AeroDataBox daily unit budget exhausted" log warning is throttled to once per instance per UTC day instead of firing on every gated request (previously dozens per hour for ~11h a day), so it no longer buries genuine warnings.

## [1.5.20] - 2026-06-10

### Changed
- Static JS/CSS now caches for an hour (with a day of stale-while-revalidate) instead of being re-downloaded on every page load — repeat visits and reloads are noticeably lighter. The HTML entrypoint stays uncached, so a new deploy is still picked up promptly.
- Hub pages stop polling live flight data when their tab is in the background, and refresh once when you switch back. A backgrounded hub tab was previously making ~2,880 requests a day for data nobody was looking at.
- The TSA wait-times refresh job now runs hourly instead of every 5 minutes. The underlying government feed (MyTSA) has been decommissioned, so the API now reports an honest `feedDown` state instead of stamping an empty response as fresh data, and the page no longer burns ~576 refreshes a day against a dead source.

### Fixed
- The social share image is now exported at its declared 1200×630 size (was a 1.3MB 2588×1540 file), and `/favicon.ico` no longer 404s.

### Removed
- Deleted ~1,900 lines of dead code and ~760KB of stray build artifacts (an orphaned hub-data file, two broken one-off scripts, debug screenshots, an unused web font) that shipped in every deploy.

## [1.5.19] - 2026-06-10

### Fixed
- The site's announcement channel works again: the stale "Data feeds restored" banner (which rendered invisibly behind the fixed header and could never be dismissed) is deleted, and the news banner now renders in the canopy z-765 slot below the header with a reachable, persistent dismiss.
- The schedule footer no longer re-credits Flightradar24 on every render (`updateSchedTzFooter` rewrote the static attribution fix at runtime).

### Security
- `/api/fr24-usage` (paid FR24 billing/credit telemetry) now requires the cron Bearer secret, responds `Cache-Control: private, no-store` so the shared CDN can never serve an authorized response to unauthenticated requests, and the admin dashboard widget that called it was removed (a browser must never hold the spend-capable cron secret). Owner access: `curl -H "Authorization: Bearer $CRON_SECRET" https://theblueboard.co/api/fr24-usage`.
- `sql/010_waitlist_drop_open_policy.sql` drops the original `WITH CHECK (true)` anonymous-INSERT policy on the waitlist (verified still active in prod alongside 006's validated policy — permissive-OR meant the open one won). Apply manually via the Supabase SQL editor.

### Compliance
- Schedule data is now correctly attributed to AeroDataBox everywhere (header micro-attribution, schedule footer, Sources panel, disclaimer modal); Flightradar24 remains credited where it is genuinely the source (live aircraft positions). Misattribution violated AeroDataBox's terms on the exact plan the product pays for.
- Both maps now display OpenStreetMap/CARTO attribution (dark-theme styled control) and the Sources panel lists the basemap — resolving an ODbL license violation that risked basemap revocation.
- Outbound email is CAN-SPAM-aligned: the news digest (Resend broadcast) carries a one-click unsubscribe link, the waitlist welcome (transactional) carries an honest mailto unsubscribe plus a `List-Unsubscribe` header, and both link the new privacy policy and render a postal address once `EMAIL_POSTAL_ADDRESS` is set.
- New `/privacy` page (plain-English, code-verified claims: what's collected, where it lives, how to unsubscribe/delete), linked from the dashboard legal menu, the shared site footer, and every email.

## [1.5.18] - 2026-06-10

### Added
- Operational alerting (supersedes PR #168): when `ALERT_WEBHOOK_URL` is set, the hourly warm cron posts a Discord alert on the signatures that mean the live site is degraded right now — total warm failure, frozen/stale-served boards (the warm didn't actually refetch), 0-flight boards, AeroDataBox spend ≥80% of the daily budget, or the Starlink feed down. Throttled to one alert per 5 minutes; alerting failures never affect the cron itself.
- Post-deploy smoke check (`.github/workflows/post-deploy-smoke.yml`): every push to main waits for the Vercel deploy and curls the homepage, the Starlink API, and a live schedule board with retries — the first automated signal for the merge-equals-deploy pipeline (previously a broken deploy was only discovered by visiting the site).


## [1.5.17] - 2026-06-10

### Fixed
- The site's announcement channel works again: the stale "Data feeds restored" banner (which rendered invisibly behind the fixed header and could never be dismissed) is deleted, and the news banner now renders in the canopy z-765 slot below the header with a reachable, persistent dismiss.
- The schedule footer no longer re-credits Flightradar24 on every render (`updateSchedTzFooter` rewrote the static attribution fix at runtime).

### Security
- `/api/fr24-usage` (paid FR24 billing/credit telemetry) now requires the cron Bearer secret, responds `Cache-Control: private, no-store` so the shared CDN can never serve an authorized response to unauthenticated requests, and the admin dashboard widget that called it was removed (a browser must never hold the spend-capable cron secret). Owner access: `curl -H "Authorization: Bearer $CRON_SECRET" https://theblueboard.co/api/fr24-usage`.
- `sql/010_waitlist_drop_open_policy.sql` drops the original `WITH CHECK (true)` anonymous-INSERT policy on the waitlist (verified still active in prod alongside 006's validated policy — permissive-OR meant the open one won). Apply manually via the Supabase SQL editor.

### Compliance
- Schedule data is now correctly attributed to AeroDataBox everywhere (header micro-attribution, schedule footer, Sources panel, disclaimer modal); Flightradar24 remains credited where it is genuinely the source (live aircraft positions). Misattribution violated AeroDataBox's terms on the exact plan the product pays for.
- Both maps now display OpenStreetMap/CARTO attribution (dark-theme styled control) and the Sources panel lists the basemap — resolving an ODbL license violation that risked basemap revocation.
- Outbound email is CAN-SPAM-aligned: the news digest (Resend broadcast) carries a one-click unsubscribe link, the waitlist welcome (transactional) carries an honest mailto unsubscribe plus a `List-Unsubscribe` header, and both link the new privacy policy and render a postal address once `EMAIL_POSTAL_ADDRESS` is set.
- New `/privacy` page (plain-English, code-verified claims: what's collected, where it lives, how to unsubscribe/delete), linked from the dashboard legal menu, the shared site footer, and every email.

## [1.5.16] - 2026-06-10

### Fixed
- Schedule boards no longer freeze after their first fetch of the day. Every cache-fallback serve path hardcoded `disableProviderFallback`, so a board fetched once (usually the evening before, as "tomorrow") was served stale all day while self-reporting completeness 1.0 — live delays, cancellations, and gate changes never appeared. The warm cron now sends an authenticated `forceRefresh` that actually refetches the board, background refreshes may use the provider once data is older than 3h (one provider refresh per board per hour), and a warm that comes back stale, degraded, CDN-cached, or otherwise un-refetched counts as a FAILED warm instead of a green "ok".
- The warm rotation now refreshes every today board 3×/day (~every 8h) and each tomorrow board once, on an hourly cron — ~288 AeroDataBox units/day, exactly the metered-plan budget that previously went unspent. Warm day-keys are computed with the DST-safe hub-local helper, so pre-6AM slots no longer spend quota on mislabeled yesterday boards.
- The degraded-board banner now shows a humanized data age ("30h ago", not "1775m ago"), escalates teal → amber → red as the board ages past 1h/6h, and no longer promises a refresh that wasn't happening.
- A run of the warm cron that warmed no schedule board returns 503 so Vercel cron monitoring goes red during exactly the frozen-board incident class (the always-green Starlink ping no longer masks it).

### Security
- `/api/schedule` now rejects non-United-hub airport codes and snaps timestamps to the hub-local day start. Previously any 3-4 letter code at 1-second timestamp granularity busted all four cache tiers and fired two metered AeroDataBox calls per unique combination — one IP at the allowed rate could drain the monthly quota in under two hours, recreating the June outage on demand.
- Provider spend now has a cross-instance daily unit budget (default 400, `AERODATABOX_DAILY_UNIT_BUDGET`; `0` is honored as a kill switch) persisted via an atomic Supabase counter (`sql/009_provider_spend.sql` — apply manually in the SQL editor). Authorized cron warms bypass the organic budget (they are ring-bounded) but keep a hydrated 3× absolute ceiling so even a leaked cron secret cannot spend unboundedly.
- Cron authorization is now timing-safe and fails closed when `CRON_SECRET` is unset (the literal string "Bearer undefined" previously authenticated), shared via `api/_cron-auth.ts`.
- Any `forceRefresh`-flavored request responds `Cache-Control: no-store` regardless of authorization, so an unauthenticated probe of the predictable warm URL can no longer pin a 6h CDN object on the cron's own URL key and re-freeze boards behind a green cron.

## [1.5.15] - 2026-06-07

### Changed
- Schedule warming is now today/tomorrow-focused and conservative by default so it fits a metered AeroDataBox plan: `SCHEDULE_WARM_TASKS_PER_RUN` defaults to 2 (was 4), yesterday's historical board is served on-demand instead of warmed every cycle, and a clean today board is cached for 6h at the edge (was 3h). Together these roughly halve the worst-case monthly provider spend.

### Fixed
- Warm-schedule rotation now advances one stride per cron fire (slot aligned to the 2h cron interval), so consecutive runs cover every today/tomorrow window with no gaps. The previous 15-minute slot striding against a 2h cron skipped most windows.
- AeroDataBox 429/503 give-up now logs the response body and remaining-quota header, so monthly-quota exhaustion is visible in the logs instead of silently degrading to empty boards. The warm cron also logs an estimated AeroDataBox unit spend per run.

## [1.5.14] - 2026-05-16

### Fixed
- Same-day schedule requests now have a no-credit live FR24 feed rescue. If the full schedule scrape and paid scraper/provider fallbacks are unavailable, the API returns active United flights for the selected hub/direction instead of a 0-flight board.
- The dashboard now labels live-feed schedule rescue rows as degraded active-flight data and excludes them from on-time percentage calculations because their times are last-seen/ETA values, not true schedule baselines.

## [1.5.13] - 2026-05-16

### Fixed
- Same-day official schedule rescue now covers NRT and GUM too, so every United hub can recover visible rows when direct FR24 schedule scraping fails and paid FR24 credits are available.
- ScrapingBee schedule recovery now defaults to `render_js=false`, reducing scraper credit burn for the FR24 JSON endpoint once the ScrapingBee quota is available.

## [1.5.12] - 2026-05-16

### Added
- Schedule scraping now has a production scraper transport for FR24 blocks. When the direct FR24 schedule JSON scrape hits a Cloudflare/rate-limit block, the API can fetch the same FR24 endpoint through a configured scraping transport, normalize the returned schedule, and keep provider APIs as later fallbacks rather than the primary rescue path.

### Fixed
- Background schedule warming now also disables scraper fallback with `scraperFallback=0`, so paid scraping credits are reserved for users actively loading schedules.
- Empty partial schedule cache entries are bypassed when a scraper transport is configured, so users are not kept on a known-bad 0-flight response while the FR24 scraper can recover rows.

## [1.5.11] - 2026-05-16

### Added
- Schedule recovery now has an optional AeroDataBox airport FIDS fallback. When public FR24 scraping fails on a direct user request, the API can fetch structured scheduled departures/arrivals, normalize them into the existing dashboard flight shape, and persist them through the normal schedule snapshot cache.

### Fixed
- Background schedule warming now also disables provider fallback with `providerFallback=0`, so the free AeroDataBox tier is reserved for users who are actively loading schedules.
- Empty partial schedule cache entries are bypassed when a provider key is available, so users are not kept on a known-bad 0-flight outage response while a structured fallback could recover rows.

## [1.5.10] - 2026-05-16

### Fixed
- Same-day schedules now recover visible rows when public FR24 scraping is challenged and the official FR24 summary API only returns actual takeoff/landing data. The API normalizes those actual-only records into degraded schedule rows with flight number, route, aircraft, registration, status, and time instead of returning 0 flights.
- Actual-only schedule rows are marked as degraded and no longer feed the dashboard on-time calculation as if actual time equaled scheduled time. The banner now explains that same-day actual flight times are being shown because scheduled times are unavailable.
- User-triggered same-day official fallback is enabled by default again, while cron warmers still opt out and `SCHEDULE_OFFICIAL_FALLBACK_ENABLED=0` remains a kill switch.

## [1.5.9] - 2026-05-16

### Fixed
- Schedule outages no longer burn FR24 official API credits from background warming. The cron warmer now requests schedule data with official fallback disabled, so a public FR24 scrape outage cannot silently drain paid credits across every hub and day window.
- Empty partial schedule responses now cache briefly and report as degraded. Users still see the upstream outage state, but Vercel no longer keeps 0% schedule payloads around like healthy data, and cron no longer counts partial empty schedules as successfully warmed.
- Official FR24 fallback now stops immediately on exhausted credits or invalid summary windows instead of retrying. The schedule fallback is opt-in via `SCHEDULE_OFFICIAL_FALLBACK_ENABLED`, limited to same-day windows, and guarded by a 30-minute quota block after a 402.
- The dashboard no longer retries known first-page schedule outages three times in the browser. It still retries partial page/deadline failures, but it does not multiply traffic when the upstream source fails before returning any flights.

## [1.5.8] - 2026-05-03

### Fixed
- Starlink badges no longer waste 10s of function time per request when the upstream is unreachable. `api/predict-flight.ts` now keeps a 60s negative cache: the first connect failure poisons the in-memory flag, and every subsequent call inside that window returns 502 immediately without re-attempting the dead host. Upstream timeout tightened from 10s to 4s. The flag clears on the first successful response, so recovery is automatic.
- ICAO callsigns like `UAL123` now normalize to `UA123` before being forwarded upstream. Previous logic treated `UAL123` as already prefixed and sent it through unchanged, which the upstream rejects. Same fix applied to both `api/predict-flight.ts` and the new `api/check-flight.ts`.
- Dashboard Starlink-badge fetcher now uses local-date formatting (`toLocaleDateString('en-CA')`) instead of UTC. Users west of UTC after roughly 5 PM local were silently sending tomorrow's date and getting no matches every evening.
- Dashboard prediction cache is now keyed on `flight|date`, so leaving the tab open across midnight or revisiting a recurring flight number on consecutive days no longer reuses yesterday's result.

### Added
- `api/check-flight.ts` — a new proxy targeting upstream's documented `/api/check-flight` endpoint (the contract the upstream maintainer has committed to keeping stable). Server-side adapter maps `{hasStarlink, confidence: "verified"|"likely"}` to a probability score so existing badge UI renders without changes. Same defenses as predict-flight: origin gate, per-IP rate limit (20/min), 4s timeout, 30-min positive cache, 60s negative cache.
- Dashboard now calls `/api/check-flight` instead of `/api/predict-flight`. Predict-flight stays in place (with the new defenses) for any external consumers; the dashboard migration moves us off an undocumented upstream endpoint.
- `tests/check-flight.test.js` — 14 tests covering the proxy: 405/400 paths, upstream connection failure, status forwarding, the three adapter cases (verified/likely/no-match), UAL prefix normalization, User-Agent header, both negative-cache behaviors (in-window short-circuit and post-window probe).
- `tests/predict-flight.test.js` — 3 new tests: UAL prefix normalization, in-window negative-cache short-circuit, and post-window upstream probe via `vi.useFakeTimers`.

## [1.5.7] - 2026-05-03

### Fixed
- Flight popups no longer mislabel mainline aircraft as "(not in mainline fleet DB — likely United Express)" when opened during the brief window before the fleet database finishes loading. The fleet DB load was deferred via `requestIdleCallback`, so flights that rendered first could be clicked before `FLEET_BY_REG` populated, causing every `matchAircraft` call to return null. Fleet load now blocks `initApp` so the lookup is always ready by the time popups can open.
- Any popup left open across the (now near-impossible) race window auto-rerenders once fleet data arrives, so users never see stale "Loading aircraft data…" text.
- The fallback popup string is honest: `Loading aircraft data…` while the DB is empty, and `not in mainline fleet DB — likely United Express` only when the lookup actually misses (genuine United Express tails).

### Added
- `tests/fleet-data.test.js` — fleet.json data integrity (1000+ entries, valid N-numbers, unique regs) and a regression test that asserts N66808 resolves to a 737-900ER mainline entry through the same lookup path the dashboard uses.

## [1.5.6] - 2026-04-24

### Security
- Dashboard flight popup no longer renders unescaped gate/terminal strings from FlightAware/FR24. A malicious gate label in upstream data can no longer execute in the browser.
- News digest emails now escape article title and category, and strip control characters from the subject line. Authors can no longer inject HTML into the broadcast or inject SMTP headers via a crafted title.
- Content-Security-Policy `script-src` no longer allows `'unsafe-inline'`. All previously inline scripts and event handlers on the homepage have been moved to external files or delegated event listeners. `style-src 'unsafe-inline'` is retained pending a v1.6 inline-style audit.
- Waitlist writes now require `SUPABASE_SERVICE_ROLE_KEY` in production. The previous anon-key fallback silently sent a welcome email on every re-submission because anon had no SELECT policy on the waitlist table. The new lazy factory throws on first use instead of taking down unrelated API routes.
- Waitlist table now enforces email format, feature-request length, and source enum at the database level (`sql/006_waitlist_checks.sql`). Closes the anon-key end-run where someone could POST directly via `supabase-js` and bypass the API's validation and rate limit.

### Fixed
- News-digest broadcasts are atomic. The previous read → upsert → verify pattern allowed two concurrent calls for the same article to both broadcast. Now a single conditional `UPDATE ... WHERE slug != $new RETURNING *` serializes on the row lock (requires the seed row in `sql/005_news_notifications_seed.sql`).
- Waitlist welcome-email de-duplication now derives from the upsert's `created_at` timestamp within a 10-second window, instead of a pre-upsert SELECT that raced with concurrent first-time signups.
- Dashboard day-label buttons now use a shared hub-timezone helper (`src/lib/hubTz.js`). Previously, NRT/GUM viewed from the Americas could show the wrong day, and Pacific/Mountain/Central viewers would see a ±1 hour drift on DST spring-forward and fall-back days.
- News sitemap `<news:publication_date>` now emits full ISO 8601 (`YYYY-MM-DDT12:00:00Z`). Bare date was silently rejected by Google News.
- Anthropic delay-explain calls now enforce a 12s AbortController timeout. Previously, a slow upstream would keep billing tokens after Vercel killed the Lambda at 15s.
- FR24 flight lookup shares a single deadline across its two sequential calls — worst-case wall time is bounded regardless of how slow the first call runs.
- FlightAware HTML response is bounded to 500kb with a bounded regex capture, preventing catastrophic backtracking on malformed pages.
- `api/predict-flight.ts` rate limit now fires before the cache lookup, shielding upstream from 500+ unique flight-number floods.
- Dashboard refresh timer now chains off `refreshFlights().finally()`, avoiding no-op refresh attempts during in-flight fetches.
- Dashboard weather `IntersectionObserver` is disconnected before each recreate; the waitlist modal Escape listener is tied to an `AbortController` scoped to modal lifecycle.
- Clipboard share fallback now checks `execCommand` return value and prompts the user when the command silently fails, instead of flashing a false "Copied!".
- `news-notify.ts` no longer leaks raw `err.message` in 500 responses — errors are logged server-side and the client gets a generic message.
- Fleet filter no longer crashes on records with missing `r`/`c`/`t` fields.
- Fleet overview build no longer crashes when a fleet-type key is renamed (optional chaining).
- News sitemap `lastmod` is now per-article (uses the article date), improving Google indexing signals.
- `scripts/prewarm-cache.ts` now increments `failed++` for the IROPS/METAR/FAA loop too and exits non-zero on failure, so CI alerts fire on real outages.
- Schedule cron `WARM_TASKS_PER_RUN` capped at 4 (was 8). 8 × 58s would exceed the 300s Lambda limit; 4 × 58s = 232s, safely under.

### Added
- `src/lib/escape.js` — shared `escapeHtml` and `sanitizeHeaderValue`, reused by the dashboard popup and email builders.
- `src/lib/hubTz.js` — DST-safe hub-local date math used by both client and server.
- `tests/escape.test.js`, `tests/hubTz.test.js`, `tests/csp.test.js` — new regression coverage for the classes of bug above.
- `TODOS.md` — v1.6 "Trust Infrastructure" sprint backlog: integration tests for RLS, CI lint for inline scripts, circuit breakers, cost alerting, feature kill-switches, full CSP tightening.

## [1.5.5] - 2026-04-16

### Fixed
- `www.theblueboard.co/` (homepage) now redirects to apex `theblueboard.co/`. The existing `/:path*` rule in `vercel.json` doesn't match the empty root segment, so the homepage on `www` was serving 200 directly and duplicating the canonical URL. All non-root paths (`/fleet`, `/hubs/*`, `/news/*`) were already redirecting correctly. Adds an explicit `/` redirect alongside the catch-all. Caught by the 2026-04-17 canary run.

## [1.5.4] - 2026-04-04

### Added
- ARIA `aria-expanded` on sidebar filters toggle, watch panel, schedule advanced filters, and mobile more menu.
- ARIA `role=marquee` on ticker, `role=status` on stats bar, `aria-sort` on schedule table headers.
- ARIA dialog role on delay explain modal, `role` and `aria-label` on radar map container.
- Hub health tooltip now keyboard accessible.
- `scope=col` on all data table headers (fleet, airborne, starlink).
- `aria-label` on My Flights search, connection search inputs.
- `prefers-reduced-motion` on TSA page pulse animation and standalone Astro pages.
- `text-wrap:balance` on headings across hubs, news, fleet, TSA, and onboarding.
- `focus-visible` states on fleet, hubs, news, TSA, and 404 pages.
- `color-scheme:dark` meta on standalone pages.
- 8 new test suites: aircraft-history (19), delay-explain (14), starlink-data (6), cron endpoints (13), fleet-utils (36), buildMetadata (14), schedule snapshots (19), schedule-filters + flight-popup (expanded).
- 131 new passing tests (total: 495).

### Changed
- `font-display:optional` reverted to `font-display:swap` for JetBrains Mono to prevent permanent fallback on slow connections.
- Design system token migration: replaced 23+ hardcoded status and accent colors with CSS custom properties throughout `main.js`, `style.css`, and Astro pages.
- Border-radius values aligned with DESIGN.md spec (6px cards, 10px modals, 20px pills).
- Typography: `font-weight:600` on h3, heading font-families on breadcrumbs and hub links, `--font-display` on TSA headings.
- `contain:strict` on `.fleet-table-wrap` changed to `contain:content` to prevent 0-height collapse.
- Removed `will-change:transform` from static `body::before` grid overlay (unnecessary GPU promotion).
- Removed incomplete ARIA patterns: `role="listbox"` without `role="option"` children, `role="menu"` without keyboard navigation contract.
- CSS containment added to hub-card, mf-card, and source-item.
- GPU compositor promotion for body::before grid overlay.
- Stat value text contrast improved across dashboard, fleet, and sidebar.

### Fixed
- Schedule snapshot mock path resolved for worktree test environments.
- Fleet-family focus state and tab hover tokenization.
- TSA jump pill hover aligned with DESIGN.md spec.
- Hub card code and 404 page number contrast.
- Highlight box border-left changed from `--ua-blue` to `--ua-amber` per design spec.
- CTA button border-radius fixed to 6px (card scale).
- IROPS bar item border-radius fixed to 20px (pill scale).
- Off-palette `#3b82f6` replaced with design tokens.
- Modal border-radius standardized to 10px per DESIGN.md.
- News h3 weight corrected (700 to 600), fleet FAQ text color tokenized.

## [1.5.3] - 2026-04-04

### Added
- Skip-to-content link for keyboard navigation.
- ARIA tab roles on mobile bottom navigation, map control toolbar, and modals.
- Accessible label on Leaflet map container.
- `prefers-reduced-motion` support for all animations and transitions.
- Focus-visible indicators replacing blanket `outline:none`.
- 4 new test suites: NAS status, TSA wait times, predict-flight proxy, warm-schedules cron (60 new tests).
- Supabase module mock to unblock 26 previously crashing tests.

### Changed
- Parallelized fleet + Starlink data fetches with `Promise.all` for faster dashboard load.
- Upgraded basemap tile CDNs from `dns-prefetch` to `preconnect` for faster LCP.
- Added CSS containment to tab panels and sidebar to reduce layout recalculation.
- Optimized `fetchpriority` hints on CSS and fonts.
- Standardized CSS variables: `--mono` → `--font-mono`, `--bg-card` → `--ua-panel`, `--bg-body` → design system values.
- Standardized all accent colors to `--ua-accent` across 21 components, replacing hardcoded rgba values and off-palette colors.
- Improved contrast on hub health bar labels, watch panel headers, type badges, and small text.
- Replaced `transition:all` with explicit property transitions for performance.
- Standardized CTA hover color to `#0070cc` across all pages.

### Fixed
- Mobile search toggle and sidebar toggle visibility restored.
- Undefined text rendering in UI, fleet event listener leak, and weather interval leak.
- Missing `r.ok` check on FR24 flight lookup fetch.
- Concurrent IROPS rejection, TSA timeout leak, and cron URL handling.
- Origin validation on predict-flight endpoint.
- Undefined `--bg-body` and `--font-body` CSS variables.
- Waitlist modal design inconsistencies.
- Off-palette error status dot and flight marker colors.
- Supabase client fallback uses non-routable `localhost:0` instead of placeholder domain.
- Dead CSS aliases and old accent color remnants removed.

## [1.5.2] - 2026-03-29

### Changed
- **NAS Status panel redesigned as Priority Stack layout.** Items sorted by severity into CRITICAL / ACTIVE / MONITORING tiers with color-coded backgrounds. Most urgent restrictions (ground stops) always appear at the top. Replaces the flat active/planned list.
- Severity badges (GS, GDP, AFP, MIT, CDR, etc.) on every NAS item with color-coded pill matching the restriction type.
- Inline hub tags highlight which UA hubs are affected by each restriction.
- Header shows active/planned/hub counts at a glance.
- Added detection for DSP (Departure Spacing Program) restrictions.
- Hub deduplication prevents duplicate hub tags when the same airport appears in both departsAny and arrivesAny.

## [1.5.1] - 2026-03-28

### Fixed
- **NAS Status panel now visible** in the weather tab. The panel was rendered but hidden inside the radar map container (`overflow:hidden` clipping). Moved to the scrollable detail panel between IROPS bar and hub cards.
- NAS panel styling moved from inline styles to proper CSS classes using design system variables (`--font-mono`, `--font-display`, `--ua-amber`). Padding matches DESIGN.md highlight box spec.
- Added mobile responsive margin for NAS panel (10px to match hub card padding on small screens).
- Fixed CSS cascade bug where desktop `#nas-status-panel` margin rule overrode the mobile media query override (caught by Codex review).

## [Unreleased] - 2026-03-26

### Changed
- **Migrated from npm to Bun** as package manager and script runner (25x faster installs)
- Replaced `package-lock.json` with `bun.lock`
- Updated all `package.json` scripts from `node` to `bun`
- Vitest now runs under Bun via `bunx vitest run` (test files unchanged)
- GitHub Actions CI uses `oven-sh/setup-bun@v2` with pinned Bun 1.3.11
- Vercel build command updated to `bun run build`
- Dev script uses `bunx` instead of `npx` for Astro dev server
- Converted `prewarm-cache.sh` bash script to TypeScript with native `fetch`
- Converted `fix-fleet.cjs` and `rebuild-fleet.cjs` from CommonJS to ESM
- Added `@vercel/speed-insights` v2.0.0 and moved Speed Insights loading to shared Astro wrappers plus the dashboard bundle, replacing the hardcoded homepage script

### Added
- `@types/bun` for TypeScript support of Bun-specific APIs
- `scripts/prewarm-cache.ts` (TypeScript replacement for bash script)
- Regression coverage for the Speed Insights integration points across the dashboard entrypoint and static Astro documents

### Removed
- `scripts/prewarm-cache.sh` (replaced by TypeScript version)
- `fix-fleet.cjs` and `rebuild-fleet.cjs` (replaced by ESM versions)
- `package-lock.json` (replaced by `bun.lock`)

## [1.5.0] - 2026-03-25

**6 weeks, 300+ commits, and 70 merged PRs since launch day.** This is everything that shipped between v1.0 (Feb 12) and v1.5.

### Network & Coverage
- **9 hubs** (was 7) — added Tokyo Narita (NRT) and Guam (GUM) with full schedule, weather, and fleet support
- **Pacific view toggle** — transpacific route visualization with antimeridian-crossing fix
- **SEO-optimized hub pages** for all 9 hubs (`/hubs/ord`, `/hubs/den`, etc.) with structured data and canonical URLs
- **TSA Checkpoint Guide** (`/tsa`) — terminal-by-terminal Pre✓, CLEAR, Priority, and standard lane reference for all 7 domestic hubs

### Intelligence
- **AI-Powered Delay Explanations** — Claude Haiku explains why a flight is delayed in plain language, with inbound aircraft context and weather correlation
- **Delay Risk Engine v3** — 8-signal scoring: phenomena-aware weather, IROPS stress, ETA-based turnaround, historical OTP, hub congestion, equipment age, route complexity, and time-of-day patterns
- **Aircraft Journey Chain Tracking** — see where an aircraft has been and predict downstream delay propagation
- **Ops Impact Assessment** — flags snow, gusts ≥30kt, freezing precip, and thunderstorms even when VFR

### Fleet
- **Fleet Health Dashboard** — live fleet status with health categories, pie chart, and aircraft count by type
- **Fleet tab redesigned** — 3-zone layout with family grouping, fleet stats chips, and Starlink WiFi status
- **19 SEO-optimized fleet type pages** (`/fleet/737-max-9`, `/fleet/a321neo`, etc.) with structured data, full aircraft registry tables, and inter-type navigation
- **Special Aircraft Tracker** — named and special-livery aircraft panel
- **Aircraft Detail Modal** — click any tail number for registration, type, engine, status, live flight, and history
- **Equipment Swap Impact Analysis** — schedule tab highlights equipment changes with seat and amenity impact
- **Live Starlink Data** — replaced static database with live API feed and flight connectivity predictions

### Schedule & Data
- **Schedule Filters** — filter by route type (domestic/international), Starlink-equipped, time range, and delay risk level
- **Scrape-first FR24 routing** with circuit breaker — projected ~96-99% API credit savings vs. official-first
- **Background cache warming** — Vercel cron pre-warms schedule data for faster tab loads
- **Schedule resilience** — partial data instead of 502s, stale-complete fallback, retry with backoff

### News & Content
- **News Hub** (`/news`) — curated United Airlines articles with SEO-optimized pages, NewsArticle structured data, and OG/Twitter previews
- **Google News sitemap** (`/news-sitemap.xml`) and **dynamic RSS feed** (`/feed.xml`)
- **Email news digest** — waitlist subscribers receive a Resend-powered email when new articles are published
- **Rotating news banner** with crossfade animation on the dashboard

### Design & UX
- **Typography and color redesign** — Satoshi + DM Sans typefaces, amber accent palette, self-hosted fonts (zero FOUT)
- **Mobile-first redesign** — map-maximized layout, bottom tab bar, collapsible filters, touch-optimized controls
- **Weather tab** — 60/40 desktop split layout with compact IROPS stats bar
- **SVG plane icons** replace emoji for cross-platform accuracy
- **Onboarding overlay** — first-time welcome with home hub selection
- **Supporter Wall** — dashboard section recognizing project supporters

### Email & Engagement
- **Email signup with smart triggers** — new visitors: 90s / 8 clicks; returning visitors: 5min / 30 clicks; 7-day dismiss persistence
- **Welcome email** via Resend on first waitlist signup with de-duplication
- **Shareable flight links** (`?flight=UA1234`) with push notification watch alerts
- **PWA support** — installable home screen app with service worker

### Infrastructure
- **Astro migration** — hub pages built from shared templates (3,001 lines of duplicated HTML → 1,555 lines of templates)
- **TypeScript migration** — core API modules migrated for type safety
- **CSS extraction** — styles extracted from inline to dedicated stylesheets
- **JS modularization** — monolithic scripts split into focused modules
- **Automated sitemap** with build-time lastmod stamps
- **CI/CD** — `npm test` on all pushes and PRs
- **100+ unit tests** across schedule, fleet, weather, news, popup, and API endpoints

### Security & Performance
- **API rate limiting** — all endpoints protected with per-IP limits
- **XSS hardening** — innerHTML replaced with DOM node construction, all interpolations escaped
- **Supabase RLS** on waitlist table, prompt injection sanitization on AI endpoint
- **CORS hardening**, handler-level API timeouts, Anthropic SDK key isolation
- **Homepage speed** — deferred non-critical scripts, preloaded LCP tile, fixed Core Web Vitals
- **9 critical Codex code review findings** resolved across APIs, dashboard, and CI

## [1.4.0] - 2026-03-19

### Added
- **News Hub** (`/news`) — browse curated United Airlines articles with SEO-optimized pages, NewsArticle structured data, and OG/Twitter previews
- **Individual article pages** (`/news/[slug]`) — each article links to its source, cross-links to related hub and fleet pages, and includes a donation CTA
- **Google News sitemap** (`/news-sitemap.xml`) — makes articles eligible for Google News indexing
- **Dynamic RSS feed** (`/feed.xml`) — now includes news articles with publication dates (replaces the old static feed)
- **"Latest News" banner** on the dashboard — a dismissible banner between header and tab bar highlights the newest article, with per-article persistence via localStorage
- **Email news digest** — waitlist subscribers receive a Resend-powered email when new articles are published, with idempotent delivery tracking
- Dashboard navigation now includes a "News" link

### For contributors
- Shared `Footer.astro` component extracted from hub and fleet layouts
- `DESIGN.md` — formalized design system (color tokens, typography, layout, components, accessibility)
- News data validated at build time (slug format, required fields, duplicate detection, HTTPS-only sources)
- Tag resolver cross-links articles to hub and fleet pages with build-time warnings for unknown tags
- 20 new tests: 11 for news data model + tag resolver, 9 for news-notify endpoint (auth, idempotency, broadcast API)

### Changed
- Sitemap now includes `/news` index and all article pages
- `llms.txt` and `llms-full.txt` updated with news hub documentation
- `vercel.json` adds cache headers for `/news/*` and function config for `news-notify`
- `buildMetadata.js` extended with news lastmod path helpers

### Removed
- Static `public/feed.xml` (replaced by Astro-generated dynamic feed at `src/pages/feed.xml.ts`)

## [1.3.8] - 2026-03-17

### Added
- 19 SEO-optimized fleet type pages (`/fleet/737-max-9`, `/fleet/a321neo`, etc.) with structured data (Product, FAQ, BreadcrumbList schemas), full aircraft registry tables, and inter-type navigation
- Fleet overview index page (`/fleet`) with all 19 types
- Welcome email via Resend on first waitlist signup, with de-duplication for repeat submissions
- Rate limiter test for waitlist API (covers 429 response path)
- `text-wrap: balance` on headings in hub and fleet content pages

### Changed
- Dashboard section headings bumped from 10px to 11px with tighter letter-spacing for readability
- Body line-height set to 1.4 (was browser default ~1.2)
- Hub health bar touch targets enlarged (padding 2px→4px, min-height 28px)
- Header H1 letter-spacing reduced from 1.5px to 1px
- `color-scheme: dark` added to all page templates (dashboard, hub, fleet)

### Fixed
- Security hardening: Supabase service role key for server-side API, RLS on waitlist table, prompt injection sanitization on delay-explain endpoint
- Waitlist API uses upsert with conflict on email (prevents duplicates)
- Dynamic import for Resend to prevent function crash when module unavailable
- Fleet type deep links from dashboard now route correctly to static pages

### Removed
- Legacy `public/fleet.html` (replaced by Astro-generated fleet pages)

## [1.3.7] - 2026-03-15

### Fixed
- Normalized inconsistent WiFi provider names in Fleet tab — "Sat KA"/"Satl Ka"/"Satl KU"/"Satl Ku"/"ViaSatKA" now display as clean labels ("Satellite Ka", "Satellite Ku", "ViaSat Ka")
- Fleet WiFi filter dropdown collapsed from 8 duplicate-ish entries to 6 distinct, properly named options
- WiFi names now consistent across all views: fleet table, aircraft detail panel, flight popups, schedule enrichment, equipment swap comparison, and fleet match info

## [1.3.6] - 2026-03-12

### Changed
- Extracted `tryOfficialFallback()` helper to DRY up two fallback call sites in schedule routing
- Removed cron Phase 2 (tomorrow warming) — stays within Vercel 300s limit; tomorrow data loads on-demand
- Increased cron inter-hub delay (3s→12s) to avoid FR24 rate limiting across consecutive hubs

### Fixed
- Retry-After header now honored in FR24 scraping — releases concurrency slot during wait to avoid starvation
- Fixed potential double-release of FR24 concurrency slot when Retry-After triggers `continue` through `finally` block

### Added
- 2 new schedule tests: rate-limited mid-loop continuation, breaker-tripped partial result
- `fr24-usage.test.js` — 7 tests covering CORS, preflight, proxy, and caching for credit monitoring endpoint

## [1.3.5] - 2026-03-12

### Fixed
- Reduced frequent partial schedule data — lowered batch size (6→3) and increased delays to avoid FR24 rate limiting
- Rate-limited pages no longer abort the entire fetch loop — pauses 2s and continues with remaining pages
- Increased cron warmer inter-hub delay (1s→3s) to reduce FR24 burst pressure

### Changed
- Credit usage widget is now admin-only — visit `?admin` to enable, `?admin=off` to disable

## [1.3.4] - 2026-03-12

### Changed
- Inverted FR24 schedule routing — scraping is now primary, official API is fallback-of-last-resort (projected ~96-99% credit savings)
- Added `SCHEDULE_SOURCE_PRIORITY` env var for one-click rollback (`scrape` default, `official`, `scrape-only`)

### Added
- Circuit breaker on official API fallback — trips after 5 fallbacks in 15 minutes to prevent credit burn during sustained scraping outages
- `/api/fr24-usage` endpoint — proxies FR24 credit consumption data with 5-minute cache
- FR24 credit usage widget in dashboard footer — shows remaining credits with color-coded progress bar (green/yellow/red)
- 6 new schedule tests covering scrape-first routing, fallback, circuit breaker, and scrape-only mode

## [1.3.3] - 2026-03-12

### Fixed
- Hub health bar now shows all 9 hubs — previously only ORD displayed because schedule preload overwrote IROPS-derived data for hubs without loaded schedule data
- Consolidated two competing hub health renderers into a single `renderHubHealthBar()` function, eliminating a race condition between IROPS and schedule data paths

## [1.3.2] - 2026-03-12

### Changed
- Strip `hubFlights` from IROPS API response — reduces payload from ~4.6MB to ~100KB (schedule tab fetches its own data)

### Fixed
- Weather tab layout gap when hub cards are loading — added min-height to `.hub-cards` container

### Added
- CI/CD test workflow — `npm test` runs automatically on pushes to main and pull requests

## [1.3.1] - 2026-03-12

### Fixed
- Onboarding overlay no longer blocks tab interaction — tabs are clickable while the welcome modal is visible
- Alerts ticker no longer shows "0 mainline aircraft" before fleet data loads
- Offline banner no longer flashes briefly on page load for connected users

### Changed
- Search "no results" message now distinguishes flight numbers ("not currently airborne") from tail numbers ("not found in live feed")

## [1.3] - 2026-03-10

### Added
- **AI-Powered Delay Explanations** — Claude Haiku explains why a flight is delayed in plain language, with inbound aircraft context
- **Delay Risk Engine v3** — 8-signal scoring with phenomena-aware weather, IROPS stress, ETA-based turnaround analysis
- **Aircraft Journey Chain Tracking** — see where an aircraft has been and predict downstream delay propagation
- **Schedule Filters** — filter by route type (domestic/international), Starlink-equipped, time range, and delay risk level
- **Live Starlink Data** — replaced static Starlink database with live API feed and flight connectivity predictions
- **Fleet Stats Chips** — at-a-glance fleet statistics in the fleet panel
- **Clickable LIVE STATUS Card** — click to focus the flight on the map
- **"Daily Cockpit" v1.3 Feature Set** — My Flights, Delay Risk, Connection Risk, Home Airport
- **Background Cache Warming** — Vercel cron pre-warms schedule data for faster tab loads

### Changed
- **TypeScript migration** — core modules migrated to TypeScript for type safety
- **CSS extraction** — styles extracted from inline to dedicated stylesheets
- **JS modularization** — monolithic scripts split into focused modules
- **Architecture overhaul** — shared cache layer, hub data split, expanded test coverage
- **Official FR24 API** — schedule data now uses official FlightRadar24 API with scraping fallback
- **Cron interval** — warming interval changed from 5min to 15min to reduce API costs
- **Flight cards redesign** — compact inline row layout with reduced cache banner padding
- **UI/UX polish** — "Risk" renamed to "Delay" for clarity, improved feature discovery
- **SEO, security, and performance** — audited and hardened foundations
- **"View on Map" button** — now switches to LIVE tab first before focusing flight

### Fixed
- FR24 API: datetime format, pagination, field mapping, tomorrow skip, hub closure detection
- FR24 rate-limiting: adaptive handling, concurrency control, retry logic, browser User-Agent
- Schedule resilience: partial data instead of 502, non-fatal batching, stale-complete fallback
- Schedule gate format and hub cache warming
- Flight schedule: broken pagination, missing hub timeouts, restrictive flight regex
- Direction filtering with ICAO/IATA code matching
- Cron auth, IROPS performance, flight-times 404
- Client-side schedule cache: stop caching partial/empty results, stop IROPS from clobbering cache
- ORD international flights: parallel batching to fetch all schedule pages
- In-air flight status detection and watched flight map highlighting
- Flight-times API: prefer in-air flights over future scheduled
- Activity log scanning for in-air flight lookup
- Scroll on international flights (overflow:visible override)
- AI explanation: third-person voice, plain text output, explicit API key passing
- Schedule footer built with DOM nodes instead of innerHTML (XSS hardening)
- Recurring upstream data source failures for schedule data

### Security
- innerHTML replaced with DOM node construction in schedule footer
- Anthropic SDK API key passed explicitly (not leaked via env)

## [1.2] - 2026-03-01

### Added
- **Fleet Health Dashboard** — live fleet status with health categories, pie chart, and aircraft count by type
- **Special Aircraft Tracker** — named and special-livery aircraft panel in Fleet tab
- **Aircraft Detail Modal** — click any tail number for registration, type, engine, status, live flight, and history
- **Equipment Swap Impact Analysis** — schedule tab highlights equipment changes with seat and amenity impact
- **Unit test suite** — tests for API endpoints and operational logic
- **Shared API rate limiting** — all endpoints protected with per-IP rate limits

### Changed
- **Design/UX audit** — typography scale, contrast improvements, interaction polish across the app
- Hub weather cards moved above IROPS monitor in weather tab
- FAA endpoint: fragile regex XML parsing replaced with `fast-xml-parser`
- SEO & LLM discoverability improvements (structured data, meta tags)
- Typography unified: `var(--font-ui)` replaces `var(--mono)` on UI buttons
- Rate limiter prefers `x-real-ip` over `x-forwarded-for`

### Fixed
- Schedule tab loading: timeout, retry with backoff, clear error states on reload
- Ticker scrolling: proper content width measurement, GPU-accelerated animation, JS fallback
- Mobile schedule/fleet tabs hidden behind bottom navigation bar
- iOS Safari table rendering bug (overflow:hidden + sticky header killed tbody paint)
- Mobile ticker not rotating: skip desktop animation path, fix race condition
- Live Fleet Status panel empty on direct `#fleet` hash navigation
- Hash deep links fired data loads before app initialization
- Onboarding overlay logic inverted for first-time visitors
- Tab deep-link selector targeted `.tab-panel` instead of `.tab-content` with wrong display toggle
- Fleet status badge fallback color used CSS variable instead of raw hex
- Aircraft deep-link modal opened over onboarding overlay
- Nested scroll trap on mobile schedule tab

### Security
- Shared rate limiting on all API endpoints with per-IP tracking

## [1.1.1] - 2026-02-23

### Added
- **Astro migration** — hub pages now built from shared templates instead of 9 copy-pasted HTML files
  - `src/layouts/HubLayout.astro` — shared layout (CSS, footer, live script, nav)
  - `src/data/hubs.js` — all hub content and metadata in one file
  - `src/pages/hubs/[hub].astro` — single dynamic route generates all 9 pages
  - Adding a new hub = adding one object to the data file
- Branded 404 page — "Flight not found." with hub links and dashboard CTA
- Ops Impact Assessment — weather intelligence beyond flight categories (snow, gusts, freezing precip flagged even when VFR)
- Hub health cancellation rate detection (shows `100% CX` instead of grey dot when hub is shut down)

### Changed
- Build system: raw static files → Astro static site generator (build time ~600ms)
- 3,001 lines of duplicated hub HTML deleted, replaced by 1,555 lines of templates
- Updated OG image with latest UI screenshot
- README updated with changelog link, PWA, ops impact, mobile redesign, 9 hubs

### Fixed
- XSS: all innerHTML interpolations now escaped (`err.message`, `schedCurrentHub`, aircraft type codes)
- GUM/NRT hub pages: removed duplicate "Active Flights" stat, consolidated live panel layout

### Security
- Defense-in-depth escaping on all remaining innerHTML interpolations

## [1.1] - 2026-02-23

80 commits since launch.

### Added
- Shareable flight links (`?flight=UA1234`) with push notification watch alerts
- Departure & arrival times in flight popup (FlightAware + FR24 fallback)
- Tokyo Narita (NRT) and Guam (GUM) — now 9 hubs
- Pacific view toggle for transpacific route coverage
- Dedicated SEO-optimized hub pages for all 9 hubs (`/hubs/ord`, etc.)
- Ops Impact Assessment — flags snow, gusts ≥30kt, freezing precip, thunderstorms even when VFR
- Hub health cancellation rate detection (shows `100% CX` instead of grey dot)
- Dedicated fleet landing page (`/fleet`)
- PWA support — installable home screen app with service worker
- Engagement-based donation prompts, supporters wall, membership CTA
- `llms.txt` for AI discoverability
- JSON-LD breadcrumbs and Dataset schema markup
- Sitemap with all hub pages

### Changed
- Mobile-first redesign: map-maximized layout, bottom tab bar, collapsible filters
- SVG plane icons replace emoji for cross-platform accuracy
- Service worker rewrite: split caches, no cross-origin interception
- Core Web Vitals: deferred Leaflet, preloaded LCP tile, fixed INP
- IROPS data hydrates schedule cache for instant tab loading
- Hub health: sequential fetching with retries, timezone-aware rollover
- Donation CTA copy refined

### Fixed
- Transpacific routes crossing the antimeridian
- International Date Line flight track rendering
- Plane popover re-click and stale popup state
- OTP calculation: real timestamps required, min 5 flights, stale data clearing
- Hub health uses yesterday's data before 6 AM local
- Schedule API handler-level timeout for Vercel
- FR24 summary fallback when FlightAware blocked
- Schedule race condition and ticker min-width
- Weather summary contradicting actual METAR conditions
- Viewport-constrained layout (no scroll-to-see on mobile)

### Security
- XSS fix and CORS hardening (GUM/NRT rollout)
- 12 Codex code review findings resolved
- `robots.txt` blocks API/data crawling
- Handler-level API timeouts

## [1.0] - 2026-02-12

Initial public launch.

### Added
- Live flight tracking map (30s updates via FlightRadar24)
- Schedule tab with departures & arrivals at 7 United hubs
- Fleet database (1,078+ aircraft, Starlink WiFi status)
- Hub health bar with on-time performance
- IROPS monitor with disruption scoring
- Weather & delays: METAR, FAA monitoring, radar map
- Global search (flights, tails, routes, hubs)
- First-time onboarding overlay
- Buy Me a Coffee integration
- Server-side API proxies (no client-side keys)
- JSON-LD structured data, Open Graph metadata
- Vercel hosting with edge caching

[1.5.0]: https://github.com/notjbg/the-blue-board/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/notjbg/the-blue-board/compare/v1.3.8...v1.4.0
[1.3.8]: https://github.com/notjbg/the-blue-board/compare/v1.3.7...v1.3.8
[1.3.7]: https://github.com/notjbg/the-blue-board/compare/v1.3.6...v1.3.7
[1.3.6]: https://github.com/notjbg/the-blue-board/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/notjbg/the-blue-board/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/notjbg/the-blue-board/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/notjbg/the-blue-board/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/notjbg/the-blue-board/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/notjbg/the-blue-board/compare/v1.3...v1.3.1
[1.3]: https://github.com/notjbg/the-blue-board/compare/v1.2...v1.3
[1.2]: https://github.com/notjbg/the-blue-board/compare/v1.1.1...v1.2
[1.1.1]: https://github.com/notjbg/the-blue-board/compare/v1.1...v1.1.1
[1.1]: https://github.com/notjbg/the-blue-board/compare/v1.0...v1.1
[1.0]: https://github.com/notjbg/the-blue-board/releases/tag/v1.0
