-- Cross-instance daily spend counter for the metered AeroDataBox provider.
--
-- The per-IP rate limiter is in-memory per lambda instance, so it cannot bound global provider
-- spend under Vercel fan-out. api/_cost-state.ts mirrors this counter and hard-stops provider
-- calls once the day's units cross AERODATABOX_DAILY_UNIT_BUDGET (default 400). The code degrades
-- gracefully to per-instance in-memory accounting if this migration is not applied — but the
-- cross-instance ceiling only exists once it is. Apply via the Supabase SQL editor or
-- `supabase db push`.
--
-- Written only by the service-role key (server-side); the anon client has no access.

CREATE TABLE schedule_provider_spend (
  day DATE PRIMARY KEY,
  units INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Server-internal. Enable RLS with no policies so only the service-role key (which bypasses RLS)
-- can read/write; the anon key is denied entirely.
ALTER TABLE schedule_provider_spend ENABLE ROW LEVEL SECURITY;

-- Atomic increment: read-modify-write from N concurrent lambdas would undercount; the upsert
-- keeps the counter accurate and returns the new global total so callers can adopt it.
CREATE OR REPLACE FUNCTION increment_adb_units(p_day DATE, p_units INTEGER)
RETURNS INTEGER
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO schedule_provider_spend (day, units, updated_at)
  VALUES (p_day, p_units, NOW())
  ON CONFLICT (day) DO UPDATE
    SET units = schedule_provider_spend.units + EXCLUDED.units,
        updated_at = NOW()
  RETURNING units;
$$;

-- Only the server may call the increment; deny the public/anon roles.
REVOKE EXECUTE ON FUNCTION increment_adb_units(DATE, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_adb_units(DATE, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION increment_adb_units(DATE, INTEGER) TO service_role;
