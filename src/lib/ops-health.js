// ═══ OPERATIONAL HEALTH FOR THE HEADER TICKER ═══
// Audit Jul 3 2026: the ticker said "✅ All systems normal" while the Delays tab
// showed IROPS 56.7 red, 151 cancellations, and 17 ground stops — the ticker only
// looked at emergency squawks in the live feed. This module derives the ticker's
// health state from the SAME inputs the IROPS panel uses (hub OTP, FAA programs at
// UA hubs, IROPS severity index) so the two surfaces can never contradict.
//
// Rules (from the info-design audit):
//  - any hub OTP < 50%, or any active ground stop / ground delay program at a UA
//    hub ⇒ amber "Disrupted: <worst hub> <fact>" — never green.
//  - IROPS index red (≥ 15, "Significant IROPS") ⇒ never "normal", even when no
//    single hub crosses a threshold.

/**
 * Extract active FAA traffic-management programs at UA hubs from the /api/faa
 * index shape ({ [airportCode]: { groundStop, groundDelay, delays: [{type, avgDelay}] } }).
 * Defensive: every field may be absent on old cached payloads.
 * @returns {Array<{hub:string, kind:'GS'|'GDP', avgDelay:number|null}>}
 */
export function extractHubPrograms(faaIndex = {}, hubCodes = []) {
  const programs = [];
  if (!faaIndex || typeof faaIndex !== 'object') return programs;
  for (const hub of hubCodes) {
    const entry = faaIndex[hub];
    if (!entry || typeof entry !== 'object') continue;
    const delays = Array.isArray(entry.delays) ? entry.delays : [];
    const typeOf = (d) => String(d?.type || d?.reason || '').toLowerCase();
    const gsDelay = delays.find((d) => typeOf(d).includes('ground stop') || typeOf(d).includes('ground_stop'));
    const gdpDelay = delays.find((d) => typeOf(d).includes('ground delay') || typeOf(d).includes('gdp'));
    if (entry.groundStop || gsDelay) {
      programs.push({ hub, kind: 'GS', avgDelay: numOrNull(gsDelay?.avgDelay) });
    } else if (entry.groundDelay || gdpDelay) {
      programs.push({ hub, kind: 'GDP', avgDelay: numOrNull(gdpDelay?.avgDelay) });
    }
  }
  return programs;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Chip-severity + accessible marker for the header hub-health bar (F046/F076).
 *
 * The chips were colored purely from backward-looking OTP-of-operated, so a hub under a
 * ground stop showed 🟢 while its held flights (excluded from the OTP ratio) sat two
 * inches from the ticker's "Disrupted: EWR ground stop". This returns the worst active
 * FAA program at a hub so the bar can take the WORSE of (OTP color, program color) — a
 * ground stop can never render green, a GDP/departure-delay program can never render
 * better than amber.
 *
 * Precedence matches deriveOpsHealth (closure/ground stop ⇒ red; GDP/departure delay ⇒
 * amber). The `marker` is a color-INDEPENDENT glyph so status is never conveyed by color
 * alone (DESIGN.md accessibility rule): "EWR ⛔ 84%".
 *
 * @param {object} faaIndex  faaDelayIndex ({ [airportCode]: airportEntry }).
 * @param {string} hub       hub IATA code.
 * @returns {{severity:'red'|'amber', marker:string, label:string}|null}
 */
export function hubProgramMarker(faaIndex, hub) {
  const entry = faaIndex?.[hub];
  if (!entry || typeof entry !== 'object') return null;
  const programs = Array.isArray(entry.programs) ? entry.programs : [];
  const delays = Array.isArray(entry.delays) ? entry.delays : [];
  const typeOf = (d) => String(d?.type || d?.reason || '').toLowerCase();
  const hasType = (needle) =>
    programs.some((p) => typeOf(p).includes(needle)) || delays.some((d) => typeOf(d).includes(needle));

  if (entry.closure || hasType('closure')) return { severity: 'red', marker: '⛔', label: 'Airport closure' };
  if (entry.groundStop || hasType('ground stop') || hasType('ground_stop')) {
    return { severity: 'red', marker: '⛔', label: 'Ground stop' };
  }
  if (entry.groundDelay || hasType('ground delay') || hasType('ground_delay') || hasType('gdp')) {
    return { severity: 'amber', marker: '⚠', label: 'Ground delay program' };
  }
  if (entry.departureDelay || hasType('departure delay') || hasType('departure_delay')) {
    return { severity: 'amber', marker: '⚠', label: 'Departure delays' };
  }
  return null;
}

/**
 * Derive the ticker's health state.
 * @param {object} opts
 * @param {Record<string,number>} [opts.hubOtps]  on-time % per hub (hubHealthData).
 * @param {object} [opts.faaIndex]  faaDelayIndex ({ code: airportEntry }).
 * @param {string[]} [opts.hubCodes]  UA hub IATA codes to consider.
 * @param {number|null} [opts.iropsScore]  latest IROPS severity index (0-100), null when unknown.
 * @returns {{level:'normal'|'advisory', text:string}}
 */
export function deriveOpsHealth({ hubOtps = {}, faaIndex = {}, hubCodes = [], iropsScore = null } = {}) {
  const programs = extractHubPrograms(faaIndex, hubCodes);

  // Worst hub by OTP (only hubs with a numeric reading).
  let worstHub = null;
  let worstOtp = Infinity;
  for (const hub of hubCodes) {
    const v = Number(hubOtps?.[hub]);
    if (Number.isFinite(v) && v < worstOtp) { worstOtp = v; worstHub = hub; }
  }

  const gs = programs.find((p) => p.kind === 'GS');
  if (gs) return { level: 'advisory', text: `Disrupted: ${gs.hub} ground stop` };

  if (worstHub && worstOtp < 50) {
    return { level: 'advisory', text: `Disrupted: ${worstHub} on-time ${Math.round(worstOtp)}%` };
  }

  const gdp = programs.find((p) => p.kind === 'GDP');
  if (gdp) {
    const avg = gdp.avgDelay ? ` (avg ${Math.round(gdp.avgDelay)}m)` : '';
    return { level: 'advisory', text: `Disrupted: ${gdp.hub} ground delay program${avg}` };
  }

  const score = Number(iropsScore);
  if (Number.isFinite(score) && score >= 15) {
    return { level: 'advisory', text: `Elevated irregular ops — IROPS ${score}/100` };
  }

  return { level: 'normal', text: '' };
}
