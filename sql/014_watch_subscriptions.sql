-- Web Push subscriptions for server-side flight watch alerts (Tier 1 killer feature).
--
-- Background flight alerts today die the moment the tab closes: the watch engine in
-- main.js only runs while the dashboard is open (verified findings F031/F049). This table
-- is the server-side store that lets api/cron/watch-alerts.ts diff watched flights every
-- 5 minutes and deliver a real Web Push even when no tab is open.
--
-- One row per browser push endpoint. `watches` is the list of flights that endpoint is
-- tracking, plus the last-known state the diff engine compares against so it only notifies
-- on a MEANINGFUL change (see api/_watch-diff.ts):
--   [{ flight, date?, addedAt, lastStatus?, lastGate?, lastEquip? }, ...]
--
-- PRIVACY: this table stores ONLY the push transport (endpoint + the two client keys the
-- push service requires for payload encryption) and the watched flight numbers. NO email,
-- NO account id, NO user identifier beyond the opaque push endpoint itself. The endpoint is
-- the identity; unsubscribing (or 3 consecutive push failures) deletes the row entirely.
--
-- RLS: default-deny with a single service_role full-access policy. The public anon/authenticated
-- roles get NO policies and NO grants — only the service-role API (api/push-subscribe.ts writes,
-- api/cron/watch-alerts.ts reads/writes) may touch this table. This mirrors the stricter
-- default-deny pattern in sql/013_reg_sightings.sql, and deliberately does NOT expose the
-- world-readable SELECT that sql/011/012's cep board carries — push endpoints are not public.
--
-- APPLY MANUALLY via the Supabase SQL editor / MCP (this repo keeps migrations in sql/, not
-- supabase/migrations/ — `supabase db push` would apply nothing while looking successful).
--
-- Idempotent + safe to re-run: create table / index / policy are all guarded with IF NOT EXISTS
-- (the policy via a catalog check), and ENABLE ROW LEVEL SECURITY is a no-op when already on.

create table if not exists watch_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  endpoint     text unique not null,
  p256dh       text not null,
  auth         text not null,
  watches      jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failed_count int not null default 0
);

-- The cron pages subscriptions ordered by last_seen_at; index keeps that scan cheap.
create index if not exists watch_subscriptions_last_seen_idx on watch_subscriptions (last_seen_at);

alter table watch_subscriptions enable row level security;

-- Single service_role policy: full access for the server-side API. No anon/authenticated
-- policies exist, so with RLS enabled every non-service role is default-denied.
do $$
begin
  if not exists (
    select 1 from pg_policy
     where polrelid = 'public.watch_subscriptions'::regclass and polname = 'watch_subscriptions_service_all'
  ) then
    create policy watch_subscriptions_service_all on watch_subscriptions
      for all to service_role
      using (true) with check (true);
  end if;
end $$;

-- Verify after applying:
--   SELECT polname, polcmd, polroles::regrole[] FROM pg_policy WHERE polrelid = 'public.watch_subscriptions'::regclass;
--   -- expect exactly one policy for {service_role}; NO anon / authenticated / public rows.
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'watch_subscriptions' AND grantee IN ('anon','authenticated');
--   -- expect no rows.
