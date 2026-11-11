-- 021 backfill: unpack every board still in schedule_snapshots into flight_history. Run in the
-- Supabase SQL editor AFTER sql/021_flight_history.sql and BEFORE the writer is deployed (the
-- writer reads, merges and writes in JavaScript; running this while it writes could lose a merge).
-- The oldest snapshot rows expire within days (cleanupExpiredSnapshots), so run it promptly.
--
-- It applies the writer's rules (src/lib/flight-history.js observeFlight / archiveRowsFromBoard /
-- mergeFlightHistoryRow, plus the reg_sightings airborne evidence the writer gets from
-- src/lib/reg-overlay.js) in SQL. Change one, change the other. One deliberate difference: the
-- writer only reads sightings newer than 36 h (a cache size, api/_reg-sightings.ts); this reads them
-- all and applies the same instance gates, so it can only find what the writer would have found.
--
-- BOUNDED: each `select fh_backfill.next_board();` line is its own statement and processes ONE
-- board (one schedule_snapshots row, ≤ ~700 flights), oldest day first, so no statement gets near
-- the statement timeout. There are 152 such lines for the ~100 boards normally kept (18 a day).
-- Idempotent and resumable: the merge only moves forward, and fh_backfill.boards remembers which
-- boards are done, so running this whole file again simply continues where it stopped.
--
-- HOW TO RUN
--   1. Run this whole file. The editor shows the LAST result: one row with boards_done,
--      boards_left, legs and the day range. If boards_left > 0, run the whole file again.
--   2. Optional — legs per day:
--        select service_date, count(*) as legs, count(*) filter (where final) as final,
--               count(*) filter (where outcome = 'operated') as operated,
--               count(*) filter (where outcome = 'canceled') as canceled,
--               count(*) filter (where outcome = 'canceled_unconfirmed') as canceled_unconfirmed,
--               count(*) filter (where on_dep_board and on_arr_board) as on_both_boards
--        from public.flight_history group by service_date order by service_date;
--   3. When boards_left = 0, remove the helpers (a pure deletion; flight_history is untouched):
--        drop schema if exists fh_backfill cascade;
--
-- Everything temporary lives in the private schema fh_backfill (not exposed by the API: no grants).

create schema if not exists fh_backfill;
revoke all on schema fh_backfill from public;

-- ── Pure helpers (each mirrors a line of src/lib/flight-history.js) ──

-- pos(): a positive number from a JSON value, else null.
create or replace function fh_backfill.pos(v jsonb) returns numeric
language sql immutable as $$
  select case
    when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric > 0 then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' and (v #>> '{}')::numeric > 0 then (v #>> '{}')::numeric
  end
$$;

-- isPlausibleDelta(): missing inputs pass; else −3 h ≤ actual − sched ≤ late cap (16 h real, 6 h estimate).
create or replace function fh_backfill.plausible(actual numeric, sched numeric, late_cap numeric) returns boolean
language sql immutable as $$
  select actual is null or sched is null or (actual - sched <= late_cap and actual - sched >= -3 * 3600)
$$;

-- A JSON boolean that is true; absent, null or anything else is false (JavaScript truthiness for the
-- flags the board carries). Without it, a missing flag makes every comparison NULL.
create or replace function fh_backfill.flag(v jsonb) returns boolean
language sql immutable as $$
  select coalesce(v = 'true'::jsonb, false)
$$;

create or replace function fh_backfill.hub_tz(code text) returns text
language sql immutable as $$
  select case code
    when 'ORD' then 'America/Chicago' when 'DEN' then 'America/Denver' when 'IAH' then 'America/Chicago'
    when 'EWR' then 'America/New_York' when 'SFO' then 'America/Los_Angeles' when 'IAD' then 'America/New_York'
    when 'LAX' then 'America/Los_Angeles' when 'NRT' then 'Asia/Tokyo' when 'GUM' then 'Pacific/Guam'
  end
$$;

