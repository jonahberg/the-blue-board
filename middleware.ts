// ═══ VERCEL ROUTING MIDDLEWARE — MARKDOWN CONTENT NEGOTIATION ═══
// Serves the acceptmarkdown.com contract from the canonical URLs: `Accept: text/markdown`
// gets Markdown, browsers keep getting the dashboard, and every response carries
// `Vary: Accept` so a CDN can't hand one audience the other's bytes.
//
// Why middleware and not Astro: astro.config.mjs is `output: 'static'`, so Astro
// middleware runs once at build time and never sees a request. Vercel Routing Middleware
// is platform-level and runs before the cache on every matched request, which is the only
// interception point this site has.
//
// The decision logic lives in src/lib/agent-negotiation.js so it is unit-testable without
// a Vercel runtime (see tests/accept-negotiation.test.js and tests/agent-readiness.test.js).

import { next } from '@vercel/functions';

import { resolveAgentResponse } from './src/lib/agent-negotiation.js';

export const config = {
  // Pages only. Static assets and /api/* are excluded so the dashboard's 30-second polling
  // never pays for a middleware invocation — this project already watches denial-of-wallet
  // on the API surface, and none of these paths has a Markdown representation anyway.
  matcher: [
    '/((?!_astro/|_vercel/|api/|css/|data/|fonts/|icons/|js/|og/|favicon\\.svg|favicon\\.ico|manifest\\.json|og-image\\.png|robots\\.txt|sw\\.js).*)',
  ],
};

export default function middleware(request: Request): Response {
  let decision;
  try {
    const url = new URL(request.url);
    decision = resolveAgentResponse({
      pathname: url.pathname,
      accept: request.headers.get('accept'),
      method: request.method,
    });
  } catch {
    // Middleware sits in front of every page. A throw here would 500 the whole site, so
    // any surprise degrades to "serve the site exactly as before".
    return next();
  }

  if (decision.kind === 'markdown') {
    return new Response(decision.body, {
      status: decision.status,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        // Set here as well as in vercel.json: a middleware-synthesised response does not
        // pass through the static header layer.
        Vary: 'Accept, Accept-Encoding',
        'Cache-Control': decision.cacheControl,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (decision.kind === 'not-acceptable') {
    return new Response(decision.body, {
      status: decision.status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        Vary: 'Accept, Accept-Encoding',
        // 406 is keyed entirely on a request header — never let it stick in a cache.
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // HTML: hand the request straight back to the static host. `Vary` comes from the
  // vercel.json header rule, which also covers the paths this matcher skips.
  return next();
}
