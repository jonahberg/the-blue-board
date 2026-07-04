import { waitUntil } from '@vercel/functions';
import { HUB_TZ } from './irops.js';
import { icaoToIata, isInternationalRoute } from '../src/lib/airport-metadata.js';
import { getHubTerminal } from './_hubs.js';
import { hydrateAdbSpend, isAdbBudgetExhausted, recordAdbUnits, getAdbUnitsToday, getAdbDailyUnitBudget } from './_cost-state.js';

const AERODATABOX_BASE_URL = 'https://prod.api.market/api/v1/aedbx/aerodatabox';
// Each FIDS window request is billed at 2 units by the provider (1 board = 2 windows = 4 units).
const ADB_UNITS_PER_REQUEST = 2;
// Budget-exempt (cron-forced) calls still hit an absolute ceiling at 3x the organic budget so a
// leaked cron secret cannot spend unboundedly; the warm ring's own cadence keeps normal forced
// spend far below this.
const ADB_BYPASS_CEILING_MULTIPLIER = 3;

// The "budget exhausted" warning previously fired on every gated organic request — dozens/hour for
// ~11h/day once the budget trips, burying genuine warnings and inflating log-query latency. Throttle
// it to once per instance per UTC day (mirrors warnedAdbSchemaMissing in _cost-state.ts).
let lastBudgetWarnDay = '';

/** Test-only: clear the once-per-day warn throttle so per-test assertions start from a clean slate. */
export function __resetScheduleWarnsForTests(): void {
  lastBudgetWarnDay = '';
}

// Persist the spend write even if Vercel freezes the lambda right after the response is sent —
// a dropped RPC undercounts the cross-instance counter that IS the global spend ceiling.
function recordAdbUnitsDurable(units: number): void {
  const promise = recordAdbUnits(units);
  try {
    waitUntil(promise);
  } catch {
    // Outside a Vercel request context (tests, local scripts) waitUntil may throw; the promise
    // still runs to completion in-process.
  }
}

function partsToObj(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of parts) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}

function hubLocalDate(hub: string, ts: number): string {
  const tz = HUB_TZ[hub.toUpperCase()] || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts * 1000));
  const p = partsToObj(parts);
  return `${p.year}-${p.month}-${p.day}`;
}

function normalizeAirportCode(airport: any): string {
  const iata = String(airport?.iata || '').trim().toUpperCase();
  if (iata) return iata;
  return icaoToIata(String(airport?.icao || '').trim().toUpperCase());
}

function airportName(airport: any): string {
  return String(airport?.name || airport?.shortName || airport?.municipalityName || '').trim();
}

