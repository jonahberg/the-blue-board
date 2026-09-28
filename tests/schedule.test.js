import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const scheduleSnapshotMocks = vi.hoisted(() => ({
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
}));

const vercelFunctionMocks = vi.hoisted(() => ({
  waitUntil: vi.fn(),
}));

vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => scheduleSnapshotMocks);
vi.mock('@vercel/functions', () => vercelFunctionMocks);

import handler, { shouldAttemptOfficialFallback, recordFallback, resetFallbackBreaker, __resetScheduleCachesForTests, shouldEnableProviderForBackgroundRefresh, shouldEnableOfficialForBackgroundRefresh, noteProviderRefreshFailed } from '../api/schedule.js';
import { getStartOfDayForHub } from '../api/irops.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { recordAdbUnits, isAdbOrganicRefreshGated, getAdbPacedAllowance, __resetAdbSpendForTests } from '../api/_cost-state.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';

function formatForFR24Test(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Every upstream-failure path in api/schedule.ts and the AeroDataBox adapter waits (retry
// backoff, rate-limit pauses, batch gaps). Those waits are env-scaled so the suite exercises the
// same code in milliseconds instead of ~35s of real sleeps with Date frozen underneath them.
function setFastRetries() {
  process.env.SCHEDULE_RETRY_DELAY_SCALE = '0';
  process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
  process.env.AERODATABOX_RETRY_BASE_MS = '0';
}

function clearFastRetries() {
  delete process.env.SCHEDULE_RETRY_DELAY_SCALE;
  delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
  delete process.env.AERODATABOX_RETRY_BASE_MS;
}

const OFFICIAL_HOST = 'fr24api.flightradar24.com';
const SCRAPE_URL = 'api.flightradar24.com/common/v1/airport.json';
const called = (spy, needle) => spy.mock.calls.some((c) => String(c[0]).includes(needle));

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe('schedule API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Pin the wall clock — Date ONLY; real timers stay real so retry/deadline async
    // behavior is untouched. Unpinned, this suite computes "today"/"tomorrow" from the
    // machine clock, and during 00:00–06:00 ORD-local the day rollover makes the tests'
    // tomorrow ts equal today's hub-day start — the API's same-day gates then cascade
    // background fetches and a rotating victim test fails its exact fetch/waitUntil
    // counts (flake proven on pristine main, Jul 5 2026). Midday UTC is safely inside
    // the same hub-local day everywhere the suite reasons about time.
    vi.useFakeTimers({ toFake: ['Date'] });
    // (Sanity check for future readers: setting this to 07:00Z — 02:00 ORD — deterministically
    // reproduces the overnight failure at any real time of day.)
    vi.setSystemTime(new Date('2026-07-05T18:00:00Z'));
    __resetRateLimitersForTests();
    __resetScheduleCachesForTests();
    setFastRetries();
    scheduleSnapshotMocks.loadScheduleSnapshot.mockReset();
    scheduleSnapshotMocks.saveScheduleSnapshot.mockReset();
    scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue(null);
    scheduleSnapshotMocks.saveScheduleSnapshot.mockResolvedValue(undefined);
    vercelFunctionMocks.waitUntil.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.FR24_API_TOKEN;
    delete process.env.AERODATABOX_API_KEY;
    delete process.env.AERODATABOX_BASE_URL;
    delete process.env.SCRAPINGBEE_API_KEY;
    delete process.env.SCHEDULE_SCRAPER_MODE;
    delete process.env.SCHEDULE_SCRAPER_RENDER_JS;
    delete process.env.SCHEDULE_SCRAPER_PREMIUM_PROXY;
    delete process.env.SCHEDULE_SCRAPER_COUNTRY;
    delete process.env.SCHEDULE_SCRAPER_URL;
    delete process.env.SCHEDULE_SCRAPER_TOKEN;
    clearFastRetries();
    delete process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED;
    delete process.env.SCHEDULE_LIVE_FEED_FALLBACK_ENABLED;
    resetFallbackBreaker();
  });

  it('treats missing schedule block on page 1 as empty data instead of upstream failure', async () => {
    // FR24 returns a valid airport payload but with no schedule block (future dates)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          response: {
            airport: {
              pluginData: {}
            }
          }
        }
      })
    });

    const ts = Math.floor(Date.now() / 1000);
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'LAX', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(false);
    expect(res.body.total).toBe(0);
    expect(res.body.meta.partialReason).toBe(null);
  });

  it('an empty rescue never becomes a clean, CDN-pinned board', async () => {
    // A United hub is never legitimately empty same-day. Here the official rescue comes back empty
    // and the on-demand web scrape answers a clean HTTP 200 with no schedule block (a soft
    // datacenter-IP block). Left non-partial, that 0-flight board would be cached like a clean
    // today board (1h hot + s-maxage=3600 at the edge, and a durable snapshot). It must instead be
    // flagged partial so the empty-board guards apply: a 30s CDN TTL.
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes(OFFICIAL_HOST)) return { ok: true, headers: { get: () => null }, json: async () => ({ data: [] }) };
      return { ok: true, headers: { get: () => null }, json: async () => ({ result: { response: { airport: { pluginData: {} } } } }) };
    });

    const ts = getStartOfDayForHub('DEN');
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { hub: 'DEN', dir: 'arrivals', timestamp: String(ts) } }, res);

    expect(res.statusCode).toBe(200);
    expect(called(fetchSpy, OFFICIAL_HOST)).toBe(true); // the rescue really ran and was empty
    expect(res.body.total).toBe(0);
    expect(res.body.partial).toBe(true);
    expect(res.body.meta.partialReason).toBe('empty_200_suspected_block');
    expect(res.headers['Cache-Control']).toBe('s-maxage=30, stale-while-revalidate=60');
    expect(scheduleSnapshotMocks.saveScheduleSnapshot).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ partial: true }) }));
  });

  it('parses numeric-string timestamps from official API so schedule times are populated', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          flight_icao: 'UAL2118',
          flight_iata: 'UA2118',
          status: 'scheduled',
          orig_iata: 'ORD',
          dest_iata: 'DEN',
          scheduled_departure: '1741653600',
          scheduled_arrival: '1741660800',
          estimated_departure: '1741654200'
        }]
      }),
    });

    const ts = Math.floor(Date.now() / 1000) - 7200;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    const flight = res.body.flights[0];
    expect(flight.time.scheduled.departure).toBe(1741653600);
    expect(flight.time.scheduled.arrival).toBe(1741660800);
    expect(flight.time.estimated.departure).toBe(1741654200);
  });

  it('marks response partial when official API fails after first page', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    const firstPageFlights = Array.from({ length: 10000 }, (_, i) => ({
      flight_icao: `UAL${2000 + i}`,
      flight_iata: `UA${2000 + i}`,
      status: 'scheduled',
      orig_iata: 'IAH',
      dest_iata: 'DEN',
      scheduled_departure: 1741653600,
      scheduled_arrival: 1741660800,
    }));

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('page=1')) {
        return {
          ok: true,
          json: async () => ({ data: firstPageFlights }),
        };
      }
      return {
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
        headers: { get: () => '1' }
      };
    });

    const ts = Math.floor(Date.now() / 1000) - 10800;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'IAH', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.meta.partialReason).toBe('upstream_http_error');
    expect(res.body.meta.pagesFailed).toBe(1);
    expect(res.body.meta.pagesSucceeded).toBe(1);
  });

  it('rejects sparse official API data and falls back to scraping', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    // Official API returns flights with no scheduled times (sparse)
    const sparseFlights = Array.from({ length: 10 }, (_, i) => ({
      flight_icao: `UAL${3000 + i}`,
      flight_iata: `UA${3000 + i}`,
      status: 'scheduled',
      orig_iata: 'SFO',
      dest_iata: 'LAX',
      // No scheduled_departure or scheduled_arrival — sparse data
    }));

    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      callCount++;
      const urlStr = String(url);
      // First call: official API returns sparse data
      if (urlStr.includes('fr24api.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({ data: sparseFlights }),
        };
      }
      // Scraping fallback: return valid schedule data
      return {
        ok: true,
        json: async () => ({
          result: {
            response: {
              airport: {
                pluginData: {
                  schedule: {
                    departures: {
                      page: { current: 1, total: 1 },
                      data: [{
                        flight: {
                          airline: { code: { iata: 'UA' } },
                          identification: { number: { default: 'UA500' } },
                          time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
                          airport: {
                            origin: { code: { iata: 'SFO' } },
                            destination: { code: { iata: 'LAX' } }
                          }
                        }
                      }]
                    }
                  }
                }
              }
            }
          }
        }),
      };
    });

    const ts = Math.floor(Date.now() / 1000) - 14400;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'SFO', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Should have fallen back to scraping since official API was sparse
    expect(callCount).toBeGreaterThan(1); // official API call + scraping call(s)
    // Assert the SCRAPED board was actually served — not the rejected sparse official rows, and not
    // an empty board. Without these, any second fetch (callCount>1) still passes even if the wrong
    // (or empty) board ships to the client.
    expect(res.body.meta.source).toBe('scraping');
    expect(res.body.total).toBe(1);
    expect(res.body.flights[0].identification.number.default).toBe('UA500');
  });

  it('filters individual sparse flights but keeps good ones from official API', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    const mixedFlights = [
      // Good flights with scheduled times
      ...Array.from({ length: 8 }, (_, i) => ({
        flight_icao: `UAL${4000 + i}`,
        flight_iata: `UA${4000 + i}`,
        status: 'scheduled',
        orig_iata: 'EWR',
        dest_iata: 'ORD',
        scheduled_departure: 1741653600 + i * 3600,
        scheduled_arrival: 1741660800 + i * 3600,
      })),
      // Sparse flights without scheduled times (< 50% so quality gate passes)
      ...Array.from({ length: 2 }, (_, i) => ({
        flight_icao: `UAL${4100 + i}`,
        flight_iata: `UA${4100 + i}`,
        status: 'scheduled',
        orig_iata: 'EWR',
        dest_iata: 'LAX',
        // No scheduled times
      })),
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: mixedFlights }),
    });

    const ts = Math.floor(Date.now() / 1000) - 18000;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'EWR', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('official-api');
    expect(res.body.total).toBe(8); // only good flights
    expect(res.body.meta.sparseFiltered).toBe(2);
  });

  // ═══ Provider-first routing: rescue order and the on-demand fallthrough ═══

  it('no provider key and no FR24 token: an on-demand request falls through to the web scrape and serves it', async () => {
    // Provider first (no key) → official rescue (no token) → live feed (not today) → the web scrape.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        return { ok: false, status: 500, text: async () => 'unexpected', headers: { get: () => null } };
      }
      return {
        ok: true,
        json: async () => ({
          result: {
            response: {
              airport: {
                pluginData: {
                  schedule: {
                    departures: {
                      page: { current: 1, total: 1 },
                      data: [{
                        flight: {
                          airline: { code: { iata: 'UA' } },
                          identification: { number: { default: 'UA100' } },
                          time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
                          airport: {
                            origin: { code: { iata: 'ORD' } },
                            destination: { code: { iata: 'LAX' } }
                          }
                        }
                      }]
                    }
                  }
                }
              }
            }
          }
        }),
      };
    });

    const ts = Math.floor(Date.now() / 1000) - 21600;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('scraping');
    expect(res.body.total).toBe(1);
    expect(called(fetchSpy, SCRAPE_URL)).toBe(true);
    expect(called(fetchSpy, OFFICIAL_HOST)).toBe(false); // no token → no paid rescue
  });

  it('provider mode, no ADB key: today is rescued by the official API over the hub-local day window', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    let officialUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        officialUrl = urlStr;
        return {
          ok: true,
          json: async () => ({
            data: [{
              flight_icao: 'UAL201',
              flight_iata: 'UA201',
              status: 'scheduled',
              orig_iata: 'GUM',
              dest_iata: 'NRT',
              scheduled_departure: 1741653600,
              scheduled_arrival: 1741660800,
            }]
          }),
        };
      }
      return { ok: false, status: 403, text: async () => 'Forbidden', headers: { get: () => null } };
    });

    const ts = getStartOfDayForHub('GUM');
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'GUM', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('official-api');
    expect(res.body.meta.fallbackFrom).toBe('scraping');
    expect(officialUrl).toContain(`flight_datetime_from=${encodeURIComponent(formatForFR24Test(new Date(ts * 1000)))}`);
    expect(officialUrl).toContain(`flight_datetime_to=${encodeURIComponent(formatForFR24Test(new Date((ts + 86400 - 1) * 1000)))}`);
  });

  it('provider mode, no ADB key: the official rescue answers BEFORE the web scrape is tried', async () => {
    // The "0-flight board" regression: a clean empty-200 scrape used to pre-empt the official
    // rescue. In provider mode the rescue runs first, so a same-day board with a token is the
    // official board and the scrape is never reached.
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    let officialCalled = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        officialCalled = true;
        return {
          ok: true,
          json: async () => ({
            data: [{
              flight_icao: 'UAL100',
              flight_iata: 'UA100',
              status: 'scheduled',
              orig_iata: 'ORD',
              dest_iata: 'LAX',
              scheduled_departure: 1741653600,
              scheduled_arrival: 1741660800,
            }]
          }),
        };
      }
      // Direct FR24 scrape: clean HTTP 200, valid airport payload, but NO schedule block → 0 flights.
      return {
        ok: true,
        json: async () => ({ result: { response: { airport: { pluginData: {} } } } }),
        headers: { get: () => null },
      };
    });

    const ts = getStartOfDayForHub('ORD'); // today; ORD is a TARGETED_OFFICIAL_RESCUE_HUB
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(officialCalled).toBe(true);
    expect(res.body.meta.source).toBe('official-api');
    expect(res.body.total).toBeGreaterThan(0);
    expect(called(fetchSpy, SCRAPE_URL)).toBe(false);
  });

  it('the official rescue can be disabled by env (SCHEDULE_OFFICIAL_FALLBACK_ENABLED=0)', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = '0';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called when fallback is disabled');
      }
      return { ok: false, status: 403, text: async () => 'Forbidden', headers: { get: () => null } };
    });

    const ts = getStartOfDayForHub('EWR');
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'EWR', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.meta.source).toBe('scraping');
    expect(res.body.meta.partialReason).toBe('first_page_failed');
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('fr24api.flightradar24.com');
    }
  });

  it('provider mode, no ADB key: renders actual-only official summary rows as degraded same-day data', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    const ts = getStartOfDayForHub('ORD');
    const takeoff = ts + (10 * 60 * 60);
    const landed = takeoff + (94 * 60);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              fr24_id: '3fb86069',
              flight: 'UA795',
              callsign: 'UAL795',
              operating_as: 'UAL',
              type: 'A21N',
              reg: 'N44550',
              orig_icao: 'KORD',
              datetime_takeoff: new Date(takeoff * 1000).toISOString().replace('.000Z', 'Z'),
              dest_icao: 'KEWR',
              dest_icao_actual: 'KEWR',
              datetime_landed: new Date(landed * 1000).toISOString().replace('.000Z', 'Z'),
              flight_ended: true
            }]
          }),
        };
      }
      return { ok: false, status: 403, text: async () => 'Forbidden', headers: { get: () => null } };
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.partial).toBe(true);
    expect(res.body.meta.source).toBe('official-api');
    expect(res.body.meta.fallbackFrom).toBe('scraping');
    expect(res.body.meta.partialReason).toBe('actual_only_official');
    expect(res.body.meta.actualTimeFallbackCount).toBe(1);
    expect(res.body.meta.completeness).toBeGreaterThanOrEqual(0.25);

    const flight = res.body.flights[0];
    expect(flight.identification.number.default).toBe('UA795');
    expect(flight.identification.callsign).toBe('UAL795');
    expect(flight.airport.origin.code.iata).toBe('ORD');
    expect(flight.airport.destination.code.iata).toBe('EWR');
    expect(flight.aircraft.model.code).toBe('A21N');
    expect(flight.aircraft.registration).toBe('N44550');
    expect(flight.time.scheduled.departure).toBe(takeoff);
    expect(flight.time.real.departure).toBe(takeoff);
    expect(flight.time.real.arrival).toBe(landed);
    expect(flight._source.scheduleTimeDerivedFromActual.departure).toBe(true);
  });

  it('does not retry official API while FR24 credits are exhausted', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    let officialCalls = 0;
    let scrapeCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        officialCalls++;
        return {
          ok: false,
          status: 402,
          text: async () => '{"message":"Forbidden","details":"Credit limit reached. Please top up your account."}',
        };
      }

      scrapeCalls++;
      return {
        ok: true,
        json: async () => ({
          result: {
            response: {
              airport: {
                pluginData: {
                  schedule: {
                    arrivals: {
                      page: { current: 1, total: 1 },
                      data: []
                    }
                  }
                }
              }
            }
          }
        }),
      };
    });

    // Two days back: snapped day is never "today", keeping the today-only live-feed rescue out of
    // this test's fetch counts regardless of wall-clock time.
    const ts1 = Math.floor(Date.now() / 1000) - 172800;
    const req1 = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'DEN', dir: 'arrivals', timestamp: String(ts1) }
    };
    const res1 = createRes();

    await handler(req1, res1);

    const ts2 = ts1 + 60;
    const req2 = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'EWR', dir: 'arrivals', timestamp: String(ts2) }
    };
    const res2 = createRes();

    await handler(req2, res2);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(officialCalls).toBe(1);
    expect(scrapeCalls).toBe(2);
    expect(res2.body.meta.source).toBe('scraping');
  });

  it('honors officialFallback=0: no paid rescue, the request degrades to the scrape', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = '1';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called when officialFallback=0');
      }
      return { ok: false, status: 403, text: async () => 'Forbidden', headers: { get: () => null } };
    });

    const ts = getStartOfDayForHub('IAH') + 86400;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'IAH', dir: 'departures', timestamp: String(ts), officialFallback: '0' }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.meta.source).toBe('scraping');
    expect(res.body.meta.partialReason).toBe('first_page_failed');
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('fr24api.flightradar24.com');
    }
  });

  it('provider mode: maps the AeroDataBox row (gate, terminal, tail, times) and never calls the official API', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.AERODATABOX_API_KEY = 'adb-test-key';

    const ts = getStartOfDayForHub('GUM') + 86400;
    const depTime = ts + 9 * 3600;
    const arrTime = ts + 12 * 3600;
    let aeroCalls = 0;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called after provider success');
      }
      if (urlStr.includes('prod.api.market/api/v1/aedbx/aerodatabox')) {
        aeroCalls++;
        expect(init?.headers?.['x-magicapi-key']).toBe('adb-test-key');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            departures: aeroCalls === 1 ? [{
              number: 'UA150',
              callSign: 'UAL150',
              status: 'Expected',
              codeshareStatus: 'IsOperator',
              isCargo: false,
              airline: { iata: 'UA', icao: 'UAL', name: 'United Airlines' },
              departure: {
                airport: { iata: 'GUM', icao: 'PGUM', name: 'Guam' },
                scheduledTime: { utc: new Date(depTime * 1000).toISOString(), local: '2026-05-17T09:00:00+10:00' },
                terminal: '1',
                gate: '4',
                quality: ['Basic'],
              },
              arrival: {
                airport: { iata: 'NRT', icao: 'RJAA', name: 'Tokyo Narita' },
                scheduledTime: { utc: new Date(arrTime * 1000).toISOString(), local: '2026-05-17T12:00:00+09:00' },
                quality: ['Basic'],
              },
              aircraft: { model: 'Boeing 737-800', reg: 'N37267' },
            }] : [],
          }),
        };
      }
      return { ok: false, status: 500, text: async () => 'FR24 unavailable', headers: { get: () => null } };
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'GUM', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.partial).toBe(false);
    expect(res.body.meta.source).toBe('aerodatabox');
    expect(aeroCalls).toBe(2);
    expect(called(fetchSpy, SCRAPE_URL)).toBe(false);
    expect(fetchSpy.mock.calls.some(call => String(call[0]).includes('fr24api.flightradar24.com'))).toBe(false);

    const flight = res.body.flights[0];
    expect(flight.identification.number.default).toBe('UA150');
    expect(flight.airport.origin.code.iata).toBe('GUM');
    expect(flight.airport.destination.code.iata).toBe('NRT');
    expect(flight.airport.origin.info.gate).toBe('4');
    expect(flight.airport.origin.info.terminal).toBe('1');
    expect(flight.aircraft.registration).toBe('N37267');
    expect(flight.time.scheduled.departure).toBe(depTime);
    expect(flight.time.scheduled.arrival).toBe(arrTime);
  });

  it('on-demand scrape: a configured http-json scraper transport recovers a Cloudflare-blocked direct page', async () => {
    // ScrapingBee was removed; the surviving generic transport is the http-json proxy
    // (SCHEDULE_SCRAPER_URL). It only matters once the provider and the rescues had nothing.
    process.env.SCHEDULE_SCRAPER_URL = 'https://proxy.example.com/fetch';
    process.env.SCHEDULE_SCRAPER_TOKEN = 'proxy-secret';

    const ts = getStartOfDayForHub('SFO') + 86400;
    const depTime = ts + 7 * 3600;
    const arrTime = ts + 11 * 3600;
    let proxyCalls = 0;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('proxy.example.com/fetch')) {
        proxyCalls++;
        expect(init?.headers?.Authorization).toBe('Bearer proxy-secret');
        const sent = JSON.parse(init.body);
        expect(sent.url).toContain('api.flightradar24.com/common/v1/airport.json');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            result: {
              response: {
                airport: {
                  pluginData: {
                    schedule: {
                      departures: {
                        page: { current: 1, total: 1 },
                        data: [{
                          flight: {
                            airline: { code: { iata: 'UA' } },
                            identification: { number: { default: 'UA900' }, callsign: 'UAL900' },
                            time: { scheduled: { departure: depTime, arrival: arrTime } },
                            airport: {
                              origin: { code: { iata: 'SFO' }, info: { gate: 'F12', terminal: '3' } },
                              destination: { code: { iata: 'NRT' }, info: { gate: '', terminal: '' } }
                            },
                            aircraft: { registration: 'N26902' }
                          }
                        }]
                      }
                    }
                  }
                }
              }
            }
          }),
        };
      }
      if (urlStr.includes('prod.api.market/api/v1/aedbx/aerodatabox')) {
        throw new Error('AeroDataBox should not be called after scraper transport success');
      }
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called after scraper transport success');
      }
      return {
        ok: false,
        status: 403,
        text: async () => 'Cloudflare challenge',
        headers: { get: (name) => String(name).toLowerCase() === 'cf-mitigated' ? 'challenge' : null },
      };
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'SFO', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.partial).toBe(false);
    expect(res.body.meta.source).toBe('scraping');
    expect(res.body.meta.scrapeTransport).toBe('http-json');
    expect(res.body.meta.scraperRecoveredPages).toBe(1);
    expect(res.body.meta.fallbackFrom).toBeUndefined();
    expect(proxyCalls).toBe(1);
    expect(fetchSpy.mock.calls.some(call => String(call[0]).includes('prod.api.market/api/v1/aedbx/aerodatabox'))).toBe(false);
    expect(fetchSpy.mock.calls.some(call => String(call[0]).includes('fr24api.flightradar24.com'))).toBe(false);
  });

  it('honors scraperFallback=0 when direct FR24 scraping is blocked', async () => {
    process.env.SCHEDULE_SCRAPER_URL = 'https://proxy.example.com/fetch';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('proxy.example.com/fetch')) {
        throw new Error('Scraper transport should not be called when scraperFallback=0');
      }
      return {
        ok: false,
        status: 403,
        text: async () => 'Cloudflare challenge',
        headers: { get: (name) => String(name).toLowerCase() === 'cf-mitigated' ? 'challenge' : null },
      };
    });

    const ts = getStartOfDayForHub('NRT') + 86400;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'NRT', dir: 'arrivals', timestamp: String(ts), scraperFallback: '0' }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.total).toBe(0);
    expect(res.body.meta.source).toBe('scraping');
    expect(res.body.meta.partialReason).toBe('first_page_failed');
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('proxy.example.com/fetch');
    }
  });

  it('honors providerFallback=0 when scraping fails', async () => {
    process.env.AERODATABOX_API_KEY = 'adb-test-key';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('prod.api.market/api/v1/aedbx/aerodatabox')) {
        throw new Error('AeroDataBox should not be called when providerFallback=0');
      }
      return { ok: false, status: 500, text: async () => 'FR24 unavailable', headers: { get: () => null } };
    });

    const ts = getStartOfDayForHub('LAX') + 2 * 86400;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'LAX', dir: 'arrivals', timestamp: String(ts), providerFallback: '0' }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.meta.source).toBe('scraping');
    expect(res.body.meta.partialReason).toBe('first_page_failed');
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('prod.api.market/api/v1/aedbx/aerodatabox');
    }
  });

  it('provider mode: serves the full AeroDataBox board (incl. upcoming) and skips the dead FR24 scrape + official API', async () => {
    // AeroDataBox is the only source that returns the full forward board from Vercel. The Cloudflare-dead FR24 scrape and the
    // (schedule-less) official API must NOT be touched when the provider returns a board.
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    const ts = getStartOfDayForHub('DEN');
    const iso = (h) => new Date((ts + h * 3600) * 1000).toISOString();
    const adbDepartures = {
      departures: [
        {
          number: 'UA 123', callSign: 'UAL123', status: 'Scheduled',
          airline: { iata: 'UA', icao: 'UAL', name: 'United Airlines' },
          departure: { scheduledTime: { utc: iso(20) }, revisedTime: { utc: iso(20) }, terminal: 'B', gate: 'B7', airport: { iata: 'DEN', name: 'Denver' } },
          arrival: { scheduledTime: { utc: iso(23) }, airport: { iata: 'SFO', name: 'San Francisco' } },
          aircraft: { model: 'Boeing 737', reg: 'N12345' },
        },
        {
          number: 'UA 456', callSign: 'UAL456', status: 'Departed',
          airline: { iata: 'UA', icao: 'UAL', name: 'United Airlines' },
          departure: { scheduledTime: { utc: iso(8) }, runwayTime: { utc: iso(8) }, terminal: 'B', gate: 'C5', airport: { iata: 'DEN', name: 'Denver' } },
          arrival: { scheduledTime: { utc: iso(11) }, airport: { iata: 'ORD', name: "Chicago O'Hare" } },
          aircraft: { model: 'Airbus A320', reg: 'N67890' },
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('aedbx/aerodatabox')) {
        return { ok: true, status: 200, json: async () => adbDepartures };
      }
      if (urlStr.includes('api.flightradar24.com/common/v1/airport.json')) {
        throw new Error('Dead FR24 scrape must not be called in provider mode');
      }
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API must not be called when the provider returns a full board');
      }
      return { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null } };
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'DEN', dir: 'departures', timestamp: String(ts) },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('aerodatabox');
    expect(res.body.total).toBe(2);
    expect(res.body.partial).toBe(false);
    const upcoming = res.body.flights.find((f) => f.identification.number.default === 'UA123');
    expect(upcoming).toBeTruthy();
    expect(upcoming.status.text).toBe('scheduled');
    expect(upcoming.airport.destination.code.iata).toBe('SFO');
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('common/v1/airport.json'))).toBe(false);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('fr24api.flightradar24.com'))).toBe(false);
  });

  it('provider mode without a key: falls through to FR24 official + live feed, never touching the dead scrape', async () => {
    // Zero-key graceful degrade: with no AERODATABOX_API_KEY, provider mode skips the dead scrape and
    // serves the official (active+completed) board merged with the free live feed.
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    const ts = getStartOfDayForHub('IAH');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('api.flightradar24.com/common/v1/airport.json')) {
        throw new Error('Dead FR24 scrape must not be called in provider mode');
      }
      if (urlStr.includes('fr24api.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              fr24_id: 'x1', flight: 'UA795', callsign: 'UAL795', operating_as: 'UAL', type: 'A21N', reg: 'N1',
              orig_icao: 'KIAH', datetime_takeoff: new Date((ts + 9 * 3600) * 1000).toISOString().replace('.000Z', 'Z'),
              dest_icao: 'KEWR', dest_icao_actual: 'KEWR', datetime_landed: new Date((ts + 12 * 3600) * 1000).toISOString().replace('.000Z', 'Z'),
              flight_ended: true,
            }],
          }),
        };
      }
      if (urlStr.includes('data-cloud.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            full_count: 1, version: 4,
            'live-1': ['B1', 29.98, -95.34, 270, 35000, 430, '', '', 'B38M', 'N2', ts + 14 * 3600, 'IAH', 'SFO', 'UA999', 0, -500, 'UAL999', '', 'UAL'],
          }),
        };
      }
      return { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null } };
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'IAH', dir: 'departures', timestamp: String(ts) },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('official-api');
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.meta.liveFeedFallbackAdded).toBeGreaterThanOrEqual(1);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('common/v1/airport.json'))).toBe(false);
  });

  it('uses same-day live FR24 feed as a degraded schedule fallback when scraping is blocked', async () => {
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = '0';

    const ts = getStartOfDayForHub('IAH');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('data-cloud.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            full_count: 1,
            version: 4,
            '3fb-test': [
              'A2A3B5',
              30.2,
              -91.4,
              270,
              33000,
              430,
              '',
              '',
              'B38M',
              'N27263',
              ts + 13 * 3600,
              'BOS',
              'IAH',
              'UA1976',
              0,
              -500,
              'UAL1976',
              '',
              'UAL'
            ],
          }),
        };
      }
      return {
        ok: false,
        status: 403,
        text: async () => 'Cloudflare challenge',
        headers: { get: (name) => String(name).toLowerCase() === 'cf-mitigated' ? 'challenge' : null },
      };
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'IAH', dir: 'arrivals', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.partial).toBe(true);
    expect(res.body.meta.source).toBe('live-feed');
    expect(res.body.meta.partialReason).toBe('live_feed_fallback');
    expect(res.body.meta.fallbackFrom).toBe('scraping');
    const flight = res.body.flights[0];
    expect(flight.identification.number.default).toBe('UA1976');
    expect(flight.airport.origin.code.iata).toBe('BOS');
    expect(flight.airport.destination.code.iata).toBe('IAH');
    expect(flight.aircraft.registration).toBe('N27263');
    expect(flight._source.liveFeedFallback).toBe(true);
    expect(flight.time.scheduled.arrival).toBeGreaterThan(ts);
    expect(flight.time.estimated.arrival).toBe(flight.time.scheduled.arrival);
  });

  it('provider mode, no ADB key: merges the official actual-only board with the live feed and ranks it above bare live-feed', async () => {
    // Regression for the live degradation (boards stuck on stale live-feed despite the official API
    // being called): when the scrape is blocked, the official actual-only board is merged with
    // live-feed active flights into the richest board. mergeLiveFeedFallback must recompute
    // completeness ABOVE the 0.35 live-feed baseline so the combined board wins and is served,
    // instead of being discarded for a bare live-feed snapshot. (FR24-economy fix.)
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    const ts = getStartOfDayForHub('ORD');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      // Official API: one COMPLETED ORD departure (actual times only, no scheduled) -> actual-only board.
      if (urlStr.includes('fr24api.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              fr24_id: 'aaa111', flight: 'UA795', callsign: 'UAL795', operating_as: 'UAL',
              type: 'A21N', reg: 'N44550', orig_icao: 'KORD',
              datetime_takeoff: new Date((ts + 10 * 3600) * 1000).toISOString().replace('.000Z', 'Z'),
              dest_icao: 'KEWR', dest_icao_actual: 'KEWR',
              datetime_landed: new Date((ts + 12 * 3600) * 1000).toISOString().replace('.000Z', 'Z'),
              flight_ended: true,
            }],
          }),
        };
      }
      // Live feed: a DIFFERENT active flight departing ORD -> added in the merge.
      if (urlStr.includes('data-cloud.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            full_count: 1, version: 4,
            'live-1': ['B1', 41.97, -87.9, 270, 35000, 430, '', '', 'B38M', 'N12345',
              ts + 14 * 3600, 'ORD', 'SFO', 'UA999', 0, -500, 'UAL999', '', 'UAL'],
          }),
        };
      }
      // Direct scrape: Cloudflare-blocked.
      return { ok: false, status: 403, text: async () => 'Forbidden', headers: { get: () => null } };
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Combined: official completed flight + live-feed active flight (deduped, both kept).
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.meta.liveFeedFallbackAdded).toBeGreaterThanOrEqual(1);
    // Change 1: completeness recomputed above the 0.35 live-feed baseline so the merged board wins.
    expect(res.body.meta.completeness).toBeGreaterThan(0.35);
    // It's the official-base merged board, NOT bare live-feed.
    expect(res.body.meta.source).toBe('official-api');
  });

  it('circuit breaker trips after repeated fallbacks', () => {
    // Record 5 fallbacks — breaker should trip
    for (let i = 0; i < 5; i++) recordFallback();
    expect(shouldAttemptOfficialFallback()).toBe(false);

    // Reset and verify breaker is open again
    resetFallbackBreaker();
    expect(shouldAttemptOfficialFallback()).toBe(true);
  });

  it('meta.source is scraping on default successful scrape', async () => {
    // No FR24_API_TOKEN — simplest case
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          response: {
            airport: {
              pluginData: {
                schedule: {
                  departures: {
                    page: { current: 1, total: 1 },
                    data: [{
                      flight: {
                        airline: { code: { iata: 'UA' } },
                        identification: { number: { default: 'UA300' } },
                        time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
                        airport: {
                          origin: { code: { iata: 'SFO' } },
                          destination: { code: { iata: 'ORD' } }
                        }
                      }
                    }]
                  }
                }
              }
            }
          }
        }
      }),
    });

    const ts = Math.floor(Date.now() / 1000) - 36000;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'SFO', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.meta.source).toBe('scraping');
  });

  it('returns a fresh+complete persisted snapshot honestly flagged, without a pointless refresh', async () => {
    // Two days back: the snapped day is never "today", so the empty-board live-feed rescue
    // (a today-only path) cannot add clock-dependent fetches to this test.
    // The snapshot is COMPLETE and only 5 min old, so it is genuinely fresh: the handler must serve
    // it as cached:true but stale:false, degraded:false (honest labeling) and must NOT trigger a
    // background refresh — a refresh of a fresh+complete board can only degrade it to a partial.
    // (Audit: stale/degraded mislabeling + busy-hub flapping.)
    const ts = Math.floor(Date.now() / 1000) - 172800;
    const tsSnapped = getStartOfHubDay('ORD', 0, new Date(ts * 1000));
    scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue({
      data: {
        flights: [{
          airline: { code: { iata: 'UA' } },
          identification: { number: { default: 'UA777' } },
          time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
          airport: {
            origin: { code: { iata: 'ORD' } },
            destination: { code: { iata: 'SFO' } }
          }
        }],
        total: 1,
        totalFetched: 1,
        pagesScanned: 1,
        totalPages: 1,
        cached: false,
        partial: false,
        hub: 'ORD',
        dir: 'departures',
        meta: {
          partialReason: null,
          pagesRequested: 1,
          pagesSucceeded: 1,
          pagesFailed: 0,
          missingPages: [],
          completeness: 1,
          elapsedMs: 50,
          source: 'scraping'
        }
      },
      refreshedAt: Date.now() - (5 * 60 * 1000)
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch should not run when a fresh+complete persisted snapshot is available');
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.cached).toBe(true);
    // Fresh (5 min) + complete → honestly flagged, NOT stale/degraded.
    expect(res.body.stale).toBe(false);
    expect(res.body.degraded).toBe(false);
    expect(res.body.meta.fallbackScope).toBe('persistent');
    expect(scheduleSnapshotMocks.loadScheduleSnapshot).toHaveBeenCalledWith(`agg:ORD:departures:${tsSnapped}`);
    // No background refresh: a fresh+complete board has nothing to refresh.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vercelFunctionMocks.waitUntil).not.toHaveBeenCalled();
  });

  it('returns persisted partial snapshot on cold start while refreshing in the background', async () => {
    // A partial snapshot is NOT fresh+complete, so the background refresh still fires. With no
    // provider key and no token it has nothing metered to call, and a background refresh never
    // falls through to the web scrape.
    const ts = getStartOfDayForHub('ORD') + 86400;
    scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue({
      data: {
        flights: [{
          airline: { code: { iata: 'UA' } },
          identification: { number: { default: 'UA123' } },
          time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
          airport: {
            origin: { code: { iata: 'ORD' } },
            destination: { code: { iata: 'LAX' } }
          }
        }],
        total: 1,
        totalFetched: 2,
        pagesScanned: 2,
        totalPages: 4,
        cached: false,
        partial: true,
        hub: 'ORD',
        dir: 'departures',
        meta: {
          partialReason: 'rate_limited',
          pagesRequested: 4,
          pagesSucceeded: 2,
          pagesFailed: 2,
          missingPages: [3, 4],
          completeness: 0.5,
          elapsedMs: 75,
          source: 'scraping'
        }
      },
      refreshedAt: Date.now() - (7 * 60 * 1000)
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('background refresh should be best-effort');
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.partial).toBe(true);
    expect(res.body.degraded).toBe(true);
    expect(res.body.meta.fallbackScope).toBe('persistent_partial');
    expect(res.body.meta.bestKnownPartial).toBe(true);
    expect(vercelFunctionMocks.waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(vercelFunctionMocks.waitUntil.mock.calls.map((c) => c[0]));
    expect(called(fetchSpy, SCRAPE_URL)).toBe(false);
  });

  it('persists complete aggregated results after a successful fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          response: {
            airport: {
              pluginData: {
                schedule: {
                  departures: {
                    page: { current: 1, total: 1 },
                    data: [{
                      flight: {
                        airline: { code: { iata: 'UA' } },
                        identification: { number: { default: 'UA888' } },
                        time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
                        airport: {
                          origin: { code: { iata: 'EWR' } },
                          destination: { code: { iata: 'LAX' } }
                        }
                      }
                    }]
                  }
                }
              }
            }
          }
        }
      }),
    });

    const ts = Math.floor(Date.now() / 1000) - 50400;
    // The handler snaps any intra-day timestamp to the hub-local day start before keying.
    const tsSnapped = getStartOfHubDay('EWR', 0, new Date(ts * 1000));
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'EWR', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(false);
    expect(scheduleSnapshotMocks.saveScheduleSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      cacheKey: `agg:EWR:departures:${tsSnapped}`,
      hub: 'EWR',
      dir: 'departures',
      ts: tsSnapped,
      data: expect.objectContaining({
        partial: false,
        total: 1
      })
    }));
  });

  it('persists partial aggregated results when they are the best available fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      const pageMatch = urlStr.match(/page=(\d+)/);
      const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;

      if (page === 2) {
        return { ok: false, status: 429, text: async () => 'Too Many Requests', headers: { get: () => null } };
      }

      return {
        ok: true,
        json: async () => ({
          result: {
            response: {
              airport: {
                pluginData: {
                  schedule: {
                    departures: {
                      page: { current: page, total: 2 },
                      data: [{
                        flight: {
                          airline: { code: { iata: 'UA' } },
                          identification: { number: { default: `UA8${page}` } },
                          time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
                          airport: {
                            origin: { code: { iata: 'ORD' } },
                            destination: { code: { iata: 'LAX' } }
                          }
                        }
                      }]
                    }
                  }
                }
              }
            }
          }
        }),
      };
    });

    const ts = getStartOfDayForHub('ORD') + 86400;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.total).toBe(1);
    expect(scheduleSnapshotMocks.saveScheduleSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      cacheKey: `agg:ORD:departures:${ts}`,
      data: expect.objectContaining({
        partial: true,
        total: 1,
        meta: expect.objectContaining({
          completeness: 0.5,
          partialReason: 'rate_limited'
        })
      })
    }));
    // Partial-but-NON-EMPTY boards now get a 120s CDN TTL (not 30s) so a degraded board isn't
    // re-scraped every 30s during an FR24 block. 30s is reserved for partial AND empty. (Audit P7.)
    expect(res.headers['Cache-Control']).toContain('s-maxage=120');
  });

  it('on-demand scrape: a rate-limited middle page pauses and paging continues', async () => {
    // (This used to guard "official not called" by throwing inside the mock — production catches
    // that throw, so the guard could never fail. No token here, and the spy is asserted directly.)
    let pagesFetched = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      const pageMatch = urlStr.match(/page=(\d+)/);
      const page = pageMatch ? parseInt(pageMatch[1]) : 1;
      pagesFetched.push(page);

      // Page 2 returns 429 (rate limited)
      if (page === 2) {
        return { ok: false, status: 429, text: async () => 'Too Many Requests', headers: { get: () => null } };
      }
      // All other pages succeed with UA flights
      return {
        ok: true,
        json: async () => ({
          result: {
            response: {
              airport: {
                pluginData: {
                  schedule: {
                    departures: {
                      page: { current: page, total: 3 },
                      data: [{
                        flight: {
                          airline: { code: { iata: 'UA' } },
                          identification: { number: { default: `UA${page}00` } },
                          time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
                          airport: {
                            origin: { code: { iata: 'DEN' } },
                            destination: { code: { iata: 'SFO' } }
                          }
                        }
                      }]
                    }
                  }
                }
              }
            }
          }
        }),
      };
    });

    const ts = Math.floor(Date.now() / 1000) - 39600;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'DEN', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Page 3 should still have been fetched despite page 2 being rate-limited
    expect(pagesFetched).toContain(3);
    // Should have flights from pages 1 and 3 (page 2 was rate-limited)
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.meta.source).toBe('scraping');
    expect(called(fetchSpy, OFFICIAL_HOST)).toBe(false);
  });

  it('on-demand scrape: repeated later-page rate limits stop before scanning the tail', async () => {
    let pagesFetched = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      const pageMatch = urlStr.match(/page=(\d+)/);
      const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;
      pagesFetched.push(page);

      if (page >= 2 && page <= 7) {
        return { ok: false, status: 429, text: async () => 'Too Many Requests', headers: { get: () => '1' } };
      }

      return {
        ok: true,
        json: async () => ({
          result: {
            response: {
              airport: {
                pluginData: {
                  schedule: {
                    departures: {
                      page: { current: page, total: 10 },
                      data: [{
                        flight: {
                          airline: { code: { iata: 'UA' } },
                          identification: { number: { default: `UA${page}50` } },
                          time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
                          airport: {
                            origin: { code: { iata: 'ORD' } },
                            destination: { code: { iata: 'LAX' } }
                          }
                        }
                      }]
                    }
                  }
                }
              }
            }
          }
        }),
      };
    });

    const ts = getStartOfDayForHub('ORD') - 86400;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.total).toBe(1);
    expect(res.body.meta.partialReason).toBe('rate_limited');
    expect(pagesFetched).toContain(7);
    expect(pagesFetched).not.toContain(8);
  });

  it('a tripped official breaker keeps the paid rescue off; the request degrades to the scrape', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    // Trip the breaker
    for (let i = 0; i < 5; i++) recordFallback();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        return { ok: false, status: 500, text: async () => 'unexpected', headers: { get: () => null } };
      }
      // Scraping returns valid response but no UA flights (partial scenario)
      return {
        ok: true,
        json: async () => ({
          result: {
            response: {
              airport: {
                pluginData: {
                  schedule: {
                    departures: {
                      page: { current: 1, total: 2 },
                      data: [{
                        flight: {
                          airline: { code: { iata: 'DL' } }, // Delta, not United
                          identification: { number: { default: 'DL100' } },
                          time: { scheduled: { departure: 1741653600, arrival: 1741660800 } },
                          airport: {
                            origin: { code: { iata: 'IAD' } },
                            destination: { code: { iata: 'ATL' } }
                          }
                        }
                      }]
                    }
                  }
                }
              }
            }
          }
        }),
      };
    });

    const ts = Math.floor(Date.now() / 1000) - 43200;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'IAD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.meta.source).toBe('scraping');
    // Official API should not have been called (breaker tripped)
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('fr24api.flightradar24.com');
    }
  });

  it('official API: derives diverted status and reroutes destination on an ICAO mismatch', async () => {
    // A real diversion arrives as dest_icao !== dest_icao_actual. mapStatus must set diverted, and
    // normalizeSummaryFlight must display where the flight actually landed (IAD), not the scheduled
    // destination (EWR). Every other fixture sets the two ICAOs equal, so this derivation was never
    // exercised — a diversion would be mislabeled with no test to catch it.
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    const ts = getStartOfDayForHub('ORD');
    const takeoff = ts + 9 * 3600;
    const landed = takeoff + 2 * 3600;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('fr24api.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              fr24_id: 'div1', flight: 'UA88', callsign: 'UAL88', operating_as: 'UAL',
              type: 'B39M', reg: 'N123',
              orig_icao: 'KORD',
              dest_icao: 'KEWR',           // scheduled destination
              dest_icao_actual: 'KIAD',    // actually landed at IAD -> diverted
              datetime_takeoff: new Date(takeoff * 1000).toISOString().replace('.000Z', 'Z'),
              datetime_landed: new Date(landed * 1000).toISOString().replace('.000Z', 'Z'),
              flight_ended: true,
            }],
          }),
        };
      }
      return { ok: false, status: 403, text: async () => 'Forbidden', headers: { get: () => null } };
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    const flight = res.body.flights[0];
    expect(flight.status.generic.status.diverted).toBe(true);
    expect(flight.airport.destination.code.iata).toBe('IAD');
    // The downstream display classifier keys off the derived diverted flag.
    expect(classifySchedStatus(flight, 'departures').key).toBe('diverted');
  });

  it('rejects non-GET, foreign-origin, and out-of-range/NaN timestamps before any upstream fetch', async () => {
    // The 405/403/400 request guards (esp. the ±7d timestamp range, a cache-cardinality + quota spend
    // guard) had no coverage, unlike every sibling handler. All must reject before any metered fetch.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, headers: { get: () => null },
      json: async () => ({ result: { response: { airport: { pluginData: {} } } } }),
    });
    const now = Math.floor(Date.now() / 1000);
    const validTs = String(getStartOfDayForHub('ORD'));

    // Non-GET -> 405
    const resMethod = createRes();
    await handler({ method: 'POST', headers: { origin: 'http://localhost:3000' }, query: { hub: 'ORD', dir: 'departures', timestamp: validTs } }, resMethod);
    expect(resMethod.statusCode).toBe(405);

    // Foreign origin -> 403
    const resOrigin = createRes();
    await handler({ method: 'GET', headers: { origin: 'https://evil.example' }, query: { hub: 'ORD', dir: 'departures', timestamp: validTs } }, resOrigin);
    expect(resOrigin.statusCode).toBe(403);

    // NaN timestamp -> 400
    const resNaN = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { hub: 'ORD', dir: 'departures', timestamp: 'abc' } }, resNaN);
    expect(resNaN.statusCode).toBe(400);
    expect(resNaN.body.error).toBe('Invalid timestamp');

    // Timestamp far in the future (> now + 7d) -> 400
    const resFuture = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { hub: 'ORD', dir: 'departures', timestamp: String(now + 86400 * 30) } }, resFuture);
    expect(resFuture.statusCode).toBe(400);
    expect(resFuture.body.error).toBe('Invalid timestamp');

    // Timestamp far in the past (< now - 7d) -> 400
    const resPast = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { hub: 'ORD', dir: 'departures', timestamp: String(now - 86400 * 30) } }, resPast);
    expect(resPast.statusCode).toBe(400);
    expect(resPast.body.error).toBe('Invalid timestamp');

    // Every rejection above is a pre-fetch spend guard: no upstream call should have fired.
    expect(fetchSpy).not.toHaveBeenCalled();

    // A server-to-server request with NO origin header still succeeds.
    const resNoOrigin = createRes();
    await handler({ method: 'GET', headers: {}, query: { hub: 'ORD', dir: 'departures', timestamp: validTs } }, resNoOrigin);
    expect(resNoOrigin.statusCode).toBe(200);
  });

  it('ignores a legacy ?page= param and serves the aggregate board', async () => {
    // Single-page mode was removed in v1.9.0 (no client, cron or script sent it). A stray `page`
    // must neither 400 nor open a per-page scrape surface: it gets the normal aggregate board.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, headers: { get: () => null },
      json: async () => ({ result: { response: { airport: { pluginData: {} } } } }),
    });
    const ts = Math.floor(Date.now() / 1000) - 172800;
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { hub: 'ORD', dir: 'departures', timestamp: String(ts), page: '3' } }, res);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.flights)).toBe(true);
    expect(res.body.data).toBeUndefined();
  });

  it('live-feed fallback: drops malformed short rows and out-of-window stale sightings', async () => {
    // normalizeLiveFeedFlight's defensive guards (arr.length < 19, and lastSeen outside
    // [ts-6h, dayEnd+6h]) had no coverage. A drifting short row or a parked aircraft's stale
    // sighting must never leak onto a degraded board.
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = '0';

    const ts = getStartOfDayForHub('IAH');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('data-cloud.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            full_count: 3, version: 4,
            // Valid in-window IAH arrival — the only row that should survive.
            'v-valid': ['A2A3B5', 30.2, -91.4, 270, 33000, 430, '', '', 'B38M', 'N27263', ts + 13 * 3600, 'BOS', 'IAH', 'UA1976', 0, -500, 'UAL1976', '', 'UAL'],
            // Malformed SHORT row (18 elements, < 19) that would otherwise be a valid IAH arrival.
            'v-short': ['C1', 30.0, -91.0, 270, 33000, 430, '', '', 'B738', 'N222', ts + 12 * 3600, 'ORD', 'IAH', 'UA2222', 0, -500, 'UAL2222', ''],
            // Full 19-element row but lastSeen is 2 days stale (far before ts-6h) -> out of window.
            'v-stale': ['D1', 30.0, -91.0, 270, 33000, 430, '', '', 'B739', 'N333', ts - 2 * 86400, 'DEN', 'IAH', 'UA3333', 0, -500, 'UAL3333', '', 'UAL'],
          }),
        };
      }
      return {
        ok: false,
        status: 403,
        text: async () => 'Cloudflare challenge',
        headers: { get: (name) => String(name).toLowerCase() === 'cf-mitigated' ? 'challenge' : null },
      };
    });

    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'IAH', dir: 'arrivals', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('live-feed');
    // Only the valid in-window, full-length row survives; the short and stale rows are dropped.
    expect(res.body.total).toBe(1);
    expect(res.body.flights.map((f) => f.identification.number.default)).toEqual(['UA1976']);
  });
});

