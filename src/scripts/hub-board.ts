/**
 * The hub pages' departures board (src/components/site/HubBoard.astro).
 *
 * Bundled by Astro into `_astro/` from the component's relative `<script src>`, so the CSP keeps
 * `script-src 'self'` with no inline script. Reads `/api/hub-board?hub=…` — a read of the stored
 * schedule snapshot, CDN-cached for two minutes — and never `/api/schedule`, whose first load of
 * an uncached board can spend metered provider units.
 *
 * Every word in a row comes from src/lib/hub-board-view.js, which runs the dashboard's own row
 * model; this file only clones the `<template>` and sets `textContent` (never innerHTML). Each
 * flight number links to its flight page (/flight/UA5789) through ./flight-link.ts.
 *
 * Failure is quiet by design: a failed or empty first load leaves the static line and releases the
 * reserved height; a failed refresh keeps the board it already has, re-cut to this clock.
 */

import { hubBoardRows, hubBoardStamp, hubBoardTruth } from '../lib/hub-board-view.js';
import { replaceChildrenKeepingFocus, setFlightLink } from './flight-link';

type ViewRow = ReturnType<typeof hubBoardRows>[number];
type Payload = { status?: string; generatedAt?: number | null; timeZone: string; hub: string } & Record<string, unknown>;

const REFRESH_MS = 120_000;
const FETCH_TIMEOUT_MS = 8_000;

const root = document.querySelector<HTMLElement>('[data-hub-board]');

