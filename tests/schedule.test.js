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

import handler, { shouldAttemptOfficialFallback, recordFallback, resetFallbackBreaker, __resetScheduleCachesForTests, shouldEnableProviderForBackgroundRefresh } from '../api/schedule.js';
import { getStartOfDayForHub } from '../api/irops.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { recordAdbUnits, isAdbOrganicRefreshGated, __resetAdbSpendForTests } from '../api/_cost-state.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';

function formatForFR24Test(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

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
    process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
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
    delete process.env.SCHEDULE_SOURCE_PRIORITY;
    delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
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

  it('does not serve an empty official board as a clean 6h-pinned board', async () => {
    // An empty official response for a United hub — never legitimately empty same-day — used to come
    // back non-partial (total:0), so the hot cache pinned it for 6h and the CDN pinned s-maxage=21600:
    // one transient empty upstream froze a 0-flight board on that edge for 6h. The empty official
    // board must instead be flagged degraded (partial) so the empty-board cache/CDN guards apply,
    // mirroring the scrape path's empty_200_suspected_block handling.
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'official';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ data: [] }), // official empty; the today live-feed URL also yields no rows
    });

    // A TODAY board: cdnMaxAge would be 21600 (6h) for a clean board.
    const ts = Math.floor(Date.now() / 1000) - 3600;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'DEN', dir: 'arrivals', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.meta.source).toBe('official-api');
    // The empty board is degraded, so it is NOT served/pinned as a clean 6h board.
    expect(res.body.partial).toBe(true);
    expect(res.headers['Cache-Control']).not.toContain('s-maxage=21600');
  });

  it('parses numeric-string timestamps from official API so schedule times are populated', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'official';

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
    process.env.SCHEDULE_SOURCE_PRIORITY = 'official';

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
    process.env.SCHEDULE_SOURCE_PRIORITY = 'official';

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
    process.env.SCHEDULE_SOURCE_PRIORITY = 'official';

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

  // ═══ NEW: Scrape-first routing tests ═══

  it('scrape-first: scraping succeeds, official API never called', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    // The fail-closed default is now 'provider'; pin 'scrape' to exercise the legacy scrape path.
    process.env.SCHEDULE_SOURCE_PRIORITY = 'scrape';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called');
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
    // Verify no calls went to the official API
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('fr24api.flightradar24.com');
    }
  });

  it('scrape-first: historical failures do not trigger official API rescue', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'scrape'; // pin legacy scrape path (default is now 'provider')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called for historical windows');
      }
      // Scraping returns 403
      return { ok: false, status: 403, text: async () => 'Forbidden', headers: { get: () => null } };
    });

    const ts = getStartOfDayForHub('LAX') - 86400;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'LAX', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.meta.source).toBe('scraping');
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('fr24api.flightradar24.com');
    }
  });

  it('scrape-first: today uses official fallback by default for any hub when scraping fails', async () => {
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

  it('scrape-first: empty-200 scrape (suspected Cloudflare block) escalates to the official rescue', async () => {
    // Regression for the live "0-flight board" bug: a direct FR24 scrape that returns a clean
    // HTTP 200 with an empty schedule block (a soft datacenter-IP block, NOT a 403/429) used to be
    // treated as an authoritative empty board (partial:false), so the official rescue was skipped
    // and the user got a stale live-feed snapshot. For a same-day TARGETED hub with a token, the
    // empty board must now be flagged partial and escalate to the official API for a full schedule.
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    let officialCalled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
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
    expect(res.body.meta.fallbackFrom).toBe('scraping');
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('scrape-first: official fallback can still be disabled by env', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'scrape'; // pin legacy scrape path (default is now 'provider')
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

  it('scrape-first: renders actual-only official summary rows as degraded same-day data', async () => {
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
    process.env.SCHEDULE_SOURCE_PRIORITY = 'official';

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

  it('honors officialFallback=0 when scraping fails', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = '1';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'official';

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

  it('uses AeroDataBox schedule fallback before FR24 official fallback when scraping fails', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    // Pin the legacy scrape path (default is now 'provider'): this test asserts the scrape→provider
    // rescue ordering (meta.fallbackFrom='scraping'), which only happens in scrape mode.
    process.env.SCHEDULE_SOURCE_PRIORITY = 'scrape';

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
    expect(res.body.meta.fallbackFrom).toBe('scraping');
    expect(aeroCalls).toBe(2);
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

  it('uses configured FR24 scraper transport (http-json proxy) before provider fallbacks when direct scraping is blocked', async () => {
    // ScrapingBee was removed; the surviving generic transport is the http-json proxy (SCHEDULE_SCRAPER_URL).
    process.env.SCHEDULE_SCRAPER_URL = 'https://proxy.example.com/fetch';
    process.env.SCHEDULE_SCRAPER_TOKEN = 'proxy-secret';
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    // Pin the legacy scrape path (default is now 'provider'): this asserts the scraper transport is
    // tried before provider fallbacks when the DIRECT scrape is blocked — a scrape-mode ordering.
    process.env.SCHEDULE_SOURCE_PRIORITY = 'scrape';

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
    // The production fix: SCHEDULE_SOURCE_PRIORITY=provider routes straight to AeroDataBox, the only
    // source that returns the full forward board from Vercel. The Cloudflare-dead FR24 scrape and the
    // (schedule-less) official API must NOT be touched when the provider returns a board.
    process.env.SCHEDULE_SOURCE_PRIORITY = 'provider';
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
    process.env.SCHEDULE_SOURCE_PRIORITY = 'provider';
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

  it('scrape-first: merges official actual-only board with live-feed and ranks it above bare live-feed', async () => {
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

  it('scrape-first: empty schedule (not partial) does not trigger fallback', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'scrape'; // pin legacy scrape path (default is now 'provider')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called');
      }
      // Scraping returns valid but empty schedule (no UA flights)
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

    // Two days back: a snapped "today" board would legitimately attempt the live-feed rescue for
    // an empty result, which is out of scope for this test.
    const ts = Math.floor(Date.now() / 1000) - 172800;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'DEN', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.partial).toBe(false);
    // Official API should never have been called
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('fr24api.flightradar24.com');
    }
  });

  it('scrape-only mode: official API never called even on failure', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'scrape-only';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called in scrape-only mode');
      }
      // Scraping fails
      return { ok: false, status: 500, text: async () => 'Error', headers: { get: () => null } };
    });

    const ts = Math.floor(Date.now() / 1000) - 32400;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'IAD', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
    // Official API should never have been called
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('fr24api.flightradar24.com');
    }
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
    // A partial snapshot is NOT fresh+complete, so the background refresh still fires. Pin the legacy
    // scrape path (default is now 'provider') so the refresh deterministically hits the scrape
    // first-page (one fetch) rather than adding async provider/official hops before that fetch.
    process.env.SCHEDULE_SOURCE_PRIORITY = 'scrape';
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
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(vercelFunctionMocks.waitUntil).toHaveBeenCalledTimes(1);
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

  it('persists partial aggregated results when they are the best available fallback', { timeout: 15000 }, async () => {
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

  it('scrape-first: rate-limited mid-loop pauses and continues fetching', { timeout: 15000 }, async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    let pagesFetched = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called');
      }
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
  });

  it('scrape-first: repeated later-page rate limits stop before scanning the tail', { timeout: 15000 }, async () => {
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

  it('scrape-first: heavy rate limiting uses official rescue on targeted windows when explicitly enabled', { timeout: 15000 }, async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'scrape'; // pin legacy scrape path (default is now 'provider')
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = '1';

    let pagesFetched = [];
    let officialCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        officialCalls++;
        return {
          ok: true,
          json: async () => ({
            data: [{
              flight_icao: 'UAL777',
              flight_iata: 'UA777',
              status: 'scheduled',
              orig_iata: 'DEN',
              dest_iata: 'SFO',
              scheduled_departure: 1741653600,
              scheduled_arrival: 1741660800,
            }]
          }),
        };
      }

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
                          identification: { number: { default: `UA${page}60` } },
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

    const ts = getStartOfDayForHub('DEN');
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'DEN', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('official-api');
    expect(res.body.meta.fallbackFrom).toBe('scraping');
    expect(officialCalls).toBe(1);
    expect(pagesFetched).toContain(7);
    expect(pagesFetched).not.toContain(8);
  });

  it('scrape-first: breaker tripped at end of scrape returns partial without fallback', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    // Trip the breaker
    for (let i = 0; i < 5; i++) recordFallback();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fr24api.flightradar24.com')) {
        throw new Error('Official API should not be called when breaker is tripped');
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
    process.env.SCHEDULE_SOURCE_PRIORITY = 'official';

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

  it('single-page mode: rejects out-of-range page numbers with 400 before any fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, headers: { get: () => null },
      json: async () => ({ result: { response: { airport: { pluginData: {} } } } }),
    });
    const ts = getStartOfDayForHub('ORD');
    for (const page of ['-1', '101']) {
      const res = createRes();
      await handler({
        method: 'GET',
        headers: { origin: 'http://localhost:3000' },
        query: { hub: 'ORD', dir: 'departures', timestamp: String(ts), page },
      }, res);
      expect(res.statusCode, `page=${page}`).toBe(400);
      expect(res.body.error, `page=${page}`).toBe('Invalid page number');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('single-page mode: serves a scraped page and re-serves it from cache', async () => {
    const depTime = getStartOfDayForHub('ORD') + 8 * 3600;
    const arrTime = depTime + 3 * 3600;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        result: { response: { airport: { pluginData: { schedule: { departures: {
          page: { current: 1, total: 1 },
          data: [{
            flight: {
              airline: { code: { iata: 'UA' } },
              identification: { number: { default: 'UA700' } },
              time: { scheduled: { departure: depTime, arrival: arrTime } },
              airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'LAX' } } },
            },
          }],
        } } } } } },
      }),
    });

    const ts = getStartOfDayForHub('ORD');
    const query = { hub: 'ORD', dir: 'departures', timestamp: String(ts), page: '1' };

    const res1 = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query }, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.cached).toBe(false);
    expect(res1.body.meta.source).toBe('scraping');
    expect(res1.body.meta.scrapeTransport).toBe('direct');
    expect(res1.body.data).toHaveLength(1);

    const callsAfterFirst = fetchSpy.mock.calls.length;
    // Second identical request is served from the single-page cache — no new fetch.
    const res2 = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query }, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.cached).toBe(true);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('single-page mode: returns 502 when the upstream page fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 500, text: async () => 'error', headers: { get: () => null },
    });
    const ts = getStartOfDayForHub('ORD');
    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'ORD', dir: 'departures', timestamp: String(ts), page: '1' },
    }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('Upstream service unavailable');
  });

  it('single-page mode: treats the FR24 rate-limit sentinel as a 502, never a cacheable 200', async () => {
    // fetchOnePage returns the truthy sentinel { _rateLimited: true } (no flight data) when FR24
    // hard-blocks and no scraper transport recovers it. The legacy page path must not cache that
    // sentinel and serve it 200 with zero rows pinned for hours.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'blocked',
      headers: { get: (name) => String(name).toLowerCase() === 'cf-mitigated' ? 'challenge' : null },
    });
    const ts = getStartOfDayForHub('ORD');
    const query = { hub: 'ORD', dir: 'departures', timestamp: String(ts), page: '1' };

    const res1 = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query }, res1);
    expect(res1.statusCode).toBe(502);
    expect(res1.body._rateLimited).toBeUndefined();

    // And it must not have poisoned the single-page cache: a second request re-attempts (still 502),
    // never served a cached 200 carrying the sentinel.
    const res2 = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query }, res2);
    expect(res2.statusCode).toBe(502);
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

