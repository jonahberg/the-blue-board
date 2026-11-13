/**
 * The rollout hero: one big number, the two fleet-rollout bars, and two chips
 * (inventory §22, `renderSlHero()`).
 *
 * The number is the served equipped count and nothing else. The verification figures sit
 * under it as a muted sub-line whose "disputed" half scrolls to the ledger. They come from a
 * DIFFERENT snapshot (the upstream verifier's roster, e.g. 606 planes against a 598 headline),
 * so the sub-line names its own denominator — "594 of 606 checked verified" — rather than
 * inviting the reader to read 594 as a share of the number above it (F99).
 *
 * The rollout bars are hidden whole in the degraded tier: the static fallback roster carries
 * no fleet denominators, so a percentage there would be a guess wearing a ruler. The Mainline
 * bar is the Fleet tab's `starlinkMainlineShare()`, and the line under the bars names each
 * bar's denominator (D15) — Mainline is our fleet database, Express the two-cabin regional jets
 * in the tracker's fleet-summary (`expressStarlinkScope()`). Without that summary the Express
 * row prints its equipped count and draws no bar: it has no denominator it may use.
 *
 * "● N AIRBORNE NOW" is a real button, not a decorated span — it navigates to the Live tab
 * with the Starlink map filter enabled, and only when that filter can actually be enabled.
 *
 * The bars and "+N NEW THIS WEEK" are buttons too (Nov 12 2026): each bar row shows that fleet in
 * the roster below, the chip turns the roster's "New this week" on, and both scroll to it. They
 * change this view and have no address, so they are buttons, not links. Without a handler they
 * stay the plain row and chip they were.
 */

import { memo } from 'react';

import { Card } from '@/components/ui/card';
import { rolloutBarFigure } from '@/lib/starlink-roster.js';

/** `total` and `pct` are null on a row with no denominator: it prints its count and no bar. */
export type RolloutBar = { label: string; installed: number; total: number | null; pct: number | null };

/** The roster's own fleet filter values (`filterRoster`), which are the bars' labels. */
export type RosterFleet = 'Mainline' | 'Express';

/**
 * One shape for all three chips. The airborne chip is a button and takes the 44 px touch floor,
 * so the plain chips take it too: a static span beside it stretched to the row's height with its
 * text pinned to the top (Nov 2026).
 */
const CHIP =
  'inline-flex min-h-11 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold pointer-fine:md:min-h-0';

/** The airborne chip's button treatment, shared by every button in the hero. */
const PRESS = 'hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * A bar row as a button: the row's look at rest, 44 px tall on a touch screen (the rows then sit
 * with no gap, so the bars move apart by only what the target needs), and the airborne chip's hover
 * and focus. It bleeds 0.5rem each side so the hover fill does not end at the label's first letter.
 */
const BAR_BUTTON = `relative -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left ${PRESS} group pointer-fine:md:min-h-0`;

/** Label, bar (when the row has a denominator) and figure; `named` adds the button's sr-only words. */
function BarRowContent({ bar, named }: { bar: RolloutBar; named: boolean }) {
  return (
    <>
      {named ? <span className="sr-only">Show</span> : null}
      {named ? ' ' : null}
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{bar.label}</span>
      {named ? ' ' : null}
      {named ? <span className="sr-only">aircraft in the roster below</span> : null}
      {named ? ' ' : null}
      {bar.pct != null && bar.total != null ? (
        // The track takes the card colour under the hover fill, which is the track's own colour.
        <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted group-hover:bg-card">
          <span
            className={`block h-full rounded-full ${bar.label === 'Express' ? 'bg-bb-ok' : 'bg-primary'}`}
            style={{ width: `${Math.max(0, Math.min(100, bar.pct))}%` }}
          />
        </span>
      ) : (
        // No denominator, no track: an empty track would read as 0%.
        <span aria-hidden="true" className="block min-w-0 flex-1" />
      )}
      <span className="w-28 shrink-0 text-right font-mono text-[11px] tabular-nums">
        {rolloutBarFigure(bar)}
      </span>
    </>
  );
}

