-- Pro v1: subscriptions, user_flights, risk_state, push_subscriptions, stripe_events
--
-- Naming convention follows sql/00N_name.sql pattern (RLS in 009_pro_rls.sql).
-- Schema source-of-truth lives here; Supabase Auth manages the users table itself
-- (auth.users, accessed via auth.uid() in RLS policies).

-- ── subscriptions: source of truth for who's a paying customer ──────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'active', 'past_due', 'canceled', 'unpaid', 'trialing',
    'incomplete', 'incomplete_expired', 'paused'
  )),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  current_period_end TIMESTAMPTZ NOT NULL,
  price_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- one subscription per user (v1 has no upgrade/downgrade between plans)
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);

-- ── stripe_events: idempotency + audit trail for webhook retries ────────────
-- PRIMARY KEY on event.id makes ON CONFLICT DO NOTHING the idempotency check.
-- Stripe retries up to 3x over 72h; without this, retries duplicate state.
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at ON stripe_events(processed_at DESC);

-- ── user_flights: up to 10 flights per Pro user, prompt-injection-safe regex ─
-- v1 is United-mainline-only ('UA' + digits) because /api/flight-times doesn't
-- yet support United Express carrier codes. flight_date is intentionally NOT
-- stored: /api/flight-times resolves the most recent occurrence of the flight
-- number with no date parameter, so storing a date would be misleading.
-- v1.1 adds dated lookup + express-carrier support.
CREATE TABLE IF NOT EXISTS user_flights (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flight_number TEXT NOT NULL CHECK (flight_number ~ '^UA[0-9]{1,4}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, flight_number)
);

CREATE INDEX IF NOT EXISTS idx_user_flights_user_id ON user_flights(user_id);

-- Enforce the same 10-flight cap at the database layer. The API checks this
-- too, but direct Supabase access with the user's JWT must not bypass it.
CREATE OR REPLACE FUNCTION enforce_user_flights_limit()
RETURNS TRIGGER AS $$
DECLARE
  MAX_FLIGHTS_PER_USER CONSTANT INTEGER := 10;
  existing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO existing_count
  FROM user_flights
  WHERE user_id = NEW.user_id;

  IF existing_count >= MAX_FLIGHTS_PER_USER THEN
    RAISE EXCEPTION 'user_flights limit exceeded: max % flights per user', MAX_FLIGHTS_PER_USER
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_user_flights_limit ON user_flights;
CREATE TRIGGER enforce_user_flights_limit
  BEFORE INSERT ON user_flights
  FOR EACH ROW
  EXECUTE FUNCTION enforce_user_flights_limit();

-- ── risk_state: per-flight delta tracking + error visibility ────────────────
-- The risk_monitor cron writes here. Delta-based gating compares signals_hash
-- before calling Anthropic. error column surfaces "alerts paused" UX.
CREATE TABLE IF NOT EXISTS risk_state (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flight_number TEXT NOT NULL,
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high')),
  signals_hash TEXT,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_alerted TIMESTAMPTZ,
  error TEXT,
  PRIMARY KEY (user_id, flight_number)
);

-- ── push_subscriptions: web push registrations + email-fallback metadata ────
-- delivery='push' for installed-PWA users; delivery='email' for iOS users
-- who skipped install (per D3 walkthrough fallback).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL,
  delivery TEXT NOT NULL DEFAULT 'push' CHECK (delivery IN ('push', 'email')),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
