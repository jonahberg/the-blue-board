-- cep_review_comments: anon INSERT is INTENTIONAL — it serves an EXTERNAL project. DO NOT REMOVE.
--
-- History (Jul 3 2026): the audit flagged the anon INSERT policy as an unlimited-anon-write spam
-- vector, and — after finding zero consumers in THIS repo — it was dropped in prod. That broke a
-- live consumer nobody had recorded: https://krpd-cep-site.vercel.app (deck krpd-cep-v5), a
-- design-review site for the separate krpd project, which submits comments straight to PostgREST
-- with this database's public anon key. The policy was restored the same hour, owner-approved,
-- exactly as it was.
--
-- THE LESSON THIS FILE EXISTS TO RECORD: this table's consumers are OUTSIDE this repo. Searching
-- the Blue Board codebase proves nothing about whether the anon write path is in use. Before any
-- future tightening, check every *-cep-site deck deployment (gstack design-review tooling) that
-- embeds this project's anon key.
--
-- Accepted risk, owner-approved Jul 3 2026: anon INSERT has no rate limit (PostgREST bypasses the
-- api/ limiters) and is bounded only by the length caps below. If spam ever materializes, the
-- upgrade path is a server-proxied comment route (like the waitlist) or a deck-prefix CHECK — not
-- a silent revoke.
--
-- What remains closed (unchanged from sql/011): anon UPDATE (dropped 2026-06-17) and DELETE
-- (never granted). RLS stays enabled. Public SELECT stays (world-readable board, intentional).
--
-- This block is idempotent: it ensures the INSERT policy + grant EXIST (converging prod toward
-- the intended state), matching the policy restored on 2026-07-03.

DO $$
BEGIN
  IF to_regclass('public.cep_review_comments') IS NULL THEN
    RAISE NOTICE 'public.cep_review_comments not present; skipping (ad-hoc table not in this database)';
    RETURN;
  END IF;

  ALTER TABLE public.cep_review_comments ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.cep_review_comments'::regclass AND polname = 'cep_anon_insert'
  ) THEN
    CREATE POLICY cep_anon_insert ON public.cep_review_comments
      FOR INSERT TO public
      WITH CHECK (
        char_length(body) >= 1 AND char_length(body) <= 2000
        AND char_length(author) <= 80
        AND char_length(deck) <= 60
      );
  END IF;

  GRANT INSERT ON public.cep_review_comments TO anon;
END $$;

-- Verify:
--   SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.cep_review_comments'::regclass;
--   -- expect cep_anon_read ('r') AND cep_anon_insert ('a'); NO UPDATE ('w') policy.
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'cep_review_comments'
--      AND grantee = 'anon';
--   -- expect SELECT and INSERT only.
