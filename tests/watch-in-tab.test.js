// In-tab watch alerts follow the push cron's rules (Oct 4 2026 audit finding 4) and hear the My
// Flights polling path as well as Schedule-board reloads (phone QA Oct 4 2026, 390px iOS: six
// watched flights, four landings, no correct alert in 30 minutes; one bogus "UA2059 ROC→ORD:
// En route (was: En Route)" sixteen minutes after it landed, followed by "Glad you landed").
import { describe, it, expect } from 'vitest';
import {
  applyWatchChanges,
  evaluateWatchObservation,
  notificationControlState,
  observationFromBoardRow,
  observationFromFlightTimes,
  watchedFlightLanded,
} from '../src/lib/watch-utils.js';
import { liveFlightForLeg, liveLegOrigin, reconcileLiveArrival } from '../src/lib/my-flights.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';

const DEP = 1_790_000_000; // seconds
const NOW_MS = (DEP + 3 * 3600) * 1000;
const iso = (sec) => new Date(sec * 1000).toISOString();

/** A board row for UA2059 ROC→ORD. */
function row({ generic = 'scheduled', text = 'expected', realDep = null, realArr = null, estDep = null, dep = DEP } = {}) {
  return {
    identification: { number: { default: 'UA2059' } },
    status: { text, icon: '', live: false, generic: { type: '', status: { text: generic, diverted: false } } },
    time: { scheduled: { departure: dep, arrival: dep + 5400 }, estimated: { departure: estDep, arrival: null }, real: { departure: realDep, arrival: realArr } },
    airport: { origin: { code: { iata: 'ROC' } }, destination: { code: { iata: 'ORD' } } },
  };
}
const boardObs = (r, dir = 'arrivals', nowSec = NOW_MS / 1000) => observationFromBoardRow(r, classifySchedStatus(r, dir, nowSec));

/** A /api/flight-times payload for the same leg. */
function td({ status = 'departed', actualDep = iso(DEP + 300), actualArr = '', estDep = '' } = {}) {
  return {
    success: true, flight: 'UA2059', status, cancelled: status === 'canceled', diverted: false,
    origin: { iata: 'ROC', gate: '', tz: 'America/New_York' }, destination: { iata: 'ORD', tz: 'America/Chicago' },
    departure: { gate: { scheduled: iso(DEP), estimated: estDep, actual: actualDep }, takeoff: {} },
    arrival: { gate: { scheduled: iso(DEP + 5400), estimated: '', actual: actualArr }, landing: {} },
    registration: 'N12345',
  };
}
const ORD = { lat: 41.9786, lon: -87.9048 };
const live = (extra) => ({ flightIATA: 'UA2059', callsign: 'UAL2059', origin: 'ROC', dest: 'ORD', reg: 'N12345', alt: 0, spd: 5, vr: 0, onGround: true, ...ORD, ...extra });

/** Apply an evaluation the way the provider does. */
function step(list, obs, nowMs = NOW_MS) {
  const entry = list.find((w) => w.flight === obs.flight);
  const r = evaluateWatchObservation(entry, obs, nowMs);
  return { r, list: r.change ? applyWatchChanges(list, [r.change], nowMs) : list, entry };
}

describe('re-statements never alert (phone QA: "En route (was: En Route)")', () => {
  it('a casing / vocabulary change inside one phase is not news, and is not even written', () => {
    const list = [{ flight: 'UA2059', route: 'ROC→ORD', status: 'En Route', ts: NOW_MS - 60000, dep: DEP }];
    const obs = boardObs(row({ generic: 'en-route', text: 'en route', realDep: DEP + 300 }));
    expect(obs.phase).toBe('departed');
    const { r } = step(list, obs);
    expect(r.notify).toBeNull();
    expect(r.change.status).toBe('En Route');
  });

  it('a row whose KEY says landed alerts "Landed", whatever its provider word says', () => {
    // An FR24-normalized row can be generic 'landed' with the raw word "en route".
    const obs = boardObs(row({ generic: 'landed', text: 'en route', realDep: DEP + 300, realArr: DEP + 5000 }));
    expect(obs).toMatchObject({ phase: 'landed', text: 'Landed' });
    const list = [{ flight: 'UA2059', route: 'ROC→ORD', status: 'En Route', ts: 1, dep: DEP }];
    const { r } = step(list, obs);
    expect(r.notify).toBe('status');
    expect(r.change.status).toBe('Landed');
  });

  it('prefers landed: a stale board row still saying En Route after My Flights saw the landing is quiet', () => {
    let list = [{ flight: 'UA2059', route: 'ROC→ORD', status: 'En Route', ts: 1, dep: DEP }];
    const landed = observationFromFlightTimes(td({ status: 'landed', actualArr: iso(DEP + 5000) }), null, NOW_MS);
    let r;
    ({ r, list } = step(list, landed));
    expect(r.notify).toBe('status');
    ({ r, list } = step(list, boardObs(row({ generic: 'en-route', text: 'enroute', realDep: DEP + 300 }))));
    expect(r.notify).toBeNull();
    expect(list[0].status).toBe('Landed');
  });
});

