// ═══ WHERE EACH HUB'S MAP LABEL SITS ═══
// Every hub ring carries a permanent IATA label. Above the ring is the default, but two pairs of
// hubs are close at a phone's zoom: at the Live map's phone view (zoom ≈ 3.2) Newark is ~20 px
// east and ~18 px north of Dulles, and Los Angeles ~25 px east and ~29 px south of San Francisco,
// so a label landed on its neighbour's ring ("EWR sits under IAD", Nov 2026). The southern hub of
// each pair labels below its ring and Newark labels to its right, over the Atlantic. San Francisco
// stays on top: to its left the label would fall off a phone map that is fitted to the coast.
// One table for every width: the same pairs collide on a desktop zoomed out one step. Pure data —
// no Leaflet, no DOM.

/** @typedef {'top'|'bottom'|'left'|'right'} LabelDirection */

/** @type {Readonly<Record<string, LabelDirection>>} Hubs not listed label above their ring. */
export const HUB_LABEL_DIRECTION = Object.freeze({
  LAX: 'bottom', // over Baja, clear of SFO's ring
  IAD: 'bottom', // under its ring, clear of EWR
  EWR: 'right', // over the Atlantic
});

/** Gap between the ring's centre and the label, in px (the ring's radius plus a hair). */
const GAP = 10;

/**
 * Leaflet tooltip options for a hub's label.
 * @param {string} iata
 * @returns {{direction: LabelDirection, offset: [number, number]}}
 */
export function hubLabelPlacement(iata) {
  const direction = HUB_LABEL_DIRECTION[String(iata || '').toUpperCase()] ?? 'top';
  /** @type {[number, number]} */
  const offset =
    direction === 'bottom' ? [0, GAP] : direction === 'left' ? [-GAP, 0] : direction === 'right' ? [GAP, 0] : [0, -GAP];
  return { direction, offset };
}
