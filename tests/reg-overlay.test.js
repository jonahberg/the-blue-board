import { describe, it, expect } from 'vitest';
import { cancellationKind } from '../src/lib/cancellation.js';
import {
  LIVE_RECENT_MS, extractSightings, sightingMatchesFlight, applySightingsToBoard,
} from '../src/lib/reg-overlay.js';

const H = 3600e3;
const NOW = 1_750_000_000_000;
const depSec = Math.floor(NOW / 1000) - 1800; // scheduled 30 min ago
const arrSec = depSec + 4 * 3600;

const boardFlight = (over = {}) => ({
  identification: { number: { default: 'UA123' } },
  time: { scheduled: { departure: depSec, arrival: arrSec } },
  airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'SFO' } } },
  aircraft: { model: { code: '739' }, registration: '' },
  ...over,
});
const sighting = (over = {}) => ({ reg: 'N12345', origin: 'ORD', dest: 'SFO', seenAtMs: NOW - 5 * 60e3, ...over });

describe('extractSightings', () => {
  it('builds upsert rows from parsed feed flights, deduped by key, reg required', () => {
    const air = { alt: 10000, spd: 220, vr: 0, onGround: false };
    const rows = extractSightings([
      { flightIATA: 'UA123', callsign: 'UAL123', reg: 'N12345', origin: 'ORD', dest: 'SFO', ...air },
      { flightIATA: 'UA123', callsign: 'UAL123', reg: 'N99999', origin: 'ORD', dest: 'SFO', ...air }, // dup key: first wins
      { flightIATA: '', callsign: 'UAL456', reg: 'N45678', origin: 'ewr', dest: 'lax', alt: 0, spd: 4, onGround: true },
      { flightIATA: 'UA789', callsign: 'UAL789', reg: '' },          // no reg
      { flightIATA: 'G7929', callsign: 'GJS929', reg: 'N11111' },    // not mainline
    ], NOW);
    const at = new Date(NOW).toISOString();
    expect(rows).toEqual([
      { flight_key: 'UA123', reg: 'N12345', origin: 'ORD', dest: 'SFO', seen_at: at, airborne_at: at },
      // On the ground: still recorded (the tail ledger wants it), but with no airborne_at KEY at all.
      { flight_key: 'UA456', reg: 'N45678', origin: 'EWR', dest: 'LAX', seen_at: at },
    ]);
    expect(Object.keys(rows[1])).not.toContain('airborne_at');
  });

  it('marks airborne with the dashboard rule: the feed flag, or under 100 ft and 50 kt', () => {
    const base = { flightIATA: 'UA1', reg: 'N1', origin: 'ORD', dest: 'DEN' };
    const one = (f) => extractSightings([{ ...base, ...f }], NOW)[0];
    expect(one({ alt: 11000, spd: 230, onGround: false }).airborne_at).toBeDefined();
    expect(one({ alt: 11000, spd: 230, onGround: true }).airborne_at).toBeUndefined();   // feed says ground
    expect(one({ alt: 0, spd: 10, onGround: false }).airborne_at).toBeUndefined();       // taxiing: <100 ft, <50 kt
    expect(one({ alt: 20, spd: 70, onGround: false }).airborne_at).toBeDefined();        // takeoff roll past 50 kt
  });
  it('handles garbage input', () => {
    expect(extractSightings(null, NOW)).toEqual([]);
    expect(extractSightings([null, {}], NOW)).toEqual([]);
  });
});

