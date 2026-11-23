/**
 * The Thanksgiving turkey behind the dashboard wordmark (DESIGN.md Decisions Log, 2026-11-22).
 * Rules and choreography in src/lib/holiday-egg.js; played by src/scripts/turkey-egg.ts, the same
 * code the content pages' header runs.
 *
 * Rendered inside the wordmark's `relative` span. `now` is the header's own clock, so a tab left
 * open across midnight gains the turkey at the start of the day and loses it at the end with no
 * timer of its own. On any other day, without `?gobble=1`, this renders nothing and runs nothing.
 */

import { memo, useEffect, useRef } from 'react';

import { gobblePreview, holidayEggOn } from '@/lib/holiday-egg.js';
import { mountTurkey } from '../../scripts/turkey-egg';

/** This page load's landing address, read for `?gobble=1`. */
function readPreview(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return gobblePreview({ search: window.location.search, hash: window.location.hash });
  } catch {
    return false;
  }
}

// Read when this module first loads, as state/deep-use.ts reads `arrivedFromPost`: the island's
// imports are evaluated before its first render, and that render is where the address starts being
// rewritten (`initialTab` in state/ui.tsx moves parameters out of the hash; the flight panel and the
// aircraft dialog replace the query).
let preview = readPreview();

/** Did this page load ask for the preview (`?gobble=1`)? */
export function gobblePreviewThisVisit(): boolean {
  return preview;
}

/** Tests only: read the address again. */
export function resetGobblePreview(): void {
  preview = readPreview();
}

export function TurkeyEgg({ now }: { now: number }) {
  return holidayEggOn(new Date(now), preview) ? <TurkeyBox /> : null;
}

/**
 * The clipping box. Memoised with no props, so the header's once-a-second render never touches it;
 * React owns the empty span, the script owns what goes inside it.
 */
const TurkeyBox = memo(function TurkeyBox() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    return el ? mountTurkey(el) : undefined;
  }, []);
  return <span ref={ref} className="bb-turkey" aria-hidden="true" data-turkey-egg="" />;
});
