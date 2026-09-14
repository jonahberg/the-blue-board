import { describe, it, expect } from 'vitest';

import {
  MAX_CONNECTION_MINUTES,
  buildConnectionIndex,
  computeConnectionRisk,
  connectionContextStr,
  connectionDetailLine,
  findWatchedConnections,
  manualConnectionOutcome,
  normalizeConnectionFlight,
} from '../src/lib/connection-pairing.js';

const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];

/** A minimal /api/flight-times payload. */
function td(overrides = {}) {
  return {
    success: true,
    origin: { iata: 'DEN' },
    destination: { iata: 'ORD' },
    departure: { gate: {} },
    arrival: { gate: {} },
    ...overrides,
  };
}

const T = (hhmm) => `2026-09-13T${hhmm}:00Z`;

describe('findWatchedConnections', () => {
  const inbound = td({
    origin: { iata: 'DEN' },
    destination: { iata: 'ORD' },
    arrival: { gate: { scheduled: T('14:00') } },
  });
  const outbound = td({
    origin: { iata: 'ORD' },
    destination: { iata: 'BOS' },
    departure: { gate: { scheduled: T('15:30') } },
  });
  const watches = [{ flight: 'UA100' }, { flight: 'UA200' }];

  it('pairs an arrival with a departure from the same hub', () => {
    const found = findWatchedConnections(watches, [inbound, outbound], HUBS);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ hub: 'ORD', minutes: 90 });
    expect(found[0].inbound.w.flight).toBe('UA100');
    expect(found[0].outbound.w.flight).toBe('UA200');
  });

  it('never pairs a flight with itself', () => {
    expect(findWatchedConnections([watches[0]], [inbound], HUBS)).toHaveLength(0);
  });

  it('ignores a meeting point that is not a United hub', () => {
    const viaAus = td({
      origin: { iata: 'DEN' },
      destination: { iata: 'AUS' },
      arrival: { gate: { scheduled: T('14:00') } },
    });
    const fromAus = td({
      origin: { iata: 'AUS' },
      destination: { iata: 'BOS' },
      departure: { gate: { scheduled: T('15:30') } },
    });
    expect(findWatchedConnections(watches, [viaAus, fromAus], HUBS)).toHaveLength(0);
  });

  it('rejects a gap that is zero, negative, or longer than the cap', () => {
    const departsBefore = { ...outbound, departure: { gate: { scheduled: T('13:00') } } };
    expect(findWatchedConnections(watches, [inbound, departsBefore], HUBS)).toHaveLength(0);

    const sameMinute = { ...outbound, departure: { gate: { scheduled: T('14:00') } } };
    expect(findWatchedConnections(watches, [inbound, sameMinute], HUBS)).toHaveLength(0);

    // 9 hours — a separate trip, not a connection.
    const nextDay = { ...outbound, departure: { gate: { scheduled: T('23:00') } } };
    expect(findWatchedConnections(watches, [inbound, nextDay], HUBS)).toHaveLength(0);
    expect(MAX_CONNECTION_MINUTES).toBe(480);
  });

  it('skips a leg with no payload, a failed payload or no gate times', () => {
    expect(findWatchedConnections(watches, [inbound, null], HUBS)).toHaveLength(0);
    expect(
      findWatchedConnections(watches, [inbound, { ...outbound, success: false }], HUBS),
    ).toHaveLength(0);
    expect(
      findWatchedConnections(watches, [inbound, { ...outbound, departure: { gate: {} } }], HUBS),
    ).toHaveLength(0);
  });

  it('prefers the estimated gate time over the scheduled one', () => {
    const late = {
      ...inbound,
      arrival: { gate: { scheduled: T('14:00'), estimated: T('15:00') } },
    };
    expect(findWatchedConnections(watches, [late, outbound], HUBS)[0].minutes).toBe(30);
  });

  it('finds both directions of a round trip', () => {
    const back = td({
      origin: { iata: 'ORD' },
      destination: { iata: 'DEN' },
      arrival: { gate: { scheduled: T('20:00') } },
      departure: { gate: { scheduled: T('16:00') } },
    });
    const out = td({
      origin: { iata: 'DEN' },
      destination: { iata: 'ORD' },
      arrival: { gate: { scheduled: T('14:00') } },
      departure: { gate: { scheduled: T('11:00') } },
    });
    expect(findWatchedConnections(watches, [out, back], HUBS)).toHaveLength(1);
  });
});

