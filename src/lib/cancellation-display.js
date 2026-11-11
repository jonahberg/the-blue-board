// ═══ CANCELLATIONS: CONFIRMED vs UNCONFIRMED, FOR DISPLAY ═══
// The schedule provider (AeroDataBox) marks many regional flights `canceled_uncertain` —
// "Likely Canceled" — without ever confirming it. The IROPS score counts them as
// cancellations unless the live feed saw them fly (the Oct 3 2026 calibration, owner-approved:
// bands NORMAL < 20 / MINOR 20–40 / SIGNIFICANT ≥ 40 and the seen-airborne override live in
// irops-score.js and api/irops.ts, and NOTHING here changes them).
//
// What changes is the headline. On Nov 10 2026 the Delays tab read "53 CANCELLATIONS incl. 53
// likely" beside "NORMAL OPERATIONS", and ORD's board "14 CANCELED" on a 91%-on-time day —
// every one of those 53 and 14 unconfirmed. A figure labelled "canceled" now counts confirmed
// cancellations only; the unconfirmed ones get their own, quieter figure, and the tooltips say
// the score still counts them (otherwise "0 canceled" beside a score reads as a contradiction).
// The rows themselves still say "Likely Canceled" — the provider's word — so the copy bridges
// "unconfirmed" back to it.

/**
 * @param {number|null|undefined} n
 * @returns {number|null} a non-negative integer, or null for "not reported".
 */
function count(n) {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

/**
 * Split a cancellation count into its confirmed and unconfirmed parts.
 *
 * @param {number|null|undefined} total  every cancellation the source counts, unconfirmed
 *   included (`/api/irops` `cancellations`, board-stats `canceled`).
 * @param {number|null|undefined} unconfirmed  the "Likely Canceled" part of `total`
 *   (`cancellationsLikely`, `canceledUncertain`). Absent on IROPS payloads before v1.12.0.
 * @returns {{confirmed: number|null, unconfirmed: number|null, split: boolean}}
 *   `split` false: the source cannot say which are confirmed. `confirmed` is then `total`
 *   as-is (null when even that is missing) and the caller must not label it "confirmed".
 */
export function splitCancellations(total, unconfirmed) {
  const all = count(total);
  const soft = count(unconfirmed);
  if (all === null) return { confirmed: null, unconfirmed: soft, split: false };
  if (soft === null) return { confirmed: all, unconfirmed: null, split: false };
  const unconf = Math.min(soft, all);
  return { confirmed: all - unconf, unconfirmed: unconf, split: true };
}

/** "flight" / "flights" — local so this module stays dependency-free. */
function flights(n) {
  return n === 1 ? 'flight' : 'flights';
}

/**
 * The quiet figure under a Canceled headline: "+53 unconfirmed", or null when there is none.
 * On an unsplit source it warns that the headline may include unconfirmed ones instead.
 *
 * @param {{split: boolean, unconfirmed: number|null}} parts  from `splitCancellations`.
 * @returns {string|null}
 */
export function unconfirmedFigure(parts) {
  if (!parts.split) return 'may include unconfirmed';
  return parts.unconfirmed ? `+${parts.unconfirmed} unconfirmed` : null;
}

/**
 * The Delays tab's footnote under the IROPS bar: what "unconfirmed" means, and the Likely
 * Canceled flights the live feed saw flying (not counted anywhere). Null when neither applies.
 *
 * @param {{unconfirmed: number|null, seenFlying?: number|null}} opts
 * @returns {string|null}
 */
export function iropsCancellationNote({ unconfirmed, seenFlying }) {
  const soft = count(unconfirmed) || 0;
  const seen = count(seenFlying) || 0;
  const parts = [];
  if (soft > 0) {
    parts.push(
      `${soft} unconfirmed: ${soft === 1 ? 'a flight' : `${flights(soft)}`} the schedule provider lists as “Likely Canceled” without confirming. ` +
        `The severity score counts ${soft === 1 ? 'it' : 'them'}; Canceled does not.`,
    );
  }
  if (seen > 0) {
    parts.push(
      `${seen} more listed that way ${seen === 1 ? 'was' : 'were'} seen flying by the live feed and ${seen === 1 ? 'is' : 'are'} not counted.`,
    );
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * The IROPS "?" tooltip's sentence about cancellations — shared by the server and the
 * loaded-boards fallback so the two cannot drift.
 */
export const IROPS_CANCELLATION_TOOLTIP =
  'Canceled counts confirmed cancellations only. The score also counts flights the schedule provider lists as Likely Canceled (shown as unconfirmed), except those the live flight feed saw flying.';

/**
 * The schedule board's Canceled card tooltip.
 *
 * @param {{split: boolean, confirmed: number|null, unconfirmed: number|null}} parts
 * @returns {string}
 */
export function boardCanceledTitle(parts) {
  const confirmed = parts.confirmed ?? 0;
  const head = `${confirmed} confirmed ${confirmed === 1 ? 'cancellation' : 'cancellations'}.`;
  if (!parts.split || !parts.unconfirmed) return head;
  const one = parts.unconfirmed === 1;
  return `${head} ${parts.unconfirmed} more ${one ? 'is' : 'are'} unconfirmed: the schedule provider lists ${one ? 'it' : 'them'} as “Likely Canceled” (the word on ${one ? 'its row' : 'their rows'}) but has not confirmed ${one ? 'the cancellation' : 'the cancellations'}.`;
}
