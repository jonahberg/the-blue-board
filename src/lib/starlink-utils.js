// ═══ STARLINK UTILITIES ═══
// Pure data functions for the STARLINK tab, extracted for testability (mirrors fleet-utils.js).

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Bucket Starlink aircraft into a continuous month-by-month installation series.
 *
 * @param {Array<{dateFound?: string, fleet?: string}>} aircraft - entries from /api/starlink-data
 * @param {Date} [nowDate] - "today"; the series always extends to this month
 * @returns {{ months: Array<{ym: string, label: string, express: number, mainline: number, total: number, cumulative: number}>, undated: number, total: number }}
 *
 * Rules:
 * - The series is continuous from the first install month to nowDate's month — months with zero
 *   installs are included so the time axis never lies.
 * - Aircraft whose dateFound is missing/unparseable are excluded from the bars and reported in
 *   `undated` (the chart footnote surfaces them).
 * - Labels are 'MMM' uppercase; the first month and every January carry a 2-digit year ('MAR 25').
 */
export function bucketInstallsByMonth(aircraft, nowDate = new Date()) {
  if (!Array.isArray(aircraft) || aircraft.length === 0) {
    return { months: [], undated: 0, total: 0 };
  }

  // Parse each aircraft's install month (UTC, from the YYYY-MM-DD prefix)
  const counts = new Map(); // ym -> {express, mainline}
  let undated = 0;
  let firstYm = null;

  for (const a of aircraft) {
    const raw = typeof a?.dateFound === 'string' ? a.dateFound.slice(0, 10) : '';
    const m = /^(\d{4})-(\d{2})/.exec(raw);
    if (!m || isNaN(Date.parse(raw))) { undated++; continue; }
    const ym = `${m[1]}-${m[2]}`;
    if (!counts.has(ym)) counts.set(ym, { express: 0, mainline: 0 });
    const bucket = counts.get(ym);
    if (String(a.fleet).toLowerCase() === 'mainline') bucket.mainline++;
    else bucket.express++;
    if (firstYm === null || ym < firstYm) firstYm = ym;
  }

  if (firstYm === null) {
    return { months: [], undated, total: aircraft.length };
  }

  // Walk a continuous range from firstYm to nowDate's month
  const endYear = nowDate.getUTCFullYear();
  const endMonth = nowDate.getUTCMonth(); // 0-based
  let [year, month] = firstYm.split('-').map(Number);
  month -= 1; // 0-based

  const months = [];
  let cumulative = 0;
  let isFirst = true;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
    const bucket = counts.get(ym) || { express: 0, mainline: 0 };
    const total = bucket.express + bucket.mainline;
    cumulative += total;

    const needsYear = isFirst || month === 0; // first month and every January
    const label = MONTH_LABELS[month] + (needsYear ? ' ' + String(year).slice(2) : '');

    months.push({ ym, label, express: bucket.express, mainline: bucket.mainline, total, cumulative });

    isFirst = false;
    month++;
    if (month > 11) { month = 0; year++; }
  }

  return { months, undated, total: aircraft.length };
}

const WEEK_MS = 7 * 86400000;
const WEEK_LABEL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monday-anchored ISO-week start (UTC midnight) for a millisecond timestamp.
function isoWeekStartUTC(ms) {
  const d = new Date(ms);
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // 0 = Mon … 6 = Sun
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dayOfWeek * 86400000;
}

// 'MMM D' label for a week-start timestamp (UTC), e.g. 'Jun 9'.
function weekStartLabel(ms) {
  const d = new Date(ms);
  return WEEK_LABEL_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
}

/**
 * Compute the rolling 12-week install-pace series for the STARLINK tab.
 *
 * IMPORTANT — data caveat baked into this function: `dateFound` is a *detection* date, not an
 * install date. A large share of the fleet shares one upstream backfill date (e.g. ~121 tails on
 * 2025-12-03), so any week can be a detection spike rather than a real install surge. We therefore:
 *   - only ever look at the trailing 12-week window (never an all-time cumulative line);
 *   - clamp the *bar height* of any week exceeding ~3× the trailing median to a ceiling and flag it
 *     `capped` (a backfill batch), while preserving the true `count` for the tooltip;
 *   - compute pace from the trailing COMPLETE weeks only (the current week is partial — detection
 *     systematically under-reads it — so it is excluded from both pace and the average framing), and
 *     clamp backfill weeks before averaging so one batch can't inflate the pace.
 *
 * @param {Array<{dateFound?: string}>} aircraft - entries from /api/starlink-data (STARLINK_DB)
 * @param {Date} [nowDate] - "today"; the window ends at this (partial) ISO week
 * @param {{remaining?: number, weeksWindow?: number, paceWindow?: number}} [opts]
 *        remaining: aircraft still to equip (e.g. Express remaining) → drives etaWeeks/etaDate
 * @returns {{
 *   weeks: Array<{start: number, label: string, count: number, barValue: number, capped: boolean}>,
 *   peak: number, thisWeek: number, pace: number, paceWeeks: number, dated: number,
 *   remaining: (number|null), etaWeeks: (number|null), etaDate: (Date|null)
 * }}
 */