describe('computeConnectionRisk', () => {
  function conn(overrides = {}) {
    return {
      hub: 'ORD',
      inbound: {
        w: { flight: 'UA100' },
        td: td({
          origin: { iata: 'DEN' },
          destination: { iata: 'ORD', terminal: '1' },
          arrival: { gate: { scheduled: T('14:00') } },
        }),
      },
      outbound: {
        w: { flight: 'UA200' },
        td: td({
          origin: { iata: 'ORD', terminal: '1' },
          destination: { iata: 'BOS' },
          departure: { gate: { scheduled: T('16:30') } },
        }),
      },
      ...overrides,
    };
  }

  it('scores a roomy same-terminal domestic connection SAFE', () => {
    const risk = computeConnectionRisk(conn());
    expect(risk).toMatchObject({
      state: 'scored',
      risk: 'SAFE',
      mct: 75, // ORD dd
      walkTime: 5, // same terminal
      connectionMin: 150,
      buffer: 145,
      inTerminal: '1',
      outTerminal: '1',
    });
  });

  it('uses the international MCT when either end is international', () => {
    const intl = conn();
    intl.outbound.td.destination = { iata: 'FRA' };
    expect(computeConnectionRisk(intl).mct).toBe(120); // ORD di
  });

  it('charges a terminal-pair walk when the concourses differ', () => {
    const split = conn();
    split.outbound.td.origin = { iata: 'ORD', terminal: '5' };
    expect(computeConnectionRisk(split)).toMatchObject({ walkTime: 20, outTerminal: '5' });
  });

  it('falls back to the United hub terminal when the feed publishes none', () => {
    const noTerms = conn();
    noTerms.inbound.td.destination = { iata: 'ORD' };
    noTerms.outbound.td.origin = { iata: 'ORD' };
    expect(computeConnectionRisk(noTerms)).toMatchObject({ inTerminal: '1', outTerminal: '1' });
  });

  it('never returns SAFE for a cancelled or diverted leg', () => {
    const cancelled = conn();
    cancelled.inbound.td.cancelled = true;
    const risk = computeConnectionRisk(cancelled);
    expect(risk.state).toBe('disrupted');
    expect(risk.risk).toBe('AT RISK');
    expect(risk.label).toContain('UA100');
  });

  it('never returns SAFE when a gate time is missing', () => {
    const blind = conn();
    blind.inbound.td.arrival = { gate: {} };
    const risk = computeConnectionRisk(blind);
    expect(risk.state).toBe('insufficient');
    expect(risk.risk).toBe('NO DATA');
  });

  it('calls a sub-half-MCT buffer HIGH', () => {
    const tight = conn();
    tight.outbound.td.departure = { gate: { scheduled: T('14:30') } };
    expect(computeConnectionRisk(tight).risk).toBe('HIGH');
  });

  it('calls an inbound that lands after the outbound leaves MISSED', () => {
    const missed = conn();
    missed.outbound.td.departure = { gate: { scheduled: T('13:00') } };
    expect(computeConnectionRisk(missed).risk).toBe('MISSED');
  });
});

