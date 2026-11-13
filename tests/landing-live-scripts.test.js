// @vitest-environment jsdom
// The two page scripts (src/scripts/hub-board.ts, src/scripts/fleet-live.ts) against the BUILT
// markup of a hub page and a fleet type page, with fetch stubbed: the success path fills the
// template, every failure path leaves the static line and releases the reserved height, and a
// failed refresh never blanks a board already on screen. Needs dist/ (CI builds first).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHubBoardPayload, emptyHubBoard } from '../src/lib/hub-board.js';
import { NOW_SEC, ORD_DAY_START, ordBoard } from './fixtures/hub-board-board.js';

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));

function mountPage(rel) {
  const html = readFileSync(join(DIST, rel), 'utf8');
  // innerHTML never executes the page's own <script> tags; the test imports the module itself.
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>\s*$/, '');
}

const okPayload = () =>
  buildHubBoardPayload({
    hub: 'ORD',
    timeZone: 'America/Chicago',
    nowSec: NOW_SEC,
    today: { data: ordBoard(), refreshedAt: NOW_SEC * 1000, dayStart: ORD_DAY_START, completeness: 1 },
  });
/**
 * What a script painted that wears link colour or an underline at rest without being, or sitting
 * in, a link or button (DESIGN.md 2026-11-12). The source guard (tests/design-guards.test.js)
 * cannot read a class held in an import (`LINK_TONE`), so the painted DOM is checked here.
 */
const paintedOffLink = (root) =>
  [...root.querySelectorAll('[class]')]
    .filter((el) => {
      const toks = (el.getAttribute('class') || '').split(/\s+/);
      return (toks.includes('text-primary') || toks.includes('underline')) && !el.closest('a, button');
    })
    .map((el) => el.outerHTML.slice(0, 100));
