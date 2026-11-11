// The share card for a flight page: /flight/:ident/card.png (vercel.json rewrites it here as
// /api/flight-card?ident=…). A 1200×630 PNG — the flight number large, the route, one status line,
// the site's name — rendered with satori (layout to SVG) and @resvg/resvg-wasm (SVG to PNG):
// WebAssembly, no browser, no native binary. These two are what @vercel/og wraps; they are used
// directly because @vercel/og 1.x ships without the hb.wasm its own Node build loads (it fails in
// Node with ENOENT) and 0.x pulls in a second copy of sharp as an optional native dependency. The
// words come from the same payload and verdict the page uses (loadFlightPayload in api/flight.ts,
// src/lib/flight-page-card.js).
//
// Not under /api/ on the outside: robots.txt disallows /api/, and social crawlers that honour it
// would never fetch the image.
//
// Cost: the same stored-data reads as /api/flight (memoized per instance) and a render; no provider.
// CDN-cached for five minutes; link-preview services cache it themselves after that.
//
// Fonts are bundled, never fetched: Geist and Geist Mono TTFs (SIL OFL, from the `geist` package by
// Vercel; api/_flight-card/OFL.txt) beside this file — satori cannot read the woff2 files the site
// ships, so these two weights are kept as TTF here.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import type { VercelRequest, VercelResponse } from './_types.js';
import { createRateLimiter } from './_rate-limit.js';
import { loadFlightPayload } from './flight.js';
import { parseFlightIdent } from '../src/lib/flight-page.js';
import { CARD_HEIGHT, CARD_WIDTH, flightCardModel, flightCardTree } from '../src/lib/flight-page-card.js';

const isRateLimited = createRateLimiter('flight-card', 30);

export const CARD_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=600';

let fonts: { name: string; data: Buffer; weight: 500 | 600; style: 'normal' }[] | null = null;
function loadFonts() {
  if (!fonts) {
    fonts = [
      { name: 'Geist', data: readFileSync(new URL('./_flight-card/Geist-Medium.ttf', import.meta.url)), weight: 500, style: 'normal' },
      { name: 'Geist Mono', data: readFileSync(new URL('./_flight-card/GeistMono-SemiBold.ttf', import.meta.url)), weight: 600, style: 'normal' },
    ];
  }
  return fonts;
}

// resvg's WebAssembly is initialised once per instance (a second initWasm throws).
let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    const wasm = readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'));
    wasmReady = initWasm(wasm).catch((err) => {
      wasmReady = null;
      throw err;
    });
  }
  return wasmReady;
}

/** The PNG bytes for one payload (exported for tests). */
export async function renderFlightCard(payload: any, nowSec: number): Promise<Buffer> {
  const [svg] = await Promise.all([
    satori(flightCardTree(flightCardModel(payload, nowSec)) as any, { width: CARD_WIDTH, height: CARD_HEIGHT, fonts: loadFonts() }),
    ensureWasm(),
  ]);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng();
  return Buffer.from(png);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).send('Method not allowed');
  }
  if (isRateLimited(req)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).send('Too many requests');
  }
  const parsed = parseFlightIdent(req.query?.ident as unknown);
  if (!parsed) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send('Not a flight number');
  }
  try {
    const nowMs = Date.now();
    const payload = await loadFlightPayload(parsed.ident, nowMs);
    const png = await renderFlightCard(payload, Math.floor(nowMs / 1000));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', CARD_CACHE_CONTROL);
    return res.status(200).send(req.method === 'HEAD' ? Buffer.alloc(0) : png);
  } catch (e: any) {
    console.error(`flight-card: render failed for ${parsed.ident}:`, e?.message || e);
    // The site's generic card rather than a broken image in someone's message thread.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    res.setHeader('Location', '/og-image.png');
    return res.status(307).end();
  }
}