function normalizeFlightId(value: any): string {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function normalizeUnitedFlightNumber(number: any, callSign?: any): string {
  const primary = normalizeFlightId(number);
  const fallback = normalizeFlightId(callSign);
  const value = primary || fallback;
  if (!value) return '';
  const ual = /^UAL(\d+[A-Z]?)$/.exec(value);
  if (ual) return `UA${ual[1]}`;
  const ua = /^UA(\d+[A-Z]?)$/.exec(value);
  if (ua) return `UA${ua[1]}`;
  return value;
}

function toUnixDateTime(value: any): number | null {
  if (!value) return null;
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return toUnixDateTime(value.utc || value.local);
}

export function mapAeroStatus(status: any) {
  const s = String(status || '').trim();
  let text = 'scheduled';
  let type = '';
  let diverted = false;
  let live = false;
  let icon = '';

  if (s === 'Canceled') {
    type = 'canceled';
    text = 'canceled';
    icon = 'red';
  } else if (s === 'CanceledUncertain') {
    // SOFT state: the provider suspects a cancellation but has not confirmed it. Keep it
    // distinct from hard 'canceled' so classifySchedStatus can render "Likely Canceled" (warn)
    // instead of red Canceled — the UI used to show the raw string "Canceleduncertain".
    type = 'canceled_uncertain';
    text = 'canceled_uncertain';
    icon = 'yellow';
  } else if (s === 'Diverted') {
    diverted = true;
    text = 'landed';
    icon = 'red';
  } else if (s === 'Arrived') {
    text = 'landed';
    icon = 'green';
  } else if (s === 'EnRoute' || s === 'Approaching') {
    text = 'en-route';
    live = true;
    icon = 'green';
  } else if (s === 'Departed') {
    text = 'departed';
    live = true;
    icon = 'green';
  } else if (s === 'Delayed') {
    // Map to the dedicated 'delayed' key (schedule-status.js already classifies it): the old
    // generic 'estimated' mapping left the UI's "Delayed" filter permanently empty.
    text = 'delayed';
    icon = 'yellow';
  }

  return {
    generic: { status: { text, diverted }, type },
    text: s.toLowerCase(),
    icon,
    live,
  };
}

// ── Registration validation ──
// AeroDataBox occasionally puts an aircraft MODEL string in the reg field (observed live:
// reg "B737M9" on ORD board rows). Validate the shape and drop anything that is not a
// plausible tail number; the UI already renders a missing reg as "—".
//   - US N-number fast path: N + 1-5 digits (no leading zero) + up to 2 trailing letters.
//   - Hyphenated intl: 1-2 char country prefix, hyphen, 1-5 alphanumerics (C-FABC, B-1234, D-ABCD).
//   - Common hyphenless intl forms the provider emits without the hyphen: JA#### (Japan),
//     HL#### (Korea), B#### (exactly 4 digits, China/Taiwan — 3-digit/trailing-letter shapes
//     like "B788"/"B38M"/"B77W" are aircraft MODEL codes, not tails).
// A bare "letters+alnum" regex would pass "B737M9" (prefix B + 737M9), so hyphenless forms are
// allowlisted narrowly instead.
const REG_N_NUMBER = /^N[1-9]\d{0,4}[A-Z]{0,2}$/;
const REG_HYPHENATED = /^[A-Z0-9]{1,2}-[A-Z0-9]{1,5}$/;
const REG_HYPHENLESS_INTL = /^(JA\d{2,4}[A-Z]{0,2}|HL\d{4}|B\d{4})$/;

export function validateRegistration(raw: any): string | null {
  const reg = String(raw || '').trim().toUpperCase();
  if (!reg || reg.length > 8) return null;
  if (REG_N_NUMBER.test(reg) && reg.length <= 6) return reg;
  if (REG_HYPHENATED.test(reg)) return reg;
  if (REG_HYPHENLESS_INTL.test(reg)) return reg;
  return null;
}

function isUnitedFlight(flight: any): boolean {
  if (flight?.isCargo === true) return false;
  const airlineIata = normalizeFlightId(flight?.airline?.iata);
  const airlineIcao = normalizeFlightId(flight?.airline?.icao);
  const number = normalizeFlightId(flight?.number);
  const callSign = normalizeFlightId(flight?.callSign);
  return (
    airlineIata === 'UA' ||
    airlineIcao === 'UAL' ||
    /^UA\d/.test(number) ||
    /^UAL\d/.test(number) ||
    /^UAL\d/.test(callSign)
  );
}

function normalizeFlight(flight: any, hub: string, dir: string) {
  if (!isUnitedFlight(flight)) return null;

  const hubUpper = hub.toUpperCase();
  const isDeparture = dir === 'departures';
  const departure = flight?.departure;
  const arrival = flight?.arrival;
  const movement = flight?.movement;

  let originAirport = departure?.airport || (isDeparture && departure ? { iata: hubUpper, name: hubUpper } : null);
  let destinationAirport = arrival?.airport || (!isDeparture && arrival ? { iata: hubUpper, name: hubUpper } : null);
  let departureMovement = departure;
  let arrivalMovement = arrival;

  if (!departure && !arrival && movement) {
    if (isDeparture) {
      originAirport = { iata: hubUpper, name: hubUpper };
      destinationAirport = movement.airport;
      departureMovement = movement;
      arrivalMovement = null;
    } else {
      originAirport = movement.airport;
      destinationAirport = { iata: hubUpper, name: hubUpper };
      departureMovement = null;
      arrivalMovement = movement;
    }
  }

  const origIata = normalizeAirportCode(originAirport);
  const destIata = normalizeAirportCode(destinationAirport);
  if (isDeparture && origIata !== hubUpper) return null;
  if (!isDeparture && destIata !== hubUpper) return null;

  const flightNum = normalizeUnitedFlightNumber(flight?.number, flight?.callSign);
  if (!flightNum) return null;

  const schedDep = toUnixDateTime(departureMovement?.scheduledTime);
  const schedArr = toUnixDateTime(arrivalMovement?.scheduledTime);
  const revisedDep = toUnixDateTime(departureMovement?.revisedTime);
  const revisedArr = toUnixDateTime(arrivalMovement?.revisedTime);
  const runwayDep = toUnixDateTime(departureMovement?.runwayTime);
  const runwayArr = toUnixDateTime(arrivalMovement?.runwayTime);

  const status = String(flight?.status || '');
  const departedLike = ['Departed', 'EnRoute', 'Approaching', 'Arrived', 'Diverted'].includes(status);
  const arrivedLike = ['Arrived', 'Diverted'].includes(status);
  const realDep = departedLike ? (runwayDep || revisedDep) : null;
  const realArr = arrivedLike ? (runwayArr || revisedArr) : null;
  const estDep = !realDep ? (revisedDep || toUnixDateTime(departureMovement?.predictedTime)) : null;
  const estArr = !realArr ? (revisedArr || toUnixDateTime(arrivalMovement?.predictedTime)) : null;

  const origGate = String(departureMovement?.gate || '').trim();
  const destGate = String(arrivalMovement?.gate || '').trim();
  const origTerminalRaw = String(departureMovement?.terminal || '').trim();
  const destTerminalRaw = String(arrivalMovement?.terminal || '').trim();
  const intl = isInternationalRoute(origIata, destIata);
  const origTerminal = origTerminalRaw || getHubTerminal(origIata, intl);
  const destTerminal = destTerminalRaw || getHubTerminal(destIata, intl);

  return {
    identification: { number: { default: flightNum }, callsign: normalizeFlightId(flight?.callSign) },
    airline: { code: { iata: 'UA' }, name: flight?.airline?.name || 'United Airlines' },
    status: mapAeroStatus(status),
    time: {
      scheduled: { departure: schedDep, arrival: schedArr },
      real: { departure: realDep, arrival: realArr },
      estimated: { departure: estDep, arrival: estArr },
    },
    airport: {
      origin: {
        code: { iata: origIata },
        name: airportName(originAirport),
        info: { gate: origGate, terminal: origTerminal },
      },
      destination: {
        code: { iata: destIata },
        name: airportName(destinationAirport),
        info: { gate: destGate, terminal: destTerminal },
      },
    },
    aircraft: {
      model: { code: '', text: flight?.aircraft?.model || '' },
      registration: validateRegistration(flight?.aircraft?.reg) || '',
    },
    _source: {
      provider: 'aerodatabox',
      quality: [
        ...(departureMovement?.quality || []),
        ...(arrivalMovement?.quality || []),
        ...(movement?.quality || []),
      ],
    },
  };
}

// ── Board-level dedupe + foreign-row filter ──
// Observed live during the Jul 3 2026 ORD GDP:
//   (a) schedule REVISIONS produce two rows for one physical departure (the legacy dedupe key
//       includes the scheduled time, so a revised row survives it) — UA5982 counted both
//       "On Time" and "+2h48 Late"; 16 dup groups at ORD.
//   (b) operating-carrier CLONES: the same physical flight listed under both its UA marketing
//       ident and the United Express operator ident ("G7929 to LHR").
//   (c) clearly FOREIGN rows (NK/DL/AA idents) leaking through the codeshare filter (Spirit
//       NK3005 on the EWR board).
const UNITED_EXPRESS_CARRIERS = new Set(['OO', 'YV', 'YX', 'ZW', 'G7', 'C5', 'AX', 'EV']);
const OPERATOR_CLONE_TOLERANCE_S = 300; // "same time" window for SCHEDULED clone matching (±5 min)
// Real (runway/actual) timestamps are precise: two rows that both physically moved more than
// 2 min apart are two aircraft, not one flight under two idents — never collapse them.
const OPERATOR_CLONE_REAL_TOLERANCE_S = 120;

function boardCarrierCode(flight: any): string {
  const ident = String(flight?.identification?.number?.default || '').toUpperCase();
  const m = /^([A-Z][A-Z0-9])\d/.exec(ident);
  return m ? m[1] : '';
}

function boardRoute(flight: any): string {
  return `${flight?.airport?.origin?.code?.iata || ''}>${flight?.airport?.destination?.code?.iata || ''}`;
}

function timesMatch(a: number | null | undefined, b: number | null | undefined, tolS: number): boolean {
  return !!a && !!b && Math.abs(a - b) <= tolS;
}

export function dedupeBoardFlights(
  flights: any[],
  dir: string
): { flights: any[]; dedupe: { revisions: number; operatorClones: number; foreign: number } } {
  const isDep = dir === 'departures';
  const dedupe = { revisions: 0, operatorClones: 0, foreign: 0 };

  // (a) Collapse schedule-revision dupes: rows sharing flight number + the same REAL departure
  // (or arrival) timestamp describe one physical movement; keep the row with the EARLIEST
  // scheduled time (the ORIGINAL baseline). Both rows carry the same real timestamp, so keeping
  // the original schedule preserves the true delay — keeping the latest revision (revised
  // schedule ≈ real time) rendered UA5982's +2h48m GDP delay as "On Time". Rows without a real
  // timestamp are never collapsed here — two same-numbered rows with different scheduled times
  // and no actuals are legitimately two flights (morning + evening rotation of the same number).
  const schedOf = (f: any) => (isDep ? f?.time?.scheduled?.departure : f?.time?.scheduled?.arrival) || 0;
  const revisionKey = (f: any): string | null => {
    const ident = String(f?.identification?.number?.default || '');
    const real = isDep
      ? (f?.time?.real?.departure || f?.time?.real?.arrival)
      : (f?.time?.real?.arrival || f?.time?.real?.departure);
    if (!ident || !real) return null;
    return `${ident}:${real}`;
  };
  const revisionWinners = new Map<string, any>();
  for (const f of flights) {
    const key = revisionKey(f);
    if (!key) continue;
    const existing = revisionWinners.get(key);
    // Earliest non-zero schedule wins; a row with no scheduled time at all never displaces one
    // that carries the original baseline.
    const candSched = schedOf(f);
    const existingSched = existing ? schedOf(existing) : 0;
    if (!existing || (candSched > 0 && (existingSched === 0 || candSched < existingSched))) {
      revisionWinners.set(key, f);
    }
  }
  const afterRevisions = flights.filter((f) => {
    const key = revisionKey(f);
    if (!key || revisionWinners.get(key) === f) return true;
    dedupe.revisions++;
    return false;
  });

  // (b)+(c) Non-UA idents: a row matching a UA row on route + time is the same physical flight
  // listed under its operator/codeshare ident — keep the UA row. Real timestamps are the ground
  // truth: when BOTH rows carry a real departure (arrival for arrivals boards), they are clones
  // only if those real times match within ±120s — distinct real times are two physical aircraft
  // even on the same route minutes apart (route + schedule ±5 min alone deleted legitimate
  // United Express flights). A non-UA row that has a real time the UA row lacks is likewise a
  // real flight; only a non-UA row with NO real times may match on schedule (±5 min). A
  // non-matching row survives only if its carrier is a known United Express operator; anything
  // else (NK/DL/AA/…) is a foreign leak and is dropped.
  const uaRows = afterRevisions.filter((f) => boardCarrierCode(f) === 'UA');
  const result = afterRevisions.filter((f) => {
    const carrier = boardCarrierCode(f);
    if (carrier === 'UA' || carrier === '') return true; // '' = unparseable ident, already UA-vetted upstream
    const route = boardRoute(f);
    const realT = isDep ? f?.time?.real?.departure : f?.time?.real?.arrival;
    const schedT = isDep ? f?.time?.scheduled?.departure : f?.time?.scheduled?.arrival;
    const clone = uaRows.some((u) => {
      if (boardRoute(u) !== route) return false;
      const uReal = isDep ? u?.time?.real?.departure : u?.time?.real?.arrival;
      const uSched = isDep ? u?.time?.scheduled?.departure : u?.time?.scheduled?.arrival;
      if (realT && uReal) return timesMatch(realT, uReal, OPERATOR_CLONE_REAL_TOLERANCE_S);
      if (realT) return false; // this row physically moved at a time the UA row doesn't corroborate
      return timesMatch(schedT, uSched, OPERATOR_CLONE_TOLERANCE_S);
    });
    if (clone) {
      dedupe.operatorClones++;
      return false;
    }
    if (UNITED_EXPRESS_CARRIERS.has(carrier)) return true;
    dedupe.foreign++;
    return false;
  });

  return { flights: result, dedupe };
}

async function fetchWindow(
  hub: string,
  dir: string,
  fromLocal: string,
  toLocal: string,
  timeoutMs: number
): Promise<{ ok: true; flights: any[] } | { ok: false }> {
  const token = process.env.AERODATABOX_API_KEY;
  if (!token) return { ok: false };

  const base = (process.env.AERODATABOX_BASE_URL || AERODATABOX_BASE_URL).replace(/\/+$/, '');
  const direction = dir === 'departures' ? 'Departure' : 'Arrival';
  const url = new URL(
    `${base}/flights/airports/iata/${encodeURIComponent(hub.toUpperCase())}/${encodeURIComponent(fromLocal)}/${encodeURIComponent(toLocal)}`
  );
  url.searchParams.set('direction', direction);
  url.searchParams.set('withLeg', 'true');
  url.searchParams.set('withCancelled', 'true');
  url.searchParams.set('withCodeshared', 'true');
  url.searchParams.set('withCargo', 'false');
  url.searchParams.set('withPrivate', 'false');
  url.searchParams.set('withLocation', 'false');

  // Support both AeroDataBox gateways: RapidAPI (x-rapidapi-key + x-rapidapi-host) and
  // api.market (x-magicapi-key). Detected from the base host so a single AERODATABOX_API_KEY +
  // AERODATABOX_BASE_URL pair works for either.
  const isRapidApi = /rapidapi\.com/i.test(base);
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
  };
  if (isRapidApi) {
    headers['x-rapidapi-key'] = token;
    try { headers['x-rapidapi-host'] = new URL(base).host; } catch { headers['x-rapidapi-host'] = 'aerodatabox.p.rapidapi.com'; }
  } else {
    headers['x-magicapi-key'] = token;
  }

  // Free RapidAPI plans throttle by requests-per-second, so a busy hub's window can get a 429 even
  // with the inter-window gap (concurrent cron/user traffic competes for the same per-second budget).
  // Retry 429/503 a couple of times, honoring Retry-After, so a transient throttle doesn't leave the
  // board permanently half-empty.
  const deadline = Date.now() + timeoutMs;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 800) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(remaining, 15000));
    try {
      // Count spend per request actually fired (retries bill too), before reading the outcome —
      // a 429 storm then exhausts the budget quickly, which is exactly the circuit we want.
      recordAdbUnitsDurable(ADB_UNITS_PER_REQUEST);
      const resp = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timer);

      if (resp.status === 204) return { ok: true, flights: [] };
      if (resp.status === 429 || resp.status === 503) {
        const body = await resp.text().catch(() => '');
        const retryAfter = Number(resp.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt;
        if (attempt < maxAttempts && deadline - Date.now() > backoff + 800) {
          console.warn(`AeroDataBox ${resp.status} for ${hub} ${dir} (attempt ${attempt}); retrying in ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        // Surface WHY we gave up so a monthly-quota wall is distinguishable from a per-second
        // throttle (the body/headers were previously discarded, hiding quota exhaustion in the logs).
        const quotaRemaining =
          resp.headers.get('x-ratelimit-requests-remaining') ??
          resp.headers.get('x-ratelimit-rapid-free-plans-hard-limit-remaining') ??
          resp.headers.get('x-ratelimit-remaining') ??
          '?';
        console.error(
          `AeroDataBox schedule gave up: ${resp.status} for ${hub} ${dir} after ${attempt} attempt(s) — quota-remaining=${quotaRemaining} body=${body.slice(0, 200)}`
        );
        return { ok: false };
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.error(`AeroDataBox schedule returned ${resp.status} for ${hub} ${dir}: ${body.slice(0, 200)}`);
        return { ok: false };
      }

      const data = await resp.json() as any;
      const flights = dir === 'departures' ? (data?.departures || []) : (data?.arrivals || []);
      return { ok: true, flights: Array.isArray(flights) ? flights : [] };
    } catch (e: any) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        console.error(`AeroDataBox schedule timeout for ${hub} ${dir}`);
        return { ok: false };
      }
      console.error(`AeroDataBox schedule error for ${hub} ${dir}:`, e.message);
      return { ok: false };
    }
  }
  return { ok: false };
}

export async function fetchViaAeroDataBox(
  hub: string,
  dir: string,
  ts: number,
  timeoutMs = 12000,
  opts: { bypassDailyBudget?: boolean } = {}
) {
  if (!process.env.AERODATABOX_API_KEY) return null;

  // Cross-instance daily spend stop: behave exactly as if the provider were unconfigured so
  // callers fall through to their existing degraded paths instead of burning more quota.
  // Authorized cron warms bypass the organic gate — their spend is hard-bounded by the warm ring
  // itself (~384 units/day) and they are the one path that keeps boards from freezing, so organic
  // traffic must never starve them. Their units are still recorded against the organic budget,
  // and they keep a 3x absolute ceiling so a leaked cron secret cannot spend unboundedly. Both
  // gates hydrate first: an unhydrated ceiling reads a cold instance's 0 and is per-instance
  // theater under fan-out (the hydrate is rate-limited to one Supabase read per 10s).
  await hydrateAdbSpend();
  if (opts.bypassDailyBudget) {
    if (getAdbUnitsToday() >= getAdbDailyUnitBudget() * ADB_BYPASS_CEILING_MULTIPLIER) {
      console.error(
        `AeroDataBox bypass ceiling hit (${getAdbUnitsToday()}/${getAdbDailyUnitBudget() * ADB_BYPASS_CEILING_MULTIPLIER}); refusing forced fetch for ${hub} ${dir}`
      );
      return null;
    }
  } else if (isAdbBudgetExhausted()) {
    // Throttle: once the day's budget trips, every organic board load would otherwise log this —
    // emit it once per instance per UTC day so the signal isn't drowned in its own repetition.
    const today = new Date().toISOString().slice(0, 10);
    if (lastBudgetWarnDay !== today) {
      lastBudgetWarnDay = today;
      console.warn(
        `AeroDataBox daily unit budget exhausted (${getAdbUnitsToday()}/${getAdbDailyUnitBudget()}); skipping further organic schedule fetches until next UTC day`
      );
    }
    return null;
  }

  const startTime = Date.now();
  const date = hubLocalDate(hub, ts);
  const windows = [
    [`${date}T00:00`, `${date}T11:59`],
    [`${date}T12:00`, `${date}T23:59`],
  ];

  const rawFlights: any[] = [];
  const failedWindows: number[] = [];
  // Free RapidAPI plans throttle by requests-per-second, so pause between the sequential window
  // calls. 1500ms (was 1100) keeps the two FIDS calls comfortably under the 1 req/s ceiling even
  // when an organic request is competing for the same per-second budget, cutting 429s; on the warm
  // path (~30s provider budget) it only trims each window's timeout by ~100ms, and on the organic
  // path (~12s budget) by ~200ms — both stay well above the 2000ms floor below. Reserve that pause
  // out of the budget when sizing each window's timeout.
  const interWindowDelayMs = Math.max(0, Number(process.env.AERODATABOX_INTER_WINDOW_DELAY_MS ?? 1500) || 0);
  const reserved = interWindowDelayMs * (windows.length - 1);
  const perWindowTimeout = Math.max(2000, Math.floor((timeoutMs - reserved) / windows.length));

  for (let i = 0; i < windows.length; i++) {
    if (i > 0 && interWindowDelayMs > 0) {
      await new Promise((r) => setTimeout(r, interWindowDelayMs));
    }
    const [fromLocal, toLocal] = windows[i];
    const result = await fetchWindow(hub, dir, fromLocal, toLocal, perWindowTimeout);
    if (result.ok) {
      rawFlights.push(...result.flights);
    } else {
      failedWindows.push(i + 1);
    }
  }

  const seen = new Set<string>();
  const exactDeduped: any[] = [];
  for (const raw of rawFlights) {
    const normalized = normalizeFlight(raw, hub, dir);
    if (!normalized) continue;
    const scheduleKey = dir === 'departures'
      ? normalized.time?.scheduled?.departure
      : normalized.time?.scheduled?.arrival;
    const key = `${normalized.identification?.number?.default || ''}:${scheduleKey || ''}:${normalized.airport?.origin?.code?.iata || ''}:${normalized.airport?.destination?.code?.iata || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    exactDeduped.push(normalized);
  }

  // The exact key above intentionally includes the scheduled time, so schedule revisions,
  // operator-code clones and foreign codeshare leaks survive it — collapse those here.
  const { flights, dedupe } = dedupeBoardFlights(exactDeduped, dir);
  if (dedupe.revisions > 0 || dedupe.operatorClones > 0 || dedupe.foreign > 0) {
    console.log(
      `AeroDataBox dedupe for ${hub} ${dir}: collapsed ${dedupe.revisions} schedule-revision dupes, ${dedupe.operatorClones} operator-code clones; dropped ${dedupe.foreign} foreign rows`
    );
  }

  const partial = failedWindows.length > 0;
  const pagesRequested = windows.length;
  const pagesFailed = failedWindows.length;
  const pagesSucceeded = pagesRequested - pagesFailed;

  return {
    flights,
    total: flights.length,
    totalFetched: rawFlights.length,
    pagesScanned: pagesRequested,
    totalPages: pagesRequested,
    cached: false,
    partial,
    hub,
    dir,
    meta: {
      partialReason: partial ? 'provider_partial' : null,
      pagesRequested,
      pagesSucceeded,
      pagesFailed,
      missingPages: failedWindows,
      completeness: pagesRequested > 0 ? Math.round((pagesSucceeded / pagesRequested) * 100) / 100 : 1,
      elapsedMs: Date.now() - startTime,
      source: 'aerodatabox',
      dedupe,
    },
  };
}
