import { describe, expect, it } from 'vitest';

import { classifySchedStatus, OPERATED_GRACE_SECONDS } from '../src/lib/schedule-status.js';

const NOW = 1_000_000; // fixed "now" in unix seconds for deterministic tests

// Build a normalized schedule flight (api/schedule.ts normalizeSummaryFlight shape).
function flight({ statusText = 'scheduled', text = '', icon = '', live = false, diverted = false, type = '', schedDep, schedArr, realDep, realArr, estDep, estArr } = {}) {
  return {
    status: { generic: { status: { text: statusText, diverted }, type }, text, icon, live },
    time: {
      scheduled: { departure: schedDep ?? null, arrival: schedArr ?? null },
      real: { departure: realDep ?? null, arrival: realArr ?? null },
      estimated: { departure: estDep ?? null, arrival: estArr ?? null },
    },
  };
}

describe('classifySchedStatus — time-aware reclassification', () => {
  it('reclassifies a long-past "scheduled" departure as departed (the EWR pilot bug)', () => {
    // Real case: AeroDataBox left UA1428 (sched 06:52) as status "scheduled"/"expected" with
    // no actual-out time at 22:00. Provider status alone would keep it "Scheduled" forever.
    const fl = flight({ statusText: 'scheduled', text: 'expected', schedDep: NOW - 6 * 3600 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('departed');
    expect(s.inferred).toBe(true);
  });

  it('keeps a genuinely upcoming departure as scheduled', () => {
    const fl = flight({ statusText: 'scheduled', schedDep: NOW + 2 * 3600 });
    expect(classifySchedStatus(fl, 'departures', NOW).key).toBe('scheduled');
  });

  it('does NOT reclassify a delayed flight holding at the gate (future estimated time)', () => {
    // Scheduled 30m ago but estimated 90m in the FUTURE → still waiting, must stay upcoming.
    const fl = flight({ statusText: 'estimated', text: 'estimated', schedDep: NOW - 1800, estDep: NOW + 5400 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('estimated');
    expect(s.inferred).toBeUndefined();
  });

  it('ignores a garbage estimated time that is earlier than scheduled (uses max → scheduled)', () => {
    // Future scheduled, but provider gave an estimated time in the past. max() keeps it upcoming.
    const fl = flight({ statusText: 'scheduled', schedDep: NOW + 2 * 3600, estDep: NOW - 6 * 3600 });
    expect(classifySchedStatus(fl, 'departures', NOW).key).toBe('scheduled');
  });

  it('respects the grace window: 30m past stays scheduled, 90m past becomes departed', () => {
    const justPast = flight({ statusText: 'scheduled', schedDep: NOW - 1800 }); // 30m < 60m grace
    expect(classifySchedStatus(justPast, 'departures', NOW).key).toBe('scheduled');
    const wellPast = flight({ statusText: 'scheduled', schedDep: NOW - 5400 }); // 90m > 60m grace
    expect(classifySchedStatus(wellPast, 'departures', NOW).key).toBe('departed');
    expect(OPERATED_GRACE_SECONDS).toBe(3600);
  });

  it('reclassifies a long-past base "delayed" flight (via the delay-text fallback) too', () => {
    // text "Delayed" with no generic statusText reaches classifyBase's `txtLower.includes('delay')`
    // fallback → key 'delayed', which is also reclassifiable.
    const dep = flight({ statusText: '', text: 'Delayed', schedDep: NOW - 6 * 3600 });
    const sDep = classifySchedStatus(dep, 'departures', NOW);
    expect(sDep.key).toBe('departed');
    expect(sDep.inferred).toBe(true);
    const arr = flight({ statusText: '', text: 'Delayed', schedArr: NOW - 6 * 3600 });
    const sArr = classifySchedStatus(arr, 'arrivals', NOW);
    expect(sArr.key).toBe('landed');
    expect(sArr.inferred).toBe(true);
  });

  it('pins the exact grace boundary (off-by-one)', () => {
    // Exactly at the boundary stays scheduled (eff < now - grace is strict).
    const atBoundary = flight({ statusText: 'scheduled', schedDep: NOW - OPERATED_GRACE_SECONDS });
    expect(classifySchedStatus(atBoundary, 'departures', NOW).key).toBe('scheduled');
    // One second older flips to departed.
    const oneOver = flight({ statusText: 'scheduled', schedDep: NOW - OPERATED_GRACE_SECONDS - 1 });
    expect(classifySchedStatus(oneOver, 'departures', NOW).key).toBe('departed');
  });

  it('reclassifies a long-past "scheduled" arrival as landed on the arrivals board', () => {
    const fl = flight({ statusText: 'scheduled', schedArr: NOW - 6 * 3600 });
    const s = classifySchedStatus(fl, 'arrivals', NOW);
    expect(s.key).toBe('landed');
    expect(s.inferred).toBe(true);
  });

  it('leaves a confirmed departed flight as a non-inferred departed', () => {
    const fl = flight({ statusText: 'departed', live: true, schedDep: NOW - 6 * 3600, realDep: NOW - 5 * 3600 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('departed');
    expect(s.inferred).toBeUndefined();
  });

  it('leaves an en-route (live + real departure) flight as enroute', () => {
    const fl = flight({ statusText: 'en-route', live: true, schedDep: NOW - 2 * 3600, realDep: NOW - 1.5 * 3600 });
    expect(classifySchedStatus(fl, 'departures', NOW).key).toBe('enroute');
  });

  it('does not reclassify canceled/diverted flights even when long past', () => {
    const canceled = flight({ statusText: 'canceled', icon: 'red', type: 'canceled', schedDep: NOW - 6 * 3600 });
    expect(classifySchedStatus(canceled, 'departures', NOW).key).toBe('canceled');
    const diverted = flight({ statusText: 'landed', diverted: true, schedDep: NOW - 6 * 3600 });
    expect(classifySchedStatus(diverted, 'departures', NOW).key).toBe('diverted');
  });

  it('leaves provider status untouched when no time is available to reason about', () => {
    const fl = flight({ statusText: 'scheduled' }); // no scheduled/estimated time
    expect(classifySchedStatus(fl, 'departures', NOW).key).toBe('scheduled');
  });

  it('preserves base classification semantics (unknown status)', () => {
    expect(classifySchedStatus({}, 'departures', NOW).key).toBe('unknown');
  });
});
