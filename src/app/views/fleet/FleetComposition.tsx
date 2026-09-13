/**
 * Zone 2 — what United actually flies, grouped the way an airline thinks about it
 * (inventory §21, `FLEET_FAMILIES`).
 *
 * Families in `src/lib/fleet-utils.js` order, with the `WIDEBODY · POLARIS` rule dropped in
 * before the first widebody family: that line is the real division in the fleet — narrowbody
 * domestic metal on one side, the long-haul Polaris aircraft on the other — and the route
 * callouts ("EWR & IAD to Europe") say what each family is actually for.
 *
 * Every variant card is a toggle, not a link: `aria-pressed` and a second click clears it,
 * because the card IS the type filter for the table three zones down.
 */

import { FLEET_FAMILIES } from '@/lib/fleet-utils.js';

type Subgroup = { label: string | null; types: string[] };
type Family = {
  id: string;
  name: string;
  role: string;
  routeCallout?: string;
  widebody?: boolean;
  subgroups: Subgroup[];
};

export function FleetComposition({
  counts,
  activeType,
  onSelectType,
}: {
  counts: Record<string, number>;
  activeType: string;
  onSelectType: (type: string) => void;
}) {
  let dividerShown = false;

  return (
    <div className="space-y-4">
      {(FLEET_FAMILIES as Family[]).map((family) => {
        const showDivider = Boolean(family.widebody) && !dividerShown;
        if (showDivider) dividerShown = true;
        const familyTotal = family.subgroups.reduce(
          (sum, sg) => sum + sg.types.reduce((n, t) => n + (counts[t] || 0), 0),
          0,
        );

        return (
          <div key={family.id}>
            {showDivider ? (
              <div className="mb-3 flex items-center gap-2">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Widebody · Polaris
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}

            <section
              id={`family-${family.id}`}
              aria-label={`${family.name} family`}
              className="rounded-lg border bg-card p-3"
            >
              <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h4 className="text-sm font-semibold tracking-wide">{family.name}</h4>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {familyTotal} aircraft
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground">{family.role}</span>
              </header>

              {family.routeCallout ? (
                <p className="mt-0.5 font-mono text-[10px] text-primary">{family.routeCallout}</p>
              ) : null}

              <div className="mt-2 space-y-2">
                {family.subgroups.map((subgroup, index) => (
                  <div
                    key={subgroup.label ?? `sg-${index}`}
                    className={index > 0 ? 'border-t pt-2' : undefined}
                  >
                    {subgroup.label ? (
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {subgroup.label}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-1.5">
                      {subgroup.types.map((type) => {
                        const active = activeType === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onSelectType(type)}
                            className={`flex min-h-11 min-w-18 flex-col items-center justify-center rounded-md border px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0 ${
                              active
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'hover:bg-muted/60'
                            }`}
                          >
                            <span className="font-mono text-base font-semibold tabular-nums">
                              {counts[type] || 0}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{type}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}

export default FleetComposition;
