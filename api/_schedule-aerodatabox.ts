import { waitUntil } from '@vercel/functions';
import { HUB_TZ } from './irops.js';
import { icaoToIata, isInternationalRoute } from '../src/lib/airport-metadata.js';
import { getHubTerminal } from './_hubs.js';
import { hydrateAdbSpend, isAdbOrganicRefreshGated, isAdbFirstLoadGated, getAdbFirstLoadHeadroom, isAdbBudgetPacingDisabled, getAdbPacedAllowance, recordAdbUnits, getAdbUnitsToday, getAdbDailyUnitBudget } from './_cost-state.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
import { isImplausibleLegSpan, isPlausibleDelta } from '../src/lib/schedule-plausibility.js';
import { clearFutureActuals } from '../src/lib/schedule-actuals.js';
import { collapseSameTailDuplicates } from '../src/lib/board-dedupe.js';
import { iataForAirportName } from '../src/lib/airport-codes.js';

const AERODATABOX_BASE_URL = 'https://prod.api.market/api/v1/aedbx/aerodatabox';
// Each FIDS window request is billed at 2 units by the provider (1 board = 2 windows = 4 units).
const ADB_UNITS_PER_REQUEST = 2;
// Budget-exempt (cron-forced) calls still hit an absolute ceiling at 3x the organic budget so a
// leaked cron secret cannot spend unboundedly; the warm ring's own cadence keeps normal forced
// spend far below this.
const ADB_BYPASS_CEILING_MULTIPLIER = 3;

// The gate warning previously fired on every gated organic request — dozens/hour for ~11h/day once
// the budget tripped, burying genuine warnings and inflating log-query latency. Throttle it, but per
// UTC HOUR rather than per UTC day: unlike the old flat budget (trips once, stays tripped), the
// PACED gate is episodic by construction — spend crosses the pro-rated line, the line catches up,
// spend crosses it again — so a once-per-day latch would report the 09:00 UTC episode and silently
// swallow every afternoon one, hiding exactly the peak-hours behaviour this pacing was built for.
// Hourly caps the volume at ≤24 lines per instance per day while preserving the shape of the day.
let lastGateWarnHour = '';

