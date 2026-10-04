import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FR24_FEED_PARAMS,
  UNITED_EXPRESS_AIRLINES,
  feedUrl,
  isEstimatedPosition,
  isUnitedMarketedRow,
  mergeUnitedFeed,
  unitedFeedUrls,
} from '../src/lib/united-feed.js';
import { parseFr24Feed } from '../src/lib/feed-health.js';
import { expressOperatorFeedEnabled, fetchUnitedFeed } from '../api/_united-feed.js';

// FR24 positional rows, shaped like the live feed: [icao24, lat, lon, track, alt, speed, squawk,
// receiver, type, reg, ts, origin, dest, flight, onGround, vspeed, callsign, ?, airline].
function row({ flight, callsign, airline, reg = 'N1', from = 'DEN', to = 'IDA', receiver = 'T-KDEN1', ground = 0 }) {
  return ['abc123', 40.1, -105.2, 270, 31000, 440, '', receiver, 'CRJ7', reg, 1791150000, from, to, flight, ground, 0, callsign, '', airline];
}

// Rows seen on Oct 4 2026 under airline=SKW and NOT under airline=UAL: SkyWest's United flying
// (UA5793 IDA-DEN, …) next to its American and Delta flying, which must stay out.
const SKW_UA = row({ flight: 'UA5793', callsign: 'SKW5793', airline: 'SKW', reg: 'N85377' });
const SKW_UA_ALNUM = row({ flight: 'UA5020', callsign: 'SKW595Y', airline: 'SKW', reg: 'N86311', from: 'ORD', to: 'MGW' });
const SKW_AA = row({ flight: 'AA3412', callsign: 'SKW3412', airline: 'SKW', reg: 'N603SK', from: 'DFW', to: 'MSN' });
const SKW_DL = row({ flight: 'DL3870', callsign: 'SKW3870', airline: 'SKW', reg: 'N441SY', from: 'SLC', to: 'BOI' });
const SKW_NO_NUMBER = row({ flight: '', callsign: 'SKW9001', airline: 'SKW', reg: 'N9001S' });
const GJS = row({ flight: 'G73375', callsign: 'GJS3375', airline: 'GJS', reg: 'N504GJ' });
const UAL_ROW = row({ flight: 'UA1', callsign: 'UAL1', airline: 'UAL', reg: 'N2747U', from: 'SFO', to: 'SIN' });

describe('the United feed requests', () => {
  it('ask for the positions FR24 itself shows: estimated oceanic and FAA surface included', () => {
    for (const p of ['estimated=1', 'gnd=1', 'faa=1', 'satellite=1', 'air=1', 'maxage=14400', 'vehicles=0']) {
      expect(FR24_FEED_PARAMS).toContain(p);
    }
    expect(feedUrl('UAL')).toBe(`https://data-cloud.flightradar24.com/zones/fcgi/feed.js?airline=UAL&${FR24_FEED_PARAMS}`);
  });

  it('is airline=UAL plus every United Express operator, and nobody else', () => {
    expect([...UNITED_EXPRESS_AIRLINES].sort()).toEqual(['ASH', 'AWI', 'GJS', 'RPA', 'SKW', 'UCA']);
    const { united, express } = unitedFeedUrls();
    expect(united).toContain('airline=UAL&');
    expect(express).toContain(`airline=${encodeURIComponent('SKW,RPA,GJS,UCA,ASH,AWI')}&`);
    expect(express).not.toMatch(/airline=[^&]*(UAL|AAL|DAL)/);
  });
});

describe('isUnitedMarketedRow', () => {
  it('keeps United flight numbers (UA…, and G7… — GoJet flies only for United)', () => {
    expect(isUnitedMarketedRow(SKW_UA)).toBe(true);
    expect(isUnitedMarketedRow(SKW_UA_ALNUM)).toBe(true);
    expect(isUnitedMarketedRow(GJS)).toBe(true);
  });

  it("drops SkyWest's American and Delta flying, unnumbered rows and junk", () => {
    expect(isUnitedMarketedRow(SKW_AA)).toBe(false);
    expect(isUnitedMarketedRow(SKW_DL)).toBe(false);
    expect(isUnitedMarketedRow(SKW_NO_NUMBER)).toBe(false);
    expect(isUnitedMarketedRow(row({ flight: 'UAX', callsign: 'SKW1', airline: 'SKW' }))).toBe(false);
    expect(isUnitedMarketedRow(null)).toBe(false);
    expect(isUnitedMarketedRow({ 13: 'UA1' })).toBe(false);
  });
});