create or replace function fh_backfill.basis_rank(b text) returns int
language sql immutable as $$
  select case b when 'gate' then 4 when 'actual' then 3 when 'runway' then 2 when 'estimate' then 1 else 0 end
$$;

create or replace function fh_backfill.outcome_rank(o text) returns int
language sql immutable as $$
  select case o when 'diverted' then 4 when 'operated' then 3 when 'canceled' then 2
                when 'canceled_unconfirmed' then 1 else 0 end
$$;

create or replace function fh_backfill.status_rank(w text) returns int
language sql immutable as $$
  select case
    when regexp_replace(lower(coalesce(w, '')), '[^a-z]', '', 'g') in ('arrived', 'landed', 'canceled', 'cancelled', 'diverted') then 2
    when regexp_replace(lower(coalesce(w, '')), '[^a-z]', '', 'g') in ('departed', 'enroute', 'approaching') then 1
    else 0
  end
$$;

-- isFinalRow()
create or replace function fh_backfill.is_final(outcome text, dep_basis text, arr_basis text, dest text) returns boolean
language sql immutable as $$
  select coalesce(outcome in ('canceled', 'diverted')
      or (outcome = 'operated' and (
            arr_basis in ('gate', 'actual', 'runway')
         or (dep_basis in ('gate', 'actual', 'runway') and fh_backfill.hub_tz(dest) is null))), false)
$$;

-- ── The boards, oldest hub day first ──
create table if not exists fh_backfill.boards (
  cache_key text primary key,
  day_ts    bigint not null,
  dir_rank  int not null,
  hub       text not null,
  done      boolean not null default false,
  note      text
);
insert into fh_backfill.boards (cache_key, day_ts, dir_rank, hub)
select cache_key, day_ts, case direction when 'departures' then 0 else 1 end, upper(hub)
from public.schedule_snapshots
on conflict (cache_key) do nothing;

-- ── One board → candidate rows → forward-only merge ──
create or replace function fh_backfill.ingest_board(p_cache_key text) returns text
language plpgsql as $$
declare
  v_hub text;
  v_dir text;
  v_day bigint;
  v_flights int;
  v_rows int;