/** Test-only: clear the once-per-hour warn throttle so per-test assertions start from a clean slate. */
export function __resetScheduleWarnsForTests(): void {
  lastGateWarnHour = '';
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
  const fromIcao = icaoToIata(String(airport?.icao || '').trim().toUpperCase());
  if (fromIcao) return fromIcao;
  // v1.12.1: a row with only a name ("San Francisco") gets the code when the name is unambiguous —
  // the board printed "San Francisco → DEN" beside "SFO → DEN" (live audit Oct 4 2026).
  return iataForAirportName(airport?.name || airport?.shortName || airport?.municipalityName);
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
  // F100: the provider sometimes codes a mainline flight under an Express prefix ("G7 60") while
  // its callsign says UAL60 — yesterday's UA60 787-9 to Melbourne rendered as a GoJet "G760".
  // Real Express flying uses the operator's own callsign (SKW/RPA/GJS/ASH/…), so a UAL callsign
  // on a non-UA number is the authoritative ident.
  const ualCallsign = /^UAL(\d+[A-Z]?)$/.exec(fallback);
  if (ualCallsign && !/^UA\d/.test(primary)) return `UA${ualCallsign[1]}`;
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

/**
 * Derive an ICAO-style type designator from AeroDataBox's free-text aircraft model.
 *
 * AeroDataBox ships only a human-readable model name ("Airbus A321 NEO", "Boeing 737 MAX 9")
 * and NEVER a code — 0 of 647 rows on the live board carried one, 610 carried text. The
 * dashboard keys three features off `aircraft.model.code`: the equipment-swap detector
 * (detectEquipmentSwaps), the Aircraft column, and the aircraft-type filter (aircraftOptions in
 * src/app/views/schedule/useBoardModel.ts). With the code hardcoded to '' all three were
 * structurally dead. This maps the text into the client's ICAO_TO_FLEET_TYPE vocabulary
 * (src/lib/equipment-swaps.js):
 * A319/A320/A21N, B737/B738/B739, B38M/B39M, B752/B753, B763/B764, B772/B77E/B77W,
 * B788/B789/B78X, plus the United Express regional designators the boards also carry
 * (E170/E175, CRJ2/CRJ7/CRJ9).
 *
 * HONESTY OVER COMPLETENESS: any text that does not resolve to a SINGLE variant returns ''.
 * A bare "Boeing 737" (no -700/-800/-900/MAX suffix) is ambiguous across four codes, so it
 * maps to nothing — likewise bare "Boeing 787" / "Boeing 777", "Airbus A321" (ceo vs neo),
 * "Bombardier CRJ", and any unrecognised string. An empty code is honest: the swap detector
 * skips the row and the Aircraft column shows '—'. A GUESSED variant would be worse than the
 * dead banner it revives — two polls that resolved the same physical jet to different guessed
 * codes would mint a FALSE "equipment swap detected" alert. Never guess a variant.
 *
 * Note on 777-200: AeroDataBox free text cannot distinguish a 777-200 from a 777-200ER unless
 * it spells out "ER", so plain "Boeing 777-200" maps to the generic B772. This is consistent
 * (all -200s without an ER marker collapse to one code) so it cannot fabricate a swap; it only
 * loses the ER distinction for getTypicalFleetStats, a display nicety, not a correctness issue.
 */
export function modelTextToIcaoCode(text: string): string {
  const t = String(text || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!t) return '';

  // ── Airbus ──
  if (t.includes('A319')) return 'A319';
  if (t.includes('A320')) return 'A320';
  if (t.includes('A321')) return /NEO/.test(t) ? 'A21N' : ''; // bare A321 = ceo/neo ambiguous

  // ── Boeing 737 (check MAX + numbered variants; bare "737" is ambiguous) ──
  if (t.includes('737')) {
    if (/MAX ?8/.test(t)) return 'B38M';
    if (/MAX ?9/.test(t)) return 'B39M';
    if (/737-?700/.test(t)) return 'B737';
    if (/737-?800/.test(t)) return 'B738';
    if (/737-?900/.test(t)) return 'B739';
    return ''; // bare "Boeing 737" — could be -700/-800/-900, never guess
  }

  // ── Boeing 757 / 767 ──
  if (/757-?200/.test(t)) return 'B752';
  if (/757-?300/.test(t)) return 'B753';
  if (/767-?300/.test(t)) return 'B763';
  if (/767-?400/.test(t)) return 'B764';

  // ── Boeing 777 (check -300 and -200ER before plain -200) ──
  if (t.includes('777')) {
    if (/777-?300/.test(t)) return 'B77W'; // United 777-300 is 777-300ER only
    if (/777-?200ER/.test(t)) return 'B77E';
    if (/777-?200/.test(t)) return 'B772';
    return ''; // bare "Boeing 777"
  }

  // ── Boeing 787 (check -10 before -1x/-8/-9) ──
  if (t.includes('787')) {
    if (/787-?10/.test(t)) return 'B78X';
    if (/787-?9/.test(t)) return 'B789';
    if (/787-?8/.test(t)) return 'B788';
    return ''; // bare "Boeing 787"
  }

  // ── Embraer (United Express) ──
  if (t.includes('EMBRAER') || /\bE-?1[0-9][0-9]\b/.test(t)) {
    if (/175|E-?175|E-?75/.test(t)) return 'E175';
    if (/170|E-?170|E-?70/.test(t)) return 'E170';
    return '';
  }

  // ── Bombardier CRJ (CRJ-550 is an ICAO CRJ7 airframe) ──
  if (t.includes('CRJ') || t.includes('BOMBARDIER') || t.includes('CANADAIR')) {
    if (/CRJ ?-?900/.test(t)) return 'CRJ9';
    if (/CRJ ?-?(550|700)/.test(t)) return 'CRJ7';
    if (/CRJ ?-?200/.test(t)) return 'CRJ2';
    return ''; // bare "Bombardier CRJ" — 200/550/700/900 all possible
  }

  return '';
}

/** The two legs of a raw FIDS item, whichever shape (withLeg or movement-only) it arrived in. */
function rawLeg(flight: any, hub: string, dir: string) {
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
  const boardMovement = isDeparture ? departureMovement : arrivalMovement;
  return {
    originAirport,
    destinationAirport,
    departureMovement,
    arrivalMovement,
    origIata,
    destIata,
    route: `${origIata}>${destIata}`,
    boardSched: toUnixDateTime(boardMovement?.scheduledTime),
  };
}

// ── F90: partner-operated codeshares ──
// The window fetch asks for codeshare rows (withCodeshared=true) so that United-marketed Express
// flying is on the board, but the same flag also returns every partner flight United sells a seat
// on: 18 of 29 "UA" departures on the NRT board were ANA/Singapore metal (UA8010 on an A380), and
// the SFO board carried Air Canada, Lufthansa, Swiss, Asiana and Copa (HP-9929) rows. They inflated
// the board totals, board OTP and IROPS totalFlights. A codeshare row is kept only when something
// says United (or United Express) flies it; the number range is NOT evidence (some UA6xxx are real
// Express). Callsigns seen on real Express rows: SkyWest, Republic, GoJet, Mesa, CommutAir, Air
// Wisconsin (plus the ExpressJet / Trans States prefixes the carrier set still carries).
const UNITED_OPERATOR_CALLSIGNS = new Set(['UAL', 'SKW', 'RPA', 'GJS', 'ASH', 'UCA', 'AWI', 'ASQ', 'LOF']);

type OperatorTwin = { sched: number; carrier: string };

/** Operating (non-codeshare) rows by route, so a codeshare can be matched to the carrier flying it. */
function buildOperatorIndex(rawFlights: any[], hub: string, dir: string): Map<string, OperatorTwin[]> {
  const index = new Map<string, OperatorTwin[]>();
  for (const f of rawFlights) {
    if (f?.codeshareStatus === 'IsCodeshared') continue;
    const legInfo = rawLeg(f, hub, dir);
    if (!legInfo.boardSched) continue;
    const carrier =
      normalizeFlightId(f?.airline?.iata) || (/^([A-Z][A-Z0-9])\d/.exec(normalizeFlightId(f?.number))?.[1] ?? '');
    const list = index.get(legInfo.route) || [];
    list.push({ sched: legInfo.boardSched, carrier });
    index.set(legInfo.route, list);
  }
  return index;
}

function isUnitedOperatingCarrier(carrier: string): boolean {
  return carrier === 'UA' || UNITED_EXPRESS_CARRIERS.has(carrier);
}

/** True when a UA-marketed row is flown by a partner, not by United or United Express. */
function isPartnerCodeshare(flight: any, hub: string, dir: string, operators: Map<string, OperatorTwin[]>): boolean {
  // The callsign IS the operating carrier, whatever codeshareStatus says (the public board strips
  // that flag, so it could not be verified for the SFO partner rows): ANA107 / CMP383 / ACA746 on a
  // UA number is partner metal even if the provider labelled the row 'Unknown'.
  const callPrefix = /^([A-Z]{3})\d/.exec(normalizeFlightId(flight?.callSign))?.[1];
  if (callPrefix) return !UNITED_OPERATOR_CALLSIGNS.has(callPrefix);
  if (flight?.codeshareStatus !== 'IsCodeshared') return false;
  const legInfo = rawLeg(flight, hub, dir);
  const twin = (operators.get(legInfo.route) || []).find((o) =>
    timesMatch(o.sched, legInfo.boardSched, OPERATOR_CLONE_TOLERANCE_S)
  );
  // No callsign and no operator twin: nothing says partner, so keep it (the empty-callsign
  // UA4xxx/5xxx rows on the ORD board are real United Express).
  return !!twin && !!twin.carrier && !isUnitedOperatingCarrier(twin.carrier);
}

function normalizeFlight(flight: any, hub: string, dir: string) {
  if (!isUnitedFlight(flight)) return null;

  const hubUpper = hub.toUpperCase();
  const isDeparture = dir === 'departures';
  const movement = flight?.movement;
  const { originAirport, destinationAirport, departureMovement, arrivalMovement, origIata, destIata } =
    rawLeg(flight, hub, dir);
  if (isDeparture && origIata !== hubUpper) return null;
  if (!isDeparture && destIata !== hubUpper) return null;

  const flightNum = normalizeUnitedFlightNumber(flight?.number, flight?.callSign);
  if (!flightNum) return null;
  const rawNumber = normalizeFlightId(flight?.number);
  // F100: the ident came from a UAL callsign over an Express-coded number. Flag it so dedupe still
  // treats it as a possible operator clone of a real UA row.
  const identFromCallsign = !!rawNumber && /^UA\d/.test(flightNum) && !/^(UA|UAL)\d/.test(rawNumber);

  const schedDep = toUnixDateTime(departureMovement?.scheduledTime);
  const schedArr = toUnixDateTime(arrivalMovement?.scheduledTime);
  const revisedDep = toUnixDateTime(departureMovement?.revisedTime);
  const revisedArr = toUnixDateTime(arrivalMovement?.revisedTime);
  const runwayDep = toUnixDateTime(departureMovement?.runwayTime);
  const runwayArr = toUnixDateTime(arrivalMovement?.runwayTime);

  const status = String(flight?.status || '');
  const departedLike = ['Departed', 'EnRoute', 'Approaching', 'Arrived', 'Diverted'].includes(status);
  const arrivedLike = ['Arrived', 'Diverted'].includes(status);
  // Measure delay at the GATE, not the runway. See docs/specs/irops-delay-measurement.md.
  //
  // `scheduledTime` is a scheduled GATE time. `runwayTime` is the actual runway time — wheels-up on
  // departure, wheels-down on arrival. Comparing the two mixes units, so a delay computed from
  // runwayTime silently carries taxi-out, and an arrival computed from it lands before the aircraft
  // reaches the gate. `revisedTime` is the gate time. Prefer it; fall back to runwayTime only when
  // the provider omits it.
  //
  // Measured on 521 operated legs from live EWR + SFO boards (2026-07-09), after shipping
  // instrumentation rather than guessing:
  //   - revisedTime coverage is 100% — it is not the sparse "if any" field the vendor docs imply
  //   - the gate time is NEVER after the runway time (0 of 255 departures), so this swap can only
  //     shrink a reported delay, never grow one. That is the safety property that makes it shippable
  //   - where the two differ (92 of 255 departures) the median gap is 26 min, p90 39 min — taxi
  //   - departures at/before schedule: 2.4% by runwayTime → 26.3% by gate. delayed30: 85 → 53
  //   - arrivals: runwayTime put 78.2% at/before schedule (touchdown), gate puts 72.2% (the gate)
  //
  // Honest limit: for 64% of departures the provider sets revisedTime == runwayTime, giving us no
  // distinct gate report. Those rows stay taxi-inflated and we cannot do better with this feed.
  // `_source.timeSource.gateDistinct` marks the rows where we genuinely have a gate time, so
  // consumers can tell the difference instead of assuming.
  const realDep = departedLike ? (revisedDep || runwayDep) : null;
  const realArr = arrivedLike ? (revisedArr || runwayArr) : null;
  const gateDistinctDep = departedLike && revisedDep != null && revisedDep !== runwayDep;
  const gateDistinctArr = arrivedLike && revisedArr != null && revisedArr !== runwayArr;
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
    airline: { code: { iata: 'UA' }, name: identFromCallsign ? 'United Airlines' : flight?.airline?.name || 'United Airlines' },
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
      model: { code: modelTextToIcaoCode(flight?.aircraft?.model || ''), text: flight?.aircraft?.model || '' },
      registration: validateRegistration(flight?.aircraft?.reg) || '',
    },
    _source: {
      provider: 'aerodatabox',
      ...(identFromCallsign ? { identFromCallsign: true } : {}),
      quality: [
        ...(departureMovement?.quality || []),
        ...(arrivalMovement?.quality || []),
        ...(movement?.quality || []),
      ],
      // `gateDistinct*` is true when the provider gave a gate time that differs from the runway
      // time — i.e. when time.real.* is genuinely gate-based rather than a taxi-inflated runway
      // time the provider happened to copy into revisedTime. 36% of departures on the measured
      // sample. Consumers that care about honest delay stats should prefer these rows.
      timeSource: {
        gateDistinctDep,
        gateDistinctArr,
        hasGateDep: revisedDep != null,
        hasRunwayDep: runwayDep != null,
        hasGateArr: revisedArr != null,
        hasRunwayArr: runwayArr != null,
      },
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
): { flights: any[]; dedupe: { revisions: number; operatorClones: number; foreign: number; sameTail: number } } {
  const isDep = dir === 'departures';
  // `sameTail` (v1.12.1) is the part of `revisions` collapsed by the ident + route + tail rule below;
  // it is counted in `revisions` too, so the snapshot ranking (rankingTotal) credits the dropped rows.
  const dedupe = { revisions: 0, operatorClones: 0, foreign: 0, sameTail: 0 };

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
  const afterRealMatch = flights.filter((f) => {
    const key = revisionKey(f);
    if (!key || revisionWinners.get(key) === f) return true;
    dedupe.revisions++;
    return false;
  });
  // (a2) v1.12.1: one physical flight is one row even when the copies share NO timestamp — a re-timed
  // copy (EWR UA1462 "+4h13m" and "+0m" on N47298) or an "Approaching" ghost beside the "Arrived" row
  // (LAX UA38). Same ident + route + tail → keep the row with the best evidence (src/lib/board-dedupe.js).
  const sameTail = collapseSameTailDuplicates(afterRealMatch, isDep ? 'departures' : 'arrivals');
  const afterRevisions: any[] = sameTail.flights as any[];
  dedupe.sameTail = sameTail.collapsed;
  dedupe.revisions += sameTail.collapsed;

  // (b)+(c) Non-UA idents: a row matching a UA row on route + time is the same physical flight
  // listed under its operator/codeshare ident — keep the UA row. Real timestamps are the ground
  // truth: when BOTH rows carry a real departure (arrival for arrivals boards), they are clones
  // only if those real times match within ±120s — distinct real times are two physical aircraft
  // even on the same route minutes apart (route + schedule ±5 min alone deleted legitimate
  // United Express flights). A non-UA row that has a real time the UA row lacks is likewise a
  // real flight; only a non-UA row with NO real times may match on schedule (±5 min). A
  // non-matching row survives only if its carrier is a known United Express operator; anything
  // else (NK/DL/AA/…) is a foreign leak and is dropped.
  // A row whose UA ident was rebuilt from its UAL callsign (F100) is still an Express-coded row:
  // it may be an operator clone of a genuine UA row, so it is matched like one and kept (as UA)
  // only when it has no twin.
  const fromCallsign = (f: any) => f?._source?.identFromCallsign === true;
  const uaRows = afterRevisions.filter((f) => boardCarrierCode(f) === 'UA' && !fromCallsign(f));
  const result = afterRevisions.filter((f) => {
    const carrier = boardCarrierCode(f);
    if ((carrier === 'UA' && !fromCallsign(f)) || carrier === '') return true; // '' = unparseable ident, already UA-vetted upstream
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
    if (fromCallsign(f) || UNITED_EXPRESS_CARRIERS.has(carrier)) return true;
    dedupe.foreign++;
    return false;
  });

  return { flights: result, dedupe };
}

// ── F4/F103: one hub day, one flight instance per row ──
// AeroDataBox's window fetch returns every flight with ANY movement in the window, and some rows
// splice two instances together. Observed on the Sep 26 ORD arrivals board (32 of 670 rows):
//   - stale-estimate ghosts: yesterday's UA1677 never updated, its estimate parked at 00:02, shown
//     as "+10h47m Landed* presumed" at the top of today's board;
//   - cross-instance pairs: UA2113 departed on time two days ago and "arrived" today (+54h20m);
//     UA5375's scheduled arrival (yesterday 20:30) is EARLIER than its scheduled departure;
//   - yesterday's late-night flights (SFO UA2080 scheduled 23:59, off at 00:01) counted in today.
// A scheduled time whose real counterpart is implausibly far from it belongs to another instance:
// it is dropped, and a board-side scheduled time that is left empty is DERIVED from the real time
// (flagged scheduleTimeDerivedFromActual, as the official-API path already does), so the row shows
// what happened today with no fabricated delta and stays out of on-time/late and IROPS OTP. Then
// the board keeps only rows whose board-side time falls inside the requested hub-local day.
type ScheduleSide = 'departure' | 'arrival';

export function repairScheduleInstance(flight: any, dir: string): { repaired: boolean } {
  const sched = flight.time.scheduled;
  const real = flight.time.real;
  let repaired = false;
  for (const side of ['departure', 'arrival'] as ScheduleSide[]) {
    if (sched[side] && real[side] && !isPlausibleDelta(real[side], sched[side])) {
      sched[side] = null;
      repaired = true;
    }
  }
  if (sched.departure && sched.arrival && sched.arrival < sched.departure) {
    // Keep the side its own real time corroborates best; with no real times keep the board side.
    const off = (side: ScheduleSide) => (real[side] ? Math.abs(real[side] - sched[side]) : null);
    const dep = off('departure');
    const arr = off('arrival');
    const boardSide: ScheduleSide = dir === 'departures' ? 'departure' : 'arrival';
    const drop: ScheduleSide =
      dep == null && arr == null
        ? (boardSide === 'departure' ? 'arrival' : 'departure')
        : arr == null || (dep != null && dep <= arr) ? 'arrival' : 'departure';
    sched[drop] = null;
    repaired = true;
  }
  if (repaired) {
    const derived = { departure: false, arrival: false };
    for (const side of ['departure', 'arrival'] as ScheduleSide[]) {
      if (!sched[side] && real[side]) {
        sched[side] = real[side];
        derived[side] = true;
      }
    }
    if (derived.departure || derived.arrival) flight._source.scheduleTimeDerivedFromActual = derived;
  }
  return { repaired };
}

/** Is the row's board-side time inside [dayStart, dayEnd)? A row with no board-side time is kept. */
export function isInHubDay(flight: any, dir: string, dayStart: number, dayEnd: number): boolean {
  const side: ScheduleSide = dir === 'departures' ? 'departure' : 'arrival';
  const t = flight.time.scheduled[side] || flight.time.real[side] || flight.time.estimated[side];
  if (!t) return true;
  return t >= dayStart && t < dayEnd;
}

// Per-instance cap on concurrent provider requests. RapidAPI's ULTRA plan limits requests PER
// SECOND; a burst of board loads used to fire every background refresh at once (prod, Sep 26 2026:
// ~26 simultaneous FIDS calls → "exceeded the rate limit per second", billed retries 429'd again,
// four hub boards gave up and stayed 5-11h stale). Queue instead: sequential callers never wait,
// concurrent ones take turns. A waiter that would miss its own deadline gives up rather than
// blocking. Cross-instance traffic can still collide; the retry below handles that residue.
const ADB_MAX_IN_FLIGHT = 2;
let adbInFlight = 0;
const adbWaiters: Array<() => void> = [];

function acquireAdbSlot(deadlineMs: number): Promise<boolean> {
  if (adbInFlight < ADB_MAX_IN_FLIGHT) {
    adbInFlight++;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const waiter = () => {
      clearTimeout(timer);
      adbInFlight++;
      resolve(true);
    };
    const timer = setTimeout(() => {
      const i = adbWaiters.indexOf(waiter);
      if (i >= 0) adbWaiters.splice(i, 1);
      resolve(false);
    }, Math.max(0, deadlineMs - Date.now() - 800));
    adbWaiters.push(waiter);
  });
}

