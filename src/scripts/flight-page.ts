/**
 * The flight page (src/pages/flight/index.astro; served per flight by api/flight-page.ts).
 *
 * Bundled by Astro into `_astro/` from the page's relative `<script src>`, so the CSP keeps
 * `script-src 'self'` with no inline script. Reads `/api/flight?ident=…` — stored data only,
 * CDN-cached for a minute — and paints what `flightPageView()` (src/lib/flight-page-view.js) says,
 * with `textContent` only (never innerHTML). Other flights' numbers (the tail's recent legs, the
 * inbound aircraft's flight in the timeline) link to their own flight pages (./flight-link.ts).
 *
 * Three optional reads, all of endpoints the dashboard already shares through the CDN:
 *   - `/api/fr24-feed?airline=UAL` (the dashboard's own URL, so the same cached object) ONLY while
 *     this flight is in the air, for its live position on the progress track;
 *   - `/api/support-status` (CDN-cached for a minute), once, when the support line first shows: the
 *     line then says whether today is covered and its link names the day $17 would cover; any
 *     failure leaves the page's own words;
 *   - the AI read's inputs and `/api/delay-explain`, ONLY when the reader presses that button.
 *
 * "Watch this flight" is a link to the dashboard's `?watch=UA929` deep link (src/lib/watch-link.js):
 * the dashboard adds the flight through its own watch store (so the push subscription and the
 * first-watch alert prompt follow) and opens My Flights. This page only READS the watch list, to
 * say "Watching" on the button; it never writes it.
 */

import { readWatched } from '../lib/watch-utils.js';
import { watchLinkHref } from '../lib/watch-link.js';
import { parseFlightIdent, flightPagePath } from '../lib/flight-page.js';
import { flightPageView, STEP_CLASSES, TONE_TEXT } from '../lib/flight-page-view.js';
import { findLiveFlight, liveFlightMatchesLeg } from '../lib/my-flights.js';
import { parseFr24Feed } from '../lib/feed-health.js';
import { replaceChildrenKeepingFocus, setFlightLink, splitFlightIdents } from './flight-link';

type Payload = Record<string, any> & { status?: string; ident?: string };
type View = ReturnType<typeof flightPageView>;

const REFRESH_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;

/**
 * A flight number inside a timeline sentence. Inline in running text, so the 44 px touch target is
 * an `after:` box (16 px line + 14 px above and below); the timeline has no other control for it
 * to cover.
 */
const STEP_FLIGHT_LINK =
  'relative font-medium text-primary underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-3.5 hover:underline';

const root = document.querySelector<HTMLElement>('[data-flight-page]');

