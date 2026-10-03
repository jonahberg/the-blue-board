// ═══ CANCELLATIONS: CONFIRMED, LIKELY, OR NOT AT ALL ═══
// AeroDataBox has two cancellation states. "Canceled" is confirmed. "CanceledUncertain" means the
// provider suspects a cancellation and has not confirmed it; the boards render it "Likely Canceled"
// (v1.5.26). It is mostly wrong: on Sep 30 – Oct 2 2026 the departure boards carried 130–150
// uncertain rows a day against 0–3 confirmed, and on Oct 3 38 of the 45 uncertain departures at
// 22:54Z had been seen airborne by the live feed. Those are rewritten to departed before anything
// counts them (src/lib/reg-overlay.js, the seen-airborne override). What is left is still counted as
// a cancellation — some are real — but every consumer can tell the two kinds apart.
//
// Shared by the board classifier (src/lib/schedule-status.js), the sightings overlay and the IROPS
// index (api/irops.ts), so "is this a cancellation?" has one answer on every surface.

/**
 * The soft "Likely Canceled" state, in every shape it arrives in: the normalizer's
 * generic text/type, and the raw provider word on old cached payloads ("CanceledUncertain").
 *
 * @param {object|null|undefined} status  a board row's `status`.
 * @returns {boolean}
 */
export function isCanceledUncertainStatus(status) {
  if (!status || typeof status !== 'object') return false;
  const generic = status.generic;
  if (generic?.status?.text === 'canceled_uncertain' || generic?.type === 'canceled_uncertain') return true;
  const text = String(status.text || '').toLowerCase();
  return text.includes('canceleduncertain') || text.includes('canceled uncertain');
}

/**
 * The soft state as a STATUS WORD — what the watch engines compare: the board's display label
 * ("Likely Canceled") or the provider token /api/flight-times passes through ("canceled_uncertain").
 *
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function isLikelyCanceledText(text) {
  const s = String(text || '').toLowerCase();
  return s.includes('likely cancel') || s.includes('canceled_uncertain') || s.includes('canceleduncertain')
    || s.includes('canceled uncertain');
}

/**
 * Whether a board row is a cancellation, and which kind.
 *
 *  - 'confirmed' — the provider's generic status is canceled / cancelled.
 *  - 'likely'    — the soft CanceledUncertain state with no real time on the board's side. A real
 *                  departure (departures) or arrival (arrivals) means it operated; the classifier
 *                  already shows those rows as Departed / Landed, and this agrees with it.
 *  - null        — anything else, including a Likely Canceled the live feed saw fly (the overlay
 *                  has already rewritten its status to departed).
 *
 * @param {object} fl  a normalized board row.
 * @param {'departures'|'arrivals'} [dir]
 * @returns {'confirmed'|'likely'|null}
 */
export function cancellationKind(fl, dir = 'departures') {
  const status = fl?.status;
  const text = String(status?.generic?.status?.text || '').toLowerCase();
  if (text === 'canceled' || text === 'cancelled') return 'confirmed';
  if (!isCanceledUncertainStatus(status)) return null;
  const real = dir === 'arrivals' ? fl?.time?.real?.arrival : fl?.time?.real?.departure;
  return Number(real) > 0 ? null : 'likely';
}
