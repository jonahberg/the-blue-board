// ═══ SCHEDULE BOARD — THE DESKTOP REG CELL'S DETAIL LINE ═══
// `fleetCell()` (schedule-row-model.js) joins the line under a tail as
// `seats · wifi · ⚡ Starlink · IFE · Del YYYY`. For a Starlink tail the fleet database's Wi-Fi
// field already reads "Starlink", so the board printed "20F/57E+/123Y · Starlink · ⚡ Starlink ·
// AVOD …" — the same fact twice in a truncated cell. That join is pinned by the phone row
// (`phoneAircraftLine` reads it back), so it stays; this only decides what the desktop cell paints.

const PLAIN = 'Starlink';
const MARKED = '⚡ Starlink';

/**
 * The detail line's parts, with Starlink said once.
 *
 * A roster-confirmed "⚡ Starlink" part comes back as `{text: 'Starlink', starlink: true}` (the
 * cell draws the lucide Zap mark for it, as the phone row does) and takes the place of the first
 * Starlink mention; a bare "Starlink" Wi-Fi label with no roster mark stays a plain part. Every
 * other part is returned untouched and in order.
 *
 * @param {string|null|undefined} enrich  `row.fleet.enrich`.
 * @returns {{text: string, starlink: boolean}[]}
 */
export function regDetailParts(enrich) {
  const parts = String(enrich || '')
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean);
  const marked = parts.includes(MARKED);
  const out = [];
  let said = false;
  for (const part of parts) {
    if (part === PLAIN || part === MARKED) {
      if (said) continue;
      said = true;
      out.push({ text: PLAIN, starlink: marked });
      continue;
    }
    out.push({ text: part, starlink: false });
  }
  return out;
}

/**
 * The same line as plain text, for the cell's `title`.
 *
 * @param {{text: string}[]} parts  `regDetailParts()` output.
 * @returns {string}
 */
export function regDetailText(parts) {
  return parts.map((part) => part.text).join(' · ');
}
