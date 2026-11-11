// @vitest-environment jsdom
/**
 * The flight page's support line (src/scripts/flight-page.ts on the built dist/flight.html).
 *
 * When /api/support-status is configured and today is open, the line takes the site's day
 * framing (src/lib/cover-a-day.js flightPageSupportCopy) and keeps its link: same href, same
 * `data-support="flight-page"` label. A covered today, an unconfigured status or a failed fetch
 * leaves the page's own sentence. Needs `bun run build` first (skips locally without dist/).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { supportStatusFromRows } from '../src/lib/cover-a-day.js';
import { supportUrl } from '../src/lib/support-link.js';
import { payloadFor, scheduledCase } from './fixtures/flight-page-fixtures.js';

const SHELL = join(resolve(__dirname, '..'), 'dist', 'flight.html');
const hasDist = existsSync(SHELL);
if (!hasDist && process.env.CI) throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test`');
const PLAIN = 'The Blue Board is free and run by one person. If it helped you today, you can chip in toward the data bill.';

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

  it('takes the day framing when today is not covered, keeping the same link', async () => {
    serve(async () => Response.json(supportStatusFromRows([], Date.now())));
    await loadPage();
    const line = document.querySelector('[data-fp-support]')!;
    await vi.waitFor(() => expect(words(line)).toBe("Today isn't covered yet. $17 keeps The Blue Board running for a day. Cover today · $17"));
    expect(line.hasAttribute('hidden')).toBe(false);
    const link = line.querySelector('a')!;
    expect(words(link)).toBe('Cover today · $17');
    expect(link.getAttribute('href')).toBe(supportUrl('flight-page'));
    expect(link.getAttribute('data-support')).toBe('flight-page');
    // One cheap read, not one per refresh.
    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c[0] === '/api/support-status');
    expect(calls).toHaveLength(1);
  });

  it('keeps its own sentence when the status cannot be had or makes no claim', async () => {
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
    }
  });
});
