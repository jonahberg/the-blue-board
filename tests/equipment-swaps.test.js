import { describe, it, expect } from 'vitest';
import { ICAO_TO_FLEET_TYPE, getTypicalFleetStats, detectEquipmentSwaps } from '../src/lib/equipment-swaps.js';

/** Minimal in-memory stand-in for localStorage. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _dump: () => Object.fromEntries(map),
  };
}

/** A schedule row as AeroDataBox/FR24 shapes it for the board. */
const row = (number, code, registration) => ({
  identification: { number: { default: number } },
  aircraft: { model: { code }, registration },
});

const KEY = 'bb_sched_ORD_departures_0';

describe('ICAO_TO_FLEET_TYPE', () => {
  it('maps ICAO type codes to the fleet-database type names', () => {
    expect(ICAO_TO_FLEET_TYPE.B77W).toBe('777-300ER');
    expect(ICAO_TO_FLEET_TYPE.A21N).toBe('A321neo');
    expect(ICAO_TO_FLEET_TYPE.B39M).toBe('737 MAX 9');
  });

  it('covers the 18 mainline ICAO codes the board sees', () => {
    expect(Object.keys(ICAO_TO_FLEET_TYPE)).toHaveLength(18);
  });

  it('has no entry for regional codes (edge case — the caller shows the raw code)', () => {
    expect(ICAO_TO_FLEET_TYPE.E75L).toBeUndefined();
    expect(ICAO_TO_FLEET_TYPE.CRJ7).toBeUndefined();
  });
});

describe('getTypicalFleetStats', () => {
  // `s` is the fleet site's free-text status column: empty means in service.
  const FLEET = [
    { r: 'N1', t: '737-800', s: '', c: 'Domestic First', tot: 166, w: 'Viasat', i: 'Streaming', seats: { F: 16, 'E+': 54, Y: 96 } },
    { r: 'N2', t: '737-800', s: '', c: 'Domestic First', tot: 166, w: 'Viasat', i: 'Streaming', seats: { F: 16, 'E+': 54, Y: 96 } },
    { r: 'N3', t: '737-800', s: '', c: 'High-density', tot: 179, w: 'Gogo', i: '', seats: { F: 12, Y: 167 } },
    { r: 'N4', t: '737-800', s: 'Stored MHV', c: 'Domestic First', tot: 166, w: 'Viasat', i: '', seats: { F: 16, Y: 150 } },
    { r: 'N9', t: '777-300ER', s: '', c: 'Polaris', tot: 350, w: 'Panasonic', i: 'Seatback', seats: { J: 60, PP: 24, 'E+': 66, Y: 200 } },
  ];

  it('returns the modal config, WiFi and top cabin across ACTIVE aircraft of the type', () => {
    const stats = getTypicalFleetStats('B738', FLEET, new Set());
    expect(stats).toEqual({
      type: '737-800',
      seats: { F: 16, 'E+': 54, Y: 96 },
      tot: 166,
      wifi: 'Viasat',
      ife: 'Streaming',
      topCabin: 'F',
      hasStarlink: false,
    });
  });

  it('flags the type as Starlink-equipped when ANY active tail of it has Starlink', () => {
    expect(getTypicalFleetStats('B738', FLEET, new Set(['N3'])).hasStarlink).toBe(true);
    expect(getTypicalFleetStats('B738', FLEET, new Set(['N4'])).hasStarlink).toBe(false); // stored → excluded
  });

  it('picks the most premium cabin present, not the first one listed', () => {
    expect(getTypicalFleetStats('B77W', FLEET, new Set()).topCabin).toBe('J');
  });

  it('returns null for an unknown ICAO code', () => {
    expect(getTypicalFleetStats('E75L', FLEET, new Set())).toBeNull();
  });

  it('returns null when the fleet database is empty or has no active aircraft of the type (edge case)', () => {
    expect(getTypicalFleetStats('B738', [], new Set())).toBeNull();
    expect(getTypicalFleetStats('B752', FLEET, new Set())).toBeNull();
    expect(getTypicalFleetStats('B738', [{ r: 'N5', t: '737-800', s: 'Stored MHV' }], new Set())).toBeNull();
  });
});

describe('detectEquipmentSwaps', () => {
  it('reports nothing on the first load but writes the snapshot', () => {
    const s = fakeStorage();
    const out = detectEquipmentSwaps([row('UA123', 'B738', 'N1'), row('UA456', 'B77W', 'N9')], KEY, s);
    expect(out.swaps).toEqual([]);
    expect(out.snapshot).toEqual({ UA123: 'B738', UA456: 'B77W' });
    expect(JSON.parse(s.getItem(KEY))).toEqual({ UA123: 'B738', UA456: 'B77W' });
  });

  it('reports a swap when a flight\'s equipment changed since the last snapshot', () => {
    const s = fakeStorage({ [KEY]: JSON.stringify({ UA123: 'B738', UA456: 'B77W' }) });
    const out = detectEquipmentSwaps([row('UA123', 'B739', 'N7'), row('UA456', 'B77W', 'N9')], KEY, s);
    expect(out.swaps).toEqual([{ flight: 'UA123', oldAc: 'B738', newAc: 'B739', reg: 'N7' }]);
  });

  it('overwrites the snapshot with the new board every time', () => {
    const s = fakeStorage({ [KEY]: JSON.stringify({ UA123: 'B738', UA999: 'B752' }) });
    detectEquipmentSwaps([row('UA123', 'B739', 'N7')], KEY, s);
    expect(JSON.parse(s.getItem(KEY))).toEqual({ UA123: 'B739' });
  });

  it('ignores flights that are new since the snapshot — a first sighting is not a swap', () => {
    const s = fakeStorage({ [KEY]: JSON.stringify({ UA123: 'B738' }) });
    const out = detectEquipmentSwaps([row('UA123', 'B738', 'N1'), row('UA777', 'B788', 'N8')], KEY, s);
    expect(out.swaps).toEqual([]);
  });

  it('skips rows missing a flight number or an aircraft code (edge case)', () => {
    const s = fakeStorage();
    const out = detectEquipmentSwaps([
      row('UA123', 'B738', 'N1'),
      row(undefined, 'B739', 'N2'),
      row('UA555', undefined, 'N3'),
      {},
    ], KEY, s);
    expect(out.snapshot).toEqual({ UA123: 'B738' });
  });

  it('records an empty registration when the row has none (edge case)', () => {
    const s = fakeStorage({ [KEY]: JSON.stringify({ UA123: 'B738' }) });
    const out = detectEquipmentSwaps([row('UA123', 'B739', undefined)], KEY, s);
    expect(out.swaps).toEqual([{ flight: 'UA123', oldAc: 'B738', newAc: 'B739', reg: '' }]);
  });

  it('never throws when storage is corrupt or unavailable (edge case)', () => {
    const corrupt = fakeStorage({ [KEY]: 'not json{' });
    expect(() => detectEquipmentSwaps([row('UA123', 'B738', 'N1')], KEY, corrupt)).not.toThrow();
    expect(detectEquipmentSwaps([row('UA123', 'B738', 'N1')], KEY, corrupt).swaps).toEqual([]);

    const throwing = {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() {},
    };
    const out = detectEquipmentSwaps([row('UA123', 'B738', 'N1')], KEY, throwing);
    expect(out.swaps).toEqual([]);
    expect(out.snapshot).toEqual({ UA123: 'B738' });
  });
});
