// Nov 22 2026: "watch" means trouble that is network-wide (src/lib/ops-health.js networkStatus).
// The owner's acceptance cases as payloads, built from calm-afternoon (Tue Nov 10 2026, 1:40 PM PT:
// every hub at 85% or better, no FAA program, the index 9.8) with only what each case names
// changed. tests/watch-breadth.test.js runs every case; the ones whose words matter are also brief
// fixtures (tests/fixtures/brief/watch-*.json, written from here) so the eval harness can send them
// to the model.
import { readFileSync } from 'node:fs';

const BASE = JSON.parse(readFileSync(new URL('./brief/calm-afternoon.json', import.meta.url), 'utf8'));

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * One FAA program entry as /api/faa serves it.
 * @param {'ground_stop'|'ground_delay'|'departure_delay'|'arrival_delay'|'closure'} type
 * @param {Record<string, unknown>} [extra]
 */
export function program(type, extra = {}) {
  return { type, reason: 'WX:Low Ceilings', ...extra };
}

/**
 * The payloads for one case.
 * @param {object} c
 * @param {string} [c.nowIso]  default: calm-afternoon's 2026-11-10T21:40:00Z
 * @param {number} [c.score]   the disruption index
 * @param {Record<string, number>} [c.otp]  on-time % to set per hub (operated kept, onTime rescaled)
 * @param {Record<string, Array<object>>} [c.faa]  programs per airport (hub or not)
 * @param {Array<object>} [c.planned]  /api/nas operations-plan entries
 * @param {Record<string, {confirmed: number, total?: number}>} [c.cxl]  confirmed cancellations per hub
 * @param {number} [c.airborne]  United flights in the air (the usual is 641)
 */
export function scenario({ nowIso = BASE.nowIso, score = 9.8, otp = {}, faa = {}, planned = [], cxl = {}, airborne } = {}) {
  const sources = clone(BASE.sources);
  const nowMs = Date.parse(nowIso);
  const nowSec = Math.floor(nowMs / 1000);
  sources.irops.score = score;
  for (const [hub, m] of Object.entries(sources.irops.hubMetrics)) {
    // Every board 45 minutes old at `nowIso`, as in calm-afternoon.
    m.generatedAt = nowSec - 2700;
    if (otp[hub] !== undefined) m.onTime = Math.round((m.operated * otp[hub]) / 100);
    if (cxl[hub]) {
      m.cancellations = cxl[hub].confirmed;
      m.cancellationsLikely = 0;
      if (cxl[hub].total) m.total = cxl[hub].total;
    }
  }
  for (const [code, programs] of Object.entries(faa)) {
    let entry = sources.faa.find((a) => a.airportCode === code);
    if (!entry) {
      entry = { airportCode: code, programs: [], runwayConfig: null, deicing: false, notam: null, delays: [] };
      sources.faa.push(entry);
    }
    entry.programs = programs;
    entry.delays = programs.map((p) => ({ reason: p.reason || p.type, type: p.type, avgDelay: p.avgDelay ?? null, minDelay: p.minDelay ?? null, maxDelay: p.maxDelay ?? null, trend: null, endTime: p.endTime ?? null }));
    entry.groundStop = programs.some((p) => p.type === 'ground_stop');
    entry.groundDelay = programs.some((p) => p.type === 'ground_delay');
    entry.departureDelay = programs.some((p) => p.type === 'departure_delay');
    entry.arrivalDelay = programs.some((p) => p.type === 'arrival_delay');
    entry.closure = programs.some((p) => p.type === 'closure');
  }
  sources.nas.planned = planned;
  // Weather and the FAA picture read at `nowIso`.
  for (const rec of sources.metar) rec.obsTime = nowSec - 600;
  sources.asOf = { irops: nowMs - 60_000, faa: nowMs - 60_000, nas: nowMs - 60_000, metar: nowMs - 60_000, air: nowMs - 60_000 };
  if (airborne !== undefined) sources.air = { ...sources.air, airborne };
  return { nowIso, sources };
}

/** A ground delay program for flights into the airport (default end 11:59 PM ET), as the FAA lists one. */
const gdp = (avgDelay, maxDelay, endTime = '2026-11-11T04:59:00Z') => program('ground_delay', { avgDelay, maxDelay, endTime });

