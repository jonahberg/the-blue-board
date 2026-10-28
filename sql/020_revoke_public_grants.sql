-- Oct 28 2026: the public anon key (visible in every browser) held ALL privileges, incl. TRUNCATE,
-- on the Blue Board tables below. RLS blocked reads/writes, but TRUNCATE is outside RLS and nothing
-- uses these grants (prod uses the service-role key; api/_supabase.ts refuses anon in production).
-- The waitlist's anon INSERT policy let anyone with the anon key bypass /api/waitlist's checks.
REVOKE ALL ON public.waitlist, public.watch_subscriptions, public.reg_sightings, public.schedule_snapshots,
  public.schedule_cost_state, public.starlink_snapshot, public.news_notifications FROM anon, authenticated;
DROP POLICY IF EXISTS "anon_insert_only" ON public.waitlist;
