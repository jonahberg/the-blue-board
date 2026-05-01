// /api/cron/risk-monitor
//
// Per Eng Review D2: staggered batching by user.id % 15 (one bucket per
// cron-tick minute). Per D12: per-tick processed-flight ceiling to stay under
// the Vercel task budget AND cap downstream cost.
//
// v1 scope: detects which Pro users' flights are in the current bucket and
// records last_checked. Real upstream-signal fetch + delta detection +
// alert dispatch hooks in via processFlight (stub for v1; expanded after
// Day 6-7 push infrastructure ships).
//
// Auth: CRON_SECRET via crypto.timingSafeEqual (D14). Kill switch: D10
// (PRO_ENABLED master + PRO_FEATURE_RISK_MONITOR_ENABLED per-feature).

import type { VercelRequest, VercelResponse } from '../types.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';
import { isProEnabled } from '../_kill-switch.js';
import { getSupabase } from '../_supabase.js';
import {
  assignBucket,
  BUCKET_COUNT,
  computeSignalsHash,
  shouldCallAnthropic,
  crossedAlertThreshold,
} from '../_risk-monitor-utils.js';
import { dispatchAlert } from '../_alert-dispatcher.js';

const MAX_FLIGHTS_PER_TICK = 50;
const PROCESS_CONCURRENCY = Number(process.env.RISK_MONITOR_CONCURRENCY || 8);
const CRON_TIME_BUDGET_MS = Number(process.env.RISK_MONITOR_TIME_BUDGET_MS || 52_000);
// Per Eng Review D12: cap downstream work per tick. Currently Anthropic isn't
// called from the cron (delay-explain stays user-pull) but the gate is wired
// so v1.1 can flip it on without changing the per-tick cost ceiling.
const ANTHROPIC_CALL_CEILING = Number(process.env.RISK_MONITOR_CALL_CEILING || 50);
const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://theblueboard.co';

type RiskLevel = 'low' | 'medium' | 'high';

interface UserFlight {
  user_id: string;
  flight_number: string;
  risk_state?:
    | { last_checked: string; signals_hash: string | null; risk_level: RiskLevel | null }
    | Array<{ last_checked: string; signals_hash: string | null; risk_level: RiskLevel | null }>
    | null;
}

interface PriorRiskState {
  signals_hash: string | null;
  risk_level: RiskLevel | null;
}

function currentBucket(now: Date = new Date()): number {
  // Test-only override (set via env var) so cron tests don't depend on the
  // wall clock — `assignBucket(userId)` and `currentBucket()` must agree for
  // the handler to take the processing path, and the tests use fixed user IDs.
  const override = process.env.RISK_MONITOR_BUCKET_OVERRIDE;
  if (override !== undefined) {
    const n = Number.parseInt(override, 10);
    if (Number.isFinite(n) && n >= 0 && n < BUCKET_COUNT) return n;
  }
  return now.getMinutes() % BUCKET_COUNT;
}

// Compute delay in minutes from scheduled vs estimated/actual ISO timestamps.
// Returns 0 if either side is missing or unparseable.
function delayMinutes(scheduled: string | null, observed: string | null): number {
  if (!scheduled || !observed) return 0;
  const sMs = Date.parse(scheduled);
  const oMs = Date.parse(observed);
  if (!Number.isFinite(sMs) || !Number.isFinite(oMs)) return 0;
  return Math.max(0, Math.round((oMs - sMs) / 60_000));
}

