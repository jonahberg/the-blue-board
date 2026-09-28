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
  cancelled: 'border-destructive/40 bg-destructive/15 text-destructive',
  diverted: 'border-bb-warn/40 bg-bb-warn/15 text-bb-warn',
  landed: 'border-bb-ok/40 bg-bb-ok/15 text-bb-ok',
  enroute: 'border-primary/40 bg-primary/15 text-primary',
  departed: 'border-bb-ok/40 bg-bb-ok/15 text-bb-ok',
  delayed: 'border-bb-warn/40 bg-bb-warn/15 text-bb-warn',
  scheduled: 'border-primary/30 bg-primary/10 text-primary',
  unavailable: 'border-border bg-muted/60 text-muted-foreground',
};

/** `myFlightCountdown().tone` → text class for the countdown line. */
export const COUNTDOWN_TONE: Record<string, string> = {
  '': 'text-foreground',
  departed: 'text-bb-ok',
  landed: 'text-muted-foreground',
};

/** `journeyDelayClass()` → text class for a prior segment's delay figure. */
export const JOURNEY_DELAY_TONE: Record<string, string> = {
  '': 'text-muted-foreground',
  'on-time': 'text-bb-ok',
  minor: 'text-bb-warn',
  major: 'text-destructive',
};

/** `starlinkPredictionBadge().tone` → badge classes. */
export const PREDICTION_TONE: Record<string, string> = {
  good: 'border-bb-ok/40 bg-bb-ok/15 text-bb-ok',
  warn: 'border-bb-warn/40 bg-bb-warn/15 text-bb-warn',
  muted: 'border-border bg-muted/60 text-muted-foreground',
};
