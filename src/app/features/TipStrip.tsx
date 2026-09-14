/**
 * The rotating one-liner under the header (inventory §8).
 *
 * Tips are per-tab, so the hint a visitor gets is about the thing in front of them; tabs
 * with no tips of their own fall back to the Live pool. The copy, the pick rule and the
 * two timings live in `src/lib/tips.js`.
 *
 * Three behaviours worth keeping straight:
 *   - it appears two seconds after load, not immediately, so it does not compete with the
 *     first paint of the map;
 *   - it re-picks shortly after a tab change, because the tip for the tab you just left is
 *     no longer advice;
 *   - dismissing it is worth seven days. This is a hint bar. If someone has said no once,
 *     asking again on the next page view is nagging.
 *
 * In flow rather than fixed: the legacy capsule was pinned at `top:80px` and every sibling
 * offset in the stylesheet had to be recomputed when it showed or hid (`style.css:913-918`).
 */

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { TIP_DISMISS_DAYS, TIP_ROTATE_MS, pickTip } from '@/lib/tips.js';
import { STORAGE_KEYS, readString, writeString } from '../state/storage';
import { useUi } from '../state/ui';

/** How long the strip waits before its first appearance — `main.js:7790`. */
const START_DELAY_MS = 2000;
/** How long after a tab change the new tab's tip arrives — `main.js:7773`. */
const TAB_SWITCH_DELAY_MS = 100;

const DISMISS_TTL_MS = (TIP_DISMISS_DAYS as number) * 86400000;

function dismissedRecently(): boolean {
  const raw = readString(STORAGE_KEYS.tipsDismissed);
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  return Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS;
}

export default function TipStrip() {
  const { tab } = useUi();
  const [dismissed, setDismissed] = useState(true);
  const [tip, setTip] = useState('');

  // Read the dismissal once, after mount. Reading it in the initialiser would be fine too,
  // but starting hidden means the strip can never flash in and straight back out.
  useEffect(() => {
    if (!dismissedRecently()) setDismissed(false);
  }, []);

  const rotate = useCallback(() => {
    setTip(pickTip(`tab-${tab}`) as string);
  }, [tab]);

  useEffect(() => {
    if (dismissed) return undefined;
    // `tip` empty means this is the first appearance: wait, then show. Afterwards a tab
    // change re-picks almost immediately.
    const delay = tip ? TAB_SWITCH_DELAY_MS : START_DELAY_MS;
    const first = setTimeout(rotate, delay);
    const interval = setInterval(rotate, TIP_ROTATE_MS as number);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
    // `tip` is deliberately NOT a dependency — it changes on every rotation and would
    // restart the interval each time, which is how a 45-second rotation becomes a 45-second
    // timer that never fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed, rotate]);

  const dismiss = useCallback(() => {
    writeString(STORAGE_KEYS.tipsDismissed, String(Date.now()));
    setDismissed(true);
  }, []);

  if (dismissed || !tip) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
      <span aria-hidden="true">💡</span>
      <span className="min-w-0 flex-1 truncate">{tip}</span>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dismiss tips"
        className="h-auto min-h-11 shrink-0 px-2 py-0 text-[11px] md:min-h-0"
        onClick={dismiss}
      >
        Dismiss
      </Button>
    </div>
  );
}