describe('sightingMatchesFlight', () => {
  it('matches inside the operation window with agreeing route', () => {
    expect(sightingMatchesFlight(sighting(), boardFlight())).toBe(true);
  });
  it('rejects sightings outside the operation window (another day’s instance)', () => {
    expect(sightingMatchesFlight(sighting({ seenAtMs: depSec * 1000 - 24 * H }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ seenAtMs: arrSec * 1000 + 24 * H }), boardFlight())).toBe(false);
  });
  it('uses a 16h span when scheduled arrival is missing', () => {
    const fl = boardFlight({ time: { scheduled: { departure: depSec } } });
    expect(sightingMatchesFlight(sighting(), fl)).toBe(true);
    expect(sightingMatchesFlight(sighting({ seenAtMs: depSec * 1000 + 20 * H }), fl)).toBe(false);
  });
  it('rejects a route mismatch, tolerates missing codes on either side', () => {
    expect(sightingMatchesFlight(sighting({ origin: 'DEN' }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ dest: 'LAX' }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ origin: '', dest: '' }), boardFlight())).toBe(true);
    const noRouteFlight = boardFlight({ airport: {} });
    expect(sightingMatchesFlight(sighting(), noRouteFlight)).toBe(true);
  });
  it('requires a scheduled departure and a usable sighting', () => {
    expect(sightingMatchesFlight(sighting(), boardFlight({ time: { scheduled: {} } }))).toBe(false);
    expect(sightingMatchesFlight(sighting({ seenAtMs: NaN }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ reg: '' }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(null, boardFlight())).toBe(false);
  });
});

describe('applySightingsToBoard', () => {
  const mapOf = (s) => new Map([['UA123', s]]);

  it('backfills a blank registration and tags regSource', () => {
    const payload = { flights: [boardFlight()], meta: { completeness: 1 } };
    const out = applySightingsToBoard(payload, mapOf(sighting()), NOW);
    expect(out.flights[0].aircraft.registration).toBe('N12345');
    expect(out.flights[0].aircraft.regSource).toBe('live_feed');
    expect(out.flights[0].aircraft.model.code).toBe('739'); // rest of aircraft preserved
  });

  it('NEVER overwrites a provider registration', () => {
    const payload = { flights: [boardFlight({ aircraft: { registration: 'N77777' } })] };
    const out = applySightingsToBoard(payload, mapOf(sighting()), NOW);
    expect(out.flights[0].aircraft.registration).toBe('N77777');
    expect(out.flights[0].aircraft.regSource).toBeUndefined();
  });

  it('attaches live:{seenAt} for a recent AIRBORNE fix of this instance — including rows WITH a provider reg', () => {
    // v1.12.1: LIVE needs an airborne fix (airborneAtMs, the sighting's latest word) and the board
    // direction; the fix must be no earlier than 15 min before the scheduled departure.
    const recent = sighting({ seenAtMs: NOW - 5 * 60e3, airborneAtMs: NOW - 5 * 60e3 });
    const withReg = { dir: 'departures', flights: [boardFlight({ aircraft: { registration: 'N77777' } })] };
    expect(applySightingsToBoard(withReg, mapOf(recent), NOW).flights[0].live).toEqual({ seenAt: recent.airborneAtMs });
    const old = sighting({ seenAtMs: NOW - LIVE_RECENT_MS - 1000, airborneAtMs: NOW - LIVE_RECENT_MS - 1000 });
    const out = applySightingsToBoard({ dir: 'departures', flights: [boardFlight()] }, mapOf(old), NOW);
    expect(out.flights[0].live).toBeUndefined();          // old fix: reg fills, no live flag
    expect(out.flights[0].aircraft.registration).toBe('N12345');
  });

  it('a recent sighting with NO airborne fix (or no board direction) never earns live', () => {
    const parked = sighting({ seenAtMs: NOW - 5 * 60e3 });
    expect(applySightingsToBoard({ dir: 'departures', flights: [boardFlight()] }, mapOf(parked), NOW).flights[0].live).toBeUndefined();
    const airborneNoDir = sighting({ seenAtMs: NOW - 5 * 60e3, airborneAtMs: NOW - 5 * 60e3 });
    expect(applySightingsToBoard({ flights: [boardFlight()] }, mapOf(airborneNoDir), NOW).flights[0].live).toBeUndefined();
  });

  it('does not mutate the input payload or its flights (shared cache objects)', () => {
    const fl = boardFlight();
    const payload = { flights: [fl] };
    const out = applySightingsToBoard(payload, mapOf(sighting()), NOW);
    expect(fl.aircraft.registration).toBe('');
    expect(fl.live).toBeUndefined();
    expect(payload.flights[0]).toBe(fl);
    expect(out).not.toBe(payload);
  });

  it('returns the SAME payload reference when nothing changes', () => {
    const payload = { flights: [boardFlight({ identification: { number: { default: 'UA999' } } })] };
    expect(applySightingsToBoard(payload, mapOf(sighting()), NOW)).toBe(payload);
    expect(applySightingsToBoard(payload, new Map(), NOW)).toBe(payload);
    expect(applySightingsToBoard(null, mapOf(sighting()), NOW)).toBe(null);
  });
});

