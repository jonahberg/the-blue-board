// The flight share card (/flight/:ident/card.png → api/flight-card.ts): its words come from the
// page's own verdict, it renders a real 1200×630 PNG with the bundled fonts (no network), and it
// degrades to the site's generic card rather than a broken image.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flight = vi.hoisted(() => ({ payload: null, fail: false }));
vi.mock(process.cwd() + '/api/flight.ts', () => ({
  loadFlightPayload: vi.fn(async () => {
    if (flight.fail) throw new Error('boom');
    return flight.payload;
  }),
}));

import handler, { CARD_CACHE_CONTROL, renderFlightCard } from '../api/flight-card.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { flightCardModel } from '../src/lib/flight-page-card.js';
import { D, canceledCase, delayedCase, inAirCase, payloadFor } from './fixtures/flight-page-fixtures.js';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

let fetchSpy;
beforeEach(() => {
  __resetRateLimitersForTests();
  flight.fail = false;
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('the card must never fetch (fonts are bundled)');
  });
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('the card says what the page says', () => {
  it('in the air: number, route, one status line, and when the snapshot was taken', () => {
    const { row, nowSec } = inAirCase();
    expect(flightCardModel(payloadFor(row), nowSec)).toEqual({
      ident: 'UA929',
      route: 'ORD → LHR',
      place: "Chicago O'Hare to London Heathrow · Wed, Nov 11",
      status: [{ text: 'In the air' }, { text: ' · ' }, { text: 'on time', tone: 'ok' }],
      // No "tomorrow" on a card a message thread keeps: "next day" against the printed date.
      line: 'Lands about 5:42 AM GMT next day at London Heathrow',
      asOf: 'Status as of 5:45 PM CST, Nov 11',
    });
  });

  it('delayed and canceled carry their words with their colour', () => {
    const delayed = delayedCase();
    expect(flightCardModel(payloadFor(delayed.row), delayed.nowSec).status).toEqual([{ text: 'Delayed about 47 minutes', tone: 'warn' }]);
    const canceled = canceledCase();
    expect(flightCardModel(payloadFor(canceled.row), canceled.nowSec).status).toEqual([{ text: 'Canceled', tone: 'bad' }]);
  });

  it('a flight we do not have still gets a card, without inventing a status', () => {
    const model = flightCardModel({ ident: 'UA9999', status: 'not-found' }, D);
    expect(model.status).toEqual([{ text: 'Not on the boards right now' }]);
  });
});

describe('GET /flight/:ident/card.png', () => {
  it('renders a 1200×630 PNG with the bundled fonts, CDN-cached for five minutes', async () => {
    const { row, nowSec } = inAirCase();
    flight.payload = payloadFor(row);
    vi.useFakeTimers({ toFake: ['Date'], now: nowSec * 1000 });
    const res = createRes();
    await handler({ method: 'GET', headers: {}, query: { ident: 'UA929' } }, res);
    vi.useRealTimers();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Cache-Control']).toBe(CARD_CACHE_CONTROL);
    expect(res.body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(pngSize(res.body)).toEqual({ width: 1200, height: 630 });
  }, 30_000);

  it('renders the not-found card too', async () => {
    const png = await renderFlightCard({ ident: 'UA9999', status: 'not-found' }, D);
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  }, 30_000);

  it('404s a non-flight, and falls back to the site card if anything fails', async () => {
    const bad = createRes();
    await handler({ method: 'GET', headers: {}, query: { ident: 'hello' } }, bad);
    expect(bad.statusCode).toBe(404);
    expect(bad.headers['Cache-Control']).toBe('no-store');

    flight.fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = createRes();
    await handler({ method: 'GET', headers: {}, query: { ident: 'UA929' } }, failed);
    expect(failed.statusCode).toBe(307);
    expect(failed.headers.Location).toBe('/og-image.png');
  });
});