// Empty-but-valid FR24 scrape payload: the no-env default path completes with a total-0 complete
// board, which is enough to populate the in-memory agg cache for cache-key assertions.
function mockEmptyScrape() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ result: { response: { airport: { pluginData: {} } } } }),
  });
}

function resetScheduleTestState() {
  vi.restoreAllMocks();
  __resetRateLimitersForTests();
  __resetScheduleCachesForTests();
  process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
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
  delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
  delete process.env.SCHEDULE_SOURCE_PRIORITY;
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
    mockEmptyScrape();
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
    mockEmptyScrape();
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
    mockEmptyScrape();

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { authorization: `Bearer ${SECRET}` },
      query: { ...baseQuery(), forceRefresh: '1' },
    }, res);

    expect(res.statusCode).toBe(200);
    // NOT the degraded snapshot: a snapshot serve is stale+degraded with meta.fallbackScope set
    // and total 412; the forced refetch is a fresh (empty-scrape) board.
    expect(res.body.cached).toBe(false);
    expect(res.body.stale).toBeFalsy();
    expect(res.body.degraded).toBeFalsy();
    expect(res.body.meta.fallbackScope).toBeUndefined();
    expect(res.body.total).toBe(0);
  });

  it("accepts the documented force value variants ('true', 'yes') like '1'", async () => {
    await prime();
    for (const value of ['true', 'yes']) {
      mockEmptyScrape();
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
    // produced a normal cacheable response, the CDN would pin a 6h object on the cron's own URL
    // key and the next hourly warm could be served that frozen object as a green "ok" —
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
    process.env.SCHEDULE_SOURCE_PRIORITY = 'provider';
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

    // The cron's authorized force warm is ring-bounded (~288 units/day) upstream — the organic
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
    process.env.SCHEDULE_SOURCE_PRIORITY = 'provider';
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '700';
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
    await recordAdbUnits(300); // way past the 00:30 paced line (43), way under the 700 budget

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
    await recordAdbUnits(700); // the absolute daily budget, not merely the paced line

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
    // — suppressing the healthy paid rescue for a failure pacing had nothing to do with. 40 units at
    // the 00:30 line of 43 is exactly that knife edge: open on entry, closed by the failed attempt's
    // own 4 units.
    process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0'; // both windows fail; don't burn 1.5s waiting
    await recordAdbUnits(40);
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
    // (cleanupScheduleTestEnv in afterEach clears AERODATABOX_INTER_WINDOW_DELAY_MS)
  });
});

