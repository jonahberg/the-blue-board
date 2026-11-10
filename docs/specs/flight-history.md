# Flight history: every leg, kept

**Status:** built, not deployed · **Date:** 2026-11-10
**Files:** `sql/021_flight_history.sql` (table), `sql/021_flight_history_backfill.sql` (one-off),
`src/lib/flight-history.js` (rules), `api/_flight-history.ts` (writer), hook in
`api/cron/warm-schedules.ts`. Tests: `tests/flight-history.test.js`,
`tests/flight-history-writer.test.js`, `tests/warm-flight-history.test.js`.

## Why

The warm cron writes each hub board to `schedule_snapshots` (one JSONB row per hub × direction ×
day), and the snapshot GC deletes it about three days after the day ends. Nothing on the site could
say "UA929 ran on time 26 of the last 30 days", show a tail's recent legs, grade a hub's day, or
check the delay-risk scores. This keeps one lean typed row per leg, forever, for four readers that
are coming: a per-flight page, hub/day report cards, an AI operations brief (today vs normal), and a
public accuracy scorecard for the risk model.

## Where the data comes from

Only from boards the cron already fetched. `warmOne()` in the cron calls `/api/schedule` with
`forceRefresh=1`; the response body is the served board — after `sanitizeServedBoard`
(no actual time later than the clock, no leg longer than 20 h), `dedupeServedBoard` (same-tail
copies collapsed) and the sightings overlay (`applySightingsToBoard`, the seen-airborne evidence).
`/api/schedule` has already written its snapshot before it answers, so the archive starts after the
board write by construction. No AeroDataBox or FR24 call is added. The one extra read is the
`reg_sightings` ledger (our own table, ≤ ~1,500 rows), once per run through the shared
`awaitRegSightings()` cache, so a seen-flying "Likely Canceled" is kept as operated even when the
schedule instance that served the board had a cold ledger cache.

A leg reaches the archive from up to two boards, each refreshed several times a day:

| leg | departures board (origin hub) | arrivals board (destination hub) |
|---|---|---|
| hub → spoke | departure actual + arrival estimate | — |
| spoke → hub | — | arrival actual **and** departure actual (the arrivals board carries both: the fixture `ord-2026-10-03-future-actuals.json` has `real.departure` on FSD→ORD) |
| hub → hub | departure actual + arrival estimate | arrival actual + departure actual |

A departures board never carries the actual arrival (production: 652 rows, 0 with `real.arrival`).

## Schema

`public.flight_history`, one row per leg. **Times are int4 minutes since the Unix epoch, UTC**: the
provider's times are whole minutes, a delay is a subtraction (`dep_at - sched_dep`), and a time is
`to_timestamp(dep_at * 60)`. int4 minutes is half the size of `timestamptz` and good for 4,000 years.
Columns are declared in packing order (4-byte, then 1-byte, then text).

| column | type | why |
|---|---|---|
| `flight_no` | text, PK | the board's ident (`UA2455`). Kept as sent: a provider letter suffix (`UA526H`) is not stripped. |
| `service_date` | date, PK | the board day (see Key). |
| `origin`, `dest` | text, PK | IATA. The route is part of the key: one number flies several legs a day. |
| `sched_dep`, `sched_arr` | int4 min | the **earliest provider-sent** schedule seen — the original baseline. Null when the board only derived it from the actual (`scheduleTimeDerivedFromActual`), so no fake "on time" delta. |
| `dep_at`, `arr_at` | int4 min | the best time known for each side. |
| `dep_basis`, `arr_basis` | text | what that time is: `gate` (a gate time distinct from the runway time) > `actual` (a provider actual with no runway time to compare) > `runway` (runway time, no distinct gate time — the delay may include taxi) > `estimate`. Exactly the labels `src/lib/board-delay.js` puts on the board's delay cell. Null together with the time (check constraint). |
| `airborne_at` | int4 min | the earliest live-feed airborne fix of this instance (`_source.track` / `_source.seenAirborne`). Proof it flew; also an upper bound on the departure, which is what board-delay uses to reject an impossible "actual". |
| `status` | text | the provider's status word, lowercased, the most settled one seen. A seen-flying Likely Canceled keeps `canceleduncertain` here; the outcome says it flew. |
| `outcome` | text | derived: `operated` / `canceled` (confirmed) / `canceled_unconfirmed` (Likely Canceled, not seen flying) / `diverted` / `unknown`. |
| `final` | bool | settled — see Finality. |
| `registration` | text | tail the schedule provider sent (live-feed backfills excluded: they are matched on number + window, not reported). |
| `aircraft_code` | text | provider type code when present (blank on ~30% of rows). |
| `operator` | text | callsign prefix: `UAL` mainline, `SKW/RPA/GJS/UCA/ASH/AWI` United Express (the airline field cannot tell, `src/lib/express-operators.js`). |
| `on_dep_board`, `on_arr_board` | bool | which boards contributed; lets a reader tell "no arrival because nobody reports it" from "no arrival yet". |
| `last_seen` | int4 min | build time (`meta.generatedAt`) of the newest board merged in. A non-final row whose `last_seen` is before its scheduled arrival was never seen finishing. |

