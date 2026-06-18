-- Close the permissive RLS UPDATE hole on public.cep_review_comments.
--
-- This table backs the CEP review-comments board (~94 comments live in prod). It was created
-- ad-hoc directly in the database and was never tracked in this repo's sql/ set, so THIS FILE is
-- the canonical record of its access policy going forward.
--
-- The hole (verified live 2026-06-17): the table has a permissive UPDATE policy
--   cep_anon_resolve  FOR UPDATE TO public  USING (true) WITH CHECK (true)
-- and the anon role also holds the UPDATE grant. Postgres evaluates USING(true)/WITH CHECK(true)
-- as "any row, any new value," so ANY holder of the public anon key can overwrite ALL review
-- comments. This is the same WITH CHECK(true) anti-pattern that was remediated on the waitlist
-- table in sql/010_waitlist_drop_open_policy.sql.
--
-- Fix: drop the open UPDATE policy AND revoke the UPDATE table grant from every public-facing
-- role. Comment "resolution" moves server-side via the service_role key (which bypasses RLS), so
-- we add NO replacement anon UPDATE policy — anonymous clients must no longer mutate comments.
--
-- What we deliberately KEEP:
--   * The constrained INSERT policy (with its length caps) — untouched, still the only anon write path.
--   * RLS stays ENABLED.
--   * The public SELECT policy cep_anon_read (USING true) — public read is INTENTIONAL; this board
--     is meant to be world-readable. We do NOT remove it and do NOT expose anything new.
--   * No DELETE policy exists, so deletes remain blocked for anon — we add none.
--
-- Idempotent + safe to re-run: DROP POLICY IF EXISTS suppresses the missing-policy case, REVOKE is
-- a no-op (notice only) when the grant is already absent, and ENABLE ROW LEVEL SECURITY is a no-op
-- when already enabled. The whole block is guarded by to_regclass so a fresh sql/ bootstrap that
-- has not created this ad-hoc table simply skips instead of erroring.
--
-- APPLY MANUALLY via the Supabase SQL editor / MCP (this repo keeps migrations in sql/, not
-- supabase/migrations/ — `supabase db push` would apply nothing while looking successful). The
-- exact statements to run against prod are reproduced verbatim at the END of this file.

DO $$
BEGIN
  IF to_regclass('public.cep_review_comments') IS NULL THEN
    RAISE NOTICE 'public.cep_review_comments not present; skipping (ad-hoc table not in this database)';
    RETURN;
  END IF;

  -- Keep row-level security on (no-op if already enabled).
  ALTER TABLE public.cep_review_comments ENABLE ROW LEVEL SECURITY;

  -- Drop the permissive UPDATE policy that let anon overwrite every comment.
  DROP POLICY IF EXISTS cep_anon_resolve ON public.cep_review_comments;

  -- Revoke the UPDATE table grant from all public-facing roles so no UPDATE path survives for
  -- anonymous (or signed-in) clients. service_role bypasses RLS and grants and is unaffected.
  REVOKE UPDATE ON public.cep_review_comments FROM anon;
  REVOKE UPDATE ON public.cep_review_comments FROM authenticated;
  REVOKE UPDATE ON public.cep_review_comments FROM PUBLIC;
END $$;

-- Verify after applying:
--   SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.cep_review_comments'::regclass;
--   -- expect NO row with polcmd = 'w' (UPDATE); the INSERT ('a') and SELECT ('r') policies remain.
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'cep_review_comments' AND privilege_type = 'UPDATE';
--   -- expect no anon / authenticated / PUBLIC rows.

-- =====================================================================================
-- EXACT statements to run against prod (orchestrator applies these via Supabase MCP):
--
--   DROP POLICY IF EXISTS cep_anon_resolve ON public.cep_review_comments;
--   REVOKE UPDATE ON public.cep_review_comments FROM anon;
--   REVOKE UPDATE ON public.cep_review_comments FROM authenticated;
--   REVOKE UPDATE ON public.cep_review_comments FROM PUBLIC;
--   ALTER TABLE public.cep_review_comments ENABLE ROW LEVEL SECURITY;
-- =====================================================================================
