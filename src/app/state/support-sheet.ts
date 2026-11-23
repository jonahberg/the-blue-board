/**
 * Which placement has the phone's "Cover a day" sheet open (`features/SupportSheet.tsx`), or null.
 *
 * A module store, like the engagement store, because its two openers live in different shells:
 * the phone header's support icon (`mobile-header`, `shell/Header.tsx`) and the More sheet's
 * "Help cover a day" row (`mobile-more`, `shell/MobileNav.tsx`), while the sheet is mounted once by
 * `Dashboard.tsx`. Opening it is the visitor's own tap, never a timer: this is not an engagement
 * surface that pounces (DESIGN.md "Engagement surfaces stay quiet").
 *
 * `openSupportSheet` reports the open as `support_open` (src/lib/support-tracking.js) once per
 * open, from the action itself, and remembers the control that opened it so focus can go back
 * there on close, even where a tap does not focus a button (iOS Safari).
 */

import { useSyncExternalStore } from 'react';

import { trackSupportOpen } from '@/lib/support-tracking.js';

export type SupportSheetFrom = 'mobile-header' | 'mobile-more';

let from: SupportSheetFrom | null = null;
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Open the sheet for `placement`; `control` is where focus returns when it closes. */
export function openSupportSheet(placement: SupportSheetFrom, control: HTMLElement | null = null): void {
  if (from === placement) return;
  from = placement;
  opener = control;
  trackSupportOpen(placement);
  emit();
}

export function closeSupportSheet(): void {
  if (from === null) return;
  from = null;
  emit();
}

/** The control that opened the sheet last, if it is still on the page. */
export function supportSheetOpener(): HTMLElement | null {
  return opener && opener.isConnected ? opener : null;
}

export function useSupportSheet(): SupportSheetFrom | null {
  return useSyncExternalStore(
    subscribe,
    () => from,
    () => null,
  );
}

/** Test seam: closed, with no opener. */
export function resetSupportSheet(): void {
  from = null;
  opener = null;
  emit();
}
