// Oct 4 2026 audit — the watch cron end to end, through its real seams (Supabase, Web Push and fetch
// stubbed; api/_watch-diff.ts real):
//   finding 2: a hub-day rollover must never push — neither for the undated watches stored before the
//              fix ({flight, lastStatus}) nor for the new dated shape (pinned legDep);
//   finding 3: delay alerts from the estimated departure in minutes: 15 / 30 / 60 / each hour, once;
//   finding 4: Likely Canceled stays silent, a confirmed cancellation pushes;
//   logging:   one structured line per push, with no endpoint;
//   evidence:  one free live-feed harvest per run into reg_sightings.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/_cron-auth.js', () => ({ isAuthorizedCronRequest: vi.fn(() => true) }));
vi.mock('../api/_supabase.js', () => ({ getSupabase: vi.fn() }));
vi.mock('../api/_web-push.js', () => ({
  isPushConfigured: vi.fn(() => true),
  ensureVapidConfigured: vi.fn(() => true),
  sendPush: vi.fn(() => Promise.resolve({ ok: true, statusCode: 201, gone: false })),
}));

import handler from '../api/cron/watch-alerts.js';
import { getSupabase } from '../api/_supabase.js';
import { sendPush } from '../api/_web-push.js';
import { __resetRegSightingsForTests } from '../api/_reg-sightings.js';

const TODAY_DEP = '2026-10-03T18:00:00.000Z'; // ORD 13:00 CDT
const TOMORROW_DEP = '2026-10-04T18:00:00.000Z';
const min = (n) => n * 60000;

/** The /api/flight-times payload for one leg of UA1 ORD→SFO. */
function leg({ dep = TODAY_DEP, status = 'scheduled', estMin = null, actualDep = '', actualArr = '', reg = 'N11111', gate = 'C1', cancelled = false } = {}) {
  const depMs = Date.parse(dep);
  return {
    success: true, flight: 'UA1', status, cancelled, diverted: false, registration: reg, aircraft: 'Boeing 737-900',
    origin: { iata: 'ORD', gate, tz: 'America/Chicago' },
    destination: { iata: 'SFO', gate: '', tz: 'America/Los_Angeles' },
    departure: {
      gate: { scheduled: dep, estimated: estMin == null ? '' : new Date(depMs + min(estMin)).toISOString(), actual: actualDep },
      takeoff: { scheduled: '', estimated: '', actual: '' },
    },
    arrival: { landing: { scheduled: '', estimated: '', actual: '' }, gate: { scheduled: new Date(depMs + min(270)).toISOString(), estimated: '', actual: actualArr } },
    source: 'schedule-cache',
  };
}

function makeSupabase(rows) {
  const calls = { updates: [], sightings: [] };
  const client = {
    from: vi.fn((table) => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ range: vi.fn((from) => Promise.resolve({ data: from === 0 ? rows : [], error: null })) })),
      })),
      update: vi.fn((payload) => ({
        eq: vi.fn(() => {
          calls.updates.push(payload);
          return Promise.resolve({ error: null });
        }),
      })),
      delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
      upsert: vi.fn((upserted) => {
        if (table === 'reg_sightings') calls.sightings.push(...upserted);
        return Promise.resolve({ error: null });
      }),
    })),
  };
  return { client, calls };
}

function makeRes() {
  const res = { _status: 0, _json: null, status(c) { res._status = c; return res; }, json(d) { res._json = d; return res; }, end() { return res; } };
  return res;
}
const req = () => ({ method: 'GET', headers: { authorization: 'Bearer secret' }, query: {} });

/**
 * A fake /api/flight-times. `answer(params)` returns the payload for a query (or null → 404).
 * The live feed answers `feed` (default: meta-only, i.e. a failed harvest).
 */
function serve(answer, feed = { full_count: 0, version: 4 }) {
  const urls = [];
  globalThis.fetch = vi.fn(async (url) => {
    urls.push(String(url));
    if (String(url).includes('data-cloud.flightradar24.com')) return { ok: true, json: async () => feed };
    const params = new URL(String(url)).searchParams;
    const body = answer(params);
    return body ? { ok: true, json: async () => body } : { ok: false, status: 404, json: async () => ({ success: false }) };
  });
  return urls;
}

