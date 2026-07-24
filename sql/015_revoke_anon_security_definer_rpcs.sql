-- 015: Revoke anon/public EXECUTE on SECURITY DEFINER functions + pin search_path.
-- SECURITY: increment_daily_usage + handle_new_user were EXECUTE-granted to anon/authenticated/PUBLIC;
-- SECURITY DEFINER bypasses RLS, so any anon-key holder could POST /rest/v1/rpc/increment_daily_usage
-- with an arbitrary user_id to tamper quotas. Dormant today (profiles/usage_daily empty) but callable.
-- NOTE: this DDL was applied to prod live on 2026-07-23; this file tracks it for repo parity.
REVOKE EXECUTE ON FUNCTION public.increment_daily_usage(uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
ALTER FUNCTION public.increment_daily_usage(uuid, text) SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
