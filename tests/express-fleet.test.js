// The United Express fleet: discovered from United's own flying (sql/018), joined with the Starlink
// roster, and kept apart from the mainline fleet so "1,139 mainline" and utilization never move.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn(async () => null) }));
vi.mock('../api/_schedule-snapshots.js', () => supabaseMocks);

import {
  buildExpressFleet,
  expressTailFromFlight,
  expressTailRows,
  indexExpressFleet,
  isExpressWriteSlot,
  matchExpress,
  normalizeExpressType,
  normalizeReg,
  operatorCodeFromRoster,
  summarizeExpressFleet,
} from '../src/lib/express-fleet.js';
import { matchAircraft } from '../src/lib/fleet-match.js';
import { recordExpressTails, loadExpressTails, __resetExpressTailsForTests } from '../api/_express-tails.js';
import handler, { __resetExpressFleetForTests, UNAVAILABLE_NOTE } from '../api/express-fleet.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';

// Parsed feed rows (feed-health.js shape), from the Oct 4 2026 feed.
const SKW_E175 = { reg: 'N85377', callsign: 'SKW5575', flightIATA: 'UA5575', acType: 'E75L' };
const GJS_CRJ = { reg: 'N504GJ', callsign: 'GJS3375', flightIATA: 'G73375', acType: 'CRJ7' };
const UCA_E145 = { reg: 'N14148', callsign: 'UCA4110', flightIATA: 'UA4110', acType: 'E145' };
const SKW_FOR_AMERICAN = { reg: 'N603SK', callsign: 'SKW3412', flightIATA: 'AA3412', acType: 'CRJ9' };
const MAINLINE = { reg: 'N24973', callsign: 'UAL958', flightIATA: 'UA958', acType: 'B789' };
const BAD_BOARD_ROW = { reg: 'N37542', callsign: 'SKW5100', flightIATA: 'UA5100', acType: 'B739' };

describe('which flights put a tail in the United Express fleet', () => {
  it('needs an Express callsign, a United flight number, a US tail and a regional type', () => {
    expect(expressTailFromFlight(SKW_E175)).toEqual({ reg: 'N85377', operator: 'SKW', fr24_type: 'E75L', last_flight: 'UA5575' });
    expect(expressTailFromFlight(GJS_CRJ)).toEqual({ reg: 'N504GJ', operator: 'GJS', fr24_type: 'CRJ7', last_flight: 'G73375' });
    expect(expressTailFromFlight(UCA_E145)?.operator).toBe('UCA');
  });

  it("keeps out SkyWest's American flying, mainline jets and mismatched board rows", () => {
    expect(expressTailFromFlight(SKW_FOR_AMERICAN)).toBeNull();
    expect(expressTailFromFlight(MAINLINE)).toBeNull();
    expect(expressTailFromFlight(BAD_BOARD_ROW)).toBeNull(); // a 737 under a SkyWest callsign
    expect(expressTailFromFlight({ ...SKW_E175, reg: 'C-GKEJ' })).toBeNull();
    expect(expressTailFromFlight({ ...SKW_E175, reg: '' })).toBeNull();
    expect(expressTailFromFlight(null)).toBeNull();
  });

  it('one row per tail per read', () => {
    const rows = expressTailRows([SKW_E175, { ...SKW_E175, flightIATA: 'UA5576' }, GJS_CRJ, MAINLINE, SKW_FOR_AMERICAN]);
    expect(rows.map((r) => r.reg)).toEqual(['N85377', 'N504GJ']);
    expect(rows[0].last_flight).toBe('UA5576');
  });

  it('writes in two wall-clock slots an hour', () => {
    const at = (h, m) => Date.UTC(2026, 9, 4, h, m);
    expect(isExpressWriteSlot(at(18, 0))).toBe(true);
    expect(isExpressWriteSlot(at(18, 4))).toBe(true);
    expect(isExpressWriteSlot(at(18, 5))).toBe(false);
    expect(isExpressWriteSlot(at(18, 30))).toBe(true);
    expect(isExpressWriteSlot(at(18, 35))).toBe(false);
  });
});

describe('normalizeReg and the roster operator labels', () => {
  it('normalises US registrations only', () => {
    expect(normalizeReg(' n-85377 ')).toBe('N85377');
    expect(normalizeReg('C-GKEJ')).toBe('');
    expect(normalizeReg(undefined)).toBe('');
  });

  it('maps the Starlink roster labels to operator codes', () => {
    expect(operatorCodeFromRoster('SkyWest dba UAX')).toBe('SKW');
    expect(operatorCodeFromRoster('SkyWest floater')).toBe('SKW');
    expect(operatorCodeFromRoster('Republic dba UAX')).toBe('RPA');
    expect(operatorCodeFromRoster('GoJet dba UAX')).toBe('GJS');
    expect(operatorCodeFromRoster('Mesa dba UAX')).toBe('ASH');
    expect(operatorCodeFromRoster('')).toBe('');
  });
});

