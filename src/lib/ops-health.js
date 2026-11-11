// ═══ OPERATIONAL HEALTH: ONE NETWORK STATUS FOR EVERY SURFACE ═══
// Audit Jul 3 2026: the ticker said "✅ All systems normal" while the Delays tab
// showed IROPS 56.7 red, 151 cancellations, and 17 ground stops. Audit Sep 26 2026: the
// hub strip said "SMOOTH OPS" (85% average on-time) beside an IROPS badge reading
// "SIGNIFICANT DISRUPTION" (35.3) and a ticker reading "Elevated irregular ops" — three
// labels from two metrics. On-time-of-operated cannot see cancellations or the long tail
// of delays; the IROPS index can. So there is ONE definition, `networkStatus()`, and the
// strip chip (hub-health.js networkLabel), the ticker (deriveOpsHealth) and the IROPS
// badge (irops-score.js bands) all agree with it.
//
// Network status = the WORST of three signals:
//
//   level        label         IROPS index (irops-score.js)    FAA programs at a UA hub     hub on-time
//   normal       Smooth Ops    < 20   NORMAL OPERATIONS         none                         avg > 70%, every hub ≥ 50%
//   minor        Some Delays   20–40  MINOR DISRUPTION          GDP / departure delays       avg ≤ 70%
//   significant  Disrupted     ≥ 40   SIGNIFICANT DISRUPTION    ground stop / closure        any hub < 50%
//
// The IROPS bands were < 5 / < 15 until v1.12.0 (Oct 3 2026), when a calm Saturday — every hub
// 83–96% on-time, no programs, no confirmed cancellations — read "Disrupted". The constants live in
// irops-score.js (IROPS_MINOR_AT / IROPS_SIGNIFICANT_AT); the FAA and on-time columns did not move.
//
// The FAA column is hubProgramMarker()'s amber/red — the same call the per-hub chips use. A
// "closure" there is a real one: routine NOTAM closures (curfews, PPR/GA, runway-only) are
// screened inside hubProgramMarker() (withoutRoutineClosures, below).
// The ticker is advisory whenever the level is not normal, so it can never claim "all
// systems normal" while the strip or the IROPS badge says otherwise.

import { iropsScoreCls } from './irops-score.js';
import { normalizeFaaType } from './faa-context.js';

// ── Routine closures ──
// The FAA feed lists NOTAM closures that are part of an airport's normal week: nightly curfews
// ("AD AP CLSD DLY 0730-1415"), prior-permission and transient-GA restrictions, runway- or
// taxiway-only closures. Read as "Airport closure" they painted a working hub red and the network
// "Disrupted". The brief screened them out (Nov 2026) and the hub strip did not, so the two could
// disagree; the screen now lives here, inside hubProgramMarker(), which the strip's chips, the
// network status, the ticker and the brief all go through.

/**
 * True when an FAA "closure" reads like the airport is actually shut (snow removal, an emergency),
 * false for the routine NOTAM closures the feed also carries: nightly curfews ("AD AP CLSD DLY
 * 0730-1415"), prior-permission and transient-GA restrictions, runway- or taxiway-only closures.
 * A false negative costs one fact; a false positive puts "closed" in front of every visitor.
 * @param {unknown} reason
 */
export function isWholeAirportClosure(reason) {
  const text = String(reason || '').toUpperCase();
  if (/\b(DLY|DAILY|NIGHTLY|PPR|EXC|EXCEPT|NON[- ]?SKED|TRANSIENT|GA|RWY|TWY|RUNWAY|TAXIWAY|APRON|RAMP)\b/.test(text)) return false;
  if (/\b\d{4}\s*-\s*\d{4}\b/.test(text)) return false; // a recurring local time window
  return true;
}

const isClosureType = (item) => normalizeFaaType(item?.type || item?.reason).includes('closure');

/**
 * An /api/faa airport entry without its routine closures (see isWholeAirportClosure). The server
 * lists a closure twice, in `programs` and in the legacy `delays`; both are screened and `closure`
 * is recomputed from what is left. An entry with no routine closure comes back unchanged (the same
 * object), so a closure flag with no listed reason still reads as a closure.
 * @param {any} airport
 */
export function withoutRoutineClosures(airport) {
  if (!airport || typeof airport !== 'object') return airport;
  const programs = Array.isArray(airport.programs) ? airport.programs : [];
  const delays = Array.isArray(airport.delays) ? airport.delays : [];
  const routine = (item) => isClosureType(item) && !isWholeAirportClosure(item?.reason);
  if (!programs.some(routine) && !delays.some(routine)) return airport;
  const keptPrograms = programs.filter((p) => !routine(p));
  const keptDelays = delays.filter((d) => !routine(d));
  return {
    ...airport,
    programs: keptPrograms,
    delays: keptDelays,
    closure: keptPrograms.some(isClosureType) || keptDelays.some(isClosureType),
  };
}

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
    const typeOf = (d) => normalizeFaaType(d?.type || d?.reason);
    const gsDelay = delays.find((d) => typeOf(d).includes('ground stop'));
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
  // A nightly curfew or a runway-only NOTAM is not an airport closure (withoutRoutineClosures).
  const entry = withoutRoutineClosures(faaIndex?.[hub]);
  if (!entry || typeof entry !== 'object') return null;
  const programs = Array.isArray(entry.programs) ? entry.programs : [];
  const delays = Array.isArray(entry.delays) ? entry.delays : [];
  const typeOf = (d) => normalizeFaaType(d?.type || d?.reason);
  const hasType = (needle) =>
    programs.some((p) => typeOf(p).includes(needle)) || delays.some((d) => typeOf(d).includes(needle));

  if (entry.closure || hasType('closure')) return { severity: 'red', marker: '⛔', label: 'Airport closure' };
  if (entry.groundStop || hasType('ground stop')) {
    return { severity: 'red', marker: '⛔', label: 'Ground stop' };
  }
  if (entry.groundDelay || hasType('ground delay') || hasType('gdp')) {
    return { severity: 'amber', marker: '⚠', label: 'Ground delay program' };
  }
  if (entry.departureDelay || hasType('departure delay')) {
    return { severity: 'amber', marker: '⚠', label: 'Departure delays' };
  }
  return null;
}

