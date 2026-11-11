// ═══ ASK THE BOARD: THE BROWSER SIDE ═══
// One question from the search palette to one outcome: the rules parser first (no network, no
// cost), POST /api/ask only when it is not sure, and the server's answer validated AGAIN here before
// anything is applied — the page trusts the vocabulary, not the network.
//
// Outcomes:
//   { kind: 'result', source: 'rules'|'model', result }   apply it
//   { kind: 'unsupported' }                                 the question is outside the vocabulary
//   { kind: 'unavailable' }                                 the model cannot be asked (cap, switch,
//                                                           failure, rate limit, offline, any non-200)

import { normalizeAskQuery, parseAsk } from './ask-parse.js';
import { validateAskResult } from './ask-vocabulary.js';

export const ASK_ENDPOINT = '/api/ask';

/** The browser gives the server this long before showing the "simple searches" line. */
export const ASK_CLIENT_TIMEOUT_MS = 9000;

/**
 * Example questions the palette offers when a question could not be answered. Every one is answered
 * by the rules parser alone (tests/ask-parse.test.js pins that), so they work even when the model
 * is capped.
 */
export const ASK_EXAMPLES = Object.freeze([
  'late arrivals into denver',
  'starlink 787s over the atlantic',
  "what's wrong at newark",
]);

/** The one plain line the palette shows for each non-result outcome. */
export const ASK_HELP_LINE = 'I can filter by hub, arrivals or departures, aircraft type, Starlink, map region, in the air or on the ground, late or canceled, or one flight or tail number.';
export const ASK_UNAVAILABLE_LINE = 'I can only do simple searches right now.';

/**
 * Read the server's JSON into an outcome. Anything unexpected is "unavailable".
 * @param {unknown} body
 * @returns {{kind: 'result', source: 'model'|'rules', result: {view: string, filters: Record<string, unknown>}} | {kind: 'unsupported'} | {kind: 'unavailable'}}
 */
export function readAskAnswer(body) {
  const b = /** @type {any} */ (body);
  if (!b || typeof b !== 'object' || b.ok !== true) return { kind: 'unavailable' };
  if (b.source === 'unsupported') return { kind: 'unsupported' };
  if (b.source !== 'model' && b.source !== 'rules') return { kind: 'unavailable' };
  const checked = validateAskResult(b.result);
  if (!checked.ok) return { kind: 'unsupported' };
  return { kind: 'result', source: b.source, result: checked.result };
}

/**
 * Answer one question.
 * @param {string} rawQuery
 * @param {{fetchImpl?: typeof fetch, signal?: AbortSignal, timeoutMs?: number}} [deps]
 */
export async function runAsk(rawQuery, deps = {}) {
  const query = normalizeAskQuery(rawQuery);
  if (!query) return { kind: 'unsupported' };
  const local = parseAsk(query);
  if (local.confident) return { kind: 'result', source: 'rules', result: local.result };

  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return { kind: 'unavailable' };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  deps.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? ASK_CLIENT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(ASK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query }),
      signal: controller.signal,
    });
    if (!response || response.status !== 200) return { kind: 'unavailable' };
    const body = await response.json().catch(() => null);
    return readAskAnswer(body);
  } catch {
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', onAbort);
  }
}
