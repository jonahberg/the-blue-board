/**
 * Severity NAMES → token classes.
 *
 * The thresholds themselves live in `src/lib` (`delayColorVar`, `dataAgeSeverity`,
 * `hubHealthSeverity`, `RISK_BANDS`) and are never restated here — this file only maps the
 * name those modules return onto the rebuild's palette, because the legacy `--ua-*` custom
 * properties do not exist on Tailwind v4.
 *
 * Every mapping below is paired with a glyph or a word at the call site. Colour alone is
 * not a status (DESIGN.md), and a board that says "late" only in red says nothing at all to
 * a colour-blind viewer or in a greyscale screenshot.
 */

import { OTP_SEVERITY_LABEL, otpSeverity } from '@/lib/schedule-row-model.js';
import { SEV_TEXT } from '../../shell/Status';

/** `delayColorVar()` output → text class. Its 15 / 60-minute thresholds stay in the lib. */
export function delayToneClass(colorVar: string): string {
  if (colorVar.includes('red')) return 'text-red-400';
  if (colorVar.includes('yellow')) return 'text-amber-400';
  return 'text-emerald-400';
}

/** `RISK_BANDS` label → badge classes. */
export function riskToneClass(label: string): string {
  if (label === 'V.HIGH' || label === 'HIGH') return 'border-red-500/40 bg-red-500/15 text-red-400';
  if (label === 'MOD') return 'border-amber-500/40 bg-amber-500/15 text-amber-400';
  return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400';
}

/** `describeBoardCondition().tone` → alert classes. */
export const BANNER_TONE: Record<string, string> = {
  stale: 'border-red-500/40 bg-red-500/10 text-red-400',
  aging: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  degraded: 'border-teal-500/40 bg-teal-500/10 text-teal-300',
  partial: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  muted: 'border-border bg-muted/40 text-muted-foreground',
};

/** `classifySchedStatus().cls` → text class for the status chip. */
export const STATUS_TONE: Record<string, string> = {
  scheduled: 'text-muted-foreground',
  estimated: 'text-sky-400',
  delayed: 'text-amber-400',
  departed: 'text-emerald-400',
  enroute: 'text-emerald-400',
  landed: 'text-emerald-400',
  canceled: 'text-red-400',
  warn: 'text-amber-400',
  diverted: 'text-amber-400',
  unknown: 'text-muted-foreground',
};

/** Equipment-swap impact class → chip classes. */
export const SWAP_TONE: Record<string, string> = {
  downgrade: 'border-red-500/40 bg-red-500/15 text-red-400',
  upgrade: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
  lateral: 'border-border bg-muted/60 text-muted-foreground',
};

/**
 * The on-time percentage card. The ≥70 / ≥50 thresholds and the words live in
 * `schedule-row-model.js` with a test; this only maps the severity name onto the palette.
 */
export function otpTone(pct: number | null): { className: string; label: string } {
  const severity = otpSeverity(pct) as 'green' | 'amber' | 'red' | null;
  if (!severity) return { className: 'text-muted-foreground', label: 'no reading' };
  return { className: SEV_TEXT[severity], label: OTP_SEVERITY_LABEL[severity] };
}
