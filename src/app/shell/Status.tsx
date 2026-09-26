/**
 * Shared status glyphs.
 *
 * The rule this file exists to enforce: status is NEVER conveyed by colour alone. Every
 * green/amber/red in the dashboard ships with a glyph or a text label, so the hub strip
 * reads the same to a colour-blind viewer, in a screenshot, or through a screen reader.
 *
 * An active FAA program gets the stronger glyph (⛔ / ⚠) precisely so a low on-time
 * percentage and a ground stop never look like the same thing.
 */

import { cn } from '@/lib/utils';

export type Severity = 'green' | 'amber' | 'red';

export const SEV_TEXT: Record<Severity, string> = {
  green: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
};

const SEV_GLYPH: Record<Severity, string> = { green: '●', amber: '▲', red: '■' };

export function SeverityGlyph({
  severity,
  program,
  className,
}: {
  severity: Severity | null;
  /** An FAA marker ('⛔' / '⚠') when a program is active at this airport. */
  program?: string | null;
  className?: string;
}) {
  if (program) {
    return (
      <span aria-hidden="true" className={cn('shrink-0', className)}>
        {program}
      </span>
    );
  }
  if (!severity) {
    return (
      <span aria-hidden="true" className={cn('shrink-0 text-muted-foreground', className)}>
        ○
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn('shrink-0', SEV_TEXT[severity], className)}>
      {SEV_GLYPH[severity]}
    </span>
  );
}
