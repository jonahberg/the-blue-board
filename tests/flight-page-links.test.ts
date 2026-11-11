// @vitest-environment jsdom
/**
 * Flight numbers on the flight page link to their own flight pages (src/scripts/flight-page.ts on
 * the built dist/flight.html): every number in "Its recent flights" and the inbound flight in the
 * timeline's "Aircraft arrived from …" step — except this page's own number, which stays text.
 * Needs `bun run build` first (skips locally without dist/).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { D, payloadFor, scheduledCase, ua929Aircraft } from './fixtures/flight-page-fixtures.js';

const SHELL = join(resolve(__dirname, '..'), 'dist', 'flight.html');
const hasDist = existsSync(SHELL);
if (!hasDist && process.env.CI) throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test`');

const DEP = D / 60; // minutes since the epoch, the archive's unit
const leg = (flight_no: string, origin: string, dest: string, depMin: number, blockMin: number) => ({
  flight_no, service_date: '2026-11-10', origin, dest,
  sched_dep: depMin, sched_arr: depMin + blockMin, dep_at: depMin + 4, dep_basis: 'gate', arr_at: depMin + blockMin, arr_basis: 'gate',
  airborne_at: null, status: 'arrived', outcome: 'operated', final: true,
  registration: 'N686UA', aircraft_code: 'B763', operator: 'UAL', last_seen: depMin + blockMin,
});

function mountShell() {
  const html = readFileSync(SHELL, 'utf8');
  document.body.outerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>') + 7);
  document.querySelector<HTMLElement>('[data-flight-page]')!.dataset.flightIdent = 'UA929';
}

describe.skipIf(!hasDist)('flight page: flight numbers are links', () => {
  beforeEach(() => {
    mountShell();
    const { row } = scheduledCase();
    row.aircraft.registration = 'N686UA';
    const tail = {
      reg: 'N686UA',
      rows: [
        leg('UA930', 'LHR', 'ORD', DEP - 600, 480), // brings the aircraft in, 2 h before departure
        leg('UA929', 'ORD', 'LHR', DEP - 2 * 1440, 490), // this flight, two days ago
        leg('UA9999', 'EWR', 'ORD', DEP - 3 * 1440, 130),
      ],
    };
    vi.useFakeTimers({ toFake: ['Date'], now: (D - 5 * 3600) * 1000 });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/flight?')) return Response.json(payloadFor(row, { tail, aircraft: ua929Aircraft }));
      return new Response('{}', { status: 404 });
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('links the aircraft\'s other flights and the inbound step, never this page', async () => {
    vi.resetModules();
    await import('../src/scripts/flight-page.ts');
    const root = document.querySelector<HTMLElement>('[data-flight-page]')!;
    await vi.waitFor(() => expect(root.dataset.state).toBe('live'));

    const legs = [...document.querySelectorAll('[data-f="legs"] > li [data-f="flight"]')];
    expect(legs.map((a) => a.textContent)).toEqual(['UA930', 'UA929', 'UA9999']);
    expect(legs.map((a) => a.getAttribute('href'))).toEqual(['/flight/UA930', null, '/flight/UA9999']);

    const step = [...document.querySelectorAll('[data-f="timeline"] [data-f="label"]')].find((s) => /Aircraft/.test(s.textContent || ''));
    expect(step?.textContent).toMatch(/^Aircraft (arrived|due in) from .+ \(UA930\)/);
    const link = step!.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/flight/UA930');
    expect(link?.textContent).toBe('UA930');
  });
});
