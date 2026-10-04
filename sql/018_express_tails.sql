-- 018: express_tails — the United Express fleet, discovered from United's own flying.
-- Backs GET /api/express-fleet and the dashboard's United Express aircraft details
-- (flight panel, aircraft dialog, board Wi-Fi/seat cell, the Fleet tab's Express section).
--
-- WHY DISCOVERED, NOT IMPORTED: SkyWest and Republic also fly for American and Delta, so a
-- registry or operator fleet list cannot say which tails fly for United. A tail is in this table
-- only because it was SEEN operating a United-numbered flight (UA…, or G7… for GoJet) under a
-- United Express operator's callsign (SKW/RPA/GJS/UCA/ASH/AWI) on a regional type.
--
-- WRITER: api/cron/watch-alerts.ts → api/_express-tails.ts, from the complete United live feed it
-- already reads every 5 minutes (src/lib/united-feed.js), gated to two wall-clock slots per hour.
-- Upserts omit first_seen, so the insert default survives every later update.
-- BACKFILL (Oct 4 2026): the hub boards in schedule_snapshots, same filters, mainline tails
-- (public/data/fleet.json) excluded.
-- READER: api/express-fleet.ts (service role) — rows with last_seen in the last 45 days; a tail
-- that stops flying United drops out on its own (same idea as the mainline retirements).
--
-- RLS on, NO policies, no anon/authenticated grants (sql/017 posture): only the service-role API
-- reads or writes. Idempotent: safe to re-run.
create table if not exists public.express_tails (
  reg         text primary key check (reg ~ '^N[0-9A-Z]{1,5}$'),
  operator    text not null check (operator in ('SKW', 'RPA', 'GJS', 'UCA', 'ASH', 'AWI')),
  fr24_type   text,
  model       text,
  last_flight text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index if not exists express_tails_last_seen_idx on public.express_tails (last_seen desc);

alter table public.express_tails enable row level security;
revoke all on table public.express_tails from anon, authenticated;

comment on table public.express_tails is
  'United Express tails seen flying United-numbered flights under an Express operator callsign. Written by watch-alerts (live feed); read by /api/express-fleet (last_seen within 45 days).';
comment on column public.express_tails.operator is 'ICAO callsign prefix of the operator last seen flying it (src/lib/express-operators.js).';
comment on column public.express_tails.fr24_type is 'Live feed ICAO type designator (E75L, CRJ2, E145, CRJ7, …).';
comment on column public.express_tails.model is 'Schedule-board model code when known (E175, CRJ2, …); backfill and board sightings.';
