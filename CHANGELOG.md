# Changelog

All notable changes to The Blue Board are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioned per [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.13.1] - 2026-10-04

**Tomorrow's board after midnight, and tooltips you can tap.** A full phone-and-desktop click-through of the live site (197 checks) found two real problems.

### Schedule boards
- **Tomorrow's board loads right after a hub's midnight.** When a hub passes local midnight, "tomorrow" becomes a day nobody has fetched yet, and the warm cron reaches it up to ~9 hours later. The AeroDataBox spend pacing (the UTC day starts at 7 PM CDT, so the US evening has the smallest allowance) held back the first load too. With no copy to fall back on and the FR24 web scrape Cloudflare-blocked from Vercel, the board read "Couldn't load". Seen live at 05:20Z Oct 4: **372 of 1,400** units spent against a paced line of 370, ORD and IAH tomorrow boards empty. Now the first load of a yesterday, today or tomorrow board with no copy anywhere may run ahead of the paced line by 10% of the daily budget (140 units, 35 boards). That headroom is measured on the shared cross-instance counter. The absolute budget, the explicit-0 kill switch and pacing for refreshes are unchanged, and other days stay fully paced. (`api/_cost-state.ts` `isAdbFirstLoadGated`, `api/schedule.ts`)
- **"Not loaded yet" is no longer called a failure.** When the budget does hold a board back, the server marks it `meta.providerDeferred`. The page then says "Still waiting on tomorrow's ORD departures… the schedule provider is paced to a daily limit" instead of "Couldn't load… from the schedule provider", and the banner no longer claims the source "is not responding". (`src/lib/schedule-load.js`, `ScheduleTable.tsx`)

### Tooltips on touch screens
- **Tap a "?" or a dotted term and it explains itself.** Radix tooltips open on hover and focus only, so on a phone the IROPS "What does this mean?" button, every jargon term and the hub-chip details did nothing when tapped. A touch or pen tap now toggles the tooltip, and a second tap or a tap elsewhere closes it. Mouse hover and keyboard focus are unchanged. The trigger's own action still runs, so a tapped hub chip still opens its hub guide. The toggle is applied after the event: on a real tap the trigger's focus opens the tooltip and Radix's close-on-click shuts it again, which is why a naive fix makes the *second* tap look like the first. Verified in Chromium with iPhone touch emulation: prod opens **0 of 2** tooltips on tap, this build **2 of 2**. (`src/components/ui/tooltip.tsx`, `src/lib/tap-tooltip.js`)

## [1.13.0] - 2026-10-04

**Every claim on the front page now holds up on a phone.** A Reddit commenter said "half the features don't work", so we audited each claim the post made: a live data audit of the nine hub boards (Oct 4, 00:36–01:28Z), plus phone QA at 360 and 390 px. This release fixes what failed. Before→after numbers come from offline replays of the new code on the same real boards, the live feed and the sightings ledger.

### Flight-watch alerts
- **Watch a flight and you hear when it departs, lands or runs late.** A watch follows one dated leg (scheduled departure plus origin). It no longer jumps to tomorrow's flight with the same number at hub midnight, and it ends quietly 3 hours after landing. Landed and departed come from the arrivals-board row for that leg plus the live-feed sightings ledger: airborne means departed, and seen on the ground at the destination after flying the leg means landed. That works for non-hub destinations too. On real `/api/flight-times` answers the new code called **6 of 6 landings and 6 of 6 departures** right; prod got them wrong. (`src/lib/watch-leg.js`, `api/flight-times.ts`, `api/cron/watch-alerts.ts`)
- **Delay alerts at 15, 30 and 60 minutes, then every hour**, from the estimated or actual gate departure, and never twice for the same band. (`src/lib/watch-rules.js`)
- **Alerts work on whatever tab you're on.** In-tab alerts used to come only from a Schedule-board reload. They now also fire from the My Flights polling path and the live feed, on any tab. Both sources go through one rule, so an alert never fires twice. The background push and the tab share that rule (`src/lib/watch-rules.js`) and only ever move forward. A spelling change ("En route" vs "En Route") is never news, and "Glad you landed" appears only on a real landing. (`src/app/state/watch-alerts.tsx`, `src/lib/watch-utils.js`)
- **A "Turn on notifications" button in the watch panel**, with states for on, blocked, iOS (add to Home Screen first) and unsupported. On a through flight (UA1872 MCO→IAH→MSP), My Flights now follows the leg the aircraft is actually flying. It ignores the other leg's live position, and the ETA stops counting once the aircraft is on the ground at the destination.
- One JSON log line per push (flight, leg date, old → new, reason, result), with no endpoint or other personal data.

### Boards that tell the truth
- **LIVE means airborne now.** The badge used to light for any recent sighting, including aircraft parked at the gate with the transponder on. It now needs a recent airborne fix for this flight, no earlier than 15 minutes before departure. Rows marked LIVE while the aircraft sat on the ground: **80 → 0**.
- **Landed flights say Landed.** An arrival the feed saw airborne on this leg and then on the ground at its destination reads **Landed\*** with "seen landing on the live feed", not "En Route" or "Expected · RISK". Landed aircraft still shown en route: **26 → 0**. Arrivals stuck "En Route" 90+ minutes after their arrival time: **7 → 0**.
- **Delays follow the evidence** (`src/lib/board-delay.js`). The cell uses the live-position ETA, a landing proved by the feed (shown as a floor, "≥"), or departure plus the scheduled block when the provider's estimate is physically impossible. Two examples: UA407 read **−75m** after leaving 38 minutes late and now reads **+38m**; UA1963 read **+0m** while still cruising past its arrival time and now reads **+79m**. A delay measured to wheels-up gets a takeoff icon and the words "from takeoff time; includes taxi". 298 runway-time departures are flagged that way on one snapshot. On airborne arrivals, delays more than 45 minutes off the live-position ETA: **12 → 0**.
- **One flight, one row.** The same flight number, route and tail listed twice collapses into the row with the best evidence, when the board is fetched and when it is served. Duplicate groups: **32 → 0**.
- **Express Starlink shows up.** United Express tails are not in the mainline fleet database, so their Wi-Fi read "—" even on aircraft the Starlink tab lists. Express rows showing Starlink Wi-Fi: **3 → 1,270**.
- "En Route" has one spelling. A missing airport code is recovered from the airport name. Flight numbers print without the provider's letter suffix ("UA526", not "UA526H"); the watch and deep links keep the raw number.
- `warm-schedules` adds one extra today-arrivals refresh per run, paid only while the day's AeroDataBox spend is under its paced line. `SCHEDULE_WARM_EXTRA_ARRIVALS=0` turns it off.

### The board on a phone
- **Below 768 px the schedule is a two-line list**, not a 1,065 px table with status, tail, Wi-Fi and the watch eye off-screen. Line one is time, flight, route, a status pill with LIVE, and the delay or RISK. Line two is tail · type · seats · Wi-Fi, with Starlink badged. Tapping a row opens the flight sheet. The watch eye is a 44 px target. The toolbar folds to two rows and the stat cards to a 4×2 grid. Rows fully on the first screen: **none → 5 at 360×780, 1 → 7 at 390×844**. Desktop and tablet keep the table.
- **The waitlist popup is now a strip.** It used to open over the board after five minutes or a run of clicks. Now a slim "Stay in the loop" line appears above the bottom nav. You can dismiss it, and a "no" holds for 30 days. The sign-up dialog opens only when asked for (the strip's button or `?waitlist=1`). Strip sign-ups are recorded as `source: 'dashboard'`.
- **Radar dots match their labels.** A dot took the worst-of ops colour, and "caution" is the same yellow as MVFR, so a rainy VFR hub wore MVFR yellow under a "VFR" label. Dots now use the flight-category colour, and ops impact shows as "VFR ⚠".
- The welcome dialog's button stays pinned. Hub chips are 44 px on touch screens. A phone shows one engagement strip at a time.

### Smaller fixes
- 219 more airports have time zones, so the flight sheet reads "8:40 PM CDT" instead of "your time".
- Tracker pages pluralise counts correctly ("1 flight", not "1 flights"). (`src/lib/plural.js`)
- Board markers always come with words. "Landed\*" carries "seen landing", "≥"/"≤" are read as "at least"/"at most", and the takeoff/touchdown icon carries its own sentence. The table and the phone row share that wording (`src/lib/schedule-row-display.js`).

**Deploy notes:** existing watches re-baseline silently on their first check after deploy, so no alert fires for a change that happened before it. The extra arrivals refresh is gated by `SCHEDULE_WARM_EXTRA_ARRIVALS`. CDN copies of boards can show old LIVE stamps for up to about an hour.

## [1.12.0] - 2026-10-03

### Fixed
- **A calm night no longer reads as a significant disruption.** On Saturday Oct 3 every hub was 83–96% on time, no hub had an FAA program, and there were no confirmed cancellations. The site still said "SIGNIFICANT DISRUPTION" on the Delays tab and "Disrupted" on the hub strip, and the ticker said "Elevated irregular ops". There were two causes. (1) Flights the schedule provider (AeroDataBox) listed as "Likely Canceled" counted as cancellations at triple weight, even when the live flight feed had seen them flying. At 22:54Z all 45 cancellations in the index were Likely Canceled and 38 of those flights had been seen airborne from their origin. Sep 30 – Oct 2 averaged 130–150 Likely Canceled departures a day against 0–3 confirmed. (2) The bands were set before the index measured delay at the gate, so every recent day landed in the top band. Scores for the whole day with the seen-flying flights removed: Oct 3 ≈ 18, Sep 30 (66% on time within 15 min) ≈ 23–27, Oct 2 (57%) ≈ 32–35, Oct 1 (46%) ≈ 34–38. The Jul 3 meltdown (151 cancellations, 17 ground stops) scored 56.7. On the live boards at 23:25Z, using any sighting as evidence, the index would have gone from 21.8 (SIGNIFICANT) to 16.7 (NORMAL) and cancellations from 55 to 11 (44 seen), and the hub strip and ticker from Disrupted to Smooth Ops. **Deploy note:** the bands change applies at once. Existing sightings have no airborne time and can't be backfilled, so the override only applies to flights seen airborne after this deploys. Flights that had already landed keep "Likely Canceled" until their flight number is seen airborne again. Expect the drop in the score to phase in over a few hours.
- **"Likely Canceled" flights that were seen flying now show as departed.** A row the provider marks CanceledUncertain becomes "Departed" when `reg_sightings` saw that flight number **airborne** from that origin (and, on an arrivals board, heading to that destination). Only an airborne sighting counts. The sightings table also records aircraft on the ground, because the tail ledger wants a tail as soon as the aircraft is at the gate. But a flight held on a taxiway with its transponder on during a ground stop, then cancelled, must never read as flown, or real cancellations would disappear on exactly the nights that have them. New column `reg_sightings.airborne_at` (`sql/016`, already applied to prod on Oct 3) stores the latest airborne sighting, using the dashboard's own ground rule (the feed's flag, or under 100 ft and 50 kt). Ground sightings are written in a separate upsert that never names the column, so taxiing in after landing never erases it. A database without the column falls back to the old row shape and keeps writing. The airborne time has to fall between 15 minutes before and 18 hours after the scheduled departure. An earlier wheels-up is far more likely to be a through flight's inbound leg than an early pushback. The browser's own live-feed check uses the same rule. The board labels the row "seen airborne" and shows LIVE while the sighting is fresh. An arrival becomes "Landed*" once it is well past due. No departure or landing time is made up from a sighting. Likely Canceled flights nobody saw stay Likely Canceled, because some are real. The rewrite happens when a board is served and is never stored, so a later sighting still applies. It reaches every surface: served boards (including the error path, which skipped the sightings merge before), the IROPS index, the browser's own live-feed overlay, the stat strip, the client IROPS fallback, and `/api/flight-times`. (`src/lib/reg-overlay.js`, `src/lib/cancellation.js`, `src/lib/schedule-status.js`, `src/lib/status-display.js`, `api/schedule.ts`, `src/app/views/schedule/*`)
- **No push for an unconfirmed cancellation.** The watch-alerts cron resolves flights through `/api/flight-times`, which reads stored snapshots and never saw `/api/schedule`'s sightings merge. A Likely Canceled flight therefore came through as `canceled_uncertain`, and the cron pushed "UA123: canceled_uncertain". Now a seen-flying flight resolves as departed. An unseen one is treated like Unknown: no push, and the stored status is not overwritten. A confirmed cancellation still pushes. The in-tab watch no longer alerts when a flight changes to Likely Canceled. It still alerts when the flight later changes to Departed or Canceled. To push the soft state again, remove the `isLikelyCanceledText` clause in `api/_watch-diff.ts`. (`api/flight-times.ts`, `api/_watch-diff.ts`, `src/lib/watch-utils.js`)

