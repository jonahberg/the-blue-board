// The flight page's verdict sentence (src/lib/flight-verdict.js): one state per case, each built from
// the REAL UA929 board row (tests/fixtures/flight-page-fixtures.js) changed only where that state
// differs, and run through the board's own classifier and delay evidence. The sentences are pinned
// whole: they are the product, and a reworded one should be a deliberate diff.
import { describe, expect, it } from 'vitest';

import {
  A,
  D,
  canceledCase,
  delayedCase,
  divertedCase,
  inAirCase,
  landedCase,
  likelyCanceledCase,
  scheduledCase,
  ua929Row,
} from './fixtures/flight-page-fixtures.js';
import { dayPhrase, flightLegState, flightVerdict, formatLocalTime, minutesPhrase } from '../src/lib/flight-verdict.js';

const MIN = 60;
const verdict = ({ row, nowSec }) => flightVerdict(row, nowSec, { ident: 'UA929' });

describe('flightVerdict — one sentence per state', () => {
  it('scheduled, with no estimate: "no delay reported", never a promise of on time', () => {
    const v = verdict(scheduledCase());
    expect(v.state).toBe('scheduled');
    expect(v.text).toBe("Scheduled, no delay reported. Leaves Chicago O'Hare at 3:45 PM CST and is due to arrive at London Heathrow at 5:55 AM GMT tomorrow.");
    expect(v.parts.every((p) => !p.tone)).toBe(true);
  });

  it('scheduled with an on-time estimate says "about" for every estimated time', () => {
    const { row, nowSec } = scheduledCase();
    row.time.estimated = { departure: D + 2 * MIN, arrival: A - 4 * MIN };
    const v = flightVerdict(row, nowSec, { ident: 'UA929' });
    expect(v.text).toBe("On time. Expected to leave Chicago O'Hare about 3:47 PM CST, and arrive at London Heathrow about 5:51 AM GMT tomorrow.");
    expect(v.parts[0]).toEqual({ text: 'On time.', tone: 'ok' });
  });

  it('delayed before departure: the size first, both times as estimates, the schedule as the schedule', () => {
    const v = verdict(delayedCase());
    expect(v.state).toBe('delayed');
    expect(v.text).toBe("Delayed about 47 minutes. Now expected to leave Chicago O'Hare about 4:32 PM CST instead of 3:45 PM CST, reaching London Heathrow about 6:35 AM GMT tomorrow.");
    expect(v.parts[0]).toEqual({ text: 'Delayed about 47 minutes.', tone: 'warn' });
  });

  it('in the air: a gate departure is "left the gate", the arrival estimate is "about"', () => {
    const v = verdict(inAirCase());
    expect(v.state).toBe('in-air');
    expect(v.text).toBe("In the air and on time. Left the gate at Chicago O'Hare at 3:48 PM CST and lands at London Heathrow about 5:42 AM GMT tomorrow, 13 minutes early.");
    expect(v.status.map((p) => p.text).join('')).toBe('In the air · on time');
    expect(v.line).toBe('Lands about 5:42 AM GMT tomorrow at London Heathrow');
  });

  it('landed at the gate: an actual, said as one', () => {
    const v = verdict(landedCase());
    expect(v.state).toBe('landed');
    expect(v.text).toBe('Landed 13 minutes early. Arrived at the gate at London Heathrow at 5:42 AM GMT.');
  });

  it('canceled (confirmed)', () => {
    const v = verdict(canceledCase());
    expect(v.state).toBe('canceled');
    expect(v.text).toBe("Canceled. The schedule lists the 3:45 PM CST departure from Chicago O'Hare to London Heathrow as canceled.");
    expect(v.parts[0].tone).toBe('bad');
  });

  it('unconfirmed "likely canceled": never called canceled, and says most still operate', () => {
    const v = verdict(likelyCanceledCase());
    expect(v.state).toBe('likely-canceled');
    expect(v.text).toBe("Possibly canceled, not confirmed. The schedule lists the 3:45 PM CST departure from Chicago O'Hare as likely canceled and the live feed has not seen it fly; most flights listed this way still operate, so check with United.");
    expect(v.parts[0].tone).toBe('warn');
  });

  it('a likely-canceled flight the live feed saw fly is in the air, not canceled', () => {
    const { row, nowSec } = likelyCanceledCase();
    row.status = { icon: '', live: false, text: 'departed', generic: { type: '', status: { text: 'departed', diverted: false } } };
    row._source.seenAirborne = { airborneAt: (D + 20 * MIN) * 1000 };
    const v = flightVerdict(row, D + 60 * MIN, { ident: 'UA929' });
    expect(v.state).toBe('in-air');
    expect(v.text).toContain("The schedule listed it as likely canceled, but the live feed saw it leave Chicago O'Hare.");
  });

  it('diverted', () => {
    const v = verdict(divertedCase());
    expect(v.state).toBe('diverted');
    expect(v.text).toBe("Diverted. It left Chicago O'Hare for London Heathrow but is going to another airport; United will say where.");
  });

  it('not found', () => {
    const v = flightVerdict(null, 0, { ident: 'UA929' });
    expect(v.state).toBe('not-found');
    expect(v.text).toBe("We don't have UA929 on any United hub board right now.");
  });
});

