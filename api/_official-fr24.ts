// Single source of truth for the FR24 Official API kill switch.
//
// SCHEDULE_OFFICIAL_FALLBACK_ENABLED=false must disable EVERY caller of the paid official API,
// not just the targeted same-day rescue. The Jul 3 2026 audit found the flag was read in exactly
// one of three call paths, so 402 "Credit limit reached" calls kept firing from
// tryOfficialFallback, /api/fr24-flight and /api/aircraft-history after the operator turned the
// flag off. Any new official-API consumer must gate on this helper.

import { hydrateQuotaBlock, persistQuotaBlock } from './_cost-state.js';

export function isOfficialFr24Enabled(): boolean {
  const setting = String(process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED ?? 'true').toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(setting);
}

// F038: the shared 402 credit-exhaustion block (api/_cost-state.ts's persistQuotaBlock /
// getMirroredQuotaBlockedUntil) was, until this fix, only wired up in api/schedule.ts. flight-times,
// fr24-flight, and aircraft-history each independently called the paid official API with no
// knowledge of a block another lambda had just recorded, and never recorded one themselves on a
// 402 — so a credit-exhausted account kept taking hits from every endpoint except schedule.ts.
// These two helpers are the one place every official-API caller should route through: they wrap
// _cost-state.ts's Supabase-mirrored block so a 402 seen by ANY endpoint stops ALL of them, on
// every lambda, without each caller re-implementing the block bookkeeping.
export const OFFICIAL_QUOTA_BLOCK_MS = 30 * 60 * 1000;

/**
 * Pull the latest cross-instance quota block into this lambda's mirror and report whether the
 * official API is currently blocked. Always call this (it hydrates from Supabase, rate-limited to
 * one read per ~10s internally) before making an official-API call — a locally-fresh mirror is
 * useless if it's never refreshed.
 */
export async function isOfficialApiQuotaBlocked(): Promise<boolean> {
  const blockedUntil = await hydrateQuotaBlock();
  return Date.now() < blockedUntil;
}

/** Record a 402 "credit limit reached" from the official API and propagate the block to every
 *  other lambda via the shared Supabase-backed store. Fire-and-forget; never throws. */
export function recordOfficialApi402(reason: string): void {
  const blockedUntil = Date.now() + OFFICIAL_QUOTA_BLOCK_MS;
  console.warn(`Official FR24 API quota blocked for 30m: ${reason}`);
  void persistQuotaBlock(blockedUntil, reason);
}

/**
 * FR24's flight-summary endpoints document `flight_datetime_from/to` as `YYYY-MM-DDTHH:MM:SSZ`
 * (whole seconds). `Date.prototype.toISOString()` emits `YYYY-MM-DDTHH:MM:SS.mmmZ`, which the API
 * rejected with 400 on every call (found Sep 10 2026 when the official API was re-enabled: every
 * /api/fr24-flight summary lookup and every /api/aircraft-history lookup was 400ing). Use this for
 * every datetime sent to the official API.
 */
export function fr24Datetime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ═══ Which flight-summary leg answers "where is UA123?" (audit F0, Sep 2026) ═══
//
// flight-summary/light returns only legs that have OPERATED, most recent last or first depending
// on the query — and never a leg that has not departed yet. Taking flights[0] answered "UA2278
// landed, N24542" about yesterday's flight while tonight's had not left the gate. The rule:
//  - with a scheduled departure for the leg we mean (from the hub boards), accept only a leg that
//    started no earlier than an hour before it — anything older is a previous day's leg;
//  - without one, accept only a leg that is live now or ended in the last few hours;
//  - `allowPrevious` returns the most recent leg anyway, flagged `current: false`, for callers
//    that label it as history rather than presenting it as the flight.
export const FR24_LEG_EARLY_MS = 60 * 60 * 1000;
export const FR24_RECENT_END_MS = 3 * 60 * 60 * 1000;
const FR24_STALE_TRACK_MS = 45 * 60 * 1000;
// Longest United leg is ~19h (EWR-SIN); an un-ended leg older than this is not in the air.
const FR24_MAX_LEG_MS = 20 * 60 * 60 * 1000;

function legMs(value: any): number {
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value || '');
  return Number.isFinite(ms) ? ms : NaN;
}

/** When the leg started: takeoff, else first ADS-B contact (a leg still taxiing out). */
function legStartMs(f: any): number {
  const takeoff = legMs(f?.datetime_takeoff || f?.departure?.actual);
  return Number.isFinite(takeoff) ? takeoff : legMs(f?.first_seen);
}

/** When the leg ended, or NaN while it is still going. */
function legEndMs(f: any): number {
  const landed = legMs(f?.datetime_landed || f?.arrival?.actual);
  if (Number.isFinite(landed)) return landed;
  return f?.flight_ended ? legMs(f?.last_seen) : NaN;
}

function legIsLive(f: any, nowMs: number): boolean {
  if (f?.flight_ended || Number.isFinite(legEndMs(f))) return false;
  if (!Number.isFinite(legStartMs(f))) return false;
  // A not-ended leg FR24 stopped hearing from long ago is lost tracking, not a live flight.
  const lastSeen = legMs(f?.last_seen);
  if (Number.isFinite(lastSeen)) return nowMs - lastSeen <= FR24_STALE_TRACK_MS;
  return nowMs - legStartMs(f) <= FR24_MAX_LEG_MS;
}

export function pickFr24SummaryLeg(
  flights: any[],
  opts: { nowMs?: number; schedDepMs?: number | null; allowPrevious?: boolean } = {}
): { leg: any; current: boolean } | null {
  const nowMs = opts.nowMs ?? Date.now();
  const legs = (Array.isArray(flights) ? flights : []).filter((f) => f && Number.isFinite(legStartMs(f)));
  const newestFirst = legs.slice().sort((a, b) => legStartMs(b) - legStartMs(a));

  if (opts.schedDepMs && Number.isFinite(opts.schedDepMs)) {
    const match = newestFirst.find((f) => legStartMs(f) >= (opts.schedDepMs as number) - FR24_LEG_EARLY_MS);
    return match ? { leg: match, current: true } : null;
  }

  const live = newestFirst.find((f) => legIsLive(f, nowMs));
  if (live) return { leg: live, current: true };
  const recent = newestFirst.find((f) => {
    const end = legEndMs(f);
    return Number.isFinite(end) && nowMs - end <= FR24_RECENT_END_MS;
  });
  if (recent) return { leg: recent, current: true };
  const previous = newestFirst[0] || (Array.isArray(flights) ? flights[0] : null);
  if (opts.allowPrevious && previous) return { leg: previous, current: false };
  return null;
}
