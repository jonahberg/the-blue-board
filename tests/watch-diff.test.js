import { describe, it, expect } from 'vitest';
import {
  carryWatchState,
  evaluateWatch,
  isSignificantStatusChange,
  isUnknownStatus,
  retireIfDone,
  watchQuery,
  watchQueryKey,
} from '../api/_watch-diff.js';

// A /api/flight-times payload for one leg: ORD→SFO, scheduled out 2026-10-03T18:00Z.
const SCHED_DEP = '2026-10-03T18:00:00.000Z';
const SCHED_DEP_MS = Date.parse(SCHED_DEP);
const min = (n) => n * 60000;
function payload({
  status = 'scheduled',
  gate = 'C12',
  registration = 'N12345',
  aircraft = 'Boeing 737-900',
  estDep = '',
  actualDep = '',
  actualArr = '',
  cancelled = false,
  diverted = false,
  schedDep = SCHED_DEP,
  origin = 'ORD',
  dest = 'SFO',
  evidence,
} = {}) {
  return {
    success: true,
    flight: 'UA123',
    origin: { iata: origin, gate, tz: 'America/Chicago' },
    destination: { iata: dest, gate: '', tz: 'America/Los_Angeles' },
    departure: { gate: { scheduled: schedDep, estimated: estDep, actual: actualDep }, takeoff: { scheduled: '', estimated: '', actual: '' } },
    arrival: { landing: { scheduled: '', estimated: '', actual: '' }, gate: { scheduled: '2026-10-03T22:30:00.000Z', estimated: '', actual: actualArr } },
    aircraft,
    registration,
    status,
    cancelled,
    diverted,
    source: 'schedule-cache',
    ...(evidence ? { evidence } : {}),
  };
}
const NOW = SCHED_DEP_MS - min(60);
/** The entry a first observation of `p` pins. */
function pinned(p = payload(), now = NOW) {
  const ev = evaluateWatch({ flight: 'UA123', addedAt: '2026-10-03T10:00:00Z' }, p, now);
  expect(ev.baseline).toBe(true);
  return ev.next;
}