describe('flightVerdict — the time phrase follows the evidence basis', () => {
  it('a runway departure time is "took off", not "left the gate"', () => {
    const { row, nowSec } = inAirCase();
    row._source.timeSource = { ...row._source.timeSource, hasRunwayDep: true, gateDistinctDep: false };
    expect(flightVerdict(row, nowSec).text).toContain("Took off from Chicago O'Hare at 3:48 PM CST");
  });

  it('a real time of unknown kind is "left … at"', () => {
    const { row, nowSec } = inAirCase();
    row._source.timeSource = { hasGateArr: true, hasGateDep: false, hasRunwayArr: false, hasRunwayDep: false };
    expect(flightVerdict(row, nowSec).text).toContain("Left Chicago O'Hare at 3:48 PM CST");
  });

  it('the live feed airborne before the provider "actual" makes it an upper bound: "by", never "at"', () => {
    const { row, nowSec } = inAirCase();
    row.time.real.departure = D + 40 * MIN; // provider says 4:25…
    row._source.track = { airborneAt: (D + 20 * MIN) * 1000 }; // …the feed had it flying at 4:05
    const text = flightVerdict(row, nowSec).text;
    expect(text).toContain("Left Chicago O'Hare by 4:05 PM CST");
    expect(text).not.toContain('at 4:25');
  });

  it('no provider arrival estimate: the board derives one (departure + scheduled block) and it stays "about"', () => {
    const { row, nowSec } = inAirCase();
    row.time.estimated = { departure: null, arrival: null };
    const leg = flightLegState(row, nowSec);
    expect(leg.arrEv.basis).toBe('derived');
    expect(flightVerdict(row, nowSec).text).toContain('lands at London Heathrow about 5:58 AM GMT tomorrow');
  });

  it('no departure time and no arrival forecast: the arrival is the schedule and says so', () => {
    const { row } = inAirCase();
    row.time.real.departure = null;
    row.time.estimated = { departure: null, arrival: null };
    row._source.track = undefined;
    row.live = { seenAt: (D + 60 * MIN) * 1000 };
    const v = flightVerdict(row, D + 70 * MIN);
    expect(v.state).toBe('in-air');
    expect(v.text).toBe("In the air. The live feed has it in the air out of Chicago O'Hare, with no departure time from the schedule yet. It is due at London Heathrow at 5:55 AM GMT tomorrow (scheduled).");
  });

  it('a departure presumed from the clock states no departure time at all', () => {
    const { row } = scheduledCase();
    const v = flightVerdict(row, D + 2 * 3600);
    expect(v.state).toBe('departed-presumed');
    expect(v.text).toBe("Probably departed. It was due to leave Chicago O'Hare at 3:45 PM CST and there has been no live update since; it is scheduled to reach London Heathrow at 5:55 AM GMT tomorrow.");
  });

  it('a touchdown time is "touched down", before taxiing', () => {
    const { row, nowSec } = landedCase();
    row._source.timeSource = { ...row._source.timeSource, hasRunwayArr: true, gateDistinctArr: false };
    expect(flightVerdict(row, nowSec).text).toBe('Landed 13 minutes early. Touched down at London Heathrow at 5:42 AM GMT, before taxiing to the gate.');
  });

  it('landed seen by the live feed, no provider time: no landing time is stated', () => {
    const { row } = inAirCase();
    row._source.track = { airborneAt: (A - 20 * MIN) * 1000, groundAt: (A - 10 * MIN) * 1000, landed: true };
    row.time.estimated = { departure: null, arrival: null };
    const v = flightVerdict(row, A);
    expect(v.state).toBe('landed');
    expect(v.text).toBe('Landed. The live feed saw it on the ground at London Heathrow, with no arrival time from the schedule yet.');
  });

  it('past due with no update is not called on time', () => {
    const { row } = scheduledCase();
    const v = flightVerdict(row, D + 20 * MIN);
    expect(v.state).toBe('overdue');
    expect(v.text).toContain('Past its departure time, no update yet.');
  });

  it('a running-late arrival in the air says how late, toned by the board scale', () => {
    const { row, nowSec } = inAirCase();
    row.time.estimated.arrival = A + 75 * MIN;
    const v = flightVerdict(row, nowSec);
    expect(v.text.startsWith('In the air, running about 75 minutes late.')).toBe(true);
    expect(v.parts.find((p) => p.text === '75 minutes late').tone).toBe('bad');
    expect(v.parts[0]).toEqual({ text: 'In the air' }); // colour only on the punctuality words
  });

  it('an implausible estimate (a cross-day pairing) is not stated as a delay', () => {
    const { row, nowSec } = scheduledCase();
    row.time.estimated = { departure: D + 30 * 3600, arrival: null };
    const v = flightVerdict(row, nowSec);
    expect(v.text).not.toMatch(/Delayed/);
  });
});

