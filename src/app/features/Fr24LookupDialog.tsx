/**
 * Flightradar24 flight lookup — ported in Task 7.
 *
 * Mounted by `Dashboard.tsx` from the start and rendering nothing until then, so Task 7
 * replaces this file alone: no change to the root, the tab registry or the state providers.
 * Opens from `useUi().fr24Query` — the search palette's fallback when a flight number is not
 * airborne.
 */

/**
 * Whether the lookup can actually answer.
 *
 * While this is false, nothing may OFFER the lookup: the search palette hides its row and
 * the `?flight=` deep link says so out loud instead of silently doing nothing. A control
 * that opens a dialog rendering `null` is worse than no control — it reads as a bug to the
 * one person most likely to try it, someone whose flight is not in the air yet.
 *
 * Task 7 flips this to `true` in the same commit that replaces the component below. No other
 * file needs to change.
 */
export const FR24_LOOKUP_AVAILABLE = false;

export default function Fr24LookupDialog() {
  return null;
}