// The production path: the provider (AeroDataBox) returns a clean one-flight ORD board for the
// current hub day. (These helpers used to mock an FR24 web scrape that "succeeds" with an empty
// board — something that never happens from Vercel.)
function mockProviderBoard() {
  process.env.AERODATABOX_API_KEY = 'adb-test-key';
  const dayStart = getStartOfHubDay('ORD', 0);
  const iso = (sec) => new Date(sec * 1000).toISOString();
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (/aerodatabox|aedbx/i.test(String(url))) {
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ departures: [{
          number: 'UA 1', callSign: 'UAL1', status: 'Expected', airline: { iata: 'UA' },
          departure: { scheduledTime: { utc: iso(dayStart + 12 * 3600) }, airport: { iata: 'ORD' } },
          arrival: { scheduledTime: { utc: iso(dayStart + 16 * 3600) }, airport: { iata: 'SFO' } },
          aircraft: {},
        }] }),
      };
    }
    return { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null }, json: async () => ({}) };
  });
}

function resetScheduleTestState() {
  vi.restoreAllMocks();
  __resetRateLimitersForTests();
  __resetScheduleCachesForTests();
  __resetAdbSpendForTests();
  setFastRetries();
  scheduleSnapshotMocks.loadScheduleSnapshot.mockReset();
  scheduleSnapshotMocks.saveScheduleSnapshot.mockReset();
  scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue(null);
  scheduleSnapshotMocks.saveScheduleSnapshot.mockResolvedValue(undefined);
  vercelFunctionMocks.waitUntil.mockReset();
}

