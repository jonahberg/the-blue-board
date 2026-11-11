-- 021: flight_history — one row per United leg that touched a hub, kept after the boards expire.
-- Spec: docs/specs/flight-history.md (schema reasons, key/merge/finality rules, size, read queries,
-- undo). Rules in code: src/lib/flight-history.js (writer) and sql/021_flight_history_backfill.sql.
--
-- WHY: schedule_snapshots holds each hub board as one JSONB row and is deleted ~3 days after the
-- day ends (api/_schedule-snapshots.ts SNAPSHOT_TTL_MS + cleanupExpiredSnapshots), so nothing could
-- say "UA929 ran on time 26 of the last 30 days". This keeps every leg as a lean typed row.
--
-- WRITER: api/cron/warm-schedules.ts → api/_flight-history.ts, from the boards the cron ALREADY
-- fetched (no provider call of its own). Read-merge-write in bounded batches; rules only move
-- forward (a real time is never replaced by an estimate or a null, the outcome never weakens).
-- Kill switch: FLIGHT_HISTORY_ENABLED=0.
-- READERS: none yet (per-flight page, hub/day report cards, ops brief, risk scorecard to come).
--
-- TIMES are int4 minutes since the Unix epoch, UTC (the provider's times are whole minutes):
--   delay in minutes = dep_at - sched_dep;  timestamp = to_timestamp(dep_at * 60).
--
-- KEY: (flight_no, service_date, origin, dest). service_date is the origin hub's local date of the
-- scheduled departure, or — for a leg from a non-hub airport — the destination hub's local date of
-- the scheduled arrival: exactly the hub board day the leg was filed under.
--
-- Columns are ordered for tuple packing (4-byte, then 1-byte, then text), not for reading.
--
-- RLS on, NO policies, no anon/authenticated grants (sql/017 posture): only the service-role API
-- reads or writes. Idempotent: safe to re-run.
-- UNDO: drop table if exists public.flight_history;

create table if not exists public.flight_history (
  service_date  date    not null,
  sched_dep     integer,
  sched_arr     integer,
  dep_at        integer,
  arr_at        integer,
  airborne_at   integer,
  last_seen     integer not null,
  final         boolean not null default false,
  on_dep_board  boolean not null default false,
  on_arr_board  boolean not null default false,
  flight_no     text    not null check (flight_no ~ '^[A-Z0-9]{2,8}$'),
  origin        text    not null check (origin ~ '^[A-Z0-9]{3}$'),
  dest          text    not null check (dest ~ '^[A-Z0-9]{3}$'),
  dep_basis     text    check (dep_basis in ('gate', 'actual', 'runway', 'estimate')),
  arr_basis     text    check (arr_basis in ('gate', 'actual', 'runway', 'estimate')),
  outcome       text    not null default 'unknown'
                        check (outcome in ('unknown', 'canceled_unconfirmed', 'canceled', 'operated', 'diverted')),
  status        text    check (char_length(status) <= 32),
  registration  text    check (registration ~ '^[A-Z0-9-]{2,10}$'),
  aircraft_code text    check (aircraft_code ~ '^[A-Z0-9]{2,6}$'),
  operator      text    check (operator ~ '^[A-Z]{3}$'),
  constraint flight_history_pkey primary key (flight_no, service_date, origin, dest),
  constraint flight_history_dep_pair check ((dep_at is null) = (dep_basis is null)),
  constraint flight_history_arr_pair check ((arr_at is null) = (arr_basis is null))
) with (fillfactor = 90);

-- Every reader except the per-flight lookup (which the primary key serves) scans a run of days:
-- a hub's day, a tail's last week, the last 30 days for a baseline. Rows are inserted roughly in
-- service-day order and updated in place (HOT, hence fillfactor 90), so a BRIN index on the day
-- narrows any day range to its own pages at ~0 bytes per row. A btree per access path (origin,
-- dest, registration) would add ~30 bytes per row each — more than the 200 MB/year budget allows.
create index if not exists flight_history_service_date_brin
  on public.flight_history using brin (service_date) with (pages_per_range = 16, autosummarize = on);

alter table public.flight_history enable row level security;

-- Supabase's default privileges grant new public tables to anon/authenticated; RLS without a policy
-- already denies them every row, and this takes the grant away too (belt and braces).
revoke all on table public.flight_history from anon, authenticated;

comment on table public.flight_history is
  'One row per United leg that touched a hub board, merged forward-only from every board observation (warm cron). Times are int4 epoch minutes (UTC). Spec: docs/specs/flight-history.md.';
comment on column public.flight_history.service_date is
  'Origin hub''s local date of the scheduled departure; for a leg from a non-hub airport, the destination hub''s local date of the scheduled arrival (= the board day).';
comment on column public.flight_history.sched_dep is
  'Scheduled departure, epoch minutes UTC: the EARLIEST provider-sent schedule seen (the original baseline). Null when the provider only derived it from the actual.';
comment on column public.flight_history.sched_arr is
  'Scheduled arrival, epoch minutes UTC; same rules as sched_dep.';
comment on column public.flight_history.dep_at is
  'Best known departure, epoch minutes UTC; dep_basis says what kind. Delay = dep_at - sched_dep.';
comment on column public.flight_history.dep_basis is
  'gate (a gate time distinct from the runway time) > actual (provider actual, no runway time to compare) > runway (runway time, may include taxi-out) > estimate. Same labels as src/lib/board-delay.js.';
comment on column public.flight_history.arr_at is
  'Best known arrival, epoch minutes UTC. Real arrivals come only from the destination hub''s arrivals board.';
comment on column public.flight_history.arr_basis is
  'As dep_basis, for the arrival (runway = touchdown, before the taxi-in).';
comment on column public.flight_history.airborne_at is
  'Earliest live-feed airborne fix of this instance (reg_sightings via src/lib/reg-overlay.js), epoch minutes UTC. Proof it flew; an upper bound on the departure.';
comment on column public.flight_history.last_seen is
  'Build time (meta.generatedAt) of the newest board observation merged in, epoch minutes UTC.';
comment on column public.flight_history.final is
  'Settled: canceled, diverted, operated with a real arrival, or operated with a real departure to a non-hub destination (no board reports that arrival). False on an old row = never resolved (its board stopped refreshing first).';
comment on column public.flight_history.outcome is
  'Strongest outcome any observation showed: diverted > operated (a real time, a moving status or seen airborne) > canceled (confirmed) > canceled_unconfirmed (Likely Canceled, not seen flying) > unknown.';
comment on column public.flight_history.status is
  'Provider status word (lowercased), the most settled one seen: arrived/canceled/diverted > departed/enroute/approaching > the rest. canceleduncertain is kept even when the outcome says it flew.';
comment on column public.flight_history.registration is
  'Tail the schedule provider reported (live-feed backfills excluded); the newest non-empty value.';
comment on column public.flight_history.aircraft_code is
  'Provider aircraft type code when known (blank on ~30% of rows); the newest non-empty value.';
comment on column public.flight_history.operator is
  'ICAO callsign prefix (UAL mainline; SKW/RPA/GJS/UCA/ASH/AWI United Express — src/lib/express-operators.js). Null when the board had no callsign.';
comment on column public.flight_history.on_dep_board is 'Seen on the origin hub''s departures board.';
comment on column public.flight_history.on_arr_board is 'Seen on the destination hub''s arrivals board.';