export const SlHero = memo(function SlHero({
  equipped,
  bars,
  barsNote = '',
  newThisWeek,
  airborneCount,
  canFilterMap,
  verified,
  checked = null,
  disputed,
  onJumpToLedger,
  onShowOnMap,
  onShowFleet,
  onShowNew,
}: {
  equipped: number | null;
  bars: RolloutBar[] | null;
  /** `rolloutBarsNote()` — whose denominator each bar is. */
  barsNote?: string;
  newThisWeek: number;
  airborneCount: number;
  /** False in the degraded tier — the Live map's Starlink toggle is disabled there. */
  canFilterMap: boolean;
  verified: number | null;
  /** The verifier's own roster size (`summary.totalPlanes`) — the sub-line's denominator. */
  checked?: number | null;
  disputed: number | null;
  onJumpToLedger: () => void;
  onShowOnMap: () => void;
  /** A bar row's click: show that fleet in the roster below. */
  onShowFleet?: (fleet: RosterFleet) => void;
  /** The "+N NEW THIS WEEK" chip's click: show the new aircraft in the roster below. */
  onShowNew?: () => void;
}) {
  return (
    <Card className="gap-0 p-4">
      <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        Starlink Rollout
      </p>

      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-12">
        <div className="shrink-0">
          <p className="font-mono text-5xl leading-none font-bold tabular-nums" id="sl-hero-count">
            {equipped ?? '—'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Aircraft Equipped</p>
          {verified != null ? (
            <p className="mt-1 text-[11px] text-muted-foreground" id="sl-hero-verify-sub">
              {checked != null ? `${verified} of ${checked} checked verified` : `${verified} verified`} ·{' '}
              <button
                type="button"
                data-action="sl-jump-verify"
                onClick={onJumpToLedger}
                // Padding, not min-height: this is an inline link inside an 11 px sentence, so
                // the touch target is grown vertically and pulled back out of the flow, which
                // buys the 44 px without moving the line it sits in.
                className="-my-3.5 py-3.5 underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:my-0 md:py-0"
                title="Jump to the verification ledger"
              >
                {disputed ?? 0} disputed
              </button>
            </p>
          ) : null}
        </div>

        {bars ? (
          <div
            className={`w-full max-w-md lg:max-w-2xl lg:flex-1 ${onShowFleet ? 'pointer-fine:md:space-y-2' : 'space-y-2'}`}
            id="sl-bars"
          >
            {bars.map((bar) =>
              onShowFleet ? (
                <button
                  key={bar.label}
                  type="button"
                  data-bar={bar.label}
                  onClick={() => onShowFleet(bar.label as RosterFleet)}
                  className={BAR_BUTTON}
                >
                  <BarRowContent bar={bar} named />
                </button>
              ) : (
                <div key={bar.label} className="flex items-center gap-2" data-bar={bar.label}>
                  <BarRowContent bar={bar} named={false} />
                </div>
              ),
            )}
            {barsNote ? (
              <p className="text-[11px] text-muted-foreground" id="sl-bars-note">
                {barsNote}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {newThisWeek > 0 || airborneCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" id="sl-hero-chips">
          {newThisWeek > 0 ? (
            onShowNew ? (
              <button
                type="button"
                data-action="sl-show-new"
                onClick={onShowNew}
                className={`${CHIP} relative ${PRESS}`}
                title="Show these in the roster below"
              >
                {/* Named like the airborne chip: its own words plus sr-only ones. */}
                <span className="sr-only">Show</span>{' '}
                <span className="font-mono tabular-nums">+{newThisWeek}</span>{' '}
                <span className="uppercase">New this week</span>{' '}
                <span className="sr-only">aircraft in the roster below</span>
              </button>
            ) : (
              <span className={CHIP}>
                <span className="font-mono tabular-nums">+{newThisWeek}</span>
                <span>NEW THIS WEEK</span>
              </span>
            )
          ) : null}
          {airborneCount > 0 ? (
            canFilterMap ? (
              <button
                type="button"
                data-action="view-starlink-on-map"
                onClick={onShowOnMap}
                // `relative` holds its sr-only words inside it.
                className={`${CHIP} relative ${PRESS}`}
                title="Show these on the live map"
              >
                {/* Named by its own words plus sr-only ones (WCAG 2.5.3): the aria-label it had
                    ("Show 298 airborne Starlink aircraft…") did not contain "airborne now". The
                    capitals are CSS, so the name reads as words. */}
                <span aria-hidden="true" className="size-1.5 rounded-full bg-bb-ok" />
                <span className="sr-only">Show</span>{' '}
                <span className="font-mono tabular-nums">{airborneCount}</span>{' '}
                <span className="uppercase">Airborne now</span>{' '}
                <span className="sr-only">Starlink aircraft on the live map</span>
              </button>
            ) : (
              // Degraded tier: the Live map's Starlink toggle is disabled, so a click-through
              // would land on a map with nothing filtered. State the count, offer no journey.
              <span className={CHIP}>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-bb-ok" />
                <span className="font-mono tabular-nums">{airborneCount}</span>
                <span>AIRBORNE NOW</span>
              </span>
            )
          ) : null}
        </div>
      ) : null}
    </Card>
  );
});

export default SlHero;
