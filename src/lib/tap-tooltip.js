/**
 * Tap-to-toggle for hover tooltips (src/components/ui/tooltip.tsx).
 *
 * Radix tooltips open on hover and keyboard focus only — by design, a touch tap never opens one.
 * On a phone every "?" and dotted jargon term therefore did nothing when tapped (live audit,
 * Oct 4 2026: the IROPS "What does this mean?" button, tapped twice on a touch screen). The
 * trigger now records the pointerdown that starts a click, and a touch or pen tap flips the
 * tooltip. Mouse clicks and keyboard activation return null and keep Radix's behaviour.
 *
 * @param {{pointerType?: string, wasOpen?: boolean} | null | undefined} press  the pointerdown
 *   that started this click, with the tooltip's open state at that moment — read BEFORE Radix's
 *   own pointerdown handler closes an open tooltip.
 * @returns {boolean | null}  the tooltip's next open state, or null to leave it to Radix.
 */
export function tapToggleOpen(press) {
  if (!press) return null; // keyboard or programmatic click: no pointerdown preceded it
  if (press.pointerType !== 'touch' && press.pointerType !== 'pen') return null;
  return !press.wasOpen;
}
