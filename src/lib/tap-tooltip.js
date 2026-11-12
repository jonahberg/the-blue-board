/**
 * Tap-to-toggle for hover tooltips (src/components/ui/tooltip.tsx).
 *
 * Radix tooltips open on hover and keyboard focus only — by design, a touch tap never opens one.
 * On a phone every "?" and dotted jargon term therefore did nothing when tapped (live audit,
 * Oct 4 2026: the IROPS "What does this mean?" button, tapped twice on a touch screen). The
 * trigger now records the pointerdown that starts a click, and a touch or pen tap flips the
 * tooltip. Mouse clicks and keyboard activation return null and keep Radix's behaviour.
 *
 * A tap whose click the trigger's own handler took in place (it called `preventDefault`: a
 * dashboard link followed without a reload, such as a hub chip) closes the tooltip instead. The
 * reader has moved on to where the link went, and an explanation opening behind them would sit
 * over what they came to see (a hub chip's tooltip over the Schedule toolbar, Nov 12 2026). A link
 * that loads another page is not taken in place, so it toggles as before.
 *
 * @param {{pointerType?: string, wasOpen?: boolean} | null | undefined} press  the pointerdown
 *   that started this click, with the tooltip's open state at that moment — read BEFORE Radix's
 *   own pointerdown handler closes an open tooltip.
 * @param {{handledInPlace?: boolean}} [click]  `handledInPlace`: the click's default was
 *   prevented by the trigger's own handler.
 * @returns {boolean | null}  the tooltip's next open state, or null to leave it to Radix.
 */
export function tapToggleOpen(press, { handledInPlace = false } = {}) {
  if (!press) return null; // keyboard or programmatic click: no pointerdown preceded it
  if (press.pointerType !== 'touch' && press.pointerType !== 'pen') return null;
  if (handledInPlace) return false;
  return !press.wasOpen;
}