RLS on, no policies, `revoke all … from anon, authenticated` — the sql/017 posture: only the
service role reads or writes.

### Indexes

- **Primary key** `(flight_no, service_date, origin, dest)` — the writer's conflict target, and the
  per-flight read (`flight_no = … and service_date >= …` is a range on its prefix).
- **BRIN** on `service_date` (`pages_per_range = 16`, `autosummarize = on`). Every other reader scans
  a run of days (a hub's day, a tail's week, a 28-day baseline). Rows arrive roughly in day order and
  are updated in place (fillfactor 90 leaves room for HOT updates), so a BRIN narrows a day range to
  its own pages at effectively zero bytes per row (24 kB for 575k rows). One btree per access path
  (origin, dest, tail) would add ~30–60 bytes per row each — more than the whole size budget.

Measured on a throwaway local Postgres 17 with 575,040 synthetic rows (120 days × 4,900 legs,
inserted day by day): per-flight 30 days = PK bitmap scan, 0.1 ms, 37 buffers; ORD one day =
BRIN, 109 heap pages, 0.4 ms; a tail's last 7 days = BRIN, 621 pages, 2.5 ms; ORD 28-day baseline =
BRIN, 2,256 pages, 5.8 ms. Until autovacuum summarizes the newest block range it matches every
query (a full scan of those pages only) — correct, just not pruned.

## Key

`(flight_no, service_date, origin, dest)`, where **service_date is the board day**: the origin
hub's local date of the scheduled departure, or — for a leg from a non-hub airport, which only its
destination hub's arrivals board sees — the destination hub's local date of the scheduled arrival.
Each uses the board's own order (scheduled → real → estimated, as `isInHubDay` does) and the hub's
IANA zone (`HUB_TZ`; SQL: `(to_timestamp(s) at time zone tz)::date`, the same value).

- A hub-to-hub leg gets the same date from both of its boards (both use the origin hub's zone).
- A late-evening departure keeps its scheduled day even when it leaves after midnight.
- A red-eye from a spoke is filed under the day it lands, the day of the arrivals board it is on.
- Same number, same route, two days → two rows. Same number, two routes, one day → two rows.
- Same number, same route, same day → **one** row. That is deliberate: the boards' duplicates
  (`board-dedupe.js`: re-timed copies with a later "schedule", ghosts beside the real row, a second
  tail nobody can tell apart) are one physical flight, and the archive must not count them twice.
  A genuine second instance on the same route and day (not observed) would merge into the first.
- A hub-to-hub row on an arrivals board with no departure time at all cannot be keyed and is
  skipped (`no_key_time`); its departures board still writes the leg.

## Rules (`src/lib/flight-history.js`)

### One observation → one candidate row (`observeFlight`)

- Skipped: no ident, no route, a row not belonging to this board, a synthetic live-feed fallback row
  (`_source.liveFeedFallback`), a leg touching no hub.
- **The side the board does not vouch for is checked.** If the provider schedules span less than
  10 min or more than 20 h, or the actuals do, the two sides are different instances; the board's own
  side is kept and the other dropped (a 25-hour scheduled block on a departures board loses its
  arrival).
- Each side's time: the provider's real time if it is plausible against its schedule
  (`isPlausibleDelta`: −3 h … +16 h), labelled exactly as board-delay labels it; else its estimate
  if plausible (−3 h … +6 h); else nothing.
- Outcome: diverted if the provider says so; operated if there is a real time, a moving status
  (departed / en route / landed) or an airborne fix; else canceled (confirmed) or
  canceled_unconfirmed (`cancellationKind() === 'likely'`); else unknown.
- Several rows on one board with the same key: the one with the best evidence wins, in
  `board-dedupe.js`'s order (a real board-side time, any real time, a distinct gate time, real ≠
  scheduled, a provider schedule, how many times it carries, the earlier schedule); ties keep board
  order. The rest are counted as `duplicates`.