/**
 * The owner's acceptance cases (the orchestrator's list, Nov 22 2026), each with the tone it must
 * produce. `fixture` names the brief fixture written from it, when its words are worth a model sample.
 */
export const CASES = [
  {
    id: '1', fixture: 'watch-one-hub-soft-calm', tone: 'calm', impaired: ['EWR'],
    about: 'One hub at 67% on time today, no programs, the index 16 (production, Nov 22 2026 8:40 PM PT)',
    input: { score: 16, otp: { EWR: 67 } },
  },
  {
    id: '2', fixture: 'watch-one-hub-gdp-calm', tone: 'calm', impaired: ['EWR'],
    about: 'One hub with a ground delay program averaging 105 minutes and 67% on time, the index 22: the case the owner may veto',
    input: { score: 22, otp: { EWR: 67 }, faa: { EWR: [gdp(105, 214)] } },
  },
  {
    id: '3', fixture: 'watch-two-hub-gdp', tone: 'watch', impaired: ['EWR', 'SFO'],
    about: 'Ground delay programs at two hubs',
    input: { score: 14, faa: { EWR: [gdp(62, 140)], SFO: [gdp(48, 120, '2026-11-11T07:59:00Z')] } },
  },
  {
    id: '4a', fixture: 'watch-one-hub-gdp-index-31', tone: 'watch', impaired: ['EWR'],
    about: 'One hub with a ground delay program and the index at 31',
    input: { score: 31, faa: { EWR: [gdp(62, 140)] } },
  },
  {
    id: '4b', tone: 'calm', impaired: ['EWR'],
    about: 'One hub with a ground delay program and the index at 29',
    input: { score: 29, faa: { EWR: [gdp(62, 140)] } },
  },
  { id: '5a', tone: 'calm', impaired: [], about: 'The index at 38, no hub impaired', input: { score: 38 } },
  { id: '5b', tone: 'disrupted', impaired: [], about: 'The index at 40 (unchanged)', input: { score: 40 } },
  {
    id: '6', tone: 'calm', impaired: [],
    about: 'Only a possible program later today at a hub',
    input: { planned: [{ time: '', event: 'AFTER 0000\t-EWR GROUND STOP/DELAY PROGRAM POSSIBLE', decoded: 'AFTER 0000\t-EWR GROUND STOP/DELAY PROGRAM POSSIBLE', affectedAirports: ['EWR'], type: 'terminal' }] },
  },
  {
    id: '7', tone: 'calm', impaired: [],
    about: "Two hubs under 70% on YESTERDAY's board at 03:00 hub-local, nothing else",
    input: { nowIso: '2026-11-11T08:00:00Z', otp: { EWR: 62, IAD: 65 } },
  },
  {
    id: '8', fixture: 'watch-nonhub-and-one-hub-gdp-calm', tone: 'calm', impaired: ['EWR'],
    about: 'Delay programs at Las Vegas and San Diego (not hubs) and one at a hub, the index 15',
    input: { score: 15, faa: { LAS: [gdp(40, 95, '2026-11-11T07:59:00Z')], SAN: [gdp(35, 80, '2026-11-11T07:59:00Z')], EWR: [gdp(62, 140)] } },
  },
  {
    id: '9', tone: 'disrupted', impaired: [],
    about: 'A ground stop at a hub (unchanged)',
    input: { faa: { EWR: [program('ground_stop', { endTime: '2026-11-11T01:30:00Z' })] } },
  },
  { id: '10', tone: 'watch', impaired: [], about: 'Far fewer flights in the air than usual, at the watch line (unchanged)', input: { airborne: 400 } },
  {
    id: '11a', tone: 'calm', impaired: [],
    about: 'FAA departure delays of 30 to 44 minutes at two hubs',
    input: { faa: { EWR: [program('departure_delay', { minDelay: 30, maxDelay: 44 })], ORD: [program('departure_delay', { minDelay: 30, maxDelay: 44 })] } },
  },
  {
    id: '11b', fixture: 'watch-two-hub-faa-delays-45', tone: 'watch', impaired: ['ORD', 'EWR'],
    about: 'FAA departure delays of 45 to 59 minutes at two hubs',
    input: { faa: { EWR: [program('departure_delay', { minDelay: 45, maxDelay: 59 })], ORD: [program('departure_delay', { minDelay: 45, maxDelay: 59 })] } },
  },
];
