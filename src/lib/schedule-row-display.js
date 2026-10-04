// ═══ SCHEDULE BOARD — WORDS FOR THE EVIDENCE MARKERS ═══
// The row model (schedule-row-model.js) says WHAT a delay or a status is based on: a landing the
// live feed proved (`status.seenLanded`), a delay that is only a floor or a ceiling
// (`delay.bound`, already a "≥" / "≤" at the front of `delay.text`), a delay measured to a runway
// time (`delay.basis === 'runway'`, `actualFromRunway`). This module turns those flags into the
// words both boards print — the desktop table and the phone row — so the two cannot drift, and so
// every marker has words behind it for a screen reader (DESIGN.md: never colour or glyph alone).

/**
 * The line under a status that is not the provider's own word, strongest evidence first:
 *  1. `seenLanded` — the live feed had the aircraft airborne on this leg, then on the ground at
 *     the destination. Still asterisked (no provider landing time), but it is NOT "no live update";
 *     it is checked before `seen` because the Likely-Canceled override can set both.
 *  2. `seen` — the provider said Likely Canceled and the feed saw it fly.
 *  3. `presumed` — the clock passed the scheduled time and nothing confirmed it.
 *
 * @param {{presumed?: boolean, seen?: boolean, seenLanded?: boolean}|null|undefined} status
 * @returns {{text: string, note: string, title: string}|null}
 *   text   the short visible words (desktop sub-line)
 *   note   the full phrase for assistive tech and the phone pill
 *   title  the hover explanation
 */
export function statusEvidenceNote(status) {
  if (status?.seenLanded) {
    return {
      text: 'seen landing',
      note: 'seen landing on the live feed',
      title: 'Seen landing on the live feed: airborne on this leg, then on the ground at the destination. No landing time from the schedule provider yet.',
    };
  }
  if (status?.seen) {
    return {
      text: 'seen airborne',
      note: 'seen airborne by the live feed',
      title: 'The schedule provider listed this flight as Likely Canceled, but the live flight feed saw it airborne',
    };
  }
  if (status?.presumed) {
    return {
      text: 'presumed (no live update)',
      note: 'presumed — no live update',
      title: 'Presumed — the scheduled time passed without a live update',
    };
  }
  return null;
}

/**
 * A delay figure split for display: the bound glyph ("≥" at least / "≤" at most) that
 * `delayCell()` put at the front of `delay.text`, the words a screen reader should say for it,
 * and the figure itself. The glyph is decoration once the words exist.
 *
 * @param {{text?: string, bound?: 'lower'|'upper'|null}|null|undefined} delay
 * @returns {{glyph: string, sr: string, value: string}}
 */
export function delayFigure(delay) {
  const text = String(delay?.text || '');
  const glyph = text.startsWith('≥') ? '≥' : text.startsWith('≤') ? '≤' : '';
  const bound = delay?.bound || (glyph === '≥' ? 'lower' : glyph === '≤' ? 'upper' : null);
  const value = glyph ? text.slice(glyph.length).trim() : text;
  const sr = bound === 'lower' ? 'at least ' : bound === 'upper' ? 'at most ' : '';
  return { glyph, sr, value };
}

/**
 * The marker for a delay measured to a RUNWAY time: the provider sent wheels-up (departures) or
 * touchdown (arrivals) and no separate gate time, so the figure includes the taxi-out — or stops
 * before the taxi-in. Null for every other kind of delay, and for anything that is not a delta.
 *
 * @param {{kind?: string, basis?: string|null}|null|undefined} delay  `row.delay`.
 * @param {'departures'|'arrivals'} dir  the board's direction.
 * @param {boolean} [actualFromRunway]  `row.actualFromRunway`.
 * @returns {{kind: 'takeoff'|'touchdown', note: string}|null}
 */
export function runwayDelayMarker(delay, dir, actualFromRunway = false) {
  if (delay?.kind !== 'delta') return null;
  // `basis` says what the shown figure measured; a delay the live feed overrode (a 'sighting'
  // ceiling) is no longer the runway time even when the provider's actual was one.
  if (delay.basis ? delay.basis !== 'runway' : !actualFromRunway) return null;
  return dir === 'arrivals'
    ? { kind: 'touchdown', note: 'from touchdown time; before taxi-in' }
    : { kind: 'takeoff', note: 'from takeoff time; includes taxi' };
}