// v1.12.0 — "Likely Canceled" that the live feed saw fly. Oct 3 2026: 38 of 45 canceled_uncertain
// departures at 22:54Z had an airborne sighting from the same origin after their scheduled time.
describe('applySightingsToBoard — seen-airborne override for canceled_uncertain', () => {
  const uncertain = () => ({
    generic: { status: { text: 'canceled_uncertain', diverted: false }, type: 'canceled_uncertain' },
    text: 'canceleduncertain',
    icon: 'yellow',
    live: false,
  });
  const likely = (over = {}) => boardFlight({ status: uncertain(), aircraft: { registration: 'N77777' }, ...over });
  const board = (fl, dir = 'departures') => ({ dir, hub: 'ORD', flights: [fl] });
  const mapOf = (s) => new Map([['UA123', s]]);
  // An old AIRBORNE sighting (not "live now"): 3h after the scheduled departure, i.e. it flew.
  const flew = (over = {}) => {
    const seenAtMs = over.seenAtMs ?? depSec * 1000 + 3 * H;
    return sighting({ seenAtMs, airborneAtMs: seenAtMs, ...over });
  };
  const at = depSec * 1000 + 6 * H; // the clock: well after the flight

  it('turns a seen-airborne Likely Canceled into departed, with the evidence in _source', () => {
    const out = applySightingsToBoard(board(likely()), mapOf(flew()), at);
    const fl = out.flights[0];
    expect(fl.status.generic.status.text).toBe('departed');
    expect(fl.status.generic.type).toBe('');
    expect(fl.status.text).toBe('departed');
    expect(fl._source.seenAirborne).toEqual({
      airborneAt: depSec * 1000 + 3 * H, seenAt: depSec * 1000 + 3 * H,
      reg: 'N12345', origin: 'ORD', dest: 'SFO', providerStatus: 'canceled_uncertain',
    });
    expect(cancellationKind(fl)).toBeNull();
    // No departure time is invented from a sighting.
    expect(fl.time).toEqual(likely().time);
    expect(fl.live).toBeUndefined(); // 3h-old sighting: not "airborne right now"
  });

  it('a recent sighting also carries live:{seenAt} (Departed · LIVE on the board)', () => {
    const recent = flew({ seenAtMs: at - 5 * 60e3 });
    const out = applySightingsToBoard(board(likely()), mapOf(recent), at);
    expect(out.flights[0].status.generic.status.text).toBe('departed');
    expect(out.flights[0].live).toEqual({ seenAt: recent.seenAtMs });
  });

  it('keeps an UNSEEN Likely Canceled as it is (some are real cancellations)', () => {
    const payload = board(likely({ identification: { number: { default: 'UA999' } } }));
    const out = applySightingsToBoard(payload, mapOf(flew()), at);
    expect(out).toBe(payload);
    expect(cancellationKind(out.flights[0])).toBe('likely');
  });

  it('a sighting from a different origin does not count', () => {
    const out = applySightingsToBoard(board(likely()), mapOf(flew({ origin: 'DEN' })), at);
    expect(out.flights[0].status.generic.status.text).toBe('canceled_uncertain');
    expect(out.flights[0]._source?.seenAirborne).toBeUndefined();
  });

  it('a sighting with a blank origin does not count (it cannot prove THIS departure)', () => {
    const out = applySightingsToBoard(board(likely()), mapOf(flew({ origin: '' })), at);
    expect(out.flights[0].status.generic.status.text).toBe('canceled_uncertain');
  });

  it('an airborne time well before the scheduled departure does not count (an earlier leg, e.g. a through flight inbound)', () => {
    // 20 min before scheduled (gate) departure: inside the reg-backfill window (2h) but wheels-up
    // that early would need a 25+ min early pushback — far likelier the inbound leg on final.
    const early = flew({ seenAtMs: depSec * 1000 - 20 * 60e3 });
    const out = applySightingsToBoard(board(likely()), mapOf(early), at);
    expect(out.flights[0].status.generic.status.text).toBe('canceled_uncertain');
    // …while 10 min before (an early pushback, short taxi) does.
    const justBefore = flew({ seenAtMs: depSec * 1000 - 10 * 60e3 });
    expect(applySightingsToBoard(board(likely()), mapOf(justBefore), at).flights[0].status.generic.status.text).toBe('departed');
  });

  it('a ground-only sighting, or one with no airborne time, does not count', () => {
    // seenAtMs in the window but no airborne evidence: written on the ground, or before sql/016.
    for (const airborneAtMs of [null, undefined, 0, NaN]) {
      const s = flew({ airborneAtMs });
      expect(applySightingsToBoard(board(likely()), mapOf(s), at).flights[0].status.generic.status.text).toBe('canceled_uncertain');
    }
  });

  it('taxiway hold: seen on the ground after the scheduled departure, then still Likely Canceled → stays Likely Canceled', () => {
    // A ground stop: the aircraft pushed, held on the taxiway with its transponder on for 90 min
    // (ground sightings, no airborne_at), and the flight was then cancelled. Its latest sighting is
    // AFTER the scheduled departure and from the right origin — the old seen_at rule called it flown.
    const held = sighting({ seenAtMs: depSec * 1000 + 90 * 60e3, airborneAtMs: null });
    const out = applySightingsToBoard(board(likely()), mapOf(held), depSec * 1000 + 100 * 60e3);
    expect(out.flights[0].status.generic.status.text).toBe('canceled_uncertain');
    expect(cancellationKind(out.flights[0])).toBe('likely');
    expect(out.flights[0]._source?.seenAirborne).toBeUndefined();
    // …and an airborne time left over from YESTERDAY's flight with this number is no evidence either.
    const yesterday = sighting({ seenAtMs: depSec * 1000 + 90 * 60e3, airborneAtMs: depSec * 1000 - 21 * H });
    expect(applySightingsToBoard(board(likely()), mapOf(yesterday), depSec * 1000 + 100 * 60e3).flights[0].status.generic.status.text)
      .toBe('canceled_uncertain');
  });

  it('reg backfill still keys off seenAtMs (a ground sighting fills the tail) — but a ground sighting is never LIVE', () => {
    // v1.12.1 (live audit Oct 4 2026): the LIVE flag used to key off seenAtMs too, so an aircraft
    // parked at the gate read "Departed · LIVE" (SFO UA1151 at 0 kt).
    const parkedAtGate = sighting({ seenAtMs: NOW - 5 * 60e3, airborneAtMs: null });
    const out = applySightingsToBoard({ dir: 'departures', flights: [boardFlight()] }, mapOf(parkedAtGate), NOW);
    expect(out.flights[0].aircraft.registration).toBe('N12345');
    expect(out.flights[0].live).toBeUndefined();
  });

  it('a sighting more than 18h after the scheduled departure does not count', () => {
    const fl = likely({ time: { scheduled: { departure: depSec, arrival: depSec + 20 * 3600 } } }); // ultra long-haul
    const late = flew({ seenAtMs: depSec * 1000 + 19 * H }); // airborneAtMs follows seenAtMs in flew()
    expect(applySightingsToBoard(board(fl), mapOf(late), at + 20 * H).flights[0].status.generic.status.text).toBe('canceled_uncertain');
    const inside = flew({ seenAtMs: depSec * 1000 + 17 * H });
    expect(applySightingsToBoard(board(fl), mapOf(inside), at + 20 * H).flights[0].status.generic.status.text).toBe('departed');
  });

  it('an on-ground sighting does not count (the browser feed knows; an aircraft at the gate proves nothing)', () => {
    const parked = flew({ onGround: true });
    const out = applySightingsToBoard(board(likely()), mapOf(parked), at);
    expect(out.flights[0].status.generic.status.text).toBe('canceled_uncertain');
    // Server records carry no onGround field at all and still count.
    expect(applySightingsToBoard(board(likely()), mapOf(flew()), at).flights[0].status.generic.status.text).toBe('departed');
  });

  it('a contradicting destination does not count', () => {
    const out = applySightingsToBoard(board(likely()), mapOf(flew({ dest: 'LAX' })), at);
    expect(out.flights[0].status.generic.status.text).toBe('canceled_uncertain');
  });

  it('arrivals boards need the destination to match too (and non-blank)', () => {
    expect(applySightingsToBoard(board(likely(), 'arrivals'), mapOf(flew()), at).flights[0].status.generic.status.text)
      .toBe('departed');
    expect(applySightingsToBoard(board(likely(), 'arrivals'), mapOf(flew({ dest: '' })), at).flights[0].status.generic.status.text)
      .toBe('canceled_uncertain');
    // Departures boards tolerate a blank destination on the sighting (the origin proves the departure).
    expect(applySightingsToBoard(board(likely()), mapOf(flew({ dest: '' })), at).flights[0].status.generic.status.text)
      .toBe('departed');
  });

  it('fails closed when the board direction is unknown; an explicit dir option wins', () => {
    const noDir = { flights: [likely()] };
    expect(applySightingsToBoard(noDir, mapOf(flew()), at).flights[0].status.generic.status.text).toBe('canceled_uncertain');
    expect(applySightingsToBoard(noDir, mapOf(flew()), at, { dir: 'departures' }).flights[0].status.generic.status.text).toBe('departed');
  });

  it('leaves confirmed cancellations and rows with a real time alone', () => {
    const hard = likely({ status: { generic: { status: { text: 'canceled' }, type: 'canceled' }, text: 'canceled' } });
    expect(applySightingsToBoard(board(hard), mapOf(flew()), at).flights[0].status.generic.status.text).toBe('canceled');
    const withReal = likely({ time: { scheduled: { departure: depSec, arrival: arrSec }, real: { departure: depSec + 600 } } });
    expect(applySightingsToBoard(board(withReal), mapOf(flew()), at).flights[0].status.generic.status.text).toBe('canceled_uncertain');
  });

  it('never mutates the shared cache entry', () => {
    const fl = likely({ _source: { timeSource: { gateDistinctDep: true } } });
    const statusBefore = structuredClone(fl.status);
    const sourceBefore = structuredClone(fl._source);
    const payload = board(fl);
    const out = applySightingsToBoard(payload, mapOf(flew()), at);
    expect(fl.status).toEqual(statusBefore);
    expect(fl.status.generic.status.text).toBe('canceled_uncertain');
    expect(fl._source).toEqual(sourceBefore);
    expect(payload.flights[0]).toBe(fl);
    expect(out).not.toBe(payload);
    expect(out.flights[0]._source.timeSource).toEqual({ gateDistinctDep: true }); // existing provenance kept
  });

  it('is idempotent: overlaying an already-overlaid board changes nothing (irops re-applies it)', () => {
    const once = applySightingsToBoard(board(likely()), mapOf(flew()), at);
    const twice = applySightingsToBoard(once, mapOf(flew()), at);
    expect(twice).toBe(once);
    expect(twice).toEqual(once);
  });
});