### Merge into the stored row (`mergeFlightHistoryRow`) — forward only

| field | rule |
|---|---|
| `sched_dep`, `sched_arr` | the earliest provider schedule (a re-timed copy's later "schedule" would erase the delay) |
| `dep_at/basis`, `arr_at/basis` | a stronger basis wins (gate > actual > runway > estimate); the same basis takes the newer observation; **null never replaces a time, an estimate never replaces a real time** |
| `airborne_at` | the earliest fix |
| `status` | a word at least as settled (arrived/canceled/diverted > departed/enroute/approaching > the rest), ties to the newer observation — `arrived` never goes back to `enroute`, `departed` never to `canceleduncertain` |
| `outcome` | the strongest seen: diverted > operated > canceled > canceled_unconfirmed > unknown. A flight seen flying is never un-flown by a later board whose overlay was cold; a confirmed cancellation that later shows a real departure (reinstated) becomes operated — facts beat words |
| `registration`, `aircraft_code`, `operator` | the strictly newer observation's non-empty value |
| `on_*_board` | OR |
| `last_seen` | max |
| `final` | recomputed from the merged row |

"Newer" compares the observation's board build time with the row's `last_seen`, so a degraded
fallback board (an old board served again) can add facts but cannot overwrite newer ones of the same
strength. The merge is order-independent for observations with distinct build times (tested, and
checked again in the parity run below).

### Finality

`final` is true when the outcome is canceled or diverted; or operated with a real arrival; or
operated with a real departure to a destination that is not a hub (no board will ever report that
arrival — a hub-to-spoke leg is complete at its departure; later estimate updates may still land).
It is a pure function of the merged row, so it can only change when the facts do.

**Late-evening legs.** A day's board stops refreshing shortly after local midnight (ORD departures:
~40 min after the day ends; arrivals boards around 23:00 local), and nothing warms yesterday's board.
A leg that had not reached a final state by its board's last refresh stays `final = false`, with its
last estimate and `outcome = 'unknown'` or `'operated'` — the archive does not guess. Two things
still settle some of them for free: an overnight arrival lands on the next day's arrivals board (the
key is the departure-side date, so it merges), and an airborne fix proves operation. Readers must
treat `not final and last_seen < coalesce(sched_arr, sched_dep)` as "never seen finishing", not as
on time or late.

## Size

Measured on Postgres 17 with realistic rows (all columns populated as production would be):
**heap ≈ 131–140 bytes/row** (fillfactor 90), **primary key ≈ 41 bytes packed, ≈ 58 bytes as
written** (keys arrive in flight-number order within each day, so leaf pages split to ~70% full),
**BRIN ≈ 0**. All-in **≈ 190 bytes/row**.

Rows: the 18 boards carried 5,228 rows on Oct 4 2026; hub-to-hub legs are on two boards, so roughly
**4,700–5,000 legs/day ≈ 1.7–1.8 M rows/year ≈ 330–350 MB/year**, plus dead-tuple churn between
autovacuums (each leg is rewritten a few times while it is live; unchanged rows are skipped).

**That is over the 200 MB/year target, and no one-row-per-leg design meets it.** The floor is the
per-row overhead: tuple header + line pointer (~32–36 B) + a primary-key entry (~40–58 B) is ~90 B
before any data, and the bare minimum (key, four times, two bases, outcome, tail, last_seen —
nothing else) measured ~140 B/row ≈ 250 MB/year. What I would drop, in order, if the target is firm:

