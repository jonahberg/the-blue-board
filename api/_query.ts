// The request's query string, read without touching the platform's lazy `req.query`.
//
// Production logs about 4,700 `[DEP0169] url.parse()` deprecation warnings a week, one per process,
// and only on the routes whose handlers read `req.query` (/api/metar among them, which loads no
// packages; routes that never read it log none). App code never calls url.parse, so the caller is
// the runtime's lazy `req.query` getter. The warning is harmless, but it buries real errors.
//
// This parses `req.url` with the WHATWG URL parser into the same shape the getter returns: every
// value a string, a repeated key an array in order (`?a=1&a=2` → `{ a: ['1', '2'] }`), `+` and
// percent escapes decoded. Handlers keep their own validation; nothing about what they accept
// changes. When there is no `url` (the test suite builds requests from `query` alone) it falls
// back to `req.query`, so the getter is never touched in production, where `url` is always set.
// Whether the warning is gone can only be confirmed in production logs.

import type { VercelRequest } from './_types.js';

export type RequestQuery = Record<string, string | string[]>;

export function getQuery(req: Pick<VercelRequest, 'url' | 'query'>): RequestQuery {
  const url = req?.url;
  if (typeof url !== 'string' || url === '') {
    return (req?.query as RequestQuery | undefined) || {};
  }
  // A null-prototype object, so a `__proto__` key is just a key.
  const query: RequestQuery = Object.create(null);
  let params: URLSearchParams;
  try {
    params = new URL(url, 'http://localhost').searchParams;
  } catch {
    return query;
  }
  params.forEach((value, key) => {
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  });
  return query;
}