function cleanupScheduleTestEnv() {
  delete process.env.FR24_API_TOKEN;
  delete process.env.AERODATABOX_API_KEY;
  delete process.env.AERODATABOX_BASE_URL;
  clearFastRetries();
  delete process.env.CRON_SECRET;
  resetFallbackBreaker();
}

describe('hub allowlist + timestamp snapping (quota-burn surface)', () => {
  beforeEach(resetScheduleTestState);
  afterEach(cleanupScheduleTestEnv);

  it('rejects non-United-hub codes with 400 before any upstream call', async () => {
    // Stubbed (not call-through): on regression the handler would otherwise fire real FR24
    // requests with 45s+ timeouts before the not-called assertion fails.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), text: async () => '',
    });
    for (const hub of ['JFK', 'ATL', 'LHR', 'ZZZ']) {
      const res = createRes();
      await handler({
        method: 'GET',
        headers: { origin: 'http://localhost:3000' },
        query: { hub, dir: 'departures', timestamp: String(Math.floor(Date.now() / 1000)) },
      }, res);
      expect(res.statusCode, hub).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('serves lowercase hub + intra-day timestamp from the same cache entry as the canonical request', async () => {
    mockProviderBoard();
    const dayStart = getStartOfHubDay('ORD', 0);

    const res1 = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(dayStart) },
    }, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.cached).toBe(false);

    // 'ord' two hours into the same hub-local day must hit the SAME board, not mint a new
    // cache key (every distinct key = 2 paid provider calls once the provider path is on).
    const res2 = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ord', dir: 'departures', timestamp: String(dayStart + 7200) },
    }, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.cached).toBe(true);
  });
});