begin
  select upper(hub), direction, day_ts, coalesce(jsonb_array_length(payload -> 'flights'), 0)
    into v_hub, v_dir, v_day, v_flights
  from public.schedule_snapshots where cache_key = p_cache_key;
  if v_hub is null then
    return format('%s: gone (expired before it was reached)', p_cache_key);
  end if;

  drop table if exists pg_temp.fh_cand;
  create temp table fh_cand on commit drop as
  with snap as (
    select s.hub, s.direction, s.payload,
           floor(coalesce(fh_backfill.pos(s.payload #> '{meta,generatedAt}'), extract(epoch from s.refreshed_at)) / 60)::int as last_seen
    from public.schedule_snapshots s where s.cache_key = p_cache_key
  ),
  raw as (
    select snap.last_seen, snap.direction = 'departures' as is_dep, upper(snap.hub) as board_hub, e.f, e.idx,
           upper(btrim(coalesce(e.f #>> '{identification,number,default}', ''))) as flight_no,
           upper(btrim(coalesce(e.f #>> '{airport,origin,code,iata}', ''))) as origin,
           upper(btrim(coalesce(e.f #>> '{airport,destination,code,iata}', ''))) as dest,
           fh_backfill.pos(e.f #> '{time,scheduled,departure}') as s_dep,
           fh_backfill.pos(e.f #> '{time,scheduled,arrival}') as s_arr,
           fh_backfill.pos(e.f #> '{time,real,departure}') as r_dep,
           fh_backfill.pos(e.f #> '{time,real,arrival}') as r_arr,
           fh_backfill.pos(e.f #> '{time,estimated,departure}') as e_dep,
           fh_backfill.pos(e.f #> '{time,estimated,arrival}') as e_arr,
           fh_backfill.flag(e.f #> '{_source,scheduleTimeDerivedFromActual,departure}') as der_dep,
           fh_backfill.flag(e.f #> '{_source,scheduleTimeDerivedFromActual,arrival}') as der_arr,
           e.f #> '{_source,timeSource}' as ts
    from snap, jsonb_array_elements(case when jsonb_typeof(snap.payload -> 'flights') = 'array' then snap.payload -> 'flights' else '[]'::jsonb end)
         with ordinality as e(f, idx)
  ),
  -- The served-board pass (src/lib/schedule-actuals.js sanitizeBoardFlights): a leg longer than any
  -- flight is two instances spliced together and is dropped. Plus observeFlight's own row checks.
  valid as (
    select r.*,
           -- sidesConsistent(): like with like — provider schedules, then actuals.
           ( (r.der_dep or r.der_arr or r.s_dep is null or r.s_arr is null or (r.s_arr - r.s_dep between 600 and 72000))
         and (r.r_dep is null or r.r_arr is null or (r.r_arr - r.r_dep between 600 and 72000)) ) as consistent
    from raw r
    where r.flight_no ~ '^[A-Z0-9]{2,8}$'
      and r.origin ~ '^[A-Z0-9]{3}$' and r.dest ~ '^[A-Z0-9]{3}$' and r.origin <> r.dest
      and (case when r.is_dep then r.origin else r.dest end) = r.board_hub
      and not fh_backfill.flag(r.f #> '{_source,liveFeedFallback}')
      and not coalesce((r.r_dep is not null or r.r_arr is not null)
               and coalesce(r.r_arr, r.s_arr) - coalesce(r.r_dep, r.s_dep) > 72000, false)
  ),
  trusted as (
    select v.*, (v.is_dep or v.consistent) as trust_dep, (not v.is_dep or v.consistent) as trust_arr
    from valid v
  ),
  keyed as (
    select t.*,
           case when fh_backfill.hub_tz(t.origin) is not null then
                  case when t.trust_dep then (to_timestamp(coalesce(t.s_dep, t.r_dep, t.e_dep)) at time zone fh_backfill.hub_tz(t.origin))::date end
                else
                  case when t.trust_arr then (to_timestamp(coalesce(t.s_arr, t.r_arr, t.e_arr)) at time zone fh_backfill.hub_tz(t.dest))::date end
           end as service_date
    from trusted t
    where fh_backfill.hub_tz(t.origin) is not null or fh_backfill.hub_tz(t.dest) is not null
  ),
  sided as (
    select k.*,
           -- sideTime(): the provider's real time (labelled as board-delay.js does), else its estimate.
           case when k.trust_dep and k.r_dep is not null and fh_backfill.plausible(k.r_dep, k.s_dep, 16 * 3600) then floor(k.r_dep / 60)::int
                when k.trust_dep and k.r_dep is null and k.e_dep is not null and fh_backfill.plausible(k.e_dep, k.s_dep, 6 * 3600) then floor(k.e_dep / 60)::int
           end as dep_at,
           case when k.trust_dep and k.r_dep is not null and fh_backfill.plausible(k.r_dep, k.s_dep, 16 * 3600) then
                  case when k.ts is not null and fh_backfill.flag(k.ts -> 'hasRunwayDep') and not fh_backfill.flag(k.ts -> 'gateDistinctDep') then 'runway'
                       when fh_backfill.flag(k.ts -> 'gateDistinctDep') then 'gate'
                       else 'actual' end
                when k.trust_dep and k.r_dep is null and k.e_dep is not null and fh_backfill.plausible(k.e_dep, k.s_dep, 6 * 3600) then 'estimate'
           end as dep_basis,
           case when k.trust_arr and k.r_arr is not null and fh_backfill.plausible(k.r_arr, k.s_arr, 16 * 3600) then floor(k.r_arr / 60)::int
                when k.trust_arr and k.r_arr is null and k.e_arr is not null and fh_backfill.plausible(k.e_arr, k.s_arr, 6 * 3600) then floor(k.e_arr / 60)::int
           end as arr_at,
           case when k.trust_arr and k.r_arr is not null and fh_backfill.plausible(k.r_arr, k.s_arr, 16 * 3600) then
                  case when k.ts is not null and fh_backfill.flag(k.ts -> 'hasRunwayArr') and not fh_backfill.flag(k.ts -> 'gateDistinctArr') then 'runway'
                       when fh_backfill.flag(k.ts -> 'gateDistinctArr') then 'gate'
                       else 'actual' end
                when k.trust_arr and k.r_arr is null and k.e_arr is not null and fh_backfill.plausible(k.e_arr, k.s_arr, 6 * 3600) then 'estimate'
           end as arr_basis,
           -- The seen-airborne evidence (reg-overlay.js instanceAirborneAt, keyed by normalizeFlightNum).
           (select floor(extract(epoch from rs.airborne_at) / 60)::int
              from public.reg_sightings rs
             where rs.flight_key = 'UA' || substring(k.flight_no from '^(?:UA|UAL)0*([0-9]{1,4})$')
               and coalesce(rs.reg, '') <> ''
               and k.s_dep is not null
               -- sightingMatchesFlight(): the sighting falls in this instance's operation window …
               and extract(epoch from rs.seen_at) >= k.s_dep - 2 * 3600
               and extract(epoch from rs.seen_at) <= coalesce(k.s_arr, k.s_dep + 16 * 3600) + 3 * 3600
               and (coalesce(rs.dest, '') = '' or upper(rs.dest) = k.dest)
               -- … instanceAirborneAt(): airborne from THIS origin, 15 min before to 18 h after the
               -- scheduled departure, and on an arrivals board bound for THIS destination.
               and rs.airborne_at is not null
               and extract(epoch from rs.airborne_at) between k.s_dep - 15 * 60 and k.s_dep + 18 * 3600
               and upper(coalesce(rs.origin, '')) = k.origin
               and (k.is_dep or upper(coalesce(rs.dest, '')) = k.dest)
           ) as airborne_at
    from keyed k
    where k.service_date is not null
  ),
  observed as (
    select s.*,
           case
             when fh_backfill.flag(s.f #> '{status,generic,status,diverted}') then 'diverted'
             when s.dep_basis in ('gate', 'actual', 'runway') or s.arr_basis in ('gate', 'actual', 'runway')
               or lower(coalesce(s.f #>> '{status,generic,status,text}', '')) in ('departed', 'en-route', 'landed')
               or s.airborne_at is not null then 'operated'
             -- cancellationKind()
             when lower(coalesce(s.f #>> '{status,generic,status,text}', '')) in ('canceled', 'cancelled') then 'canceled'
             when ( s.f #>> '{status,generic,status,text}' = 'canceled_uncertain'
                 or s.f #>> '{status,generic,type}' = 'canceled_uncertain'
                 or lower(coalesce(s.f #>> '{status,text}', '')) like '%canceleduncertain%'
                 or lower(coalesce(s.f #>> '{status,text}', '')) like '%canceled uncertain%')
               and (case when s.is_dep then s.r_dep else s.r_arr end) is null then 'canceled_unconfirmed'
             else 'unknown'
           end as outcome,
           -- archiveRowsFromBoard(): the evidence order of src/lib/board-dedupe.js, board side.
           (case when s.is_dep then s.r_dep else s.r_arr end) as ev_real,
           (case when s.is_dep then s.s_dep else s.s_arr end) as ev_sched,
           (case when s.is_dep then s.der_dep else s.der_arr end) as ev_derived,
           (case when s.is_dep then fh_backfill.flag(s.ts -> 'gateDistinctDep') else fh_backfill.flag(s.ts -> 'gateDistinctArr') end) as ev_gate,
           ( (s.s_dep is not null)::int + (s.s_arr is not null)::int + (s.r_dep is not null)::int
           + (s.r_arr is not null)::int + (s.e_dep is not null)::int + (s.e_arr is not null)::int ) as ev_filled
    from sided s
  )
  select distinct on (o.flight_no, o.service_date, o.origin, o.dest)
         o.flight_no, o.service_date, o.origin, o.dest,
         case when o.trust_dep and not o.der_dep then floor(o.s_dep / 60)::int end as sched_dep,
         case when o.trust_arr and not o.der_arr then floor(o.s_arr / 60)::int end as sched_arr,
         o.dep_at, o.dep_basis, o.arr_at, o.arr_basis, o.airborne_at,
         nullif(left(lower(btrim(coalesce(o.f #>> '{status,text}', ''))), 32), '') as status,
         o.outcome,
         case when coalesce(o.f #>> '{aircraft,regSource}', '') <> 'live_feed'
                   and upper(btrim(coalesce(o.f #>> '{aircraft,registration}', ''))) ~ '^[A-Z0-9-]{2,10}$'
              then upper(btrim(o.f #>> '{aircraft,registration}')) end as registration,
         case when upper(btrim(coalesce(o.f #>> '{aircraft,model,code}', ''))) ~ '^[A-Z0-9]{2,6}$'
              then upper(btrim(o.f #>> '{aircraft,model,code}')) end as aircraft_code,
         substring(upper(btrim(coalesce(o.f #>> '{identification,callsign}', ''))) from '^([A-Z]{3})[0-9]') as operator,
         o.is_dep as on_dep_board,
         not o.is_dep as on_arr_board,
         o.last_seen
  from observed o
  order by o.flight_no, o.service_date, o.origin, o.dest,
           (o.ev_real is not null) desc,
           (o.r_dep is not null or o.r_arr is not null) desc,
           (o.ev_real is not null and o.ev_gate) desc,
           (o.ev_real is not null and o.ev_sched is not null and o.ev_real <> o.ev_sched) desc,
           (o.ev_sched is not null and not o.ev_derived) desc,
           o.ev_filled desc,
           o.ev_sched asc nulls last,
           o.idx asc;

  -- mergeFlightHistoryRow(), as one upsert. `excluded` is the observation, the table row is stored.
  insert into public.flight_history as t (
    service_date, sched_dep, sched_arr, dep_at, arr_at, airborne_at, last_seen, final, on_dep_board, on_arr_board,
    flight_no, origin, dest, dep_basis, arr_basis, outcome, status, registration, aircraft_code, operator)
  select c.service_date, c.sched_dep, c.sched_arr, c.dep_at, c.arr_at, c.airborne_at, c.last_seen,
         fh_backfill.is_final(c.outcome, c.dep_basis, c.arr_basis, c.dest), c.on_dep_board, c.on_arr_board,
         c.flight_no, c.origin, c.dest, c.dep_basis, c.arr_basis, c.outcome, c.status, c.registration, c.aircraft_code, c.operator
  from pg_temp.fh_cand c
  on conflict (flight_no, service_date, origin, dest) do update set
    sched_dep = least(t.sched_dep, excluded.sched_dep),
    sched_arr = least(t.sched_arr, excluded.sched_arr),
    dep_at = case when excluded.dep_at is not null and (t.dep_at is null
                    or fh_backfill.basis_rank(excluded.dep_basis) > fh_backfill.basis_rank(t.dep_basis)
                    or (fh_backfill.basis_rank(excluded.dep_basis) = fh_backfill.basis_rank(t.dep_basis) and excluded.last_seen >= t.last_seen))
                  then excluded.dep_at else t.dep_at end,
    dep_basis = case when excluded.dep_at is not null and (t.dep_at is null
                    or fh_backfill.basis_rank(excluded.dep_basis) > fh_backfill.basis_rank(t.dep_basis)
                    or (fh_backfill.basis_rank(excluded.dep_basis) = fh_backfill.basis_rank(t.dep_basis) and excluded.last_seen >= t.last_seen))
                  then excluded.dep_basis else t.dep_basis end,
    arr_at = case when excluded.arr_at is not null and (t.arr_at is null
                    or fh_backfill.basis_rank(excluded.arr_basis) > fh_backfill.basis_rank(t.arr_basis)
                    or (fh_backfill.basis_rank(excluded.arr_basis) = fh_backfill.basis_rank(t.arr_basis) and excluded.last_seen >= t.last_seen))
                  then excluded.arr_at else t.arr_at end,
    arr_basis = case when excluded.arr_at is not null and (t.arr_at is null
                    or fh_backfill.basis_rank(excluded.arr_basis) > fh_backfill.basis_rank(t.arr_basis)
                    or (fh_backfill.basis_rank(excluded.arr_basis) = fh_backfill.basis_rank(t.arr_basis) and excluded.last_seen >= t.last_seen))
                  then excluded.arr_basis else t.arr_basis end,
    airborne_at = least(t.airborne_at, excluded.airborne_at),
    status = case when excluded.status is not null and (t.status is null
                    or fh_backfill.status_rank(excluded.status) > fh_backfill.status_rank(t.status)
                    or (fh_backfill.status_rank(excluded.status) = fh_backfill.status_rank(t.status) and excluded.last_seen >= t.last_seen))
                  then excluded.status else t.status end,
    outcome = case when fh_backfill.outcome_rank(excluded.outcome) > fh_backfill.outcome_rank(t.outcome)
                   then excluded.outcome else t.outcome end,
    registration = case when excluded.registration is not null and (t.registration is null or excluded.last_seen > t.last_seen)
                        then excluded.registration else t.registration end,
    aircraft_code = case when excluded.aircraft_code is not null and (t.aircraft_code is null or excluded.last_seen > t.last_seen)
                         then excluded.aircraft_code else t.aircraft_code end,
    operator = case when excluded.operator is not null and (t.operator is null or excluded.last_seen > t.last_seen)
                    then excluded.operator else t.operator end,
    on_dep_board = t.on_dep_board or excluded.on_dep_board,
    on_arr_board = t.on_arr_board or excluded.on_arr_board,
    last_seen = greatest(t.last_seen, excluded.last_seen);
  get diagnostics v_rows = row_count;

  -- final is a function of the merged row (isFinalRow), so it is set after the merge.
  update public.flight_history f
     set final = fh_backfill.is_final(f.outcome, f.dep_basis, f.arr_basis, f.dest)
    from pg_temp.fh_cand c
   where (f.flight_no, f.service_date, f.origin, f.dest) = (c.flight_no, c.service_date, c.origin, c.dest)
     and f.final is distinct from fh_backfill.is_final(f.outcome, f.dep_basis, f.arr_basis, f.dest);

  return format('%s %s day %s: %s flights → %s rows merged',
                v_hub, v_dir, to_char(to_timestamp(v_day) at time zone coalesce(fh_backfill.hub_tz(v_hub), 'UTC'), 'YYYY-MM-DD'),
                v_flights, v_rows);
end
$$;

create or replace function fh_backfill.next_board() returns text
language plpgsql as $$
declare
  v_key text;
  v_note text;
begin
  select cache_key into v_key from fh_backfill.boards where not done
   order by day_ts, dir_rank, hub, cache_key limit 1;
  if v_key is null then
    return 'done';
  end if;
  v_note := fh_backfill.ingest_board(v_key);
  update fh_backfill.boards set done = true, note = v_note where cache_key = v_key;
  return format('board %s of %s — %s',
                (select count(*) from fh_backfill.boards where done),
                (select count(*) from fh_backfill.boards), v_note);
end
$$;

-- ── Run: one board per statement ──
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();
select fh_backfill.next_board();

-- ── Result (the editor shows this one) ──
-- boards_left > 0: run the whole file again. boards_left = 0: run step 3 in the header.
select (select count(*) from fh_backfill.boards where done) as boards_done,
       (select count(*) from fh_backfill.boards where not done) as boards_left,
       (select count(*) from public.flight_history) as legs,
       (select min(service_date) from public.flight_history) as first_day,
       (select max(service_date) from public.flight_history) as last_day;
