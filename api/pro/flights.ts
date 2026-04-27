// /api/pro/flights — CRUD for the authenticated Pro user's tracked flights.
//
// Auth: Bearer token (Supabase access_token), Pro check via getProSession.
// Limits: 10 flights per user (DB-enforced via UNIQUE + app-enforced via count).
// Validation: flight_number must match isValidFlightNumber regex (D9: prompt-injection defense).
// RLS: backed by user_flights_*_own policies in sql/009_pro_rls.sql.

import type { VercelRequest, VercelResponse } from '../types.js';
import { getSupabase } from '../_supabase.js';
import { getProSession } from '../_auth.js';
import { isValidFlightNumber } from '../_risk-monitor-utils.js';

const MAX_FLIGHTS_PER_USER = 10;
const ALLOWED_ORIGINS = new Set([
  'https://theblueboard.co',
  'https://www.theblueboard.co',
]);
const LOCALHOST_RE = /^http:\/\/localhost(:\d+)?$/;

function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers?.origin || '';
  const ok = typeof origin === 'string' && (ALLOWED_ORIGINS.has(origin) || LOCALHOST_RE.test(origin));
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : 'https://theblueboard.co');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Per-user authenticated data — never cache. The service worker also
  // excludes /api/pro/* explicitly (defense in depth) but the header is
  // belt + suspenders: any browser, proxy, or future SW change is covered.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const session = await getProSession(req);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!session.pro) {
    res.status(403).json({ error: 'Pro subscription required' });
    return;
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('user_flights')
      .select('*')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('user_flights select error:', error.message);
      res.status(500).json({ error: 'Could not load flights' });
      return;
    }
    res.status(200).json({ flights: data ?? [] });
    return;
  }

  if (req.method === 'POST') {
    const flightNumber = (req.body?.flight_number ?? '').toString().trim().toUpperCase();

    if (!flightNumber) {
      res.status(400).json({ error: 'flight_number is required' });
      return;
    }
    if (!isValidFlightNumber(flightNumber)) {
      res.status(400).json({
        error: 'Use a United mainline flight number like UA123 or UA1234. United Express (SKW, GJS) coming in v1.1.',
      });
      return;
    }

    // Cap check: count current flights
    const { count, error: countErr } = await supabase
      .from('user_flights')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', session.userId);
    if (countErr) {
      console.error('user_flights count error:', countErr.message);
      res.status(500).json({ error: 'Could not check flight cap' });
      return;
    }
    if ((count ?? 0) >= MAX_FLIGHTS_PER_USER) {
      res.status(400).json({
        error: `You can track up to ${MAX_FLIGHTS_PER_USER} flights — remove one first`,
      });
      return;
    }

    const { data, error } = await supabase
      .from('user_flights')
      .insert({
        user_id: session.userId,
        flight_number: flightNumber,
      })
      .select();
    if (error) {
      // 23505 = unique_violation
      if ((error as any).code === '23505') {
        res.status(409).json({ error: 'This flight is already in your list' });
        return;
      }
      console.error('user_flights insert error:', error.message);
      res.status(500).json({ error: 'Could not add flight' });
      return;
    }
    res.status(201).json({ flight: data?.[0] ?? null });
    return;
  }

  if (req.method === 'DELETE') {
    const flightNumber = ((req.query?.flight_number as string) || '').trim().toUpperCase();
    if (!flightNumber) {
      res.status(400).json({ error: 'flight_number query param required' });
      return;
    }
    const { error } = await supabase
      .from('user_flights')
      .delete()
      .eq('user_id', session.userId)
      .eq('flight_number', flightNumber);
    if (error) {
      console.error('user_flights delete error:', error.message);
      res.status(500).json({ error: 'Could not remove flight' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
