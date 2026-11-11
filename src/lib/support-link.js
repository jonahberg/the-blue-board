/**
 * The one place the site's donation link is written down.
 *
 * Since Nov 10 2026 one-time donations go through Stripe Payment Links (owner: "I am switching
 * to Stripe FULLY"): one any-amount link, and since Nov 11 2026 one fixed link per offered amount
 * ($5, $10, $17, $100). Every one-time support link a visitor can follow (the dashboard, the
 * content pages, the welcome email) is built here, so no URL is ever typed twice;
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

/**
 * The any-amount Stripe Payment Link ("Cover a day of The Blue Board", choose what to pay, preset
 * $10). Every ask that cannot name a day goes here ("Help cover a day", "Other amount"). The path
 * is case-sensitive. A Payment Link's price cannot be edited, so moving the preset from $17 to $10
 * (Nov 11 2026) meant a new link; the old one (…/14AaEW6Xx4AH9Ca7ssgEg00, preset $17) stays active
 * for links already sent in email.
 */
export const STRIPE_SUPPORT_URL = 'https://buy.stripe.com/cNidR80z90krbKi4gggEg05';

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
 * Fixed-amount Stripe Payment Links (Nov 11 2026: the owner asked for a choice of amounts and a
 * lower default; the any-amount link above keeps its own preset). Keyed by whole US dollars. A
 * null or empty entry is an amount with no link yet: `supportAmountUrl` returns null for it and
 * the surfaces that list amounts (src/lib/cover-a-day.js `supportLadder`) leave it out. The $17
 * link (the daily cost, DAILY_COST_USD) is where a button naming a day goes when it is set.
 * @type {Readonly<Record<number, string|null>>}
 */
export const SUPPORT_AMOUNT_LINKS = Object.freeze({
  5: 'https://buy.stripe.com/fZu4gy6Xxd7d9Ca288gEg01',
  10: 'https://buy.stripe.com/28EcN495F8QXaGe8wwgEg02',
  17: 'https://buy.stripe.com/28EeVc2Hh6IPbKiaEEgEg03',
  100: 'https://buy.stripe.com/8x228q81BaZ58y69AAgEg04',
});

/** The amounts offered, smallest first. */
export const SUPPORT_AMOUNTS = Object.freeze([5, 10, 17, 100]);

/**
 * The fixed-amount link for one placement, tagged exactly like `supportUrl`, or null when that
 * amount has no link.
 *
 * @param {number} amount whole US dollars, one of SUPPORT_AMOUNTS
 * @param {string} placement the link's `data-support` / `support_click` label, e.g. "fleet-end-17"
 * @param {{ medium?: 'site' | 'email' | 'github', links?: Record<number, string|null> }} [options]
 *   `links` is a test seam (defaults to SUPPORT_AMOUNT_LINKS).
 * @returns {string|null}
 */
export function supportAmountUrl(amount, placement, { medium = 'site', links = SUPPORT_AMOUNT_LINKS } = {}) {
  const base = links?.[amount];
  if (typeof base !== 'string' || !base.startsWith('https://')) return null;
  const label = typeof placement === 'string' && placement.trim() ? placement.trim().slice(0, 40) : 'other';
  const url = new URL(base);
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
