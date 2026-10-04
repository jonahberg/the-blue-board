-- 017: airborne_samples — how many United flights were airborne, sampled every 5 minutes.
-- Backs the Live tab's 24-hour "Airborne" graph (GET /api/airborne-history), and is kept whole so a
-- weeks/months trend can be drawn from the same rows later.
--
-- WRITER: api/cron/watch-alerts.ts (*/5) reads the free public `airline=UAL` live feed once per run
-- and inserts ONE row per successful read (api/_airborne-samples.ts). A failed or meta-only read
-- (zero aircraft) writes NOTHING: a missing sample is a gap, never a zero. The counts come from
-- src/lib/airborne-count.js, the same `isOnGround()` definition the Live stat bar uses, over the
-- unfiltered parsed feed. sampled_at is floored to the minute; a second write for the same minute is
-- ignored (on conflict do nothing).
--
-- READER: api/airborne-history.ts (service role), a time-range scan on the primary key.
--
-- RETENTION: keep everything. ~288 rows/day ≈ 105k rows/year of six small columns (a few MB with
-- the index), so there is no cleanup job. Revisit only if a year of rows ever matters.
--
-- RLS on with NO policies and no anon/authenticated grants (default deny, like reg_sightings in
-- sql/013): only the service-role API reads or writes. Idempotent: safe to re-run.
create table if not exists public.airborne_samples (
  sampled_at timestamptz primary key,
  airborne   integer not null check (airborne >= 0),
  ground     integer check (ground >= 0),
  total      integer check (total >= 0),
  mainline   integer check (mainline >= 0),
  express    integer check (express >= 0)
);

alter table public.airborne_samples enable row level security;

-- Supabase's default privileges grant new public tables to anon/authenticated; RLS without a policy
-- already denies them every row, and this takes the grant away too (belt and braces).
revoke all on table public.airborne_samples from anon, authenticated;

comment on table public.airborne_samples is
  'United flights airborne, one row per successful 5-minute live-feed read (watch-alerts cron). Gaps are missing rows, never zeros. Kept indefinitely (~288 rows/day).';
comment on column public.airborne_samples.sampled_at is
  'Feed read time floored to the minute (UTC).';
comment on column public.airborne_samples.airborne is
  'Flights not on the ground (src/lib/airborne-count.js countAirborne, = the Live stat bar unfiltered).';
comment on column public.airborne_samples.mainline is
  'Airborne flights not under a United Express callsign (incl. the few with no callsign); mainline + express = airborne.';
comment on column public.airborne_samples.express is
  'Airborne flights under a United Express operator callsign (SKW/RPA/GJS/UCA/ASH/AWI/ASQ/LOF).';
