// ═══ WEATHER TAB: HUB CARD MODELS ═══
// Everything the Delays · Weather · Hubs tab decides about a hub BEFORE any markup
// exists: which station to ask for, which flight category to believe, what colour the
// card border and the radar marker take, which status line wins, and which single card
// carries each jargon tooltip.
//
// Extracted from src/dashboard/main.js (:3170-3395 initWeatherTab's card loop,
// :4862-4944 _doPreloadWeatherAndFAA's station collection). The parsers themselves stay
// where they are — this module composes ./metar-explain.js, ./metar-category.js,
// ./faa-context.js and ./delay-explain-context.js, and re-implements none of them.
//
// The colours live here rather than in the TSX because they are DATA (the shipped
// palette, pinned by tests), not presentation choices a Tailwind token could express.

import { describeFaaProgram } from './delay-explain-context.js';
import { explainFAAStatus } from './faa-context.js';
import { computeFlightCategory, computeOpsImpact } from './metar-category.js';
import {
  CAT_COLORS,
  explainMETAR,
  hasRenderableMetarData,
  parseMetarQuick,
  worstCategory,
} from './metar-explain.js';

/**
 * Hub → METAR station. This order is the card order AND the radar-marker order; it is
 * deliberately NOT `HUB_ORDER` (which is the hub-health strip's order).
 * @type {Record<string, string>}
 */
export const HUB_STATIONS = {
  EWR: 'KEWR', IAH: 'KIAH', ORD: 'KORD', DEN: 'KDEN', SFO: 'KSFO',
  LAX: 'KLAX', IAD: 'KIAD', NRT: 'RJAA', GUM: 'PGUM',
};

/** The nine hubs, in card order. */
export const WX_HUBS = Object.keys(HUB_STATIONS);

/** @type {Record<string, string>} */
export const HUB_NAMES = {
  EWR: 'Newark Liberty',
  IAH: 'Houston Intercontinental',
  ORD: "O'Hare International",
  DEN: 'Denver International',
  SFO: "San Francisco Int'l",
  LAX: "Los Angeles Int'l",
  IAD: 'Washington Dulles',
  NRT: 'Tokyo Narita',
  GUM: "Guam Int'l",
};

/** Radar marker colour before any METAR has landed. */
export const NEUTRAL_MARKER_COLOR = '#334155';

/** Card/marker colour for a category outside VFR/MVFR/IFR/LIFR. */
export const UNKNOWN_CAT_COLOR = '#64748b';

/** The legend, top (best) to bottom (worst) — same four colours the markers use. */
export const WX_LEGEND = [
  { cat: 'VFR', color: CAT_COLORS.VFR },
  { cat: 'MVFR', color: CAT_COLORS.MVFR },
  { cat: 'IFR', color: CAT_COLORS.IFR },
  { cat: 'LIFR', color: CAT_COLORS.LIFR },
];

/**
 * Split a watch-list `route` ("ORD→DEN") into its two airport codes.
 * The stored separator is U+2192; a plain "-" or "/" is tolerated because older entries
 * and hand-typed routes both exist in the wild.
 *
 * @param {string|null|undefined} route
 * @returns {string[]} zero, one or two upper-cased codes.
 */
export function routeAirports(route) {
  return String(route || '')
    .split(/[→/>-]/)
    .map((part) => part.trim().toUpperCase())
    .filter((code) => /^[A-Z]{3}$/.test(code));
}

/**
 * Every ICAO station the METAR batch should ask for: the nine hubs first, then the
 * non-hub airports reachable from the watch list and the loaded schedule boards.
 *
 * Hubs go first so a truncated/failed later chunk can never cost the tab its hub cards.
 * A code with no known station (`getStation` returns '') is skipped rather than guessed.
 *
 * @param {Object} input
 * @param {string[]} [input.routes]  watch-list `route` strings.
 * @param {Array<Object>} [input.rows]  loaded schedule-board rows.
 * @param {(iata: string) => string} input.getStation  getMetarStationForIata.
 * @returns {{stations: string[], stationToKey: Record<string, string>}}
 *   `stationToKey` maps an ICAO station back to the hub code or non-hub IATA it stands for.
 */
