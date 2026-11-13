/**
 * A printed flight number: a link to its flight page (/flight/UA576) when it has one, plain body
 * text when it does not (`flightLink()` in src/lib/flight-link.js decides).
 *
 * Link colour means link. The Schedule board printed "UA576" in `text-primary` as a plain cell;
 * the owner clicked it expecting the flight page and nothing happened (Nov 2026). So a flight
 * number is either a real `<a href>` — same tab, the global focus ring, middle-click and "copy
 * link" for free — or it is body text.
 *
 * `tone` (link-style.ts): `identity` (default) where the number is what the row is about, `quiet`
 * where it is a second name in a row about something else ("inbound on UA3508").
 *
 * `hit` is the touch target: `box` (default), `inline` or `none`, as described in link-style.ts.
 */

import type { ReactNode } from 'react';

import { flightLink } from '@/lib/flight-link.js';
import { cn } from '@/lib/utils';
import { LINK_HIT, LINK_TONE } from './link-style';
import type { LinkHit, LinkTone } from './link-style';

export type FlightLinkProps = {
  /** The flight number exactly as it is printed. */
  ident: string;
  /** Classes for both renderings (font, size, weight). */
  className?: string;
  /** Classes for the link only. */
  linkClassName?: string;
  tone?: LinkTone;
  hit?: LinkHit;
  /** Printed instead of `ident` (rare: the ident still decides the link). */
  children?: ReactNode;
};

export function FlightLink({ ident, className, linkClassName, tone = 'identity', hit = 'box', children }: FlightLinkProps) {
  const link = flightLink(ident);
  if (!link) return <span className={className}>{children ?? ident}</span>;
  return (
    <a
      href={link.href}
      data-flight-link={link.ident}
      className={cn(LINK_TONE[tone], LINK_HIT[hit], className, linkClassName)}
    >
      {children ?? ident}
    </a>
  );
}

export default FlightLink;