describe('normalizeExpressType', () => {
  it("prefers the roster's curated type, then the board model, then the feed designator", () => {
    expect(normalizeExpressType({ rosterType: 'CRJ-550', fr24Type: 'CRJ7' })).toEqual({ key: 'CRJ550', label: 'CRJ550' });
    expect(normalizeExpressType({ rosterType: 'ERJ-175' })).toEqual({ key: 'E175', label: 'E175' });
    expect(normalizeExpressType({ model: 'CRJ2', fr24Type: 'E75L' })).toEqual({ key: 'CRJ200', label: 'CRJ200' });
    expect(normalizeExpressType({ fr24Type: 'E75S' })).toEqual({ key: 'E175', label: 'E175' });
    expect(normalizeExpressType({ fr24Type: 'E145' })).toEqual({ key: 'ERJ145', label: 'ERJ145' });
  });

  it('keeps E175SC its own cabin key, and never guesses CRJ550 vs CRJ700 without the roster', () => {
    expect(normalizeExpressType({ rosterType: 'E175SC' })).toEqual({ key: 'E175SC', label: 'E175' });
    expect(normalizeExpressType({ fr24Type: 'CRJ7' })).toEqual({ key: 'CRJ7', label: 'CRJ700/550' });
    expect(normalizeExpressType({})).toEqual({ key: '', label: '' });
  });
});

describe('buildExpressFleet', () => {
  const tails = [
    { r: 'N85377', op: 'SKW', ft: 'E75L', m: 'E175', lf: 'UA5575', fs: '2026-10-01T00:00:00Z', ls: '2026-10-04T18:00:00Z' },
    { r: 'N504GJ', op: 'GJS', ft: 'CRJ7', m: null, lf: 'G73375', fs: '2026-10-02T00:00:00Z', ls: '2026-10-04T18:00:00Z' },
    { r: 'bad reg', op: 'SKW' },
  ];
  const roster = [
    { tail: 'N504GJ', fleet: 'Express', type: 'CRJ-550', operator: 'GoJet dba UAX' },
    { tail: 'N642SY', fleet: 'Express', type: 'E175SC', operator: 'SkyWest dba UAX' }, // not seen yet
    { tail: 'N24973', fleet: 'Mainline', type: '787-9', operator: 'United Airlines' },
  ];

  it('joins the discovered tails with the Starlink roster, Express only', () => {
    const fleet = buildExpressFleet(tails, roster);
    expect(fleet.map((e) => e.r)).toEqual(['N504GJ', 'N642SY', 'N85377']);
    const gojet = fleet.find((e) => e.r === 'N504GJ');
    expect(gojet).toMatchObject({ t: 'CRJ550', tk: 'CRJ550', o: 'GoJet Airlines', oc: 'GJS', w: 'Starlink', x: true, lf: 'G73375' });
    const rosterOnly = fleet.find((e) => e.r === 'N642SY');
    expect(rosterOnly).toMatchObject({ t: 'E175', tk: 'E175SC', o: 'SkyWest Airlines', w: 'Starlink', ls: '' });
    const skw = fleet.find((e) => e.r === 'N85377');
    expect(skw).toMatchObject({ t: 'E175', o: 'SkyWest Airlines', w: '' });
  });

  it('indexes and matches by registration, from a flight or a bare tail', () => {
    const byReg = indexExpressFleet(buildExpressFleet(tails, roster));
    expect(matchExpress({ reg: 'N-85377' }, byReg)?.r).toBe('N85377');
    expect(matchExpress('N504GJ', byReg)?.t).toBe('CRJ550');
    expect(matchExpress({ reg: 'N24973' }, byReg)).toBeNull();
    expect(matchExpress({ reg: 'N85377' }, null)).toBeNull();
  });

  it('summarises by operator and type for the Fleet tab', () => {
    const s = summarizeExpressFleet(buildExpressFleet(tails, roster));
    expect(s).toEqual({ total: 3, starlink: 2, byOperator: { 'GoJet Airlines': 1, 'SkyWest Airlines': 2 }, byType: { CRJ550: 1, E175: 2 } });
  });

  it('never touches the mainline matcher (fleet stats stay mainline-only)', () => {
    const mainline = { N24973: { r: 'N24973', t: '787-9' } };
    expect(matchAircraft({ reg: 'N85377' }, mainline)).toBeNull();
    expect(matchAircraft({ reg: 'N24973' }, mainline)?.t).toBe('787-9');
  });
});

