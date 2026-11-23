// ═══ OPERATIONAL HEALTH: ONE NETWORK STATUS FOR EVERY SURFACE ═══
// Audit Jul 3 2026: the ticker said "✅ All systems normal" while the Delays tab
// showed IROPS 56.7 red, 151 cancellations, and 17 ground stops. Audit Sep 26 2026: the
// hub strip said "SMOOTH OPS" (85% average on-time) beside an IROPS badge reading
// "SIGNIFICANT DISRUPTION" (35.3) and a ticker reading "Elevated irregular ops" — three
// labels from two metrics. On-time-of-operated cannot see cancellations or the long tail
// of delays; the IROPS index can. So there is ONE definition, `networkStatus()`, and the
// strip chip (hub-health.js networkLabel), the ticker (deriveOpsHealth) and the brief's tone
// (brief-facts.js, through its `net.status` fact) all agree with it.
//
// Network status (Nov 22 2026: "Some Delays" means trouble that is network-wide, not one hub's
// ordinary bad afternoon):
//
//   significant  Disrupted    any of: a ground stop or closure at a United hub (hubProgramMarker red),
//                             any hub under 50% on time, the IROPS index at 40 or more
//   minor        Some Delays  any of: two or more hubs IMPAIRED NOW; exactly one impaired hub while
//                             the IROPS index is NETWORK_WATCH_INDEX_WITH_ONE_HUB (30) or more; the
//                             average of the hubs' on-time readings for TODAY at 70% or less
//   normal       Smooth Ops   otherwise
//
// A hub is IMPAIRED NOW (hubImpairments) when any of:
//   - a ground delay program is in effect for flights into it ('gdp');
//   - its on-time reading for TODAY's board is under 70% ('otp'; before 06:00 hub-local the
//     boards still show yesterday, defaultSchedDayOffset, and a yesterday reading never counts);
//   - the FAA reports departure or arrival delays there starting at HUB_IMPAIRING_FAA_DELAY_MIN
//     (45) minutes or more ('dep' / 'arr': the reported lower bound, `minDelay`; a delay with no
//     lower bound, or only an average, does not count);
//   - 10% or more of today's departures on a current board are confirmed canceled ('cxl',
//     hubCancelRates in hub-health.js, the measure behind the brief's `cxl.<HUB>` facts).
// The on-time readings are the gated ones (hub-health.js networkReadings): the server's /api/irops
// figure, at least 25 departed, a board no more than 3 h behind, dated by the board's own day. The
// brief and the strip pass the same readings (networkInputs), so a visitor's own boards, Tokyo
// Narita's dozen departures or Newark's first 18 of the morning never decide the network level.
// One impaired hub is still named everywhere a hub is (its own chip keeps its colour, the brief
// names it); it does not turn the network amber. A possible or planned program, weather, FAA delays
// under 45 minutes, yesterday's readings, airports that are not United hubs, and the IROPS index in
// its minor band (20–40) never set "Some Delays" by themselves.
//
// Until Nov 22 2026 any one of a GDP or departure delays at a hub, or the index in its minor band,
// was "Some Delays", and the brief's tone followed: over Nov 19–22 the brief read WATCH for 199 of
// 219 briefs (91%), 24 of them under a headline saying "normal". The IROPS card's own band label
// (NORMAL / MINOR / SIGNIFICANT at 20 / 40, irops-score.js) is the index's scale and did not change.
//
// The IROPS bands were < 5 / < 15 until v1.12.0 (Oct 3 2026), when a calm Saturday — every hub
// 83–96% on-time, no programs, no confirmed cancellations — read "Disrupted". The constants live in
// irops-score.js (IROPS_MINOR_AT / IROPS_SIGNIFICANT_AT).
//
// The red FAA test is hubProgramMarker() — the same call the per-hub chips use. A "closure" there
// is a real one: routine NOTAM closures (curfews, PPR/GA, runway-only) are screened inside
// hubProgramMarker() (withoutRoutineClosures, below), and so in hubImpairments.
// The ticker is advisory whenever the level is not normal, so it can never claim "all
// systems normal" while the strip says otherwise.

