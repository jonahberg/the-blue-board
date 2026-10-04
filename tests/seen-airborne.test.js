// v1.12.0 — a "Likely Canceled" row the live feed saw fly reads as flown on every surface: the
// board (classifySchedStatus → displayScheduleStatus), the stat strip (computeScheduleStatCounts),
// the client IROPS fallback (countIropsFromRows) and the watch alerts (in-tab and the push cron).
import { describe, expect, it } from 'vitest';

import { classifySchedStatus } from '../src/lib/schedule-status.js';
import { displayScheduleStatus } from '../src/lib/status-display.js';
import { computeScheduleStatCounts } from '../src/lib/board-stats.js';
import { countIropsFromRows } from '../src/lib/irops-client.js';
import { applySightingsToBoard } from '../src/lib/reg-overlay.js';
import { isSignificantStatusChange } from '../src/lib/watch-utils.js';
import { evaluateWatch, isUnknownStatus } from '../api/_watch-diff.js';
import { mapAeroStatus } from '../api/_schedule-aerodatabox.js';

const NOW = 1_791_070_000; // Oct 3 2026, 23:46Z — unix seconds
const H = 3600;

function row({ ident = 'UA1094', schedDep = NOW - 4 * H, schedArr = NOW - 1 * H, status = mapAeroStatus('CanceledUncertain') } = {}) {
  return {
    identification: { number: { default: ident } },
    airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'DEN' } } },
    aircraft: { registration: 'N12345' },
    status,
    time: { scheduled: { departure: schedDep, arrival: schedArr }, real: {}, estimated: {} },
  };
}
const sightings = (seenAtSec, over = {}) =>
  new Map([['UA1094', { reg: 'N12345', origin: 'ORD', dest: 'DEN', seenAtMs: seenAtSec * 1000, airborneAtMs: seenAtSec * 1000, ...over }]]);
const overlay = (fl, seenAtSec, dir = 'departures', over) =>
  applySightingsToBoard({ dir, flights: [fl] }, sightings(seenAtSec, over), NOW * 1000).flights[0];

describe('classifySchedStatus — seen airborne', () => {
  it('an unseen Likely Canceled is still Likely Canceled', () => {
    expect(classifySchedStatus(row(), 'departures', NOW).key).toBe('canceled_uncertain');
  });

  it('seen only on the ground (a taxiway hold) is still Likely Canceled', () => {
    const held = overlay(row(), NOW - 2 * H, 'departures', { airborneAtMs: null });
    expect(classifySchedStatus(held, 'departures', NOW).key).toBe('canceled_uncertain');
  });

  it('departures: Departed, flagged seen — not presumed, not a cancellation', () => {
    const s = classifySchedStatus(overlay(row(), NOW - 2 * H), 'departures', NOW);
    expect(s).toMatchObject({ key: 'departed', cls: 'departed', text: 'Departed', seen: true });
    expect(s.presumed).toBeUndefined();
    expect(s.inferred).toBeUndefined();
    expect(s.live).toBeUndefined();
  });

  it('departures: a sighting minutes old reads Departed · LIVE', () => {
    const s = classifySchedStatus(overlay(row(), NOW - 300), 'departures', NOW);
    expect(s).toMatchObject({ key: 'departed', live: true, seen: true });
  });

  it('arrivals: En Route while the arrival is not due; LIVE when the sighting is fresh', () => {
    const due = row({ schedArr: NOW + 2 * H });
    expect(classifySchedStatus(overlay(due, NOW - 2 * H, 'arrivals'), 'arrivals', NOW))
      .toMatchObject({ key: 'enroute', text: 'En Route', seen: true });
    expect(classifySchedStatus(overlay(due, NOW - 120, 'arrivals'), 'arrivals', NOW))
      .toMatchObject({ key: 'enroute', live: true, seen: true });
  });

  it('arrivals: Landed* (presumed) once the arrival is well past — a sighting never invents a landing time', () => {
    const s = classifySchedStatus(overlay(row({ schedArr: NOW - 3 * H }), NOW - 4 * H + 1800, 'arrivals'), 'arrivals', NOW);
    expect(s).toMatchObject({ key: 'landed', presumed: true, inferred: true, seen: true });
  });
});

