// ═══ THE HUB STRIP'S NETWORK CHIP, BESIDE THE BRIEF ═══
// Nov 2026: a desktop on a ground-stop morning read DISRUPTED three times in 60 px — the brief
// row's tone, the hub strip's network chip and the brief panel open in the Live sidebar. The row
// and the panel are one brief, shown twice by design (the row says "In the sidebar"). The chip is
// `networkStatus()` (ops-health.js), which the brief already carries as its `net.status` fact and
// which floors the brief's tone, so while the two agree the chip only repeats the row above it.
//
// The chip stays whenever it says something the row does not:
//   - no current brief (the row is the rotating ticker) — the chip is the strip's standing status;
//   - the two disagree — the brief is a server snapshot up to 30 minutes old and the chip is live,
//     so a ground stop that landed after the brief was written shows here first;
//   - the FAA picture is unknown (faa-freshness.js) — the brief does not say that.

/** The brief's tone for each `networkStatus()` level. */
const TONE_FOR_LEVEL = Object.freeze({ normal: 'calm', minor: 'watch', significant: 'disrupted' });

/**
 * True when the network chip would only repeat the brief row: a current brief holds the row and
 * its tone is the tone of the chip's level.
 * @param {{briefTone?: string|null, networkLevel?: string|null, unknown?: boolean}} args
 *   `briefTone` is the current brief's tone, or null when the row is the ticker.
 * @returns {boolean}
 */
export function networkChipRepeatsBrief({ briefTone = null, networkLevel = null, unknown = false } = {}) {
  if (unknown || !briefTone || !networkLevel) return false;
  return TONE_FOR_LEVEL[networkLevel] === briefTone;
}
