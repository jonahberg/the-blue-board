// ═══ SCHEDULE BOARD — THE PHONE ROW ═══
// Below `md` the board is a list of two-line rows instead of a 1,065 px table (audit Oct 3
// 2026: at 390 px only TIME / FLIGHT / ROUTE were on screen, and at 360 px no row at all).
// This module decides what each of those lines says. It only READS the row model that
// `buildScheduleRow()` already produced — it never re-derives a status, a delay or a tail —
// so the phone and the desktop board cannot disagree about a flight.
//
// ONE DEPENDENCY TO KNOW ABOUT: the Wi-Fi and seat-config labels are read back out of
// `row.fleet.enrich`, which `fleetCell()` in `schedule-row-model.js` builds by joining
// `seats · wifi · ⚡ Starlink · IFE · Del YYYY` with " · ". That file belongs to the board's
// data pipeline, not to this presentation layer. `tests/schedule-phone-row.test.js` pins the
// format with a real fleet.json-shaped row, so a change to that join fails loudly there
// instead of quietly printing an IFE code where the Wi-Fi should be.
//
// A United Express tail the fleet database does not know but the Starlink roster does arrives as
// `{badge: 'Starlink', starlink: true, enrich: '⚡ Starlink', source: 'starlink-roster'}` (v1.13.0):
// no seats, no type, and the Wi-Fi reads Starlink from the `starlink` flag, not from the string.

import { WIFI_DISPLAY } from './fleet-utils.js';
import { statusEvidenceNote } from './schedule-row-display.js';

/** "12F/42E+/96Y", "50J/24PE/46E+/156Y" — a United cabin layout, never a type name. */
const SEAT_CONFIG_RE = /^\d+[A-Z]{1,2}\+?(\/\d+[A-Z]{1,2}\+?)+$/;

/** Every Wi-Fi label `normalizeWifi()` can produce, raw codes included (it passes unknowns through). */
const WIFI_LABELS = new Set([...Object.keys(WIFI_DISPLAY), ...Object.values(WIFI_DISPLAY), 'Starlink']);

/** fleet.json writes "NO" for a tail without Wi-Fi. */
const NO_WIFI = new Set(['NO', 'No', 'None', 'none']);

/**
 * The changed time under the scheduled one: "→ 22:16 (+208m)" becomes `22:16`. The minutes
 * are dropped on purpose — the row's delay figure already says "+208m", and printing it
 * twice in 360 px is the kind of noise that pushed the status off-screen.
 *
 * @param {{text?: string, early?: boolean}|null|undefined} actualLine  `row.actualLine`.
 * @returns {{stamp: string, early: boolean}|null}
 */
export function phoneTimeChange(actualLine) {
  if (!actualLine || typeof actualLine.text !== 'string') return null;
  const match = actualLine.text.match(/(\d{1,2}:\d{2})/);
  if (!match) return null;
  return { stamp: match[1], early: Boolean(actualLine.early) };
}

/**
 * The muted second line: tail · aircraft type · seat config · Wi-Fi.
 *
 * Every part is optional — the schedule feed omits tails constantly and an unknown tail has
 * no fleet entry — and an absent part is left out rather than printed as a dash, so a row
 * with nothing known collapses to just its type.
 *
 * @param {{reg?: string, acCode?: string, acShort?: string,
 *   fleet?: {badge?: string, starlink?: boolean, enrich?: string}|null}} row
 * @returns {{tail: string, type: string, seats: string, wifi: string, starlink: boolean}}
 */
export function phoneAircraftLine(row) {
  const fleet = row?.fleet || null;
  const parts = String(fleet?.enrich || '')
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean);

  const badge = String(fleet?.badge || '');
  const seats = SEAT_CONFIG_RE.test(badge) ? badge : parts.find((part) => SEAT_CONFIG_RE.test(part)) || '';

  const starlink = Boolean(fleet?.starlink);
  let wifi = '';
  if (starlink) {
    wifi = 'Starlink';
  } else {
    const label = parts.find((part) => WIFI_LABELS.has(part) || NO_WIFI.has(part)) || '';
    wifi = NO_WIFI.has(label) ? 'No Wi-Fi' : label;
  }

  const acCode = row?.acCode && row.acCode !== '—' ? row.acCode : '';
  // The readable short name ("737 MAX 9", "A321 NEO") when it is one; the type code when the
  // provider's text is a clipped phrase ("Canadair Regional Je") or a bare number ("175").
  const short = String(row?.acShort || '');
  const readable = short && short.length <= 12 && !/^\d+$/.test(short);
  return {
    tail: String(row?.reg || ''),
    type: readable ? short : acCode || short,
    seats,
    wifi,
    starlink,
  };
}

/**
 * The status pill's words, presumed rows included. The asterisk is what the desktop board
 * prints; the long form is for the pill's title and the screen-reader text, because a bare
 * "*" says nothing to either. The note is the desktop's (schedule-row-display.js), so a
 * feed-proven landing says "seen landing on the live feed" on both boards, never
 * "no live update".
 *
 * @param {{text: string, presumed?: boolean, seen?: boolean, seenLanded?: boolean}} status
 * @returns {{label: string, note: string}}
 */
export function phoneStatusLabel(status) {
  const text = String(status?.text || 'Scheduled');
  const evidence = statusEvidenceNote(status);
  return { label: status?.presumed ? `${text}*` : text, note: evidence ? evidence.note : '' };
}

/**
 * The visible words for an equipment swap on the phone row. The tone word rides with the
 * colour (DESIGN.md: never colour alone): "B739 → B738 · downgrade".
 *
 * @param {{oldType: string, newType: string, tone: string}|null|undefined} swap
 * @returns {string}
 */
export function phoneSwapText(swap) {
  if (!swap) return '';
  const word = swap.tone === 'downgrade' ? 'downgrade' : swap.tone === 'upgrade' ? 'upgrade' : 'swap';
  return `${swap.oldType} → ${swap.newType} · ${word}`;
}