/** Run the cron once over `watches`; returns the persisted watches (or the input when unchanged). */
async function run(watches) {
  const { client, calls } = makeSupabase([{ id: 's1', endpoint: 'https://push.example/secret-endpoint', p256dh: 'p', auth: 'a', failed_count: 0, watches }]);
  getSupabase.mockReturnValue(client);
  const res = makeRes();
  await handler(req(), res);
  return { res, calls, watches: calls.updates.length ? calls.updates.at(-1).watches : watches };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRegSightingsForTests();
  sendPush.mockResolvedValue({ ok: true, statusCode: 201, gone: false });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
});

describe('finding 2 — a hub-day rollover never pushes', () => {
  it('legacy undated watch ({flight, lastStatus}) seeing tomorrow\'s leg after midnight: no push', async () => {
    // 05:10Z Oct 4 = 00:10 CDT: ORD's day rolled over and the undated lookup now answers with
    // tomorrow's scheduled leg (another tail, another gate). The stored state is yesterday's landing.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-04T05:10:00.000Z') });
    serve(() => leg({ dep: TOMORROW_DEP, reg: 'N22222', gate: 'B7' }));
    const { watches } = await run([{ flight: 'UA1', addedAt: '2026-08-14T12:00:00.000Z', lastStatus: 'Landed', lastGate: 'C1', lastEquip: 'N11111' }]);
    expect(sendPush).not.toHaveBeenCalled();
    // …and it is now pinned to that leg, silently (the re-baseline).
    expect(watches[0].legDep).toBe(TOMORROW_DEP);
    expect(watches[0].addedAt).toBe('2026-08-14T12:00:00.000Z');
  });

  it('dated watch pinned to tonight\'s leg, still in the air at midnight: asks for THAT leg, never pushes tomorrow\'s', async () => {
    // UA1 out of ORD at 20:30 CDT (01:30Z), airborne across ORD's midnight (05:00Z). After the
    // rollover the undated lookup would answer with TOMORROW night's scheduled run — another tail.
    const LATE_DEP = '2026-10-04T01:30:00.000Z';
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-04T05:10:00.000Z') });
    const airborne = leg({ dep: LATE_DEP, status: 'departed', actualDep: '2026-10-04T01:41:00.000Z' });
    const urls = serve((p) => (p.get('dep') === String(Date.parse(LATE_DEP) / 1000)
      ? airborne
      : leg({ dep: '2026-10-05T01:30:00.000Z', reg: 'N22222', gate: 'B7' })));
    const entry = {
      flight: 'UA1', addedAt: '2026-10-03T12:00:00.000Z', legDep: LATE_DEP, legOrigin: 'ORD', legDest: 'SFO', legDate: '2026-10-03',
      phase: 'departed', lastStatus: 'departed', lastGate: 'C1', lastEquip: 'N11111', reg: 'N11111', delayBucket: 0,
    };
    await run([entry]);
    expect(sendPush).not.toHaveBeenCalled();
    const ft = urls.find((u) => u.includes('/api/flight-times'));
    expect(ft).toContain(`dep=${Date.parse(LATE_DEP) / 1000}`);
    expect(ft).toContain('from=ORD');
  });

  it('a finished leg retires quietly 3 h after it ended: no lookup, no push', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-04T05:10:00.000Z') });
    const urls = serve(() => leg({ dep: TOMORROW_DEP, status: 'canceled', cancelled: true }));
    const { watches, res } = await run([{ flight: 'UA1', legDep: TODAY_DEP, legOrigin: 'ORD', phase: 'landed', terminalAt: '2026-10-03T22:25:00.000Z' }]);
    expect(sendPush).not.toHaveBeenCalled();
    expect(urls.filter((u) => u.includes('/api/flight-times'))).toHaveLength(0);
    expect(watches[0].retired).toBe(true);
    expect(res._json.retired).toBe(1);
  });
});

describe('finding 1 — departed and landed reach the phone', () => {
  it('scheduled → departed → landed: two pushes, each once', async () => {
    let watches = [{ flight: 'UA1' }];
    let now = Date.parse(TODAY_DEP) - min(60);
    const states = [
      leg(), // baseline
      leg({ status: 'departed', actualDep: '2026-10-03T18:04:00.000Z' }),
      leg({ status: 'departed', actualDep: '2026-10-03T18:04:00.000Z' }),
      leg({ status: 'landed', actualDep: '2026-10-03T18:04:00.000Z', actualArr: '2026-10-03T22:21:00.000Z' }),
      leg({ status: 'landed', actualDep: '2026-10-03T18:04:00.000Z', actualArr: '2026-10-03T22:21:00.000Z' }),
    ];
    const titles = [];
    for (const state of states) {
      vi.useFakeTimers({ toFake: ['Date'], now });
      serve(() => state);
      sendPush.mockClear();
      ({ watches } = await run(watches));
      titles.push(...sendPush.mock.calls.map(([, p]) => p.title));
      now += min(75);
    }
    expect(titles).toEqual(['UA1 departed ORD', 'UA1 landed at SFO']);
  });
});

