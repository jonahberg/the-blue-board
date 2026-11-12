/**
 * A dotted-underline term with a plain-English explanation (inventory §17).
 *
 * "IROPS", "METAR", "GDP" and "Ground Stop" are the vocabulary of an airline operations
 * centre, not of someone checking whether their flight will go. The term still reads as the
 * jargon — a traveller who hears "ground stop" from a gate agent has to be able to match it
 * — with the explanation one hover, one Tab or one tap away. The same component carries the
 * board's other explanations (the on-time rule, what "Canceled" counts, the presumed chip),
 * which were `title=` attributes a touch screen can never show (Nov 2026).
 *
 * How it opens depends on the pointer, not the width (an iPad at 1024 px is a touch screen):
 *  - a mouse (`pointer: fine`) gets the hover/focus `Tooltip`, as before;
 *  - a coarse pointer gets a `Popover`: a tap opens it, a second tap, a tap outside or Escape
 *    closes it, and it stays put while the page scrolls (a tooltip closes on scroll). Focus
 *    stays on the term, so opening it never draws a ring around the bubble.
 * Never a hand-rolled overlay (DESIGN.md): both are the shadcn primitives.
 *
 * Callers gate glossary terms to the FIRST occurrence per panel; the shipped helper did the
 * same, and for the same reason: seven dotted underlines down one column of hub cards is
 * noise, one is a glossary. `assignJargonFirsts()` in `src/lib/weather-cards.js` does that
 * gating as a pure fold, so re-rendering can never move a tooltip to a different card.
 *
 * Keyboard reachable by construction: the trigger is a real `<button>`, in the tab order; with
 * a mouse its tooltip is wired by `aria-describedby`, on touch the popover by `aria-expanded`.
 */

import { useId } from 'react';
import type { ReactNode } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '../state/hooks';

/** From `src/dashboard/main.js:41-49`; `otp` now names the same operated-departures rule as the hub strip. */
export const JARGON_TERMS: Record<string, string> = {
  irops: 'Irregular operations — cancellations, major delays, diversions',
  otp: '% of operated departures within 30 min of schedule',
  metar: 'standard aviation weather report',
  gdp: 'Ground Delay Program — FAA slows arrivals to manage congestion',
  groundstop: 'FAA order halting departures to this airport',
  equipment: 'aircraft type',
  tail: "aircraft's unique ID, like a license plate",
};

/** The term's button: 44 px tall on touch (DESIGN.md touch floor; audit F70), the text height with a mouse. */
const TRIGGER =
  'inline-flex min-h-11 cursor-help items-center underline decoration-dotted decoration-from-font underline-offset-2 pointer-fine:md:min-h-0';

export type JargonTermProps = {
  /** A key of `JARGON_TERMS`. An unknown key with no `description` renders the label alone. */
  term?: string;
  /** The explanation, when it is not a glossary entry (it wins over `term`). */
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function JargonTerm({ term, description, children, className }: JargonTermProps) {
  const text = description ?? (term ? JARGON_TERMS[term] : undefined);
  const coarse = useMediaQuery('(pointer: coarse)');
  const id = useId();
  if (!text) return <>{children}</>;

  if (coarse) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" id={id} className={cn(TRIGGER, className)}>
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          aria-labelledby={id}
          // Keep focus on the term: the bubble has nothing to operate, and focusing it after a
          // tap would ring it. Escape and a tap outside still close it.
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="w-auto max-w-[min(280px,80vw)] p-2.5 text-xs leading-snug font-normal tracking-normal normal-case"
        >
          {text}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn(TRIGGER, className)}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[min(280px,70vw)]">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export default JargonTerm;
