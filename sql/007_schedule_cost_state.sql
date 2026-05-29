-- Global cost-guard state shared across serverless instances.
--
-- Today it holds the FR24 official-API quota block ("402 — credit limit reached") so that once ANY
-- lambda hits the credit ceiling, ALL lambdas stop calling the paid official API until the block
-- expires. Without a shared store, every cold instance independently re-discovers the 402, so real
-- spend scales with instance fan-out (N × the intended per-instance cap). See api/_cost-state.ts.
--
-- Written only by the service-role key (server-side); the anon client has no access.

CREATE TABLE schedule_cost_state (
  key TEXT PRIMARY KEY,
  blocked_until TIMESTAMPTZ,
  reason TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost state is server-internal. Enable RLS with no policies so only the service-role key (which
-- bypasses RLS) can read/write; the anon key is denied entirely.
ALTER TABLE schedule_cost_state ENABLE ROW LEVEL SECURITY;
