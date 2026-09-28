// Unified time-with-timezone formatter (P2-A item 2 / F047 / F054).
//
// Before this module existed, the flight popup used two different helpers for
// departure ("fmtTimeInTz", never labeled) and arrival ("fmtTimeWithTz", always
// labeled with timeZoneName) — so the popup silently rendered the departure time
// in the *viewer's* local timezone right next to a labeled arrival time, with no
// way to tell they were on different clocks. This single formatter always
// resolves and appends a short timezone abbreviation. When the tz is genuinely
// unknown/empty it renders in the viewer's zone labelled "your time" — never
// "local", which reads as the airport's clock (audit F11: an ORD takeoff printed
// in Pacific time as "8:17 PM local").
export function formatTimeWithTz(iso, tz) {
  if (!iso) return null;
  let d;
  try {
    d = new Date(iso);
  } catch (e) {
    return null;
  }
  if (isNaN(d.getTime())) return null;

  const baseOpts = { hour: 'numeric', minute: '2-digit', hour12: true };

  if (tz) {
    try {
      const timeStr = d.toLocaleTimeString([], { ...baseOpts, timeZone: tz });
      // Zones without a US-style abbreviation (Asia/Singapore, Asia/Tokyo) get their
      // offset, which is still the airport's clock and says so.
      const abbrev = getTzAbbrev(d, tz) || getTzOffsetLabel(d, tz);
      return abbrev ? `${timeStr} ${abbrev}` : `${timeStr} local`;
    } catch (e) {
      // Unrecognized IANA tz string — fall through to viewer-local, explicitly labeled.
    }
  }

  try {
    const timeStr = d.toLocaleTimeString([], baseOpts);
    return `${timeStr} your time`;
  } catch (e) {
    return null;
  }
}

// Resolve a short abbreviation ("CDT", "EST") for a given instant in a given
// IANA timezone. Returns '' if the runtime can't produce one (rare, but some
// environments fall back to a numeric UTC offset instead of a name).
export function getTzAbbrev(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(date);
    const part = parts.find((p) => p.type === 'timeZoneName');
    if (!part || !part.value) return '';
    // Reject bare numeric-offset fallbacks like "GMT-5" — not a real abbreviation.
    if (/^GMT[+-]?\d*$/.test(part.value)) return '';
    return part.value;
  } catch (e) {
    return '';
  }
}

// "GMT+8"-style offset for an instant in a zone, or '' when the runtime cannot say.
export function getTzOffsetLabel(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const part = parts.find((p) => p.type === 'timeZoneName');
    return part && /^GMT([+-]\d{1,2}(:\d{2})?)?$/.test(part.value) ? part.value : '';
  } catch (e) {
    return '';
  }
}