describe('two sources, one alert (board + My Flights)', () => {
  it('whichever sees the landing first alerts; the other finds nothing new', () => {
    let list = [{ flight: 'UA2059', route: 'ROC→ORD', status: 'Departed', ts: 1, dep: DEP, delayBucket: 0 }];
    const fromPolling = observationFromFlightTimes(td(), live(), NOW_MS); // on the ground at ORD
    expect(fromPolling.phase).toBe('landed');
    let r;
    ({ r, list } = step(list, fromPolling));
    expect(r.notify).toBe('status');
    const fromBoard = boardObs(row({ generic: 'landed', text: 'arrived', realDep: DEP + 300, realArr: DEP + 5000 }));
    ({ r, list } = step(list, fromBoard));
    expect(r.notify).toBeNull();
    ({ r, list } = step(list, fromPolling));
    expect(r.notify).toBeNull();
  });
});

describe('"Glad you landed" only on a real landing transition', () => {
  it('fires on Departed → Landed, never on a re-statement or a repeat', () => {
    const toast = (entry, obs) => {
      const r = evaluateWatchObservation(entry, obs, NOW_MS);
      return r.notify === 'status' && watchedFlightLanded(entry.status, { key: obs.key });
    };
    const landedObs = boardObs(row({ generic: 'landed', text: 'arrived', realDep: DEP + 300, realArr: DEP + 5000 }));
    expect(toast({ flight: 'UA2059', status: 'En Route', dep: DEP }, landedObs)).toBe(true);
    expect(toast({ flight: 'UA2059', status: 'Landed', dep: DEP }, landedObs)).toBe(false);
    expect(toast({ flight: 'UA2059', status: 'En Route', dep: DEP }, boardObs(row({ generic: 'en-route', text: 'en route', realDep: DEP + 300 })))).toBe(false);
    // A time-inferred "Landed" is not an observation at all.
    const presumed = row({ generic: 'scheduled', text: 'expected', dep: DEP - 10 * 3600 });
    expect(boardObs(presumed, 'arrivals')).toBeNull();
  });
});

describe('delays from minutes, in-tab too', () => {
  it('baseline, then 15 → 30 → 60 once each', () => {
    let list = [{ flight: 'UA2059', route: 'ROC→ORD', status: 'Expected', ts: 1 }];
    const seen = [];
    for (const late of [5, 17, 20, 33, 31, 64, 61]) {
      const obs = boardObs(row({ estDep: DEP + late * 60 }), 'departures', DEP - 3600);
      const out = step(list, obs, (DEP - 3600) * 1000);
      list = out.list;
      if (out.r.notify) seen.push([late, out.r.notify]);
    }
    expect(seen).toEqual([[17, 'delay'], [33, 'delay'], [64, 'delay']]);
  });
});

describe('cancellations, in-tab', () => {
  it('Likely Canceled is silent; a confirmed cancellation alerts', () => {
    let list = [{ flight: 'UA2059', route: 'ROC→ORD', status: 'Expected', ts: 1, dep: DEP }];
    let r;
    ({ r, list } = step(list, { flight: 'UA2059', phase: 'likely_canceled', key: 'canceled_uncertain', text: 'Likely Canceled', dep: DEP, delayMin: null, route: 'ROC→ORD' }));
    expect(r.notify).toBeNull();
    ({ r, list } = step(list, { flight: 'UA2059', phase: 'cancelled', key: 'canceled', text: 'Canceled', dep: DEP, delayMin: null, route: 'ROC→ORD' }));
    expect(r.notify).toBe('status');
  });
});

describe('one leg at a time, in-tab (the board twin of finding 2)', () => {
  it('tomorrow\'s leg is ignored while today\'s is under way, then followed silently once it landed', () => {
    let list = [{ flight: 'UA2059', route: 'ROC→ORD', status: 'Departed', ts: 1, dep: DEP }];
    const tomorrow = boardObs(row({ dep: DEP + 86400 }), 'departures', DEP);
    let r;
    ({ r, list } = step(list, tomorrow));
    expect(r.change).toBeNull();
    list = applyWatchChanges(list, [{ flight: 'UA2059', status: 'Landed' }]);
    ({ r, list } = step(list, tomorrow));
    expect(r.notify).toBeNull();
    expect(list[0]).toMatchObject({ status: 'Expected', dep: DEP + 86400 });
    // Yesterday's board after that: an earlier leg, ignored.
    ({ r } = step(list, boardObs(row({ generic: 'landed', text: 'arrived', realDep: DEP + 300, realArr: DEP + 5000 }))));
    expect(r.change).toBeNull();
  });

  it('an entry from before legs were tracked, stamped long ago as Landed, starts on today\'s leg quietly', () => {
    const list = [{ flight: 'UA2059', route: 'ROC→ORD', status: 'Landed', ts: NOW_MS - 20 * 3600e3 }];
    const { r } = step(list, boardObs(row({ dep: DEP + 6 * 3600 }), 'departures'));
    expect(r.notify).toBeNull();
    expect(r.change).toMatchObject({ status: 'Expected', dep: DEP + 6 * 3600 });
  });
});

