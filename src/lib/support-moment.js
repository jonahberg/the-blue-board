// ═══ THE SUPPORT STRIP'S EARLY MOMENTS (Nov 22 2026) ═══
// The deep-use trigger (`state/deep-use.ts`: T1, five minutes of use; T2, 20/30 engagement
// clicks) latches ONE ask per page load: the "cover a day" support strip, the email dialog or the
// email strip (`chooseDeepUseAsk`, src/lib/deep-use-ask.js). From Nov 12 to Nov 22 2026 about
// 4,100 visitors came; the strip was shown to 374 of them (9%), tapped 4 times, and 2 paid, both
// $17, both during a network meltdown, when the site was most useful: the five-minute and click
// moments reach few visitors.
//
// So the STRIP, and only the strip, gets two earlier moments:
//
//   'flights' — after the second flight's panel is closed: two or more distinct flights opened on
//               this page load (a plane on the map, a flight number or a `?flight=` link; the
//               same flight twice counts once) and no flight open now, held for T2's 2 s settle
//               counted from the close. Opening a flight during the settle cancels it, and it
//               waits for the next close. A strip that arrived while the flight panel (or the
//               phone's flight sheet) was open would be counted `shown` behind it, unseen;
//   'post'    — a visit that arrived from a social post: the strip's clock runs to
//               POST_TRIGGER_TIME_MS (60 s) instead of five minutes.
//
// Nothing else moves. The same latch is rolled (same dice, same eligibility, the same
// `bb_donate_prompt` quiet periods), only possibly sooner. If it lands on 'donate', an early moment
// shows the strip now and that is this visit's one ask. If it lands on 'email' or 'waitlist', the
// early moments do nothing, and that ask waits for T1/T2 with all its manners.
//
// The strip's `donate_prompt` events carry which moment brought it up (`trigger`): one of
// SUPPORT_STRIP_TRIGGERS, never a URL, a referrer or a flight number.

import { TRIGGER_TIME_MS } from './engagement.js';
import { hashTailParams } from './tab-hash.js';

/** A visit that arrived from a social post may see the strip after this much use. */
export const POST_TRIGGER_TIME_MS = 60 * 1000;

/** The distinct flight that is the early moment: the second one opened on this page load. */
export const EARLY_FLIGHT_COUNT = 2;

/**
 * Referrers that mean "came from a post": these hosts and their subdomains (old.reddit.com,
 * www.flyertalk.com, mobile.x.com). Matched on a dot boundary, never as a bare suffix, so
 * netflix.com is not x.com and microsoft.co is not t.co.
 */
export const POST_REFERRER_HOSTS = Object.freeze(['reddit.com', 'flyertalk.com', 'x.com', 'twitter.com', 't.co']);

/** The owner's links to the site in a post are tagged `utm_medium=social`. */
export const POST_UTM_MEDIUM = 'social';

/** What brought the strip up, in order of how the trigger is reported: one of these, exactly. */
export const SUPPORT_STRIP_TRIGGERS = Object.freeze(['time', 'clicks', 'flights', 'post']);

/** Is `host` one of POST_REFERRER_HOSTS or a subdomain of one? */
export function isPostReferrerHost(host) {
  const h = String(host ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  return POST_REFERRER_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Did this page load come from a social post? True when the landing address carries
 * `utm_medium=social`, in the query or trapped after the '#' (the shape src/lib/tab-hash.js
 * tolerates: '/#live?utm_medium=social', '/#schedule&utm_medium=social'), or when the referrer's
 * host is one of POST_REFERRER_HOSTS or a subdomain of one. Read once, at load, by the caller.
 *
 * @param {{search?: string, hash?: string, referrer?: string}} loc
 * @returns {boolean}
 */
export function arrivedFromPost({ search = '', hash = '', referrer = '' } = {}) {
  const medium = (params) => String(params.get('utm_medium') ?? '').trim().toLowerCase() === POST_UTM_MEDIUM;
  try {
    if (medium(new URLSearchParams(String(search ?? '')))) return true;
    if (medium(new URLSearchParams(hashTailParams(hash)))) return true;
  } catch {
    /* an unreadable address is not a post */
  }
  if (!referrer) return false;
  try {
    return isPostReferrerHost(new URL(String(referrer)).hostname);
  } catch {
    return false;
  }
}

/** How long the strip's time moment waits on this visit: 60 s after a post, else T1's five minutes. */
export function stripTimeTriggerMs(fromPost) {
  return fromPost ? POST_TRIGGER_TIME_MS : /** @type {number} */ (TRIGGER_TIME_MS);
}

/** Have enough distinct flights been opened on this page load for the 'flights' moment? */
export function reachedEarlyFlights(distinctFlights) {
  return Number.isInteger(distinctFlights) && distinctFlights >= EARLY_FLIGHT_COUNT;
}

/**
 * Is the 'flights' moment's settle running? Two or more distinct flights opened on this page load
 * and none open now (the flight panel, or the phone's flight sheet, is closed), so a strip that
 * arrives is on screen. The caller times the settle from the moment this turns true and cancels it
 * when it turns false (another flight opened).
 *
 * @param {{distinctFlights: number, flightOpen: boolean}} s
 * @returns {boolean}
 */
export function flightsMomentArmed({ distinctFlights, flightOpen }) {
  return reachedEarlyFlights(distinctFlights) && !flightOpen;
}

/**
 * The trigger to report: the first one that fired keeps its name (a strip shown at 60 s after a
 * post is still 'post' when T1 arrives at five minutes, and its later/donate events say so too).
 *
 * @param {string|null} current the trigger already recorded, or null
 * @param {string|null} next the moment that just fired
 * @returns {'time'|'clicks'|'flights'|'post'|null}
 */
export function firstTrigger(current, next) {
  if (SUPPORT_STRIP_TRIGGERS.includes(current)) return /** @type {any} */ (current);
  return SUPPORT_STRIP_TRIGGERS.includes(next) ? /** @type {any} */ (next) : null;
}

/**
 * May the support strip show now? Only when this visit's latched ask is the strip ('donate') and
 * one of its moments has fired. An early moment ('flights', 'post') never brings up another ask:
 * the email dialog and the email strip wait for T1/T2 on their own.
 *
 * @param {{ask: 'donate'|'email'|'waitlist'|null|undefined, trigger: string|null|undefined}} s
 * @returns {boolean}
 */
export function supportStripMayShow({ ask, trigger }) {
  return ask === 'donate' && SUPPORT_STRIP_TRIGGERS.includes(trigger);
}