import { iropsScoreCls } from './irops-score.js';
import { normalizeFaaType } from './faa-context.js';

/**
 * With exactly one United hub impaired, the network is "Some Delays" only when the IROPS index is
 * at least this (decided with the rule, Nov 22 2026). The index alone sits in its minor band (20–40) for most
 * of an ordinary evening and night: ordinary full-day scores ran 24–33 and bad days 51–82 over
 * Nov 12–22 2026, and the minor band held the brief at watch in 260 briefs since Nov 12. Replaying
 * the stored facts of every brief of Nov 12–22 2026 through this rule, the share of each day's hours
 * at watch fell from 27–100% to 0–28%, with every disrupted hour unchanged.
 */
export const NETWORK_WATCH_INDEX_WITH_ONE_HUB = 30;

/**
 * FAA departure or arrival delays impair a hub only when their reported lower bound is at least
 * this many minutes (decided with the rule, Nov 22 2026). Since Nov 12 2026 FAA departure delays at a hub had
 * held the brief at watch in 110 briefs and arrival delays in 5, whatever their length.
 */
export const HUB_IMPAIRING_FAA_DELAY_MIN = 45;

/** A hub whose on-time reading for today's board is under this is impaired (the brief's soft hub). */
export const HUB_IMPAIRED_OTP_BELOW = 70;

/** A hub with this share of today's departures confirmed canceled is impaired (the brief's `cxl.<HUB>` watch line). */
export const HUB_IMPAIRING_CANCEL_RATE = 0.1;

/** Fewer confirmed cancellations than this at one hub is not a rate worth reading (the brief's `cxl.<HUB>` floor). */
export const HUB_CANCEL_MIN_CONFIRMED = 3;

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
 * inches from the ticker's "Disrupted: ground stop for flights into EWR". This returns the worst active
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

/**
 * True when one FAA program or delay entry impairs the hub it is listed at: a ground delay program,
 * or departure / arrival delays whose reported lower bound (`minDelay`) is HUB_IMPAIRING_FAA_DELAY_MIN
 * or more. A delay with no lower bound (only a maximum, an average or a bare flag) does not.
 * @param {{type?: unknown, reason?: unknown, minDelay?: unknown}|null|undefined} item
 */
export function faaItemImpairsHub(item) {
  const type = normalizeFaaType(item?.type || item?.reason);
  if (type.includes('ground delay') || type.includes('gdp')) return true;
  if (!type.includes('departure delay') && !type.includes('arrival delay')) return false;
  const min = item?.minDelay === null || item?.minDelay === undefined || item?.minDelay === '' ? NaN : Number(item.minDelay);
  return Number.isFinite(min) && min >= HUB_IMPAIRING_FAA_DELAY_MIN;
}

/**
 * Why the FAA picture impairs one hub: 'gdp', 'dep', 'arr' (see faaItemImpairsHub), each at most
 * once. Read from the same /api/faa entry the hub chip reads, minus routine closures.
 * @param {object} faaIndex
 * @param {string} hub
 * @returns {Array<'gdp'|'dep'|'arr'>}
 */
export function hubFaaImpairments(faaIndex, hub) {
  const entry = withoutRoutineClosures(faaIndex?.[hub]);
  if (!entry || typeof entry !== 'object') return [];
  const items = [
    ...(Array.isArray(entry.programs) ? entry.programs : []),
    ...(Array.isArray(entry.delays) ? entry.delays : []),
  ];
  const out = new Set();
  if (entry.groundDelay) out.add('gdp');
  for (const item of items) {
    if (!faaItemImpairsHub(item)) continue;
    const type = normalizeFaaType(item?.type || item?.reason);
    out.add(type.includes('departure delay') ? 'dep' : type.includes('arrival delay') ? 'arr' : 'gdp');
  }
  return ['gdp', 'dep', 'arr'].filter((r) => out.has(/** @type {any} */ (r)));
}