export function collectMetarStations({ routes = [], rows = [], getStation }) {
  /** @type {Record<string, string>} */
  const stationToKey = {};
  const stations = [];
  for (const hub of WX_HUBS) {
    stations.push(HUB_STATIONS[hub]);
    stationToKey[HUB_STATIONS[hub]] = hub;
  }

  const extras = new Map();
  const addExtra = (iata) => {
    const code = String(iata || '').trim().toUpperCase();
    if (!code || code.length !== 3 || HUB_STATIONS[code]) return;
    if (extras.has(code)) return;
    const station = getStation(code);
    if (!station) return;
    extras.set(code, station);
  };

  for (const route of routes) for (const code of routeAirports(route)) addExtra(code);
  for (const row of rows) {
    addExtra(row?.airport?.origin?.code?.iata);
    addExtra(row?.airport?.destination?.code?.iata);
  }

  for (const [code, station] of extras) {
    if (stationToKey[station]) continue;
    stations.push(station);
    stationToKey[station] = code;
  }

  return { stations, stationToKey };
}

/**
 * Index a normalized METAR list by the hub/airport key each station stands for.
 *
 * @param {Array<Object>} records  normalizeMetarPayload() output.
 * @param {Record<string, string>} stationToKey  from collectMetarStations().
 * @returns {Record<string, Object>}
 */
export function indexMetarByKey(records, stationToKey) {
  /** @type {Record<string, Object>} */
  const byKey = {};
  for (const record of records || []) {
    if (!record) continue;
    const station = record.icaoId || record.stationId || record.id;
    const key = stationToKey[station];
    if (key) byKey[key] = record;
  }
  return byKey;
}

/**
 * The METAR-derived ops descriptor the delay-risk engine reads off `weatherOpsByHub`.
 * Shape is a contract with src/lib/delay-risk.js — every field there is read by name.
 *
 * @param {Object} ops  computeOpsImpact() output.
 * @param {string} cat  the resolved flight category.
 */
export function weatherOpsEntry(ops, cat) {
  return {
    level: ops.level,
    reasons: ops.reasons,
    fltCat: cat,
    hasThunderstorms: Boolean(ops.hasThunderstorms),
    hasFreezingPrecip: Boolean(ops.hasFreezingPrecip),
    hasSnow: Boolean(ops.hasSnow),
    hasFog: Boolean(ops.hasFog),
    gustKt: ops.gustKt || 0,
    tempC: ops.tempC === undefined ? null : ops.tempC,
  };
}

/**
 * Resolve one airport's category + ops impact from its METAR record.
 * Used for the hub cards AND for the non-hub airports that only feed `weatherOpsByHub`.
 *
 * @param {Object|null} metar
 * @returns {{raw: string, cat: string, catColor: string, ops: Object, weatherOps: Object, borderColor: string}}
 */
export function resolveWeather(metar) {
  const raw = metar ? metar.rawOb || '' : '';
  const apiCat = metar ? metar.fltCat || metar.fltcat || 'UNK' : 'UNK';
  const cat = worstCategory(apiCat, computeFlightCategory(raw));
  const catColor = CAT_COLORS[cat] || UNKNOWN_CAT_COLOR;
  const ops = computeOpsImpact(raw, cat);
  return {
    raw,
    cat,
    catColor,
    ops,
    weatherOps: weatherOpsEntry(ops, cat),
    // Worst-of: an ops impact always outranks the bare category colour.
    borderColor: ops.level !== 'normal' ? ops.color : catColor,
  };
}

/**
 * @typedef {Object} StatusPart
 * @property {string} [text]  a bare string part (unmapped program, or a raw `delays[]` entry).
 * @property {string} [label]  describeFaaProgram()'s label.
 * @property {string} [window]  describeFaaProgram()'s ` (avg 30m)` clause.
 * @property {string[]} [extras]
 * @property {'gdp'|'groundstop'|null} [jargon]  which tooltip this part may carry.
 */

/**
 * One hub card, fully decided. Nothing in here is markup: the view maps `status.parts`
 * and `metrics` onto components, and `jargon` says which card owns which tooltip.
 *
 * Status precedence (inventory §23): active FAA programs > severe > warning > caution >
 * "✓ Normal Operations".
 *
 * @param {Object} input
 * @param {string} input.hub
 * @param {Object|null} [input.metar]
 * @param {Object|null} [input.faa]  the airport's entry in buildFaaIndex() output.
 */
