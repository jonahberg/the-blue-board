// Data-quality release (Jul 3 2026 ORD GDP audit) — schedule-status contract tests:
//   #2 CanceledUncertain becomes its own soft state ('canceled_uncertain' / "Likely Canceled" / warn)
//   #3 presumed flag on time-inferred statuses + hubDisruptionMinutes grace extension
//   #6 provider 'Delayed' flows into the dedicated 'delayed' key (Delayed filter no longer empty)
import { describe, expect, it } from 'vitest';

import {
  classifySchedStatus,
  operatedGraceSeconds,
  OPERATED_GRACE_SECONDS,
} from '../src/lib/schedule-status.js';
import { mapAeroStatus } from '../api/_schedule-aerodatabox.js';

const NOW = 2_000_000; // fixed "now" in unix seconds

function flight({ status, schedDep, schedArr, realDep, realArr, estDep, estArr } = {}) {
  return {
    status,
    time: {
      scheduled: { departure: schedDep ?? null, arrival: schedArr ?? null },
      real: { departure: realDep ?? null, arrival: realArr ?? null },
      estimated: { departure: estDep ?? null, arrival: estArr ?? null },
    },
  };
}

describe('mapAeroStatus (AeroDataBox provider mapping)', () => {
  it('maps CanceledUncertain to the soft canceled_uncertain state (yellow, not red)', () => {
    const s = mapAeroStatus('CanceledUncertain');
    expect(s.generic.status.text).toBe('canceled_uncertain');
    expect(s.generic.type).toBe('canceled_uncertain');
    expect(s.icon).toBe('yellow');
    expect(s.live).toBe(false);
  });

  it('keeps plain Canceled as the hard red canceled state', () => {
    const s = mapAeroStatus('Canceled');
    expect(s.generic.status.text).toBe('canceled');
    expect(s.generic.type).toBe('canceled');
    expect(s.icon).toBe('red');
  });

  it("maps provider Delayed to the dedicated 'delayed' key instead of generic 'estimated'", () => {
    const s = mapAeroStatus('Delayed');
    expect(s.generic.status.text).toBe('delayed');
    expect(s.icon).toBe('yellow');
  });
});

