import { describe, expect, it } from 'vitest';

import {
  BOARD_FRESHNESS_MIN,
  DELAY_RISK_MODEL_REV,
  PREDICTION_COLUMNS,
  PREDICTION_MODEL_VERSION,
  boardRowFromHistory,
  buildPredictionContext,
  hubMetarStations,
  predictLeg,
} from '../src/lib/delay-prediction.js';
import { observeFlight } from '../src/lib/flight-history.js';
import { HUB_COORDINATES, HUB_RISK_PROFILES, computeDelayRiskModel, riskTimesForRow } from '../src/lib/delay-risk.js';
import { HUB_TZ, getStartOfHubDay } from '../src/lib/hubTz.js';
import { serverFaaResponse } from './fixtures/faa-server-shape.js';

const H = 3600;
// Tue Nov 10 2026, 14:00 EST. EWR's departures board for today.
const NOW_MS = Date.parse('2026-11-10T19:00:00Z');
const NOW_SEC = NOW_MS / 1000;
const EWR_DAY = getStartOfHubDay('EWR', 0, new Date(NOW_MS));

const IFR_TS = 'KORD 101951Z 09015G32KT 2SM TSRA BKN008 OVC015 18/17 A2975 RMK AO2';
const VFR = (id) => `${id} 101953Z 18008KT 10SM FEW200 24/M01 A2992 RMK AO2`;
const metarBody = (except = []) => hubMetarStations().stations
  .filter((id) => !except.includes(id))
  .map((id) => ({ icaoId: id, rawOb: id === 'KORD' ? IFR_TS : VFR(id), fltCat: id === 'KORD' ? 'IFR' : 'VFR' }));
const iropsBody = {
  hubMetrics: {
    EWR: { total: 400, operated: 200, onTime: 100, cancellations: 40, delayed60: 60 },
    ORD: { total: 600, operated: 300, onTime: 270, cancellations: 3, delayed60: 10 },
  },
};
const nasBody = { planned: [{ type: 'terminal', event: 'GROUND STOP', affectedAirports: ['ORD'], time: '2100Z' }] };

const EXPECTED = { generic: { status: { text: 'scheduled', diverted: false }, type: '' }, text: 'expected', icon: '', live: false };
const DELAYED = { generic: { status: { text: 'delayed', diverted: false }, type: '' }, text: 'delayed', icon: 'yellow', live: false };

/** A served EWR departures row, departing `inMin` minutes from NOW, `lateMin` behind on its estimate. */
function boardRow({ no = 'UA1200', d = 'ORD', inMin = 135, lateMin = 40, status = DELAYED } = {}) {
  const sd = NOW_SEC + inMin * 60;
  return {
    identification: { number: { default: no }, callsign: `UAL${no.slice(2)}` },
    status,
    time: {
      scheduled: { departure: sd, arrival: sd + 2.5 * H },
      real: { departure: null, arrival: null },
      estimated: { departure: lateMin ? sd + lateMin * 60 : null, arrival: lateMin ? sd + 2.5 * H + lateMin * 60 : null },
    },
    airport: { origin: { code: { iata: 'EWR' } }, destination: { code: { iata: d } } },
    aircraft: { model: { code: 'B39M', text: '' }, registration: '' },
    _source: { provider: 'aerodatabox', timeSource: {} },
  };
}
/** The archive row the cron would have written for it, observed `ageMin` ago. */
const archived = (flight, ageMin = 20) =>
  observeFlight(flight, { dir: 'departures', hub: 'EWR', observedAtSec: NOW_SEC - ageMin * 60 }).row;

/** The board's own computation (src/app/views/schedule/useBoardModel.ts computeRisk), verbatim inputs. */
function boardScore(flight, ctx) {
  const depHub = 'EWR';
  const arrHub = flight.airport.destination.code.iata;
  const { scheduledTime, comparisonTime, delayBaseTime } = riskTimesForRow(flight);
  return computeDelayRiskModel({
    currentFlightNumber: flight.identification.number.default,
    nowMs: NOW_MS,
    scheduledTime, comparisonTime, delayBaseTime,
    originHub: depHub, destinationHub: arrHub,
    originFaa: ctx.faaIndex[depHub], destinationFaa: ctx.faaIndex[arrHub],
    originWeather: ctx.weatherOpsByHub[depHub], destinationWeather: ctx.weatherOpsByHub[arrHub],
    originOtp: ctx.hubOtp[depHub],
    timeZone: HUB_TZ[depHub],
    originCoordinates: HUB_COORDINATES[depHub],
    hubProfile: HUB_RISK_PROFILES[depHub],
    originIrops: ctx.iropsHubRates[depHub], destinationIrops: ctx.iropsHubRates[arrHub],
    plannedTmis: ctx.plannedTmis,
  });
}

