// ═══ TICKER ITEMS ═══
// The scrolling headline strip. Priority order matters: an active disruption must
// never sit below "all systems normal", and the green line is suppressed entirely
// whenever anything above it is an advisory or a critical squawk.
//
// Extracted verbatim from src/dashboard/main.js (:2024-2073). The two duplicate
// .ticker-cycle blocks, the marquee/fade animation and the DOM write stay there.

import { escapeHtml } from './escape.js';

/** @typedef {{text: string, cls: 'advisory'|'info'|'critical'|'disclaimer'}} TickerItem */

/**
 * Build the ticker's item list, in render order.
 *
 * @param {Object} input
 * @param {{level: string, text: string}} input.opsHealth  from deriveOpsHealth().
 * @param {number} input.airborne  airborne flight count.
 * @param {number} input.total  total flights in the feed (gates the count lines).
 * @param {number} input.fleetCount  FLEET_DB length; 0 until the fleet loads.
 * @param {number} input.starlinkCount  Starlink-equipped tail count.
 * @param {Array<{text: string, callsign: string, squawk: string}>} input.squawks
 *   decoded emergency squawks (7500/7600/7700) — one critical item each.
 * @returns {TickerItem[]}
 */
export function buildTickerItems({ opsHealth, airborne, total, fleetCount, starlinkCount, squawks }) {
  const items = [];

  // Ops health first: derived from the SAME inputs the IROPS panel uses (hub OTP,
  // FAA programs at UA hubs, IROPS index) so the ticker can never say "all systems
  // normal" while the Delays tab shows a red IROPS night. (Audit Jul 3 2026.)
  if (opsHealth && opsHealth.level !== 'normal') {
    items.push({ text: `⚠️ ${opsHealth.text}`, cls: 'advisory' });
  }

  if (total > 0) {
    items.push({ text: `${airborne} United flights airborne`, cls: 'info' });
    // Show fleet counts only after fleet data has loaded — avoids misleading "0 aircraft" on initial render
    if (fleetCount > 0) {
      items.push({ text: `Fleet: ${fleetCount} mainline aircraft`, cls: 'info' });
      items.push({ text: `${starlinkCount} Starlink-equipped aircraft (incl. United Express)`, cls: 'info' });
    }
  }

  // Check for emergency squawks
  for (const sq of (squawks || [])) {
    items.push({ text: `${sq.text}: ${escapeHtml(sq.callsign)} (${escapeHtml(sq.squawk)})`, cls: 'critical' });
  }

  // Default message only when nothing above is an advisory/critical item — an
  // active disruption item suppresses the green "all systems normal" line.
  if (items.length === 0 || items.every(i => i.cls === 'info')) {
    const countStr = total > 0 ? ` — tracking ${total} United flights` : '';
    items.unshift({ text: `✅ All systems normal${countStr}`, cls: 'info' });
  }

  // Compact disclaimer/attribution in the rotation so it is visible in the mobile
  // first viewport (the footer is far below the fold on phones).
  items.push({ text: 'Unofficial — not affiliated with United Airlines · Data: AeroDataBox · FR24 · AWC · FAA', cls: 'disclaimer' });

  return items;
}
