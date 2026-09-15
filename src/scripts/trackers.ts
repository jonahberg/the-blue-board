import { STORAGE_KEYS } from '../app/state/storage';
/**
 * Tracker pages (`/trackers/*`) — search filter, table sort, map inspector card,
 * watch list and share.
 *
 * Bundled by Astro under `_astro/` so the CSP can keep `script-src 'self'` with no
 * inline scripts. Progressive enhancement only: with this module blocked the pages
 * remain complete static documents. No `innerHTML` anywhere — visibility toggles,
 * text writes and node moves only.
 *
 * Ported verbatim in behaviour from the old `public/js/trackers.js`.
 */

interface TrackerChange {
  date: string;
  entry: string;
}

interface TrackerEntity {
  label: string;
  summary: string;
  href: string;
}

interface TrackerConfig {
  slug?: string;
  kind?: string;
  lastUpdated?: string;
  lastVerified?: string;
  changes?: TrackerChange[];
  entities?: Record<string, TrackerEntity>;
}

/** Persisted shape of `localStorage.bb_tracker_watches`. */
interface TrackerWatch {
  slug: string;
  id: string;
  label?: string;
  addedAt?: string;
}

const WATCH_KEY = STORAGE_KEYS.trackerWatches;

/** `Element.closest` from an event target that may be a text node or null. */
function closestFrom(target: EventTarget | null, selector: string): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

