// ═══ HOW THE VISITOR OPENED IT ═══
// A panel that opens moves focus inside it, so a keyboard or screen-reader user lands there. The
// browser decides whether that focus shows a ring, and after a click or tap on a map marker Chrome
// drew one: the flight panel opened with "Center map" ringed for a visitor who had only clicked
// (Nov 2026). Removing the outline is not the fix (DESIGN.md: focus is always visible). Telling the
// browser how the panel was opened is: `focus({focusVisible: false})` after a pointer, the
// browser's own choice after a key. Unsupported browsers ignore the option and keep their default.
//
// DOM-free: the caller records the last input event type (src/app/features/FlightSheet.tsx).

/**
 * The input modality an event type stands for.
 * @param {string} type  a DOM event type
 * @returns {'keyboard'|'pointer'|null}
 */
export function modalityOf(type) {
  if (type === 'keydown') return 'keyboard';
  if (type === 'pointerdown' || type === 'mousedown' || type === 'touchstart') return 'pointer';
  return null;
}

/**
 * Focus options for moving focus into something the visitor just opened.
 * @param {'keyboard'|'pointer'|null|undefined} modality  how it was opened (null: not by input,
 *   e.g. a deep link on load, which is left to the browser).
 * @returns {{preventScroll: boolean, focusVisible?: boolean}}
 */
export function openFocusOptions(modality) {
  return modality === 'pointer' ? { preventScroll: true, focusVisible: false } : { preventScroll: true };
}