export function buildHubCardModel({ hub, metar = null, faa = null }) {
  const { raw, cat, catColor, ops, weatherOps, borderColor } = resolveWeather(metar);
  const metrics = parseMetarQuick(metar || raw);
  const hasDelay = Boolean(faa && faa.delays && faa.delays.length > 0);

  /** @type {{tone: 'delay'|'caution'|'normal', prefix: string, parts: StatusPart[]}} */
  let status;
  if (hasDelay) {
    /** @type {StatusPart[]} */
    const parts = [];
    if (faa.programs && faa.programs.length) {
      for (const prog of faa.programs) {
        const { label, window, extras } = describeFaaProgram(prog);
        // Unknown program type with no mapped label → fall back to its raw reason/type.
        if (label === 'Delay' && !prog.type) {
          parts.push({ text: String(prog.reason || prog.type || 'Delay') });
          continue;
        }
        // The jargon gate keys off the PROGRAM TYPE, not the rendered label. main.js
        // compared `label === 'GDP'` / `label === 'Ground Stop'` against
        // describeFaaProgram()'s 'Ground delay program' / 'Ground stop', so neither
        // tooltip could ever fire — inventory §17 lists both call sites, so they are
        // wired to the field that actually identifies the program.
        const jargon =
          prog.type === 'ground_delay' ? 'gdp' : prog.type === 'ground_stop' ? 'groundstop' : null;
        parts.push({ label, window, extras, jargon });
      }
    } else {
      for (const d of faa.delays) parts.push({ text: String(d.reason || d.type || 'Delay') });
    }
    status = { tone: 'delay', prefix: '⚠', parts };
  } else if (ops.level === 'severe') {
    status = { tone: 'delay', prefix: '⚠', parts: [{ text: `Severe Weather Impact — ${ops.reasons.join(', ')}` }] };
  } else if (ops.level === 'warning') {
    status = { tone: 'delay', prefix: '⚠', parts: [{ text: `Weather Advisory — ${ops.reasons.join(', ')}` }] };
  } else if (ops.level === 'caution') {
    status = { tone: 'caution', prefix: '⚠', parts: [{ text: `Weather Caution — ${ops.reasons.join(', ')}` }] };
  } else {
    status = { tone: 'normal', prefix: '✓', parts: [{ text: 'Normal Operations' }] };
  }

  const rc = faa && faa.runwayConfig;
  const runway =
    rc && rc.arrivalRate > 0
      ? `RWY: ${rc.arrivalRunways}/${rc.departureRunways} · ${rc.arrivalRate}/hr`
      : '';

  const explainer = raw ? explainMETAR(raw, hub, cat) : '';
  const faaExplainer = faa ? explainFAAStatus(hub, faa.delays || [], faa) : '';
  const advisoryUrls = faa && faa.programs
    ? faa.programs.map((p) => p.advisoryUrl).filter(Boolean)
    : [];
  const notam = faa && faa.notam ? String(faa.notam) : '';

  return {
    hub,
    name: HUB_NAMES[hub] || hub,
    cat,
    catColor,
    borderColor,
    ops,
    weatherOps,
    metrics,
    runway,
    deice: Boolean(faa && faa.deicing),
    status,
    explainer,
    faaExplainer,
    advisoryUrls,
    notam,
    raw,
    /** No renderable observation at all — the card says so instead of showing "--" four times. */
    unavailable: !hasRenderableMetarData(metar),
    hasDetail: Boolean(explainer || faaExplainer || raw || advisoryUrls.length || notam),
    /** The radar tooltip: "<b>ORD</b> IFR (thunderstorms)". */
    markerLabel: `${cat}${ops.level !== 'normal' ? ` (${ops.reasons[0] || ops.level})` : ''}`,
    jargon: { metar: false },
  };
}

/**
 * Gate each jargon tooltip to its FIRST occurrence across the panel (inventory §17).
 *
 * A pure fold over the ordered cards rather than component state: the same card list
 * always produces the same gating, and re-rendering can never move a tooltip.
 *
 * @param {Array<Object>} models  buildHubCardModel() output, in card order.
 * @returns {Array<Object>} new models with `jargon.metar` and each part's `jargon` set
 *   only on the first card/part that surfaces the term.
 */
export function assignJargonFirsts(models) {
  const used = { metar: false, gdp: false, groundstop: false };
  return (models || []).map((model) => {
    const wantsMetar = Boolean(model.raw) && !used.metar;
    if (wantsMetar) used.metar = true;
    const parts = model.status.parts.map((part) => {
      if (!part.jargon) return part;
      if (used[part.jargon]) return { ...part, jargon: null };
      used[part.jargon] = true;
      return part;
    });
    return { ...model, jargon: { metar: wantsMetar }, status: { ...model.status, parts } };
  });
}

/**
 * The one-line FAA alert strip under the client-fallback IROPS bar.
 * @param {Record<string, Object>} faaIndex
 * @returns {string[]} "ORD: Ground Stop" style lines, in index order.
 */
export function faaAlertLines(faaIndex) {
  const lines = [];
  for (const [code, data] of Object.entries(faaIndex || {})) {
    if (!data || !data.delays || !data.delays.length) continue;
    for (const d of data.delays) lines.push(`${code}: ${d.type || d.reason || 'Delay'}`);
  }
  return lines;
}
