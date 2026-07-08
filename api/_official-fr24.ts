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