// ── the writer and the reader ──
function fakeSupabase({ rows = [], readError = null, writeError = null } = {}) {
  const calls = { upserts: [], gte: [] };
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        gte: vi.fn((col, val) => {
          calls.gte.push({ col, val });
          return { order: vi.fn(() => ({ range: vi.fn((from, to) => Promise.resolve(readError ? { data: null, error: readError } : { data: rows.slice(from, to + 1), error: null })) })) };
        }),
      })),
      upsert: vi.fn((payload, opts) => {
        calls.upserts.push({ payload, opts });
        return Promise.resolve({ error: writeError });
      }),
    })),
  };
  return { client, calls };
}
function createRes() {
  return { statusCode: 200, headers: {}, body: null, setHeader(n, v) { this.headers[n] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
}
const SLOT = Date.UTC(2026, 9, 4, 18, 30, 5);
const OFF_SLOT = Date.UTC(2026, 9, 4, 18, 15, 5);

describe('recordExpressTails (watch-alerts writer)', () => {
  beforeEach(() => { __resetExpressTailsForTests(); supabaseMocks.getSupabaseAdmin.mockReset(); });
  afterEach(() => vi.restoreAllMocks());

  it('upserts the qualifying tails in a write slot, without first_seen or model', async () => {
    const { client, calls } = fakeSupabase();
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const out = await recordExpressTails([SKW_E175, GJS_CRJ, MAINLINE, SKW_FOR_AMERICAN], SLOT);
    expect(out).toEqual({ recorded: 2 });
    expect(calls.upserts).toHaveLength(1);
    const { payload, opts } = calls.upserts[0];
    expect(opts).toEqual({ onConflict: 'reg' });
    expect(payload.map((r) => r.reg)).toEqual(['N85377', 'N504GJ']);
    for (const row of payload) {
      expect(row).not.toHaveProperty('first_seen');
      expect(row).not.toHaveProperty('model');
      expect(row.last_seen).toBe(new Date(SLOT).toISOString());
    }
  });

  it('does nothing outside a slot, on a failed read, or unconfigured — and never throws', async () => {
    const { client, calls } = fakeSupabase();
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    expect((await recordExpressTails([SKW_E175], OFF_SLOT)).recorded).toBe(0);
    expect((await recordExpressTails(null, SLOT)).recorded).toBe(0);
    expect((await recordExpressTails([], SLOT)).recorded).toBe(0);
    expect(calls.upserts).toHaveLength(0);
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(null);
    expect(await recordExpressTails([SKW_E175], SLOT)).toEqual({ recorded: 0, reason: 'unconfigured' });
    supabaseMocks.getSupabaseAdmin.mockRejectedValue(new Error('boom'));
    expect((await recordExpressTails([SKW_E175], SLOT)).reason).toBe('write threw');
  });

  it('a missing table logs once and degrades', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeSupabase({ writeError: { code: 'PGRST205', message: "Could not find the table 'public.express_tails'" } });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    expect((await recordExpressTails([SKW_E175], SLOT)).reason).toBe('table missing');
    await recordExpressTails([SKW_E175], SLOT);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/express-fleet', () => {
  const ROWS = [
    { reg: 'N504GJ', operator: 'GJS', fr24_type: 'CRJ7', model: null, last_flight: 'G73375', first_seen: '2026-10-02T00:00:00Z', last_seen: '2026-10-04T18:30:00Z' },
    { reg: 'N85377', operator: 'SKW', fr24_type: 'E75L', model: 'E175', last_flight: 'UA5575', first_seen: '2026-10-01T00:00:00Z', last_seen: '2026-10-04T18:30:00Z' },
  ];
  beforeEach(() => { __resetExpressFleetForTests(); __resetExpressTailsForTests(); __resetRateLimitersForTests(); supabaseMocks.getSupabaseAdmin.mockReset(); });

  it('serves the tails seen in the last 45 days, cached at the CDN', async () => {
    const { client, calls } = fakeSupabase({ rows: ROWS });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const res = createRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.tails).toEqual([
      { r: 'N504GJ', op: 'GJS', ft: 'CRJ7', m: null, lf: 'G73375', fs: '2026-10-02T00:00:00Z', ls: '2026-10-04T18:30:00Z' },
      { r: 'N85377', op: 'SKW', ft: 'E75L', m: 'E175', lf: 'UA5575', fs: '2026-10-01T00:00:00Z', ls: '2026-10-04T18:30:00Z' },
    ]);
    expect(res.body.staleDays).toBe(45);
    expect(res.headers['Cache-Control']).toContain('s-maxage=1800');
    const sinceMs = Date.parse(calls.gte[0].val);
    expect(Date.now() - sinceMs).toBeGreaterThan(44.9 * 86_400_000);
    expect(calls.gte[0].col).toBe('last_seen');
  });

  it('never 5xxes: a failed read is an empty, briefly-cached 200 with a note', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = fakeSupabase({ readError: { code: 'XX000', message: 'pooler blip' } });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const res = createRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ tails: [], note: UNAVAILABLE_NOTE });
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=60');
  });

  it('refuses foreign origins and non-GET', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'https://evil.example' }, query: {} }, res);
    expect(res.statusCode).toBe(403);
    const res2 = createRes();
    await handler({ method: 'POST', headers: {}, query: {} }, res2);
    expect(res2.statusCode).toBe(405);
  });

  it('loadExpressTails reads by last_seen and skips rows without a reg or operator', async () => {
    const { client } = fakeSupabase({ rows: [...ROWS, { reg: null, operator: 'SKW' }, { reg: 'N1', operator: null }] });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const out = await loadExpressTails(Date.UTC(2026, 9, 4));
    expect(out.ok && out.tails.map((t) => t.r)).toEqual(['N504GJ', 'N85377']);
  });
});
