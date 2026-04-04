// Minimal Supabase client for server-side API routes
// Reads connection details from environment variables

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// Use service role key for server-side API routes (bypasses RLS)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase env vars missing — waitlist writes will fail');
} else if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY missing — falling back to anon key (RLS will apply)');
}

// Guard against createClient throwing when env vars are empty (e.g. in tests or misconfigured deploys).
// Consumers should handle Supabase errors gracefully — this prevents the entire module from crashing.
export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : createClient('https://placeholder.supabase.co', 'placeholder');
