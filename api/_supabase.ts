// Lazy Supabase client for server-side API routes.
// Why lazy: throwing at module load crashes unrelated routes (flight-times,
// fr24-flight) that don't touch Supabase. Throwing only on first use lets a
// Supabase-misconfigured deploy return usable flight data while failing loudly
// on the one route that actually needs the client.
//
// Why strict: the previous anon-key fallback silently masked bug #1 (waitlist
// RLS had no SELECT policy for anon, so isNewSignup was always true and welcome
// emails fired on every resubmission). Production now requires
// SUPABASE_SERVICE_ROLE_KEY. In non-production, the anon fallback is retained
// for dev ergonomics with a loud warning.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

function build(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

  if (!url) {
    throw new Error('Supabase not configured: NEXT_PUBLIC_SUPABASE_URL is missing');
  }

  if (isProd && !serviceKey) {
    throw new Error(
      'Supabase misconfigured: SUPABASE_SERVICE_ROLE_KEY is required in production (anon fallback disabled — see api/_supabase.ts)'
    );
  }

  const key = serviceKey || anonKey;
  if (!key) {
    throw new Error('Supabase not configured: no service role or anon key available');
  }

  if (!serviceKey) {
    console.warn(
      'SUPABASE_SERVICE_ROLE_KEY missing — falling back to anon key (RLS applies; some writes may silently fail). Not safe for production.'
    );
  }

  return createClient(url, key);
}

/**
 * Returns the Supabase client, building it on first call. Throws if env vars
 * are missing (strictly in production, best-effort fallback in dev). Callers
 * should let exceptions bubble — the handler's try/catch will return 500 and
 * the misconfiguration surfaces in logs instead of silently behaving wrong.
 */
export function getSupabase(): SupabaseClient {
  if (!cached) cached = build();
  return cached;
}