const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW_SEC * 1000 });
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.skipIf(!hasDist)('src/scripts/hub-board.ts on /hubs/ord', () => {
  const board = () => document.querySelector('[data-hub-board]');

  it('fills eight rows from /api/hub-board in the dashboard’s words, and never calls /api/schedule', async () => {
    mountPage('hubs/ord.html');
    const fetchMock = vi.fn(async () => jsonResponse(okPayload()));
    vi.stubGlobal('fetch', fetchMock);
    await import('../src/scripts/hub-board.ts');
    await vi.waitFor(() => expect(board().dataset.state).toBe('live'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/hub-board?hub=ORD');
    const rows = board().querySelectorAll('[data-hb-list] > li');
    expect(rows).toHaveLength(8);
    const first = rows[0];
    expect(first.querySelector('[data-f="time"]').textContent).toBe('14:40');
    expect(first.querySelector('[data-f="ident"]').textContent).toBe('UA104');
    // Every flight number is a link to its flight page.
    expect(first.querySelector('[data-f="ident"]').getAttribute('href')).toBe('/flight/UA104');
    for (const a of board().querySelectorAll('[data-hb-list] [data-f="ident"]')) {
      expect(a.getAttribute('href')).toBe(`/flight/${a.textContent}`);
    }
    expect(first.querySelector('[data-f="dest"]').textContent).toBe('BOS');
    // Links everywhere (Nov 12 2026): a destination that is one of the nine hubs links to its hub
    // page; any other airport is an href-less <a>, plain text to every reader.
    expect(first.querySelector('[data-f="dest"]').hasAttribute('href')).toBe(false);
    expect(rows[1].querySelector('[data-f="dest"]').textContent).toBe('LAX');
    expect(rows[1].querySelector('[data-f="dest"]').getAttribute('href')).toBe('/hubs/lax');
    expect(rows[2].querySelector('[data-f="dest"]').textContent).toBe('EWR');
    expect(rows[2].querySelector('[data-f="dest"]').getAttribute('href')).toBe('/hubs/ewr');
    expect(first.querySelector('[data-f="gate"]').textContent).toBe('T1 · C18');
    expect(first.querySelector('[data-f="pill"]').textContent).toBe('Departed');
    expect(first.querySelector('[data-f="live"]')).toBeNull(); // only on a feed-confirmed row
    expect(first.querySelector('[data-f="runway"]')).toBeNull();
    const delayed = rows[2];
    expect(delayed.querySelector('[data-f="under"]').textContent).toBe('now →16:05');
    expect(delayed.querySelector('[data-f="delay"]').textContent).toContain('+45m');
    expect(delayed.querySelector('[data-f="delay"]').className).toContain('text-bb-warn');

    expect(board().querySelector('[data-hb-stamp]').textContent).toBe('Data as of 14:18 CST · 42m ago');
    const truth = board().querySelector('[data-hb-truth]');
    expect(truth.hidden).toBe(false);
    expect(truth.textContent).toBe('Today: 16 scheduled · 3 departed · 67% on time · 1 canceled · 1 likely canceled (unconfirmed)');
    expect(board().querySelector('[data-hb-fallback]').hidden).toBe(true);
    expect(board().querySelector('[aria-live]')).toBeNull();
    expect(paintedOffLink(board())).toEqual([]);
  });

  it('keeps the static line and releases the reserved height when the board is unavailable', async () => {
    for (const respond of [
      async () => { throw new TypeError('offline'); },
      async () => new Response('{}', { status: 503 }),
      async () => jsonResponse(emptyHubBoard('ORD', 'America/Chicago', NOW_SEC)),
    ]) {
      vi.resetModules();
      mountPage('hubs/ord.html');
      vi.stubGlobal('fetch', vi.fn(respond));
      await import('../src/scripts/hub-board.ts');
      await vi.waitFor(() => expect(board().dataset.state).toBe('unavailable'));
      expect(board().querySelector('[data-hb-fallback]').hidden).toBe(false);
      expect(board().querySelector('[data-hb-fallback]').textContent).toMatch(/on the full board/);
      expect(board().querySelector('[data-hb-table]').hidden).toBe(true);
      expect(board().querySelector('[data-hb-body]').style.minHeight).toBe('0px');
      expect(board().querySelector('a[href="/?tab=schedule&hub=ord"]')).not.toBeNull();
    }
  });

  it('a failed refresh keeps the board on screen, re-cut to the page’s own clock', async () => {
    mountPage('hubs/ord.html');
    const fetchMock = vi.fn(async () => jsonResponse(okPayload()));
    vi.stubGlobal('fetch', fetchMock);
    await import('../src/scripts/hub-board.ts');
    await vi.waitFor(() => expect(board().dataset.state).toBe('live'));

    fetchMock.mockImplementation(async () => { throw new TypeError('offline'); });
    vi.setSystemTime((NOW_SEC + 40 * 60) * 1000);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    // (Earlier cases' modules also listen on this document, so count "refreshed at least once".)
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
    await vi.waitFor(() =>
      expect(board().querySelector('[data-hb-list] > li [data-f="ident"]').textContent).toBe('UA105'),
    );
    expect(board().dataset.state).toBe('live');
  });
});

describe.skipIf(!hasDist)('src/scripts/hub-board.ts keeps a keyboard reader’s place on refresh', () => {
  const board = () => document.querySelector('[data-hub-board]');

  // Two departures to the same hub link the same page (/hubs/ewr), so focus cannot be found again
  // by its address: the board finds the same link in the same departure, by the row's key.
  it('focus on the second of two links to the same hub stays on that row after a refresh', async () => {
    mountPage('hubs/ord.html');
    const twoToEwr = () => {
      const data = ordBoard();
      data.flights.find((f) => f.identification.number.default === 'UA108').airport.destination = {
        code: { iata: 'EWR' },
        info: { gate: '', terminal: 'C' },
        name: 'Newark',
      };
      return buildHubBoardPayload({
        hub: 'ORD',
        timeZone: 'America/Chicago',
        nowSec: NOW_SEC,
        today: { data, refreshedAt: NOW_SEC * 1000, dayStart: ORD_DAY_START, completeness: 1 },
      });
    };
    const fetchMock = vi.fn(async () => jsonResponse(twoToEwr()));
    vi.stubGlobal('fetch', fetchMock);
    await import('../src/scripts/hub-board.ts');
    await vi.waitFor(() => expect(board().dataset.state).toBe('live'));

    const ewrLinks = () => [...board().querySelectorAll('[data-hb-list] a[data-f="dest"][href="/hubs/ewr"]')];
    expect(ewrLinks()).toHaveLength(2);
    const second = ewrLinks()[1];
    const ident = second.closest('li').querySelector('[data-f="ident"]').textContent;
    expect(ident).toBe('UA108');
    second.focus();
    expect(document.activeElement).toBe(second);

    // A refresh after two minutes re-clones every row.
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      const calls = fetchMock.mock.calls.length;
      vi.setSystemTime((NOW_SEC + 2 * 60) * 1000);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(calls));
      await vi.waitFor(() => expect(ewrLinks()[1]).not.toBe(second)); // the row was replaced

      const focused = document.activeElement;
      expect(focused.getAttribute('data-f')).toBe('dest');
      expect(focused.getAttribute('href')).toBe('/hubs/ewr');
      expect(focused.closest('li').querySelector('[data-f="ident"]').textContent).toBe('UA108');
      // Set once, straight on the right row: a screen reader hears one link, not two.
      expect(focusSpy).toHaveBeenCalledTimes(1);
    } finally {
      focusSpy.mockRestore();
    }
  });

  // The departure stays on the board, but an earlier one to the same hub rolls off the top, so
  // the address's occurrence count shifts: "the second /hubs/ewr link" is now a different row.
  it('focus stays on its departure, set once, when an earlier departure to the same hub rolls off', async () => {
    mountPage('hubs/ord.html');
    const threeToEwr = () => {
      const data = ordBoard();
      for (const ident of ['UA104', 'UA106', 'UA108']) {
        data.flights.find((f) => f.identification.number.default === ident).airport.destination = {
          code: { iata: 'EWR' },
          info: { gate: '', terminal: 'C' },
          name: 'Newark',
        };
      }
      return buildHubBoardPayload({
        hub: 'ORD',
        timeZone: 'America/Chicago',
        nowSec: NOW_SEC,
        today: { data, refreshedAt: NOW_SEC * 1000, dayStart: ORD_DAY_START, completeness: 1 },
      });
    };
    const fetchMock = vi.fn(async () => jsonResponse(threeToEwr()));
    vi.stubGlobal('fetch', fetchMock);
    await import('../src/scripts/hub-board.ts');
    await vi.waitFor(() => expect(board().dataset.state).toBe('live'));

    const ewrLinks = () => [...board().querySelectorAll('[data-hb-list] a[data-f="dest"][href="/hubs/ewr"]')];
    const identOf = (a) => a.closest('li').querySelector('[data-f="ident"]').textContent;
    expect(ewrLinks().map(identOf)).toEqual(['UA104', 'UA106', 'UA108']);
    const middle = ewrLinks()[1];
    middle.focus();

    // Twenty minutes on, UA104 (departed 14:43) is past the board's 30-minute grace and gone.
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      const calls = fetchMock.mock.calls.length;
      vi.setSystemTime((NOW_SEC + 20 * 60) * 1000);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(calls));
      await vi.waitFor(() => expect(ewrLinks().map(identOf)).toEqual(['UA106', 'UA108']));

      expect(identOf(document.activeElement)).toBe('UA106');
      expect(document.activeElement.getAttribute('data-f')).toBe('dest');
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy.mock.contexts[0]).toBe(document.activeElement);
    } finally {
      focusSpy.mockRestore();
    }
  });
});

