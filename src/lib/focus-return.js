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
// Deliberately DOM-free: it takes the two facts as data so it can be unit-tested with plain
// objects, and so the "should we?" decision is separable from the "how do we?" plumbing.

/**
 * Was focus effectively lost by the close, as opposed to moved on purpose?
 *
 * Lost means the browser has nowhere meaningful to put it: nothing focused, focus fell
 * through to `<body>`, or focus is still inside the content that is unmounting (the close
 * button focuses itself before it disappears).
 *
 * NOT lost means the user moved focus themselves — the case that matters is the non-modal
 * flight panel dismissed by clicking the Leaflet container, which takes focus because Leaflet
 * gives it `tabindex="0"`. Restoring in that case would yank focus away from where they just
 * put it.
 *
 * @param {{activeElement?: {tagName?: string}|null, insideClosingContent?: boolean}} [opts]
 * @returns {boolean}
 */
export function wasFocusLost({ activeElement, insideClosingContent = false } = {}) {
  if (!activeElement) return true;
  if (isBody(activeElement)) return true;
  return Boolean(insideClosingContent);
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

/** Tag comparison rather than `=== document.body`, so this module stays DOM-free. */
function isBody(element) {
  return String(element.tagName || '').toUpperCase() === 'BODY';
}