describe('observationFromFlightTimes (the My Flights polling path)', () => {
  it('live airborne on this route after the departure → departed', () => {
    const obs = observationFromFlightTimes(td({ status: 'scheduled', actualDep: '' }), live({ onGround: false, alt: 30000, spd: 230, lat: 42.5, lon: -80 }), (DEP + 1200) * 1000);
    expect(obs).toMatchObject({ phase: 'departed', text: 'En Route', dep: DEP, route: 'ROC→ORD' });
  });
  it('a live row on another leg of the number says nothing', () => {
    const obs = observationFromFlightTimes(td(), live({ origin: 'ORD', dest: 'MSP' }), NOW_MS);
    expect(obs.phase).toBe('departed');
  });
  it('on the ground at the ORIGIN is not a landing', () => {
    const obs = observationFromFlightTimes(td({ status: 'scheduled', actualDep: '' }), live({ lat: 43.1189, lon: -77.6724 }), (DEP - 600) * 1000);
    expect(obs.phase).toBe('scheduled');
  });
});

describe('My Flights: the right leg, and no ETA on the ground (phone QA, items e)', () => {
  const ua1872 = (origin, dest) => ({ success: true, flight: 'UA1872', status: 'scheduled', origin: { iata: origin }, destination: { iata: dest }, departure: { gate: {} }, arrival: { gate: { estimated: iso(DEP + 9000) } } });
  const cruising = { flightIATA: 'UA1872', origin: 'MCO', dest: 'IAH', onGround: false, alt: 11000, spd: 230, lat: 29.0, lon: -88.0 };
  it('never uses the other leg\'s live row, and says which leg to ask for', () => {
    expect(liveFlightForLeg([cruising], 'UA1872', ua1872('IAH', 'MSP'))).toBeNull();
    expect(liveFlightForLeg([cruising], 'UA1872', ua1872('MCO', 'IAH'))).toBe(cruising);
    expect(liveLegOrigin(ua1872('IAH', 'MSP'), cruising)).toBe('MCO');
    expect(liveLegOrigin(ua1872('MCO', 'IAH'), cruising)).toBe('');
    expect(liveLegOrigin(ua1872('IAH', 'MSP'), { ...cruising, onGround: true })).toBe('');
    // Even handed the wrong row, the reconciler does not compute an ETA from it.
    const wrong = ua1872('IAH', 'MSP');
    expect(reconcileLiveArrival(wrong, cruising, NOW_MS)).toBe(wrong);
  });
  it('on the ground at the destination: landed, ETA clamped to now', () => {
    const out = reconcileLiveArrival(td(), live(), NOW_MS);
    expect(out.status).toBe('landed');
    expect(out.arrival.gate.estimated).toBe(new Date(NOW_MS).toISOString());
    expect(out.arrival.etaSource).toBe('live-ground');
  });
});

describe('notificationControlState (watch panel)', () => {
  const browser = { hasNotification: true, hasPush: true };
  it('offers the button only when asking can work', () => {
    expect(notificationControlState({ configured: true, bootstrapped: true, permission: 'default' }, browser)).toMatchObject({ state: 'available', canEnable: true });
    expect(notificationControlState({ configured: true, bootstrapped: true, permission: 'granted' }, browser)).toMatchObject({ state: 'on', canEnable: false });
    expect(notificationControlState({ configured: false, bootstrapped: true, permission: 'granted' }, browser).state).toBe('tab-only');
  });
  it('says how to unblock, and what iPhone Safari needs', () => {
    const blocked = notificationControlState({ configured: true, bootstrapped: true, permission: 'denied' }, browser);
    expect(blocked.state).toBe('blocked');
    expect(blocked.text).toMatch(/site settings/);
    const ios = notificationControlState({ permission: 'unsupported' }, { hasNotification: false, isIos: true, isStandalone: false });
    expect(ios.state).toBe('ios-home-screen');
    expect(ios.text).toMatch(/Add to Home Screen/);
    expect(notificationControlState({ permission: 'unsupported' }, { hasNotification: false }).state).toBe('unsupported');
  });
});

describe('applyWatchChanges carries the leg and the delay band', () => {
  it('sets dep / delayBucket without a ts bump, and returns the same array when nothing moved', () => {
    const list = [{ flight: 'UA1', route: 'ORD→DEN', status: 'Expected', ts: 5 }];
    const out = applyWatchChanges(list, [{ flight: 'UA1', dep: DEP, delayBucket: 15 }], 99);
    expect(out[0]).toEqual({ flight: 'UA1', route: 'ORD→DEN', status: 'Expected', ts: 5, dep: DEP, delayBucket: 15 });
    expect(applyWatchChanges(out, [{ flight: 'UA1', dep: DEP, delayBucket: 15, status: 'Expected' }], 100)).toBe(out);
  });
});
