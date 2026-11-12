/**
 * The Schedule board's one link to its hub's guide page ("ORD hub guide" → /hubs/ord).
 *
 * Inside the dashboard a hub code opens that hub's board (the hub strip, route ends), so the board
 * is where the guide is one step on: this is the door across to the content page. A plain `<a>`,
 * same tab, because it leaves the dashboard. Quiet, not link colour: the board's header is
 * controls, and nothing in it is the row's identity.
 *
 * Rendered once per layout: beside the hub selector in the desktop toolbar (`ScheduleControls`),
 * and on a phone, whose two toolbar rows are full, at the end of the meta line under the stat
 * strip (`ScheduleStats`). Nothing for "All hubs".
 */

import { hubLink } from '@/lib/hub-link.js';
import { cn } from '@/lib/utils';
import { LINK_HIT, LINK_TONE } from '../../features/link-style';
import type { LinkHit } from '../../features/link-style';

export function HubGuideLink({ hub, hit, className }: { hub: string; hit: LinkHit; className?: string }) {
  const link = hubLink(hub, 'site');
  if (!link) return null;
  return (
    <a href={link.href} className={cn(LINK_TONE.quiet, LINK_HIT[hit], 'whitespace-nowrap', className)}>
      {link.code} hub guide
    </a>
  );
}