describe('buildPredictionContext — the board\'s inputs from the four cached endpoints', () => {
  it('shapes FAA, METAR, NAS and IROPS exactly as the dashboard does', async () => {
    const ctx = buildPredictionContext({ faa: await serverFaaResponse(), metar: metarBody(), nas: nasBody, irops: iropsBody });
    expect(ctx.available).toEqual({ faa: true, metar: true, nas: true, irops: true });
    expect(ctx.faaIndex.EWR?.groundStop).toBe(true);
    expect(ctx.weatherOpsByHub.ORD).toMatchObject({ hasThunderstorms: true });
    expect(Object.keys(ctx.weatherOpsByHub).sort()).toEqual(Object.keys(HUB_TZ).sort());
    expect(ctx.hubOtp).toEqual({ EWR: 50, ORD: 90 });
    expect(ctx.iropsHubRates.EWR).toMatchObject({ cancellationRate: 10, delayed60Rate: 15 });
    expect(ctx.plannedTmis).toEqual(nasBody.planned);
  });

  it('a failed request is an unavailable input, never a guess', () => {
    const ctx = buildPredictionContext({ faa: null, metar: { error: 'x' }, nas: null, irops: { ok: true } });
    expect(ctx.available).toEqual({ faa: false, metar: false, nas: false, irops: false });
    expect(ctx.faaIndex).toEqual({});
    expect(ctx.weatherOpsByHub).toEqual({});
    expect(ctx.hubOtp).toEqual({});
  });

  it('asks METAR for the nine hubs in the order refresh-metar warms', () => {
    expect(hubMetarStations().stations.join(',')).toBe('KEWR,KIAH,KORD,KDEN,KSFO,KLAX,KIAD,RJAA,PGUM');
  });
});

describe('predictLeg — the board\'s score, reproduced from the archive row', () => {
  it('equals what the board computes from the original row, hub to hub', async () => {
    const ctx = buildPredictionContext({ faa: await serverFaaResponse(), metar: metarBody(), nas: nasBody, irops: iropsBody });
    const flight = boardRow({ d: 'ORD', lateMin: 40 });
    const board = boardScore(flight, ctx);
    const record = predictLeg(archived(flight), ctx, { nowMs: NOW_MS });
    expect(record).toMatchObject({
      flight_no: 'UA1200', origin: 'EWR', dest: 'ORD', service_date: '2026-11-10',
      score: board.score, band: board.label, lead_min: 135, row_age_min: 20,
      inputs_missing: null, same_inputs_as_board: true, model_version: PREDICTION_MODEL_VERSION,
    });
    expect(record.factors.split(',')).toEqual(board.components.slice(0, 3).map((c) => c.id));
    expect(record.factors).toContain('origin-faa-gs'); // EWR ground stop in the FAA fixture
    expect(Object.keys(record).sort()).toEqual([...PREDICTION_COLUMNS].sort());
  });

  it('a non-hub destination has no cached METAR: same score as a board without it, and it says so', async () => {
    const ctx = buildPredictionContext({ faa: await serverFaaResponse(), metar: metarBody(), nas: nasBody, irops: iropsBody });
    const flight = boardRow({ d: 'BOS' });
    const record = predictLeg(archived(flight), ctx, { nowMs: NOW_MS });
    expect(record.score).toBe(boardScore(flight, ctx).score);
    expect(record).toMatchObject({ inputs_missing: 'dest_weather', same_inputs_as_board: false });
  });

  it('records every missing input and a stale row', () => {
    const ctx = buildPredictionContext({ faa: null, metar: metarBody(['KEWR']), nas: null, irops: null });
    const record = predictLeg(archived(boardRow(), BOARD_FRESHNESS_MIN + 30), ctx, { nowMs: NOW_MS });
    expect(record.inputs_missing).toBe('faa,nas,irops,origin_weather');
    expect(record.row_age_min).toBe(BOARD_FRESHNESS_MIN + 30);
    expect(record.same_inputs_as_board).toBe(false);
  });

  it('only for legs the board would show a prediction for, inside the lead window', () => {
    const ctx = buildPredictionContext({});
    expect(predictLeg(archived(boardRow({ inMin: 60 })), ctx, { nowMs: NOW_MS })).toBeNull(); // too close
    expect(predictLeg(archived(boardRow({ inMin: 200 })), ctx, { nowMs: NOW_MS })).toBeNull(); // too far
    const departed = { ...boardRow(), status: { generic: { status: { text: 'departed', diverted: false }, type: '' }, text: 'departed', live: true } };
    departed.time.real.departure = NOW_SEC - 60;
    expect(predictLeg(archived(departed), ctx, { nowMs: NOW_MS })).toBeNull();
    const canceled = { ...boardRow(), status: { generic: { status: { text: 'canceled', diverted: false }, type: 'canceled' }, text: 'canceled', live: false } };
    expect(predictLeg(archived(canceled), ctx, { nowMs: NOW_MS })).toBeNull();
    const likely = { ...boardRow(), status: { generic: { status: { text: 'canceled_uncertain', diverted: false }, type: 'canceled_uncertain' }, text: 'canceleduncertain', live: false } };
    expect(predictLeg(archived(likely), ctx, { nowMs: NOW_MS })).toBeNull();
    expect(predictLeg(archived(boardRow({ status: EXPECTED, lateMin: 0 })), ctx, { nowMs: NOW_MS })).not.toBeNull();
    expect(predictLeg({ ...archived(boardRow()), origin: 'BOS' }, ctx, { nowMs: NOW_MS })).toBeNull(); // not a hub departure
    expect(predictLeg({ ...archived(boardRow()), sched_dep: null }, ctx, { nowMs: NOW_MS })).toBeNull();
  });

  it('feeds the classifier the hub disruption minutes, as the board meta does', () => {
    const calls = [];
    predictLeg(archived(boardRow()), buildPredictionContext({}), { nowMs: NOW_MS, hubDisruptionMinutes: (hub) => { calls.push(hub); return 45; } });
    expect(calls).toEqual(['EWR']);
  });

  it('boardRowFromHistory puts real times back in `real` and estimates in `estimated`', () => {
    const row = archived(boardRow({ lateMin: 40 }));
    const back = boardRowFromHistory(row);
    expect(back.time.real).toEqual({ departure: null, arrival: null });
    expect(back.time.estimated.departure).toBe(row.dep_at * 60);
    expect(back.time.scheduled.departure).toBe(row.sched_dep * 60);
    expect(back.status.generic.status.text).toBe('delayed');
    expect(boardRowFromHistory({ ...row, status: 'canceleduncertain' }).status.generic.type).toBe('canceled_uncertain');
  });
});