### Changed
- **New IROPS bands: Normal under 20, Minor 20–40, Significant 40+** (previously under 5, 5–15, 15+). They are defined once in `src/lib/irops-score.js` (`IROPS_MINOR_AT`, `IROPS_SIGNIFICANT_AT`), and the Delays tab tooltip now states them. They are based on four ordinary days and one meltdown, so they should be rechecked after the first real weather day (`docs/specs/irops-delay-measurement.md`). A ground stop or closure at a United hub, or any hub under 50% on time, still marks the network "Disrupted" whatever the index says. A ground delay program still marks it at least "Some Delays".
- **The Delays tab shows how many cancellations are unconfirmed.** `/api/irops` now reports `cancellationsLikely` (Likely Canceled and not seen flying, still included in `cancellations`) and `likelyCanceledSeenFlying` (not counted), both network-wide and per hub. The bar shows "incl. N likely" under the cancellation count, plus one line saying how many Likely Canceled flights were seen flying. The client fallback reports the same fields. `/api/irops` waits up to 5s for the sightings cache so that a freshly started server instance cannot count every seen-flying flight. A Likely Canceled row with a real departure time is no longer counted as a cancellation, which matches the board, where it already showed Departed. Per-hub cancellation rates for the delay-risk model come from the same corrected counts.
- `scripts/supporters-diff.mjs` ignores spacing, punctuation and case when checking whether a supporter is already on the wall. "Flyer Talk JCG1005" now matches "FlyerTalk JCG1005". (`src/lib/supporter-names.js`)

## [1.11.9] - 2026-10-03

### Changed
- **Phones get a support button in the header.** About 77% of visitors arrive on a phone, where the only donate link was two taps deep in More. Below `md:` the header's "?" slot is now a ☕ link to Buy Me a Coffee (counted as `support_click` from `mobile-header`). There was no room for a fifth control — 13 px spare at 360 px — so "What is this dashboard?" moved into the More sheet. Tablets and desktop are unchanged.

## [1.11.8] - 2026-10-03

### Changed
- **Social preview images show the current site.** `public/og-image.png` (the card for every shared theblueboard.co link) still showed the pre-v1.8.0 dashboard — emoji tabs, "Fleet: 1078". It's now today's Live Ops view, and all 15 section/hub/tracker cards in `public/og/` are regenerated from it with `scripts/generate-og.py`, which now shrinks a title that would run off the card ("What's United Building at Your Hub?" lost its "?").
- **README refreshed:** new screenshots (`docs/screenshots/`), fleet count 1,078 → 1,139 (Sep 28 snapshot), Starlink 500+ → 600+, schedule boards credited to AeroDataBox (not Flightradar24, matching the site's own attribution), cron and cache timings brought up to date (warm every 30 min, Starlink every 4h, no more "6h edge cache"), Supabase tables listed as they are, and the support section names the Supporters Wall and membership tiers.

## [1.11.7] - 2026-10-03

### Added
- **One more update-email image:** `public/email/2026-10/trackers-hubs.jpg` (the United hubs tracker, which now leads the email's Trackers section).

## [1.11.6] - 2026-10-03

### Added
- **Images for the October 2026 update email** in `public/email/2026-10/` (six JPEGs, 1120px wide, ~430KB total), served from the site's own domain so the sent email's images never break. `email/` joins the middleware matcher's static-asset exclusions.

## [1.11.5] - 2026-10-03

### Fixed
- **One mainline total on every tab.** The Starlink tab's rollout bar read "Mainline 263 / 1161" while Fleet and Stats said 1,139 mainline aircraft. 1,161 was the upstream Starlink tracker's own census, and it was the stale one. Our fleet database is a strict subset of it; of the 22 extra tails, 19 have no sighting in the 89 days of `reg_sightings` (Jul 6 – Oct 3): 16 A319/A320s (12 of them the tails the database retired on Sep 28), the undelivered 737 MAX 10 and two 787s not yet flying. Only 3 are new deliveries in service (N17482, N37469, N81113), so the tracker overstates the in-service fleet by 17 to 19 and the database understates it by 3. The Starlink tab's Mainline bar is now the Fleet tab's `starlinkMainlineShare()`: roster tails inside the fleet database over the fleet database (263 / 1,139 · 23%). The tracker's mainline total is only a fallback while the database is unavailable, and a line under the bars names each denominator (Express stays the tracker's count; we keep no Express database). (`src/lib/fleet-utils.js`, `src/lib/starlink-roster.js`, `src/app/views/StarlinkView.tsx`, `src/app/views/starlink/SlHero.tsx`, `tests/mainline-total-one-source.test.tsx`)
- **Hub pages print the real Starlink share.** Seven hub pages (ORD, DEN, IAH, EWR, SFO, IAD, LAX) said the 600+ equipped aircraft were "about 24% of the combined fleet". That was hand-typed; the roster is 616 of about 1,650 (37%). The share is now computed at build from the same roster snapshot as the fleet guides' per-type counts: mainline roster tails inside the fleet database plus the tracker's Express count, over the fleet database plus the Express fleet. The refresh script stores the Express counts from the same `/api/data` payload as the tails. A test recomputes it and fails on any other "N% of the fleet" in hub copy. (`scripts/refresh-starlink-facts.mjs`, `src/lib/starlink-facts.js`, `src/data/starlink-facts.js`, `src/data/hubs/*.js`, `tests/starlink-fleet-share.test.js`)
- **`/starlink` no longer 404s.** `/starlink` and `/starlink/` redirect (308) to `/#starlink`, the hash that opens the Starlink tab. (`vercel.json`, `tests/vercel-routes.test.js`)

## [1.11.4] - 2026-10-03

### Added
- **Supporters Wall:** JayS (Oct 3). Caught by `bun scripts/supporters-diff.mjs` on its first real run.

## [1.11.3] - 2026-10-03

### Fixed
- **Boards no longer show flights as Departed or Arrived at times that haven't happened yet.** At 17:55Z on Oct 3 the ORD boards had 13 rows with an "actual" time later than the clock. Two causes: (1) AeroDataBox sometimes returns yesterday's leg with its arrival moved forward a day. UA2113 LAX→ORD "left" Oct 2 17:58Z and "arrived" Oct 3 22:55Z, a 29-hour flight. The schedule repair copied that arrival into the scheduled arrival, which moved the old leg into today's board. (2) Rows marked Departed or Arrived whose time was still ahead: UA845 ORD→GRU showed Departed 9.5 hours before departure, and UA4422 showed Arrived 8 minutes before its gate time. Now an actual time more than 5 minutes ahead of the server clock is treated as an estimate, and the status steps back (en route if the flight really departed, otherwise expected). This check runs before the repair. A row whose departure-to-arrival span is longer than any flight (20h) is dropped and counted in `meta.filtered.staleLegs`. The snapshot guard counts those rows as intentionally dropped. Every board served by `/api/schedule`, and every flight `/api/flight-times` reads from a snapshot (the watch-alerts cron uses this path), is re-checked against the request time. Without that, a snapshot up to 3 hours old could still show an arrival that hasn't happened, or send a false "Landed" push. (`src/lib/schedule-actuals.js`, `src/lib/schedule-plausibility.js`, `api/_schedule-aerodatabox.ts`, `api/schedule.ts`, `api/flight-times.ts`, `api/_schedule-snapshots.ts`)
- **The "Glad you landed" toast now fires when a watched flight lands.** It checked whether the status text contained "landed", but AeroDataBox calls a landed flight "Arrived", so it never matched. The watch alert also ignored Expected → Arrived. "Landed" is now decided by the classified status, never by a presumed landing or a repeat. "Landed" ⇄ "Arrived" vocabulary flips no longer count as a change. (`src/lib/watch-utils.js`, `src/app/state/schedule.tsx`)
- **No ghost row after switching hubs.** Schedule rows were keyed by flight number and scheduled time. EWR listed UA3772 twice at 09:21, so two rows shared a React key. Keys now include the route and the aircraft, and a true duplicate gets a suffix. (`src/lib/schedule-row-model.js`)

### Changed
- **The phone "More" sheet now has About and Support The Blue Board.** On phones the ⓘ menu is hidden along with the attribution strip, which left no way to reach the About dialog (independence statement, safety line, Supporters Wall) or any donate link. This is the release's only visible UI change. Both are plain list rows; nothing opens on its own. (`src/app/shell/MobileNav.tsx`)

## [1.11.2] - 2026-10-03

### Fixed
- **Google Search Console "Datasets: Missing field 'description'" (critical).** The 15 per-airport tracker pages (`/trackers/atc/*`, `/trackers/united-hubs/*`) declared `isPartOf` as a name-and-URL-only `Dataset` node, which Google validates as a Dataset in its own right. They now reference the parent tracker's Dataset by `@id` (`/trackers/atc#dataset`, `/trackers/united-hubs#dataset`). `tests/structured-data-datasets.test.js` fails the build output if any Dataset node lacks a name or description. schema.org validator: 0 errors, 0 warnings.

## [1.11.1] - 2026-10-03

### Added
- **Six new names on the Supporters Wall:** @Benchilada129, Paul Leonard, Mickey Kopanski, /u/bcb354, james macnutt and Greg Calvert — every public Buy Me a Coffee supporter since the wall was last updated in February. The list now lives in `src/data/supporters.js`, pinned by `tests/supporters.test.js`, and `bun scripts/supporters-diff.mjs` lists any public supporter not on it yet (read-only; adding a name stays a manual edit).
- **Support-link click counts.** Every Buy Me a Coffee link (landed toast, About dialog ×3, legal menu, site footer, news articles) sends one anonymous `support_click` Web Analytics event labelled with its placement, so it's knowable which ones people actually use. One delegated listener covers the dashboard and every content page. (`src/lib/support-tracking.js`)

### Fixed
- **Custom analytics events were never recorded.** The dashboard called `window.va.track()`, but with the analytics script tag `va` is a function (`va('event', …)`), so every custom event since v1.8.0 — including the news-banner click count — was silently dropped. `src/lib/track.js` now owns the calling convention and queues events that fire before the deferred script loads.

## [1.11.0] - 2026-09-28

### Changed
- **Shorter titles and descriptions site-wide.** All 69 pages: titles ≤60 characters (were up to 127), search phrase first, " | The Blue Board" only where it fits; descriptions ≤160 (were up to 338). Counts in fleet titles are computed from data. News articles keep their full headline in the h1, JSON-LD and RSS; `<title>` uses a short `seoTitle`. A build-output test fails any page over the limits. (`src/lib/page-seo.js`, layouts, `tests/seo-lengths.test.js`)
- **Per-type Starlink counts on the fleet guides are computed at build time** from the live roster joined to the fleet database (was hand-typed). (`scripts/refresh-starlink-facts.mjs`, `src/data/starlink-facts.js`)
- **Numbers United hasn't published are gone:** the 787-9 Studio upsell price and Elevated projections (now United's own "33 by 2028"), 757 retirement windows; MAX 10 and A321XLR delivery expectations now come from United's Q2 2026 10-Q.

### Fixed
- **ATC tracker:** Dayton (20th) and Louisville (21st) are live on electronic strips per the FAA — 20 of the FAA's 22 now named; FLL and IAD noted as active on the FAA dashboard pending an announcement.
- **O'Hare:** the unsupported "~9,000 departures (~7.6%)" (a departures count paired with a seats percentage) replaced with the FAA's 2,708-operations/day cap (through Oct 30, 2027) and United's ~650 daily departures vs 780 planned.
- **Fleet Wi-Fi:** the sheet's Thales, ViaSatPrtl, ViaSatKA? and Panasnc codes now display correctly ("Thales Ka (US)" is a new Wi-Fi filter option), matching United's per-tail provider data. N777UA is parked at Victorville, not retired.
- Bot-walled united.com sources swapped for the matching United newsroom releases; the Guam MAX article says "unveiled", as United's release does.

## [1.10.0] - 2026-09-28

Information audit: every fleet, Starlink, hub, route, project and news fact re-verified against current sources; three new news articles; fixes from the post-v1.9.1 live audit.

### Added
- **News:** "Live Football at 35,000 Feet" (DISH live TV on Starlink seatbacks, Sep 17), "Keep Your Seat, Chase an Earlier One" (app standby for earlier flights, Sep 1), "Ten New Cities, Five on the XLR" (2027 international expansion, Aug 25).

### Changed — data accuracy
- **Fleet database refreshed to 2026-09-28** from the fleet sheet, with every new tail confirmed in the FAA registry: 1,078 → 1,139 aircraft (+49 737 MAX 9, +14 A321neo incl. the first A321XLRs, +11 787-9; 13 A319/A320 retired — out of the sheet and no flights in 84 days). WiFi/status/IFE/config updated; 250 mainline Starlink tails; the 9 Guam MAX 8s carry their 14-First/164-seat layout. Starlink roster 428 → 601. Fleet guide pages, `/fleet`, and llms files match.
- **Hubs:** Key Routes verified against five days of the site's own departure boards (partner codeshares excluded) and corroborated externally — routes United no longer flies removed, daily ones added, seasonal ones labelled; departures and destination counts dated to the late-September 2026 schedule; Narita's mainland service and LAX's Pacific role corrected; Guam Starlink claim corrected.
- **Trackers and hubs:** Dulles Concourse E and club → October 2026; LAX people mover → early January 2027; O'Hare → ORDNext dates ($8.8B); Newark–Tel Aviv resumed Sept 8; ATC fiber 65% (FAA, Sept 16) and the $30B funding request.

