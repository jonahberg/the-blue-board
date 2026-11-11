// @vitest-environment jsdom
/**
 * The flight page's support line (src/scripts/flight-page.ts on the built dist/flight.html).
 *
 * The page ships the words for an unknown status (src/lib/cover-a-day.js flightPageSupportCopy):
 * the core line and "Help cover a day" on the any-amount link. Once /api/support-status answers for
 * today, the line says whether today is covered and its link names the day $17 would cover, on the
 * fixed $17 link; the `data-support="flight-page"` label never changes. An unconfigured status or a
 * failed fetch leaves the page's own words. Needs `bun run build` first (skips locally without dist/).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { supportStatusFromRows } from '../src/lib/cover-a-day.js';
import { supportAmountUrl, supportUrl } from '../src/lib/support-link.js';
import { payloadFor, scheduledCase } from './fixtures/flight-page-fixtures.js';

const SHELL = join(resolve(__dirname, '..'), 'dist', 'flight.html');
const hasDist = existsSync(SHELL);
if (!hasDist && process.env.CI) throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test`');
const PLAIN = 'This page is free because flyers cover The Blue Board, one day at a time. Help cover a day';

const words = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

function mountShell() {
  const html = readFileSync(SHELL, 'utf8');
  const body = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>') + 7);
  document.body.outerHTML = body;
  const root = document.querySelector<HTMLElement>('[data-flight-page]')!;
  root.dataset.flightIdent = 'UA929';
}

function serve(support: () => Promise<Response>) {
  const { row } = scheduledCase();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const href = String(url);
    if (href.startsWith('/api/flight?')) return Response.json(payloadFor(row));
    if (href === '/api/support-status') return support();
    return new Response('{}', { status: 404 });
  }));
}

async function loadPage() {
  vi.resetModules();
  await import('../src/scripts/flight-page.ts');
}

describe.skipIf(!hasDist)('flight page support line', () => {
  beforeEach(() => {
    mountShell();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('starts as the page\'s own sentence, linked with the flight-page label', () => {
    const line = document.querySelector('[data-fp-support]')!;
    expect(words(line)).toBe(PLAIN);
    const link = line.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(supportUrl('flight-page'));
    expect(link.getAttribute('data-support')).toBe('flight-page');
  });

  it('says nobody has covered today, and links "Cover today" to the $17 link with the same label', async () => {
    serve(async () => Response.json(supportStatusFromRows([], Date.now())));
    await loadPage();
    const line = document.querySelector('[data-fp-support]')!;
    await vi.waitFor(() => expect(words(line)).toBe("No one has covered today yet. $17 pays for the day's flight data and servers. Cover today · $17"));
    expect(line.hasAttribute('hidden')).toBe(false);
    const link = line.querySelector('a')!;
    expect(words(link)).toBe('Cover today · $17');
    expect(link.getAttribute('href')).toBe(supportAmountUrl(17, 'flight-page'));
    expect(link.getAttribute('data-support')).toBe('flight-page');
    // One cheap read, not one per refresh.
    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c[0] === '/api/support-status');
    expect(calls).toHaveLength(1);
  });

  it('thanks today\'s supporter and names the next day when today is covered', async () => {
    const now = Date.now();
    const row = { id: 1, amount_cents: 1700, currency: 'usd', paid_at: new Date(now).toISOString(), refunded: false, amount_refunded_cents: 0, display_name: 'Dana R.', hidden: false };
    serve(async () => Response.json(supportStatusFromRows([row], now)));
    await loadPage();
    const line = document.querySelector('[data-fp-support]')!;
    await vi.waitFor(() => expect(words(line)).toBe('Today is covered, thanks to Dana R. Cover tomorrow · $17'));
    const link = line.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(supportAmountUrl(17, 'flight-page'));
    expect(link.getAttribute('data-support')).toBe('flight-page');
  });

  it('keeps its own words and link when the status cannot be had or makes no claim', async () => {
    for (const support of [
      async () => new Response('nope', { status: 503 }),
      async () => { throw new TypeError('Failed to fetch'); },
      async () => Response.json({ configured: false }),
    ]) {
      mountShell();
      serve(support);
      await loadPage();
      const line = document.querySelector('[data-fp-support]')!;
      await vi.waitFor(() => expect(line.hasAttribute('hidden')).toBe(false));
      // Let the status read settle, then check nothing changed.
      await new Promise((r) => setTimeout(r, 20));
      expect(words(line)).toBe(PLAIN);
      expect(line.querySelector('a')!.getAttribute('href')).toBe(supportUrl('flight-page'));
    }
  });
});