describe('classifySchedStatus — canceled_uncertain soft state (#2)', () => {
  it('classifies an ADB CanceledUncertain row as Likely Canceled / warn / canceled_uncertain', () => {
    const fl = flight({ status: mapAeroStatus('CanceledUncertain'), schedDep: NOW + 3600 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('canceled_uncertain');
    expect(s.label).toBe('Likely Canceled');
    expect(s.text).toBe('Likely Canceled');
    expect(s.cls).toBe('warn'); // NOT the red canceled cls
  });

  it('leaves plain Canceled classification completely unchanged', () => {
    const fl = flight({ status: mapAeroStatus('Canceled'), schedDep: NOW + 3600 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('canceled');
    expect(s.cls).toBe('canceled');
  });

  it('does NOT time-infer a canceled_uncertain flight into Departed, even long past', () => {
    const fl = flight({ status: mapAeroStatus('CanceledUncertain'), schedDep: NOW - 8 * 3600 });
    expect(classifySchedStatus(fl, 'departures', NOW).key).toBe('canceled_uncertain');
  });

  it('lets a confirmed real departure time win over the cancellation suspicion', () => {
    const fl = flight({ status: mapAeroStatus('CanceledUncertain'), schedDep: NOW - 7200, realDep: NOW - 3600 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('departed');
    expect(s.inferred).toBeUndefined(); // provider-confirmed, not time-inferred
  });

  it('lets a confirmed real arrival time win on the arrivals board', () => {
    const fl = flight({ status: mapAeroStatus('CanceledUncertain'), schedArr: NOW - 7200, realArr: NOW - 3600 });
    expect(classifySchedStatus(fl, 'arrivals', NOW).key).toBe('landed');
  });
});

describe('classifySchedStatus — presumed flag + disruption-aware grace (#3)', () => {
  it('grace extension math: max(3600, (hubDisruptionMinutes + 60) * 60)', () => {
    expect(operatedGraceSeconds(0)).toBe(OPERATED_GRACE_SECONDS);
    expect(operatedGraceSeconds(undefined)).toBe(OPERATED_GRACE_SECONDS);
    expect(operatedGraceSeconds(null)).toBe(OPERATED_GRACE_SECONDS);
    expect(operatedGraceSeconds(-10)).toBe(OPERATED_GRACE_SECONDS);
    expect(operatedGraceSeconds('garbage')).toBe(OPERATED_GRACE_SECONDS);
    // tiny disruption never SHRINKS the grace below the 60m default
    expect(operatedGraceSeconds(5)).toBe(Math.max(3600, 65 * 60));
    // the real ORD GDP: 293-min average → (293 + 60) * 60 = 21180s (~5.9h)
    expect(operatedGraceSeconds(293)).toBe(21180);
  });

  it('sets presumed:true (alongside inferred:true) on every time-inferred departure', () => {
    const fl = flight({ status: mapAeroStatus('Expected'), schedDep: NOW - 2 * 3600 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('departed');
    expect(s.inferred).toBe(true);
    expect(s.presumed).toBe(true);
  });

  it('sets presumed:true on time-inferred landings (arrivals board) too', () => {
    const fl = flight({ status: mapAeroStatus('Expected'), schedArr: NOW - 2 * 3600 });
    const s = classifySchedStatus(fl, 'arrivals', NOW);
    expect(s.key).toBe('landed');
    expect(s.presumed).toBe(true);
  });

  it('does NOT set presumed on provider-confirmed departures', () => {
    const fl = flight({ status: mapAeroStatus('Departed'), schedDep: NOW - 2 * 3600, realDep: NOW - 3600 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('departed');
    expect(s.presumed).toBeUndefined();
    expect(s.inferred).toBeUndefined();
  });

  it('the UA2610 case: 2h past scheduled during a 293-min GDP stays Scheduled, not false Departed', () => {
    const fl = flight({ status: mapAeroStatus('Expected'), schedDep: NOW - 2 * 3600 });
    // Without disruption context the old behavior infers Departed...
    expect(classifySchedStatus(fl, 'departures', NOW).key).toBe('departed');
    // ...but with the hub's GDP magnitude the grace covers the program: still Scheduled.
    const s = classifySchedStatus(fl, 'departures', NOW, { hubDisruptionMinutes: 293 });
    expect(s.key).toBe('scheduled');
    expect(s.presumed).toBeUndefined();
  });

  it('still infers Departed once past even the EXTENDED grace', () => {
    const grace = operatedGraceSeconds(293); // 21180s
    const fl = flight({ status: mapAeroStatus('Expected'), schedDep: NOW - grace - 1 });
    const s = classifySchedStatus(fl, 'departures', NOW, { hubDisruptionMinutes: 293 });
    expect(s.key).toBe('departed');
    expect(s.presumed).toBe(true);
  });

  it('hubDisruptionMinutes: 0 / omitted opts preserve the exact legacy boundary', () => {
    const atBoundary = flight({ status: mapAeroStatus('Expected'), schedDep: NOW - OPERATED_GRACE_SECONDS });
    expect(classifySchedStatus(atBoundary, 'departures', NOW, { hubDisruptionMinutes: 0 }).key).toBe('scheduled');
    const oneOver = flight({ status: mapAeroStatus('Expected'), schedDep: NOW - OPERATED_GRACE_SECONDS - 1 });
    expect(classifySchedStatus(oneOver, 'departures', NOW, { hubDisruptionMinutes: 0 }).key).toBe('departed');
    expect(classifySchedStatus(oneOver, 'departures', NOW).key).toBe('departed'); // no opts at all
  });
});

describe('classifySchedStatus — provider Delayed key (#6)', () => {
  it("an ADB Delayed row classifies to key 'delayed' (feeds the Delayed filter + Upcoming bucket)", () => {
    const fl = flight({ status: mapAeroStatus('Delayed'), schedDep: NOW + 1800, estDep: NOW + 5400 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('delayed');
    expect(s.cls).toBe('delayed');
  });

  it("a long-past Delayed row still time-infers Departed (key 'delayed' stays reclassifiable)", () => {
    const fl = flight({ status: mapAeroStatus('Delayed'), schedDep: NOW - 6 * 3600 });
    const s = classifySchedStatus(fl, 'departures', NOW);
    expect(s.key).toBe('departed');
    expect(s.presumed).toBe(true);
  });
});
