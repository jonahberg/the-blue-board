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
 * Stripe documents UTM codes only on the after-payment redirect URL, not on the Checkout Session,
 * so since Nov 10 2026 the label also rides as `client_reference_id`, which Stripe copies onto
 * the session and sends in `checkout.session.completed`. api/stripe-webhook.ts stores it as the
 * payment's `placement`. Stripe silently drops a client_reference_id that is not letters, digits,
 * `-` or `_`, so it is added only when the label passes `PLACEMENT_LABEL_RE` (every label on the
 * site does); the UTM parameters are unchanged either way.
 *
 * DOM-free and import-free, because api/waitlist.ts and api/stripe-webhook.ts import it.
 */

/** The Stripe Payment Link ("Support The Blue Board", choose what to pay). The path is case-sensitive. */
export const STRIPE_SUPPORT_URL = 'https://buy.stripe.com/14AaEW6Xx4AH9Ca7ssgEg00';

export const SUPPORT_UTM_SOURCE = 'theblueboard';

/** `site`: a link on theblueboard.co. `email`: a link in an email. `github`: the README. */
export const SUPPORT_MEDIA = /** @type {const} */ (['site', 'email', 'github']);

/**
 * What a placement label must look like to travel as Stripe's `client_reference_id` (and to be
 * stored as `placement`, sql/023): letters, digits, `-`, `_`, at most 40 characters.
 */
export const PLACEMENT_LABEL_RE = /^[A-Za-z0-9_-]{1,40}$/;

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
  if (PLACEMENT_LABEL_RE.test(label)) url.searchParams.set('client_reference_id', label);
  return url.toString();
}

/**
 * The Stripe Payment Link for "cover a day every month" (a $17 monthly subscription). EMPTY until
 * the owner creates one: while it is empty no monthly option is shown anywhere, and the About
 * section keeps its Buy Me a Coffee membership link. Paste the `https://buy.stripe.com/…` URL
 * here to turn the option on. Monthly renewals reach api/stripe-webhook.ts as invoice events,
 * which it does not count yet: wire `invoice.paid` before setting this.
 */
export const STRIPE_MONTHLY_URL = '';

/** Is there a monthly Stripe link to offer? */
export function hasMonthlySupport() {
  return typeof STRIPE_MONTHLY_URL === 'string' && STRIPE_MONTHLY_URL.startsWith('https://');
}

/**
 * The monthly link for one placement, tagged like `supportUrl`, or null while there is none.
 *
 * @param {string} placement the placement's `data-support` label
 * @param {{ medium?: 'site' | 'email' | 'github' }} [options]
 * @returns {string|null}
 */
export function monthlySupportUrl(placement, { medium = 'site' } = {}) {
  if (!hasMonthlySupport()) return null;
  const label = typeof placement === 'string' && placement.trim() ? placement.trim().slice(0, 40) : 'other';
  const url = new URL(STRIPE_MONTHLY_URL);
  url.searchParams.set('utm_source', SUPPORT_UTM_SOURCE);
  url.searchParams.set('utm_medium', SUPPORT_MEDIA.includes(medium) ? medium : 'site');
  url.searchParams.set('utm_content', label);
  if (PLACEMENT_LABEL_RE.test(label)) url.searchParams.set('client_reference_id', label);
  return url.toString();
}