function run(): void {
  if (!document.querySelector('[data-trk-page]')) return;

  /* ---------- search ---------- */
  const searchWrap = document.querySelector<HTMLElement>('[data-trk-search-wrap]');
  const searchInput = document.querySelector<HTMLInputElement>('[data-trk-search]');
  const countEl = document.querySelector<HTMLElement>('[data-trk-count]');
  const emptyEl = document.querySelector<HTMLElement>('[data-trk-empty]');

  function normalize(value: string): string {
    return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function applyFilter(query: string): void {
    const q = normalize(query);
    const rows = document.querySelectorAll<HTMLElement>('[data-trk-row]');
    /* When the page renders the same entity in two surfaces (cards + table), only
       rows marked data-trk-count-item are tallied; pages with a single surface
       mark none and every row counts. */
    const hasCountItems = !!document.querySelector('[data-trk-row][data-trk-count-item]');
    let visible = 0;
    for (const row of rows) {
      const hay = row.getAttribute('data-trk-search-text') || '';
      const show = q === '' || hay.indexOf(q) !== -1;
      row.hidden = !show;
      if (show && (!hasCountItems || row.hasAttribute('data-trk-count-item'))) visible++;
    }
    /* Collapse hub groups whose every row is hidden. */
    const groups = document.querySelectorAll<HTMLElement>('[data-trk-group]');
    for (const group of groups) {
      group.hidden = !group.querySelector('[data-trk-row]:not([hidden])');
    }
    if (countEl) {
      const noun = countEl.getAttribute('data-trk-noun') || 'results';
      const countedNoun = visible === 1 && /s$/.test(noun) ? noun.slice(0, -1) : noun;
      countEl.textContent = q === '' ? '' : visible + ' ' + countedNoun;
    }
    const heading = document.querySelector<HTMLElement>('[data-trk-result-heading]');
    if (heading) {
      const allLabel = heading.getAttribute('data-trk-heading-all') || heading.textContent || '';
      const headingNoun = heading.getAttribute('data-trk-heading-noun') || 'result';
      heading.textContent =
        q === '' ? allLabel : visible + ' matching ' + headingNoun + (visible === 1 ? '' : 's');
    }
    if (emptyEl) emptyEl.hidden = !(q !== '' && visible === 0);
  }

  if (searchInput) {
    if (searchWrap) searchWrap.hidden = false;
    searchInput.addEventListener('input', () => {
      applyFilter(searchInput.value);
    });
  }

  /* ---------- table sort ---------- */
  function sortValue(td: Element | undefined): string {
    const value = td ? td.getAttribute('data-sort') : '';
    return value === null || value === undefined ? '' : value;
  }

  function makeComparator(colIndex: number, dir: 'asc' | 'desc') {
    return (a: HTMLTableRowElement, b: HTMLTableRowElement): number => {
      const av = sortValue(a.children[colIndex]);
      const bv = sortValue(b.children[colIndex]);
      /* Empties always sink to the bottom regardless of direction. */
      if (av === '' && bv === '') return 0;
      if (av === '') return 1;
      if (bv === '') return -1;
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      let cmp: number;
      if (!isNaN(an) && !isNaN(bn) && String(an) === av && String(bn) === bv) {
        cmp = an - bn;
      } else {
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      return dir === 'desc' ? -cmp : cmp;
    };
  }

  document.addEventListener('click', (ev: MouseEvent) => {
    const th = closestFrom(ev.target, 'th[data-trk-sort]');
    if (!th) return;
    const table = th.closest('table');
    const tbody = table ? table.querySelector('[data-trk-tbody]') : null;
    const headerRow = th.parentElement;
    if (!table || !tbody || !headerRow) return;

    const headers = table.querySelectorAll('th[data-trk-sort]');
    const current = th.getAttribute('aria-sort');
    for (const header of headers) header.setAttribute('aria-sort', 'none');
    const dir: 'asc' | 'desc' = current === 'ascending' ? 'desc' : 'asc';
    th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');

    const colIndex = Array.prototype.indexOf.call(headerRow.children, th);
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.sort(makeComparator(colIndex, dir));
    for (const row of rows) tbody.appendChild(row);
  });

  /* ---------- map inspector card ---------- */
  const cardSlot = document.querySelector<HTMLElement>('[data-trk-card-slot]');
  const cardHint = document.querySelector<HTMLElement>('[data-trk-card-hint]');
  let activeCard: HTMLElement | null = null;

  function showCard(id: string): void {
    if (!cardSlot) return;
    if (activeCard) activeCard.hidden = true;
    const next = cardSlot.querySelector<HTMLElement>('[data-trk-card="' + id + '"]');
    if (next) {
      if (cardHint) cardHint.hidden = true;
      next.hidden = false;
      activeCard = next;
    }
  }

  function markerId(target: EventTarget | null): string | null {
    const marker = closestFrom(target, '[data-trk-marker]');
    return marker ? marker.getAttribute('data-trk-marker') : null;
  }

  const mapEl = document.querySelector<HTMLElement>('[data-trk-map]');
  if (mapEl && cardSlot) {
    for (const type of ['mouseover', 'focusin', 'click'] as const) {
      mapEl.addEventListener(type, (ev: Event) => {
        const id = markerId(ev.target);
        if (id) showCard(id);
      });
    }
    mapEl.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const id = markerId(ev.target);
      if (id) {
        ev.preventDefault();
        showCard(id);
      }
    });
  }

  /* ---------- return loop, personalization, watch + share ---------- */
  const pageSlug = document.body.getAttribute('data-trk-page') || '';

  function readWatches(): TrackerWatch[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((watch): watch is TrackerWatch => {
        if (!watch || typeof watch !== 'object') return false;
        const candidate = watch as Partial<TrackerWatch>;
        return typeof candidate.slug === 'string' && typeof candidate.id === 'string';
      });
    } catch {
      return [];
    }
  }

  function saveWatches(watches: TrackerWatch[]): void {
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(watches.slice(0, 50)));
    } catch {
      /* Private mode or a full quota must never break the static page. */
    }
  }

  function isWatched(id: string): boolean {
    return readWatches().some((watch) => watch.slug === pageSlug && watch.id === id);
  }

  function syncWatchButtons(): void {
    const buttons = document.querySelectorAll<HTMLElement>(
      '[data-trk-watch], [data-trk-pulse-watch]'
    );
    for (const button of buttons) {
      const id = button.getAttribute('data-trk-watch-id');
      if (!id) continue;
      const active = isWatched(id);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.textContent = active
        ? 'Watching'
        : button.hasAttribute('data-trk-pulse-watch')
          ? 'Watch this ' + (button.getAttribute('data-trk-watch-kind') || 'place')
          : 'Watch';
    }
    const pulse = document.querySelector<HTMLElement>('[data-trk-pulse-watch]');
    const status = document.querySelector<HTMLElement>('[data-trk-watch-status]');
    if (
      pulse &&
      status &&
      pulse.getAttribute('data-trk-watch-id') &&
      pulse.getAttribute('aria-pressed') === 'true'
    ) {
      status.textContent = 'Changes highlighted on return';
    }
  }

  function toggleWatch(id: string, label: string): void {
    const watches = readWatches();
    const index = watches.findIndex((watch) => watch.slug === pageSlug && watch.id === id);
    let active: boolean;
    if (index >= 0) {
      watches.splice(index, 1);
      active = false;
    } else {
      watches.push({ slug: pageSlug, id, label: label || id, addedAt: new Date().toISOString() });
      active = true;
    }
    saveWatches(watches);
    syncWatchButtons();
    const status = document.querySelector<HTMLElement>('[data-trk-watch-status]');
    if (status) status.textContent = active ? 'Changes highlighted on return' : 'Watch removed';
  }

  function fmtDay(iso: string): string {
    try {
      return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  const configEl = document.querySelector<HTMLElement>('[data-trk-config]');
  if (configEl) {
    try {
      const config: TrackerConfig = JSON.parse(configEl.textContent || '{}');
      const seenKey = 'bb_tracker_seen_' + config.slug;
      const lastSeen = localStorage.getItem(seenKey) || '';
      const delta = document.querySelector<HTMLElement>('[data-trk-delta]');
      const unseen = lastSeen
        ? (config.changes || []).filter((change) => change.date > lastSeen.slice(0, 10))
        : [];
      if (delta && lastSeen) {
        delta.textContent = unseen.length
          ? unseen.length +
            ' change' +
            (unseen.length === 1 ? '' : 's') +
            ' since your last visit. ' +
            unseen[0].entry
          : 'No changes since ' +
            fmtDay(lastSeen.slice(0, 10)) +
            '. Sources rechecked ' +
            fmtDay(config.lastVerified || '') +
            '.';
      }

      const home = (localStorage.getItem(STORAGE_KEYS.homeAirport) || '').toUpperCase();
      const entity = config.entities ? config.entities[home] : undefined;
      const personal = document.querySelector<HTMLElement>('[data-trk-personal]');
      const personalEmpty = document.querySelector<HTMLElement>('[data-trk-personal-empty]');
      const pulseWatch = document.querySelector<HTMLElement>('[data-trk-pulse-watch]');
      if (entity && personal) {
        personal.hidden = false;
        if (personalEmpty) personalEmpty.hidden = true;
        const codeEl = personal.querySelector<HTMLElement>('[data-trk-personal-code]');
        const summaryEl = personal.querySelector<HTMLElement>('[data-trk-personal-summary]');
        const linkEl = personal.querySelector<HTMLAnchorElement>('[data-trk-personal-link]');
        if (codeEl) codeEl.textContent = entity.label;
        if (summaryEl) summaryEl.textContent = entity.summary;
        if (linkEl) linkEl.href = entity.href;
        if (pulseWatch) {
          pulseWatch.hidden = false;
          pulseWatch.setAttribute('data-trk-watch-id', home.toLowerCase());
          pulseWatch.setAttribute('data-trk-watch-label', entity.label);
          pulseWatch.setAttribute('data-trk-watch-kind', config.kind || 'place');
        }
      }
      try {
        localStorage.setItem(seenKey, new Date().toISOString());
      } catch {
        /* Nothing to do — the briefing simply stays on its build-time copy. */
      }
    } catch {
      /* A malformed enhancement config must never hide the static tracker. */
    }
  }

  syncWatchButtons();

  document.addEventListener('click', (ev: MouseEvent) => {
    const watch = closestFrom(ev.target, '[data-trk-watch], [data-trk-pulse-watch]');
    if (watch) {
      toggleWatch(
        watch.getAttribute('data-trk-watch-id') || '',
        watch.getAttribute('data-trk-watch-label') || ''
      );
      return;
    }
    const share = closestFrom(ev.target, '[data-trk-share]');
    if (!share) return;
    const href = share.getAttribute('data-trk-share-href') || location.pathname;
    const url = new URL(href, location.origin).toString();
    const label = share.getAttribute('data-trk-share-label') || document.title;
    if (navigator.share) {
      navigator.share({ title: label, url }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => {
          const before = share.textContent;
          share.textContent = 'Copied';
          setTimeout(() => {
            share.textContent = before;
          }, 1600);
        })
        .catch(() => {});
    }
  });
}

run();

export {};