export function computeInstallPace(aircraft, nowDate = new Date(), opts = {}) {
  const weeksWindow = opts.weeksWindow || 12;
  const paceWindow = opts.paceWindow || 8;
  const empty = {
    weeks: [], peak: 1, thisWeek: 0, pace: 0, paceWeeks: 0, dated: 0,
    remaining: null, etaWeeks: null, etaDate: null,
  };
  if (!Array.isArray(aircraft) || aircraft.length === 0) return empty;

  const currentWeekStart = isoWeekStartUTC(nowDate.getTime());

  // Tally every dated aircraft into its ISO week (whole fleet — `dated` drives the degraded guard).
  const counts = new Map(); // weekStart(ms) -> count
  let dated = 0;
  for (const a of aircraft) {
    const raw = typeof a?.dateFound === 'string' ? a.dateFound.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    const t = Date.parse(raw);
    if (isNaN(t)) continue;
    dated++;
    const ws = isoWeekStartUTC(t);
    counts.set(ws, (counts.get(ws) || 0) + 1);
  }
  if (dated === 0) return empty;

  // Window anchors: oldest → current (partial) week.
  const starts = [];
  for (let i = weeksWindow - 1; i >= 0; i--) starts.push(currentWeekStart - i * WEEK_MS);
  const rawCounts = starts.map(s => counts.get(s) || 0);

  // Backfill clamp ceiling = 3× the median of the non-zero COMPLETE weeks (exclude current partial).
  const completeNonZero = rawCounts.slice(0, weeksWindow - 1).filter(c => c > 0).sort((a, b) => a - b);
  const median = completeNonZero.length
    ? completeNonZero[Math.floor((completeNonZero.length - 1) / 2)]
    : 0;
  const clampCeil = median > 0 ? median * 3 : Infinity;

  const weeks = starts.map((s, i) => {
    const count = rawCounts[i];
    const capped = count > clampCeil;
    return { start: s, label: weekStartLabel(s), count, barValue: capped ? clampCeil : count, capped };
  });
  const peak = Math.max(1, ...weeks.map(w => w.barValue));

  // Pace: mean of the trailing `paceWindow` COMPLETE weeks, backfill-clamped.
  const completeCounts = rawCounts.slice(0, weeksWindow - 1);
  const trailing = completeCounts.slice(-paceWindow);
  const trailingClamped = trailing.map(c => (clampCeil !== Infinity && c > clampCeil) ? clampCeil : c);
  const paceWeeks = trailing.length;
  const pace = paceWeeks ? trailingClamped.reduce((a, b) => a + b, 0) / paceWeeks : 0;

  let remaining = null, etaWeeks = null, etaDate = null;
  if (typeof opts.remaining === 'number' && opts.remaining > 0 && pace > 0) {
    remaining = opts.remaining;
    etaWeeks = Math.ceil(opts.remaining / pace);
    etaDate = new Date(currentWeekStart + etaWeeks * WEEK_MS);
  }

  return { weeks, peak, thisWeek: rawCounts[weeksWindow - 1], pace, paceWeeks, dated, remaining, etaWeeks, etaDate };
}

// ═══ HUB DEPARTURES BOARD ═══
// Time-bucket section labels, in render order. A departure's bucket is chosen by how far in the
// future it departs (negative deltas — the now-1800 grace window — fall into "WITHIN 1 HOUR").
export const DEPARTURE_BUCKETS = [
  { label: 'WITHIN 1 HOUR', maxSec: 3600 },
  { label: '1–3 HRS', maxSec: 3 * 3600 },
  { label: '3–12 HRS', maxSec: 12 * 3600 },
  { label: '12–48 HRS', maxSec: 48 * 3600 },
];

/** Pick the time-bucket label for a departure `deltaSec` seconds from now. */
export function departureBucketLabel(deltaSec) {
  for (const b of DEPARTURE_BUCKETS) if (deltaSec < b.maxSec) return b.label;
  return DEPARTURE_BUCKETS[DEPARTURE_BUCKETS.length - 1].label;
}

