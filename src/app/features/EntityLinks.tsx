/**
 * A printed name, linked to its home inside the dashboard, or plain text when it has none. The
 * rule for each kind is in src/lib; these only render it through `DashLink`, so a click lands in
 * place.
 *
 *  - `TailLink`: a US registration → its aircraft dialog (`tailLink`). Identity tone by default:
 *    on a roster or ledger row the tail is what the row is about.
 *  - `HubLink`: one of the nine hubs → its Schedule board (`hubLink(code, 'dashboard')`). Quiet.
 *  - `TypeLink`: a fleet database type code → the Fleet tab filtered to it
 *    (`fleetTypeLink(typeCode, 'dashboard')`). Quiet. The row prints its own type text
 *    (`children`); `typeCode` alone decides the link, so a row whose tracker says "737-900" links
 *    to the 737-900ER when the fleet database says so (`fleetTypeCodeForTail`).
 *
 * The plain-text rendering takes `className` only: nothing that is not a link carries link
 * colour or an underline.
 *
 * `finePointerOnly`: on a touch row that is already one tap target, only the row's identity link
 * is split out (the plan's Global Constraints). With a coarse pointer this link takes no taps and
 * looks like the text around it; it stays in the tab order, so a keyboard on a touch device can
 * still follow it.
 */

import type { ReactNode } from 'react';

import { fleetTypeLink } from '@/lib/fleet-type-link.js';
import { hubLink } from '@/lib/hub-link.js';
import { tailLink } from '@/lib/tail-link.js';
import { cn } from '@/lib/utils';
import { DashLink } from './DashLink';
import type { LinkHit, LinkTone } from './link-style';

const FINE_POINTER_ONLY = 'pointer-coarse:pointer-events-none pointer-coarse:no-underline pointer-coarse:text-inherit';

type EntityLinkProps = {
  tone?: LinkTone;
  hit?: LinkHit;
  /** Classes for both renderings (font, size, weight, `z-10` over a stretched row control). */
  className?: string;
  finePointerOnly?: boolean;
};

function linkClasses(finePointerOnly: boolean | undefined, className: string | undefined) {
  return cn(finePointerOnly && FINE_POINTER_ONLY, className);
}

export function TailLink({
  reg,
  tone = 'identity',
  hit,
  className,
  finePointerOnly,
  children,
}: EntityLinkProps & { reg: string; children?: ReactNode }) {
  const link = tailLink(reg);
  if (!link) return <span className={className}>{children ?? reg}</span>;
  return (
    <DashLink href={link.href} tone={tone} hit={hit} className={linkClasses(finePointerOnly, className)} data-tail-link={link.reg}>
      {children ?? reg}
    </DashLink>
  );
}

export function HubLink({ code, tone = 'quiet', hit, className, finePointerOnly }: EntityLinkProps & { code: string }) {
  const link = hubLink(code, 'dashboard');
  if (!link) return <span className={className}>{code}</span>;
  return (
    <DashLink href={link.href} tone={tone} hit={hit} className={linkClasses(finePointerOnly, className)} data-hub-link={link.code}>
      {code}
    </DashLink>
  );
}

export function TypeLink({
  typeCode,
  tone = 'quiet',
  hit,
  className,
  finePointerOnly,
  children,
}: EntityLinkProps & { typeCode: string | null | undefined; children?: ReactNode }) {
  const link = fleetTypeLink(typeCode, 'dashboard');
  if (!link) return <span className={className}>{children ?? typeCode}</span>;
  return (
    <DashLink href={link.href} tone={tone} hit={hit} className={linkClasses(finePointerOnly, className)} data-type-link={link.typeCode}>
      {children ?? typeCode}
    </DashLink>
  );
}