describe.skipIf(!hasDist)('src/scripts/fleet-live.ts on /fleet/787-9-dreamliner', () => {
  const strip = () => document.querySelector('[data-fleet-live]');
  const FEED = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'ual-feed-2026-10-04-trimmed.json'), 'utf8'));

  it('counts this type airborne from the cached feed URL; each row opens the live map, its number the flight page', async () => {
    mountPage('fleet/787-9-dreamliner.html');
    const fetchMock = vi.fn(async () => jsonResponse(FEED));
    vi.stubGlobal('fetch', fetchMock);
    await import('../src/scripts/fleet-live.ts');
    await vi.waitFor(() => expect(strip().dataset.state).toBe('live'));

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/fr24-feed?airline=UAL');
    const total = strip().dataset.tails.split(',').length;
    expect(strip().querySelector('[data-fl-count-label]').textContent).toBe(`of ${total} airborne`);
    const links = [...strip().querySelectorAll('[data-fl-list] a[data-f="link"]')];
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(4);
    for (const a of links) expect(a.getAttribute('href')).toMatch(/^\/\?flight=/);
    expect(links[0].textContent).toMatch(/^Open (UA\d+|N\w+) on the live map$/);
    // The flight number is its own link (never nested in the map link) to the flight page.
    for (const li of strip().querySelectorAll('[data-fl-list] > li')) {
      const ident = li.querySelector('[data-f="ident"]');
      expect(ident.closest('[data-f="link"]')).toBeNull();
      if (/^UA\d{1,4}$/.test(ident.textContent)) {
        expect(ident.getAttribute('href')).toBe(`/flight/${ident.textContent}`);
        expect(li.querySelector('[data-f="link"]').textContent).toBe(`Open ${ident.textContent} on the live map`);
      } else {
        expect(ident.hasAttribute('href')).toBe(false);
      }
    }
    expect(strip().querySelector('[data-fl-fallback]').hidden).toBe(true);
    expect(paintedOffLink(strip())).toEqual([]);
  });

  it('links each hub end to its hub page and the tail to the aircraft dialog, none nested in another link', async () => {
    mountPage('fleet/787-9-dreamliner.html');
    const tails = document.querySelector('[data-fleet-live]').dataset.tails.split(',');
    const row = (reg, flight, from, to) => ['A00000', 41.9, -87.9, 90, 35000, 450, '', 'T-KORD1', 'B789', reg, 1791000000, from, to, flight, 0, 0, `UAL${flight.slice(2)}`, 0, 'UAL'];
    const feed = { a: row(tails[0], 'UA857', 'SFO', 'PVG'), b: row(tails[1], 'UA2', 'EWR', 'NRT') };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(feed)));
    await import('../src/scripts/fleet-live.ts');
    await vi.waitFor(() => expect(strip().dataset.state).toBe('live'));

    const [first, second] = strip().querySelectorAll('[data-fl-list] > li');
    const hrefs = (li) => [...li.querySelectorAll('a[href]')].map((a) => [a.dataset.f || a.textContent, a.getAttribute('href')]);
    expect(hrefs(second)).toEqual([
      ['ident', '/flight/UA857'],
      ['SFO', '/hubs/sfo'],
      [tails[0], `/?aircraft=${tails[0]}`],
      ['link', '/?flight=UA857'],
    ]);
    expect(first.querySelector('[data-f="route"]').textContent).toBe('EWR →  to NRT');
    expect(hrefs(first).slice(1, 3)).toEqual([['EWR', '/hubs/ewr'], ['NRT', '/hubs/nrt']]);
    // PVG is not a hub: text. No link holds another.
    expect([...second.querySelectorAll('a')].some((a) => a.textContent === 'PVG')).toBe(false);
    for (const a of strip().querySelectorAll('[data-fl-list] a')) expect(a.querySelector('a')).toBeNull();
    // Hub and tail links are second names: quiet, and inert on a touch screen where the row is one tap target.
    const hub = second.querySelector('a[href="/hubs/sfo"]');
    expect(hub.className).toContain('decoration-muted-foreground/40');
    expect(hub.className).toContain('pointer-coarse:pointer-events-none');
    expect(hub.className).not.toContain('text-primary');
  });

  // Rows re-cut on every refresh, and hubs repeat across them: "the third link to /hubs/sfo" is a
  // different row once an earlier SFO row has landed. Each row carries its tail as its key.
  it('a refresh keeps keyboard focus on the same row\'s hub when an earlier row to that hub has landed', async () => {
    mountPage('fleet/787-9-dreamliner.html');
    const tails = document.querySelector('[data-fleet-live]').dataset.tails.split(',');
    const row = (reg, flight, from, to) => ['A00000', 41.9, -87.9, 90, 35000, 450, '', 'T-KORD1', 'B789', reg, 1791000000, from, to, flight, 0, 0, `UAL${flight.slice(2)}`, 0, 'UAL'];
    const before = { a: row(tails[0], 'UA1', 'SFO', 'NRT'), b: row(tails[1], 'UA5', 'SFO', 'LHR'), c: row(tails[2], 'UA9', 'EWR', 'SFO') };
    const after = { b: row(tails[1], 'UA5', 'SFO', 'LHR'), c: row(tails[2], 'UA9', 'EWR', 'SFO'), d: row(tails[3], 'UA20', 'DEN', 'SFO') };
    const fetchMock = vi.fn(async () => jsonResponse(before));
    vi.stubGlobal('fetch', fetchMock);
    await import('../src/scripts/fleet-live.ts');
    await vi.waitFor(() => expect(strip().dataset.state).toBe('live'));

    const identOf = (a) => a.closest('li').querySelector('[data-f="ident"]').textContent;
    const sfo = () => [...strip().querySelectorAll('[data-fl-list] a[href="/hubs/sfo"]')];
    expect(sfo().map(identOf)).toEqual(['UA1', 'UA5', 'UA9']);
    const ua9 = sfo()[2];
    ua9.focus();

    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      fetchMock.mockImplementation(async () => jsonResponse(after));
      const calls = fetchMock.mock.calls.length;
      vi.setSystemTime((NOW_SEC + 2 * 60) * 1000);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(calls));
      await vi.waitFor(() => expect(sfo().map(identOf)).toEqual(['UA5', 'UA9', 'UA20']));

      expect(ua9.isConnected).toBe(false);
      expect(document.activeElement.getAttribute('href')).toBe('/hubs/sfo');
      expect(identOf(document.activeElement)).toBe('UA9');
      expect(focusSpy).toHaveBeenCalledTimes(1);
    } finally {
      focusSpy.mockRestore();
    }
  });

  it('an empty feed is a failed read: static line, no "0 airborne"', async () => {
    mountPage('fleet/787-9-dreamliner.html');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ full_count: 0, version: 4 })));
    await import('../src/scripts/fleet-live.ts');
    await vi.waitFor(() => expect(strip().dataset.state).toBe('unavailable'));
    expect(strip().querySelector('[data-fl-live]').hidden).toBe(true);
    expect(strip().querySelector('[data-fl-fallback]').hidden).toBe(false);
    expect(strip().querySelector('[data-fl-body]').style.minHeight).toBe('0px');
  });
});
