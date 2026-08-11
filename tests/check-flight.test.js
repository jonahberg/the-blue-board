import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler, { _resetCacheForTest } from '../api/check-flight.js';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    headers: {},
    query: {},
    ...overrides,
  };
}

describe('check-flight API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetCacheForTest();
  });

  it('rejects non-GET requests', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST', query: { flight_number: 'UA100', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects a disallowed origin with 403 and never hits upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://evil.com' }, query: { flight_number: 'UA100', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 400 when flight_number is missing', async () => {
    const res = createRes();
    await handler(makeReq({ query: { date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/flight_number/);
  });

  it('returns 400 when date is missing', async () => {
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA100' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/date/);
  });

  it('returns 400 when date is malformed', async () => {
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA100', date: '05/03/2026' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/date/);
  });

  it('returns 502 on upstream connection failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA100', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(502);
  });

  it('forwards upstream non-2xx status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA999', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('adapts a verified Starlink match to high probability', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hasStarlink: true,
        confidence: 'verified',
        flights: [
          { tail_number: 'N127SY', flight_number: 'UA100', departure_airport: 'ORD', arrival_airport: 'LAX' },
        ],
      }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA100', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(true);
    expect(res.body.probability).toBeCloseTo(0.95, 2);
    expect(res.body.confidence).toBe('verified');
    expect(res.body.n_observations).toBe(1);
  });

  it('adapts a likely Starlink match to a moderate probability', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hasStarlink: true,
        confidence: 'likely',
        flights: [{ tail_number: 'N127SY' }, { tail_number: 'N128SY' }],
      }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA200', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.probability).toBeCloseTo(0.7, 2);
    expect(res.body.confidence).toBe('likely');
    expect(res.body.n_observations).toBe(2);
  });

  it('adapts a no-match response to zero probability', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hasStarlink: false, message: 'no match', flights: [] }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA300', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(false);
    expect(res.body.probability).toBe(0);
    expect(res.body.confidence).toBe('none');
    expect(res.body.n_observations).toBe(0);
  });

  // Fixtures probed live from unitedstarlinktracker.com on 2026-08-11. Upstream
  // serves three distinct shapes; truth has to come from the segments and the
  // prediction object, never from top-level hasStarlink/confidence alone.
  it('adapts a statistical prediction into the real upstream probability', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hasStarlink: false,
        confidence: 'predicted',
        prediction: { probability: 0.7068803883056011, confidence: 'medium', n_observations: 4 },
        message: 'Aircraft assignment not yet published — United Airlines assigns aircraft ~2 days before departure. ~71% of recent departures of this flight used a Starlink-equipped aircraft (4 observations).',
        flights: [],
      }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA700', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(false);
    expect(res.body.probability).toBe(0.7068803883056011);
    expect(res.body.confidence).toBe('predicted');
    expect(res.body.n_observations).toBe(4);
  });

  it('suppresses a prediction backed by zero observations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hasStarlink: false,
        confidence: 'predicted',
        prediction: { probability: 0.7068803883056011, confidence: 'medium', n_observations: 0 },
        flights: [],
      }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA701', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(false);
    expect(res.body.probability).toBe(0);
    expect(res.body.confidence).toBe('none');
    expect(res.body.n_observations).toBe(0);
  });

  it('suppresses a fleet-prior prediction even with observations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hasStarlink: false,
        confidence: 'predicted',
        method: 'fleet_prior_mainline',
        prediction: { probability: 0.7068803883056011, confidence: 'medium', n_observations: 4 },
        flights: [],
      }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA702', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.probability).toBe(0);
    expect(res.body.confidence).toBe('none');
    expect(res.body.n_observations).toBe(0);
  });

  it('keeps a verified-negative fallback segment instead of discarding it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hasStarlink: false,
        method: 'fr24_tail_lookup',
        flights: [],
        fallback: {
          segments: [{
            tail_number: 'N838UA',
            aircraft_model: 'Airbus A319-131',
            origin: 'BNA',
            destination: 'ORD',
            departure_time: 1786451400,
            arrival_time: 1786458600,
            hasStarlink: false,
            confidence: 'negative',
            verified_wifi: 'Panasonic',
            verified_at: 1785834401,
          }],
        },
      }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA703', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(false);
    expect(res.body.probability).toBe(0);
    expect(res.body.confidence).toBe('verified');
    expect(res.body.n_observations).toBe(1);
    expect(res.body.flights[0].tail_number).toBe('N838UA');
  });

  it('reads a verified-positive fallback segment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hasStarlink: false,
        method: 'fr24_tail_lookup',
        flights: [],
        fallback: {
          segments: [{
            tail_number: 'N838UA',
            hasStarlink: true,
            confidence: 'verified',
            verified_wifi: 'Starlink',
            verified_at: 1785834401,
          }],
        },
      }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA704', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(true);
    expect(res.body.probability).toBeCloseTo(0.95, 2);
    expect(res.body.confidence).toBe('verified');
    expect(res.body.n_observations).toBe(1);
  });

  it('reads the StrLnk wifi spelling with no hasStarlink key on the segment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hasStarlink: false,
        method: 'fr24_tail_lookup',
        flights: [],
        fallback: {
          segments: [{ tail_number: 'N838UA', verified_wifi: 'StrLnk', verified_at: 1785834401 }],
        },
      }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA705', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(true);
    expect(res.body.probability).toBeCloseTo(0.95, 2);
    expect(res.body.confidence).toBe('verified');
    expect(res.body.n_observations).toBe(1);
  });

  it('adapts the primary-path verified positive (segments carry no wifi signal)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hasStarlink: true,
        confidence: 'verified',
        method: 'fr24_tail_lookup',
        flights: [{
          tail_number: 'N626SY',
          aircraft_type: 'Embraer E175LL',
          flight_number: 'UA5779',
          ua_flight_number: 'UA5779',
          departure_airport: 'DEN',
          arrival_airport: 'ASE',
          departure_time: 1786497300,
          arrival_time: 1786500960,
          departure_time_formatted: '2026-08-12T01:15:00.000Z',
          arrival_time_formatted: '2026-08-12T02:16:00.000Z',
          operated_by: 'Skywest dba UAX',
          fleet_type: 'express',
        }],
      }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA706', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(true);
    expect(res.body.probability).toBeCloseTo(0.95, 2);
    expect(res.body.confidence).toBe('verified');
    expect(res.body.n_observations).toBe(1);
  });

  it('never mints a badge from a bare top-level hasStarlink', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hasStarlink: true, flights: [] }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA707', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(false);
    expect(res.body.probability).toBe(0);
    expect(res.body.confidence).toBe('none');
  });

  it('still honors the documented legacy likely shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hasStarlink: true, confidence: 'likely', flights: [] }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA708', date: '2026-05-03' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hasStarlink).toBe(true);
    expect(res.body.probability).toBeCloseTo(0.7, 2);
    expect(res.body.confidence).toBe('likely');
  });

  it('strips ICAO UAL prefix before forwarding to upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hasStarlink: false, flights: [] }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UAL123', date: '2026-05-03' } }), res);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('flight_number=UA123'),
      expect.any(Object)
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('flight_number=UAL'),
      expect.any(Object)
    );
  });

  it('passes flight_number and date to upstream with UA prefix normalization', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hasStarlink: false, flights: [] }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: '1234', date: '2026-05-03' } }), res);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/flight_number=UA1234/),
      expect.any(Object)
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/date=2026-05-03/),
      expect.any(Object)
    );
  });

  it('short-circuits to 502 inside the negative-cache window', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await handler(makeReq({ query: { flight_number: 'UA400', date: '2026-05-03' } }), createRes());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const res2 = createRes();
    await handler(makeReq({ query: { flight_number: 'UA401', date: '2026-05-03' } }), res2);
    expect(res2.statusCode).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('probes upstream again after the negative-cache window expires', async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({
          ok: true,
          json: async () => ({ hasStarlink: true, confidence: 'verified', flights: [{ tail_number: 'N1' }] }),
        });

      await handler(makeReq({ query: { flight_number: 'UA500', date: '2026-05-03' } }), createRes());
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(61 * 1000);

      const resOk = createRes();
      await handler(makeReq({ query: { flight_number: 'UA501', date: '2026-05-03' } }), resOk);
      expect(resOk.statusCode).toBe(200);
      expect(resOk.body.probability).toBeCloseTo(0.95, 2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends correct User-Agent header to upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hasStarlink: false, flights: [] }),
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA600', date: '2026-05-03' } }), res);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'User-Agent': 'BlueBoard-CheckFlight/1.0' },
      })
    );
  });
});
