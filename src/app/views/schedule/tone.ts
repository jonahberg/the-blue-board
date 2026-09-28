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
  if (colorVar.includes('red')) return 'text-destructive';
  if (colorVar.includes('yellow')) return 'text-bb-warn';
  return 'text-bb-ok';
}

/** `RISK_BANDS` label → badge classes. */
export function riskToneClass(label: string): string {
  if (label === 'V.HIGH' || label === 'HIGH') return 'border-destructive/40 bg-destructive/15 text-destructive';
  if (label === 'MOD') return 'border-bb-warn/40 bg-bb-warn/15 text-bb-warn';
  return 'border-bb-ok/40 bg-bb-ok/15 text-bb-ok';
}

/** `describeBoardCondition().tone` → alert classes. */
export const BANNER_TONE: Record<string, string> = {
  stale: 'border-destructive/40 bg-destructive/10 text-destructive',
  aging: 'border-bb-warn/40 bg-bb-warn/10 text-bb-warn',
  degraded: 'border-bb-info/40 bg-bb-info/10 text-bb-info',
  partial: 'border-bb-warn/40 bg-bb-warn/10 text-bb-warn',
  muted: 'border-border bg-muted/40 text-muted-foreground',
};

/** `classifySchedStatus().cls` → text class for the status chip. */
export const STATUS_TONE: Record<string, string> = {
  scheduled: 'text-muted-foreground',
  estimated: 'text-bb-info',
  delayed: 'text-bb-warn',
  departed: 'text-bb-ok',
  enroute: 'text-bb-ok',
  landed: 'text-bb-ok',
  canceled: 'text-destructive',
  warn: 'text-bb-warn',
  diverted: 'text-bb-warn',
  unknown: 'text-muted-foreground',
};

/** Equipment-swap impact class → chip classes. */
export const SWAP_TONE: Record<string, string> = {
  downgrade: 'border-destructive/40 bg-destructive/15 text-destructive',
  upgrade: 'border-bb-ok/40 bg-bb-ok/15 text-bb-ok',
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