function releaseAdbSlot(): void {
  adbInFlight = Math.max(0, adbInFlight - 1);
  const next = adbWaiters.shift();
  if (next) next();
}

// F79: the in-flight cap above is per instance, and RapidAPI's per-second limit is account-wide.
// A burst across N instances still collides (Sep 27 03:52Z: DEN and GUM arrivals gave up after 3
// attempts), and a FIXED 1.5s/3s backoff made every instance that collided retry in the same
// second and collide again. Jitter the backoff (0.5x-1.5x) so the retries spread out, treat
// Retry-After as a floor (capped: one header must not stall a board), and allow a fourth attempt;
// the caller's deadline bounds the total wait. AERODATABOX_RETRY_BASE_MS exists so tests can run
// the retry path without sleeping.
const ADB_MAX_ATTEMPTS = 4;
const ADB_RETRY_AFTER_CAP_MS = 5000;

export function adbRetryDelayMs(attempt: number, retryAfterHeader: string | null, rand: () => number = Math.random): number {
  const configured = Number(process.env.AERODATABOX_RETRY_BASE_MS);
  const base = Number.isFinite(configured) && configured >= 0 ? configured : 1500;
  const retryAfterS = Number(retryAfterHeader);
  const retryAfterMs =
    retryAfterHeader != null && Number.isFinite(retryAfterS) && retryAfterS > 0
      ? Math.min(retryAfterS * 1000, ADB_RETRY_AFTER_CAP_MS)
      : 0;
  if (retryAfterMs > 0) return retryAfterMs + Math.round(base * attempt * rand());
  return Math.round(base * attempt * (0.5 + rand()));
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
  // Retry 429/503, honoring Retry-After, so a transient throttle doesn't leave the board
  // permanently half-empty. The deadline still bounds every wait.
  const deadline = Date.now() + timeoutMs;
  const maxAttempts = ADB_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 800) break;
    if (!(await acquireAdbSlot(deadline))) {
      console.warn(`AeroDataBox queue wait exceeded the deadline for ${hub} ${dir}; skipping this window`);
      break;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(Math.max(deadline - Date.now(), 800), 15000));
    let resp: Response;
    try {
      // Count spend per request actually fired (retries bill too), before reading the outcome —
      // a 429 storm then exhausts the budget quickly, which is exactly the circuit we want.
      recordAdbUnitsDurable(ADB_UNITS_PER_REQUEST);
      resp = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timer);
    } catch (e: any) {
      clearTimeout(timer);
      releaseAdbSlot();
      if (e.name === 'AbortError') {
        console.error(`AeroDataBox schedule timeout for ${hub} ${dir}`);
        return { ok: false };
      }
      console.error(`AeroDataBox schedule error for ${hub} ${dir}:`, e.message);
      return { ok: false };
    }
    // The slot covers the request only — never a retry backoff sleep, or one throttled board
    // would hold the queue for seconds.
    releaseAdbSlot();
    try {

      if (resp.status === 204) return { ok: true, flights: [] };
      if (resp.status === 429 || resp.status === 503) {
        const body = await resp.text().catch(() => '');
        const backoff = adbRetryDelayMs(attempt, resp.headers.get('retry-after'));
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
  // firstLoad: the board has no complete copy anywhere (see isAdbFirstLoadGated) — it may run a
  // little ahead of the paced line instead of serving an empty board.
  opts: { bypassDailyBudget?: boolean; firstLoad?: boolean } = {}
) {
  if (!process.env.AERODATABOX_API_KEY) return null;

  // Cross-instance daily spend stop: behave exactly as if the provider were unconfigured so
  // callers fall through to their existing degraded paths instead of burning more quota.
  // Authorized cron warms bypass the organic gate — their spend is hard-bounded by the warm ring
  // itself (~768 units/day) and they are the one path that keeps boards from freezing, so organic
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
  } else if (opts.firstLoad ? isAdbFirstLoadGated() : isAdbOrganicRefreshGated()) {
    // Paced gate (see _cost-state.ts): organic spend is capped at the day's pro-rated allowance,
    // not just the absolute daily budget, so the US afternoon peak still has units left after the
    // 7 PM CDT (UTC midnight) rollover crowd and the overnight warms.
    // Throttle: once the gate trips, every organic board load would otherwise log this — emit it
    // at most once per instance per UTC HOUR (see lastGateWarnHour above) so the signal isn't
    // drowned in its own repetition without hiding the later episodes of a paced day.
    const nowHour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    if (lastGateWarnHour !== nowHour) {
      lastGateWarnHour = nowHour;
      // Report the rule that ACTUALLY tripped. With pacing switched off the gate is the flat
      // absolute budget, and printing a paced allowance nobody is enforcing sends whoever reads
      // this log chasing a line that does not exist.
      console.warn(
        isAdbBudgetPacingDisabled()
          ? `AeroDataBox daily unit budget exhausted (${getAdbUnitsToday()}/${getAdbDailyUnitBudget()}); pacing disabled; skipping organic schedule fetch`
          : `AeroDataBox organic budget gate: ${getAdbUnitsToday()} units >= paced allowance ${getAdbPacedAllowance()}${opts.firstLoad ? ` + first-load headroom ${getAdbFirstLoadHeadroom()}` : ''} (budget ${getAdbDailyUnitBudget()}/day); skipping organic schedule fetch (cron warms unaffected)`
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

  // The requested hub-local day. Callers pass its start, but snap anyway so an intra-day ts cannot
  // shift the window (and so DST days are 23h/25h, not a fixed 86400).
  const dayStart = getStartOfHubDay(hub.toUpperCase(), 0, new Date(ts * 1000));
  const dayEnd = getStartOfHubDay(hub.toUpperCase(), 1, new Date(ts * 1000));
  const operators = buildOperatorIndex(rawFlights, hub, dir);
  // `staleLegs`: rows whose legs span longer than any flight (v1.11.3). Like partnerCodeshares
  // and offDay they are deliberate drops, and the snapshot retain guard counts them as such.
  const filtered = { partnerCodeshares: 0, offDay: 0, repaired: 0, staleLegs: 0 };
  // "Has this happened yet?" is asked against this server's clock, read after the windows returned.
  const nowSec = Math.floor(Date.now() / 1000);

  const seen = new Set<string>();
  const exactDeduped: any[] = [];
  for (const raw of rawFlights) {
    let normalized = normalizeFlight(raw, hub, dir);
    if (!normalized) continue;
    // Both FIDS windows can return the same flight: collapse the repeat first so the filter
    // counters below count flights, not window hits.
    const scheduleKey = dir === 'departures'
      ? normalized.time?.scheduled?.departure
      : normalized.time?.scheduled?.arrival;
    const key = `${normalized.identification?.number?.default || ''}:${scheduleKey || ''}:${normalized.airport?.origin?.code?.iata || ''}:${normalized.airport?.destination?.code?.iata || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isPartnerCodeshare(raw, hub, dir, operators)) {
      filtered.partnerCodeshares++;
      continue;
    }
    // v1.11.3 (Oct 3 2026, ORD): an "actual" later than the clock is a forecast — UA845 came back
    // Departed 9.5h before it left, UA2113 Arrived at 22:55Z with the clock at 17:55Z. Clear it
    // BEFORE the repair, which would otherwise derive a scheduled time from it and pull
    // yesterday's leg into today's hub day.
    normalized = clearFutureActuals(normalized, nowSec);
    if (repairScheduleInstance(normalized, dir).repaired) filtered.repaired++;
    // AeroDataBox returns yesterday's leg with its ARRIVAL shifted a day (UA2113 LAX→ORD: off
    // 10-02 17:58Z, "arrived" 10-03 22:55Z). Once that arrival is no longer in the future nothing
    // above catches it, and the repair has just copied it into the scheduled arrival — a 29h leg.
    if (isImplausibleLegSpan(normalized)) {
      filtered.staleLegs++;
      continue;
    }
    if (!isInHubDay(normalized, dir, dayStart, dayEnd)) {
      filtered.offDay++;
      continue;
    }
    exactDeduped.push(normalized);
  }

  // The exact key above intentionally includes the scheduled time, so schedule revisions,
  // operator-code clones and foreign codeshare leaks survive it — collapse those here.
  const { flights, dedupe } = dedupeBoardFlights(exactDeduped, dir);
  if (dedupe.revisions > 0 || dedupe.operatorClones > 0 || dedupe.foreign > 0 || filtered.partnerCodeshares > 0 || filtered.offDay > 0 || filtered.staleLegs > 0) {
    console.log(
      `AeroDataBox dedupe for ${hub} ${dir}: collapsed ${dedupe.revisions} schedule-revision dupes, ${dedupe.operatorClones} operator-code clones; dropped ${dedupe.foreign} foreign rows, ${filtered.partnerCodeshares} partner codeshares, ${filtered.offDay} off-day rows, ${filtered.staleLegs} stale legs; repaired ${filtered.repaired} cross-instance schedules`
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
      filtered,
    },
  };
}