describe('model version guard', () => {
  // computeDelayRiskModel() pinned on fixed inputs. If src/lib/delay-risk.js changes what it scores,
  // this fails: update the pins AND bump DELAY_RISK_MODEL_REV in src/lib/delay-prediction.js (the git
  // short hash of that change), so old and new predictions are never graded as one model.
  const scenarios = [
    { name: 'quiet', input: { originHub: 'ORD', destinationHub: 'LGA', scheduledTime: EWR_DAY + 9 * H, nowMs: (EWR_DAY + 7 * H) * 1000, timeZone: 'America/Chicago' } },
    { name: 'late evening, 45 min behind', input: { originHub: 'EWR', destinationHub: 'SFO', scheduledTime: EWR_DAY + 20 * H, comparisonTime: EWR_DAY + 20.75 * H, delayBaseTime: EWR_DAY + 20 * H, nowMs: (EWR_DAY + 18 * H) * 1000, timeZone: 'America/New_York' } },
    { name: 'ground stop + LIFR + cancellations', input: { originHub: 'SFO', destinationHub: 'EWR', scheduledTime: EWR_DAY + 15 * H, nowMs: (EWR_DAY + 13 * H) * 1000, timeZone: 'America/Los_Angeles', originFaa: { groundStop: true, probabilityOfExtension: 'HIGH' }, originWeather: { level: 'severe', fltCat: 'LIFR', reasons: ['fog'], gustKt: 0, tempC: 10 }, originIrops: { cancellationRate: 16, delayed60Rate: 25 }, originOtp: 45 } },
  ];
  const pins = {
    quiet: { score: 4, ids: ['hub-profile'] },
    'late evening, 45 min behind': { score: 44, ids: ['actual-delay', 'time-of-day', 'hub-profile'] },
    'ground stop + LIFR + cancellations': {
      score: 97,
      ids: ['origin-faa-gs', 'origin-weather-lifr', 'origin-irops-cancel', 'compound-severe', 'origin-weather-level', 'origin-otp', 'origin-faa-gs-ext', 'hub-profile', 'origin-irops-delay'],
    },
  };

  it(`delay-risk.js still scores as ${DELAY_RISK_MODEL_REV} did`, () => {
    for (const { name, input } of scenarios) {
      const out = computeDelayRiskModel(input);
      expect({ score: out.score, ids: out.components.map((c) => c.id) }, `${name}: delay-risk.js changed — bump DELAY_RISK_MODEL_REV`).toEqual(pins[name]);
    }
  });
});