### Fixed
- **My Flights:** while a flight is airborne, the ETA comes from its live position and speed when the provider's estimate contradicts it by more than 30 minutes, so a flight 10 minutes out no longer reads "2h 18m" and the connection checker no longer calls a real connection "missed". A leg that has taken off is never shown as expected. The checker resolves a multi-leg flight number to the leg departing the connecting hub (`/api/flight-times?from=`).
- One "operated" definition for the Schedule header, `/api/irops` and the hub strip; Stats uses the Live tab's five phase buckets; the Fleet Starlink share names its denominator.
- ⌘K opens aircraft details for a registration on the ground; United Express Starlink tails show their Starlink status and current flight; earlier legs in Aircraft Journey show landed instead of unknown; the altitude bar is labelled; FAA runway annotations are stripped; one no-ceiling wording.
- Rollover warm priority displaces only tomorrow slots, never another hub's today board.

## [1.9.1] - 2026-09-28

### Fixed
- **Filtered schedule boards are stored again.** v1.9.0 drops partner codeshares and other-day rows, so a correct board can be much smaller than the pre-filter snapshot it replaces. The snapshot guard that rejects "materially thinner" complete boards (to catch truncated fetches) treated those as truncated. The first post-deploy warm of NRT arrivals (10 flights vs a stored 26) was refused, which left the stale board with codeshares pinned in Supabase. The guard now counts deliberately filtered rows; genuine truncation is still rejected. (`api/_schedule-snapshots.ts`, `tests/schedule-snapshots.test.js`)

## [1.9.0] - 2026-09-28

Fixes every finding from the Sep 27 2026 whole-site audit (141 agents; 128 of 130 findings independently reproduced) and cleans up the test suite.

### Fixed — flight data
- **My Flights, the FR24 lookup and the flight sheet no longer show yesterday's flight** as "Landed" on the wrong tail. `/api/flight-times` resolves the leg from the hub boards first (in the air > just landed > next departure) and uses FR24 only to overlay live facts; the paid FR24 call is skipped until the leg is within 1h of departure. Cache key includes `officialFallback`. (`api/flight-times.ts`, `api/_official-fr24.ts`, `api/fr24-flight.ts`)
- **The connection checker gives real verdicts** (board gate times now reach it). **Delay risk** is fed the inbound aircraft again; the journey signal that could never fire is removed.
- **Schedule boards:** earlier-day rows with +10–54h "delays" are repaired or dropped and no longer counted Late; boards are clipped to the hub day; partner-operated codeshares no longer count as United flights (board totals fall accordingly); the NOW divider sits after the last departed row; a tail from another aircraft family is not shown on a row; JST/ChST instead of GMT offsets; each hub's new today board is warmed right after its local midnight; AeroDataBox 429 retries are jittered.
- **Weather:** fractional visibility (1/2SM was "2 SM"), VV ceilings, "Ceiling" is BKN/OVC/VV only, calm/variable wind. **FAA** snake_case delay types are read by every client helper. **One network-status definition** drives the hub strip, ticker and IROPS badge (no more "SMOOTH OPS" beside "SIGNIFICANT DISRUPTION"); planned NAS outlooks are never "critical"; hub readings show their age.
- **Fleet/Starlink/Stats:** one definition each for fleet utilization and Starlink %; the Starlink board marks only the live leg Airborne; Express ETA uses the Express pace; fleet DB says "as of 12 Feb 2026" instead of "updated daily"; ⌘K ranks exact matches first and Enter works immediately; `/?hub=xxx` opens the Live map on that hub.

### Fixed — design, accessibility, mobile, speed
- Filled primary buttons use a new `--primary-fill` token: white-on-blue contrast 2.99:1 → 5.82:1 sitewide.
- Phones: the flight panel is a bottom peek so "View on map" shows the map; the search button has an accessible name; no keyboard pop-up from Filters; 16px inputs; 44px touch targets on touch screens (`pointer-fine:md:` floor); the phone menu closes on Escape/outside tap; the news and tip strips moved below the content (phone chrome 228px → 122px).
- Status colours use the DESIGN.md tokens (also fixes 6 content pages whose token colours resolved to nothing); chrome icons are lucide-react.
- Speed: overlays lazy-loaded (Dashboard chunk 357 → 238 KB), Geist preloaded, one tile per cell on retina (~3x fewer CARTO tiles); CLS home 0.06 → 0.006, fleet pages 0.145 → 0; reduced-motion respected.
- SEO: `og:image:type` matches the image; robots/llms/feed hygiene; uppercase hub URLs redirect.

### Changed — tests and infrastructure
- Tests: 143 files / 2,480 → 198 files / 2,935, order-independent (shuffle-clean on 3 seeds). Dead-path and copy-of-the-code tests replaced with behaviour tests on real production data shapes; new guards compile `vercel.json`, unit-test the CSP hash parser, catch every Node-ESM load-failure class in `api/`, run axe over every built page, and render every tab.
- Post-deploy smoke fails when the Vercel production deploy fails. `api/types.ts` (deployed as a handler-less function) → `api/_types.ts`. Dead `/api/fleet`, `appendVaryAccept` and `tierNasEvents` removed; legacy `SCHEDULE_SOURCE_PRIORITY` modes and `?page=` retired.

## [1.8.3] - 2026-09-27

### Fixed
- **The service worker's runtime caches finally store anything (v12).** Every runtime-cache branch cloned the network response inside `event.waitUntil` *after* `await caches.open(...)`; by then the browser was already reading the body it had been handed through `respondWith`, so `clone()` threw "Response body is already used", `waitUntil` swallowed the rejection, and nothing was ever cached. Verified on production: after many navigations the data and static caches were empty and only the install-time `/` shell existed. The bug predates the 1.8 rebuild (v10 had the same pattern). The response is now cloned synchronously before it is returned. Result: visited pages open offline, `/_astro` assets load from cache on repeat visits as intended, and icons revalidate in the background. (`public/sw.js`, `tests/sw.test.js`)

### Changed
- **Offline data is limited to responses that are safe to replay.** Only `/data/*.json`, `/api/schedule` (boards carry their own "data as of"), `/api/starlink-data`, `/api/fleet-summary` and `/api/fleet` are kept for offline use. Live and near-real-time endpoints (the FR24 position feed, METAR, FAA/NAS status, IROPS, per-flight lookups) stay network-only, so a flaky connection gets an honest failure instead of hours-old positions under the LIVE badge. That is what those endpoints effectively did before, since the cache never worked. (`public/sw.js`)

## [1.8.2] - 2026-09-27

### Fixed
- **Schedule boards stay fresh through the day.** Measured on production (Sep 26 2026 evening): of today's 18 hub boards, DEN and IAH arrivals were **11.5h** old, LAX arrivals 10.5h, IAH departures 7.5h and ORD arrivals 5.5h, while ~900 of the 1,400 daily AeroDataBox units went unused. Four compounding causes, all fixed:
  - **IROPS warm priority no longer drops other hubs' boards.** The warm ring is stateless, so a today board displaced to make room for a disrupted hub was skipped until its next pass; during a long EWR program that is what left DEN/IAH/LAX arrivals 11.5h stale through US prime time. Priority boards now only displace *tomorrow* slots. (`api/cron/warm-schedules.ts`, `tests/warm-irops.test.js`)
  - **The warm cron runs every 30 minutes** (was hourly), so every today board is re-fetched at least every 3h (was ~6h). ≈768 units/day, inside the 1,400/day budget. `SLOT_MS` moves in lockstep. (`vercel.json`, `api/cron/warm-schedules.ts`, `tests/warm-*.test.js`)
  - **A viewed board refreshes after 1h** (was a 6h hot/CDN cache plus a 3h refresh threshold). Spend stays bounded by the existing paced organic gate. The paid FR24 official API keeps its own 3h gate. (`api/schedule.ts`, `tests/schedule.test.js`)
  - **Refreshes no longer trip AeroDataBox's per-second limit on their own.** A burst of board loads fired every background refresh at once; RapidAPI returned "exceeded the rate limit per second for your plan, ULTRA", the billed retries 429'd again, and the failed attempt then held that board's 1h cooldown. Provider calls are now capped at 2 in flight per instance, and a failed refresh can retry after 5 minutes. (`api/_schedule-aerodatabox.ts`, `api/schedule.ts`, `tests/aerodatabox-concurrency.test.js`)
- **Background refreshes and cron warms no longer fall through to the FR24 web scrape.** It is Cloudflare-challenged from Vercel and could only produce a partial board the cache refuses to store; it accounted for ~200 error-level "FR24 Cloudflare challenge" log lines a day. On-demand requests are unchanged. (`api/schedule.ts`)

## [1.8.1] - 2026-09-26

