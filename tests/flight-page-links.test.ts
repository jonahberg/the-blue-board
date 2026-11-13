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

import { D, historyRows, inAirCase, payloadFor, scheduledCase, ua929Aircraft } from './fixtures/flight-page-fixtures.js';

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
      // payloadFor's JSDoc defaults type `tail` and `aircraft` as null; the endpoint sends objects.
      const extra: any = { tail, aircraft: ua929Aircraft };
      if (String(url).startsWith('/api/flight?')) return Response.json(payloadFor(row, extra));
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

/**
 * The rest of what the flight page names (links everywhere, Nov 2026): hub route ends → hub pages,
 * the tail → the dashboard's aircraft dialog, the type → its fleet page by the fleet database's
 * type for the tail, Starlink Wi-Fi → the Starlink tab. The words on the page do not change.
 */
describe.skipIf(!hasDist)('flight page: hubs, tail, type and Starlink are links', () => {
  const mountWith = (extra: Record<string, unknown>) => {
    mountShell();
    const { row } = scheduledCase();
    row.aircraft.registration = String((extra.aircraft as { reg?: string } | null)?.reg || '');
    vi.useFakeTimers({ toFake: ['Date'], now: (D - 5 * 3600) * 1000 });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/flight?')) return Response.json(payloadFor(row, extra as any));
      return new Response('{}', { status: 404 });
    }));
  };
  const load = async () => {
    vi.resetModules();
    await import('../src/scripts/flight-page.ts');
    const root = document.querySelector<HTMLElement>('[data-flight-page]')!;
    await vi.waitFor(() => expect(root.dataset.state).toBe('live'));
  };
  const card = () => document.querySelector<HTMLElement>('[data-fp-aircraft]')!;
  const trip = () => document.querySelector<HTMLElement>('[data-fp-trip]')!;
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('a mainline tail: hub ends, tail and type link; this page and LHR stay text; no link holds another', async () => {
    const tail = {
      reg: 'N686UA',
      rows: [leg('UA930', 'LHR', 'ORD', DEP - 600, 480), leg('UA9999', 'EWR', 'SFO', DEP - 3 * 1440, 130)],
    };
    const history = { origin: 'ORD', dest: 'LHR', today: '2026-11-11', rows: historyRows(['2026-11-09', '2026-11-10']) };
    mountWith({ tail, aircraft: ua929Aircraft, history });
    await load();

    // The trip block: ORD is a hub, LHR is not.
    expect(trip().querySelector('[data-f="origin"] a')?.getAttribute('href')).toBe('/hubs/ord');
    expect(trip().querySelector('[data-f="origin"]')!.textContent).toBe('ORD');
    expect(trip().querySelector('[data-f="dest"] a')).toBeNull();
    expect(trip().querySelector('[data-f="dest"]')!.textContent).toBe('LHR');

    // The aircraft card: the tail (link colour, the card's identity), the type (quiet), same words.
    const reg = card().querySelector('[data-f="reg"] a')!;
    expect([reg.textContent, reg.getAttribute('href')]).toEqual(['N686UA', '/?aircraft=N686UA']);
    expect(reg.className).toContain('text-primary');
    const summary = card().querySelector('[data-f="summary"]')!;
    expect(summary.textContent).toBe('Boeing 767-300ER · 167 seats');
    const type = summary.querySelector('a')!;
    expect([type.textContent, type.getAttribute('href')]).toEqual(['Boeing 767-300ER', '/fleet/767-300er']);
    expect(type.className).not.toContain('text-primary');
    expect(card().querySelector('[data-f="wifi-text"] a')).toBeNull(); // Satellite Ku, not Starlink

    // Its recent flights: each hub end links, LHR does not.
    const routes = [...card().querySelectorAll('[data-f="legs"] > li [data-f="route"]')];
    expect(routes.map((r) => [...r.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]))).toEqual([
      [['ORD', '/hubs/ord']],
      [['EWR', '/hubs/ewr'], ['SFO', '/hubs/sfo']],
    ]);

    // The 30-day card's route.
    const historyRoute = document.querySelector('[data-fp-history] [data-f="route"]')!;
    expect([...historyRoute.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/hubs/ord']);

    // The page's own number stays text, and no link sits inside another.
    expect(document.querySelector('[data-fp-title]')!.querySelector('a')).toBeNull();
    for (const a of document.querySelectorAll('[data-flight-page] a')) expect(a.querySelector('a')).toBeNull();

    // Once painted, nothing wears link colour or an underline unless it is, or sits in, a link or
    // button. The plane marker on the track is an aria-hidden icon (tests/design-guards.test.js).
    const painted = [...document.querySelectorAll('[data-flight-page] [class]')].filter((el) => {
      const toks = (el.getAttribute('class') || '').split(/\s+/);
      return (toks.includes('text-primary') || toks.includes('underline')) && !el.closest('a, button') && el.getAttribute('data-f') !== 'track-dot';
    });
    expect(painted.map((el) => el.outerHTML.slice(0, 100))).toEqual([]);
  });

  it('a Starlink roster Express tail: the tail and Starlink link; the type and operator are text', async () => {
    const aircraft = {
      reg: 'N515GJ', type: 'CRJ-550', typeCode: null, config: '', seats: null, total: 50, wifi: 'Starlink', starlink: true,
      ife: null, delivered: null, operator: 'GoJet Airlines', express: true, source: 'roster',
    };
    mountWith({ aircraft });
    await load();
    expect(card().querySelector('[data-f="reg"] a')?.getAttribute('href')).toBe('/?aircraft=N515GJ');
    expect(card().querySelector('[data-f="summary"] a')).toBeNull();
    expect(card().querySelector('[data-f="summary"]')!.textContent).toBe('CRJ-550 · 50 seats · United Express, flown by GoJet Airlines');
    const wifi = card().querySelector('[data-f="wifi-text"] a')!;
    expect([wifi.textContent, wifi.getAttribute('href')]).toEqual(['Starlink Wi-Fi', '/#starlink']);
  });

  it('a refresh that changes nothing leaves keyboard focus on the very link the reader was on', async () => {
    mountWith({ aircraft: ua929Aircraft });
    await load();
    const before = card().querySelector<HTMLAnchorElement>('[data-f="reg"] a')!;
    before.focus();
    expect(document.activeElement).toBe(before);
    // Back to a visible tab: the page repaints from what it has (render()). Nothing in the card
    // changed, so nothing is replaced and focus is not touched.
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(before.isConnected).toBe(true);
      expect(document.activeElement).toBe(before);
      expect(focusSpy).not.toHaveBeenCalled();
    } finally {
      focusSpy.mockRestore();
      delete (document as any).hidden;
    }
  });

  it('a refresh keeps focus on the same one of two links to the same hub ("Its recent flights")', async () => {
    // The legs chain: ORD is the origin of the newer leg and the destination of the older one.
    const newer = leg('UA1234', 'ORD', 'LAX', DEP - 600, 240);
    const tail = { reg: 'N686UA', rows: [newer, leg('UA930', 'LHR', 'ORD', DEP - 1440, 480)] };
    mountWith({ tail, aircraft: ua929Aircraft });
    await load();
    const ordLinks = () => [...card().querySelectorAll<HTMLAnchorElement>('[data-f="legs"] a[href="/hubs/ord"]')];
    expect(ordLinks()).toHaveLength(2);
    const before = ordLinks()[1]; // row 1's ORD
    expect(before.closest('li')!.querySelector('[data-f="flight"]')!.textContent).toBe('UA930');
    before.focus();
    // A fresh read in which the newer leg's result changed (it left 40 min late): the list repaints.
    const { row } = scheduledCase();
    row.aircraft.registration = 'N686UA';
    const late = { ...newer, dep_at: newer.sched_dep + 40 };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/flight?')) return Response.json(payloadFor(row, { tail: { reg: 'N686UA', rows: [late, tail.rows[1]] }, aircraft: ua929Aircraft } as any));
      return new Response('{}', { status: 404 });
    }));
    vi.setSystemTime((D - 5 * 3600 + 120) * 1000);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(before.isConnected).toBe(false)); // repainted
    expect(document.activeElement).toBe(ordLinks()[1]);
    expect((document.activeElement as Element).closest('li')!.querySelector('[data-f="flight"]')!.textContent).toBe('UA930');
    delete (document as any).hidden;
  });

  // A newer leg joining the top of "Its recent flights" shifts the count of ORD links above the
  // reader's; each leg carries a key (flight, day, origin), so focus stays on that leg's ORD.
  it('a refresh keeps focus on the same leg\'s hub when a newer leg to that hub joins the list', async () => {
    const legs = (...rows: ReturnType<typeof leg>[]) => ({ reg: 'N686UA', rows });
    const ua200 = leg('UA200', 'ORD', 'LAX', DEP - 1000, 240);
    const ua300 = leg('UA300', 'LHR', 'ORD', DEP - 1440, 480);
    const ua400 = leg('UA400', 'DEN', 'ORD', DEP - 400, 180);
    mountWith({ tail: legs(ua200, ua300), aircraft: ua929Aircraft });
    await load();
    const flightOf = (a: Element) => a.closest('li')!.querySelector('[data-f="flight"]')!.textContent;
    const ordLinks = () => [...card().querySelectorAll<HTMLAnchorElement>('[data-f="legs"] a[href="/hubs/ord"]')];
    expect(ordLinks().map(flightOf)).toEqual(['UA200', 'UA300']);
    const before = ordLinks()[1];
    before.focus();

    const { row } = scheduledCase();
    row.aircraft.registration = 'N686UA';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/flight?')) return Response.json(payloadFor(row, { tail: legs(ua400, ua200, ua300), aircraft: ua929Aircraft } as any));
      return new Response('{}', { status: 404 });
    }));
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      vi.setSystemTime((D - 5 * 3600 + 120) * 1000); // past half the refresh interval: a fresh read
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(ordLinks().map(flightOf)).toEqual(['UA400', 'UA200', 'UA300']));
      expect(before.isConnected).toBe(false);
      expect(flightOf(document.activeElement!)).toBe('UA300');
      expect(document.activeElement!.getAttribute('href')).toBe('/hubs/ord');
      expect(focusSpy).toHaveBeenCalledTimes(1);
    } finally {
      focusSpy.mockRestore();
      delete (document as any).hidden;
    }
  });

  // In the air, a refresh paints twice: once from the stored flight, once more when the live feed
  // has the aircraft. A list whose content did not change must not take focus again.
  it('in the air, a refresh moves focus once at most, though the page paints twice', async () => {
    mountShell();
    const { row, nowSec } = inAirCase();
    const tail = { reg: 'N686UA', rows: [leg('UA200', 'ORD', 'LAX', DEP - 1000, 240), leg('UA300', 'LHR', 'ORD', DEP - 1440, 480)] };
    const feedRow = ['A00000', 50.1, -40.2, 70, 37000, 480, '', 'T-X', 'B763', 'N686UA', nowSec, 'ORD', 'LHR', 'UA929', 0, 0, 'UAL929', 0, 'UAL'];
    let feedReads = 0;
    vi.useFakeTimers({ toFake: ['Date'], now: nowSec * 1000 });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/flight?')) return Response.json(payloadFor(row, { tail, aircraft: ua929Aircraft } as any));
      if (String(url).startsWith('/api/fr24-feed')) {
        feedReads++;
        return Response.json({ full_count: 1, version: 4, a: feedRow });
      }
      return new Response('{}', { status: 404 });
    }));
    await load();
    await vi.waitFor(() => expect(feedReads).toBeGreaterThanOrEqual(1));
    const ordLinks = () => [...card().querySelectorAll<HTMLAnchorElement>('[data-f="legs"] a[href="/hubs/ord"]')];
    const flightOf = (a: Element) => a.closest('li')!.querySelector('[data-f="flight"]')!.textContent;
    expect(ordLinks().map(flightOf)).toEqual(['UA200', 'UA300']);
    ordLinks()[1].focus();

    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      // (Earlier cases' page modules also listen on this document; count this refresh's reads.)
      const reads = feedReads;
      vi.setSystemTime((nowSec + 120) * 1000);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(feedReads).toBeGreaterThan(reads)); // the stored read, then the live one
      await vi.waitFor(() => expect(document.querySelector<HTMLElement>('[data-flight-page]')!.dataset.state).toBe('live'));
      await new Promise((r) => setTimeout(r, 0));
      expect(flightOf(document.activeElement!)).toBe('UA300');
      expect(document.activeElement!.getAttribute('href')).toBe('/hubs/ord');
      expect(focusSpy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      focusSpy.mockRestore();
      delete (document as any).hidden;
    }
  });

  it('a flight we do not have: the last route it flew links its hub end in the header', async () => {
    mountShell();
    vi.useFakeTimers({ toFake: ['Date'], now: (D - 5 * 3600) * 1000 });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/flight?')) {
        return Response.json({ v: 1, ident: 'UA929', status: 'not-found', leg: null, aircraft: null, history: null, tail: null, lastSeen: { date: '2026-11-07', origin: 'EWR', dest: 'LHR' } });
      }
      return new Response('{}', { status: 404 });
    }));
    vi.resetModules();
    await import('../src/scripts/flight-page.ts');
    const root = document.querySelector<HTMLElement>('[data-flight-page]')!;
    await vi.waitFor(() => expect(root.dataset.state).toBe('not-found'));
    const route = root.querySelector('[data-fp-route]')!;
    expect([...route.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['EWR', '/hubs/ewr']]);
    expect(route.textContent).toBe('EWR →  to LHR');
  });

  it('a tail only the schedule named and a model code print as text', async () => {
    const aircraft = {
      reg: 'N999ZZ', type: 'B739', typeCode: null, config: '', seats: null, total: null, wifi: null, starlink: false,
      ife: null, delivered: null, operator: null, express: false, source: 'schedule',
    };
    mountWith({ aircraft });
    await load();
    expect(card().querySelector('[data-f="reg"]')!.textContent).toBe('N999ZZ');
    expect(card().querySelector('a[href^="/?aircraft="], a[href^="/fleet/"]')).toBeNull();
  });
});
