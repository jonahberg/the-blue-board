// Pro auth + session helpers.
//
// Auth flow: client (Astro page) handles Supabase magic-link sign-in via
// supabase-js. The session access_token is sent to API endpoints via
// Authorization: Bearer <token>. Server verifies with supabase.auth.getUser
// and looks up Pro status from subscriptions.
//
// Why client-side session: simpler than @supabase/ssr cookie management for v1.
// Tradeoff: tokens live in localStorage (XSS-exposed). Acceptable because:
// (1) free dashboard already has no auth, (2) no PII or payment data is stored
// client-side, (3) Stripe checkout is server-initiated. v1.1 may move to
// HttpOnly cookies via @supabase/ssr.

import { getSupabase } from './_supabase.js';

interface MinimalRequest {
  headers?: Record<string, string | string[] | undefined>;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface ProSession {
  userId: string;
  email: string;
  pro: boolean;
}

const BEARER_PREFIX = 'Bearer ';

function extractBearerToken(req: MinimalRequest): string | null {
  const raw = req?.headers?.authorization;
  const headerValue = Array.isArray(raw) ? raw[0] : raw;
  if (typeof headerValue !== 'string') return null;
  if (!headerValue.startsWith(BEARER_PREFIX)) return null;
  return headerValue.slice(BEARER_PREFIX.length);
}

export async function getAuthUser(req: MinimalRequest): Promise<AuthUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  return { id: data.user.id, email: data.user.email ?? '' };
}

export async function getProSession(req: MinimalRequest): Promise<ProSession | null> {
  const user = await getAuthUser(req);
  if (!user) return null;

  const supabase = getSupabase();
  const { data } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', user.id)
    .maybeSingle();

  const pro =
    !!data &&
    data.status === 'active' &&
    !!data.current_period_end &&
    new Date(data.current_period_end).getTime() > Date.now();

  return { userId: user.id, email: user.email, pro };
}
