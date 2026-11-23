// ═══ WHERE FOCUS GOES WHEN AN OVERLAY CLOSES ═══
// Radix returns focus to the element that OPENED a dialog, which it knows because a
// `DialogTrigger` registered itself. Seven of this app's overlays have no Trigger — they are
// opened by flipping state from a map marker, a table row, a deep link or ⌘K — so
// `context.triggerRef.current` is null, Radix's default handler focuses nothing, and the
// browser drops focus to `<body>`. A keyboard user who closes the flight sheet is returned to
// the top of the document and has to tab all the way back (WCAG 2.4.3 Focus Order).
//
// The wrappers in `components/ui/dialog.tsx` and `sheet.tsx` remember the element that was
// focused when the content mounted and apply the rule below, so every current and future
// caller is covered without each one hand-rolling a ref.
//
// Deliberately DOM-free: it takes the facts as data so it can be unit-tested with plain
// objects, and so the "should we?" decision is separable from the "how do we?" plumbing.

/**
 * The attribute that marks the control focus falls back to when an overlay's opener has left
 * the document: the header's "Find a flight" button (`shell/Header.tsx`). The wrappers look it
 * up by this attribute, so `components/ui` never imports from the app.
 */
export const FOCUS_FALLBACK_ATTR = 'data-focus-fallback';

/**
 * Was focus effectively lost by the close, as opposed to moved on purpose?
 *
 * Lost means the browser has nowhere meaningful to put it: nothing focused, or focus fell
 * through to `<body>`. Radix runs the close handler only after the content has unmounted (its
 * FocusScope dispatches on a zero timeout from the unmount), so focus that was inside the
 * content, on the close button say, has already fallen to `<body>` by then.
 *
 * NOT lost means the user moved focus themselves — the case that matters is the non-modal
 * flight panel dismissed by clicking the Leaflet container, which takes focus because Leaflet
 * gives it `tabindex="0"`. Restoring in that case would yank focus away from where they just
 * put it.
 *
 * @param {{activeElement?: {tagName?: string}|null}} [opts]
 * @returns {boolean}
 */
export function wasFocusLost({ activeElement } = {}) {
  if (!activeElement) return true;
  return isBody(activeElement);
}

/**
 * Should the overlay hand focus back to whatever opened it?
 *
 * @param {{opener?: {tagName?: string, isConnected?: boolean}|null, focusWasLost?: boolean}} [opts]
 * @returns {boolean}
 */
export function shouldRestoreFocus({ opener, focusWasLost } = {}) {
  if (!focusWasLost) return false;
  if (!opener) return false;
  // A row or marker that re-rendered away while the overlay was open. Focusing a detached
  // node silently sends focus to <body> — the exact failure this is meant to prevent.
  if (!opener.isConnected) return false;
  // Nothing was focused when the overlay opened (a deep link, a fresh load). Restoring to
  // <body> is the no-op that looks like a fix and is not one.
  if (isBody(opener)) return false;
  return true;
}

/**
 * The element to focus when an overlay closes, or null to leave focus where it is.
 *
 * The opener when it can take focus (`shouldRestoreFocus`). When the opener was a real element
 * that has since left the document, the fallback instead: the ⌘K palette's input opens the
 * flight sheet and then unmounts with the palette, so closing the sheet would otherwise drop
 * focus on `<body>`. The fallback is the "Find a flight" button, where that path began.
 *
 * An overlay that opened with nothing focused (its opener is `<body>`: a deep link, a fresh
 * load) still gets nothing, as before.
 *
 * @template {{tagName?: string, isConnected?: boolean}} T
 * @param {{opener?: T|null, fallback?: T|null, focusWasLost?: boolean}} [opts]
 * @returns {T|null}
 */
export function focusReturnTarget({ opener, fallback, focusWasLost } = {}) {
  if (shouldRestoreFocus({ opener, focusWasLost })) return opener ?? null;
  const openerLeft = Boolean(opener) && !opener?.isConnected && !isBody(opener);
  if (openerLeft && shouldRestoreFocus({ opener: fallback, focusWasLost })) return fallback ?? null;
  return null;
}

/** Tag comparison rather than `=== document.body`, so this module stays DOM-free. */
function isBody(element) {
  return String(element?.tagName || '').toUpperCase() === 'BODY';
}
