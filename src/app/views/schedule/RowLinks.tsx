/**
 * The names in a Schedule row that link (links everywhere, part 2), shared by the desktop table
 * (`ScheduleTable`) and the phone row (`SchedulePhoneRow`). The row model decides what links
 * (`buildScheduleRow`: `routeEnds`, `faaParts`, `starlinkHref`); these only render it.
 *
 * Every link here is quiet (body colour, quiet underline): the flight number is the row's one blue
 * link. With `finePointerOnly` (the phone row, which is one tap target) each takes no taps on a
 * coarse pointer and sits above the row's stretched button for a mouse (`z-10`), as the Starlink
 * departures board's hub and type links do (the links plan, ruling 3).
 */

import { Zap } from 'lucide-react';
import { Fragment } from 'react';

import { cn } from '@/lib/utils';
import { DashLink } from '../../features/DashLink';
import { HubLink, HubStatusLink } from '../../features/EntityLinks';
import type { LinkHit } from '../../features/link-style';
import type { FaaPart, RouteEnd } from './useBoardModel';

/**
 * `finePointerOnly` for a link built on `DashLink`, which has no such prop: the classes the
 * per-kind links in features/EntityLinks.tsx apply (not exported there), so a Starlink link in a
 * phone row behaves exactly like the hub, tail and type links beside it. Used with `hit="none"`.
 */
export const FINE_POINTER_ONLY = 'relative pointer-coarse:pointer-events-none pointer-coarse:no-underline pointer-coarse:text-inherit';

/** Above a row's stretched button, for a mouse (the row's own tap target on touch). */
const ABOVE_ROW = 'z-10';

function End({ end, finePointerOnly }: { end: RouteEnd; finePointerOnly: boolean }) {
  if (!end.hub) return <>{end.text}</>;
  return <HubLink code={end.hub} finePointerOnly={finePointerOnly} className={finePointerOnly ? ABOVE_ROW : undefined} />;
}

/** "ORD → DEN": the board's hub plain, the other end a link to its board when it is a hub. */
export function RouteEnds({
  ends,
  className,
  finePointerOnly = false,
}: {
  ends: { from: RouteEnd; to: RouteEnd };
  className?: string;
  finePointerOnly?: boolean;
}) {
  return (
    <span className={className}>
      <End end={ends.from} finePointerOnly={finePointerOnly} />
      {' → '}
      <End end={ends.to} finePointerOnly={finePointerOnly} />
    </span>
  );
}

/**
 * The type link's destination, for a screen reader: " (737-900ER in the fleet)" after the printed
 * text. The row prints the feed's words (B739, "A321 NEO") and the TAIL decides the link, so the
 * link's name says which fleet type it opens. sr-only words, never an `aria-label` over different
 * text (DESIGN.md 2026-11-11). Nothing when the type does not link.
 */
export function FleetTypeWords({ typeCode }: { typeCode: string | null }) {
  if (!typeCode) return null;
  // The space outside the hidden span, as the hub strip's "(schedule board)" words have it.
  return (
    <>
      {' '}
      <span className="sr-only" data-type-destination="">
        ({typeCode} in the fleet)
      </span>
    </>
  );
}

/**
 * "Ground Stop at EWR, avg 45 min · GDP at LGA": each airport code links to where its status is
 * shown, a hub's Weather card or the NAS status panel (`HubStatusLink`); the words stay text.
 */
export function FaaLine({ parts, finePointerOnly = false }: { parts: FaaPart[]; finePointerOnly?: boolean }) {
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={`${part.code}-${i}`}>
          {i > 0 ? ' · ' : null}
          {part.lead}
          <HubStatusLink
            code={part.code}
            kind={part.kind}
            finePointerOnly={finePointerOnly}
            className={finePointerOnly ? ABOVE_ROW : undefined}
          />
          {part.tail}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The row's ⚡ Starlink mark as a link to the Starlink tab. Quiet, so it takes the violet of the
 * span it sits in (Starlink as a fact is `bb-starlink`, DESIGN.md 2026-11-11). `hit` is the
 * caller's (the desktop table picks it by where the link sits on its line); with
 * `finePointerOnly` it has none.
 */
export function StarlinkLink({
  href,
  label,
  hit = 'inline',
  finePointerOnly = false,
  iconClassName,
  className,
}: {
  href: string;
  label: string;
  hit?: LinkHit;
  finePointerOnly?: boolean;
  iconClassName: string;
  className?: string;
}) {
  return (
    <DashLink
      href={href}
      tone="quiet"
      hit={finePointerOnly ? 'none' : hit}
      className={cn(finePointerOnly && FINE_POINTER_ONLY, finePointerOnly && ABOVE_ROW, className)}
    >
      <Zap aria-hidden="true" className={iconClassName} />
      {label}
    </DashLink>
  );
}