| lever | saves / row | ≈ MB / year | cost |
|---|---|---|---|
| one-letter codes for `dep_basis`, `arr_basis`, `outcome` | ~18 B | −32 | readability of every query |
| fillfactor 100 | ~14 B | −25 | updates stop being HOT: index churn, BRIN drifts |
| drop `aircraft_code`, `operator`, `on_*_board` | ~10 B | −18 | type needs a fleet join; mainline/Express split needs a number-range guess |
| drop `status` (keep `outcome`) | ~9 B | −16 | loses the provider's word, which was asked for |
| **retention**: keep rows 13 months, roll older ones into per-flight-per-month counts | — | caps the table at ~1 year | the only lever that actually bounds it |

The undo is one statement, so nothing here is a one-way door.

## The four reads

All run as the service role. Day bounds for a hub are its local midnights, in epoch minutes:
`(extract(epoch from (date 'D')::timestamp at time zone 'America/Chicago') / 60)::int`.
"Real" below means `basis in ('gate','actual','runway')`; the site's on-time rule is a real
departure within 30 min of a provider schedule (`src/lib/hub-health.js` `ON_TIME_GRACE_MIN`,
`operatedOutcome`); implausible times and derived schedules are already excluded at write time.

### 1. Per-flight page — **primary key**

```sql
-- UA929, last 30 service days
select service_date, origin, dest, outcome, final,
       to_timestamp(sched_dep * 60) as scheduled_departure,
       dep_at - sched_dep as dep_delay_min, dep_basis,
       arr_at - sched_arr as arr_delay_min, arr_basis,
       registration, aircraft_code, operator
from public.flight_history
where flight_no = 'UA929' and service_date >= current_date - 30
order by service_date desc, sched_dep;

-- "ran on time N of the last M days"
select count(*) filter (where dep_basis in ('gate','actual','runway') and sched_dep is not null
                          and dep_at - sched_dep <= 30)                        as on_time,
       count(*) filter (where dep_basis in ('gate','actual','runway') and sched_dep is not null) as with_actual,
       count(*) filter (where dep_basis = 'runway')                           as runway_based, -- may include taxi
       count(*) filter (where outcome = 'canceled')                           as canceled,
       count(*) filter (where outcome = 'canceled_unconfirmed')               as likely_canceled_unseen,
       count(*) filter (where not final and outcome = 'unknown')              as unresolved,
       count(*)                                                               as days
from public.flight_history
where flight_no = 'UA929' and service_date >= current_date - 30;
```

A tail's recent legs — **BRIN** on `service_date`, then a filter on the tail (a week is ~35k rows):

```sql
select service_date, flight_no, origin, dest,
       to_timestamp(coalesce(dep_at, sched_dep) * 60) as departed,
       dep_at - sched_dep as dep_delay_min, arr_at - sched_arr as arr_delay_min, outcome
from public.flight_history
where registration = 'N37502' and service_date >= current_date - 7
order by coalesce(dep_at, sched_dep) desc
limit 30;
```

### 2. Hub/day report card — **BRIN**

```sql
-- ORD departures on Sun Nov 8 2026 (service_date = the departures board day)
select count(*)                                                                   as scheduled,
       count(*) filter (where outcome in ('operated','diverted'))                  as operated,
       count(*) filter (where outcome = 'canceled')                                as canceled,
       count(*) filter (where outcome = 'canceled_unconfirmed')                    as likely_canceled_unseen,
       count(*) filter (where outcome = 'diverted')                                as diverted,
       count(*) filter (where dep_basis in ('gate','actual','runway') and sched_dep is not null) as with_actual,
       count(*) filter (where dep_basis in ('gate','actual','runway') and dep_at - sched_dep <= 30) as on_time,
       count(*) filter (where dep_basis in ('gate','actual','runway') and dep_at - sched_dep > 60)  as late_60,
       percentile_cont(0.5) within group (order by dep_at - sched_dep)
         filter (where dep_basis in ('gate','actual','runway') and sched_dep is not null)            as median_delay_min,
       count(*) filter (where dep_basis = 'gate')                                  as gate_based,
       count(*) filter (where operator <> 'UAL')                                   as express,
       count(*) filter (where not final and outcome = 'unknown')                   as unresolved
from public.flight_history
where origin = 'ORD' and service_date = date '2026-11-08';

-- ORD arrivals on Nov 8 local. A hub-to-hub arrival is keyed by its departure date in the origin
-- hub's zone (D-1 … D+1 across the date line), so the day window is on the arrival time and the
-- service_date range only lets the BRIN prune.
with b as (select (extract(epoch from (date '2026-11-08')::timestamp at time zone 'America/Chicago') / 60)::int as lo,
                  (extract(epoch from (date '2026-11-09')::timestamp at time zone 'America/Chicago') / 60)::int as hi)
select count(*)                                                                    as scheduled,
       count(*) filter (where arr_basis in ('gate','actual','runway'))             as with_actual,
       count(*) filter (where arr_basis in ('gate','actual','runway') and arr_at - sched_arr <= 15) as on_time_a14,
       count(*) filter (where outcome in ('canceled','canceled_unconfirmed'))      as canceled_any,
       count(*) filter (where outcome = 'diverted')                                as diverted
from public.flight_history, b
where dest = 'ORD' and service_date between date '2026-11-07' and date '2026-11-09'
  and coalesce(sched_arr, arr_at) >= b.lo and coalesce(sched_arr, arr_at) < b.hi;
```