describe('flightLegState — the state is read from both sides of the board classifier', () => {
  it('a departures row the arrivals board says landed is landed', () => {
    const { row, nowSec } = landedCase();
    const leg = flightLegState(row, nowSec);
    expect(leg.state).toBe('landed');
    expect(leg.arrEv.basis).toBe('gate');
  });

  it('a boarding word from the provider is boarding', () => {
    const { row, nowSec } = scheduledCase();
    row.status.text = 'boarding';
    row.airport.origin.info.gate = 'C18';
    const v = flightVerdict(row, nowSec);
    expect(v.state).toBe('boarding');
    expect(v.text).toBe("Boarding. Gate C18 at Chicago O'Hare; scheduled to leave at 3:45 PM CST and reach London Heathrow at 5:55 AM GMT tomorrow.");
  });
});

describe('formatting helpers', () => {
  it('labels every time with the airport zone, and an unknown zone as UTC', () => {
    expect(formatLocalTime(D, 'America/Chicago')).toBe('3:45 PM CST');
    expect(formatLocalTime(D, '')).toBe('9:45 PM UTC');
    expect(formatLocalTime(A, 'Europe/London')).toBe('5:55 AM GMT');
  });

  it('says the day only when it is not today at that airport', () => {
    expect(dayPhrase(D, 'America/Chicago', D - 3600)).toBe('');
    expect(dayPhrase(A, 'Europe/London', D)).toBe('tomorrow');
    expect(dayPhrase(D + 3 * 86400, 'America/Chicago', D)).toBe('on Sat, Nov 14');
  });

  it('writes minutes the way a person says them', () => {
    expect(minutesPhrase(1)).toBe('1 minute');
    expect(minutesPhrase(-13)).toBe('13 minutes');
    expect(minutesPhrase(125)).toBe('2 hours 5 minutes');
  });

  it('never claims a time the row does not have', () => {
    const row = ua929Row();
    row.time = { real: {}, estimated: {}, scheduled: {} };
    const v = flightVerdict(row, D);
    expect(v.text).not.toMatch(/\d:\d\d/);
  });
});
