// The /api/faa response exactly as the server builds it, for client-helper tests.
//
// Client helpers (faa-context, ops-health, weather-cards) used to be tested against
// hand-written fixtures with Title Case delay types ('Ground Stop') the server never sends —
// api/faa.ts emits snake_case ('ground_stop', 'ground_delay', …). Running the captured
// nasstatus.faa.gov fixtures through the real handler keeps the vocabulary honest.
//
// Airports covered: EWR ground stop, LGA ground delay program, RSW/SLC departure delay,
// DCA closure, BOS arrival delay, plus several quiet airports.

import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

import handler, { __resetFaaHandlerForTests } from '../../api/faa.js';
import { __resetRateLimitersForTests } from '../../api/_rate-limit.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));

/** @returns {Promise<Array<Object>>} the parsed /api/faa JSON body. */
export async function serverFaaResponse() {
  const upstream = [
    ...load('faa-airport-events-minimal.json'),
    ...load('faa-airport-events.json'),
    ...load('faa-airport-events-programs.json'),
  ];
  __resetFaaHandlerForTests();
  __resetRateLimitersForTests();
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    /** @type {any} */ ({ ok: true, json: async () => upstream }),
  );
  const res = {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  try {
    await handler(/** @type {any} */ ({ method: 'GET', headers: {} }), /** @type {any} */ (res));
  } finally {
    spy.mockRestore();
  }
  if (res.statusCode !== 200 || !Array.isArray(res.body)) {
    throw new Error(`serverFaaResponse: handler returned ${res.statusCode}`);
  }
  return res.body;
}
