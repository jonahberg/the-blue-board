// Ask the board — the browser side. Pins:
//   - runAsk (src/lib/ask-client.js): the rules answer with no network call; only a not-sure
//     question is POSTed; any non-200 (429, the preview proxy's 404, a 5xx), a network error or a
//     timeout is "unavailable"; the server's answer is validated AGAIN before it is trusted;
//   - shouldOfferAsk (src/lib/global-search.js): the Ask row is offered only when the text is not a
//     strong local match;
//   - the store (src/app/state/ask.tsx): only validated answers enter; removing the last chip, or
//     clearing, empties it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ASK_ENDPOINT, readAskAnswer, runAsk } from '../src/lib/ask-client.js';
import { shouldOfferAsk } from '../src/lib/global-search.js';
import { __peekAskStateForTests, __resetAskStateForTests, clearAsk, removeAskFilter, setAskResult } from '../src/app/state/ask';

const json = (status, body) => ({ status, json: async () => body });

describe('runAsk', () => {
  it('a question the rules read never touches the network', async () => {
    const fetchImpl = vi.fn();
    const out = await runAsk('late arrivals into denver', { fetchImpl });
    expect(out).toEqual({ kind: 'result', source: 'rules', result: { view: 'schedule', filters: { hub: 'DEN', direction: 'arrivals', status: 'delayed' } } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a not-sure question is POSTed as { q }, cleaned', async () => {
    const fetchImpl = vi.fn(async () => json(200, { ok: true, source: 'model', result: { view: 'live', filters: { family: '777', airborne: true } } }));
    const out = await runAsk('  which polaris 777s are flying tonight\u0000 ', { fetchImpl });
    expect(out).toEqual({ kind: 'result', source: 'model', result: { view: 'live', filters: { family: '777', airborne: true } } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ASK_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ q: 'which polaris 777s are flying tonight' });
  });

  it.each([
    ['429', json(429, { ok: false, reason: 'rate_limited' })],
    ['404 (the preview proxy has no /api/ask)', json(404, { error: 'not found' })],
    ['502', json(502, null)],
    ['a calm cap shape', json(200, { ok: false, reason: 'cap', message: 'I can only do simple searches right now.' })],
    ['garbage', json(200, 'hello')],
  ])('%s → unavailable', async (_label, response) => {
    expect(await runAsk('which polaris 777s are flying tonight', { fetchImpl: async () => response })).toEqual({ kind: 'unavailable' });
  });

  it('a network error or a timeout → unavailable', async () => {
    expect(await runAsk('polaris 777s tonight', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } })).toEqual({ kind: 'unavailable' });
    const hang = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await runAsk('polaris 777s tonight', { fetchImpl: hang, timeoutMs: 10 })).toEqual({ kind: 'unavailable' });
  });

  it('unsupported from the server is unsupported', async () => {
    expect(await runAsk('meaning of life', { fetchImpl: async () => json(200, { ok: true, source: 'unsupported' }) })).toEqual({ kind: 'unsupported' });
  });

  it('a server answer is re-validated: a tampered response yields at most known filters', () => {
    expect(readAskAnswer({ ok: true, source: 'model', result: { view: 'live', filters: { hub: 'DEN', label: '<script>', family: 'HACKED' } } }))
      .toEqual({ kind: 'result', source: 'model', result: { view: 'live', filters: { hub: 'DEN' } } });
    expect(readAskAnswer({ ok: true, source: 'model', result: { view: 'live', filters: { text: 'pwned' } } })).toEqual({ kind: 'unsupported' });
    expect(readAskAnswer({ ok: true, source: 'admin', result: { view: 'live', filters: { hub: 'DEN' } } })).toEqual({ kind: 'unavailable' });
  });

  it('an empty question is unsupported without a request', async () => {
    const fetchImpl = vi.fn();
    expect(await runAsk('   ', { fetchImpl })).toEqual({ kind: 'unsupported' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('shouldOfferAsk', () => {
  it('offers Ask for plain questions and names', () => {
    expect(shouldOfferAsk('late arrivals into denver')).toBe(true);
    expect(shouldOfferAsk('denver')).toBe(true);
    expect(shouldOfferAsk('starlink 787s')).toBe(true);
  });
  it('not for flight numbers, tails, bare numbers or very short text', () => {
    for (const q of ['UA1432', 'ua 1432', '1432', 'N12345', '787', 'de', '']) expect(shouldOfferAsk(q), q).toBe(false);
  });
  it('not when the live feed has a strong match (exact, prefix or route), but yes over a weak substring', () => {
    expect(shouldOfferAsk('ORD DEN', { bestLiveRank: 2 })).toBe(false);
    expect(shouldOfferAsk('UAL12', { bestLiveRank: 1 })).toBe(false);
    expect(shouldOfferAsk('max', { bestLiveRank: 3 })).toBe(true);
  });
  it('not for a one-word query a loaded board answers; yes for a sentence that happens to match', () => {
    expect(shouldOfferAsk('SFO', { scheduleMatches: 40 })).toBe(false);
    expect(shouldOfferAsk('late departures from SFO', { scheduleMatches: 0 })).toBe(true);
  });
});

describe('the store', () => {
  beforeEach(() => __resetAskStateForTests());

  it('only validated answers enter, each with a new key; removing the last chip or clearing empties it', () => {
    const read = () => __peekAskStateForTests();
    expect(setAskResult({ view: 'live', filters: { text: 'pwned' } }, 'model')).toBeNull();
    expect(read().result).toBeNull();
    const result = setAskResult({ view: 'live', filters: { family: '787', starlink: true } }, 'rules');
    expect(result).toEqual({ view: 'live', filters: { family: '787', starlink: true } });
    const key = read().key;
    expect(read()).toEqual({ key, result, source: 'rules' });
    removeAskFilter('starlink');
    expect(read().result).toEqual({ view: 'live', filters: { family: '787' } });
    removeAskFilter('family');
    expect(read().result).toBeNull();
    setAskResult({ view: 'schedule', filters: { hub: 'DEN', status: 'delayed' } }, 'model');
    expect(read().key).toBe(key + 1);
    clearAsk();
    expect(read()).toEqual({ key: key + 1, result: null, source: null });
  });
});