describe('forceRefresh (cron-authorized cache bypass)', () => {
  const SECRET = 'test-cron-secret-1234';

  beforeEach(() => {
    resetScheduleTestState();
    process.env.CRON_SECRET = SECRET;
  });
  afterEach(cleanupScheduleTestEnv);

  function baseQuery() {
    return { hub: 'ORD', dir: 'departures', timestamp: String(getStartOfHubDay('ORD', 0)) };
  }

  async function prime() {
    mockProviderBoard();
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: baseQuery() }, res);
    expect(res.body.cached).toBe(false);
  }

  it('bypasses the fresh cache and responds no-store when authorized with CRON_SECRET', async () => {
    await prime();
    const res = createRes();
    await handler({
      method: 'GET',
      headers: { authorization: `Bearer ${SECRET}` },
      query: { ...baseQuery(), forceRefresh: '1' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(false);                  // refetched, not served frozen
    expect(res.headers['Cache-Control']).toBe('no-store'); // cron URL must never pin a CDN object
  });

  it('bypasses the persistent-snapshot serve tier (the live 30h-frozen incident path)', async () => {
    // The frozen-board incident: with cold in-memory caches, a 30h-old COMPLETE persisted snapshot
    // satisfies every organic request via the persistent serve tier. If the cron's authorized force
    // request also got that snapshot back, the board would never be refetched — the exact freeze
    // the warm cron exists to break. The force must skip the snapshot and run a real fetch.
    scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue({
      data: { flights: [], total: 412, partial: false, meta: { completeness: 1 } },
      refreshedAt: Date.now() - 30 * 3600 * 1000,
    });
    // The production warm path: the provider (AeroDataBox) returns the real board. (This used to
    // mock an FR24 web scrape that "succeeds" with an empty board, which never happens from Vercel;
    // since 1.8.2 a cron warm no longer falls through to that scrape at all.)
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    const dayStart = getStartOfHubDay('ORD', 0);
    const iso = (sec) => new Date(sec * 1000).toISOString().replace('.000Z', 'Z');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (/aerodatabox|aedbx/i.test(String(url))) {
        return {
          ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ departures: [{
            number: 'UA 1', status: 'Expected', airline: { iata: 'UA' },
            departure: { scheduledTime: { utc: iso(dayStart + 12 * 3600) }, airport: { iata: 'ORD' } },
            arrival: { scheduledTime: { utc: iso(dayStart + 16 * 3600) }, airport: { iata: 'SFO' } },
            aircraft: {},
          }] }),
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ result: { response: { airport: { pluginData: {} } } } }) };
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { authorization: `Bearer ${SECRET}` },
      query: { ...baseQuery(), forceRefresh: '1' },
    }, res);

    expect(res.statusCode).toBe(200);
    // NOT the degraded snapshot: a snapshot serve is stale+degraded with meta.fallbackScope set
    // and total 412; the forced refetch is a fresh provider board.
    expect(res.body.cached).toBe(false);
    expect(res.body.stale).toBeFalsy();
    expect(res.body.degraded).toBeFalsy();
    expect(res.body.meta.fallbackScope).toBeUndefined();
    expect(res.body.meta.source).toBe('aerodatabox');
    expect(res.body.total).toBe(1);
  });

  it("accepts the documented force value variants ('true', 'yes') like '1'", async () => {
    await prime();
    for (const value of ['true', 'yes']) {
      mockProviderBoard();
      const res = createRes();
      await handler({
        method: 'GET',
        headers: { authorization: `Bearer ${SECRET}` },
        query: { ...baseQuery(), forceRefresh: value },
      }, res);
      expect(res.statusCode, `forceRefresh=${value}`).toBe(200);
      // Each variant must trigger a refetch (cached:false), not serve the fresh cache entry the
      // previous request just repopulated.
      expect(res.body.cached, `forceRefresh=${value}`).toBe(false);
    }
  });

  it('ignores forceRefresh with a wrong secret', async () => {
    await prime();
    const res = createRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer wrong-secret' },
      query: { ...baseQuery(), forceRefresh: '1' },
    }, res);
    expect(res.body.cached).toBe(true);
  });

  it('responds no-store to ANY forceRefresh request, even unauthorized', async () => {
    // The warm URL is fully predictable from the public repo. If an unauthenticated GET of it
    // produced a normal cacheable response, the CDN would pin a 1h object on the cron's own URL
    // key and the next half-hourly warm could be served that frozen object as a green "ok" —
    // unauthenticated re-freezing of the exact boards the force path exists to refresh.
    await prime();
    const res = createRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer wrong-secret' },
      query: { ...baseQuery(), forceRefresh: '1' },
    }, res);
    expect(res.body.cached).toBe(true); // still served normally (no oracle)...
    expect(res.headers['Cache-Control']).toBe('no-store'); // ...but never CDN-pinned
  });

  it('ignores forceRefresh when CRON_SECRET is not configured', async () => {
    await prime();
    delete process.env.CRON_SECRET;
    const res = createRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer anything' },
      query: { ...baseQuery(), forceRefresh: '1' },
    }, res);
    expect(res.body.cached).toBe(true);
  });

  it('keeps the provider available to authorized force warms after the organic budget is exhausted', async () => {
    process.env.AERODATABOX_API_KEY = 'test-key';
    await recordAdbUnits(400);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ departures: [], result: { response: { airport: { pluginData: {} } } } }),
    });

    // Organic cache-miss traffic: the budget gate blocks the provider (spend cap working).
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: baseQuery() }, createRes());
    expect(fetchSpy.mock.calls.filter(([url]) => /aerodatabox|aedbx/i.test(String(url))).length).toBe(0);

    // The cron's authorized force warm is ring-bounded (~768 units/day) upstream — the organic
    // cap must not starve the very refresh path that keeps boards from freezing.
    fetchSpy.mockClear();
    await handler({
      method: 'GET',
      headers: { authorization: `Bearer ${SECRET}` },
      query: { ...baseQuery(), forceRefresh: '1' },
    }, createRes());
    expect(fetchSpy.mock.calls.filter(([url]) => /aerodatabox|aedbx/i.test(String(url))).length).toBeGreaterThan(0);
  });
});

