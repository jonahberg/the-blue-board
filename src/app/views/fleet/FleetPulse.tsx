/**
 * Zone 1, left — "how much of the fleet is in the air right now?" (inventory §21).
 *
 * The subtitle's "N mainline matched · N not in fleet DB · N regional/partner" is the honest
 * footnote under the airborne count: the feed carries every United-coded flight, but only
 * mainline airframes are in the fleet database, so what is flying splits three ways. A
 * mainline type under a UAL callsign that the database cannot match is a delivery newer than
 * the database — calling it "regional/partner" was a false claim (F86). The utilisation line
 * is `fleetUtilization()`, the same figure the Live bar and the Stats card quote.
 *
 * Per-type bars are drawn only for types with at least one aircraft airborne — nineteen rows
 * of "0/76 0%" at 04:00 UTC is a table of zeroes, not a pulse.
 *
 * Links everywhere (Nov 12 2026). The airborne figure and the utilization line summarize the
 * aircraft flying now, so each is a button that opens the Airborne Now list below (ruling 7,
 * `onShowAirborne`), named by its words plus "show the Airborne Now list". The utilization's
 * "m" is exactly that list; the big figure also counts regional and partner flights, which the
 * list (mainline only) does not, so its name promises the list, not a count. Each type label is
 * a quiet link to this tab filtered to that type (`fleetTypeCodeFor`: the rows are fleet
 * database types), 44 px tall on touch, so on a touch screen the rows are 44 px apart. This block
 * is not a live region, so its counts may be controls.
 */

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { fleetTypeCodeFor } from '@/lib/fleet-type-link.js';
import { TypeLink } from '../../features/EntityLinks';

/** A count that opens the Airborne Now list: its look at rest, the hero buttons' hover and focus. */
const PRESS =
  'rounded-md text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export type TypeUtilisation = { type: string; flying: number; total: number; pct: number };

export function FleetPulse({
  airborne,
  matched,
  notInDb,
  regional,
  fleetTotal,
  utilPct,
  utilisation,
  updatedAt,
  loading,
  fleetFailed = false,
  onShowAirborne,
}: {
  airborne: number;
  /** Airborne flights that resolve to an airframe in the fleet database. */
  matched: number;
  /** Mainline types under a UAL callsign that the (stale) database does not list. */
  notInDb: number;
  /** Everything else unmatched: Express and partner flights. */
  regional: number;
  fleetTotal: number;
  /** `fleetUtilization().pct` — null until the fleet database loads. */
  utilPct: number | null;
  utilisation: TypeUtilisation[];
  /** `HH:MM:SS` in UTC, or null before the first poll. */
  updatedAt: string | null;
  loading: boolean;
  /** True when `/data/fleet.json` failed: the airborne count still stands, the split cannot. */
  fleetFailed?: boolean;
  /** Opens the Airborne Now list. Without it (or before the database can list anything) the counts are text. */
  onShowAirborne?: () => void;
}) {
  const flying = utilisation.filter((row) => row.total > 0 && row.flying > 0);
  // The list can show aircraft only once the fleet database has loaded.
  const canShow = Boolean(onShowAirborne) && !fleetFailed && fleetTotal > 0 && airborne > 0;
  const figure = (
    <>
      <span className="font-mono text-5xl font-semibold tabular-nums" id="fleet-airborne-count">
        {loading && !airborne ? <Skeleton className="inline-block h-10 w-24 align-middle" /> : airborne}
      </span>{' '}
      {/* The label style of "Total Mainline Aircraft" beside it, so the card's two headline
          figures are labelled alike. The space keeps "3 Airborne" two words in the button's name;
          between flex items it draws nothing. */}
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Airborne</span>
    </>
  );

  return (
    <div className="flex min-w-0 flex-col">
      {canShow ? (
        <button type="button" onClick={onShowAirborne} className={`-mx-1 flex items-baseline gap-3 self-start px-1 ${PRESS}`}>
          {figure}
          <span className="sr-only">: show the Airborne Now list</span>
        </button>
      ) : (
        <div className="flex items-baseline gap-3">{figure}</div>
      )}

      {/* Without the fleet database every flight is UNMATCHED, not regional — calling 348
          aircraft "regional/partner" because we cannot look them up is the same class of
          false claim as reporting "0 aircraft" for a file that failed to load. */}
      <p className="mt-1 text-xs text-muted-foreground">
        {!airborne
          ? 'Loading live flight data…'
          : fleetFailed
            ? 'Mainline / regional split unavailable — the fleet database did not load'
            : `${matched} mainline matched · ${notInDb ? `${notInDb} not in fleet DB · ` : ''}${regional} regional/partner`}
      </p>

      {fleetTotal > 0 && airborne > 0 && utilPct != null ? (
        canShow ? (
          <button
            type="button"
            onClick={onShowAirborne}
            className={`-mx-1 mt-0.5 inline-flex min-h-11 items-center self-start px-1 text-xs font-medium text-foreground pointer-fine:md:min-h-0 ${PRESS}`}
          >
            <span>
              {utilPct}% fleet utilization ({matched}/{fleetTotal})
            </span>
            <span className="sr-only">: show the Airborne Now list</span>
          </button>
        ) : (
          <p className="mt-0.5 text-xs font-medium text-foreground">
            {utilPct}% fleet utilization ({matched}/{fleetTotal})
          </p>
        )
      ) : null}

      {flying.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {flying.map((row) => (
            <li key={row.type} className="flex items-center gap-2 text-[11px]">
              {/* No `truncate` here: its clip would cut the link's focus ring, and the longest type
                  ("737-900ER", nine characters) fits the column. */}
              <span className="w-20 shrink-0 whitespace-nowrap font-mono text-muted-foreground">
                <TypeLink typeCode={fleetTypeCodeFor({ typeText: row.type })} hit="inline">
                  {row.type}
                </TypeLink>
              </span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${row.pct}%` }}
                />
              </span>
              <span className="w-20 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                {row.flying}/{row.total} {row.pct}%
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {updatedAt ? (
        <p className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="gap-1 text-[10px]">
            <span
              aria-hidden="true"
              className="inline-block size-1.5 animate-pulse rounded-full bg-bb-ok"
            />
            LIVE
          </Badge>
          <span className="font-mono">Updated {updatedAt}Z</span>
        </p>
      ) : null}
    </div>
  );
}

export default FleetPulse;
