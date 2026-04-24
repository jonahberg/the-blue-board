-- DB-level validation for waitlist writes. Without these, an attacker holding
-- the public anon key can bypass api/waitlist.ts validation and rate limit by
-- calling supabase-js directly. The CHECK constraints enforce the same shape
-- the API does, and the tightened WITH CHECK policy applies them to anon
-- writes specifically.
--
-- IMPORTANT: Before running this migration against prod, audit existing rows:
--   SELECT DISTINCT source FROM waitlist;
-- If any source values are NOT in the whitelist below, EITHER add them here
-- OR update the rows first:
--   UPDATE waitlist SET source = 'popup' WHERE source NOT IN (...);
-- Otherwise ADD CONSTRAINT will fail and the migration aborts.
--
-- ADD CONSTRAINT IF NOT EXISTS pattern makes re-runs safe.

-- CHECK constraints apply to all writers (anon and service role).
ALTER TABLE waitlist
  DROP CONSTRAINT IF EXISTS waitlist_email_format;
ALTER TABLE waitlist
  ADD CONSTRAINT waitlist_email_format
  CHECK (email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$');

ALTER TABLE waitlist
  DROP CONSTRAINT IF EXISTS waitlist_source_enum;
ALTER TABLE waitlist
  ADD CONSTRAINT waitlist_source_enum
  CHECK (source IN ('popup', 'hero', 'footer', 'news', 'hub', 'fleet', 'dashboard', 'tsa-page'));

ALTER TABLE waitlist
  DROP CONSTRAINT IF EXISTS waitlist_feature_request_length;
ALTER TABLE waitlist
  ADD CONSTRAINT waitlist_feature_request_length
  CHECK (feature_request IS NULL OR char_length(feature_request) <= 500);

-- Tighten anon INSERT policy. Anon can still write, but only rows that satisfy
-- the API's intent. This makes the RLS policy match the CHECK constraints so
-- violations surface as policy failures (clear error) rather than constraint
-- failures (cryptic error).
DROP POLICY IF EXISTS "anon_insert_only" ON waitlist;
CREATE POLICY "anon_insert_only" ON waitlist
  FOR INSERT TO anon
  WITH CHECK (
    email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    AND source IN ('popup', 'hero', 'footer', 'news', 'hub', 'fleet', 'dashboard', 'tsa-page')
    AND (feature_request IS NULL OR char_length(feature_request) <= 500)
  );
