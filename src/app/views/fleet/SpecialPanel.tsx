/**
 * Zone 3, "Special" — the named aircraft and the special liveries (inventory §21).
 *
 * United names airframes after employees and paints a handful in commemorative schemes, and
 * the fleet site publishes both in one free-text column. This panel is the payoff for
 * `indexSpecialAircraft()` parsing it: a spotter's list of which of them exist and, crossed
 * against the live feed, which one is in the air right now.
 *
 * An airborne entry shows the pulse plus its flight and route; a grounded one shows NAMED or
 * LIVERY, so the badge always says which kind of special this is rather than only that it is
 * one.
 *
 * The curated paint schemes (`kind: 'paint'`, from src/data/special-liveries.js) lead the
 * list with their one-line description under the name. They are the hand-verified answer to
 * "which United jets wear a special livery?"; the fleet site's column carries no sources.
 *
 * Names with a home link to it (links everywhere, Nov 12 2026). The registration is the card's
 * link-coloured link, to the aircraft dialog in place; the type a quiet link to the Fleet tab
 * filtered to it, by the tail (the row model's `typeLink`; this panel is not filtered by type, so
 * no card's type is the list's own). An airborne card's flight number links to its flight page
 * when it is a United number, and each hub end of its route to that hub's Schedule board, both
 * quiet. The name, description and the NAMED / LIVERY / AIRBORNE chips have no home and stay plain.
 * A type followed in place opens All Aircraft filtered to it and brings the controls row into
 * view (`onTypeFollowed`), as a Composition variant card does.
 * The registration and type are 44 px tall on touch inside their line (`hit="inline"`); the
 * airborne line is 44 px tall on touch and spaces its number and hub ends so their 44 px touch
 * boxes never overlap (tight only for a mouse at `md`+).
 */

import { Paintbrush } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { HubLink, TailLink, TypeLink } from '../../features/EntityLinks';
import { FlightLink } from '../../features/FlightLink';
import { typeLinkFollowed } from './type-followed';

export type SpecialRow = {
  /** reg + kind: a tail with a name AND a livery (N76021) is two cards. */
  key: string;
  reg: string;
  name: string;
  /** 'paint' (curated livery) | 'named' | 'livery' (the fleet site's sticker/livery note). */
  kind: string;
  type: string;
  /** The type this card links to (`fleetRowTypeLink`), or null to print it plain. */
  typeLink: string | null;
  delivered: string;
  description?: string;
  airborne: { flight: string; route: string; origin: string; dest: string } | null;
};

export function SpecialPanel({
  rows,
  loading,
  onTypeFollowed,
}: {
  rows: SpecialRow[];
  loading: boolean;
  /** A card's type link was followed in place: bring the filtered list into view. */
  onTypeFollowed?: () => void;
}) {
  if (loading && !rows.length) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
        No special aircraft found
      </p>
    );
  }

  return (
    <div
      tabIndex={0}
      aria-label="Special fleet list, scrollable region"
      className="max-h-[60svh] overflow-auto rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" onClick={typeLinkFollowed(onTypeFollowed)}>
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3"
          >
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-1 text-sm font-medium">
                {row.kind === 'paint' ? (
                  <Paintbrush aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
                <span className="truncate">{row.name}</span>
              </p>
              {row.description ? (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{row.description}</p>
              ) : null}
              <p className="mt-0.5 text-xs">
                <TailLink reg={row.reg} hit="inline" className="font-mono" />{' '}
                <span className="text-muted-foreground">
                  {row.type ? (
                    <>
                      <TypeLink typeCode={row.typeLink} hit="inline">
                        {row.type}
                      </TypeLink>
                      {` · Del ${row.delivered}`}
                    </>
                  ) : (
                    'Not in the mainline fleet database'
                  )}
                </span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              {row.airborne ? (
                <>
                  <span className="inline-flex items-center gap-1 rounded border border-bb-ok/30 bg-bb-ok/10 px-1.5 py-0.5 text-[9px] font-medium text-bb-ok">
                    <span
                      aria-hidden="true"
                      className="inline-block size-1.5 animate-pulse rounded-full bg-bb-ok"
                    />
                    AIRBORNE
                  </span>
                  <p className="mt-1 flex min-h-11 flex-wrap items-center justify-end gap-x-7 font-mono text-[10px] text-muted-foreground pointer-fine:md:min-h-0 pointer-fine:md:gap-x-2">
                    <FlightLink ident={row.airborne.flight} tone="quiet" />
                    <span>
                      <HubLink code={row.airborne.origin} />
                      <span aria-hidden="true" className="mx-3 pointer-fine:md:mx-1">
                        &gt;
                      </span>
                      <span className="sr-only"> to </span>
                      <HubLink code={row.airborne.dest} />
                    </span>
                  </p>
                </>
              ) : (
                <span className="rounded border px-1.5 py-0.5 text-[9px] font-medium text-foreground">
                  {row.kind === 'named' ? 'NAMED' : 'LIVERY'}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SpecialPanel;
