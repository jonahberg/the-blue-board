-- Phase 2 (spec: docs/superpowers/specs/2026-07-04-schedule-phase2-design.md):
-- server-side flight→tail sightings harvested from the free FR24 live feed.
-- One row per normalized mainline flight number; latest sighting wins (upsert).
-- Rolling window: readers ignore rows older than 36h, so the table stays ~≤1,500 rows.
-- RLS default-deny (no policies): only the service-role API reads/writes this table.
create table if not exists reg_sightings (
  flight_key text primary key,
  reg        text not null,
  origin     text,
  dest       text,
  seen_at    timestamptz not null default now()
);
create index if not exists reg_sightings_seen_at_idx on reg_sightings (seen_at);
alter table reg_sightings enable row level security;