function q<T extends Element>(scope: ParentNode, sel: string): T | null {
  return scope.querySelector<T>(sel);
}
function el(tag: string, className = '', text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function srOnly(text: string) {
  return el('span', 'sr-only', text);
}
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** The flight this address names: /flight/UA929, or the static fallback's /flight?f=UA929. */
function identFromLocation(): { raw: string; parsed: ReturnType<typeof parseFlightIdent> } {
  const fromAttr = root?.dataset.flightIdent || '';
  const m = /^\/flight\/([^/]+)\/?$/.exec(window.location.pathname);
  const raw = fromAttr || (m ? decodeURIComponent(m[1]) : '') || new URLSearchParams(window.location.search).get('f') || '';
  return { raw, parsed: raw ? parseFlightIdent(raw) : null };
}

if (root) {
  const title = q<HTMLElement>(root, '[data-fp-title]');
  const routeEl = q<HTMLElement>(root, '[data-fp-route]');
  const verdictEl = q<HTMLElement>(root, '[data-fp-verdict]');
  const stampEl = q<HTMLElement>(root, '[data-fp-stamp]');
  const noteEl = q<HTMLElement>(root, '[data-fp-note]');
  const actions = q<HTMLElement>(root, '[data-fp-actions]');
  const watchLink = q<HTMLAnchorElement>(root, '[data-fp-watch]');
  const shareBtn = q<HTMLButtonElement>(root, '[data-fp-share]');
  const shareStatus = q<HTMLElement>(root, '[data-fp-share-status]');
  const lookup = q<HTMLElement>(root, '[data-fp-lookup]');
  const trip = q<HTMLElement>(root, '[data-fp-trip]');
  const cards = q<HTMLElement>(root, '[data-fp-cards]');
  const support = q<HTMLElement>(root, '[data-fp-support]');
  const historyCard = q<HTMLElement>(root, '[data-fp-history]');
  const aircraftCard = q<HTMLElement>(root, '[data-fp-aircraft]');
  const readCard = q<HTMLElement>(root, '[data-fp-read]');

  const { raw, parsed } = identFromLocation();
  const ident = parsed?.ident || '';
  let payload: Payload | null = null;
  let live: any = null;
  let lastLoad = 0;
  let loading = false;
  let currentView: View | null = null;

  const setVerdict = (parts: { text: string; tone?: string | null }[]) => {
    if (!verdictEl) return;
    verdictEl.replaceChildren(
      ...parts.map((p) => (p.tone ? el('span', (TONE_TEXT as Record<string, string>)[p.tone] || '', p.text) : document.createTextNode(p.text))),
    );
  };

  // ── Lookup (no flight in the address, one that is not a flight number, or one we do not have) ──
  const lookupError = q<HTMLElement>(root, '[data-fp-lookup-error]');
  const lookupInput = q<HTMLInputElement>(root, '[data-fp-lookup-form] input');
  const go = () => {
    const next = parseFlightIdent(lookupInput?.value || '');
    if (!next) {
      if (lookupError) {
        lookupError.textContent = 'That is not a United flight number. Try one like UA929 or 5103.';
        lookupError.hidden = false;
      }
      lookupInput?.focus();
      return;
    }
    window.location.assign(flightPagePath(next.ident));
  };
  q<HTMLButtonElement>(root, '[data-fp-lookup-go]')?.addEventListener('click', go);
  lookupInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      go();
    }
  });
  const showLookup = () => {
    root.dataset.state = raw && !parsed ? 'invalid' : 'lookup';
    if (lookup) lookup.hidden = false;
    if (raw && !parsed) {
      setVerdict([{ text: `"${raw.slice(0, 24)}" is not a United flight number. Try one like UA929.` }]);
    }
  };

  // ── Painting ──
  const paintTrip = (view: View) => {
    if (!trip) return;
    const t = view.trip;
    if (!t) {
      trip.hidden = true;
      return;
    }
    const f = (name: string) => q<HTMLElement>(trip, `[data-f="${name}"]`);
    f('origin')!.textContent = t.origin.code;
    f('origin-city')!.textContent = t.origin.city;
    f('origin-time')!.textContent = t.origin.time;
    f('dest')!.textContent = t.dest.code;
    f('dest-city')!.textContent = t.dest.city;
    f('dest-time')!.textContent = t.dest.time;
    const fill = f('track-fill');
    const dot = f('track-dot');
    const note = f('track-note');
    const track = f('track');
    if (t.progress) {
      const pct = `${(t.progress.fraction * 100).toFixed(1)}%`;
      if (fill) fill.style.width = pct;
      if (dot) {
        dot.style.left = pct;
        dot.hidden = false;
      }
      if (note) note.textContent = t.progress.note;
      track?.setAttribute('role', 'img');
      track?.setAttribute('aria-label', `About ${Math.round(t.progress.fraction * 100)}% of the way (${t.progress.source === 'live' ? 'live position' : 'estimated from the clock'})`);
    } else {
      if (fill) fill.style.width = '0';
      if (dot) dot.hidden = true;
      if (note) note.textContent = '';
      track?.removeAttribute('role');
      track?.removeAttribute('aria-label');
    }
    const list = f('timeline');
    const template = q<HTMLTemplateElement>(trip, 'template[data-fp-step]');
    if (list && template) {
      replaceChildrenKeepingFocus(
        list,
        t.steps.map((step) => {
          const li = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
          li.classList.replace('border-border', STEP_CLASSES[step.state]);
          q<HTMLElement>(li, '[data-f="time"]')!.textContent = step.time;
          const label = q<HTMLElement>(li, '[data-f="label"]')!;
          // "Aircraft arrived from Tulsa (UA5442)": the inbound flight's number links to its page.
          label.replaceChildren(
            ...splitFlightIdents(step.label).map((part) => {
              if (!part.href || part.href === flightPagePath(ident)) return document.createTextNode(part.text);
              const a = el('a', STEP_FLIGHT_LINK, part.text) as HTMLAnchorElement;
              a.href = part.href;
              return a;
            }),
          );
          if (step.state === 'now') label.prepend(srOnly('Now: '));
          return li;
        }),
      );
    }
    trip.hidden = false;
  };

  const paintHistory = (view: View) => {
    if (!historyCard) return;
    const h = view.history;
    if (!h) {
      historyCard.hidden = true;
      return;
    }
    const f = (name: string) => q<HTMLElement>(historyCard, `[data-f="${name}"]`);
    f('title')!.textContent = h.title;
    f('route')!.textContent = h.routeLabel;
    const strip = f('strip') as HTMLOListElement;
    const template = q<HTMLTemplateElement>(historyCard, 'template[data-fp-day]');
    if (strip && template) {
      strip.setAttribute('aria-label', h.stripLabel || 'No days recorded yet');
      strip.replaceChildren(
        ...h.days.map((day) => {
          const li = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
          li.className = `${li.className} ${day.cls}`;
          li.title = day.sr;
          q<HTMLElement>(li, '[data-f="glyph"]')!.textContent = day.glyph;
          q<HTMLElement>(li, '[data-f="sr"]')!.textContent = day.sr;
          return li;
        }),
      );
      strip.hidden = h.days.length === 0;
    }
    const key = f('key');
    key?.replaceChildren(
      ...h.key.map((k) => {
        const item = el('li', 'inline-flex items-center gap-1');
        const swatch = el('span', `inline-flex size-3.5 items-center justify-center rounded-sm border text-[11px] leading-none ${k.cls}`, k.glyph);
        item.append(swatch, document.createTextNode(`${k.count} ${k.label}`));
        return item;
      }),
    );
    f('count')!.textContent = h.count;
    const typical = f('typical')!;
    typical.textContent = h.typical;
    typical.hidden = !h.typical;
    f('note')!.textContent = h.note;
    historyCard.hidden = false;
  };

  const paintAircraft = (view: View) => {
    if (!aircraftCard) return;
    const a = view.aircraft;
    if (!a) {
      aircraftCard.hidden = true;
      return;
    }
    const f = (name: string) => q<HTMLElement>(aircraftCard, `[data-f="${name}"]`);
    f('reg')!.textContent = a.reg;
    f('summary')!.textContent = a.summary;
    const wifi = f('wifi')!;
    if (a.wifi) {
      f('wifi-text')!.textContent = a.wifi.text;
      const icon = aircraftCard.querySelector<SVGElement>('[data-f="starlink-icon"]');
      if (icon) icon.style.display = a.wifi.starlink ? '' : 'none';
      wifi.hidden = false;
    } else {
      wifi.hidden = true;
    }
    const bar = f('cabin-bar')!;
    bar.replaceChildren(
      ...a.cabins.map((c) => {
        const seg = el('span', 'h-full');
        seg.style.flexGrow = String(c.count);
        seg.style.flexBasis = '0';
        seg.style.backgroundColor = c.color;
        return seg;
      }),
    );
    bar.hidden = a.cabins.length === 0;
    f('cabins')!.textContent = a.cabinLine;
    const legsBlock = f('legs-block')!;
    const legs = f('legs')!;
    const template = q<HTMLTemplateElement>(aircraftCard, 'template[data-fp-leg]');
    if (template) {
      replaceChildrenKeepingFocus(
        legs,
        a.legs.map((leg) => {
          const li = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
          // The aircraft's other flights link to their pages; this page's own number stays text.
          setFlightLink(q<HTMLElement>(li, '[data-f="flight"]')!, leg.flight, ident);
          q<HTMLElement>(li, '[data-f="route"]')!.textContent = `${leg.origin} → ${leg.dest}`;
          const result = q<HTMLElement>(li, '[data-f="result"]')!;
          result.textContent = leg.result;
          result.className = `${result.className} ${leg.tone ? (TONE_TEXT as Record<string, string>)[leg.tone] : 'text-muted-foreground'}`;
          return li;
        }),
      );
    }
    legsBlock.hidden = a.legs.length === 0;
    f('note')!.textContent = a.note;
    aircraftCard.hidden = false;
  };

  const paintRead = (view: View) => {
    if (!readCard) return;
    const r = view.read;
    if (!r) {
      readCard.hidden = true;
      return;
    }
    q<HTMLElement>(readCard, '[data-f="intro"]')!.textContent = r.intro;
    q<HTMLElement>(readCard, '[data-f="ask-block"]')!.hidden = !r.eligible;
    readCard.hidden = false;
  };

  const paintWatch = (view: View) => {
    if (!watchLink || !view.watch) return;
    watchLink.href = watchLinkHref(view.watch);
    const watched = readWatched(storage() ?? { getItem: () => null }).some((e: { flight: string }) => e.flight === view.watch!.flight);
    const label = q<HTMLElement>(watchLink, '[data-f="watch-label"]');
    if (label) label.textContent = watched ? 'Watching: open My Flights' : 'Watch this flight';
  };

  /**
   * The support line for today's state (src/lib/cover-a-day.js flightPageSupportCopy), once per
   * page view: "No one has covered today yet. …" + "Cover today · $17", or "Today is covered,
   * thanks to Dana R." + "Cover tomorrow · $17". A link that names a day goes to the fixed $17
   * link (coverButtonHref, for the link's own `data-support` label, which never changes). A failed
   * or unconfigured status leaves the page's own words and link.
   */
  let supportFramed = false;
  const frameSupport = async () => {
    if (supportFramed || !support) return;
    supportFramed = true;
    try {
      const [{ parseSupportStatus, flightPageSupportCopy, coverButtonHref }, json] = await Promise.all([
        import('../lib/cover-a-day.js'),
        getJson('/api/support-status').catch(() => null),
      ]);
      const status = parseSupportStatus(json, Date.now());
      if (!status.configured) return;
      const copy = flightPageSupportCopy(status);
      const text = q<HTMLElement>(support, '[data-f="support-text"]');
      const link = q<HTMLElement>(support, '[data-f="support-link"]');
      const anchor = link?.closest<HTMLAnchorElement>('a[data-support]');
      if (!text || !link || !anchor) return;
      text.textContent = copy.text;
      link.textContent = copy.link;
      anchor.href = coverButtonHref(status, anchor.getAttribute('data-support') || 'flight-page');
    } catch {
      /* the page's own words stay */
    }
  };

  const render = () => {
    if (!payload) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const view = flightPageView(payload, nowSec, { live });
    currentView = view;
    if (title) title.textContent = ident;
    if (routeEl) routeEl.textContent = view.routeLine;
    setVerdict(view.verdict.parts);
    if (stampEl) stampEl.textContent = view.stamp;
    if (noteEl) {
      noteEl.textContent = view.note || '';
      noteEl.hidden = !view.note;
    }
    // A flight we do not have: offer to look up another, right here.
    if (lookup) lookup.hidden = view.status === 'ok';
    if (actions) actions.hidden = false;
    if (watchLink) watchLink.hidden = !view.watch;
    paintWatch(view);
    paintTrip(view);
    paintHistory(view);
    paintAircraft(view);
    paintRead(view);
    if (cards) cards.hidden = !(view.history || view.aircraft || view.read);
    if (support) {
      support.hidden = false;
      void frameSupport();
    }
    root.dataset.state = view.status === 'ok' ? 'live' : view.status;
    document.title = view.status === 'ok' && view.trip
      ? `${ident} ${view.trip.origin.code} to ${view.trip.dest.code}: ${view.verdict.status.map((p) => p.text).join('')} | The Blue Board`
      : document.title;
  };

  /** The live-feed row for this leg, only while it is in the air (one shared CDN object). */
  const loadLive = async () => {
    const view = currentView;
    if (!view || view.status !== 'ok' || view.state !== 'in-air' || !view.trip) {
      live = null;
      return;
    }
    try {
      const flights = parseFr24Feed(await getJson('/api/fr24-feed?airline=UAL'));
      const row = findLiveFlight(flights, ident);
      live = row && liveFlightMatchesLeg(row, view.trip.origin.code, view.trip.dest.code) ? row : null;
    } catch {
      live = null;
    }
  };

  const load = async () => {
    if (loading || !ident) return;
    loading = true;
    try {
      const next = (await getJson(`/api/flight?ident=${encodeURIComponent(ident)}`)) as Payload;
      // A failed refresh never blanks a flight already on screen.
      if (next?.status === 'ok' || !payload || payload.status !== 'ok') payload = next;
      lastLoad = Date.now();
    } catch {
      if (!payload) {
        payload = { v: 1, ident, status: 'unavailable' };
      }
    } finally {
      loading = false;
    }
    render();
    await loadLive();
    if (live) render();
  };

  // ── Actions ──
  shareBtn?.addEventListener('click', async () => {
    const url = `${window.location.origin}${flightPagePath(ident)}`;
    const text = currentView?.verdict?.text || `${ident} flight status`;
    const say = (message: string) => {
      if (shareStatus) shareStatus.textContent = message;
    };
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${ident} on The Blue Board`, text, url });
        say('');
        return;
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied.');
    } catch {
      say(`Copy this link: ${url}`);
    }
  });

  const readAsk = readCard ? q<HTMLButtonElement>(readCard, '[data-f="ask"]') : null;
  readAsk?.addEventListener('click', async () => {
    if (!payload || payload.status !== 'ok' || !readCard) return;
    const label = q<HTMLElement>(readCard, '[data-f="ask-label"]');
    const riskEl = q<HTMLElement>(readCard, '[data-f="risk"]')!;
    const answer = q<HTMLElement>(readCard, '[data-f="answer"]')!;
    readAsk.disabled = true;
    if (label) label.textContent = 'Asking…';
    try {
      const [{ buildFlightRead, readInputUrls, riskLine }, { currentFaaAirports, faaAnswerAsOf }] = await Promise.all([
        import('../lib/flight-page-read.js'),
        import('../lib/faa-freshness.js'),
      ]);
      const urls = readInputUrls();
      const settle = (url: string) => getJson(url).catch(() => null);
      // /api/faa may serve its last good answer up to 30 min old (X-BB-FAA-Stale). The dashboard's
      // rule applies here too: an old answer's programs are not current, so they never reach the
      // score or the model (src/lib/faa-freshness.js).
      const settleFaa = async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(urls.faa, { signal: controller.signal, headers: { Accept: 'application/json' } });
          if (!res.ok) return null;
          const now = Date.now();
          const asOf = faaAnswerAsOf(now, res.headers.get('X-BB-FAA-Stale'), res.headers.get('Age'));
          return currentFaaAirports(await res.json(), asOf, now);
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      };
      const [faa, nas, irops, metar] = await Promise.all([settleFaa(), settle(urls.nas), settle(urls.irops), settle(urls.metar)]);
      const { risk, body } = buildFlightRead(payload.leg.row, {
        hub: payload.leg.hub,
        dir: payload.leg.dir,
        ident,
        nowMs: Date.now(),
        bodies: { faa, nas, irops, metar },
      });
      if (!risk || !body) {
        answer.textContent = 'The board has no delay prediction for this flight right now, so there is nothing for the AI to explain.';
        answer.hidden = false;
        return;
      }
      riskEl.textContent = riskLine(risk);
      riskEl.hidden = false;
      const res = await fetch('/api/delay-explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      answer.textContent = res.ok && data?.explanation ? String(data.explanation) : 'The AI read is not available right now. The board risk above still stands.';
      answer.hidden = false;
    } catch {
      answer.textContent = 'The AI read is not available right now.';
      answer.hidden = false;
    } finally {
      readAsk.disabled = false;
      if (label) label.textContent = 'Ask again';
    }
  });

  // ── Start ──
  if (!ident) {
    showLookup();
  } else {
    root.dataset.state = 'loading';
    if (title) title.textContent = ident;
    if (verdictEl) setVerdict([{ text: `Loading the latest on ${ident}…` }]);
    void load();
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
      else render();
      start();
    });
    if (!document.hidden) start();
  }
}

export {};
