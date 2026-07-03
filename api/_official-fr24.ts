// Single source of truth for the FR24 Official API kill switch.
//
// SCHEDULE_OFFICIAL_FALLBACK_ENABLED=false must disable EVERY caller of the paid official API,
// not just the targeted same-day rescue. The Jul 3 2026 audit found the flag was read in exactly
// one of three call paths, so 402 "Credit limit reached" calls kept firing from
// tryOfficialFallback, /api/fr24-flight and /api/aircraft-history after the operator turned the
// flag off. Any new official-API consumer must gate on this helper.

export function isOfficialFr24Enabled(): boolean {
  const setting = String(process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED ?? 'true').toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(setting);
}
