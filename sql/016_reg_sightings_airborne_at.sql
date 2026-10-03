-- 016: reg_sightings.airborne_at — the latest sighting with the aircraft AIRBORNE (v1.12.0).
-- seen_at keeps its meaning (latest sighting of any kind, ground included: the tail ledger wants a
-- tail as soon as the aircraft is at the gate). The seen-airborne override (src/lib/reg-overlay.js)
-- accepts only airborne_at as proof a "Likely Canceled" flight flew, so a flight held on a taxiway
-- with its transponder on and then cancelled is never shown as flown. Writers set it only on
-- airborne rows, in an upsert that excludes the column for ground rows (api/_reg-sightings.ts), so a
-- taxi-in after landing never erases it. Nullable, no default, no backfill: an existing row's
-- airborne time cannot be known, so the override starts with flights seen airborne after deploy.
-- NOTE: this DDL was applied to prod live on 2026-10-03 (migration "reg_sightings_airborne_at");
-- this file tracks it for repo parity.
alter table public.reg_sightings add column if not exists airborne_at timestamptz;
comment on column public.reg_sightings.airborne_at is
  'Latest sighting with the aircraft airborne (not on the ground). Proof a flight operated; seen_at includes ground sightings.';