describe('_watch-diff meaningful-change engine', () => {
  describe('isUnknownStatus', () => {
    it('treats empty / unknown / placeholders as unknown', () => {
      for (const v of ['', '  ', 'Unknown', 'unknown', 'N/A', '—', '-', null, undefined]) {
        expect(isUnknownStatus(v)).toBe(true);
      }
    });
    it('treats real statuses as known', () => {
      for (const v of ['Scheduled', 'Departed', 'En Route', 'Landed', 'Cancelled']) {
        expect(isUnknownStatus(v)).toBe(false);
      }
    });
  });

  describe('isSignificantStatusChange (one rule with src/lib/watch-utils.js)', () => {
    it('notifies Scheduled → Departed', () => {
      expect(isSignificantStatusChange('Scheduled', 'Departed')).toBe(true);
    });
    it('notifies Scheduled → En Route', () => {
      expect(isSignificantStatusChange('Scheduled', 'En Route')).toBe(true);
    });
    it('a "Delayed" WORD is not a phase change (Oct 4 2026, finding 3)', () => {
      // Changed: this used to notify. The provider's literal "delayed" text was on 4 of 2,651
      // departure rows on Oct 3 while 610 left 15+ min late, so delay alerts now come from the
      // estimated departure in minutes (evaluateWatch, below), not from the word.
      expect(isSignificantStatusChange('Scheduled', 'Delayed')).toBe(false);
      expect(isSignificantStatusChange('Scheduled', 'Delayed 45 min')).toBe(false);
    });
    it('notifies on cancellation / diversion / landing', () => {
      expect(isSignificantStatusChange('En Route', 'Cancelled')).toBe(true);
      expect(isSignificantStatusChange('En Route', 'Diverted')).toBe(true);
      expect(isSignificantStatusChange('En Route', 'Landed')).toBe(true);
    });
    it('does not notify on identical status', () => {
      expect(isSignificantStatusChange('Scheduled', 'Scheduled')).toBe(false);
    });
    it('does not notify on provider-vocabulary synonyms for the same phase', () => {
      expect(isSignificantStatusChange('En Route', 'en-route')).toBe(false);
      expect(isSignificantStatusChange('En Route', 'en route')).toBe(false);
      expect(isSignificantStatusChange('Departed', 'En Route')).toBe(false);
      expect(isSignificantStatusChange('Landed', 'landed')).toBe(false);
      expect(isSignificantStatusChange('Landed', 'Arrived')).toBe(false);
    });
    it('"estimated" is PRE-departure: leaving it for En Route is a departure', () => {
      // Changed: the old engine filed "estimated" with the airborne words. api/schedule.ts's FR24
      // normalizer maps estimated/delayed to 'estimated' (a not-yet-departed state) and the board
      // classifier lists it in RECLASSIFIABLE_KEYS, so a flight stored as "estimated" that took
      // off never pushed. Going BACKWARDS (En Route → estimated) still never notifies.
      expect(isSignificantStatusChange('estimated', 'En Route')).toBe(true);
      expect(isSignificantStatusChange('En Route', 'estimated')).toBe(false);
    });
    it('never notifies backwards (the departures board after the arrivals board said landed)', () => {
      expect(isSignificantStatusChange('Landed', 'Departed')).toBe(false);
      expect(isSignificantStatusChange('Landed', 'Scheduled')).toBe(false);
    });
    it('does not notify with empty operands', () => {
      expect(isSignificantStatusChange('', 'Departed')).toBe(false);
      expect(isSignificantStatusChange('Scheduled', '')).toBe(false);
    });
  });

  describe('evaluateWatch', () => {
    it('rule 1: never notifies on a transition INTO unknown, and keeps the last phase', () => {
      const entry = pinned(payload({ status: 'departed', actualDep: '2026-10-03T18:05:00.000Z' }), SCHED_DEP_MS + min(10));
      const r = evaluateWatch(entry, payload({ status: 'Unknown' }), SCHED_DEP_MS + min(20));
      expect(r.notify).toBe(false);
      expect(r.next.phase).toBe('departed');
    });

    it('does not notify on the first observation — it pins the leg silently', () => {
      const r = evaluateWatch({ flight: 'UA123' }, payload(), NOW);
      expect(r.notify).toBe(false);
      expect(r.baseline).toBe(true);
      expect(r.next.legDep).toBe(SCHED_DEP);
      expect(r.next.legOrigin).toBe('ORD');
      expect(r.next.legDate).toBe('2026-10-03');
      expect(r.next.phase).toBe('scheduled');
    });

    it('notifies on Scheduled → Departed', () => {
      const r = evaluateWatch(pinned(), payload({ status: 'departed', actualDep: '2026-10-03T18:04:00.000Z' }), SCHED_DEP_MS + min(10));
      expect(r.notify).toBe(true);
      expect(r.kind).toBe('departed');
      expect(r.title).toBe('UA123 departed ORD');
      expect(r.next.phase).toBe('departed');
      expect(r.log).toMatchObject({ flight: 'UA123', legDate: '2026-10-03', from: 'scheduled', to: 'departed', reason: 'actual-departure', route: 'ORD-SFO' });
    });

    it('does NOT notify on a provider-vocabulary flip for the same phase', () => {
      const entry = pinned(payload({ status: 'en-route', actualDep: '2026-10-03T18:04:00.000Z' }), SCHED_DEP_MS + min(30));
      const r = evaluateWatch(entry, payload({ status: 'departed', actualDep: '2026-10-03T18:04:00.000Z' }), SCHED_DEP_MS + min(35));
      expect(r.notify).toBe(false);
      expect(r.kind).toBe('none');
    });

    it('does NOT duplicate-notify when nothing changed', () => {
      const entry = pinned();
      const r = evaluateWatch(entry, payload(), NOW + min(5));
      expect(r.notify).toBe(false);
      expect(r.kind).toBe('none');
    });

    it('notifies on a departure-gate change between two known gates', () => {
      const r = evaluateWatch(pinned(), payload({ gate: 'C15' }), NOW + min(5));
      expect(r.notify).toBe(true);
      expect(r.kind).toBe('gate');
      expect(r.body).toContain('C12');
      expect(r.body).toContain('C15');
      expect(r.next.lastGate).toBe('C15');
    });

    it('does NOT treat unknown→known gate as a change', () => {
      const entry = pinned(payload({ gate: '' }));
      const r = evaluateWatch(entry, payload({ gate: 'C15' }), NOW + min(5));
      expect(r.notify).toBe(false);
      expect(r.next.lastGate).toBe('C15');
    });

    it('notifies on a registration swap between two known tails', () => {
      const r = evaluateWatch(pinned(), payload({ registration: 'N67890' }), NOW + min(5));
      expect(r.notify).toBe(true);
      expect(r.kind).toBe('equip');
      expect(r.next.reg).toBe('N67890');
    });

    it('a tail assigned where there was none is not a swap (the old type-vs-tail false push)', () => {
      const entry = pinned(payload({ registration: '' }));
      const r = evaluateWatch(entry, payload({ registration: 'N67890' }), NOW + min(5));
      expect(r.notify).toBe(false);
    });

    it('prioritizes a status transition over a simultaneous gate change, and stores both', () => {
      const r = evaluateWatch(pinned(), payload({ status: 'departed', gate: 'C15', actualDep: '2026-10-03T18:04:00.000Z' }), SCHED_DEP_MS + min(10));
      expect(r.kind).toBe('departed');
      expect(r.next.phase).toBe('departed');
      expect(r.next.lastGate).toBe('C15');
    });
  });
});

