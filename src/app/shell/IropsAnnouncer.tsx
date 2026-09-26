/**
 * The page's single polite live region.
 *
 * Exactly one writer, by design (inventory §17). Several polite regions competing — a
 * rotating ticker, a stat bar, a search result count — produce continuous interruption for a
 * screen-reader user, so everything that genuinely needs announcing goes through
 * `useUi().announce()` and lands here.
 */

import { useEffect, useRef } from 'react';

import { iropsScoreLabel } from '@/lib/irops-score.js';
import { useIrops } from '../state/irops';
import { useUi } from '../state/ui';

export function IropsAnnouncer() {
  const { announcement, announce } = useUi();
  const { score } = useIrops();

  // `announceIropsLevelChange`, and it lives HERE rather than in the Weather tab because
  // this component is mounted on every page while that tab is not. The shipped writer ran
  // from the idle preload, so a screen-reader user parked on Live Ops still heard the
  // network flip into significant disruption; a writer that only exists once someone has
  // opened Weather would silently drop exactly the announcement worth making.
  //
  // `score` is the server value when there is one and the client fallback's otherwise, so
  // both IROPS paths announce through this one region without either knowing about it.
  const lastLabel = useRef<string | null>(null);
  useEffect(() => {
    if (score === null || score === undefined) return;
    const label = iropsScoreLabel(score) as string;
    // Skip the FIRST label: an opening reading is not a change, and announcing it would
    // speak over the page load.
    if (lastLabel.current !== null && lastLabel.current !== label) {
      announce(`Operations status changed: ${label.toLowerCase()}`);
    }
    lastLabel.current = label;
  }, [score, announce]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );
}