describe('mergeUnitedFeed', () => {
  const united = { full_count: 19718, version: 4, ual1: UAL_ROW };

  it('adds the United-numbered operator rows, keeps the United payload and its meta', () => {
    const express = { s1: SKW_UA, s2: SKW_UA_ALNUM, s3: SKW_AA, s4: SKW_DL, s5: SKW_NO_NUMBER, g1: GJS, full_count: 3, version: 4 };
    const { payload, added } = mergeUnitedFeed(united, express);
    expect(added).toBe(3);
    expect(Object.keys(payload).sort()).toEqual(['full_count', 'g1', 's1', 's2', 'ual1', 'version']);
    expect(payload.full_count).toBe(19718); // the operator payload's meta never overwrites United's
    const flights = parseFr24Feed(payload).map((f) => f.flightIATA).sort();
    expect(flights).toEqual(['G73375', 'UA1', 'UA5020', 'UA5793']);
  });

  it('never duplicates a flight already in the United payload, and never mutates its inputs', () => {
    const express = { ual1: UAL_ROW, s1: SKW_UA };
    const before = JSON.stringify(united);
    const { payload, added } = mergeUnitedFeed(united, express);
    expect(added).toBe(1);
    expect(Object.keys(payload).filter((k) => Array.isArray(payload[k]))).toEqual(['ual1', 's1']);
    expect(JSON.stringify(united)).toBe(before);
  });

  it('a missing or malformed operator payload is just the United payload', () => {
    for (const bad of [null, undefined, 'oops', 42]) {
      const { payload, added } = mergeUnitedFeed(united, bad);
      expect(added).toBe(0);
      expect(payload).toEqual(united);
    }
  });
});

describe('isEstimatedPosition', () => {
  it('recognises FR24 projected positions (out of receiver range, over an ocean)', () => {
    expect(isEstimatedPosition('F-EST')).toBe(true);
    expect(isEstimatedPosition('f-est2')).toBe(true);
    expect(isEstimatedPosition('T-KSFO1')).toBe(false);
    expect(isEstimatedPosition(undefined)).toBe(false);
  });
});

describe('fetchUnitedFeed (server readers)', () => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
  const fail = (status) => ({ ok: false, status, json: async () => ({}), text: async () => 'nope' });
  let fetchSpy;

  beforeEach(() => {
    delete process.env.FR24_EXPRESS_OPERATOR_FEED;
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.FR24_EXPRESS_OPERATOR_FEED;
  });

  it('merges the two reads', async () => {
    fetchSpy.mockImplementation(async (url) =>
      String(url).includes('airline=UAL&') ? ok({ ual1: UAL_ROW }) : ok({ s1: SKW_UA, s3: SKW_AA }),
    );
    const payload = await fetchUnitedFeed(5000);
    expect(parseFr24Feed(payload).map((f) => f.flightIATA).sort()).toEqual(['UA1', 'UA5793']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a failed operator read leaves the United read intact', async () => {
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).includes('airline=UAL&')) return ok({ ual1: UAL_ROW });
      throw new Error('operator read down');
    });
    const payload = await fetchUnitedFeed(5000);
    expect(parseFr24Feed(payload).map((f) => f.flightIATA)).toEqual(['UA1']);
  });

  it('a United HTTP error is null (the operator rows alone are not a United sky)', async () => {
    fetchSpy.mockImplementation(async (url) => (String(url).includes('airline=UAL&') ? fail(503) : ok({ s1: SKW_UA })));
    expect(await fetchUnitedFeed(5000)).toBeNull();
  });

  it('FR24_EXPRESS_OPERATOR_FEED=0 goes back to the single United read', async () => {
    for (const off of ['0', 'off', 'false', ' NO ']) {
      process.env.FR24_EXPRESS_OPERATOR_FEED = off;
      expect(expressOperatorFeedEnabled()).toBe(false);
    }
    process.env.FR24_EXPRESS_OPERATOR_FEED = '0';
    fetchSpy.mockImplementation(async () => ok({ ual1: UAL_ROW }));
    await fetchUnitedFeed(5000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('airline=UAL&');
  });
});

describe('parseFr24Feed carries the estimated-position flag', () => {
  it('marks FR24 projected (F-EST) positions so the flight panel can say so', () => {
    const est = row({ flight: 'UA15', callsign: 'UAL15', airline: 'UAL', receiver: 'F-EST', from: 'LHR', to: 'EWR' });
    const fix = row({ flight: 'UA16', callsign: 'UAL16', airline: 'UAL', receiver: 'T-KEWR1', from: 'EWR', to: 'LHR' });
    const [a, b] = parseFr24Feed({ e: est, f: fix });
    expect(a.positionEstimated).toBe(true);
    expect(b.positionEstimated).toBe(false);
  });
});
