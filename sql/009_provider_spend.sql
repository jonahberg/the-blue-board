-- Cross-instance daily spend counter for the metered AeroDataBox provider.
--
-- The per-IP rate limiter is in-memory per lambda instance, so it cannot bound global provider
-- spend under Vercel fan-out. api/_cost-state.ts mirrors this counter and hard-stops provider
-- calls once the day's units cross AERODATABOX_DAILY_UNIT_BUDGET (default 400). The code degrades
-- gracefully to per-instance in-memory accounting if this migration is not applied — but the
-- cross-instance ceiling only exists once it is.
--
-- APPLY MANUALLY via the Supabase dashboard SQL editor (this repo keeps migrations in sql/, not
-- supabase/migrations/ — `supabase db push` would apply nothing while looking successful).
-- Verify after applying:  SELECT increment_adb_units(CURRENT_DATE, 0);
--
-- Written only by the service-role key (server-side); client keys have no access.

CREATE TABLE IF NOT EXISTS schedule_provider_spend (
  day DATE PRIMARY KEY,
  units INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Server-internal. Lock at BOTH layers: RLS with no policies (service-role bypasses), and
-- explicit privilege revokes so a future debugging session that adds a permissive policy or
-- disables RLS does not silently hand client keys write access to the spend counter.
ALTER TABLE schedule_provider_spend ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE schedule_provider_spend FROM PUBLIC;
REVOKE ALL ON TABLE schedule_provider_spend FROM anon;
REVOKE ALL ON TABLE schedule_provider_spend FROM authenticated;

-- Atomic increment: read-modify-write from N concurrent lambdas would undercount; the upsert
-- keeps the counter accurate and returns the new global total so callers can adopt it.
-- GREATEST(p_units, 0): this is SECURITY DEFINER, so it enforces its own invariants instead of
-- trusting callers — a negative p_units would silently reopen the spend budget.
CREATE OR REPLACE FUNCTION increment_adb_units(p_day DATE, p_units INTEGER)
RETURNS INTEGER
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO schedule_provider_spend (day, units, updated_at)
  VALUES (p_day, GREATEST(p_units, 0), NOW())
  ON CONFLICT (day) DO UPDATE
    SET units = schedule_provider_spend.units + GREATEST(EXCLUDED.units, 0),
        updated_at = NOW()
  RETURNING units;
$$;

-- Only the server may call the increment. Supabase default privileges GRANT EXECUTE on new
-- public-schema functions to anon AND authenticated — revoking only PUBLIC/anon would leave any
-- self-minted authenticated JWT able to brick (huge p_units) or uncap (negative p_units, pre-
-- GREATEST) the budget via POST /rest/v1/rpc/increment_adb_units.
REVOKE EXECUTE ON FUNCTION increment_adb_units(DATE, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_adb_units(DATE, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION increment_adb_units(DATE, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_adb_units(DATE, INTEGER) TO service_role;
