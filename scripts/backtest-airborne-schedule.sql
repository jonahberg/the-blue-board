-- Backtest for the brief's "usual" flights in the air, scaled by the day's schedule
-- (air.normal in src/lib/brief-facts.js, src/lib/brief-schedule.js): v1.31.3, tapered in v1.34.1.
-- READ-ONLY. Run it in the Supabase SQL editor (or MCP execute_sql), project fazlwtnjinmbzzjcgzrt.
--
-- The rule, as shipped (v1.34.1):
--   usual    = median airborne at the same US Central wall-clock time on the previous 7 days (as before)
--   ratio    = hub departures scheduled in [now - 4 h, now) / the median of the same count at the same
--              wall-clock time on the previous 7 days (flight_history, on_dep_board, canceled included)
--   t        = (ratio - 0.70) / (0.90 - 0.70), held between 0 and 1
--   factor   = min(1, ratio + 0.10 x t), to three places: the whole 10-point band from a ratio of
--              0.90 (as v1.31.3), none at 0.70 and below, a straight line between
--   expected = round(usual x factor); the shortfall that sets the tone is measured against it
--              (watch at 35% fewer, disrupted at 45%, none when expected < 100), exactly as before.
--   The schedule is read only when the raw shortfall is 25% or more. factor is 1 (unscaled) when the
--   usual scheduled count is under 150, fewer than 3 earlier days have rows, or today is under 40%
--   of the usual. On Thanksgiving Day (Central date) and the morning after until 6 AM Central, an
--   unusable ratio caps the tone at calm (the holiday fallback, lightScheduleDayOrMorningAfter); the
--   "cur" and "taper" columns both apply it. A failed read cannot be replayed here.
--   "cur" is the v1.31.3 rule, factor = min(1, ratio + 0.10), for comparison.
--
-- Every 5-minute airborne_samples row from Fri Nov 13 to Fri Nov 27 2026, 7:25 PM PT (the end is
-- fixed so the counts reproduce). The slot list is materialised first; joining airborne_samples
-- without that times out.
--
-- Output, Nov 27 2026 (slots = 5-minute samples; capped = samples the holiday fallback set calm;
-- min ratio = the lowest ratio among samples read with a usable schedule (usual in the air 100 or
-- more); W/D = samples at watch or
-- worse / at disrupted; max = the largest shortfall against the expected count, in percent; capped
-- samples are left out of W/D and max):
--   group                               slots capped min ratio  cur W/D  taper W/D  cur max  taper max
--   a Nov14 05-07 PT (after the stop)      25      0     0.914   25/25     25/25        51         51
--   b Nov13 12-14 PT (the stop)            24      0     1.036    9/7       9/7         63         63   first W 13:15, first D 13:25 (unchanged)
--   c Nov13-14 rest                       525      0     0.918  128/85    128/85        91         91
--   d Nov17 Tue (light night)             288      0     0.767    0/0       0/0         28         28
--   e Nov15-25 ordinary (excl 17)        2880      0     0.814    0/0       0/0         24         24
--   f Nov26 schedule usable and read       60      0     0.409   11/0       0/0         39         27
--   g Nov26 not read or not usable        228     73         -    0/0       0/0         23         23
--   h Nov27 Fri                           234      2         -    0/0       0/0         24         24
-- On Nov 27 no sample was read with a usable schedule, so both rules read it the same: the only two
-- 25% short (00:20 and 03:35 PT) had a usual four-hour count under 150 and fell in the morning after,
-- so they are capped. Counted over every slot, capped ones included, the largest raw shortfall is
-- 25; over the 170 slots with a usable schedule, 21 (the "25 / 21" of the first count of this run).
-- In the Nov 13 and 14 groups no sample 25% or more short had a ratio under 0.90 (min ratio), so
-- these rows show that the taper leaves them alone; they do NOT show that the taper still catches
-- a halt on a light day. That is a synthetic test (tests/brief-facts.test.js, "the taper does not
-- blunt a halt on a light day").
--
-- History, v1.31.3 (Nov 18 2026, the flat band, Nov 7 to Nov 18 3:35 PM PT; reads = samples at 25%
-- or more fewer; raw = against the usual, rule = against the expected count):
--   group                             slots reads scaled min_factor raw W/D  rule W/D  raw max  rule max  first W / D (PT)
--   a Nov14 05-07 PT (Sat after stop)    25    25      0      1.000  25/25    25/25       51        51  05:00 / 05:00
--   b Nov13 12-14 PT (the stop)          24    11      0      1.000   9/7      9/7        63        63  13:15 / 13:25
--   c Nov10 Tue                         287     1      0      1.000   0/0      0/0        25        25  -
--   d Nov17 Tue                         288    16     16      0.867   0/0      0/0        31        28  -
--   e Nov15,16,18 ordinary              767     0      0      1.000   0/0      0/0        21        21  -
--   f Nov9-12 ordinary (Nov10 in c)     862     0      0      1.000   0/0      0/0        20        20  -
--   g Nov13-14 rest (stop, recovery)    525   188      0      1.000 128/85   128/85       91        91
--   h Nov7-8 (no schedule baseline)     575     0      0      1.000   0/0      0/0        22        22  -
-- (The ratio on the days with a full baseline, Nov 15 to 18, usual >= 150: median 1.004, 5th
-- percentile 0.891, 95th 1.044, minimum 0.654.)
with
slots as materialized (
  select sampled_at as t, airborne as air, floor(extract(epoch from sampled_at) / 60)::bigint as tm
  from airborne_samples
  where sampled_at >= timestamptz '2026-11-13 08:00Z' and sampled_at < timestamptz '2026-11-28 03:30Z'
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
  where on_dep_board and service_date between date '2026-11-04' and date '2026-11-29' and sched_dep is not null
  group by 1
),
cum as materialized (
  select g.m, sum(coalesce(d.n, 0)) over (order by g.m) as c
  from generate_series(floor(extract(epoch from timestamptz '2026-11-05 00:00Z') / 60)::bigint,
                       floor(extract(epoch from timestamptz '2026-11-28 08:00Z') / 60)::bigint) as g(m)
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
  select s.t, (s.t at time zone 'America/Los_Angeles') as pt, (s.t at time zone 'America/Chicago') as ct,
    s.air, ua.med as usual_air,
    floor((s.air - ua.med) * 100.0 / ua.med + 0.5)::int as raw_pct,
    case when usd.med >= 150 and td.n >= 0.4 * usd.med then td.n::numeric / usd.med end as ratio
  from slots s join usual_air ua on ua.t = s.t join today td on td.t = s.t left join usual_sched usd on usd.t = s.t
  where ua.med is not null
),
r2 as (
  select *,
    raw_pct <= -25 and ratio is not null as scaled_read,
    -- The holiday fallback: Thanksgiving Day by Central date, or the morning after until 6 AM Central.
    raw_pct <= -25 and ratio is null
      and (ct::date = date '2026-11-26' or (ct::date = date '2026-11-27' and ct::time < time '06:00')) as capped,
    case when raw_pct <= -25 and ratio is not null then round(least(1, ratio + 0.10), 3) else 1 end as k_cur,
    case when raw_pct <= -25 and ratio is not null
         then round(least(1, ratio + 0.10 * least(1, greatest(0, (ratio - 0.70) / 0.20))), 3) else 1 end as k
  from r
),
r3 as (select *, round(usual_air * k_cur)::int as exp_cur, round(usual_air * k)::int as expected from r2),
r4 as (
  select *,
    floor((air - exp_cur) * 100.0 / exp_cur + 0.5)::int as sp_cur,
    floor((air - expected) * 100.0 / expected + 0.5)::int as sp
  from r3
),
lab as (
  select *, case
    when pt >= timestamp '2026-11-14 05:00' and pt <= timestamp '2026-11-14 07:00' then 'a Nov14 05-07 PT (after the stop)'
    when pt >= timestamp '2026-11-13 12:00' and pt < timestamp '2026-11-13 14:00' then 'b Nov13 12-14 PT (the stop)'
    when pt < timestamp '2026-11-15 00:00' then 'c Nov13-14 rest'
    when pt >= timestamp '2026-11-17 00:00' and pt < timestamp '2026-11-18 00:00' then 'd Nov17 Tue (light night)'
    when pt < timestamp '2026-11-26 00:00' then 'e Nov15-25 ordinary (excl 17)'
    when pt < timestamp '2026-11-27 00:00' and scaled_read then 'f Nov26 schedule usable and read'
    when pt < timestamp '2026-11-27 00:00' then 'g Nov26 not read or not usable'
    else 'h Nov27 Fri' end as grp
  from r4
)
select grp, count(*) as slots,
  round(min(ratio) filter (where usual_air >= 100 and scaled_read), 3) as min_read_ratio,
  count(*) filter (where capped) as capped,
  count(*) filter (where not capped and sp_cur <= -35 and exp_cur >= 100) as cur_watch_or_worse,
  count(*) filter (where not capped and sp_cur <= -45 and exp_cur >= 100) as cur_disrupted,
  count(*) filter (where not capped and sp <= -35 and expected >= 100) as taper_watch_or_worse,
  count(*) filter (where not capped and sp <= -45 and expected >= 100) as taper_disrupted,
  -min(sp_cur) filter (where not capped and exp_cur >= 100) as cur_max_short,
  -min(sp) filter (where not capped and expected >= 100) as taper_max_short,
  -min(sp) filter (where scaled_read and expected >= 100) as taper_max_short_when_read,
  min(to_char(pt, 'HH24:MI')) filter (where not capped and sp <= -35 and expected >= 100) as first_watch,
  min(to_char(pt, 'HH24:MI')) filter (where not capped and sp <= -45 and expected >= 100) as first_disrupted
from lab group by grp order by grp;