describe('finding 3 — delay alerts from minutes, escalating once per band', () => {
  it('15 → 30 → 60 → 120, never a repeat, never from the word "delayed" alone', async () => {
    let watches = [{ flight: 'UA1' }];
    const sent = [];
    // Estimated departure, minutes late, run by run (the first run is the silent baseline).
    for (const late of [0, 12, 18, 26, 31, 29, 33, 64, 58, 70, 121]) {
      vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(TODAY_DEP) - min(90) });
      serve(() => leg({ estMin: late, status: late > 60 ? 'delayed' : 'scheduled' }));
      sendPush.mockClear();
      ({ watches } = await run(watches));
      sent.push(...sendPush.mock.calls.map(([, p]) => p.title));
    }
    expect(sent).toEqual(['UA1 delayed 18 min', 'UA1 delayed 31 min', 'UA1 delayed 64 min', 'UA1 delayed 121 min']);
  });
});

describe('finding 4 — cancellations', () => {
  it('Likely Canceled is silent; the confirmation pushes once', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(TODAY_DEP) - min(30) });
    let watches = [{ flight: 'UA1' }];
    const sent = [];
    for (const state of [leg(), leg({ status: 'canceled_uncertain' }), leg({ status: 'canceled_uncertain' }), leg({ status: 'canceled', cancelled: true }), leg({ status: 'canceled', cancelled: true })]) {
      serve(() => state);
      sendPush.mockClear();
      ({ watches } = await run(watches));
      sent.push(...sendPush.mock.calls.map(([, p]) => p.title));
    }
    expect(sent).toEqual(['UA1 canceled']);
  });
});

describe('push content is logged — one structured line per push, no endpoint', () => {
  it('logs flight, leg date, old → new and the reason', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(TODAY_DEP) + min(20) });
    serve(() => leg({ status: 'departed', actualDep: '2026-10-03T18:04:00.000Z' }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([{ flight: 'UA1', legDep: TODAY_DEP, legOrigin: 'ORD', legDest: 'SFO', legDate: '2026-10-03', phase: 'scheduled', delayBucket: 0 }]);
    const lines = log.mock.calls.map((c) => c[0]).filter((l) => typeof l === 'string' && l.includes('"watch-push"'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      event: 'watch-push', flight: 'UA1', legDate: '2026-10-03', legDep: TODAY_DEP, route: 'ORD-SFO',
      kind: 'departed', from: 'scheduled', to: 'departed', reason: 'actual-departure', delayMin: 4, result: 'sent',
    });
    expect(lines[0]).not.toContain('push.example');
  });
});

describe('one live-feed harvest per run feeds reg_sightings', () => {
  it('reads the free feed once and records the watched flight airborne', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(TODAY_DEP) + min(30) });
    // FR24 feed array: [icao24, lat, lon, hdg, alt ft, spd kt, squawk, ?, type, reg, ?, origin, dest, flight, onGround, vr, callsign]
    const feed = { full_count: 1, version: 4, abc123: ['A1B2C3', 41.9, -88.5, 270, 23000, 420, '1234', '', 'B739', 'N11111', 0, 'ORD', 'SFO', 'UA1', 0, 1500, 'UAL1'] };
    const urls = serve(() => leg(), feed);
    const { res, calls } = await run([{ flight: 'UA1' }]);
    expect(urls.filter((u) => u.includes('data-cloud.flightradar24.com'))).toHaveLength(1);
    expect(res._json.liveFeed).toEqual({ ok: true, recorded: 1 });
    expect(calls.sightings).toEqual([expect.objectContaining({ flight_key: 'UA1', origin: 'ORD', dest: 'SFO', reg: 'N11111', airborne_at: expect.any(String) })]);
  });

  it('skips the harvest when nothing is live', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-05T05:10:00.000Z') });
    const urls = serve(() => leg());
    await run([{ flight: 'UA1', legDep: TODAY_DEP, retired: true, retiredAt: '2026-10-04T05:00:00.000Z' }]);
    expect(urls).toHaveLength(0);
  });
});