/**
 * The United hubs impaired now, and why (see the table at the top of this file).
 * @param {object} opts
 * @param {Record<string, number>} [opts.hubOtps]  on-time % per hub.
 * @param {Record<string, number>} [opts.hubDayOffsets]  -1 for a hub whose reading is yesterday's
 *   board (defaultSchedDayOffset); a hub missing here is today's.
 * @param {Record<string, number>} [opts.hubCancelRates]  confirmed-canceled share of today's
 *   departures on a current board (hub-health.js hubCancelRates).
 * @param {object} [opts.faaIndex]
 * @param {string[]} [opts.hubCodes]  the United hubs whose FAA programs count.
 * @returns {Record<string, Array<'gdp'|'dep'|'arr'|'otp'|'cxl'>>}  only impaired hubs, in hub order.
 */
export function hubImpairments({ hubOtps = {}, hubDayOffsets = {}, hubCancelRates = {}, faaIndex = {}, hubCodes = [] } = {}) {
  const hubs = [...new Set([...(hubCodes || []), ...Object.keys(hubOtps || {}), ...Object.keys(hubCancelRates || {})])];
  /** @type {Record<string, Array<'gdp'|'dep'|'arr'|'otp'|'cxl'>>} */
  const out = {};
  for (const hub of hubs) {
    /** @type {Array<'gdp'|'dep'|'arr'|'otp'|'cxl'>} */
    const reasons = (hubCodes || []).includes(hub) ? [...hubFaaImpairments(faaIndex, hub)] : [];
    const raw = hubOtps?.[hub];
    const otp = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(otp) && otp < HUB_IMPAIRED_OTP_BELOW && Number(hubDayOffsets?.[hub]) !== -1) reasons.push('otp');
    const rate = Number(hubCancelRates?.[hub]);
    if (Number.isFinite(rate) && rate >= HUB_IMPAIRING_CANCEL_RATE) reasons.push('cxl');
    if (reasons.length) out[hub] = reasons;
  }
  return out;
}

/**
 * "Some Delays" or not, from how widely the network is hurting (the table at the top of this file):
 * two or more impaired hubs; one impaired hub with the IROPS index at NETWORK_WATCH_INDEX_WITH_ONE_HUB
 * or more; or the average on-time reading at 70% or less. The "Disrupted" tests are separate
 * (networkStatus) and unchanged.
 * @param {{impairedHubs: number, iropsScore?: number|null, avgOtp?: number|null}} input
 * @returns {'normal'|'minor'}
 */