// IATA → IANA zone for every airport in src/lib/airports.js, so a flight-times payload
// (whose providers mostly omit the zone) can still label its times in the airport's own
// clock. Server (api/flight-times.ts) and client (FlightSheet) share this table.
export const AIRPORT_TZ = Object.freeze({
  // United hubs
  EWR: 'America/New_York', IAH: 'America/Chicago', ORD: 'America/Chicago', DEN: 'America/Denver',
  SFO: 'America/Los_Angeles', LAX: 'America/Los_Angeles', IAD: 'America/New_York',
  GUM: 'Pacific/Guam', NRT: 'Asia/Tokyo',
  // US / Canada
  ATL: 'America/New_York', DFW: 'America/Chicago', JFK: 'America/New_York', LGA: 'America/New_York',
  SEA: 'America/Los_Angeles', BOS: 'America/New_York', PHX: 'America/Phoenix', MCO: 'America/New_York',
  CLT: 'America/New_York', MIA: 'America/New_York', FLL: 'America/New_York', MSP: 'America/Chicago',
  DTW: 'America/Detroit', PHL: 'America/New_York', SLC: 'America/Denver', SAN: 'America/Los_Angeles',
  TPA: 'America/New_York', PDX: 'America/Los_Angeles', BNA: 'America/Chicago', STL: 'America/Chicago',
  AUS: 'America/Chicago', RDU: 'America/New_York', MCI: 'America/Chicago', SMF: 'America/Los_Angeles',
  SJC: 'America/Los_Angeles', OAK: 'America/Los_Angeles', CLE: 'America/New_York', CMH: 'America/New_York',
  PIT: 'America/New_York', IND: 'America/Indiana/Indianapolis', MKE: 'America/Chicago',
  RSW: 'America/New_York', JAX: 'America/New_York', BDL: 'America/New_York', ABQ: 'America/Denver',
  ONT: 'America/Los_Angeles', BUR: 'America/Los_Angeles', HNL: 'Pacific/Honolulu', OGG: 'Pacific/Honolulu',
  KOA: 'Pacific/Honolulu', LIH: 'Pacific/Honolulu', ANC: 'America/Anchorage', SNA: 'America/Los_Angeles',
  DAL: 'America/Chicago', HOU: 'America/Chicago', MDW: 'America/Chicago', BWI: 'America/New_York',
  DCA: 'America/New_York', MSY: 'America/Chicago', RNO: 'America/Los_Angeles', LAS: 'America/Los_Angeles',
  PBI: 'America/New_York', SAT: 'America/Chicago', CHS: 'America/New_York', BOI: 'America/Boise',
  TUS: 'America/Phoenix', OMA: 'America/Chicago', DSM: 'America/Chicago', BUF: 'America/New_York',
  ROC: 'America/New_York', SYR: 'America/New_York', ALB: 'America/New_York', RIC: 'America/New_York',
  ORF: 'America/New_York', GSO: 'America/New_York', CVG: 'America/New_York', MEM: 'America/Chicago',
  OKC: 'America/Chicago', TUL: 'America/Chicago', ELP: 'America/Denver', GEG: 'America/Los_Angeles',
  PSP: 'America/Los_Angeles', SBN: 'America/Indiana/Indianapolis', GRR: 'America/Detroit',
  MSN: 'America/Chicago', XNA: 'America/Chicago', ICT: 'America/Chicago', LIT: 'America/Chicago',
  YYZ: 'America/Toronto', YVR: 'America/Vancouver', YUL: 'America/Toronto', YYC: 'America/Edmonton',
  // Europe / Middle East / Africa
  LHR: 'Europe/London', FRA: 'Europe/Berlin', CDG: 'Europe/Paris', AMS: 'Europe/Amsterdam',
  MUC: 'Europe/Berlin', ZRH: 'Europe/Zurich', FCO: 'Europe/Rome', MAD: 'Europe/Madrid',
  BCN: 'Europe/Madrid', LIS: 'Europe/Lisbon', DUB: 'Europe/Dublin', EDI: 'Europe/London',
  BRU: 'Europe/Brussels', OSL: 'Europe/Oslo', CPH: 'Europe/Copenhagen', ARN: 'Europe/Stockholm',
  HEL: 'Europe/Helsinki', IST: 'Europe/Istanbul', TLV: 'Asia/Jerusalem', DOH: 'Asia/Qatar',
  DXB: 'Asia/Dubai', ADD: 'Africa/Addis_Ababa', ACC: 'Africa/Accra', CPT: 'Africa/Johannesburg',
  JNB: 'Africa/Johannesburg', CAI: 'Africa/Cairo',
  // Asia / Pacific
  HND: 'Asia/Tokyo', ICN: 'Asia/Seoul', PEK: 'Asia/Shanghai', PVG: 'Asia/Shanghai',
  HKG: 'Asia/Hong_Kong', SIN: 'Asia/Singapore', BKK: 'Asia/Bangkok', DEL: 'Asia/Kolkata',
  BOM: 'Asia/Kolkata', SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne', MNL: 'Asia/Manila',
  TPE: 'Asia/Taipei',
  // Latin America
  GRU: 'America/Sao_Paulo', EZE: 'America/Argentina/Buenos_Aires', SCL: 'America/Santiago',
  BOG: 'America/Bogota', MEX: 'America/Mexico_City', CUN: 'America/Cancun', GDL: 'America/Mexico_City',
  SJD: 'America/Mazatlan', PVR: 'America/Mexico_City', LIM: 'America/Lima', PTY: 'America/Panama',
  SJO: 'America/Costa_Rica',
});

/** The airport's IANA zone, or '' when we do not know it. */
export function airportTz(iata) {
  return AIRPORT_TZ[String(iata || '').toUpperCase()] || '';
}
