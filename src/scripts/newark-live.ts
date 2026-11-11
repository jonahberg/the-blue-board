/**
 * Live status widget for `/newark` (formerly `public/js/newark-live.js`).
 *
 * Bundled by Astro from a relative `<script src>` in `newark.astro`, so
 * Content-Security-Policy keeps `script-src 'self'` with no inline script.
 *
 * Two feeds: `/api/fr24-feed` (active UA flights at EWR) and `/api/faa`
 * (current FAA program status for EWR — ground stop / ground delay / departure
 * delay). Targets `#newark-active`, `#newark-program-status` and
 * `#newark-updated-time`.
 *
 * `/api/faa` can answer with its last good answer (`X-BB-FAA-Stale`, up to 30 min
 * old). The same rules as the dashboard apply (src/lib/faa-freshness.js): a
 * program past its own end time is dropped, and an answer past the age limit is
 * reported as "FAA status as of …", never as a current program or as a confirmed
 * "no program".
 */

import { faaAnswerAsOf, FAA_STALE_AFTER_MS, withoutExpiredPrograms } from '../lib/faa-freshness.js';

const IATA = 'EWR';

/** FR24's feed is served either as an array or as a keyed object of rows. */
type FeedRow = unknown[] | { origin?: string; dest?: string };

interface FaaProgram {
  type?: string;
  reason?: string;
  avgDelay?: number | string;
}

interface FaaAirport {
  airportCode?: string;
  programs?: FaaProgram[];
}

const PROGRAM_LABELS: Record<string, string> = {
  ground_stop: 'Ground Stop',
  ground_delay: 'Ground Delay Program',
  departure_delay: 'Departure Delay',
  arrival_delay: 'Arrival Delay',
  closure: 'Closure',
};

const clockLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

const setUpdated = () => {
  const updated = document.getElementById('newark-updated-time');
  if (updated) {
    updated.textContent = `Updated ${clockLabel(Date.now())}`;
  }
};

const loadFlights = async () => {
  try {
    const response = await fetch('/api/fr24-feed?airline=UAL');
    if (!response.ok) throw new Error('Feed unavailable');

    const payload = await response.json();
    const feed = payload?.result?.response?.data ?? payload;
    const rows: FeedRow[] = Array.isArray(feed)
      ? feed
      : typeof feed === 'object' && feed !== null
        ? Object.values(feed)
        : [];

    let active = 0;
    for (const row of rows) {
      const origin = Array.isArray(row) ? row[11] : row?.origin;
      const dest = Array.isArray(row) ? row[12] : row?.dest;
      if (origin === IATA || dest === IATA) active += 1;
    }

    const activeEl = document.getElementById('newark-active');
    if (activeEl) activeEl.textContent = String(active);
    setUpdated();
  } catch {
    const activeEl = document.getElementById('newark-active');
    if (activeEl) activeEl.textContent = '—';
    const updated = document.getElementById('newark-updated-time');
    if (updated) updated.textContent = 'Live data temporarily unavailable';
  }
};

const loadProgram = async () => {
  const statusEl = document.getElementById('newark-program-status');
  if (!statusEl) return;

  try {
    const response = await fetch('/api/faa');
    if (!response.ok) throw new Error('FAA feed unavailable');

    const now = Date.now();
    const asOf = faaAnswerAsOf(now, response.headers.get('X-BB-FAA-Stale'), response.headers.get('Age'));
    const payload = await response.json();
    if (now - asOf > FAA_STALE_AFTER_MS) {
      // An old answer proves neither a program nor the absence of one.
      statusEl.textContent = `FAA status as of ${clockLabel(asOf)}: not updated since, so no program is shown as current.`;
      return;
    }
    const list = withoutExpiredPrograms(Array.isArray(payload) ? payload : [], asOf, now).airports as FaaAirport[];
    const ewr = list.find((entry) => String(entry?.airportCode).toUpperCase() === IATA);

    if (!ewr?.programs?.length) {
      statusEl.textContent = 'No active FAA ground stop or delay program reported for EWR.';
      return;
    }

    statusEl.textContent = ewr.programs
      .map((program) => {
        const bits = [PROGRAM_LABELS[program.type ?? ''] || program.type];
        if (program.reason) bits.push(`— ${program.reason}`);
        if (program.avgDelay) bits.push(`(avg ${program.avgDelay} min)`);
        return bits.join(' ');
      })
      .join(' · ');
  } catch {
    statusEl.textContent = 'Live program status temporarily unavailable';
  }
};

const loadAll = () => {
  void loadFlights();
  void loadProgram();
};

// Poll every 30s, but only while the tab is visible (the pattern hub-board.ts also follows).
let timer: ReturnType<typeof setInterval> | null = null;
const startPolling = () => {
  if (timer === null) timer = setInterval(loadAll, 30_000);
};
const stopPolling = () => {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    loadAll();
    startPolling();
  }
});

loadAll();
if (!document.hidden) startPolling();

export {};
