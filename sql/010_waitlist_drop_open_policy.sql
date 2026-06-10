-- Drop the legacy wide-open INSERT policy on public.waitlist.
--
-- Prod (verified live 2026-06-09) has BOTH an original "Allow anonymous inserts" policy with
-- WITH CHECK (true) for all roles — created early via the Supabase dashboard, never tracked in
-- this repo's sql/ — AND the validated anon_insert_only policy from sql/006_waitlist_checks.sql.
-- Postgres permissive policies are OR'ed together, so the open policy wins: any caller holding
-- the public anon key can insert rows that bypass 006's email-format / source-whitelist /
-- feature-request-length checks at the policy layer. (The CHECK constraints from 006 still
-- apply, but the policy was supposed to be the matching first line of defense.)
--
-- Dropping the open policy leaves anon_insert_only as the only INSERT path for anon, which is
-- the intent of 006. DROP POLICY IF EXISTS makes re-runs safe.
--
-- APPLY MANUALLY via the Supabase dashboard SQL editor (this repo keeps migrations in sql/, not
-- supabase/migrations/ — `supabase db push` would apply nothing while looking successful).
-- Verify after applying:
--   SELECT polname FROM pg_policy WHERE polrelid = 'public.waitlist'::regclass;
--   -- expect exactly one row: anon_insert_only

DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.waitlist;
