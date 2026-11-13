/**
 * The fleet type pages' "in the air right now" strip (src/components/site/FleetLive.astro).
 *
 * Bundled by Astro into `_astro/` (CSP: `script-src 'self'`, no inline script). Reads
 * `/api/fr24-feed?airline=UAL` — the free feed, the exact URL the dashboard polls, CDN-cached for
 * 15 s — never a metered provider. When no dashboard tab keeps that edge warm, a visible fleet tab
 * causes at most one free-feed origin read per refresh, so the refresh is a slow two minutes (the
 * hub pages, meanwhile, dropped their own 30 s poll of the same feed). Every decision about what
 * counts, and what each name in a row links to (`fleetLiveRowLinks`), lives in
 * src/lib/fleet-live.js; this file only paints, with `textContent`.
 *
 * An empty feed is a failed read (feed-health.js), not "none airborne": a failed first read leaves
 * the static line and releases the reserved height; a failed refresh keeps the last good strip.
 */

import { LINK_TONE } from '../app/features/link-style';
import { airborneOfType } from '../lib/fleet-live.js';
import { parseStaleHeader } from '../lib/feed-health.js';
import { replaceChildrenKeepingFocus } from './flight-link';

const REFRESH_MS = 120_000;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * A hub end or the tail in a row: body colour with a quiet underline (the site's second-name look,
 * LINK_TONE.quiet), above the row's stretched live-map link (`z-10`), at least 24 px tall for a
 * mouse (`min-h-6`: the tail's 11 px text alone makes 22.7 px), inside the 44 px row. On a
 * touch screen the row is one tap target (the map, with the number split out), so these take no
 * taps and drop the underline there; they stay in the tab order. The route cell truncates (clips),
 * so the focus ring is drawn inside the link (`-outline-offset-2`), as on the hub board.
 */
const ROW_NAME_LINK = `relative z-10 inline-block min-h-6 py-1 ${LINK_TONE.quiet} focus-visible:-outline-offset-2 pointer-coarse:pointer-events-none pointer-coarse:no-underline`;

/** `text` as a quiet link to `href`, or as plain text when it has none. */
function nameOrText(text: string, href: string | null): Node {
  if (!href) return document.createTextNode(text);
  const a = document.createElement('a');
  a.className = ROW_NAME_LINK;
  a.href = href;
  a.textContent = text;
  return a;
}

const root = document.querySelector<HTMLElement>('[data-fleet-live]');

if (root) {
  const tails = (root.dataset.tails || '').split(',').filter(Boolean);
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const body = q<HTMLElement>('[data-fl-body]');
  const stamp = q<HTMLElement>('[data-fl-stamp]');
  const fallback = q<HTMLElement>('[data-fl-fallback]');
  const live = q<HTMLElement>('[data-fl-live]');
  const count = q<HTMLElement>('[data-fl-count]');
  const countLabel = q<HTMLElement>('[data-fl-count-label]');
  const list = q<HTMLUListElement>('[data-fl-list]');
  const template = q<HTMLTemplateElement>('template[data-fl-row]');

  let shown = false;
  let lastLoad = 0;
  let loading = false;

  const release = () => {
    root.dataset.state = 'unavailable';
    if (body) body.style.minHeight = '0';
    if (stamp) stamp.style.minHeight = '0';
  };

  const paint = (result: NonNullable<ReturnType<typeof airborneOfType>>, asOfMs: number) => {
    if (count) count.textContent = String(result.airborne);
    if (countLabel) countLabel.textContent = `of ${tails.length} airborne`;

    const rows = result.flights.map((flight) => {
      const li = template?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
      if (!li) return null;
      const { links } = flight;
      // The tail: how a refresh finds this row again for a keyboard reader (flight-link.ts).
      li.dataset.key = flight.key;
      const field = (name: string) => li.querySelector<HTMLElement>(`[data-f="${name}"]`);
      // The number links to its flight page; '—' (no number in the feed) stays text (no href).
      const ident = field('ident');
      if (ident) {
        ident.textContent = flight.ident || '—';
        if (links.ident) ident.setAttribute('href', links.ident);
        else ident.removeAttribute('href');
      }
      const route = field('route');
      if (route) {
        if (flight.origin && flight.dest) {
          // The arrow is decoration; a screen reader hears "SFO to PVG".
          const arrow = document.createElement('span');
          arrow.setAttribute('aria-hidden', 'true');
          arrow.textContent = ' → ';
          const to = document.createElement('span');
          to.className = 'sr-only';
          to.textContent = ' to ';
          route.append(nameOrText(flight.origin, links.origin), arrow, to, nameOrText(flight.dest, links.dest));
        } else {
          route.textContent = 'Route not in feed';
        }
      }
      field('reg')?.append(nameOrText(flight.reg, links.reg));
      // The row's own link: that flight on the live map ("Open UA857 on the live map").
      const link = li.querySelector<HTMLAnchorElement>('[data-f="link"]');
      if (link) link.href = links.map;
      const linkName = field('link-name');
      if (linkName) linkName.textContent = `Open ${flight.ident || flight.reg} on the live map`;
      return li;
    });
    // Refreshes every two minutes; a reader tabbing through the rows keeps their place.
    if (list) replaceChildrenKeepingFocus(list, rows.filter((li): li is HTMLElement => li !== null));

    if (stamp) {
      stamp.textContent = `Live feed · ${new Date(asOfMs).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })}`;
    }
    if (fallback) fallback.hidden = true;
    if (live) live.hidden = false;
    root.dataset.state = 'live';
    shown = true;
  };

  const load = async () => {
    if (loading || !tails.length) return;
    loading = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch('/api/fr24-feed?airline=UAL', { signal: controller.signal });
      if (!response.ok) throw new Error(`feed ${response.status}`);
      const payload = await response.json();
      const result = airborneOfType(payload, tails);
      if (!result) throw new Error('empty feed');
      // A stale-served body says how old it is; the stamp says so too (feed-health.js).
      const staleMs = parseStaleHeader(response.headers.get('X-BB-Feed-Stale'));
      lastLoad = Date.now();
      paint(result, Date.now() - staleMs);
    } catch {
      if (!shown) release();
    } finally {
      clearTimeout(timer);
      loading = false;
    }
  };

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
    start();
  });

  if (tails.length) {
    void load();
    if (!document.hidden) start();
  } else {
    release();
  }
}

export {};
