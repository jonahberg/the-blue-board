/**
 * A dotted-underline ops term with a plain-English one-liner (inventory §17).
 *
 * "IROPS", "METAR", "GDP" and "Ground Stop" are the vocabulary of an airline operations
 * centre, not of someone checking whether their flight will go. The term still reads as the
 * jargon — a traveller who hears "ground stop" from a gate agent has to be able to match it
 * — with the explanation one hover or one Tab away.
 *
 * Callers gate this to the FIRST occurrence of a term per panel; the shipped helper did the
 * same, and for the same reason: seven dotted underlines down one column of hub cards is
 * noise, one is a glossary. `assignJargonFirsts()` in `src/lib/weather-cards.js` does that
 * gating as a pure fold, so re-rendering can never move a tooltip to a different card.
 *
 * Keyboard reachable by construction: the trigger is a real `<button>`, so it is in the tab
 * order and `aria-describedby` wires the description to it for a screen reader.
 */

import type { ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Verbatim from `src/dashboard/main.js:41-49` — the wording is the shipped wording. */
export const JARGON_TERMS: Record<string, string> = {
  irops: 'Irregular operations — cancellations, major delays, diversions',
  otp: '% of departures within 30 min of schedule',
  metar: 'standard aviation weather report',
  gdp: 'Ground Delay Program — FAA slows arrivals to manage congestion',
  groundstop: 'FAA order halting departures to this airport',
  equipment: 'aircraft type',
  tail: "aircraft's unique ID, like a license plate",
};

export type JargonTermProps = {
  /** A key of `JARGON_TERMS`. An unknown key renders the label alone, never a bare tooltip. */
  term: string;
  children: ReactNode;
};

export function JargonTerm({ term, children }: JargonTermProps) {
  const description = JARGON_TERMS[term];
  if (!description) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-help underline decoration-dotted decoration-from-font underline-offset-2"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[min(280px,70vw)]">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

export default JargonTerm;
