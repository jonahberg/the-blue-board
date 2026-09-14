/**
 * Status NAMES → token classes for the My Flights cards.
 *
 * The names come from `src/lib/my-flights.js`; this file only maps them onto the
 * rebuild's palette, exactly as `views/schedule/tone.ts` does for the board. No
 * threshold and no decision lives here.
 *
 * Every class below is applied to a chip that also SPELLS THE STATUS OUT. A card that
 * says "late" only in amber says nothing at all in greyscale or to a colour-blind
 * viewer (DESIGN.md).
 */

/** `myFlightStatusChip().tone` / `myFlightPendingChip().tone` → chip classes. */
export const MY_FLIGHT_STATUS_TONE: Record<string, string> = {
  cancelled: 'border-red-500/40 bg-red-500/15 text-red-400',
  diverted: 'border-orange-500/40 bg-orange-500/15 text-orange-400',
  landed: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
  enroute: 'border-primary/40 bg-primary/15 text-primary',
  departed: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
  delayed: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
  scheduled: 'border-primary/30 bg-primary/10 text-primary',
  unavailable: 'border-border bg-muted/60 text-muted-foreground',
};

/** `myFlightCountdown().tone` → text class for the countdown line. */
export const COUNTDOWN_TONE: Record<string, string> = {
  '': 'text-foreground',
  departed: 'text-emerald-400',
  landed: 'text-muted-foreground',
};

/** `journeyDelayClass()` → text class for a prior segment's delay figure. */
export const JOURNEY_DELAY_TONE: Record<string, string> = {
  '': 'text-muted-foreground',
  'on-time': 'text-emerald-400',
  minor: 'text-amber-400',
  major: 'text-red-400',
};

/** `starlinkPredictionBadge().tone` → badge classes. */
export const PREDICTION_TONE: Record<string, string> = {
  good: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
  warn: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
  muted: 'border-border bg-muted/60 text-muted-foreground',
};
