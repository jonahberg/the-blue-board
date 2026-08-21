// ═══ AGENT REQUEST RESOLUTION ═══
// The whole decision the root middleware.ts makes, expressed as a pure function so it can
// be unit-tested without a Vercel runtime. middleware.ts is a thin adapter that turns the
// descriptor returned here into a Response.

import { preferredType } from './accept-negotiation.js';
import { agentMarkdown, notAcceptableText, notFoundMarkdown } from './agent-markdown.js';
import { isKnownRoutePath, normalizePathname } from './site-routes.js';

/** Media types this site can emit, most-preferred first. HTML stays the default. */
export const PRODUCES = Object.freeze(['text/html', 'text/markdown']);

/** Markdown pages change about as often as the HTML around them. */
const MARKDOWN_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=600';

/**
 * @typedef {{kind: 'html'}
 *   | {kind: 'markdown', status: number, body: string, cacheControl: string}
 *   | {kind: 'not-acceptable', status: 406, body: string}} AgentDecision
 */

/**
 * Decide what to serve for one request.
 *
 * @param {{pathname?: string, accept?: string|null, method?: string}} input
 * @returns {AgentDecision}
 */
export function resolveAgentResponse({ pathname = '/', accept = null, method = 'GET' } = {}) {
  // Only safe, body-less methods negotiate. Anything else falls through untouched so a
  // future form post can never be answered with a Markdown document.
  const verb = String(method || 'GET').toUpperCase();
  if (verb !== 'GET' && verb !== 'HEAD') return { kind: 'html' };

  const chosen = preferredType(accept, PRODUCES);

  // Every representation was rejected (q=0 across the board, or an Accept naming only
  // types we cannot produce). RFC 9110 §15.5.7.
  if (chosen === null) {
    return { kind: 'not-acceptable', status: 406, body: notAcceptableText(accept, PRODUCES) };
  }

  if (chosen !== 'text/markdown') return { kind: 'html' };

  const path = normalizePathname(pathname);

  const body = agentMarkdown[path];
  if (body) {
    return { kind: 'markdown', status: 200, body, cacheControl: MARKDOWN_CACHE_CONTROL };
  }

  // Dead URL: answer 404 in the format the client asked for, with pointers it can act on.
  if (!isKnownRoutePath(path)) {
    return { kind: 'markdown', status: 404, body: notFoundMarkdown(path), cacheControl: 'no-store' };
  }

  // A real page with no Markdown twin yet. Serving HTML is the correct RFC fallback —
  // 406 here would deny agents content we do in fact have.
  return { kind: 'html' };
}