### 3. Ops brief: today against normal — **BRIN**

```sql
-- ORD departures scheduled before 14:30 local: today vs the same part of the previous 28 days.
with p as (select 'ORD'::text as hub, 'America/Chicago'::text as tz, date '2026-11-10' as d, time '14:30' as upto),
days as (
  select f.service_date,
         count(*) filter (where f.dep_basis in ('gate','actual','runway') and f.sched_dep is not null) as departed,
         count(*) filter (where f.dep_basis in ('gate','actual','runway') and f.dep_at - f.sched_dep <= 30) as on_time,
         count(*) filter (where f.outcome in ('canceled','canceled_unconfirmed'))                as canceled,
         avg(f.dep_at - f.sched_dep) filter (where f.dep_basis in ('gate','actual','runway'))    as avg_delay_min
  from public.flight_history f, p
  where f.origin = p.hub and f.service_date between p.d - 28 and p.d
    and (to_timestamp(f.sched_dep * 60) at time zone p.tz)::time < p.upto
  group by f.service_date)
select t.departed, t.on_time, t.canceled, round(t.avg_delay_min, 1) as avg_delay_min,
       (select percentile_cont(0.5) within group (order by on_time::numeric / nullif(departed, 0))
          from days, p where days.service_date < p.d)                     as normal_on_time_share,
       (select percentile_cont(0.9) within group (order by canceled)
          from days, p where days.service_date < p.d)                     as p90_canceled
from days t, p where t.service_date = p.d;
```

### 4. Risk-model scorecard

Needs a prediction logged server-side before departure, joined to this table on the same key —
see "Prediction logging" below.

## Writer (`api/_flight-history.ts`) and the hook

- **Where:** `warmOne()` now also returns the response body (`board`); the warm loop and the extra
  arrivals warm each call `flightHistory.ingest(board, task)` right after the board comes back, and
  the handler awaits `flightHistory.finish()` once, after the Starlink ping and before the summary
  log and alerting. The summary is returned as a top-level `flightHistory` field, not inside
  `results` (the alerting reads `results` as schedule boards).
- **Why it cannot hurt the board writes:** the board write happens inside `/api/schedule` before it
  answers the cron, so the archive only ever sees boards that are already written. `ingest()` is
  synchronous and never awaited in the loop; the work runs on a promise chain beside the next warm.
  Boards are processed one at a time (two boards carrying one hub-to-hub leg in the same run would
  otherwise race their read-merge-write).
- **Budget:** each batch is ≤ 200 rows (one select narrowed to the board's hub + the batch's
  flight numbers + days, one upsert of only the changed rows), each statement aborts after 8 s, at
  most 80 statements per run (a normal run needs ~20–40), no statement starts after 280 s into the
  run, and `finish()` waits at most **15 s**. Why 15: the cron's documented worst case is ≈ 273 s
  (180 s of warms + one 55 s extra warm + 3 s gap + ≤ 10 s sightings + ≤ 20 s Starlink + alerting);
  15 s more stays under 300 s, and the 280 s deadline caps it regardless. Typical cost after the loop
  is ~0 s: the batches (~50–150 ms each) finish while the later warms (10–55 s each) run.
