/**
 * "Cover a day" — the deep-use support ask, as a STRIP in the engagement slot (Nov 2026).
 *
 * It replaced the donation MODAL (`DonatePrompt.tsx`, Oct 2026). From Oct 6 that popup was shown
 * 417 times, tapped 7 times, and produced at most one donation. The owner approved retiring it.
 * The bets now are a concrete, finishable unit ($17 covers a day) and the
 * truth about today, at the moment the site has just been useful. So this is a quiet,
 * dismissible line below the board (DESIGN.md "Engagement surfaces stay quiet"). It never
 * covers the data and never waits to pounce. It just appears in the slot when the moment
 * comes, and it is first in the slot because on the visits it is the ask, it is the one line
 * the slot shows.
 *
 * What it keeps from the modal, so the history stays comparable:
 *   - the same moment: the deep-use trigger (`state/deep-use.ts`) and this visit's latched ask
 *     being 'donate' (`chooseDeepUseAsk`, still weighted 60/40 against the email ask);
 *   - one ask per visit, and the same quiet periods in the same key (`bb_donate_prompt`,
 *     src/lib/donate-prompt.js): 30 days after a dismiss, 90 after a tap on the button;
 *   - the same analytics: `donate_prompt` shown / donate / later, and the link's
 *     `data-support="deep-use-prompt"` counted as a `support_click` like every placement.
 *
 * Since Nov 22 2026 it may also come sooner than T1/T2 (`useSupportStripMoment`, rules in
 * src/lib/support-moment.js): two seconds after the second flight's panel is closed (two or
 * more distinct flights opened on this page load, none open now), or after 60 s on a visit that
 * arrived from a social post. The latch is rolled at that
 * moment, the same dice as ever; on a visit it picks the email ask or the email strip, nothing
 * shows early and those wait for T1/T2. Each `donate_prompt` event says which moment brought the
 * strip up: `trigger` is 'time', 'clicks', 'flights' or 'post', never a URL or a flight number.
 *
 * What it says comes from src/lib/cover-a-day.js and is true or absent. A payment covers the day
 * it is given, or the next open day after it, so the button names that day: "Cover today · $17"
 * when /api/support-status says today is open (for today's Central date), "Cover tomorrow · $17"
 * with a thank-you when today is covered and tomorrow is not, "Cover Nov 15 · $17" further out,
 * each to the fixed $17 link. "Help cover a day" (the any-amount link) and the core line when the
 * status is unknown. No strip at all while today and the next 14 days are covered. It may lead
 * with the visitor's own count of flights looked up this month (src/lib/usage-count.js), only from five up, never sent
 * anywhere, and never in an analytics property; on a phone that sentence then stands alone beside
 * the button, so the strip stays two lines. The dismiss control is a plain "Dismiss".
 *
 * This component also keeps that count: it is always mounted, so it watches the flight panel's
 * selection and adds one per new flight opened (the same flight twice in one page load is one).
 * The same page-load count is the second-flight moment above.
 *
 * No live region: a strip arriving below the board is not news (DESIGN.md's inventory).
 * `data-no-engagement` keeps its buttons from advancing the click counter that summoned it.
 */

import { HandHeart, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { coverButtonHref, supportStripCopy } from '@/lib/cover-a-day.js';
import { donatePromptRecord } from '@/lib/donate-prompt.js';
import { supportStripMayShow } from '@/lib/support-moment.js';
import { track } from '@/lib/track.js';
import { readFlightCount, recordFlightOpen } from '@/lib/usage-count.js';
import { deepUseAskThisVisit, useSupportStripMoment } from '../state/deep-use';
import { STORAGE_KEYS, safeLocalStorage, writeString } from '../state/storage';
import { useSupportStatus } from '../state/support-status';
import { useUi } from '../state/ui';

/** One key per flight, whichever way it was opened (a plane on the map, or a flight number). */
function flightKey(selection: ReturnType<typeof useUi>['selection']): string {
  if (!selection) return '';
  if (selection.kind === 'ident') return selection.ident.trim().toUpperCase();
  const { flightIATA, callsign, fr24id } = selection.flight;
  return String(flightIATA || callsign || fr24id || '').trim().toUpperCase();
}

/**
 * Add one to this month's count each time a flight not yet opened on this page load is opened.
 * Returns how many distinct flights this page load has opened, and whether one is open now.
 */
function useFlightOpenCount(): { distinct: number; open: boolean } {
  const { selection } = useUi();
  const key = flightKey(selection);
  const seen = useRef(new Set<string>());
  const [distinct, setDistinct] = useState(0);
  useEffect(() => {
    if (!key || seen.current.has(key)) return;
    seen.current.add(key);
    recordFlightOpen(safeLocalStorage());
    setDistinct(seen.current.size);
  }, [key]);
  return { distinct, open: selection !== null };
}

export default function SupportStrip() {
  const flights = useFlightOpenCount();
  const trigger = useSupportStripMoment(flights.distinct, flights.open);
  const [answered, setAnswered] = useState(false);

  // `trigger` first: the latch is decided when a moment fires, never before.
  const asking = trigger !== null && !answered && supportStripMayShow({ ask: deepUseAskThisVisit(), trigger });
  const status = useSupportStatus(asking);
  const copy = asking && status ? supportStripCopy(status, { flightsThisMonth: readFlightCount(safeLocalStorage()) }) : null;

  const shownTracked = useRef(false);
  useEffect(() => {
    if (!copy || !trigger || shownTracked.current) return;
    shownTracked.current = true;
    track('donate_prompt', { action: 'shown', trigger });
  }, [copy, trigger]);

  const answer = useCallback(
    (outcome: 'later' | 'donate') => {
      writeString(STORAGE_KEYS.donatePrompt, donatePromptRecord(outcome));
      track('donate_prompt', trigger ? { action: outcome, trigger } : { action: outcome });
      setAnswered(true);
    },
    [trigger],
  );

  if (!copy) return null;

  return (
    <div
      data-no-engagement
      className="flex min-h-10 shrink-0 items-center gap-2 border-t border-primary/40 bg-primary/10 px-3 py-1 text-xs"
    >
      <HandHeart aria-hidden="true" className="hidden size-4 shrink-0 text-primary sm:block" />
      <p className="min-w-0 flex-1 text-balance leading-snug">
        {copy.lead ? <span className="font-semibold">{copy.lead}</span> : null}
        {/* Phone: the count sentence alone when it leads, otherwise the short line. */}
        {copy.lead ? null : <span className="sm:hidden">{copy.short}</span>}
        <span className="hidden sm:inline">
          {copy.lead ? ' ' : ''}
          {copy.text}
        </span>
      </p>
      {/* 32 px buttons in a 40 px band; each keeps a 44 px hit area through its `after:` box. */}
      <Button
        asChild
        size="sm"
        className="relative h-8 shrink-0 px-3 text-xs after:absolute after:inset-x-0 after:-inset-y-1.5"
      >
        <a
          href={coverButtonHref(status, 'deep-use-prompt')}
          target="_blank"
          rel="noopener noreferrer"
          data-support="deep-use-prompt"
          onClick={() => answer('donate')}
        >
          {copy.button}
        </a>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dismiss"
        className="relative h-8 min-w-11 shrink-0 px-2 after:absolute after:inset-x-0 after:-inset-y-1.5"
        onClick={() => answer('later')}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