// Fetch upstream signals for a flight from /api/flight-times. The actual
// response shape (per api/flight-times.ts:110-137) uses nested
// departure/arrival objects + boolean cancelled/diverted, NOT flat
// status/delay_minutes fields. Project to the subset that drives alerting.
// Returns null on upstream failure → caller records risk_state.error so the
// UI can show "alerts paused" instead of silently dropping the user.
async function fetchSignals(flightNumber: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const headers: Record<string, string> = { 'User-Agent': 'BlueBoard-RiskMonitor/1.0' };
    // Bypass the per-IP rate limiter on /api/flight-times — without this, every
    // flight past slot 30 in a tick gets 429 because the cron shares one egress IP.
    if (process.env.CRON_SECRET) {
      headers.Authorization = `Bearer ${process.env.CRON_SECRET}`;
    }
    const resp = await fetch(`${BASE_URL}/api/flight-times?flight=${encodeURIComponent(flightNumber)}`, {
      signal: controller.signal,
      headers,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;

    const dep = data?.departure ?? {};
    const arr = data?.arrival ?? {};
    const gateScheduled = dep?.gate?.scheduled ?? null;
    const gateObserved = dep?.gate?.actual ?? dep?.gate?.estimated ?? null;
    const takeoffScheduled = dep?.takeoff?.scheduled ?? null;
    const takeoffObserved = dep?.takeoff?.actual ?? dep?.takeoff?.estimated ?? null;

    // Pick whichever delay signal has data; prefer takeoff over gate.
    const departureDelayMin =
      delayMinutes(takeoffScheduled, takeoffObserved) ||
      delayMinutes(gateScheduled, gateObserved);

    const landingScheduled = arr?.landing?.scheduled ?? null;
    const landingObserved = arr?.landing?.actual ?? arr?.landing?.estimated ?? null;
    const arrivalDelayMin = delayMinutes(landingScheduled, landingObserved);

    return {
      status: data?.status ?? null,
      cancelled: !!data?.cancelled,
      diverted: !!data?.diverted,
      departure_delay_min: departureDelayMin,
      arrival_delay_min: arrivalDelayMin,
      origin: data?.origin?.iata ?? null,
      destination: data?.destination?.iata ?? null,
      gate_scheduled: gateScheduled,
      gate_observed: gateObserved,
    };
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Compute risk level from the projected signals. Conservative thresholds —
// noisy alerts are worse than missed marginal ones for an opt-in product.
function classifyRisk(signals: Record<string, unknown>): RiskLevel {
  if (signals.cancelled === true) return 'high';
  if (signals.diverted === true) return 'high';
  const depDelay = Number(signals.departure_delay_min ?? 0);
  const arrDelay = Number(signals.arrival_delay_min ?? 0);
  const worst = Math.max(depDelay, arrDelay);
  if (worst >= 60) return 'high';
  if (worst >= 15) return 'medium';
  return 'low';
}

function readPriorState(flight: UserFlight): PriorRiskState {
  const rs = flight.risk_state;
  if (!rs) return { signals_hash: null, risk_level: null };
  const row = Array.isArray(rs) ? rs[0] : rs;
  if (!row) return { signals_hash: null, risk_level: null };
  return {
    signals_hash: row.signals_hash ?? null,
    risk_level: row.risk_level ?? null,
  };
}

interface FlightProcessContext {
  emailByUserId: Map<string, string>;
  callsRemaining: { count: number };
}

async function processFlight(
  flight: UserFlight,
  ctx: FlightProcessContext
): Promise<{ processed: boolean; alerted: boolean }> {
  const supabase = getSupabase();
  const prior = readPriorState(flight);

  const signals = await fetchSignals(flight.flight_number);
  if (!signals) {
    // Upstream failed — record the error so the My Flights UI can surface it.
    await supabase.from('risk_state').upsert(
      {
        user_id: flight.user_id,
        flight_number: flight.flight_number,
        last_checked: new Date().toISOString(),
        error: 'upstream_unavailable',
      },
      { onConflict: 'user_id,flight_number' }
    );
    return { processed: true, alerted: false };
  }

  const currHash = computeSignalsHash(signals);
  // Per Eng Review D12: skip downstream work when nothing changed AND budget remains.
  // Currently we don't call Anthropic at all in v1 (text generation is on-demand
  // via /api/delay-explain), but the gate is wired so v1.1 can flip it on.
  const shouldRecompute = shouldCallAnthropic({
    prevHash: prior.signals_hash,
    currHash,
    callsRemaining: ctx.callsRemaining.count,
  });

  let nextRiskLevel: RiskLevel = prior.risk_level ?? 'low';
  let didAlert = false;
  let claimedAlertAt: string | undefined;

  if (shouldRecompute) {
    nextRiskLevel = classifyRisk(signals);
    if (crossedAlertThreshold(prior.risk_level, nextRiskLevel)) {
      // Claim the alert in the same state row before external delivery. If the
      // server crashes after push/email succeeds, the next cron tick sees the
      // new hash/risk state and will not double-send the same transition.
      claimedAlertAt = new Date().toISOString();
      const { error: claimErr } = await supabase.from('risk_state').upsert(
        {
          user_id: flight.user_id,
          flight_number: flight.flight_number,
          signals_hash: currHash,
          risk_level: nextRiskLevel,
          last_checked: claimedAlertAt,
          last_alerted: claimedAlertAt,
          error: null,
        },
        { onConflict: 'user_id,flight_number' }
      );
      if (claimErr) {
        console.error('risk_state alert claim failed:', claimErr.message);
        return { processed: false, alerted: false };
      }

      const email = ctx.emailByUserId.get(flight.user_id) ?? '';
      try {
        const result = await dispatchAlert({
          userId: flight.user_id,
          email,
          flightNumber: flight.flight_number,
          title: `${flight.flight_number} delay risk increased`,
          body:
            `Status: ${signals.status ?? 'changed'}. Tap for the AI breakdown of why.`,
          url: `https://theblueboard.co/?flight=${encodeURIComponent(flight.flight_number)}`,
        });
        didAlert = result.pushSent + result.emailSent > 0;
      } catch (err: any) {
        console.error('dispatchAlert failed:', err.message);
      }
    }
    // Decrement only when we actually recomputed (gating respected even though
    // we don't call Anthropic yet — keeps the cap meaningful when v1.1 turns it on).
    ctx.callsRemaining.count -= 1;
  }

  // If the budget was exhausted (shouldRecompute=false but signals DID change),
  // keep the PRIOR signals_hash so the next tick sees the change as still
  // pending. Updating to currHash here would mark this change as "already
  // processed" and the alert would never fire.
  const persistedHash =
    !shouldRecompute && prior.signals_hash !== null && prior.signals_hash !== currHash
      ? prior.signals_hash
      : currHash;

  const { error } = await supabase.from('risk_state').upsert(
    {
      user_id: flight.user_id,
      flight_number: flight.flight_number,
      signals_hash: persistedHash,
      risk_level: nextRiskLevel,
      last_checked: new Date().toISOString(),
      last_alerted: claimedAlertAt,
      error: null,
    },
    { onConflict: 'user_id,flight_number' }
  );
  if (error) {
    console.error('risk_state upsert failed:', error.message);
    return { processed: false, alerted: didAlert };
  }
  return { processed: true, alerted: didAlert };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!isProEnabled('risk_monitor')) {
    return res.status(503).json({ error: 'Risk monitor temporarily disabled' });
  }

  const bucket = currentBucket();
  const supabase = getSupabase();

  // 1. Active Pro user IDs (single query)
  const { data: subs, error: subsErr } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('status', 'active')
    .gt('current_period_end', new Date().toISOString());

  if (subsErr) {
    console.error('subscriptions query failed:', subsErr.message);
    return res.status(500).json({ error: 'Could not load active users' });
  }

  // 2. Filter to current bucket via stable hash
  const bucketUserIds = (subs ?? [])
    .map((s: any) => s.user_id as string)
    .filter((uid) => assignBucket(uid) === bucket);

  if (bucketUserIds.length === 0) {
    return res.status(200).json({
      bucket,
      processed: 0,
      alerted: 0,
      reason: 'no users in this bucket',
    });
  }

  // 3. Pull flights for those users. We fetch user_flights and risk_state
  // separately (they share user_id but no FK relationship in sql/008_pro_v1.sql,
  // so PostgREST embed syntax doesn't work). Pull extra rows so the app-level
  // sort by last_checked has headroom for proper rotation.
  const { data: flights, error: flightsErr } = await supabase
    .from('user_flights')
    .select('user_id, flight_number')
    .in('user_id', bucketUserIds);

  // Fetch matching risk_state rows for the same users
  const { data: riskRows, error: riskErr } = await supabase
    .from('risk_state')
    .select('user_id, flight_number, last_checked, signals_hash, risk_level')
    .in('user_id', bucketUserIds);

  if (riskErr) {
    console.error('risk_state query failed:', riskErr.message);
    return res.status(500).json({ error: 'Could not load prior risk state' });
  }

  // Index risk_state by composite key for O(1) merge
  const riskByKey = new Map<string, { last_checked: string; signals_hash: string | null; risk_level: RiskLevel | null }>();
  for (const r of (riskRows ?? []) as any[]) {
    riskByKey.set(`${r.user_id}|${r.flight_number}`, {
      last_checked: r.last_checked,
      signals_hash: r.signals_hash,
      risk_level: r.risk_level,
    });
  }

  // Merge + sort by last_checked ASC NULLS FIRST so flights that have NEVER
  // been checked go first, then oldest-checked. Guarantees rotation through
  // all flights in the bucket even when count exceeds MAX_FLIGHTS_PER_TICK.
  const enriched = (flights ?? []).map((f: any) => ({
    ...f,
    risk_state: riskByKey.get(`${f.user_id}|${f.flight_number}`) ?? null,
  }));
  const sorted = enriched.slice().sort((a, b) => {
    const aTs = a.risk_state?.last_checked ?? null;
    const bTs = b.risk_state?.last_checked ?? null;
    if (aTs === null && bTs === null) return 0;
    if (aTs === null) return -1;
    if (bTs === null) return 1;
    return new Date(aTs).getTime() - new Date(bTs).getTime();
  });

  if (flightsErr) {
    console.error('user_flights query failed:', flightsErr.message);
    return res.status(500).json({ error: 'Could not load flights' });
  }

  const cappedFlights = sorted.slice(0, MAX_FLIGHTS_PER_TICK);

  // 4. Per-tick processing context. emailByUserId is populated lazily — for v1
  // we use the email-fallback endpoint string to derive recipient address, so
  // we don't need to round-trip auth.users for push-only subscribers.
  const ctx: FlightProcessContext = {
    emailByUserId: new Map(),
    callsRemaining: { count: ANTHROPIC_CALL_CEILING },
  };

  // 5. Process flights with bounded concurrency and a global time budget. This
  // keeps the 60s Vercel maxDuration safe even when /api/flight-times is slow.
  let processed = 0;
  let alerted = 0;
  let nextIndex = 0;
  const deadline = Date.now() + CRON_TIME_BUDGET_MS;
  const workerCount = Math.max(1, Math.min(PROCESS_CONCURRENCY, cappedFlights.length));

  async function worker() {
    while (Date.now() < deadline) {
      const flight = cappedFlights[nextIndex++];
      if (!flight) return;
      const result = await processFlight(flight as UserFlight, ctx);
      if (result.processed) processed++;
      if (result.alerted) alerted++;
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return res.status(200).json({
    bucket,
    candidates: cappedFlights.length,
    processed,
    alerted,
    anthropic_calls_remaining: ctx.callsRemaining.count,
  });
}