// The paced organic gate (api/_cost-state.ts) makes fetchViaAeroDataBox return null for many more
// hours/day than the old flat budget ever did. Provider-mode's fallthrough answers a null provider
// by reaching for the PAID FR24 official API — whose only daily ceiling is per-instance — so without
// a guard the pacing "spend guard" would quietly MOVE organic traffic onto a costlier provider for
// most of the day. That is the opposite of what it was built to do.
describe('paced provider gate must not spill onto the paid official API', () => {
  beforeEach(() => {
    resetScheduleTestState();
    resetFallbackBreaker(); // also clears the ADB counters via __resetAdbSpendForTests
    __resetAdbSpendForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '1400'; // the production budget
    // 00:30 UTC = 7:30 PM CDT: half an hour into the day, so the paced line is tiny while the
    // absolute budget is nearly untouched — precisely the state that only pacing can be gating.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-04T00:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AERODATABOX_DAILY_UNIT_BUDGET;
    cleanupScheduleTestEnv();
  });

  // Provider-mode board whose provider call is gated, so the fallthrough decides everything.
  async function loadGatedBoard() {
    const ts = getStartOfHubDay('IAH', 0);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              fr24_id: 'x1', flight: 'UA795', callsign: 'UAL795', operating_as: 'UAL', type: 'A21N', reg: 'N1',
              orig_icao: 'KIAH', datetime_takeoff: new Date((ts + 9 * 3600) * 1000).toISOString().replace('.000Z', 'Z'),
              dest_icao: 'KEWR', dest_icao_actual: 'KEWR', datetime_landed: new Date((ts + 12 * 3600) * 1000).toISOString().replace('.000Z', 'Z'),
              flight_ended: true,
            }],
          }),
        };
      }
      if (urlStr.includes('data-cloud.flightradar24.com')) {
        return {
          ok: true,
          json: async () => ({
            full_count: 1, version: 4,
            'live-1': ['B1', 29.98, -95.34, 270, 35000, 430, '', '', 'B38M', 'N2', ts + 14 * 3600, 'IAH', 'SFO', 'UA999', 0, -500, 'UAL999', '', 'UAL'],
          }),
        };
      }
      return { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null } };
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'IAH', dir: 'departures', timestamp: String(ts) },
    }, res);

    const calledHost = (needle) => fetchSpy.mock.calls.some((c) => String(c[0]).includes(needle));
    return { res, fetchSpy, calledHost };
  }

  it('keeps the paid official API OFF while only pacing is holding the provider back', async () => {
    await recordAdbUnits(300); // way past the 00:30 paced line, way under the 1400 budget

    const { res, calledHost } = await loadGatedBoard();

    expect(res.statusCode).toBe(200);
    // The provider really was gated (setup sanity — otherwise the assertion below is vacuous)...
    expect(calledHost('aedbx/aerodatabox')).toBe(false);
    // ...and the gate did NOT hand the traffic to the costlier provider.
    expect(calledHost('fr24api.flightradar24.com')).toBe(false);
    // The FREE live-feed rescue still runs, so the board degrades gracefully rather than going dark.
    expect(calledHost('data-cloud.flightradar24.com')).toBe(true);
  });

  it('still allows the official API once the budget is TRULY exhausted (legacy behaviour preserved)', async () => {
    await recordAdbUnits(1400); // the absolute daily budget, not merely the paced line

    const { res, calledHost } = await loadGatedBoard();

    expect(res.statusCode).toBe(200);
    expect(calledHost('aedbx/aerodatabox')).toBe(false);
    // Exhaustion is the pre-existing state this fallthrough was written for; official stays
    // reachable there, bounded by its own 402 block / 15-min breaker / daily call cap.
    expect(calledHost('fr24api.flightradar24.com')).toBe(true);
  });

  it('keeps the official rescue AVAILABLE when the gate was open and the provider merely FAILED', async () => {
    // The gate has to be read BEFORE the provider attempt, because the attempt moves the very inputs
    // it is read from: fetchViaAeroDataBox bills its units before each HTTP call, so a call that then
    // fails can push spend past the paced line and make the post-hoc check say "pacing is gating us"
    // — suppressing the healthy paid rescue for a failure pacing had nothing to do with. Two units
    // under the 00:30 paced line is exactly that knife edge: open on entry, closed by the failed
    // attempt's own 4 units (two 403'd windows, no retries).
    await recordAdbUnits(getAdbPacedAllowance(Date.now()) - 2);
    expect(isAdbOrganicRefreshGated(Date.now())).toBe(false); // setup sanity: the gate is OPEN

    // loadGatedBoard's catch-all answers the AeroDataBox host with a 403, so the provider is really
    // attempted and really fails.
    const { res, calledHost } = await loadGatedBoard();

    expect(res.statusCode).toBe(200);
    expect(calledHost('aedbx/aerodatabox')).toBe(true);
    // The attempt's own spend closed the gate behind it — which is precisely what must NOT decide
    // this. Legacy behaviour (provider down => official rescue) is preserved.
    expect(isAdbOrganicRefreshGated(Date.now())).toBe(true);
    expect(calledHost('fr24api.flightradar24.com')).toBe(true);
  });
});

