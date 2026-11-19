-- Backtest for v1.31.3: the brief's "usual" flights in the air, scaled by the day's schedule
-- (air.normal in src/lib/brief-facts.js, src/lib/brief-schedule.js).
-- READ-ONLY. Run it in the Supabase SQL editor (or MCP execute_sql), project fazlwtnjinmbzzjcgzrt.
--
-- The rule, as shipped:
--   usual    = median airborne at the same US Central wall-clock time on the previous 7 days (as before)
--   ratio    = hub departures scheduled in [now - 4 h, now) / the median of the same count at the same
--              wall-clock time on the previous 7 days (flight_history, on_dep_board, canceled included)
--   factor   = min(1, ratio + 0.10)     only the part of a lighter schedule beyond 10% counts
--   expected = round(usual x factor); the shortfall that sets the tone is measured against it
--              (watch at 35% fewer, disrupted at 45%, none when expected < 100), exactly as before.
--   The schedule is read only when the raw shortfall is 25% or more. factor is 1 (unscaled) when the
--   usual scheduled count is under 150, fewer than 3 earlier days have rows, or today is under 40%
--   of the usual. (The five light-schedule dates' calm fallback is not exercised: none is in the data.)
--
-- Every 5-minute airborne_samples row from Sat Nov 7 to Wed Nov 18 2026, 3:35 PM PT. The slot list is
-- materialised first; joining airborne_samples without that times out. flight_history starts Nov 6
-- with 3 hubs, so Nov 7 and 8 have no schedule baseline (factor 1) and Nov 9 to 12 have a partial
-- one (Nov 6 and 7 in their median), which biases their ratio up.
--
-- Output, Nov 18 2026 (slots = 5-minute samples; reads = samples at 25% or more fewer):
--   group                             slots reads scaled min_factor raw W/D  rule W/D  raw max  rule max  first W / D (PT)
--   a Nov14 05-07 PT (Sat after stop)    25    25      0      1.000  25/25    25/25       51        51  05:00 / 05:00
--   b Nov13 12-14 PT (the stop)          24    11      0      1.000   9/7      9/7        63        63  13:15 / 13:25
--   c Nov10 Tue                         287     1      0      1.000   0/0      0/0        25        25  -
--   d Nov17 Tue                         288    16     16      0.867   0/0      0/0        31        28  -
--   e Nov15,16,18 ordinary              767     0      0      1.000   0/0      0/0        21        21  -
--   f Nov9-12 ordinary (Nov10 in c)     862     0      0      1.000   0/0      0/0        20        20  -
--   g Nov13-14 rest (stop, recovery)    525   188      0      1.000 128/85   128/85       91        91
--   h Nov7-8 (no schedule baseline)     575     0      0      1.000   0/0      0/0        22        22  -
-- (W/D = samples at watch or worse / at disrupted.) The ratio on the days with a full baseline
-- (Nov 15 to 18, usual >= 150): median 1.004, 5th percentile 0.891, 95th 1.044, minimum 0.654.
with
slots as materialized (
  select sampled_at as t, airborne as air, floor(extract(epoch from sampled_at) / 60)::bigint as tm
  from airborne_samples
  where sampled_at >= timestamptz '2026-11-07 08:00Z' and sampled_at < timestamptz '2026-11-19 00:00Z'
),
prior as materialized (
  select s.t, d.i,
         ((s.t at time zone 'America/Chicago') - make_interval(days => d.i)) at time zone 'America/Chicago' as pt
  from slots s cross join generate_series(1, 7) as d(i)
),
prior_air as materialized (
  select p.t, p.i, p.pt,
    (select a.airborne from airborne_samples a
      where a.sampled_at between p.pt - interval '10 minutes' and p.pt + interval '10 minutes'
      order by abs(extract(epoch from a.sampled_at - p.pt)), a.sampled_at limit 1) as air
  from prior p
),
-- Every hub departure row, canceled ones included (a halt does not remove scheduled rows).
deps as materialized (
  select sched_dep as m, count(*)::int as n from flight_history
  where on_dep_board and service_date between date '2026-10-28' and date '2026-11-20' and sched_dep is not null
  group by 1
),
cum as materialized (
  select g.m, sum(coalesce(d.n, 0)) over (order by g.m) as c
  from generate_series(floor(extract(epoch from timestamptz '2026-10-29 00:00Z') / 60)::bigint,
                       floor(extract(epoch from timestamptz '2026-11-19 00:00Z') / 60)::bigint) as g(m)
  left join deps d on d.m = g.m
),
-- Departures scheduled in [t - 240 min, t).
today as materialized (
  select s.t, (c1.c - c0.c)::int as n
  from slots s join cum c1 on c1.m = s.tm - 1 join cum c0 on c0.m = s.tm - 240 - 1
),
priors as materialized (
  select p.t, p.i, (c1.c - c0.c)::int as n
  from prior p
  join cum c1 on c1.m = floor(extract(epoch from p.pt) / 60)::bigint - 1
  join cum c0 on c0.m = floor(extract(epoch from p.pt) / 60)::bigint - 240 - 1
),
ua as (
  select t, count(air)::int as days, array_agg(air order by air) filter (where air is not null) as a
  from prior_air group by t
),
usual_air as (
  select t, case when days < 3 then null when days % 2 = 1 then a[(days + 1) / 2]
         else floor((a[days / 2] + a[days / 2 + 1]) / 2.0 + 0.5)::int end as med
  from ua
),
-- An earlier day with no rows is no data, not zero flights.
us as (select t, count(*)::int as days, array_agg(n order by n) as a from priors where n > 0 group by t),
usual_sched as (
  select t, days, case when days < 3 then null when days % 2 = 1 then a[(days + 1) / 2]
         else floor((a[days / 2] + a[days / 2 + 1]) / 2.0 + 0.5)::int end as med
  from us
),
r as (
  select s.t, (s.t at time zone 'America/Los_Angeles') as pt, s.air, ua.med as usual_air,
    floor((s.air - ua.med) * 100.0 / ua.med + 0.5)::int as raw_pct,
    case when usd.med >= 150 and td.n >= 0.4 * usd.med then td.n::numeric / usd.med end as ratio
  from slots s join usual_air ua on ua.t = s.t join today td on td.t = s.t left join usual_sched usd on usd.t = s.t
  where ua.med is not null
),
r2 as (select *, case when raw_pct <= -25 and ratio is not null then least(1, ratio + 0.10) else 1 end as k from r),
r3 as (select *, round(usual_air * k)::int as expected from r2),
r4 as (select *, floor((air - expected) * 100.0 / expected + 0.5)::int as sp from r3),
lab as (
  select *, case
    when pt >= timestamp '2026-11-14 05:00' and pt <= timestamp '2026-11-14 07:00' then 'a Nov14 05-07 PT'
    when pt >= timestamp '2026-11-13 12:00' and pt < timestamp '2026-11-13 14:00' then 'b Nov13 12-14 PT'
    when pt >= timestamp '2026-11-10 00:00' and pt < timestamp '2026-11-11 00:00' then 'c Nov10 Tue'
    when pt >= timestamp '2026-11-17 00:00' and pt < timestamp '2026-11-18 00:00' then 'd Nov17 Tue'
    when pt >= timestamp '2026-11-15 00:00' then 'e Nov15-18 ordinary'
    when pt >= timestamp '2026-11-13 00:00' and pt < timestamp '2026-11-15 00:00' then 'g Nov13-14 rest'
    when pt >= timestamp '2026-11-09 00:00' then 'f Nov9-12 ordinary'
    else 'h Nov7-8 (no schedule baseline)' end as grp
  from r4
)
select grp, count(*) as slots,
  count(*) filter (where raw_pct <= -25) as reads,
  count(*) filter (where k < 1) as scaled,
  round(min(k), 3) as min_factor,
  count(*) filter (where raw_pct <= -35 and usual_air >= 100) as raw_watch_or_worse,
  count(*) filter (where raw_pct <= -45 and usual_air >= 100) as raw_disrupted,
  count(*) filter (where sp <= -35 and expected >= 100) as rule_watch_or_worse,
  count(*) filter (where sp <= -45 and expected >= 100) as rule_disrupted,
  -min(raw_pct) filter (where usual_air >= 100) as raw_max_short,
  -min(sp) filter (where expected >= 100) as rule_max_short,
  min(to_char(pt, 'HH24:MI')) filter (where sp <= -35 and expected >= 100) as first_watch,
  min(to_char(pt, 'HH24:MI')) filter (where sp <= -45 and expected >= 100) as first_disrupted
from lab group by grp order by grp;