### Fixed
- **"View on map", Starlink "Track", the aircraft dialog's "View on map" and the flight sheet's "Centre map" no longer blank the whole dashboard.** Each switches to Live Ops and asks the map to centre in the same render, while the Live panel is still hidden and Leaflet's cached size is 0×0; animating against a zero-size map projects to NaN and threw `Invalid LatLng object: (NaN, NaN)` inside a React effect, which unmounted the entire island. The map now measures first and holds the move until the panel has a size again (the same path covers the US/Pacific view toggle). (`src/app/map/LiveMap.tsx`, `tests/live-map-hidden-focus.test.tsx`)
- **An error in one view can no longer take down the page.** Each tab and the dashboard as a whole sit inside an error boundary that shows a contained "hit an error" panel with Try again / Reload instead of a black screen. (`src/app/shell/ErrorBoundary.tsx`, `src/app/Dashboard.tsx`, `tests/error-boundary.test.tsx`)
- **Centring the map takes you to the map again.** `focusOn` switches to Live Ops (as the pre-1.8 `focusFlight()` did), and a ⌘K "Airborne now" result centres the map on the flight instead of opening its sheet over whichever tab you were on. (`src/app/state/ui.tsx`, `src/app/features/SearchPalette.tsx`, `tests/ui-focus-switches-to-live.test.tsx`)
- **The Stats and Starlink tabs no longer make the page itself scrollable.** Screen-reader-only table captions/cells were positioned against the page rather than the tab's scroller, adding ~300px of document height; find-in-page or a screen reader could scroll the header off-screen with no way back. Tab panels are now `relative`. (`src/app/Dashboard.tsx`)
- **`/tsa/` and any `/tsa/*` path redirect to `/hubs`** like `/tsa` already did (it 404'd with a trailing slash). (`vercel.json`)

## [1.8.0] - 2026-09-14

### Changed
- **The site is rebuilt on Astro + one React island + Tailwind v4 + shadcn/ui.** The product had been two design systems wearing the same colours: a 9,000-line `public/index.html` / `src/dashboard/main.js` dashboard bundled by its own Vite config, and a set of Astro content pages with a parallel copy of the tokens. Every shared idea — a stat tile, a status badge, a focus ring, a breakpoint — existed twice and drifted, and anything with real accessibility requirements (a modal's focus trap, an `aria-sort` header, an Escape handler) was hand-maintained in both. There is now one token set (shadcn `radix-nova`, United blue `oklch(0.66 0.17 255)` as `--primary` over neutral zinc surfaces), one component library, and one build.

  The dashboard is a single `client:only="react"` island under `src/app/`: `Dashboard.tsx` composes the shell, `tabs.ts` registers eight lazy-loaded views, and overlays are shadcn primitives — the flight detail panel is a non-modal `Sheet` (the old Leaflet popup could not be focus-trapped, escaped, or kept from being clipped by the map viewport), aircraft/delay-explain/FR24/disclaimer/onboarding are `Dialog`s, and global search is `Command`. Every tab ported with its behaviour intact, including the deep links (`#live`, `#myflight`, `#schedule`, `#fleet`, `#starlink`, `#weather`, `#stats`, `#sources`, `?flight=UA1234`, and the `?tab=irops` alias the hub pages still emit). Starlink and My Flights are now their own tabs rather than sections of Fleet.

  Content pages, fleet/hub/news detail pages and the trackers all render through one `BaseLayout.astro`, which owns the `<head>`, header, footer, skip link and analytics tag — a page can no longer ship without them. Logic came out of the bundle into tested `src/lib` modules along the way: the suite is 133 files / 2,380 tests, up from a dashboard that was mostly untestable.

  Platform contracts were held, not re-derived: the Markdown content negotiation and `_agent/` twins, `llms.txt`/`llms-full.txt`, the sitemaps, the RSS feed, the PWA, and the API surface are unchanged. (`src/app/**`, `src/components/**`, `src/layouts/**`, `src/lib/**`, `src/pages/**`, `src/styles/**`)

- **Leaflet and the fonts are bundled; the CSP has no CDN left.** Leaflet used to load from unpkg.com, which had to be allowed in both `script-src` and `style-src`, and the three woff2 faces (Satoshi, DM Sans, JetBrains Mono) were served from `public/fonts/`. Leaflet and its stylesheet are now npm imports, and Geist Sans + Geist Mono come from `@fontsource-variable` — Vite emits all of it under `_astro/`, which `'self'` and `font-src 'self'` already covered. Astro's two inline island scripts are allowed by `'sha256-…'` hash and `scripts/verify-csp-hashes.mjs` fails the build if a hash in `dist/` is missing from the header; the third, stale hash token has been removed. (`vercel.json`, `src/styles/global.css`, `scripts/verify-csp-hashes.mjs`, `tests/csp.test.js`)

- **The service worker serves hashed `_astro/` assets cache-first, and precaches nothing but the navigation shell.** A filename like `_astro/app-B2kQ9f.js` names its own contents, so the bytes behind it can never change: cache-first with no revalidation is not a staleness risk but the only correct strategy, and a new deploy simply requests different filenames. That replaces the network-first `/js/*` + `/css/style.css` branch, which existed only because those files were *not* hashed — a deploy reused the same URLs, so the worker had to re-check them on every load or shipped fixes never reached returning users. The matching `max-age=3600` + stale-while-revalidate cache rules in `vercel.json` are gone with it. `/fleet/*` gained the rule it never had, and `/icons/*` and `/og/*` cache for a day. (`public/sw.js`, `vercel.json`, `tests/asset-cache.test.js`)

### Removed
- **The TSA checkpoint guide.** `/tsa` 301s to `/hubs`. The MyTSA upstream was decommissioned and `/api/tsa` had returned all-null for every hub since; v1.7.20 rewrote the page's claims around the static checkpoint guide it had been rebuilt on, but a page whose live data source no longer exists is a maintenance liability, not a feature. News posts that mention TSA are content and stay. (`api/tsa.ts`, `api/cron/refresh-tsa.ts`, `src/pages/tsa.astro`, `src/data/tsa/*`, `vercel.json`)
- **The pre-rebuild tree.** `src/dashboard/main.js`, `vite.dashboard.config.js` and the `build:dashboard` script (the island is built by Astro); `legacy/` (the pre-Astro homepage, kept for reference through the port); `public/js/` and `public/fonts/`; and `tests/main-js-imports.test.js`, the strangler guard that pinned what `main.js` was allowed to import — the only test this release deletes.

### Fixed
- The watch list is safe across browser tabs and across a board's batch of status changes. Every mutation now read-modify-writes the stored list and publishes what was written, a `storage` listener reconciles another tab's edits, and a board's watched-flight restamps are applied as one batch (`applyWatchChanges` in `src/lib/watch-utils.js`). Before, a stale tab's whole-list write could delete another tab's additions, and several status updates in one event derived from the same snapshot so only the last one survived.
- The Starlink verification ledger loads even if you switch tabs while its first fetch is in flight; the guard is set only on success, so it can no longer latch without data.
- Keyboard focus returns to the control that opened a dialog or sheet when it closes. The seven overlays opened from state (flight sheet, aircraft, delay explanation, FR24 lookup, onboarding, disclaimer, waitlist) render no Radix trigger, so Radix's default handed focus to `<body>`; the shared `ui/dialog.tsx` / `ui/sheet.tsx` wrappers now remember the opener and restore it when focus was lost (`src/lib/focus-return.js`).
- `?waitlist=1` on a first visit shows the waitlist dialog alone and interactive; the welcome dialog opens after it closes instead of stacking on top of it. Reopening the welcome from the header "?" re-seeds the home-hub picker from the current preference, so dismissing it can no longer write a stale hub back.
- The schedule board's "⚡ Served from cache · N UA flights" note is back, and the weather preload again reads the pre-rename `watchedFlights` key as a fallback when `bb_watched_flights` is absent.
- `https://theblueboard.co` had been declared in four modules that all emit absolute URLs a crawler dedupes against each other (canonical tags, JSON-LD `@id`s, sitemap `<loc>`s). A drifted copy fails no build and no test; it splits the site's identity in a search index. One `src/lib/site.js` now owns it. (`src/lib/site.js`, `src/components/site/Seo.astro`, `src/components/site/Breadcrumbs.astro`, `src/pages/sitemap.xml.ts`, `src/lib/home-seo.js`)
- The mobile menu button, its links, and the footer's donate button were 32–36px tall below `md` — under the 44px minimum, on the widths where they are the only way to navigate. (`src/components/site/SiteHeader.astro`, `src/components/site/SiteFooter.astro`)

### Documentation
- `DESIGN.md` is rewritten for the shadcn system: tokens and where each lives, the Geist pair, the ten `src/lib` modules that own status/phase/category colours, the component map, the `aria-live` inventory, breakpoints, the motion budget, the never-colour-alone rule, and the anti-patterns. `README.md`, `CLAUDE.md` and `MAINTENANCE.md`'s new-route checklist follow the current tree; `llms-full.txt`'s tab list was wrong in both directions and now lists all eight.

## [1.7.24] - 2026-09-10

### Fixed
- **Flight lookup came back empty; aircraft history still 400'd.** With the datetime format fixed in 1.7.23, `/api/fr24-flight` got a real summary row back but rendered it as `status: "unknown"` with blank origin, destination, aircraft and times: its normalizer only read the nested `{ origin: { iata } }` shape, while the live `/flight-summary/light` response is flat (`orig_iata`, `dest_icao_actual`, `datetime_takeoff`, `reg`, `type`, `flight_ended` …) — the same shape `schedule.ts` and `aircraft-history.ts` already parse. It now reads the flat fields first, maps ICAO-only airports through `icaoToIata`, prefers the actual destination over the filed one, and derives landed / en-route / scheduled from `datetime_landed` / `flight_ended` / `datetime_takeoff`. `/api/aircraft-history` was failing for a different reason: it filtered by `regs`, and FR24's parameter is `registrations`, so the API answered 400 "None of the required fields were provided". Both are pinned by tests, including a fixture in the real flat shape. (`api/fr24-flight.ts`, `api/aircraft-history.ts`, `tests/fr24-flight.test.js`, `tests/aircraft-history.test.js`)

## [1.7.23] - 2026-09-10

### Fixed
- **Every FR24 flight-summary lookup was a 400.** Re-enabling the official API in 1.7.22 exposed it: `/api/fr24-flight`, `/api/aircraft-history` and `/api/flight-times` all sent `flight_datetime_from/to` as `Date.toISOString()` — millisecond precision (`…SS.mmmZ`) — while FR24 documents whole seconds (`YYYY-MM-DDTHH:MM:SSZ`) and rejects the rest with 400. `api/schedule.ts` had its own correct `formatForFR24()` all along, with a comment saying exactly that; the other three callers never used it. One shared `fr24Datetime()` in `api/_official-fr24.ts` now formats every datetime sent to the official API, the live and summary error paths log the response body (only the status was logged, which is why this took a re-enable to notice), and a test pins the format and greps every official-API caller for a raw `toISOString()` next to a `flight_datetime` parameter. (`api/_official-fr24.ts`, `api/fr24-flight.ts`, `api/aircraft-history.ts`, `api/flight-times.ts`, `tests/fr24-datetime-format.test.js`)

## [1.7.22] - 2026-09-10

### Fixed
- **Every waitlist signup had failed since Aug 11.** v1.7.16 (#242) added `import starlinkLive from './starlink-live.json'` to `src/data/facts.js` — with a comment saying never to import facts.js from `api/**` — but `api/waitlist.ts` already did, for two string facts. On Vercel's native Node ESM runtime a bare JSON import throws `ERR_IMPORT_ATTRIBUTE_MISSING` at module load, so every `POST /api/waitlist` died before the handler ran: `FUNCTION_INVOCATION_FAILED`, users saw "Network error. Please try again." and retried, and the `waitlist` table recorded 0 rows in a month against 13 the month before. Nothing caught it — vitest transforms JSON imports, tsc allows them, the runtime-errors view doesn't group process exits, and this project has no preview deploys. The three JSON-backed Starlink figures now live in `src/data/starlink-facts.js` (Vite-only), facts.js is JSON-free again, and the eleven fleet/hub data modules that used them import from the new module. Verified by transpiling `api/waitlist.ts` and loading it under real Node 26 ESM: main fails with exactly the production error, this branch loads. A new test walks the static relative-import graph from every `api/**` entry point and fails on any bare `.json` import — the second time this class of bug has reached production, so it now has a guard. (`src/data/facts.js`, `src/data/starlink-facts.js`, `src/data/fleet/*.js`, `src/data/hubs/*.js`, `src/pages/fleet/index.astro`, `tests/api-esm-json-imports.test.js`)
- **Web Analytics only ever saw the dashboard.** The Astro-rendered pages — fleet index and the fleet type pages, hubs, trackers, TSA, news, 404, privacy, newark — never loaded `/_vercel/insights/script.js`; they carried only Speed Insights, and Speed Insights was canceled on the Vercel project on Jul 14 2026. The analytics breakdown by path showed `/` and nothing else for the whole of August, so the trackers, the SEO detail pages and the agent-readiness work shipped without any measurement. `VercelSpeedInsights.astro` is now `VercelAnalytics.astro`, a one-line inline script tag mounted from the same fourteen entrypoints, and the build output was checked page by page. The dead Speed Insights wiring is gone with it: the `@vercel/speed-insights` package, the `injectSpeedInsights()` call in the dashboard bundle, and the `vitals.vercel-insights.com` `connect-src` allowance. (`src/components/VercelAnalytics.astro`, `src/dashboard/main.js`, `src/layouts/*.astro`, `src/pages/**/*.astro`, `src/components/trackers/TrackerDetailLayout.astro`, `vercel.json`, `package.json`, `tests/web-analytics-integration.test.js`, `tests/csp.test.js`)
- **iOS touch-icon probes 404'd 124 times a day.** Safari and iOS home-screen bookmarks request `/apple-touch-icon.png`, `-precomposed`, and the sized variants regardless of the `<link rel="apple-touch-icon">` in the page, which points at `/icons/icon-192.png`. Four temporary redirects now send every variant there. (`vercel.json`)

### Operations (no code change — recorded here so the timeline is in one place)
- **AeroDataBox daily budget raised 700 → 1,400 units.** The 700 cap was reached on 9 of the 12 days to Sep 8, leaving the schedule board stale every US afternoon and evening until the midnight-UTC reset. The RapidAPI Ultra tier is a 50,000-unit hard cap per month; 1,400 × 31 = 43,400 leaves 13% headroom. Set as `AERODATABOX_DAILY_UNIT_BUDGET` in Vercel Production; takes effect with this deploy.
- **FR24 Official API re-enabled.** `SCHEDULE_OFFICIAL_FALLBACK_ENABLED` had been set to off in production on Jul 3 2026 after a "Credit limit reached" 402, and never turned back on, so `/api/fr24-flight` and `/api/aircraft-history` answered 503 "temporarily unavailable" ever since (~17/day). The variable is removed (code default: enabled); the cross-instance 402 breaker from v1.7.9 still stops every caller for 30 minutes on any new credit exhaustion.

## [1.7.21] - 2026-09-02

### Fixed
- **Every map tile was stamped "API KEY REQUIRED".** CARTO began requiring a free API key on its raster basemaps, and a request with no key now returns each dark tile with a diagonal "API KEY REQUIRED — carto.com/basemaps/apikey" watermark. Both Leaflet maps (Live Ops and the NEXRAD radar) hit that path. The tile template now comes from one helper that appends `?key=` when a key is present, and the key is inlined at build time from `VITE_CARTO_BASEMAP_KEY` (set in Vercel Production + Preview) so it never sits in this public repo — it is a public, per-domain tile key rather than a secret, but it is not referer-locked, so it stays out of git. A missing key falls back to the bare template — the map still draws, just watermarked — with a loud build warning rather than a failed build, because a failed production build on this project fails no visible check. The `@2x` retina variant, the `{s}` subdomain rotation, the preconnect hints, and the `img-src` CSP allowance are unchanged; the keyed tile was verified byte-for-byte different from the watermarked one on both the legacy `dark_all` and `rastertiles/dark_all` paths. CARTO is retiring raster basemaps and the same key covers its vector service, so that migration is the follow-up. (`src/lib/basemap.js`, `src/dashboard/main.js`, `vite.dashboard.config.js`, `.env.example`, `README.md`, `tests/basemap.test.js`)

## [1.7.20] - 2026-08-21

### Fixed
- **The new agent-facing copy promised TSA wait times the site cannot produce.** v1.7.19 shipped "How long is the TSA line?" as a best-fit job in both llms files, listed "TSA checkpoint volumes" in the homepage brief, the Markdown representation, and the URL tables, and gave it an "hourly" row in the data-freshness table. A post-merge production check found /api/tsa returning all-null for every hub — which is correct and by design: the MyTSA upstream was decommissioned, /api/tsa reports `feedDown`, and /tsa already says so in the page. The page's real value is the checkpoint guide it was rebuilt around — Pre✓, CLEAR, Priority, and standard lane availability by terminal, checkpoint hours, and tips for the 7 mainland hubs (GUM and NRT have no TSA checkpoints). All nine claims now describe that, name the decommissioned feed so an agent doesn't go looking for live minutes elsewhere on the site, and the 404 page's "TSA wait times" chip is now "TSA checkpoints". (`public/llms.txt`, `public/llms-full.txt`, `public/index.html`, `src/lib/agent-markdown.js`, `src/pages/404.astro`)

## [1.7.19] - 2026-08-21

### Added
- **The site now answers `Accept: text/markdown`, and every response says so.** An agent-readiness audit scored the homepage as "not acceptmarkdown.com compliant: `Accept: text/markdown` returned `text/html`; `Vary` header missing `Accept`" — meaning an AI client asking for clean Markdown got 92 KB of dashboard chrome, and a CDN that cached either variant could hand it to the wrong audience. A new Vercel Routing Middleware (`middleware.ts`) negotiates on the canonical URLs: `/`, `/fleet`, `/hubs`, `/news`, and `/trackers` return purpose-written Markdown, and everything else falls back to HTML, which is the correct RFC 9110 answer for a page with no Markdown twin. Astro's own middleware could not do this — `output: 'static'` means it runs once at build time and never sees a request. The Accept parser is the real thing rather than a substring test, because both common shortcuts are wrong on live traffic: Chrome's header contains no `text/markdown` but matches it through `*/*;q=0.8`, and `text/markdown;q=0` means "anything but Markdown". It ranks by q-value, breaks ties by range specificity then client order, honours `q=0` as an explicit rejection, and returns `406` with a body listing what it can produce only when every representation is refused. A missing Accept, an empty one, `*/*`, and every browser header tested still get the dashboard. `Vary: Accept, Accept-Encoding` is set globally in `vercel.json` and again on each synthesised response, since those bypass the static header layer. The matcher excludes `/api/`, `/js/`, `/css/`, `/data/`, `/fonts/`, `/icons/`, `/og/`, `/_astro/` and the root asset files, so the dashboard's 30-second polling never pays for an invocation. Any throw inside the middleware degrades to `next()` rather than 500-ing the whole site. (`middleware.ts`, `src/lib/accept-negotiation.js`, `src/lib/agent-negotiation.js`, `src/lib/agent-markdown.js`, `src/lib/site-routes.js`, `vercel.json`)
- **llms.txt and llms-full.txt now say when to reach for this site and how to call it.** The same audit failed "agent instruction / when-to-use" outright: both files described what the site is, never what jobs it is the right tool for. Both now carry a `## When To Use This Site` section naming seven concrete questions it answers well, an explicit list of what it is *not* for (other airlines, booking, as the system of record for a boarding flight), and a `## How An Agent Should Call It` URL table covering flight deep-links, hub codes, fleet slugs, the tracker CSV/JSON downloads, and the Markdown negotiation contract. The `/data/news-latest.json` pointer was dropped from both — `robots.txt` disallows `/data/`, so advertising it contradicted the crawl policy. (`public/llms.txt`, `public/llms-full.txt`)

### Changed
- **The homepage carries a crawlable H1 and 2,200 more characters of prose that no visitor will ever see move.** The audit reported "no H1 tag" on a page that has had one since launch: the brand H1 lives inside `<header>`, and the readability-style extractors AI crawlers run strip `<header>`/`<nav>` as boilerplate before they look. The sr-only "About The Blue Board" sentence that used to sit above the canopy is now a full `<section class="sr-only">` opening with the page H1 — product name, what it is, the nine tracked airports, six capability bullets, and a when-to-use paragraph pointing at `/llms.txt`, `/llms-full.txt`, and `/sitemap.xml`. It measures 1×1 px in the layout exactly as the old sentence did, so the dashboard is pixel-identical; screen readers get a real page title where before they got a stray sentence. No Starlink figure appears in it — that number is stamped into `dist/` at build time and any copy outside the stamping pass ships stale. (`public/index.html`)
- **The 404 page tells an agent where to look next, and answers in Markdown when asked.** Dead paths already returned a real 404 rather than a 200 app shell, but the body was a dashboard link and nine hub chips. It now adds a section row (fleet, hubs, trackers, news, TSA, Newark) and a machine-readable row linking `/sitemap.xml`, `/llms.txt`, `/llms-full.txt`, and `/feed.xml`. A request that prefers Markdown gets a `404` with a Markdown body listing the same entry points, gated on a prefix test over the canonical route surface that is deliberately wrong in only the safe direction — an unrecognised path under a known section still falls through to the HTML 404, so a live page can never be 404ed to a Markdown client. A test pins every URL in the sitemap against that test. (`src/pages/404.astro`, `src/lib/site-routes.js`)
- **Organization structured data carries a contact point and an address.** The audit found the Organization node complete except for the two fields that let a search engine verify a business and answer "how do I reach them": it now includes a `ContactPoint` with `hello@theblueboard.co` (the same address the privacy page and every outbound email footer already publish) and a city-level `PostalAddress`. The NewsArticle publisher node now references the homepage Organization by `@id` instead of restating a thinner copy of it. (`public/index.html`, `src/layouts/NewsLayout.astro`)
- The llms-full.txt technical section said "Astro 5.0"; the project has been on Astro 6 since the June upgrade. (`public/llms-full.txt`)
- Both llms files said Starlink equipment data refreshes "daily"; the sync cron has run every 4 hours (`0 */4 * * *`) since it was written. Fleet composition and Starlink equipment are now listed separately, since only the latter is on a cron. (`public/llms.txt`, `public/llms-full.txt`, `src/lib/agent-markdown.js`)

## [1.7.18] - 2026-08-11

### Changed
- The "Built by Jonah Berg" footer credit now links to [jonahberg.com](https://jonahberg.com) instead of the GitHub profile, across the dashboard footer, the shared Astro footer, and the hubs/fleet index pages. The NewsArticle structured-data author URL follows suit. GitHub remains reachable via the existing Support/Feedback repo links. (`public/index.html`, `src/components/Footer.astro`, `src/pages/hubs/index.astro`, `src/pages/fleet/index.astro`, `src/layouts/NewsLayout.astro`)

## [1.7.17] - 2026-08-11

### Fixed
- **The Starlink sync accepted structurally broken upstream feeds and persisted them as the durable "good" snapshot.** The cron's only guard was `length === 0`, which passes anything non-empty — so the failure mode that matters most goes through untouched: if unitedstarlinktracker.com renames `TailNumber` (it already reshaped `flights[]`/`fallback.segments[]` into `flightsByTail` between June and August without notice), the normalizer emits 513 records with empty tails, the guard waves them through, Supabase stores them for 12h, every tail lookup on the board silently stops matching, and every endpoint keeps returning green 200s. The cron now runs §05 structural validators before persisting: an absolute floor of 400 aircraft (live count is 513), a ≥98% valid-N-number tail ratio, a ≥90%-of-previous-snapshot relative check (read back via `loadStarlinkSnapshot`, skipped when no snapshot exists), and a fleetStats-vs-record-count agreement check with a ±max(5, 2%) tolerance — tolerance rather than equality, since upstream double-counts the MAX 9 and a benign one-off drift must not freeze snapshot updates. A rejected payload returns 502 with the specific `reasons`, and the snapshot, the globalThis fast path, and the in-memory cache are all left holding the last good data. Missing fleetStats and a >6h-old upstream `lastUpdated` are logged as warnings, not failures: degraded metadata is still the best data available. The same validators now run on `/api/starlink-data`'s direct-fetch fallback, where a failure throws into the existing degrade ladder (stale snapshot → committed static file) instead of serving a 10-aircraft board and caching it for the next four hours. (`api/_starlink-normalize.ts`, `api/cron/sync-starlink.ts`, `api/starlink-data.ts`)

## [1.7.16] - 2026-08-11

### Changed
- **The public Starlink figure now refreshes at every deploy instead of being hand-synced.** The site said "425+ United aircraft (as of mid-2026)" across 7 hub pages, 3 fleet-type pages, the fleet index, the home page and both llms files while the live count had reached 513 — the number was correct when written and rotted silently, because keeping it honest meant a hand-edit in 13 places. A new build step (`scripts/refresh-starlink-facts.mjs`) fetches upstream's `fleet-summary` endpoint before Vite and Astro run, writes `src/data/starlink-live.json`, and `src/data/facts.js` derives `STARLINK_EQUIPPED`, `STARLINK_EQUIPPED_LABEL` and the new `STARLINK_AS_OF` from it. Astro-importable copy interpolates those constants; the three verbatim-copied `public/` files (`index.html`, `llms.txt`, `llms-full.txt`) keep readable committed strings in source and are stamped with the live values in `dist/` by `scripts/stamp-seo-build-date.mjs`. The prose label floors to the nearest 25 and can never print below the committed last-good value, so between deploys the copy can only be stale in the conservative direction ("500+" while reality is 520). A failed fetch, a bad payload shape, or an implausible count keeps the committed values and never fails the build; a `public/` string that drifts from the JSON's `source` block does fail it, rather than shipping a half-stamped page. (`scripts/refresh-starlink-facts.mjs`, `scripts/stamp-seo-build-date.mjs`, `src/lib/starlink-facts.js`, `src/data/starlink-live.json`, `src/data/facts.js`, `src/data/hubs/*.js`, `src/data/fleet/*.js`, `src/pages/fleet/index.astro`)

## [1.7.15] - 2026-08-11

### Fixed
- **The Starlink badge read upstream's current responses wrong in three different ways, and invented a number in a fourth.** The check-flight adapter still assumed the single `{hasStarlink, confidence, flights}` shape from the endpoint's documentation, but a live probe on Aug 11 found three: a statistical prediction when no tail is assigned yet, a verified result carried in `fallback.segments[]`, and a verified result carried in top-level `flights[]`. Only the last one worked. A legitimate "~71% of recent departures, 4 observations" forecast was discarded and rendered as nothing; a verified-negative segment (tail `N838UA`, Panasonic wifi) had its data thrown away; and `confidence ?? 'likely'` turned any positive response upstream didn't label into a fabricated 70% badge reading "0 observations". The adapter now derives truth from the segments and the prediction object rather than branching on top-level `hasStarlink`/`confidence`, which also covers the unprobed-but-plausible positive-via-fallback shape. Segment wifi values are matched against both live spellings (`Starlink` and `StrLnk` — 170 and 343 aircraft respectively, so an exact-match check would have missed two thirds of the fleet). Predictions now need real evidence behind them: zero observations or a `fleet_prior_*` method is a fleet-wide average rather than an answer about this flight, and upstream serves those as confident-looking 200s, so both are suppressed instead of shown. Predicted responses reach the badge as `confidence: 'predicted'` carrying the real upstream probability, and the dashboard gives them the forecast treatment — "likely ~71%", low-data gating, and a tooltip that reads as an estimate — instead of the deterministic verified badge. The verified path renders exactly as before. (`api/check-flight.ts`, `src/dashboard/main.js`)

## [1.7.14] - 2026-08-04

### Fixed
- **The live map no longer errors when FR24's feed glitches — which it now does on ~20% of requests.** Since July 3, `/api/fr24-feed` returned 503 whenever FR24 served an empty body, and a direct probe showed those empties arrive in streaks (8 of 12 sequential upstream fetches, in runs of 2–5). The endpoint now retries once (UAL only — for United an empty feed is never truth) and, when upstream stays broken, serves its last-known-good UAL payload from up to 3 minutes ago as a 200 with an `X-BB-Feed-Stale` header. The ceiling is the client's own `FEED_FRESH_MS`, imported so the two can never drift, and the env override (`FR24_FEED_STALE_SERVE_MAX_MS`) can only tighten it. The dashboard reads the header, back-dates its freshness clock so the LIVE/STALE chip stays honest, and keeps the fast-retry ladder armed. The fallback state is deliberately United-only: the airline param is caller-controlled, and any per-airline store would hand curl a way to evict the one payload real users depend on. "Empty" is now decided by the client's own `parseFr24Feed` (entries need real positions), so a degraded all-null-position payload can't poison the fallback. First paint during a glitch shows planes instead of an error. (`api/fr24-feed.ts`, `src/lib/feed-health.js`, `src/dashboard/main.js`, `vercel.json`)
- **AI delay explanations no longer hammer the gateway through a permission outage.** From Jul 28 to Aug 2 the AI Gateway rejected calls with 403 "Free tier users do not have access…", and because the AI-unavailable circuit only tripped on 402/billing-400, every click re-hit the gateway and logged a fresh error for the whole window. Account-level 403s now open the same 5-minute circuit and serve the calm fallback message; request-specific 403s get the graceful answer without switching the feature off for every visitor. (`api/delay-explain.ts`)

### Changed
- **Schedule refreshes are paced across the whole day instead of first-come-first-served.** The AeroDataBox daily budget resets at UTC midnight — 7 PM CDT — so evening traffic plus overnight warming drained the pool by ~1 PM and the board froze for exactly the afternoon hours delay drama peaks (observed Aug 4: 732/700 units spent, board stuck at "Statuses as of 1:02 PM CDT (3h old)"). On-demand refreshes are now gated against a pro-rated share of the budget (1-hour head start, same daily ceiling; `AERODATABOX_BUDGET_PACING=off` restores the old flat gate for deliberate backfills). Cron warming is unaffected, and while pacing — rather than true exhaustion — is holding the provider back, the paid FR24 official fallback stays off, so the pacing guard can never increase spend. A once-a-day warning now fires when the configured budget can't clear the warm cron's ~384 units/day floor. (`api/_cost-state.ts`, `api/_schedule-aerodatabox.ts`, `api/schedule.ts`, `.env.example`)

## [1.7.13] - 2026-07-27

### Fixed
- **The TSA page is indexable again.** `/tsa` still carried the `noindex, follow` meta from March (v1.5.x era), added when the live wait-times data was pulled and the page was dropped from the sitemap. The page has since been rebuilt as a full checkpoint guide (the WP2 truth sweep) and live TSA data is back via `/api/tsa` with an hourly refresh cron — but the stale `noindex` remained, and Google Search Console flagged it on July 27 as "Excluded by 'noindex' tag." The meta is now `index, follow` and `/tsa` is restored to the sitemap with its own lastmod paths. (`src/pages/tsa.astro`, `src/pages/sitemap.xml.ts`, `src/lib/buildMetadata.js`)

## [1.7.12] - 2026-07-23

### Added
- **Five July 2026 stories filed to the United News Hub.** The July 18 SHARES-outage post-mortem (75 minutes of downtime, ~268 cancellations, the industry-wide 2,437 figure kept honestly distinct); Q2 earnings ($1.99 adjusted EPS beat, guidance raised despite ~$6B more fuel, full schedule restored this fall, 80+ retirements in 2027); the A321XLR "extra elbow room" Economy Plus row — the productized blocked middle our June 12 story flagged as speculation; the N61101 Elevated 787-9 TCAS saga (returned to Boeing, "fixed," grounded again days later); and United's first transatlantic Starlink flight (UA14, Newark–Heathrow, Boeing 777). The home-page news banner needs no separate update: it rotates the top three stories from the index and re-surfaces for visitors who had dismissed the previous top story. (`src/data/news/index.js`)

## [1.7.11] - 2026-07-16

### Fixed
- **The public support meter's "boards used" bar was structurally stuck at 0.** `/api/support-stats` read `getAdbUnitsToday()`, a per-instance in-memory counter — but the support-stats lambda never records AeroDataBox spend itself (only the schedule and warm-cron paths call `recordAdbUnits`), so that counter is always 0 while the real cross-instance total (Supabase `schedule_provider_spend`, maintained by the `increment_adb_units` RPC) runs past the 700/day budget. Production served `{"boards":{"used":0,…}}` at every hour of the day, understating the site's cost to visitors. The handler now calls `hydrateAdbSpend()` — the existing TTL-limited, never-throwing cross-instance reader — concurrently with the FR24 usage fetch and reports its total, so the meter reflects real spend and degrades to the in-memory value (never an error) if Supabase is unavailable. The FR24 live-feed reading is untouched: its ~0% is truthful, since the FR24 kill-switch keeps credit consumption near zero. (`api/support-stats.ts`)
- **The snapshot GC ran silently on success, so an audit couldn't confirm from logs that it was draining the backlog.** `cleanupExpiredSnapshots` logged only failures; a clean run left no trace of whether it fired or how many rows it removed. It now counts deletions across batches and emits one info summary — `Schedule snapshot cleanup: deleted <N> expired rows` — whenever it deleted anything, appending ` (batch cap reached; backlog may remain)` when it stops at the per-run batch ceiling with a still-full final batch (the operationally important signal that expired rows remain for the next hourly fire). The common empty hourly run stays silent to avoid log noise, and a mid-run select/delete error still reports what was already deleted. (`api/_schedule-snapshots.ts`)

## [1.7.10] - 2026-07-11

### Fixed
- **The v1.7.9 snapshot GC could never actually delete anything.** Its first production run hit `canceling statement due to statement timeout`: `schedule_snapshots` had accumulated **4,110 expired rows (~320 MB of JSONB, 98% of the table) since March**, and a timed-out `DELETE` rolls back whole — so the single-statement sweep would fail identically every hour forever, which is the quiet-failure mode the GC was added to prevent. It now deletes by primary-key batches (300 rows × up to 4 batches per warm-cron fire): every statement is small enough to finish, a deep backlog drains incrementally (~4 hours for the current one), and steady state (~18 new rows/day) completes in one short round. A failed batch still logs and never fails the cron. (`api/_schedule-snapshots.ts`)

## [1.7.9] - 2026-07-11

Full-codebase audit: 20 scoped review agents produced 106 findings, every one adversarially verified (95 confirmed, 11 refuted), then 93 were applied. The suite grew **1,079 → 1,259 tests** (75 → 85 files), and the production diff is a net −150 lines. Every new test was proven load-bearing — sabotage the code, watch it fail, revert — not just green.

### Fixed
- **Watch alerts could flap forever on provider vocabulary.** `isSignificantStatusChange` notified whenever a keyword appeared on *either* side of a transition, so the same physical state arriving as `En Route` (FlightAware tier) then `estimated` (FR24 schedule-cache tier) minted a push on every flip — an endless false-alert loop for the feature's core promise. The differ now maps both sides to one canonical phase class (cancelled/diverted/landed/delayed/airborne/scheduled) and notifies only when the *class* changes. Gate changes keep their own dedicated diff channel. (`api/_watch-diff.ts`)
- **Aircraft history was silently dead in production.** `normalizeSegments` only read a nested `{origin:{iata},departure:{scheduled}}` shape, but the live FR24 flight-summary endpoint returns FLAT fields (`orig_icao`, `datetime_takeoff`) — the same shape `schedule.ts` and `flight-times.ts` already parse. Every real segment was dropped before rendering. Flat-field fallbacks added; also `N-1-2-3`-style registrations now strip every hyphen, not just the first. (`api/aircraft-history.ts`)
- **IROPS day-boundary math had drifted from the hardened copy.** `getStartOfDayForHub` — which drives the board day-key check, IROPS fetch, and warm-cron day selection — carried its own DST correction that (a) never normalized the ICU `hour==="24"` midnight quirk and (b) rolled back "before 6 AM → yesterday" with a naive `-86400` that lands an hour off across a 23/25-hour day. It now delegates to `src/lib/hubTz.js`, the single hardened source of truth; ordinary-day output is byte-identical, pinned by value-asserting DST tests that replaced three tautological `typeof === 'number'` checks.
- **IROPS scoring: two inflation paths closed.** A confirmed real departure a calendar day off no longer mints an impossible ~24h "delay" atop the worstDelays list (16h hub-day ceiling — genuine multi-hour weather holds survive, wrong-day artifacts don't), and a diverted flight that also departed late no longer scores 4 disruption points (diversion ×2 *plus* delay ×2 — more than a confirmed cancellation). (`api/irops.ts`)
- **Two empty-board cache-poisoning paths in the schedule handler.** In `SCHEDULE_SOURCE_PRIORITY=official` mode a transient empty official board (never legitimate for a United hub same-day) was cached and CDN-pinned for 6h; it is now flagged partial so the existing empty-board guards and live-feed rescue apply. And the legacy single-page path cached FR24's `{_rateLimited:true}` sentinel as a valid zero-row page; it now 502s like the aggregation path. (`api/schedule.ts`)
- **The aircraft-family filter dropped United's newest fleets on FR24-sourced boards.** The classifier only matched IATA-style codes, but the FR24 normalizers emit ICAO type codes with empty model text — `B38M`/`B39M` (737 MAX), `A20N`/`A21N` (A320neo family), `E75L` — so the 737 filter silently hid every MAX and the A320 filter every neo. (`src/lib/schedule-filters.js`)
- **Hub health scored the wrong leg.** `updateHubHealth` fell back across legs (`real.departure || real.arrival`), so arrivals boards measured origin-departure punctuality and a departures row missing its real departure scored flight-duration as delay — the same wrong-timestamp class as v1.7.7, latent whenever `/api/irops` is down. Now direction-aware, mirroring `board-stats.js` F021. (`src/dashboard/main.js`)
- **Escaping: one client, one escaper.** The dashboard ran a private `escapeHtml` that diverged from the tested F051 module (non-strings rendered blank); the client now imports `src/lib/escape.js`, and the FAA/METAR explainer strings — the one innerHTML sink that interpolated provider text unescaped — are escaped at the sink. (`src/dashboard/main.js`)
- **Service worker: fixes to peripheral widgets reached returning users one navigation late.** Only `dashboard.js`/`style.css` were network-first; every first-party `/js/*` script (support-meter, news-banner, hub-live-data, sw-register…) now gets the same treatment. (`public/sw.js`)
- **Watch-alerts cron hardening.** Postgres `42P01` (table not yet migrated) now degrades to the graceful-unconfigured 200 instead of a 5-minute 500 storm — the exact deploy-ordering footgun this repo has hit before; the serial resolve loop is bounded by a 100s wall-clock deadline so the run is never force-killed mid-persist (which re-notified next run); Supabase write failures are counted and logged instead of silently swallowed; dead `depMs` prioritization code deleted. (`api/cron/watch-alerts.ts`)
- **Waitlist rate limit was 60× looser than its stated intent** — the "5 per hour" comment sat on a 60-second window (≈300/hr of attacker-directed welcome email). `createRateLimiter` gained an explicit window parameter (default unchanged); the waitlist now enforces a real 5/hr. (`api/waitlist.ts`, `api/_rate-limit.ts`)
- **Smaller correctness fixes:** delay-explain cache keys now slice at the same lengths as the prompt (two contexts sharing a truncated prefix could serve one flight's AI explanation to another); the METAR last-known-good map is size-capped against valid-ICAO enumeration; a thin-but-complete board can no longer clobber a richer stored complete snapshot (>50% shrink is a truncated 200, not a schedule change), and expired snapshot rows are GC'd by the warm cron (the table previously grew without bound); `delay-risk`'s local-hour parse normalizes the ICU `hour=24` quirk; the fleet-table comparator returns 0 on ties (was scrambling tied rows every re-sort); the weather tab's 5-minute refresh pauses while the tab is hidden; the My Flights countdown interval is cleared on tab switch.

### Added
- **Six pure decision engines extracted from `main.js` into tested `src/lib/` modules** — flight-status resolution (`flight-status-resolve.js`), METAR category + ops severity (`metar-category.js`), the client IROPS score/label engine (`irops-score.js`, killing thresholds duplicated verbatim in two functions), fleet matching incl. the icao24 fallback (`fleet-match.js`), the schedule board filter predicate (`schedule-board-filters.js`), and equipment-swap classification (`swap-impact.js`). Behavior-preserving; ~350 lines of logic left the DOM shell and gained 49 tests. The fleet table now runs the *tested* lib sort/filter instead of untested inline copies.
- **The alerts pipeline is no longer test-free.** `api/cron/watch-alerts.ts` (auth, unconfigured/42P01 degradation, caps, dead-sub pruning, failure bookkeeping, deadline) and `api/_web-push.ts` (410/404-gone handling, VAPID memoization, mailto prefixing) each gained a full suite — the feature's server side previously had zero coverage.
- **FAA/NAS parsers now run against captured real payloads.** The four committed fixtures (airport-events ×2, enroute-events, operations-plan) were referenced by zero tests while the closure/arrival-delay/deicing/runway-config branches — the biggest FAA risk signals — went unexercised; all four are now wired into parse-level tests, so an upstream field rename fails CI instead of silently zeroing the signal.
- **Test hardening across the suite** (+180 net): AeroDataBox partial-board and estimated-time derivation; schedule request guards (405/403/timestamp-range spend guard), diverted detection, single-page mode, live-feed row validation; delay-risk magnitude bands, turnaround engine, destination-side scoring, and airport closure; rate-limiter window reset under fake timers; service-worker push/notificationclick/activate-reap/routing behavior; `time-format` timezone-labeling contract; CSP now pins `img-src`/`connect-src` tile+vitals hosts (a dropped basemap host would blank the map with green tests); the Leaflet guard covers `.leaflet-interactive` (the exact v1.7.1 incident vector); fleet data consistency (count hardcodes can no longer desync silently); Supabase snapshot persistence asserted on the sync-starlink success path.

### Docs
- PR #220 (the 199-file v2.0 program) finally has a retroactive CHANGELOG section; README documents all 5 crons and the actual api.market gateway; HANDOFF.md no longer describes the merged branch as open; two completed TODOs deleted.

## [1.7.8] - 2026-07-09

### Fixed
- **The equipment-swap banner never fired, the Aircraft column was all `—`, and the type filter matched nothing — because the aircraft code was hardcoded empty.** `api/_schedule-aerodatabox.ts` built every schedule row with `model.code: ''`. AeroDataBox only ships a free-text model name and *never* a code — 0 of 647 live rows carried one, 610 carried text like `Airbus A321 NEO`, `Boeing 737 MAX 9`, `Boeing 787-9`. The dashboard keys three features off `aircraft.model.code`: the `⚠️ N equipment swaps detected` detector (`detectEquipmentSwaps` gates on `if (fnum && acCode)`, so its baseline map stayed empty and no swap could ever be recorded), the Schedule table's Aircraft column (rendered `—` on every row), and the aircraft-type filter (could never match). The adapter now derives an ICAO-style designator from the model text via a new pure, exported `modelTextToIcaoCode()`, in the same vocabulary the client's `ICAO_TO_FLEET_TYPE` map already speaks (A319/A320/A21N, B737/B738/B739, B38M/B39M, B752/B753, B763/B764, B772/B77E/B77W, B788/B789/B78X) plus the United Express regionals the boards carry (E170/E175, CRJ2/CRJ7/CRJ9).
- **Honest by design: ambiguous text maps to nothing, never a guess.** A bare `Boeing 737` with no `-700`/`-800`/`-900`/`MAX` suffix is ambiguous across four codes, so it returns `''` — likewise bare `Boeing 787`, `Boeing 777`, `Airbus A321` (ceo vs neo), `Bombardier CRJ`, and any unrecognised string. An empty code is honest: the swap detector skips the row and the column shows `—`. A *guessed* variant would be worse than the dead banner it revives — two polls that resolved the same physical jet to different guessed codes would mint a **false** swap alert. AeroDataBox's free text also can't distinguish a 777-200 from a 777-200ER unless it spells out `ER`, so plain `Boeing 777-200` collapses to the generic `B772` (consistent, so it can't fabricate a swap; it only loses the ER split for fleet-stats display).
- User-visible effect: the equipment-swap banner can now actually fire when a flight's aircraft type changes between polls, the Aircraft column shows real type codes (with the full model name beneath), and the aircraft-type filter works. Rows the provider left genuinely ambiguous still read `—`, as they should. `time.*` and `_source.timeSource` (the v1.7.7 gate-vs-runway fix) are untouched.

## [1.7.7] - 2026-07-09

### Fixed
- **The Blue Board was measuring taxi time, not delay.** `time.real.departure` was AeroDataBox's `runwayTime` — the actual *runway* time, wheels-up on departure and wheels-down on arrival — compared against `scheduledTime`, which is a scheduled **gate** time. Every reported delay silently carried taxi-out, and every arrival was timestamped before the aircraft reached the gate. Over 10,518 operated departures the median "delay" was **+24 min** with only **3.7%** at or before schedule, while the same days' arrivals skewed **−18 min** with **73.9%** at or before schedule. Departures late by a taxi, arrivals early by a taxi: operations cannot produce that asymmetry. Now `revisedTime` (the gate time) is preferred, falling back to `runwayTime` only when the provider omits it.
- Verified before changing anything. v1.7.6 shipped instrumentation only, and one hour of production traffic (521 operated legs, live EWR + SFO boards) settled it: `revisedTime` coverage is **100%** (the vendor's "if any" concern was unfounded), and the gate time is **never after** the runway time — 0 of 255 departures — so this swap can only shrink a reported delay, never grow one.
- Measured effect on that sample: departures at or before schedule **2.4% → 26.3%**; `delayed30` **85 → 53** (−38%); `delayed60` 20 → 18. Arrivals now land at the gate rather than on the runway.
- **Honest limit, and a correction to our own spec.** For **64% of departures the provider sets `revisedTime == runwayTime`**, so the fix corrects only the other 36% — where the median gap is 26 min (p90 39 min), which is exactly taxi. The gate-based median departure delay is **+15 min, not ~0**: EWR and SFO at midday are genuinely late. The earlier spec claimed the delay layer was essentially all taxi. It is not, and the instrumentation is what caught the overstatement. `_source.timeSource.gateDistinctDep` / `gateDistinctArr` now mark the rows where `time.real.*` is honestly gate-based, so consumers can tell the difference instead of assuming.
- Downstream, this lowers the IROPS `score`, `delayed30`/`delayed60` and `worstDelays`, and raises hub OTP. The `SIGNIFICANT DISRUPTION` banner (`score >= 15`) is **not** fixed by this alone — that is Phase 2, and it needs a week of gate-based data before thresholds are re-derived. Do not hand-pick new cutoffs.

## [1.7.6] - 2026-07-09

### Added
- **Instrumentation for the taxi-vs-delay bug** (`docs/specs/irops-delay-measurement.md`). The board reports AeroDataBox's `runwayTime` (wheels-up) as the actual departure and compares it against `scheduledTime`, which is a scheduled *gate* time — so every delay the site reports silently includes taxi-out. Across 10,518 operated departures the median "delay" is **+24 min** with only **3.7%** at or before schedule, while the same days' arrivals skew **−18 min** with **73.9%** at or before schedule. That asymmetry is taxi-out and taxi-in, not operations.
- The obvious fix — prefer `revisedTime` (gate) — is **not safe blind.** The provider sends `revisedTime` only "if any", so a naive swap could leave on-time flights taxi-inflated while delayed ones became gate-based: a mixed distribution worse than a uniformly wrong one. `schedule_snapshots` upserts by `cache_key` and keeps no intermediate states, so coverage cannot be recovered retroactively, and the one raw provider call that would settle it needs a credential this session declined to materialize.
- Therefore: `_source.timeSource` now records which raw fields the provider actually sent (`hasGateDep`, `hasRunwayDep`, `hasGateArr`, `hasRunwayArr`), and `_source.gate` carries the gate timestamp for an already-operated leg. **No behaviour change** — `time.real.departure` is still `runwayTime || revisedTime`, pinned by a test. One hour of production traffic makes the coverage measurable, after which the fix is a one-line preference swap with evidence behind it.

## [1.7.5] - 2026-07-09

### Fixed
- **Production had not deployed for 11 hours.** The TypeScript 6 → 7 upgrade (#222) silently broke every production build. `main` kept merging; nothing shipped. The last deploy to reach production was v1.7.3, which means v1.7.4's Schedule fixes never went live.
  ```
  Using TypeScript 7.0.2 (local user-provided)
  Error: Cannot read properties of undefined (reading 'readFile')
  ```
  TypeScript 7 is the native port. Its package ships the CLI but drops the legacy programmatic compiler API — `ts.sys`, `ts.createProgram` and friends are simply gone. `@vercel/node` compiles the `api/*.ts` functions and reads `tsconfig` through `ts.sys.readFile`, so it throws before building a single function. Every published `@vercel/node`, checked through the current 5.8.22, still calls it: there is no TS7-compatible version today. Reverted to `typescript@^6.0.3`.
- **Nothing in CI could have caught it, which is the more interesting problem.** `bun run test`, `tsc --noEmit` and `bun run build` were all green under TS7 — the `tsc` CLI works fine, only the programmatic surface is missing — and the PR's Vercel check reported "pass" because its preview build was skipped by the Ignored Build Step. A failed *production* deploy is not wired to any GitHub check. Added `tests/vercel-build-compat.test.js`, which asserts the installed TypeScript still exposes the API `@vercel/node` compiles with, and that `package.json` pins a major that ships it. Confirmed it fails under 7.0.2 and passes under 6.0.3.

### Note
Restoring TS7 requires `@vercel/node` to support it. When that lands, bump `typescript` and delete `tests/vercel-build-compat.test.js` in the same PR.

## [1.7.4] - 2026-07-09

### Fixed
- **The Schedule tab was empty and useless overnight.** Opened at 00:23 hub-local, it defaulted to "Today" — a board of 644 flights that had not happened yet: `0 OPERATED`, `0 ON TIME`, `0 LATE`, `0 CANCELED`, `644 UPCOMING`, and every row reading `Expected · RISK: LOW`. The completed day, with all of its real data, sat one click away under "Yesterday". `api/irops.ts` has applied the right rule server-side all along — *"Before 6 AM local: no flights have departed yet, show yesterday's data"* — but the client never did. The Schedule board now opens on the completed day before the hub's 6 AM rollover, via a new shared `defaultSchedDayOffset()` in `src/lib/hubTz.js` so client and server can't drift apart again. Today and Tomorrow remain one click away.
- **`ORD → ?` in the route column.** 7 of 644 rows on a real ORD board carry a destination city but no IATA code, and the renderer printed a bare `?` while stranding the city in the subtitle. The city is now promoted into the route line when the code is missing (`ORD → Los Angeles`), with no duplicated subtitle.
- **One flight in 644 read `Unknown` while the rest read `Expected`.** Both had the same normalized `generic.status.text: "scheduled"`, no estimated time, no real time, and were hours in the future. `classifyBase()` surfaced AeroDataBox's free-text `status.text` verbatim — its `|| 'Scheduled'` fallback never fired because `"Unknown"` is truthy. A meaningless provider word now falls back to `Scheduled`; a meaningful one (`Expected`) is still shown. The status `key` is untouched, so time-based reclassification to `Departed` still works.
- Also restamps the Yesterday/Today/Tomorrow date labels after the home hub resolves. They were previously rendered before `schedCurrentHub` was known and fell back to the wrong timezone.

### Note
`tests/schedule.test.js > honors officialFallback=0 when scraping fails` failed twice while this branch was being built (both runs ≈00:45 America/Chicago) and passes on this branch and on `main` at other hours. It is **not** caused by this change: the same commit is green now, and clean `main` shows the identical behaviour. That suite pins `Date` (`vi.setSystemTime`) but leaves real timers real, and `api/_rate-limit.ts:9` captures `Date.now()` at import — before the fake clock installs. Worth chasing separately; flagged rather than papered over.

## [1.7.3] - 2026-07-08

### Fixed
- **The live map's zoom-out button was unclickable on desktop.** The v2.0 program moved `#legal-details` (the About/Donate "ⓘ" control) from an in-flow nav child to `position:fixed; bottom:24px; right:16px; z-index:760`. Leaflet mounts the map's zoom control at `bottomright`, where it occupies roughly the first 42px in from the right edge — so the panel sat directly on top of the `−` button. `document.elementFromPoint()` at the button's centre returned `#legal-btn`: clicking zoom-out opened the About popover. Moved the control (and its popover, to keep them aligned) to `right:56px`. Same failure family as the v1.7.1 marker bug — a positioning change from the v2.0 program quietly eating a map control.
- **Mobile bottom nav lit up two tabs at once.** The v2.0 program promoted My Flights to primary mobile nav but left `tab-myflight` in the hardcoded `overflowTabs` list, so tapping it activated both "My Flights" and "More" — while Fleet and Starlink, which had moved *into* the More menu, activated nothing. `overflowTabs` is now derived from `#mobile-more-menu`'s own contents, which is the definition of "reachable only via More" and cannot desync from the markup again.
- **`/api/support-stats` was an unauthenticated amplifier onto FR24's metered usage API.** It is public, had no rate limiter (19 sibling handlers have one), and the CDN cache is keyed by the full URL — so `?z=<random>` was an origin MISS every time, and every MISS fired a fresh *authenticated* upstream call. Added a 5-minute memo (the real guard: one upstream call per TTL per warm instance, regardless of request volume) plus `createRateLimiter('support-stats', 60)`. The `429` is sent with `Cache-Control: no-store` so it can never enter the shared CDN cache.
- **The support meter flapped between "configured" and "not configured" on identical requests.** A failed FR24 fetch returned `{configured:false}` — the same shape the endpoint uses to mean "no token set" — so a flaky upstream made the meter silently vanish rather than admit a bad fetch. A last-known-good reading is now served for up to 30 minutes when the upstream is failing.
- `api/support-stats.ts` `maxDuration` 10s → 15s. Its only upstream (`fetchFr24UsageRaw`) aborts at exactly 10000ms, so the function was killed before its own `catch` could return the documented graceful fallback.
- Regression guards: `tests/leaflet-required-styles.test.js` now also fails CI if a fixed bottom-right overlay intrudes on the 52px reserved for Leaflet's zoom control; `tests/support-stats.test.js` adds memo, stale-serve and rate-limit cases. Each new test was confirmed to fail against the old code and pass against the new.

### Note
No unit test covers the mobile-nav fix — this repo has no DOM test environment (`jsdom`/`happy-dom` are not devDependencies), which is also why the v2.0 program's "axe: 0 violations" claim was never a CI gate. Verified instead by driving the built bundle in a real browser. Adding a DOM test environment is the natural follow-up.

## [1.7.2] - 2026-07-08

### Fixed
- **IROPS index was manufacturing a network meltdown out of stale board rows.** The `overdueDelayMinutes()` rule added by the v2.0 program (F073) charged `now - scheduledDeparture` minutes to any row that lacked a terminal status — uncapped, and with no way to tell a flight held at the gate from a flight that departed hours ago whose status never updated. Because the board carries a full local day, a 07:00 departure was still accruing "hold" minutes at 23:00. Measured on production: 548 rows scored overdue >30m (122 of them beyond six hours), worst 1,028 minutes — a 17.1-hour hold on a 90-minute regional hop — driving the index to 74.4 against a SIGNIFICANT threshold of 15 and putting impossible phantom holds in the user-visible "worst delays" list.
- Two guards, in order of trust: a flight cannot still be awaiting departure once the clock has passed its **scheduled arrival** (decisive, removes 61% of the phantoms with no policy judgment); and an absolute `OVERDUE_MAX_MIN = 240` cap for the ~25 production rows that carry no scheduled arrival, chosen above the FAA's 3-hour tarmac limit, past which a hold is cancelled rather than held. Beyond that we cannot distinguish a hold from a stale row, so we under-report rather than fabricate — the same honest-degradation rule the boards and freshness chip already follow.
- The F073 ground-stop signal the rule exists for is preserved: a genuine hold still short of its scheduled arrival still counts toward `delayed30`/`delayed60` and still surfaces in `worstDelays`.
- On live production data this moves `delayed30` 1184 → 906, `delayed60` 638 → 378, the worst reported hold 944min → 415min (and that 415 is a real, timestamp-backed delay, not an inferred one). The index reads 74.4 → 55.5. It remains above the SIGNIFICANT threshold: there is a real delay backlog underneath, and this change removes only the fabricated part of it. Scoring calibration is a separate, pre-existing question.
- Regression guard: five new `F073b` cases in `tests/irops.test.js`, including a 15-hour stale row, an unknown-arrival row past the cap, and an assertion that `worstDelays` never reports a hold beyond the cap.

## [1.7.1] - 2026-07-08

### Fixed
- **Live map: every aircraft was drawn in the wrong place.** The marker hit-slop rule added in the v2.0 program set `position:relative` on `.leaflet-marker-icon`, overriding the `position:absolute` that leaflet.css declares under "required styles". Marker icons are `display:block`, so relative positioning returned all 700+ planes to normal flow inside the marker pane: each one stacked below the previous before Leaflet applied its `translate3d()`, sinking marker N by exactly 5N pixels. On a 1280x800 viewport only ~70 of 766 markers landed on screen; the rest smeared south across South America and off the map. Hub markers were unaffected because they are `L.circleMarker` (SVG in the overlay pane), which is what made the outage look partial rather than total.
- The 10px→20px touch target that rule was added for is unchanged: the `::after` hit-slop still resolves against the icon, because an absolutely positioned element is already a containing block for its abspos descendants. `position:relative` was never needed.
- Regression guard: `tests/leaflet-required-styles.test.js` fails CI on any rule that sets `position` on the elements leaflet.css positions itself.

## [Unversioned] — v2.0 Review & Remediation Program (PR #220) - 2026-07-08

The single largest change to the deployed product shipped through PR #220 **without a version bump or a CHANGELOG entry at the time** — the log jumped straight from 1.7.0 to 1.7.1, and every entry since has referenced "the v2.0 program" (and its F0-numbered findings) as if it were recorded here. This section documents it retroactively. It came out of a seven-persona review + five-domain code audit that produced 93 adversarially-verified findings (F001–F093); the full commit map, finding IDs, and owner actions live in `docs/HANDOFF.md` and `docs/reviews/2026-07-08-persona-review.md`.

### Added
- **`/newark` Operations Center** — a live EWR status page: current operational state, the FAA slot-cap timeline through Oct 30 2027, FAQ structured data, and sitemap/llms entries. (P3-EWR)
- **Background flight-watch push alerts** — subscribe to a flight and receive a Web Push when its status meaningfully changes. Adds `sql/014_watch_subscriptions.sql`, `/api/push-subscribe`, the `*/5` `api/cron/watch-alerts.ts` diff cron (free data tiers only), the `sw.js` push handler, and the ported meaningful-change rules in `api/_watch-diff.ts`; degrades gracefully when VAPID is unconfigured. (P3-PUSH)
- **Public `/api/support-stats` cost meter** — a sanitized FR24 usage readout (counts plus 5%-rounded percentages only) surfaced in the About popover. (P3-METER)
- **Jargon tooltips and provenance chips** — plain-English tooltips on aviation jargon, universal timezone labels via `src/lib/time-format.js`, data-age/provenance chips, and a landed-payoff donation moment. (P2-A)
- **Mobile My Flights primary nav** — My Flights promoted into the primary mobile nav, sticky mobile headers, safe-area insets, maskable PWA icons, and 12 per-page OG images (`public/og/`, `scripts/generate-og.py`). (P2-B)
- **Schedule-aware, space-tolerant search** plus keyboard/ARIA reachability across sort headers, registration links, risk badges, search results, and hub rows, and an onboarding focus trap/Escape. (WP7)

### Changed
- **`src/data/facts.js` single source of truth + site-wide truth sweep** — 8 hubs + the NRT gateway (including JSON-LD), Starlink counts (428/425+), the TLV suspension, and an honest TSA gate reconciled across the site and README. (WP2)
- **Accessibility pass** — heading order, landmarks, `--ua-dim → #7C8DA6` (measured ≥4.8:1), blue-as-text eliminated, focus ring, drawer Escape, and an IROPS-change live region — axe: 0 violations; `DESIGN.md` updated. (P2-C)

### Fixed
- **WP1–WP8 data-trust fixes.** Arrivals-OTP direction, AI riskScore coercion, fleet SEATS render, V.HIGH filter, squawk parsing, and the explain-cache key (WP1); the FR24 official-API age gate, a shared 402 quota block across all callers, board `generatedAt`/`dataAge` freshness stamps, METAR backfill TTL, and function `maxDuration`s (WP8); the IROPS single-writer + held-flight (overdue) scoring and FAA-program-blended hub chips (WP3); real `registration` threaded through every flight-times tier — reviving Where's-My-Plane, journey, and inbound-risk — plus `src/lib/connection-risk.js` (never SAFE on cancelled/NaN) (WP6); and the landscape onboarding lockout, `#legalpop` containing-block, stat-strip overlap, and tooltip clipping (WP4).

## [1.7.0] - 2026-07-07

### Added
- Fleet type pages: a **Specifications** section on all 19 aircraft pages (manufacturer, model, body type, engines, range, cruise speed, wingspan, length), rendered from each type's `aircraftSchema` — the data existed but was never shown to users or search engines
- Fleet type pages: those specs are now emitted as structured data (`additionalProperty` on the aircraft guide schema), plus a "Specs" jump-nav link on every page
- Fleet index (`/fleet`): a "What's New in United's Fleet — 2026" section (Polaris Studio, A321XLR entry into service, Starlink milestones, Signature Interior progress, United's centennial)
- 787-9 page: a Polaris Studio / "Elevated" section — the new 8-suite premium product (787-9-exclusive), with the 222-seat Elevated layout shown alongside the standard 257-seat config
- A321neo page: an A321XLR section + FAQ (entered service June 2026; United's first single-aisle with lie-flat Polaris + Premium Plus; the Boeing 757-200 replacement)

### Changed
- Fleet: full July-2026 fact-check refresh across all 19 aircraft-type pages, the fleet index, and the homepage, verified against current sources (AeroLOPA seat maps, United newsroom, aviation press)
  - Starlink story added per type and refreshed site-wide: regional E175 led (May 2025), first mainline 737-800 (Oct 2025), first widebody 777 transatlantic (Jun 2026), free for MileagePlus; counts updated 258 → 425+/430 on the homepage and fleet index (stat card, Dataset schema, FAQs)
  - United Next "Signature Interior" (seatback 4K screens, Bluetooth, larger bins) added to the 737 and A320-family pages, with factory-fit vs retrofit noted per type
  - 757-200/-300 reframed as phasing out across 2026–2028, with the A321XLR replacing the transatlantic 757-200
  - 767-300ER/-400ER: retirement-by-~2030 framing (787-9 replacement); 767-300ER two-config detail (167-seat high-Polaris / 203-seat standard); 767-400ER Polaris corrected to 1-1-1 staggered
  - 777-200: draw-down / stored status (post-2021 PW4000 issue; N777UA retired Dec 2025); 777-300ER reinforced as the flagship/largest; first-widebody-Starlink hook on the ER pages
  - Fleet index FAQs refreshed (the newest-aircraft answer now leads with the A321XLR); United Express regional context added; hub framing corrected to "8 hubs + Tokyo-Narita gateway"
- Homepage: FAQ + fleet-tab Starlink copy updated (258 → 425+, free for MileagePlus, ~1,000 aircraft targeted by year-end)
- llms.txt / llms-full.txt: Polaris Studio + A321XLR freshness added

### Fixed
- Engine specs corrected to United's actual fits (now surfaced in the visible Specifications section):
  - 787-8 / 787-9: removed "or Rolls-Royce Trent 1000" — United's 787s are all GEnx-1B
  - A319 / A320: narrowed to IAE V2500-A5 (United's selected engine)
  - 777-200 (non-ER): corrected to Pratt & Whitney PW4077 only (removed GE90-77B; Continental never operated non-ER 777s)
  - 777-200ER: corrected to the mixed PW4090 / GE90-94B fleet (was GE90-94B only)
- 767-300ER seat range corrected (167–214 → 167–203; 214 was an obsolete pre-Premium-Plus figure)
- Fleet type pages: added `og:image:width/height` meta (parity with hub pages)
- Removed a phantom "MAX 10" from llms-full.txt (United does not operate the MAX 10) and added the missing 777-200 to the type list

## [1.6.1] - 2026-07-06

### Changed
- Hub pages: full July-2026 content refresh across all 9 hubs, fact-checked against current sources
  - NRT rewritten — Haneda (HND) is United's primary Tokyo gateway; NRT reframed as the Asia-Pacific connecting point (787 SFO + new ORD route from Oct 24, plus the Narita-based 737 MAX 8 network); removed the stale Haneda route list and "15–20 daily flights" claim
  - EWR: new "Newark ATC Crisis & FAA Flight Caps" section (72 ops/hr caps extended through Oct 30, 2027; United's schedule cuts); departures caveated to ~350–400 under caps; Polaris location tightened (C102–C120)
  - ORD: Polaris Lounge corrected to Concourse C near C18 (was a nonexistent "B6"); O'Hare 21 timeline updated (Satellite Concourse 1 ~2028, Global Terminal ~2032, full program ~2034, T2 demolition starts 2026); FAA summer-cap note; departures framed as "up to ~750 at summer peak"
  - DEN: four United Clubs (~100k sq ft, was "two"); B-West/B-East expansion dates corrected (2020/2022, not Oct 2024); Great Hall final phase (end 2027); 180+ destinations
  - IAH: ~480 daily departures (was ~400); terminal model reconciled (B = Express, C = mainline domestic, E = international + Polaris); MLIT recast as complete; added Terminal B Transformation (22-gate North Concourse + world's largest United Club, late 2026)
  - IAD: Concourse E updated from "planned" to opening fall 2026 with new ~40k sq ft United Club
  - LAX: Polaris location corrected (between gates 73–75A, not 71A); APM target updated (Oct 2026); consistent "smallest mainland hub / Pacific gateway" framing
  - GUM: Island Hopper stops corrected (exactly 5 intermediate; Palau/Yap are separate routes); added the 2026 737 MAX 8 + Starlink fleet-renewal story
  - Starlink copy on every hub rewritten around the real rollout: E175 regional jets led (May 2025), first mainline 737-800 (Oct 2025), first widebody 777 transatlantic (Jun 2026), 425+ equipped as of mid-2026, free for MileagePlus members
- Hubs index + llms.txt/llms-full.txt: departure counts, FAA-cap note, NRT reframing, and Starlink counts (258+ → 425+) aligned with the refreshed pages
- Starlink static seed (`public/data/starlink.json`) refreshed from the live snapshot (258 → 428 aircraft)

### Fixed
- Hub page SEO: added `og:image:width/height` meta; removed a dead Place/Airport schema-comment stub in HubLayout

## [1.6.0] - 2026-07-04

### Added
- Schedule: server-side registration ledger — every user now sees tails harvested from live flight tracking (Supabase `reg_sightings`, written from the live-feed function + hourly cron backstop, merged into every board response; provider values never overwritten)
- Schedule: LIVE status overlay — a row still marked "Scheduled" whose aircraft was seen airborne in the last 15 minutes now shows "Departed · LIVE" (departures) or "En Route · LIVE" (arrivals); upgrade-only, never touches canceled/landed/diverted rows, and stat counts stay reconciled with visible rows

## [1.5.27] - 2026-07-04

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

[1.5.0]: https://github.com/jonahberg/the-blue-board/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/jonahberg/the-blue-board/compare/v1.3.8...v1.4.0
[1.3.8]: https://github.com/jonahberg/the-blue-board/compare/v1.3.7...v1.3.8
[1.3.7]: https://github.com/jonahberg/the-blue-board/compare/v1.3.6...v1.3.7
[1.3.6]: https://github.com/jonahberg/the-blue-board/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/jonahberg/the-blue-board/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/jonahberg/the-blue-board/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/jonahberg/the-blue-board/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/jonahberg/the-blue-board/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/jonahberg/the-blue-board/compare/v1.3...v1.3.1
[1.3]: https://github.com/jonahberg/the-blue-board/compare/v1.2...v1.3
[1.2]: https://github.com/jonahberg/the-blue-board/compare/v1.1.1...v1.2
[1.1.1]: https://github.com/jonahberg/the-blue-board/compare/v1.1...v1.1.1
[1.1]: https://github.com/jonahberg/the-blue-board/compare/v1.0...v1.1
[1.0]: https://github.com/jonahberg/the-blue-board/releases/tag/v1.0