describe('displayScheduleStatus — a seen row says why', () => {
  it('passes seen through and never claims "no live update"', () => {
    const d = displayScheduleStatus({ text: 'Departed', cls: 'departed', key: 'departed', seen: true });
    expect(d).toMatchObject({ text: 'Departed', seen: true, presumed: false });
    const landed = displayScheduleStatus({ text: 'Landed', cls: 'landed', key: 'landed', presumed: true, inferred: true, seen: true });
    expect(landed).toMatchObject({ presumed: true, seen: true });
  });
  it('rows that were not seen carry seen:false', () => {
    expect(displayScheduleStatus({ text: 'Departed', cls: 'departed', key: 'departed' }).seen).toBe(false);
  });
});

describe('stat strip + client IROPS fallback', () => {
  const flights = () => [overlay(row(), NOW - 2 * H), row({ ident: 'UA2000' })];
  it('the seen row leaves the Canceled card', () => {
    const c = computeScheduleStatCounts(flights(), { dir: 'departures', nowSec: NOW });
    expect(c.canceled).toBe(1);
    expect(c.canceledUncertain).toBe(1);
    expect(c.total).toBe(c.onTime + c.late + c.upcoming + c.canceled + c.presumed + c.uncategorized);
  });
  it('the client fallback counts only the unseen one, and reports it as likely', () => {
    const rows = flights().map((fl) => ({ fl, dir: 'departures', key: 'ORD-departures-0' }));
    const c = countIropsFromRows(rows, { classify: (fl, dir) => classifySchedStatus(fl, dir, NOW) });
    expect(c.cancellations).toBe(1);
    expect(c.cancellationsLikely).toBe(1);
    expect(c.likelyCanceledSeenFlying).toBe(1);
  });
});

describe('watch alerts never push a cancellation for the soft state', () => {
  // The push engine now takes the /api/flight-times payload for the watch's pinned leg (api/_watch-diff.ts
  // evaluateWatch) instead of a bare status word (diffWatch); the three rules below are unchanged.
  const DEP = '2026-10-03T22:00:00.000Z';
  const leg = (status, extra = {}) => ({
    success: true, status, cancelled: status === 'canceled', diverted: false,
    origin: { iata: 'EWR', gate: '' }, destination: { iata: 'ORD' }, registration: '',
    departure: { gate: { scheduled: DEP, estimated: '', actual: '' }, takeoff: {} },
    arrival: { gate: {}, landing: {} }, ...extra,
  });
  const watching = () => evaluateWatch({ flight: 'UA1094' }, leg('expected'), Date.parse(DEP) - 3600e3).next;
  const later = Date.parse(DEP) + 3600e3;
  it('push cron: canceled_uncertain is not a flight event (no notify, not stored)', () => {
    expect(isUnknownStatus('canceled_uncertain')).toBe(true);
    expect(isUnknownStatus('Likely Canceled')).toBe(true);
    const d = evaluateWatch(watching(), leg('canceled_uncertain'), later);
    expect(d.notify).toBe(false);
    expect(d.next.lastStatus).toBe('expected');
  });
  it('push cron: the seen-airborne row resolves departed — a departure, not a cancellation', () => {
    const d = evaluateWatch(watching(), leg('departed'), later);
    expect(d.notify).toBe(true);
    expect(d.kind).toBe('departed');
    expect(d.title).toBe('UA1094 departed EWR');
  });
  it('push cron: a CONFIRMED cancellation still pushes', () => {
    expect(evaluateWatch(watching(), leg('canceled'), later).kind).toBe('cancelled');
  });
  it('in-tab: entering Likely Canceled does not alert; leaving it does', () => {
    expect(isSignificantStatusChange('Scheduled', 'Likely Canceled')).toBe(false);
    expect(isSignificantStatusChange('Likely Canceled', 'Departed')).toBe(true);
    expect(isSignificantStatusChange('Likely Canceled', 'Canceled')).toBe(true);
    expect(isSignificantStatusChange('Scheduled', 'Canceled')).toBe(true);
  });
});