describe('background provider refresh age gate', () => {
  beforeEach(resetScheduleTestState);
  afterEach(cleanupScheduleTestEnv);

  it('stays off without a provider key, fresh data, or provider fallback disabled', () => {
    delete process.env.AERODATABOX_API_KEY;
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:1', 30 * 3600 * 1000, true)).toBe(false);
    process.env.AERODATABOX_API_KEY = 'test-key';
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:1', 1 * 3600 * 1000, true)).toBe(false);
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:1', 30 * 3600 * 1000, false)).toBe(false);
  });

  it('allows one provider refresh per agg key per hour once data is older than 3h', () => {
    process.env.AERODATABOX_API_KEY = 'test-key';
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:2', 4 * 3600 * 1000, true)).toBe(true);
    // Same key again immediately: cooldown holds (user traffic must not stampede the quota).
    expect(shouldEnableProviderForBackgroundRefresh('agg:ORD:departures:2', 4 * 3600 * 1000, true)).toBe(false);
    // A different board is independent.
    expect(shouldEnableProviderForBackgroundRefresh('agg:DEN:departures:2', 4 * 3600 * 1000, true)).toBe(true);
  });

  it('enables the provider on background refresh of a 30h-old persistent snapshot', async () => {
    process.env.AERODATABOX_API_KEY = 'test-key';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'provider';
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

  it('keeps the provider off for a young+complete snapshot (no pointless refresh)', async () => {
    process.env.AERODATABOX_API_KEY = 'test-key';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'provider';
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