const LEVEL_RANK = { normal: 0, minor: 1, significant: 2 };
const LEVEL_PRESENTATION = {
  normal: { severity: 'green', label: 'Smooth Ops', color: '#22c55e' },
  minor: { severity: 'amber', label: 'Some Delays', color: '#f59e0b' },
  significant: { severity: 'red', label: 'Disrupted', color: '#ef4444' },
};

/**
 * The network status — see the table at the top of this file.
 *
 * @param {object} opts
 * @param {Record<string,number>} [opts.hubOtps]  on-time % per hub.
 * @param {object} [opts.faaIndex]  faaDelayIndex ({ code: airportEntry }).
 * @param {string[]} [opts.hubCodes]  UA hub IATA codes whose FAA programs count.
 * @param {number|string|null} [opts.iropsScore]  IROPS severity index (0-100), null when unknown.
 * @returns {{level:'normal'|'minor'|'significant', severity:'green'|'amber'|'red', label:string,
 *   color:string, avg:number|null, worstHub:string|null, worstOtp:number|null,
 *   programs:Array<{hub:string, kind:'GS'|'GDP', avgDelay:number|null}>, iropsScore:number|null}}
 */
export function networkStatus({ hubOtps = {}, faaIndex = {}, hubCodes = [], iropsScore = null } = {}) {
  let level = 'normal';
  const raise = (to) => { if (LEVEL_RANK[to] > LEVEL_RANK[level]) level = to; };

  // On-time: every hub with a numeric reading.
  let worstHub = null;
  let worstOtp = Infinity;
  const otps = [];
  for (const [hub, raw] of Object.entries(hubOtps || {})) {
    const v = Number(raw);
    if (raw === null || raw === undefined || !Number.isFinite(v)) continue;
    otps.push(v);
    if (v < worstOtp) { worstOtp = v; worstHub = hub; }
  }
  const avg = otps.length ? Math.round(otps.reduce((a, b) => a + b, 0) / otps.length) : null;
  if (worstHub !== null && worstOtp < 50) raise('significant');
  else if (avg !== null && avg <= 70) raise('minor');

  // FAA programs: the per-hub chip's own severity.
  for (const hub of hubCodes) {
    const marker = hubProgramMarker(faaIndex, hub);
    if (marker) raise(marker.severity === 'red' ? 'significant' : 'minor');
  }

  // IROPS: the badge's own bands.
  const n = iropsScore === null || iropsScore === undefined || iropsScore === '' ? NaN : Number(iropsScore);
  const score = Number.isFinite(n) ? n : null;
  if (score !== null) {
    const cls = iropsScoreCls(score);
    if (cls === 'high') raise('significant');
    else if (cls === 'med') raise('minor');
  }

  return {
    level,
    ...LEVEL_PRESENTATION[level],
    avg,
    worstHub,
    worstOtp: worstHub === null ? null : worstOtp,
    programs: extractHubPrograms(faaIndex, hubCodes),
    iropsScore: score,
  };
}

/**
 * Derive the ticker's health state from `networkStatus()`: advisory whenever the network
 * is not normal, with the most specific fact as the text.
 * @param {object} opts  as networkStatus().
 * @returns {{level:'normal'|'advisory', text:string}}
 */
export function deriveOpsHealth(opts = {}) {
  const status = networkStatus(opts);
  if (status.level === 'normal') return { level: 'normal', text: '' };

  const { programs, worstHub, worstOtp, iropsScore, avg } = status;
  const gs = programs.find((p) => p.kind === 'GS');
  if (gs) return { level: 'advisory', text: `Disrupted: ${gs.hub} ground stop` };

  if (worstHub !== null && worstOtp < 50) {
    return { level: 'advisory', text: `Disrupted: ${worstHub} on-time ${Math.round(worstOtp)}%` };
  }

  const gdp = programs.find((p) => p.kind === 'GDP');
  if (gdp) {
    const avgDelay = gdp.avgDelay ? ` (avg ${Math.round(gdp.avgDelay)}m)` : '';
    return { level: 'advisory', text: `Disrupted: ${gdp.hub} ground delay program${avgDelay}` };
  }

  // A closure or departure-delay program (red/amber chip) with no GS/GDP entry.
  const marked = (opts.hubCodes || [])
    .map((hub) => ({ hub, marker: hubProgramMarker(opts.faaIndex, hub) }))
    .find((m) => m.marker);

  const programText = marked ? `${marked.marker.label} at ${marked.hub}` : '';
  if (marked && marked.marker.severity === 'red') return { level: 'advisory', text: `Disrupted: ${programText}` };
  if (iropsScore !== null && iropsScoreCls(iropsScore) === 'high') {
    return { level: 'advisory', text: `Elevated irregular ops — IROPS ${iropsScore}/100` };
  }
  if (marked) return { level: 'advisory', text: programText };
  if (iropsScore !== null && iropsScoreCls(iropsScore) === 'med') {
    return { level: 'advisory', text: `Minor irregular ops — IROPS ${iropsScore}/100` };
  }
  return { level: 'advisory', text: `Some delays — hub on-time averaging ${avg}%` };
}