export function networkBreadthLevel({ impairedHubs, iropsScore = null, avgOtp = null }) {
  if (impairedHubs >= 2) return 'minor';
  if (impairedHubs === 1 && iropsScore !== null && Number.isFinite(iropsScore) && iropsScore >= NETWORK_WATCH_INDEX_WITH_ONE_HUB) return 'minor';
  if (avgOtp !== null && Number.isFinite(avgOtp) && avgOtp <= 70) return 'minor';
  return 'normal';
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
 * @param {Record<string,number>} [opts.hubOtps]  on-time % per hub, keyed by hub code.
 * @param {object} [opts.faaIndex]  faaDelayIndex ({ code: airportEntry }).
 * @param {string[]} [opts.hubCodes]  UA hub IATA codes whose FAA programs count.
 * @param {number|string|null} [opts.iropsScore]  IROPS severity index (0-100), null when unknown.
 * @param {Record<string,number>} [opts.hubDayOffsets]  -1 for a hub whose reading is yesterday's board.
 * @param {Record<string,number>} [opts.hubCancelRates]  hub-health.js hubCancelRates().
 * @returns {{level:'normal'|'minor'|'significant', severity:'green'|'amber'|'red', label:string,
 *   color:string, avg:number|null, todayAvg:number|null, worstHub:string|null, worstOtp:number|null,
 *   programs:Array<{hub:string, kind:'GS'|'GDP', avgDelay:number|null}>, iropsScore:number|null,
 *   impaired: Record<string, Array<'gdp'|'dep'|'arr'|'otp'|'cxl'>>, impairedHubs: string[]}}
 */
export function networkStatus({ hubOtps = {}, faaIndex = {}, hubCodes = [], iropsScore = null, hubDayOffsets = {}, hubCancelRates = {} } = {}) {
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
  // The average-on-time rule reads today's readings only (Nov 22 2026): yesterday's board never sets
  // "Some Delays", through the average or a hub. The under-50% test below still reads every reading.
  const todayOtps = Object.entries(hubOtps || {})
    .filter(([hub, raw]) => raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(hubDayOffsets?.[hub]) !== -1)
    .map(([, raw]) => Number(raw));
  const todayAvg = todayOtps.length ? Math.round(todayOtps.reduce((a, b) => a + b, 0) / todayOtps.length) : null;

  // ── Disrupted (unchanged): a hub under 50%, a red chip (ground stop / closure), index 40+ ──
  if (worstHub !== null && worstOtp < 50) raise('significant');
  for (const hub of hubCodes) {
    if (hubProgramMarker(faaIndex, hub)?.severity === 'red') raise('significant');
  }
  const n = iropsScore === null || iropsScore === undefined || iropsScore === '' ? NaN : Number(iropsScore);
  const score = Number.isFinite(n) ? n : null;
  if (score !== null && iropsScoreCls(score) === 'high') raise('significant');

  // ── Some Delays: network-wide trouble (networkBreadthLevel) ──
  const impaired = hubImpairments({ hubOtps, hubDayOffsets, hubCancelRates, faaIndex, hubCodes });
  const impairedHubs = Object.keys(impaired);
  raise(networkBreadthLevel({ impairedHubs: impairedHubs.length, iropsScore: score, avgOtp: todayAvg }));

  return {
    level,
    ...LEVEL_PRESENTATION[level],
    avg,
    todayAvg,
    worstHub,
    worstOtp: worstHub === null ? null : worstOtp,
    programs: extractHubPrograms(faaIndex, hubCodes),
    iropsScore: score,
    impaired,
    impairedHubs,
  };
}

/**
 * A hub program as the ticker words it. A ground stop or ground delay program holds flights BOUND
 * FOR the hub, at the airports they leave from, so the text says "for flights into".
 * @param {'GS'|'GDP'} kind
 * @param {string} hub
 * @param {number|null} [avgDelay]
 */
function programPhrase(kind, hub, avgDelay = null) {
  if (kind === 'GS') return `ground stop for flights into ${hub}`;
  const avg = avgDelay ? ` (avg ${Math.round(avgDelay)} min)` : '';
  return `ground delay program for flights into ${hub}${avg}`;
}

/** "EWR", "EWR and IAH", "EWR, IAH and ORD". */
function joinCodes(codes) {
  return codes.length <= 2 ? codes.join(' and ') : `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;
}

/**
 * One impaired hub's trouble in the ticker's words, most concrete reason first: "Ground delay
 * program for flights into EWR (avg 105 min)", "Departure delays at EWR", "EWR on-time 67%",
 * "Cancellations at EWR".
 * @param {string} hub
 * @param {Array<'gdp'|'dep'|'arr'|'otp'|'cxl'>} reasons
 * @param {{programs: Array<{hub: string, kind: string, avgDelay: number|null}>, hubOtps?: Record<string, number>, faaIndex?: object}} ctx
 */
function hubTroublePhrase(hub, reasons, { programs, hubOtps = {}, faaIndex = {} }) {
  if (reasons.includes('gdp')) {
    // The average from the legacy delays list (extractHubPrograms), else from programs[].
    const listed = (Array.isArray(faaIndex?.[hub]?.programs) ? faaIndex[hub].programs : [])
      .find((x) => normalizeFaaType(x?.type || x?.reason).includes('ground delay'));
    const avg = programs.find((x) => x.hub === hub && x.kind === 'GDP')?.avgDelay ?? numOrNull(listed?.avgDelay);
    const text = programPhrase('GDP', hub, avg);
    return text[0].toUpperCase() + text.slice(1);
  }
  if (reasons.includes('dep')) return `Departure delays at ${hub}`;
  if (reasons.includes('arr')) return `Arrival delays at ${hub}`;
  if (reasons.includes('otp')) return `${hub} on-time ${Math.round(Number(hubOtps[hub]))}%`;
  return `Cancellations at ${hub}`;
}

/**
 * Derive the ticker's health state from `networkStatus()`: advisory whenever the network
 * is not normal, with the most specific fact as the text. A ground delay program's text leads
 * with the network level's own word, so it says "Some delays:" while the header pill reads "Some
 * Delays" and "Disrupted:" only when the network is ("Some delays: ground delay program for
 * flights into SFO (avg 62 min)"); a ground stop is always "Disrupted:".
 *
 * At "Smooth Ops" with one hub impaired (Nov 22 2026) there is no advisory, but `note` names that
 * hub's trouble ("Ground delay program for flights into EWR (avg 105 min)"), so the ticker can say
 * it in a plain line instead of "All systems normal" (ticker.js).
 * @param {object} opts  as networkStatus().
 * @returns {{level:'normal'|'advisory', text:string, note?: string}}
 */
export function deriveOpsHealth(opts = {}) {
  const status = networkStatus(opts);
  const { programs, worstHub, worstOtp, iropsScore, todayAvg, impaired, impairedHubs } = status;
  if (status.level === 'normal') {
    const [hub] = impairedHubs;
    if (!hub) return { level: 'normal', text: '' };
    return { level: 'normal', text: '', note: hubTroublePhrase(hub, impaired[hub], { programs, hubOtps: opts.hubOtps, faaIndex: opts.faaIndex }) };
  }
  const prefix = status.level === 'significant' ? 'Disrupted' : 'Some delays';

  const gs = programs.find((p) => p.kind === 'GS');
  if (gs) return { level: 'advisory', text: `Disrupted: ${programPhrase('GS', gs.hub)}` };

  if (worstHub !== null && worstOtp < 50) {
    return { level: 'advisory', text: `Disrupted: ${worstHub} on-time ${Math.round(worstOtp)}%` };
  }

  const gdp = programs.find((p) => p.kind === 'GDP');
  if (gdp) return { level: 'advisory', text: `${prefix}: ${programPhrase('GDP', gdp.hub, gdp.avgDelay)}` };

  // A closure (red chip) with no GS/GDP entry, or a stop listed only under `programs`.
  const red = (opts.hubCodes || [])
    .map((hub) => ({ hub, marker: hubProgramMarker(opts.faaIndex, hub) }))
    .find((m) => m.marker?.severity === 'red');
  if (red) {
    const text = red.marker.label === 'Ground stop' ? programPhrase('GS', red.hub) : `${red.marker.label} at ${red.hub}`;
    return { level: 'advisory', text: `Disrupted: ${text}` };
  }
  if (iropsScore !== null && iropsScoreCls(iropsScore) === 'high') {
    return { level: 'advisory', text: `Elevated irregular ops — IROPS ${iropsScore}/100` };
  }
  // A delay program listed only under `programs` (the amber chip's own reading).
  const amberGdp = (opts.hubCodes || []).find((hub) => hubProgramMarker(opts.faaIndex, hub)?.label === 'Ground delay program');
  if (amberGdp) return { level: 'advisory', text: `${prefix}: ${programPhrase('GDP', amberGdp)}` };

  // Some Delays: network-wide (networkBreadthLevel). The average when it is the reason, else the
  // impaired hubs, with the index when one hub and the index together are the reason.
  if (todayAvg !== null && todayAvg <= 70) return { level: 'advisory', text: `Some delays — hub on-time averaging ${todayAvg}%` };
  if (impairedHubs.length >= 2) return { level: 'advisory', text: `Some delays at ${joinCodes(impairedHubs)}` };
  if (impairedHubs.length === 1) {
    const [hub] = impairedHubs;
    const phrase = hubTroublePhrase(hub, impaired[hub], { programs, hubOtps: opts.hubOtps, faaIndex: opts.faaIndex });
    // "Ground delay program…" → "ground delay program…"; "EWR on-time 67%" keeps its code.
    const lead = /^[A-Z][a-z]/.test(phrase) ? `${phrase[0].toLowerCase()}${phrase.slice(1)}` : phrase;
    return { level: 'advisory', text: `Some delays: ${lead}${iropsScore !== null ? ` — IROPS ${iropsScore}/100` : ''}` };
  }
  return { level: 'advisory', text: 'Some delays' };
}