if (root) {
  const hub = root.dataset.hubBoard || '';
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const body = q<HTMLElement>('[data-hb-body]');
  const stamp = q<HTMLElement>('[data-hb-stamp]');
  const truth = q<HTMLElement>('[data-hb-truth]');
  const fallback = q<HTMLElement>('[data-hb-fallback]');
  const table = q<HTMLElement>('[data-hb-table]');
  const list = q<HTMLOListElement>('[data-hb-list]');
  const template = q<HTMLTemplateElement>('template[data-hb-row]');

  let payload: Payload | null = null;
  let lastLoad = 0;
  let loading = false;

  const el = (tag: string, className: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const srOnly = (text: string) => el('span', 'sr-only', text);
  const figure = (value: string | number) => el('span', 'font-mono text-foreground tabular-nums', String(value));

  const showUnavailable = (message?: string) => {
    root.dataset.state = 'unavailable';
    if (body) body.style.minHeight = '0';
    if (table) table.hidden = true;
    if (truth) truth.hidden = true;
    if (stamp) {
      stamp.textContent = '';
      stamp.removeAttribute('title');
      stamp.style.minHeight = '0';
    }
    if (fallback) {
      if (message) fallback.textContent = message;
      fallback.hidden = false;
    }
  };

  const renderStamp = (p: Payload, nowSec: number) => {
    if (!stamp) return;
    const s = hubBoardStamp(p, nowSec);
    if (!s) {
      stamp.textContent = '';
      return;
    }
    stamp.textContent = `Data as of ${s.time} ${s.zone} · ${s.age === 'just now' ? 'just now' : `${s.age} ago`}`;
    // The words say the age; the warn tone only repeats it for a board past an hour old.
    stamp.className = `font-mono text-[11px] tabular-nums ${s.severity === 'recent' ? 'text-muted-foreground' : 'text-bb-warn'}`;
    stamp.title =
      'When the schedule provider last refreshed this board. Boards refresh through the day; open the full board for the latest.';
  };

  const renderTruth = (p: Payload) => {
    if (!truth) return;
    const t = hubBoardTruth(p);
    truth.replaceChildren();
    if (!t) {
      truth.hidden = true;
      return;
    }
    const parts: Node[][] = [
      [el('span', 'text-foreground', 'Today'), document.createTextNode(': '), figure(t.scheduled), document.createTextNode(' scheduled')],
      t.presumed > 0
        ? [figure(t.departed), document.createTextNode(' departed (+'), figure(t.presumed), document.createTextNode(' presumed)')]
        : [figure(t.departed), document.createTextNode(' departed')],
      t.otp === null
        ? [document.createTextNode('no on-time share yet')]
        : [figure(`${t.otp}%`), document.createTextNode(' on time')],
      [figure(t.canceled), document.createTextNode(' canceled')],
    ];
    if (t.likelyCanceled > 0) {
      parts.push([figure(t.likelyCanceled), document.createTextNode(' likely canceled (unconfirmed)')]);
    }
    if (t.partialPct !== null) parts.push([document.createTextNode(`board ${t.partialPct}% loaded`)]);
    parts.forEach((nodes, i) => {
      if (i > 0) truth.append(el('span', 'text-muted-foreground/60', ' · '));
      const group = el('span', 'whitespace-nowrap');
      group.append(...nodes);
      truth.append(group);
    });
    truth.title =
      'Departed: flights with a recorded departure time. Presumed: the scheduled time passed over an hour ago without a live update. On time = within 30 minutes of schedule, of departures with a recorded time. "Likely canceled" is the provider\'s unconfirmed state; most such flights operate.';
    truth.hidden = false;
  };

  const fillRow = (row: ViewRow): HTMLElement | null => {
    const li = template?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
    if (!li) return null;
    const f = (name: string) => li.querySelector<HTMLElement>(`[data-f="${name}"]`);

    const time = f('time');
    if (time) time.textContent = row.time;
    const under = f('under');
    if (under) {
      if (row.under) {
        if (row.underSr) under.append(srOnly(row.underSr));
        under.append(row.under.text);
        if (row.under.early) under.classList.replace('text-muted-foreground', 'text-bb-ok');
      } else {
        under.remove();
      }
    }
    // A number the site has a page for links to it; anything else stays an href-less `<a>`,
    // which is plain text to every reader (src/scripts/flight-link.ts).
    const ident = f('ident');
    if (ident) setFlightLink(ident, row.ident);
    const dest = f('dest');
    if (dest) dest.textContent = row.dest;
    const city = f('city');
    if (city) city.textContent = row.destName;
    const gate = f('gate');
    if (gate) {
      if (row.gate) gate.textContent = row.gate;
      else gate.remove();
    }

    const pill = f('pill');
    if (pill) {
      pill.textContent = row.status.label;
      pill.className = `${pill.className} ${row.status.pillClass}`;
      if (row.status.note) pill.append(srOnly(` (${row.status.note})`));
      const title = [row.status.note, row.status.asOf ? 'as of the board time above' : ''].filter(Boolean).join(' · ');
      if (title) pill.title = title;
    }
    if (!row.status.live) f('live')?.remove();

    const delay = f('delay');
    if (delay) {
      if (row.delay) {
        delay.classList.add(row.delay.toneClass);
        delay.title = row.delay.title;
        if (!row.delay.runwayNote) f('runway')?.remove();
        if (row.delay.glyph) {
          // "≥" / "≤" is decoration once the words exist (schedule-row-display.js delayFigure).
          const glyph = el('span', '', `${row.delay.glyph} `);
          glyph.setAttribute('aria-hidden', 'true');
          delay.append(glyph);
        }
        if (row.delay.sr) delay.append(srOnly(row.delay.sr));
        delay.append(el('span', '', row.delay.value));
        if (row.delay.runwayNote) delay.append(srOnly(` (${row.delay.runwayNote})`));
      } else {
        delay.remove();
      }
    }
    return li;
  };

  const render = () => {
    if (!payload || payload.status !== 'ok') {
      showUnavailable();
      return;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const rows = hubBoardRows(payload, nowSec);
    if (!rows.length) {
      showUnavailable(`No more United departures on today's ${hub} board. Tomorrow's schedule is on the full board.`);
      return;
    }
    const items = rows.map(fillRow).filter((li): li is HTMLElement => li !== null);
    // The board refreshes every two minutes; a reader tabbing through its links keeps their place.
    if (list) replaceChildrenKeepingFocus(list, items);
    renderStamp(payload, nowSec);
    renderTruth(payload);
    if (fallback) fallback.hidden = true;
    if (table) table.hidden = false;
    root.dataset.state = 'live';
  };

  const load = async () => {
    if (loading || !hub) return;
    loading = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`/api/hub-board?hub=${encodeURIComponent(hub)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`hub-board ${response.status}`);
      const next = (await response.json()) as Payload;
      // A refresh that comes back empty never blanks a board already on screen.
      if (next?.status === 'ok' || !payload) payload = next;
      lastLoad = Date.now();
    } catch {
      // Keep whatever is on screen; a first-load failure leaves the static line.
    } finally {
      clearTimeout(timer);
      loading = false;
    }
    render();
  };

  // Poll only while the tab is visible; a returning tab refreshes once if the copy is old.
  let timerId: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (timerId === null) timerId = setInterval(load, REFRESH_MS);
  };
  const stop = () => {
    if (timerId !== null) clearInterval(timerId);
    timerId = null;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop();
      return;
    }
    if (Date.now() - lastLoad > REFRESH_MS / 2) void load();
    else if (payload) render();
    start();
  });

  void load();
  if (!document.hidden) start();
}

export {};