describe('buildConnectionIndex / connectionContextStr', () => {
  const connections = [
    {
      hub: 'ORD',
      inbound: { w: { flight: 'UA100' }, td: td({ origin: { iata: 'DEN' } }) },
      outbound: { w: { flight: 'UA200' }, td: td({ destination: { iata: 'BOS' } }) },
    },
  ];
  const risks = [{ connectionMin: 90, risk: 'SAFE', label: 'Comfortable connection' }];

  it('indexes BOTH legs so either flight knows about the other', () => {
    const index = buildConnectionIndex(connections, risks);
    expect(Object.keys(index).sort()).toEqual(['UA100', 'UA200']);
    expect(index.UA100).toMatchObject({ connFlight: 'UA200', dest: 'BOS', minutes: 90 });
    expect(index.UA200).toMatchObject({ connFlight: 'UA100', orig: 'DEN', isOutbound: true });
  });

  it('writes the connection sentence from each leg’s point of view', () => {
    const index = buildConnectionIndex(connections, risks);
    expect(connectionContextStr(index.UA100)).toBe(
      'Connects to UA200 ORD→BOS, 90min layover (SAFE)',
    );
    expect(connectionContextStr(index.UA200)).toBe(
      'Connecting from UA100 via ORD, 90min layover (SAFE)',
    );
  });

  it('says nothing when there is no connection', () => {
    expect(connectionContextStr(null)).toBe('');
  });
});

describe('connectionDetailLine', () => {
  it('keeps the honesty clause about our padded MCT', () => {
    const line = connectionDetailLine({
      state: 'scored',
      hasData: true,
      connectionMin: 90,
      mct: 75,
      inTerminal: '1',
      outTerminal: '2',
      walkTime: 8,
      buffer: 82,
    });
    expect(line.text).toContain("our conservative guidance — United's published MCT is lower");
    expect(line.text).toContain('90min connection');
    expect(line.text).toContain('T1 → T2');
    expect(line.text).toContain('82min buffer');
  });

  it('asserts no numbers when the connection could not be scored', () => {
    const line = connectionDetailLine({ state: 'insufficient' });
    expect(line.tone).toBe('muted');
    expect(line.text).toContain("don't have gate times");
    expect(line.text).not.toMatch(/\d+min connection/);
  });

  it('tells the passenger to rebook a disrupted leg', () => {
    expect(connectionDetailLine({ state: 'disrupted' }).text).toContain('cancelled or diverted');
  });
});

describe('normalizeConnectionFlight', () => {
  it('normalises what a passenger types', () => {
    expect(normalizeConnectionFlight('ua 328')).toBe('UA328');
    expect(normalizeConnectionFlight('328')).toBe('UA328');
    expect(normalizeConnectionFlight('UAL328')).toBe('UA328');
    expect(normalizeConnectionFlight('')).toBe('');
  });
});

describe('manualConnectionOutcome', () => {
  const ok1 = td({ origin: { iata: 'DEN' }, destination: { iata: 'ORD' } });
  const ok2 = td({ origin: { iata: 'ORD' }, destination: { iata: 'BOS' } });

  it('blames the FEED, not the passenger, when a request failed', () => {
    const out = manualConnectionOutcome(null, ok2, 'UA100', 'UA200');
    expect(out.kind).toBe('outage');
    expect(out.message).toContain('temporarily unavailable');
    expect(out.message).not.toContain('Check the flight numbers');
  });

  it('blames the input only on a genuine not-found', () => {
    const out = manualConnectionOutcome({ ...ok1, success: false }, ok2, 'UA100', 'UA200');
    expect(out.kind).toBe('not-found');
    expect(out.message).toContain('Check the flight numbers');
  });

  it('names both airports when the flights do not meet', () => {
    const elsewhere = td({ origin: { iata: 'SFO' }, destination: { iata: 'BOS' } });
    const out = manualConnectionOutcome(ok1, elsewhere, 'UA100', 'UA200');
    expect(out.kind).toBe('not-connecting');
    expect(out.message).toContain('UA100 arrives at ORD');
    expect(out.message).toContain('UA200 departs from SFO');
  });

  it('builds a scoreable connection when they do meet', () => {
    const out = manualConnectionOutcome(ok1, ok2, 'UA100', 'UA200');
    expect(out.kind).toBe('ok');
    expect(out.conn).toMatchObject({ hub: 'ORD' });
    expect(out.conn.inbound.w).toMatchObject({ flight: 'UA100', route: 'DEN→ORD' });
    expect(out.conn.outbound.w).toMatchObject({ flight: 'UA200', route: 'ORD→BOS' });
  });

  it('reports an outage before a not-found when both are true', () => {
    expect(manualConnectionOutcome(null, { success: false }, 'UA1', 'UA2').kind).toBe('outage');
  });
});
