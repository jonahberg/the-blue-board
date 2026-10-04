// Live audit Oct 4 2026 (00:36–01:10Z), finding 1: LIVE / "En Route" on aircraft that had landed or
// were parked. The fixtures are the real rows and reg_sightings records of that night.
import { describe, it, expect } from 'vitest';
import { applySightingsToBoard, sightingsFromLiveFeed } from '../src/lib/reg-overlay.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';
import { buildScheduleRow } from '../src/lib/schedule-row-model.js';

const ms = (sec) => sec * 1000;

// ORD arrivals UA303 MCI→ORD (A319 N882UA), as the ORD arrivals board served it at 00:46Z.
const ua303 = () => ({
  identification: { number: { default: 'UA303' }, callsign: 'UAL303' },
  status: { icon: '', live: false, text: 'expected', generic: { type: '', status: { text: 'scheduled', diverted: false } } },
  time: {
    scheduled: { departure: 1791070740, arrival: 1791077580 }, // 22:19Z → 00:13Z
    real: { departure: null, arrival: null },
    estimated: { departure: 1791070620, arrival: 1791075720 }, // 22:17Z → 00:22Z
  },
  airport: { origin: { code: { iata: 'MCI' }, name: 'Kansas City' }, destination: { code: { iata: 'ORD' }, name: 'ORD' } },
  aircraft: { model: { code: 'A319', text: 'Airbus A319' }, registration: 'N882UA' },
  _source: { provider: 'aerodatabox', timeSource: { hasGateArr: true, hasGateDep: true, hasRunwayArr: true, hasRunwayDep: true } },
});

// reg_sightings for UA303 at 01:05Z: airborne fix 00:33:34Z, then on the ground at ORD (seen 01:03:37Z).
const serverUa303 = { reg: 'N882UA', origin: 'MCI', dest: 'ORD', seenAtMs: 1791075817041, airborneAtMs: 1791074014600 };
// The browser's feed at 01:04Z: UA303 on the ground at ORD (transponder on, taxiing in).
const NOW_SEC = 1791075840; // 01:04:00Z
const clientGround = { reg: 'N882UA', origin: 'MCI', dest: 'ORD', seenAtMs: ms(NOW_SEC), airborneAtMs: null, onGround: true };

const board = (fl, dir = 'arrivals') => ({ dir, flights: [fl] });
const overlay = (fl, sighting, nowSec, dir = 'arrivals') =>
  applySightingsToBoard(board(fl, dir), new Map([[fl.identification.number.default, sighting]]), ms(nowSec), { dir }).flights[0];

describe('LIVE needs a recent AIRBORNE fix (finding 1)', () => {
  it('a landed aircraft taxiing in is NOT "En Route · LIVE" (ORD UA303, UA2048, UA1922, UA6000, UA2059)', () => {
    const row = overlay(ua303(), clientGround, NOW_SEC);
    expect(row.live).toBeUndefined();
    const status = classifySchedStatus(row, 'arrivals', NOW_SEC);
    expect(status.live).toBeUndefined();
    expect(status.text).not.toBe('En Route');
  });

  it('a parked departure at 0 kt is NOT "Departed · LIVE" (SFO UA1151, provider "delayed")', () => {
    const ua1151 = {
      identification: { number: { default: 'UA1151' } },
      status: { icon: 'yellow', live: false, text: 'delayed', generic: { type: '', status: { text: 'delayed', diverted: false } } },
      time: {
        scheduled: { departure: 1791061080, arrival: 1791069780 }, // 20:58Z → 23:23Z
        real: { departure: null, arrival: null },
        estimated: { departure: 1791073800, arrival: 1791082920 }, // 00:30Z
      },
      airport: { origin: { code: { iata: 'SFO' } }, destination: { code: { iata: 'YVR' } } },
      aircraft: { model: { code: 'B739' }, registration: 'N68801' },
    };
    const at = 1791074760; // 00:46Z
    const parked = { reg: 'N68801', origin: 'SFO', dest: 'YVR', seenAtMs: ms(at), airborneAtMs: null, onGround: true };
    const row = overlay(ua1151, parked, at, 'departures');
    expect(row.live).toBeUndefined();
    expect(classifySchedStatus(row, 'departures', at)).toMatchObject({ key: 'delayed' });
  });

  it('an airborne fix more than 15 min before the scheduled departure is a previous leg, not this one (ORD UA845 → GRU)', () => {
    const ua845 = {
      identification: { number: { default: 'UA845' } },
      status: { icon: '', live: false, text: 'expected', generic: { type: '', status: { text: 'scheduled', diverted: false } } },
      time: { scheduled: { departure: 1791081000, arrival: 1791117300 }, real: {}, estimated: { departure: 1791081000 } }, // 02:30Z
      airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'GRU' } } },
      aircraft: { model: { code: 'B78X' }, registration: 'N12004' },
    };
    const at = 1791075000; // 00:50Z = 19:50 CDT, 1h40m before departure
    const fix = { reg: 'N14001', origin: 'ORD', dest: 'GRU', seenAtMs: ms(at), airborneAtMs: ms(at) };
    const row = overlay(ua845, fix, at, 'departures');
    expect(row.live).toBeUndefined();
    expect(classifySchedStatus(row, 'departures', at).key).toBe('scheduled');
  });

  it('a fresh airborne fix of this instance is still LIVE', () => {
    const now = 1791073800; // 00:30Z — UA303 was airborne until ~00:34Z
    const airborne = { reg: 'N882UA', origin: 'MCI', dest: 'ORD', seenAtMs: ms(now - 60), airborneAtMs: ms(now - 60) };
    const row = overlay(ua303(), airborne, now);
    expect(row.live).toEqual({ seenAt: ms(now - 60) });
    expect(classifySchedStatus(row, 'arrivals', now)).toMatchObject({ key: 'enroute', text: 'En Route', live: true });
  });

  it("a newer non-airborne sighting clears the server's LIVE stamp (the browser re-overlays CDN copies)", () => {
    const stamped = { ...ua303(), live: { seenAt: ms(NOW_SEC - 300) } };
    const row = overlay(stamped, clientGround, NOW_SEC);
    expect(row.live).toBeUndefined();
  });
});

