-- Allow waitlist source 'deep-use' (Oct 28 2026): signups from the "Stay in the loop" dialog
-- the dashboard opens by itself for a heavy user after a pause (src/app/features/EmailPrompt.tsx).
-- api/waitlist.ts already accepts it in VALID_SOURCES.
--
-- APPLY BEFORE DEPLOYING the release that sends it, via the Supabase dashboard SQL editor (this
-- repo keeps migrations in sql/, not supabase/migrations/). Without it the CHECK constraint from
-- 006 rejects the row; api/waitlist.ts then retries it as 'popup' (the signup is kept, its
-- attribution is lost) and logs a warning naming this migration.
--
-- Same shape as 006: the CHECK applies to every writer, and the anon INSERT policy mirrors it so
-- a violation surfaces as a policy failure. Both keep every value 006 allowed. Re-runs are safe.

ALTER TABLE waitlist
  DROP CONSTRAINT IF EXISTS waitlist_source_enum;
ALTER TABLE waitlist
  ADD CONSTRAINT waitlist_source_enum
  CHECK (source IN ('popup', 'hero', 'footer', 'news', 'hub', 'fleet', 'dashboard', 'tsa-page', 'deep-use'));

DROP POLICY IF EXISTS "anon_insert_only" ON waitlist;
CREATE POLICY "anon_insert_only" ON waitlist
  FOR INSERT TO anon
  WITH CHECK (
    email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    AND source IN ('popup', 'hero', 'footer', 'news', 'hub', 'fleet', 'dashboard', 'tsa-page', 'deep-use')
    AND (feature_request IS NULL OR char_length(feature_request) <= 500)
  );