describe('one watch = one dated leg (finding 2)', () => {
  it('ignores an answer about a different day\'s leg', () => {
    const entry = evaluateWatch(pinned(), payload({ status: 'landed', actualDep: '2026-10-03T18:02:00.000Z', actualArr: '2026-10-03T22:20:00.000Z' }), SCHED_DEP_MS + min(300)).next;
    expect(entry.phase).toBe('landed');
    const tomorrow = payload({ schedDep: '2026-10-04T18:00:00.000Z', registration: 'N99999', gate: 'B4' });
    const r = evaluateWatch(entry, tomorrow, SCHED_DEP_MS + min(400));
    expect(r.notify).toBe(false);
    expect(r.next).toBe(entry);
  });

  it('an unpinned watch that only finds a finished leg waits, silently, without pinning it', () => {
    const r = evaluateWatch({ flight: 'UA123', lastStatus: 'Scheduled' }, payload({ status: 'landed', actualArr: '2026-10-03T22:20:00.000Z' }), SCHED_DEP_MS + min(300));
    expect(r.notify).toBe(false);
    expect(r.baseline).toBe(false);
    expect(r.next.legDep).toBeUndefined();
  });

  it('a legacy (August) entry re-baselines silently on its first evaluation', () => {
    const legacy = { flight: 'UA123', addedAt: '2026-08-14T12:00:00.000Z', lastStatus: 'Landed', lastGate: 'F9', lastEquip: 'N11111' };
    const r = evaluateWatch(legacy, payload({ gate: 'C12', registration: 'N12345' }), NOW);
    expect(r.notify).toBe(false);
    expect(r.baseline).toBe(true);
    expect(r.next.addedAt).toBe(legacy.addedAt);
    expect(r.next.phase).toBe('scheduled');
  });

  it('a legacy entry\'s old gate and tail do not survive the re-baseline (no false gate / swap push)', () => {
    const legacy = { flight: 'UA123', addedAt: '2026-08-14T12:00:00.000Z', lastStatus: 'Landed', lastGate: 'F9', lastEquip: 'N11111' };
    const base = evaluateWatch(legacy, payload({ gate: '', registration: '' }), NOW);
    expect(base.baseline).toBe(true);
    expect(base.next.lastGate).toBeUndefined();
    expect(base.next.lastEquip).toBe('Boeing 737-900');
    const later = evaluateWatch(base.next, payload({ gate: 'C12', registration: 'N12345' }), NOW + min(30));
    expect(later.notify).toBe(false);
    expect(later.next.lastGate).toBe('C12');
  });

  it('records when the pinned leg ended, then retires it quietly', () => {
    const entry = pinned();
    const landedAt = SCHED_DEP_MS + min(270);
    const r = evaluateWatch(entry, payload({ status: 'landed', actualDep: '2026-10-03T18:02:00.000Z', actualArr: '2026-10-03T22:20:00.000Z' }), landedAt);
    expect(r.kind).toBe('landed');
    expect(r.next.terminalAt).toBe(new Date(landedAt).toISOString());
    expect(retireIfDone(r.next, landedAt + min(170))).toBe(r.next);
    const retired = retireIfDone(r.next, landedAt + min(181));
    expect(retired.retired).toBe(true);
    expect(evaluateWatch(retired, payload({ status: 'cancelled', cancelled: true }), landedAt + min(200)).notify).toBe(false);
    // A pinned leg that never resolves again still retires 36 h after its departure.
    expect(retireIfDone(entry, SCHED_DEP_MS + 36 * 3600e3).retired).toBe(true);
  });

  it('asks /api/flight-times for the pinned leg (dep + from), and for the bare flight before that', () => {
    expect(watchQuery({ flight: 'UA123' })).toEqual({ flight: 'UA123' });
    expect(watchQuery({ flight: 'UA123', date: '2026-10-03' })).toEqual({ flight: 'UA123', date: '2026-10-03' });
    const entry = pinned();
    expect(watchQuery(entry)).toEqual({ flight: 'UA123', dep: SCHED_DEP_MS / 1000, from: 'ORD' });
    expect(watchQueryKey(entry)).toBe(`UA123|dep:${SCHED_DEP_MS / 1000}|ORD`);
  });
});

