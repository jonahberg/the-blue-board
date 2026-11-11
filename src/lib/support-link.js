/**
 * The one place the site's donation link is written down.
 *
 * Since Nov 10 2026 one-time donations go through a Stripe Payment Link (owner: "I am switching
 * to Stripe FULLY"). Every one-time support link a visitor can follow (the dashboard, the content
 * pages, the welcome email) is built here, so the URL is never typed twice;
 * tests/support-link.test.js fails on a `buy.stripe.com` literal anywhere else, and on a
 * one-time Buy Me a Coffee link. Monthly memberships still live on Buy Me a Coffee (there is no
 * Stripe monthly link yet) and are linked directly where they appear.
 *
 * Stripe records UTM parameters on the payment, so each link carries the placement label that
 * its `data-support` attribute gives the `support_click` event (src/lib/support-tracking.js):
 * `utm_content=footer` on the payment, `from: footer` in Web Analytics. A payment can then be
 * traced to the placement that led to it. Pass the SAME label to both.
 *
 * DOM-free and import-free, because api/waitlist.ts imports it.
 */

/** The Stripe Payment Link ("Support The Blue Board", choose what to pay). The path is case-sensitive. */
export const STRIPE_SUPPORT_URL = 'https://buy.stripe.com/14AaEW6Xx4AH9Ca7ssgEg00';

export const SUPPORT_UTM_SOURCE = 'theblueboard';

/** `site`: a link on theblueboard.co. `email`: a link in an email. `github`: the README. */
export const SUPPORT_MEDIA = /** @type {const} */ (['site', 'email', 'github']);

/**
 * The donation link for one placement.
 *
 * @param {string} placement the placement's `data-support` / `support_click` label, e.g. "footer"
 * @param {{ medium?: 'site' | 'email' | 'github' }} [options]
 * @returns {string}
 */
export function supportUrl(placement, { medium = 'site' } = {}) {
  // Same normalization as supportPlacement() in support-tracking.js, so a label reads the same
  // on the payment as in the click event. An unknown medium falls back to `site` rather than
  // throwing inside a render.
  const label = typeof placement === 'string' && placement.trim() ? placement.trim().slice(0, 40) : 'other';
  const url = new URL(STRIPE_SUPPORT_URL);
  url.searchParams.set('utm_source', SUPPORT_UTM_SOURCE);
  url.searchParams.set('utm_medium', SUPPORT_MEDIA.includes(medium) ? medium : 'site');
  url.searchParams.set('utm_content', label);
  return url.toString();
}
