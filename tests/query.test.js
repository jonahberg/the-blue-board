// api/_query.ts reads the query from req.url so handlers never touch the platform's lazy
// req.query getter (the source of ~4,700 DEP0169 url.parse() warnings a week). Whether the warning
// is actually gone can only be confirmed in production logs; this pins the parsing parity.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { getQuery } from '../api/_query.js';

/** A request whose req.query getter fails the test if anything reads it. */
function requestWithUrl(url) {
  const req = { url };
  Object.defineProperty(req, 'query', {
    get() { throw new Error('req.query was read'); },
  });
  return req;
}

describe('getQuery', () => {
  it('reads single values from req.url without touching req.query', () => {
    expect({ ...getQuery(requestWithUrl('/api/metar?ids=KORD,KDEN')) }).toEqual({ ids: 'KORD,KDEN' });
  });

  it('decodes percent escapes and + like the platform parser', () => {
    const q = getQuery(requestWithUrl('/api/flight-times?flight=UA%20123&from=a+b&empty='));
    expect(q.flight).toBe('UA 123');
    expect(q.from).toBe('a b');
    expect(q.empty).toBe('');
  });

  it('returns repeated keys as an array, in order, as req.query does', () => {
    expect(getQuery(requestWithUrl('/api/fr24-feed?airline=UAL&airline=SKW&airline=X')).airline).toEqual(['UAL', 'SKW', 'X']);
  });

  it('is empty for a URL with no query string, and absent keys are undefined', () => {
    const q = getQuery(requestWithUrl('/api/irops'));
    expect(Object.keys(q)).toEqual([]);
    expect(q.hub).toBeUndefined();
  });

  it('treats __proto__ as an ordinary key', () => {
    const q = getQuery(requestWithUrl('/api/hub-board?__proto__=x&hub=ORD'));
    expect(q.hub).toBe('ORD');
    expect(Object.getPrototypeOf(q)).toBe(null);
  });

  it('falls back to req.query when there is no url (how the test suite builds requests)', () => {
    expect(getQuery({ query: { hub: 'ORD' } })).toEqual({ hub: 'ORD' });
    expect(getQuery({})).toEqual({});
  });
});

describe('API handlers read the query through getQuery', () => {
  const API = resolve(__dirname, '..', 'api');
  function* walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) yield* walk(path);
      else if (/\.ts$/.test(name) && name !== '_query.ts') yield path;
    }
  }

  it('no file under api/ reads req.query directly', () => {
    const offenders = [...walk(API)]
      .filter((path) => /\breq\.query\b|\breq\?\.query\b/.test(
        // comments may mention it
        readFileSync(path, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''),
      ))
      .map((path) => relative(API, path));
    expect(offenders).toEqual([]);
  });
});