describe('delay alerts from minutes, not words (finding 3)', () => {
  const at = (estMin) => payload({ estDep: new Date(SCHED_DEP_MS + min(estMin)).toISOString() });
  it('alerts at 15, 30, 60, then each further hour — never twice for one band', () => {
    let entry = pinned(at(0));
    const pushes = [];
    for (const late of [10, 16, 22, 34, 29, 33, 45, 61, 75, 59, 125, 130, 190]) {
      const r = evaluateWatch(entry, at(late), NOW + min(1));
      if (r.notify) pushes.push([late, r.kind, r.log.to]);
      entry = r.next;
    }
    expect(pushes).toEqual([
      [16, 'delay', '15m'],
      [34, 'delay', '30m'],
      [61, 'delay', '60m'],
      [125, 'delay', '120m'],
      [190, 'delay', '180m'],
    ]);
  });

  it('a delay already showing when the watch starts is the baseline, not news', () => {
    const entry = pinned(at(40));
    expect(entry.delayBucket).toBe(30);
    expect(evaluateWatch(entry, at(45), NOW + min(1)).notify).toBe(false);
    expect(evaluateWatch(entry, at(62), NOW + min(1)).kind).toBe('delay');
  });

  it('says when it is now expected to leave, in the origin\'s local time', () => {
    const r = evaluateWatch(pinned(at(0)), at(47), NOW + min(1));
    expect(r.title).toBe('UA123 delayed 47 min');
    expect(r.body).toBe('Now expected to leave ORD at 1:47 PM (scheduled 1:00 PM).');
  });

  it('no delay alert once the flight has left — the departure alert covers it', () => {
    const entry = pinned(at(10));
    const r = evaluateWatch(entry, payload({ status: 'departed', estDep: new Date(SCHED_DEP_MS + min(50)).toISOString(), actualDep: new Date(SCHED_DEP_MS + min(50)).toISOString() }), SCHED_DEP_MS + min(55));
    expect(r.kind).toBe('departed');
    expect(r.next.delayBucket).toBe(30);
  });
});

describe('cancellations (v1.12.0 behaviour kept)', () => {
  it('Likely Canceled never pushes and never overwrites what we knew', () => {
    const entry = pinned();
    const r = evaluateWatch(entry, payload({ status: 'canceled_uncertain' }), NOW + min(5));
    expect(r.notify).toBe(false);
    expect(r.next.lastStatus).toBe('scheduled');
  });
  it('a confirmed cancellation pushes, also after a Likely Canceled', () => {
    let entry = pinned();
    entry = evaluateWatch(entry, payload({ status: 'canceled_uncertain' }), NOW + min(5)).next;
    const r = evaluateWatch(entry, payload({ status: 'canceled', cancelled: true }), NOW + min(10));
    expect(r.notify).toBe(true);
    expect(r.kind).toBe('cancelled');
    expect(r.title).toBe('UA123 canceled');
    expect(r.body).toBe('ORD→SFO on 2026-10-03 has been canceled.');
  });
  it('a Likely Canceled the feed saw fly reads departed — a departure, not a cancellation', () => {
    const r = evaluateWatch(pinned(), payload({ status: 'departed', evidence: { kind: 'airborne', airborneAt: '2026-10-03T18:20:00.000Z' } }), SCHED_DEP_MS + min(25));
    expect(r.kind).toBe('departed');
    expect(r.log.reason).toBe('airborne-sighting');
    expect(r.body).toBe('Seen airborne out of ORD, bound for SFO.');
  });
});

describe('carryWatchState (push-subscribe re-posts)', () => {
  it('keeps the pinned state of watches still listed, drops the rest, keeps addedAt', () => {
    const ua1 = { ...pinned(), flight: 'UA1', addedAt: '2026-10-01T00:00:00.000Z' };
    const prior = [ua1, { flight: 'UA2', addedAt: 'x', phase: 'landed' }];
    const next = [{ flight: 'UA1', addedAt: '2026-10-03T12:00:00.000Z' }, { flight: 'UA3', addedAt: '2026-10-03T12:00:00.000Z' }];
    const out = carryWatchState(next, prior);
    expect(out).toHaveLength(2);
    expect(out[0].legDep).toBe(SCHED_DEP);
    expect(out[0].addedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(out[1]).toEqual(next[1]);
  });
  it('matches on flight AND date, and survives junk', () => {
    expect(carryWatchState([{ flight: 'UA1', date: '2026-10-04' }], [{ flight: 'UA1', legDep: 'x' }])[0].legDep).toBeUndefined();
    expect(carryWatchState([{ flight: 'UA1' }], null)).toEqual([{ flight: 'UA1' }]);
    expect(carryWatchState([{ flight: 'UA1' }], [null, 5, 'x'])).toEqual([{ flight: 'UA1' }]);
  });
});
