-- Close the open anon INSERT path on public.cep_review_comments.
--
-- Follow-up to sql/011 (which dropped the open UPDATE policy). 011 deliberately kept two things:
--   * cep_anon_read (SELECT USING true)  — world-readable board, INTENTIONAL, still kept here.
--   * cep_anon_insert (INSERT, length-capped) — kept because the CEP/Canopy design review was
--     actively collecting comments at the time.
--
-- The Jul 3 2026 audit re-flagged the INSERT policy: it is gated only by length checks (body
-- 1–2000, author ≤80, deck ≤60), writes go straight to PostgREST with the public anon key —
-- bypassing every rate limiter in api/ — so any stranger can inject unlimited persistent rows
-- (spam/storage abuse, plus stored-XSS exposure in any renderer that fails to escape `body`).
-- The review it served is over (last comment 2026-06-19, deck krpd-cep-v4) and no code in this
-- repo or the gstack tooling config references the table today, so the write path now carries
-- risk with zero remaining benefit.
--
-- Fix: drop the anon INSERT policy and revoke the INSERT grant from all public-facing roles.
-- Future design reviews that want anon comments again should re-create a scoped policy (ideally
-- behind a server route with rate limiting, like the waitlist), not restore the open grant.
--
-- Idempotent + safe to re-run, same guards as sql/011.
--
-- APPLY MANUALLY via the Supabase SQL editor / MCP (this repo keeps migrations in sql/, not
-- supabase/migrations/). The exact statements to run against prod are at the END of this file.

DO $$
BEGIN
  IF to_regclass('public.cep_review_comments') IS NULL THEN
    RAISE NOTICE 'public.cep_review_comments not present; skipping (ad-hoc table not in this database)';
    RETURN;
  END IF;

  ALTER TABLE public.cep_review_comments ENABLE ROW LEVEL SECURITY;

  -- Drop the length-capped-but-otherwise-open INSERT policy.
  DROP POLICY IF EXISTS cep_anon_insert ON public.cep_review_comments;

  -- Revoke the INSERT table grant from all public-facing roles. service_role bypasses RLS and
  -- grants and is unaffected.
  REVOKE INSERT ON public.cep_review_comments FROM anon;
  REVOKE INSERT ON public.cep_review_comments FROM authenticated;
  REVOKE INSERT ON public.cep_review_comments FROM PUBLIC;
END $$;

-- Verify after applying:
--   SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.cep_review_comments'::regclass;
--   -- expect only the SELECT ('r') policy cep_anon_read to remain.
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'cep_review_comments'
--      AND privilege_type IN ('INSERT', 'UPDATE');
--   -- expect no anon / authenticated / PUBLIC rows.

-- =====================================================================================
-- EXACT statements to run against prod (orchestrator applies these via Supabase MCP):
--
--   DROP POLICY IF EXISTS cep_anon_insert ON public.cep_review_comments;
--   REVOKE INSERT ON public.cep_review_comments FROM anon;
--   REVOKE INSERT ON public.cep_review_comments FROM authenticated;
--   REVOKE INSERT ON public.cep_review_comments FROM PUBLIC;
--   ALTER TABLE public.cep_review_comments ENABLE ROW LEVEL SECURITY;
-- =====================================================================================
