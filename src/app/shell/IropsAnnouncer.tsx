/**
 * The page's single polite live region.
 *
 * Exactly one writer, by design (inventory §17). Several polite regions competing — a
 * rotating ticker, a stat bar, a search result count — produce continuous interruption for a
 * screen-reader user, so everything that genuinely needs announcing goes through
 * `useUi().announce()` and lands here.
 */

import { useUi } from '../state/ui';

export function IropsAnnouncer() {
  const { announcement } = useUi();
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );
}