/**
 * Build a NOC hub departures board, 100% client-side, from the data already in memory.
 *
 * Flattens STARLINK_FLIGHTS_BY_TAIL into rows, joins each tail to its fleet entry (type/fleet/
 * operator) and to the live airborne map (status/icao24), then keeps only departures FROM a hub
 * within the [now - graceSec, now + windowSec] window, sorted ascending and grouped into time
 * buckets for rendering.
 *
 * @param {Record<string, Array<{flight_number?:string, origin?:string, destination?:string, departure_ts?:number, departure_time?:string, arrival_time?:string}>>} flightsByTail
 * @param {Record<string, {type?:string, fleet?:string, operator?:string}>} aircraftByTail - tail → fleet DB entry
 * @param {Record<string, {icao24?:string}>|Map<string,{icao24?:string}>} airborneByTail - tail → live flight (has icao24)
 * @param {string[]} hubCodes - hub IATA codes to include as origins
 * @param {{now?:number, windowSec?:number, graceSec?:number, hub?:(string|null), capPerHub?:number}} [opts]
 * @returns {{ hubCounts: Record<string,number>, allCount: number, totalInWindow: number, buckets: Array<{label:string, rows:object[]}>, shownCount: number, hiddenCount: number }}
 *   - hubCounts/allCount are computed over the window BEFORE the hub filter (so per-hub pills, incl.
 *     empty Pacific hubs at 0, render their true counts regardless of the active selection).
 *   - buckets/shownCount/hiddenCount reflect the active hub filter and the per-hub render cap.
 */
export function buildDeparturesBoard(flightsByTail, aircraftByTail, airborneByTail, hubCodes, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now() / 1000;
  const windowSec = typeof opts.windowSec === 'number' ? opts.windowSec : 12 * 3600;
  const graceSec = typeof opts.graceSec === 'number' ? opts.graceSec : 1800;
  const hub = opts.hub || null;
  const capPerHub = typeof opts.capPerHub === 'number' ? opts.capPerHub : Infinity;

  const hubList = Array.isArray(hubCodes) ? hubCodes : [];
  const hubSet = new Set(hubList);
  const hubCounts = {};
  for (const h of hubList) hubCounts[h] = 0;

  const lo = now - graceSec;
  const hi = now + windowSec;
  const lookupAir = (tail) =>
    airborneByTail && (typeof airborneByTail.get === 'function' ? airborneByTail.get(tail) : airborneByTail[tail]);

  // 1. flatten + 2. window/hub filter, joining each tail to its fleet entry + live status
  const rows = [];
  for (const tail of Object.keys(flightsByTail || {})) {
    const ac = (aircraftByTail && aircraftByTail[tail]) || null;
    const air = lookupAir(tail) || null;
    const flights = flightsByTail[tail] || [];
    for (const f of flights) {
      const ts = Number(f && f.departure_ts) || 0;
      if (!ts || ts < lo || ts > hi) continue;
      const origin = String((f && f.origin) || '').toUpperCase();
      if (!hubSet.has(origin)) continue;
      hubCounts[origin] = (hubCounts[origin] || 0) + 1; // count over window, pre-hub-filter
      if (hub && origin !== hub) continue;
      rows.push({
        tail,
        flight_number: String((f && f.flight_number) || ''),
        origin,
        destination: String((f && f.destination) || '').toUpperCase(),
        departure_ts: ts,
        departure_time: String((f && f.departure_time) || ''),
        arrival_time: String((f && f.arrival_time) || ''),
        type: ac ? String(ac.type || '') : '',
        fleet: ac ? String(ac.fleet || '') : '',
        operator: ac ? String(ac.operator || '') : '',
        airborne: !!air,
        icao24: air ? String(air.icao24 || '') : '',
        deltaSec: ts - now,
      });
    }
  }

  const allCount = hubList.reduce((s, h) => s + (hubCounts[h] || 0), 0);

  // 3. sort ascending by departure_ts
  rows.sort((a, b) => a.departure_ts - b.departure_ts);

  // 4. per-hub render cap (bounds the DOM in the 48h window); keep the earliest N per origin
  const perHubSeen = {};
  let hiddenCount = 0;
  const kept = [];
  for (const r of rows) {
    const c = (perHubSeen[r.origin] = (perHubSeen[r.origin] || 0) + 1);
    if (c > capPerHub) { hiddenCount++; continue; }
    kept.push(r);
  }

  // 5. group into time buckets (fixed order; only non-empty buckets are returned)
  const byLabel = new Map();
  for (const r of kept) {
    const label = departureBucketLabel(r.deltaSec);
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(r);
  }
  const buckets = [];
  for (const b of DEPARTURE_BUCKETS) {
    const list = byLabel.get(b.label);
    if (list && list.length) buckets.push({ label: b.label, rows: list });
  }

  return {
    hubCounts,
    allCount,
    totalInWindow: hub ? rows.length : allCount,
    buckets,
    shownCount: kept.length,
    hiddenCount,
  };
}