- **Failure modes, all swallowed and counted:** no service-role env → no-op (one warning per
  instance); table missing (sql/021 not applied) → one error line per instance, the run stops;
  a select error → that batch is **not written** (an upsert without the merge could replace real
  times); an upsert error → counted, next batch; a hung statement → aborted at 8 s or at the settle
  cap; a thrown client → counted. `ingest()` never throws and `finish()` never rejects.
- **One log line per run:** `flight-history: <status> boards= rows= inserted= updated= unchanged=
  duplicates= skipped={…} statements= errors= boardsSkipped= waited=…ms [firstError=…]`.
- **Kill switch:** `FLIGHT_HISTORY_ENABLED=0` (also `off`/`false`/`no`), read at the start of every
  run. Like every Vercel env change it takes effect on the next deployment.

## Backfill (`sql/021_flight_history_backfill.sql`)

Run in the Supabase SQL editor, after the migration and **before** the writer is deployed (the
writer's read-merge-write and the backfill's upsert are not meant to interleave). It recreates the
writer's rules in SQL — row checks, the served-board span check, the board-delay basis labels, the
sightings instance gate against `reg_sightings`, the evidence pick, the forward-only merge as one
`insert … on conflict do update`, finality — with helpers in a private schema `fh_backfill`. Each
`select fh_backfill.next_board();` line is its own statement and processes **one** board (one
`schedule_snapshots` row), oldest hub day first, so none nears the statement timeout; there are 152
such lines for the ~100 boards normally kept. `fh_backfill.boards` records which boards are done, so
the file is resumable: its last statement (the only result the editor shows) reports
`boards_done, boards_left, legs, first_day, last_day`; if `boards_left > 0`, run the file again.
When it is 0, drop the helpers with `drop schema if exists fh_backfill cascade;` — a separate,
pure deletion, not part of the file.

**How it was exercised:** statement by statement (autocommit) through `psql -f`, twice, on the
throwaway local cluster below — not as one Supabase SQL-editor request, and not inside one
transaction. If the editor runs the file as a single transaction, a failure anywhere rolls the
whole run back (nothing half-applied); re-running is safe either way. The final edit (resumable
ending, drop moved out) changed only comments and the last `select`, and was not re-run.

**Parity was checked**: the same boards — a synthetic set covering hub-to-hub merges, spoke legs,
duplicates, derived schedules, spliced instances, implausible times, Likely Canceled with and
without an airborne sighting, confirmed cancels, diversions, live-feed rows — and the real
`tests/fixtures/ord-2026-10-03-future-actuals.json` boards were run through the JavaScript rules and
through this script on a throwaway local Postgres 17 (loopback only, in a scratch directory,
deleted afterwards; no project or Supabase database was touched): **0 differing columns**; a second run of the
script changed nothing. (The harness found two NULL-logic bugs in the SQL first — absent JSON flags
compare as NULL, not false — fixed with `fh_backfill.flag()`.) One difference by design: the writer
reads sightings newer than 36 h (a cache size), the backfill reads them all through the same
instance gate. Snapshot rows already passed the fetch-time future-actual check (v1.11.3), which the
script does not repeat.

## Rollout and undo

1. Apply `sql/021_flight_history.sql`.
2. Run `sql/021_flight_history_backfill.sql` in the SQL editor (minutes). Its result row must say
   `boards_left = 0` (else run it again); then `drop schema if exists fh_backfill cascade;`.
3. Deploy. The next warm-cron run logs `flight-history: ok …`.

Undo: `drop table if exists public.flight_history;` (and `drop schema if exists fh_backfill cascade;` if
the backfill helpers are still there). To stop writing without dropping: set
`FLIGHT_HISTORY_ENABLED=0` and redeploy.

## Known limits

- Over the 200 MB/year target (see Size).
- Late-evening legs whose board stopped refreshing stay unresolved (see Finality).
- `reg_sightings` keeps one sighting per flight number, so the airborne evidence for a day is only
  as good as the ledger was while that day's boards were being warmed (same limit as the board).
- A row's tail is the provider's, not the live feed's; Express tails appear when AeroDataBox sends them.
- `runway`-basis times (most departures, per `docs/specs/irops-delay-measurement.md`) include taxi;
  every read can split on `dep_basis`.
