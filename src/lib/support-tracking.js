/**
 * Counts clicks on support links, so it is knowable which placement (the landed toast, the
 * About dialog, the footer, a news article…) actually leads people to support the site.
 * A support link is the Stripe donation link (src/lib/support-link.js) or a Buy Me a Coffee link
 * (monthly memberships stay there).
 *
 * One delegated listener on the document instead of an onClick per link: it covers the React
 * dashboard and every Astro content page alike, and a support link added later is counted
 * without anyone remembering to wire it. A link names its placement with `data-support="…"`; an
 * unlabelled support link still counts, as `other`.
 *
 * The event carries only the placement label — no URL parameters, no identity. Web Analytics
 * already records the page path the click happened on.
 */
import { track } from './track.js';

export const SUPPORT_CLICK_EVENT = 'support_click';

/**
 * True for Stripe Payment Links (buy.stripe.com) and for buymeacoffee.com and its subdomains,
 * never for look-alike hosts.
 */
export function isSupportUrl(href) {
  try {
    const host = new URL(href).hostname.toLowerCase();
    return host === 'buy.stripe.com' || host === 'buymeacoffee.com' || host.endsWith('.buymeacoffee.com');
  } catch {
    return false;
  }
}

/** The placement label for a clicked support anchor, or null when it is not a support link. */
export function supportPlacement(anchor) {
  if (!anchor || !isSupportUrl(anchor.href)) return null;
  const label = anchor.getAttribute('data-support');
  return label && label.trim() ? label.trim().slice(0, 40) : 'other';
}

/**
 * @param {Document} doc
 * @param {(name: string, data: Record<string, string>) => void} [send] test seam
 */
export function installSupportClickTracking(doc, send = track) {
  if (!doc || doc.__bbSupportTracking) return;
  doc.__bbSupportTracking = true;
  const onClick = (event) => {
    const target = event.target;
    const anchor = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
    const from = supportPlacement(anchor);
    if (from) send(SUPPORT_CLICK_EVENT, { from });
  };
  // Capture phase: a component that stops propagation still can't hide the click. Middle-click
  // (auxclick) opens the same page in a new tab, so it counts too.
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('auxclick', onClick, true);
}