describe('background provider refresh age gate', () => {
  beforeEach(resetScheduleTestState);
  afterEach(cleanupScheduleTestEnv);

  it('stays off without a provider key, fresh data, or provider fallback disabled', () => {
    delete process.env.AERODATABOX_API_KEY;
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:1', 30 * 3600 * 1000, true)).toBe(false);
    process.env.AERODATABOX_API_KEY = 'test-key';
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:1', 30 * 60 * 1000, true)).toBe(false);
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:1', 30 * 3600 * 1000, false)).toBe(false);
  });

  it('allows one provider refresh per agg key per hour once data is older than 1h', () => {
    // Was 3h: combined with the 6h hot/CDN TTL a viewed board sat 3-6h+ stale while ~900
    // units/day of budget went unused (Sep 26 2026). The paced organic gate still bounds spend.
    process.env.AERODATABOX_API_KEY = 'test-key';
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:2', 50 * 60 * 1000, true)).toBe(false);
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:2', 70 * 60 * 1000, true)).toBe(true);
    // Same key again immediately: cooldown holds (user traffic must not stampede the quota).
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:2', 4 * 3600 * 1000, true)).toBe(false);
    // A different board is independent.
    expect(shouldEnableProviderForBackgroundRefresh('agg:DEN:departures:2', 4 * 3600 * 1000, true)).toBe(true);
  });

  it('a FAILED provider refresh can retry after 5 min instead of burning the whole hour', () => {
    // Prod, Sep 26 2026: a 429'd refresh consumed the key's 1h cooldown, so DEN/IAH/ORD/SFO
    // arrivals could not retry for an hour while already 5-11h stale.
    process.env.AERODATABOX_API_KEY = 'test-key';
    const t0 = Date.parse('2026-09-26T20:00:00Z');
    const age = 4 * 3600 * 1000;
    expect(shouldEnableProviderForBackgroundRefresh('agg:IAH:arrivals:5', age, true, t0)).toBe(true);
    noteProviderRefreshFailed('agg:IAH:arrivals:5', t0 + 10_000);
    expect(shouldEnableProviderForBackgroundRefresh('agg:IAH:arrivals:5', age, true, t0 + 4 * 60_000)).toBe(false);
    expect(shouldEnableProviderForBackgroundRefresh('agg:IAH:arrivals:5', age, true, t0 + 6 * 60_000)).toBe(true);
    // A SUCCESSFUL refresh keeps the full hour.
    expect(shouldEnableProviderForBackgroundRefresh('agg:IAH:arrivals:5', age, true, t0 + 30 * 60_000)).toBe(false);
  });

  it('keeps the PAID FR24 official background refresh at the 3h age gate', () => {
    // The official API bills per call against a credit allowance; the AeroDataBox freshness
    // change must not quietly make it 3x more eager.
    process.env.FR24_API_TOKEN = 'test-token';
    try {
      expect(shouldEnableOfficialForBackgroundRefresh('agg:ORD:departures:9', 2 * 3600 * 1000, true)).toBe(false);
      expect(shouldEnableOfficialForBackgroundRefresh('agg:ORD:departures:9', 4 * 3600 * 1000, true)).toBe(true);
    } finally {
      delete process.env.FR24_API_TOKEN;
    }
  });

  it('enables the provider on background refresh of a 30h-old persistent snapshot', async () => {
    process.env.AERODATABOX_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ departures: [], result: { response: { airport: { pluginData: {} } } } }),
    });
    scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue({
      data: { flights: [], total: 412, partial: false, meta: { completeness: 1 } },
      refreshedAt: Date.now() - 30 * 3600 * 1000,
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(getStartOfHubDay('ORD', 0)) },
    }, res);
    expect(res.body.stale).toBe(true);
    expect(res.body.meta.fallbackScope).toBe('persistent');

    // The background refresh (captured by waitUntil) must hit the paid provider: a 30h-old board
    // is exactly the frozen state the refresh exists to fix.
    expect(vercelFunctionMocks.waitUntil).toHaveBeenCalled();
    await Promise.all(vercelFunctionMocks.waitUntil.mock.calls.map(c => c[0]));
    const aeroCalls = fetchSpy.mock.calls.filter(([url]) => /aerodatabox|aedbx/i.test(String(url)));
    expect(aeroCalls.length).toBeGreaterThan(0);
  });

  it('a background refresh never falls through to the Cloudflare-dead FR24 web scrape', async () => {
    // Prod: ~200 "FR24 Cloudflare challenge" error lines/day (EWR/NRT/GUM) all came from background
    // refreshes whose provider attempt failed or was gated. The scrape can only produce a partial
    // board, which cacheSetGuarded then refuses to store over the complete one — pure waste.
    process.env.AERODATABOX_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (/aerodatabox|aedbx/i.test(u)) {
        return { ok: false, status: 500, headers: { get: () => null }, text: async () => 'boom', json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ result: { response: { airport: { pluginData: {} } } } }) };
    });
    scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue({
      data: { flights: [], total: 412, partial: false, meta: { completeness: 1 } },
      refreshedAt: Date.now() - 2 * 3600 * 1000,
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'EWR', dir: 'departures', timestamp: String(getStartOfHubDay('EWR', 0)) },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(412); // the complete board is still what visitors get

    await Promise.all(vercelFunctionMocks.waitUntil.mock.calls.map(c => c[0]));
    const aeroCalls = fetchSpy.mock.calls.filter(([url]) => /aerodatabox|aedbx/i.test(String(url)));
    expect(aeroCalls.length).toBeGreaterThan(0); // the provider WAS tried
    const scrapeCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('api.flightradar24.com/common/v1/airport.json'));
    expect(scrapeCalls).toEqual([]);
  });

  it('an authorized cron warm whose provider fails does not fall through to the FR24 web scrape', async () => {
    process.env.AERODATABOX_API_KEY = 'test-key';
    process.env.CRON_SECRET = 'test-cron-secret-1234';
    try {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const u = String(url);
        if (/aerodatabox|aedbx/i.test(u)) {
          return { ok: false, status: 500, headers: { get: () => null }, text: async () => 'boom', json: async () => ({}) };
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ result: { response: { airport: { pluginData: {} } } } }) };
      });
      const res = createRes();
      await handler({
        method: 'GET',
        headers: { authorization: 'Bearer test-cron-secret-1234' },
        query: {
          hub: 'NRT', dir: 'departures', timestamp: String(getStartOfHubDay('NRT', 0)),
          officialFallback: '0', providerFallback: '1', scraperFallback: '0', forceRefresh: '1',
        },
      }, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.partial).toBe(true);
      expect(res.body.meta.partialReason).toBe('provider_unavailable');
      const scrapeCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('api.flightradar24.com/common/v1/airport.json'));
      expect(scrapeCalls).toEqual([]);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  it('keeps the provider off for a young+complete snapshot (no pointless refresh)', async () => {
    process.env.AERODATABOX_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ departures: [], result: { response: { airport: { pluginData: {} } } } }),
    });
    scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue({
      data: { flights: [], total: 412, partial: false, meta: { completeness: 1 } },
      refreshedAt: Date.now() - 10 * 60 * 1000,
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(getStartOfHubDay('ORD', 0)) },
    }, res);
    // A 10-min-old COMPLETE board is fresh: honestly flagged stale:false, and no background refresh
    // fires at all (the refresh could only degrade it), so the paid provider is never touched.
    expect(res.body.stale).toBe(false);

    await Promise.all(vercelFunctionMocks.waitUntil.mock.calls.map(c => c[0]));
    const aeroCalls = fetchSpy.mock.calls.filter(([url]) => /aerodatabox|aedbx/i.test(String(url)));
    expect(aeroCalls.length).toBe(0);
  });
});
