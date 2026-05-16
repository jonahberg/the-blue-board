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

import handler, { shouldAttemptOfficialFallback, recordFallback, resetFallbackBreaker } from '../api/schedule.js';
import { getStartOfDayForHub } from '../api/irops.js';

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
    scheduleSnapshotMocks.loadScheduleSnapshot.mockReset();
    scheduleSnapshotMocks.saveScheduleSnapshot.mockReset();
    scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue(null);
    scheduleSnapshotMocks.saveScheduleSnapshot.mockResolvedValue(undefined);
    vercelFunctionMocks.waitUntil.mockReset();
  });

  afterEach(() => {
    delete process.env.FR24_API_TOKEN;
    delete process.env.SCHEDULE_SOURCE_PRIORITY;
    delete process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED;
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

  it('returns valid empty result when official API returns 0 flights', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'official';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    // Use a distinct timestamp to avoid hitting cache from previous test
    const ts = Math.floor(Date.now() / 1000) - 3600;
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'DEN', dir: 'arrivals', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(false);
    expect(res.body.total).toBe(0);
    expect(res.body.meta.source).toBe('official-api');
    expect(res.body.meta.partialReason).toBe(null);
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
    // Default SCHEDULE_SOURCE_PRIORITY is 'scrape'

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

  it('scrape-first: today uses official fallback when explicitly enabled and scraping fails', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = '1';

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
              orig_iata: 'LAX',
              dest_iata: 'ORD',
              scheduled_departure: 1741653600,
              scheduled_arrival: 1741660800,
            }]
          }),
        };
      }
      return { ok: false, status: 403, text: async () => 'Forbidden', headers: { get: () => null } };
    });

    const ts = getStartOfDayForHub('LAX');
    const req = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub: 'LAX', dir: 'departures', timestamp: String(ts) }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('official-api');
    expect(res.body.meta.fallbackFrom).toBe('scraping');
    expect(officialUrl).toContain(`flight_datetime_from=${encodeURIComponent(formatForFR24Test(new Date(ts * 1000)))}`);
    expect(officialUrl).toContain(`flight_datetime_to=${encodeURIComponent(formatForFR24Test(new Date((ts + 86400 - 1) * 1000)))}`);
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

    const ts1 = Math.floor(Date.now() / 1000) - 42000;
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

    const ts = Math.floor(Date.now() / 1000) - 28800;
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

  it('returns persisted exact snapshot on cold start while refreshing in the background', async () => {
    const ts = Math.floor(Date.now() / 1000) - 46800;
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
      throw new Error('fetch should not run when an exact persisted snapshot is available');
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
    expect(res.body.degraded).toBe(true);
    expect(res.body.meta.fallbackScope).toBe('persistent');
    expect(scheduleSnapshotMocks.loadScheduleSnapshot).toHaveBeenCalledWith(`agg:ORD:departures:${ts}`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(vercelFunctionMocks.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('returns persisted partial snapshot on cold start while refreshing in the background', async () => {
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
      cacheKey: `agg:EWR:departures:${ts}`,
      hub: 'EWR',
      dir: 'departures',
      ts,
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
    expect(res.headers['Cache-Control']).toContain('s-maxage=30');
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
});