describe('Landed, seen on the ground (finding 1)', () => {
  it('airborne on this leg, then on the ground at the destination → Landed* (seen), not En Route', () => {
    const row = overlay(ua303(), serverUa303, NOW_SEC);
    expect(row._source.track).toEqual({ airborneAt: serverUa303.airborneAtMs, groundAt: serverUa303.seenAtMs, landed: true });
    expect(row.live).toBeUndefined();
    expect(classifySchedStatus(row, 'arrivals', NOW_SEC)).toMatchObject({
      key: 'landed', text: 'Landed', presumed: true, seenLanded: true,
    });
  });

  it("survives the browser's own re-overlay with its ground sighting (and the browser can complete it)", () => {
    const serverRow = overlay(ua303(), { ...serverUa303, seenAtMs: serverUa303.airborneAtMs }, NOW_SEC - 1800);
    expect(serverRow._source.track).toEqual({ airborneAt: serverUa303.airborneAtMs }); // still airborne at the server
    const browserRow = overlay(serverRow, clientGround, NOW_SEC);
    expect(browserRow._source.track.landed).toBe(true);
    expect(classifySchedStatus(browserRow, 'arrivals', NOW_SEC)).toMatchObject({ key: 'landed', seenLanded: true });
  });

  it('a landed row never falls back to "Expected · RISK: LOW" (UA303, 36 min after landing)', () => {
    const risk = { label: 'LOW', score: 12, color: '#0f0', factors: [], components: [] };
    // Without the server's stamp (CDN copy from before the landing): the arrival is past due, so no risk.
    const unstamped = overlay(ua303(), clientGround, NOW_SEC);
    const status = classifySchedStatus(unstamped, 'arrivals', NOW_SEC);
    const model = buildScheduleRow(unstamped, { hub: 'ORD', dir: 'arrivals', timeZone: 'America/Chicago', status, risk, reg: 'N882UA' });
    expect(model.delay.kind).not.toBe('risk');
    // With it: Landed*.
    const stamped = overlay(ua303(), serverUa303, NOW_SEC);
    const landed = buildScheduleRow(stamped, {
      hub: 'ORD', dir: 'arrivals', timeZone: 'America/Chicago', status: classifySchedStatus(stamped, 'arrivals', NOW_SEC), risk, reg: 'N882UA',
    });
    expect(landed.status).toMatchObject({ text: 'Landed', presumed: true, seenLanded: true });
    expect(landed.delay.kind).not.toBe('risk');
  });

  it('a ground sighting sooner than half the block after departure is not a landing (air return)', () => {
    const early = { ...serverUa303, airborneAtMs: ms(1791070740 + 600), seenAtMs: ms(1791070740 + 1800) };
    const row = overlay(ua303(), early, 1791070740 + 1900);
    expect(row._source.track.landed).toBeUndefined();
    expect(classifySchedStatus(row, 'arrivals', 1791070740 + 1900).key).not.toBe('landed');
  });

  it('a ground sighting whose destination is not this row is not a landing here', () => {
    const elsewhere = { ...serverUa303, dest: '' };
    expect(overlay(ua303(), elsewhere, NOW_SEC)._source?.track?.landed).toBeUndefined();
  });
});

describe('sightingsFromLiveFeed', () => {
  it('builds the board sightings map with positions, so an airborne arrival gets the live ETA', () => {
    const now = 1791073800;
    const feed = [
      { flightIATA: 'UA303', callsign: 'UAL303', reg: 'N882UA', origin: 'MCI', dest: 'ORD', lat: 41.5, lon: -88.6, alt: 9000, spd: 130, vr: -5, onGround: false },
      { flightIATA: 'UA1151', callsign: 'UAL1151', reg: 'N68801', origin: 'SFO', dest: 'YVR', lat: 37.6, lon: -122.4, alt: 0, spd: 0, onGround: true },
    ];
    const map = sightingsFromLiveFeed(feed, ms(now));
    expect(map.get('UA303')).toMatchObject({ reg: 'N882UA', airborneAtMs: ms(now), onGround: false, lat: 41.5 });
    expect(map.get('UA1151')).toMatchObject({ airborneAtMs: null, onGround: true });
    const row = applySightingsToBoard(board(ua303()), map, ms(now), { dir: 'arrivals' }).flights[0];
    expect(row.live.seenAt).toBe(ms(now));
    expect(row.live.etaSec).toBeGreaterThan(now);
    expect(row.live.etaSec).toBeLessThan(now + 3600);
  });
});
