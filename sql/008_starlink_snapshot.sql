-- Durable Starlink snapshot shared across serverless instances.
--
-- api/cron/sync-starlink.ts writes the enriched unitedstarlinktracker.com payload here every 4h;
-- api/starlink-data.ts reads it so every cold serving instance returns the same fresh data without
-- re-fetching 727KB from upstream. Replaces the old globalThis.__starlinkCache handoff, which never
-- survived across lambdas (see api/_starlink-snapshot.ts). Same pattern as schedule_cost_state (007).
--
-- Single logical row (key = 'current'). Written only by the service-role key (server-side); the
-- anon client has no access.

CREATE TABLE IF NOT EXISTS starlink_snapshot (
  key          TEXT PRIMARY KEY,
  payload      JSONB NOT NULL,
  total        INTEGER,
  refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Snapshot is server-internal. Enable RLS with no policies so only the service-role key (which
-- bypasses RLS) can read/write; the anon key is denied entirely.
ALTER TABLE starlink_snapshot ENABLE ROW LEVEL SECURITY;
