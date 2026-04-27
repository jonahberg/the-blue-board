-- Pro v1 RLS policies — defense-in-depth for paid-tier data.
--
-- Pattern matches sql/002_waitlist_rls.sql. All Pro tables use auth.uid() for
-- user scoping. Service role bypasses RLS entirely (used by webhook handler
-- and cron). Client-side reads (when supabase-js with the user's session token
-- talks directly to the DB) are scoped by these policies.
--
-- Why: the waitlist table previously had no SELECT policy for anon, which
-- masked bug #1 (welcome-email duplication). Pro tables are paid data —
-- worse to leak. Database-enforced scoping is the backstop for app-layer bugs.

-- subscriptions: user reads own; writes only via service role (webhook)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_own" ON subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy — only service role can write.

-- stripe_events: no client access at all (webhook-only audit log)
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
-- No policies = no anon/authenticated access = service-role-only.

-- user_flights: full CRUD for own
ALTER TABLE user_flights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_flights_select_own" ON user_flights
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_flights_insert_own" ON user_flights
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_flights_update_own" ON user_flights
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_flights_delete_own" ON user_flights
  FOR DELETE
  USING (auth.uid() = user_id);

-- risk_state: read-only for user; writes only via service role (cron)
ALTER TABLE risk_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "risk_state_select_own" ON risk_state
  FOR SELECT
  USING (auth.uid() = user_id);

-- push_subscriptions: full CRUD for own
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subscriptions_select_own" ON push_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_insert_own" ON push_subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_update_own" ON push_subscriptions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_delete_own" ON push_subscriptions
  FOR DELETE
  USING (auth.uid() = user_id);
