/**
 * The "SL" mark on a Fleet table row (All Aircraft, Airborne Now): this aircraft carries Starlink.
 * A quiet link to the Starlink tab, where the rollout and the roster are (spec: a Starlink badge on
 * a row goes to the Starlink tab); one per row, followed in place.
 *
 * The anchor carries the touch target (44 px both ways on touch, relaxed for a mouse at `md`+) and
 * the violet chip sits inside it, so the chip keeps its size and nothing reaches past the cell: a
 * 44 px `after:` box around a 16 px chip would be clipped at the table's right edge, where this
 * column sits. The row is already 44 px tall on touch (its tail link), so the anchor adds no height.
 *
 * Named by its visible "SL" and the sr-only words, never an aria-label over different text
 * (DESIGN.md 2026-11-11).
 */

import { STARLINK_TAB_HREF } from '@/lib/starlink-link.js';
import { DashLink } from '../../features/DashLink';

export function StarlinkRowChip() {
  return (
    <DashLink
      href={STARLINK_TAB_HREF}
      hit="none"
      title="Starlink-equipped · open the Starlink tab"
      className="inline-flex min-h-11 min-w-11 items-center justify-center pointer-fine:md:min-h-0 pointer-fine:md:min-w-0"
      data-starlink-chip=""
    >
      <span className="rounded border border-bb-starlink/30 bg-bb-starlink/10 px-1 py-0.5 text-[9px] font-medium text-bb-starlink">
        SL
      </span>{' '}
      <span className="sr-only">(Starlink tab)</span>
    </DashLink>
  );
}

export default StarlinkRowChip;
