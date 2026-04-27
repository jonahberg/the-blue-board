// Pure helpers for the risk-monitor cron. Kept separate from the orchestrator
// so each piece of logic is independently testable.
//
// - assignBucket: partitions Pro users into 15 buckets (one per cron-tick minute)
// - computeSignalsHash: stable hash of upstream signals for delta-based gating (D12)
// - shouldCallAnthropic: true only when signals changed AND budget remains
// - crossedAlertThreshold: true on transitions into 'high' risk (alert trigger)
// - isValidFlightNumber: regex-validates a flight number string (D9 prompt-injection defense)

import crypto from 'node:crypto';

export const BUCKET_COUNT = 15;

type RiskLevel = 'low' | 'medium' | 'high';

export function assignBucket(userId: string): number {
  const hash = crypto.createHash('sha256').update(userId).digest();
  // Read first 4 bytes as uint32 → modulo BUCKET_COUNT
  const n = hash.readUInt32BE(0);
  return n % BUCKET_COUNT;
}

export function computeSignalsHash(signals: Record<string, unknown>): string {
  // Canonical key order so {a:1, b:2} === {b:2, a:1}
  const sorted = Object.keys(signals)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = signals[k];
      return acc;
    }, {});
  return crypto.createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

export function shouldCallAnthropic(opts: {
  prevHash: string | null;
  currHash: string;
  callsRemaining: number;
}): boolean {
  if (opts.callsRemaining <= 0) return false;
  if (opts.prevHash === opts.currHash) return false;
  return true;
}

export function crossedAlertThreshold(
  prev: RiskLevel | null,
  curr: RiskLevel | null
): boolean {
  if (curr !== 'high') return false;
  if (prev === 'high') return false; // already alerted
  return true;
}

// v1: only United mainline (UA + 1-4 digits). The risk-monitor cron's upstream
// (api/flight-times) doesn't currently support UAL Express carrier codes
// (SKW, GJS, etc), so accepting them would mean silent monitoring failure.
// Tighten in v1.1 when express support lands upstream.
const FLIGHT_NUMBER_RE = /^UA[0-9]{1,4}$/;

export function isValidFlightNumber(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 6) return false;
  return FLIGHT_NUMBER_RE.test(value);
}
