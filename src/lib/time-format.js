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

// IATA → IANA zone for every airport in src/lib/airports.js and every airport United's hub
// boards fly to, so a flight-times payload (whose providers mostly omit the zone) can still
// label its times in the airport's own clock. Server (api/flight-times.ts) and client
// (FlightSheet) share this table.
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
  // Every other airport on the nine hubs' boards (all 18 boards sampled Oct 3 2026). Without
  // these, a flight to Fargo or Fresno fell through to "6:24 PM your time" in the flight sheet
  // while every hub flight read "PM CDT" (phone QA, Oct 3 2026). Each zone was resolved from
  // the airport's coordinates (OurAirports) against the IANA zone boundaries, not typed from
  // memory — the split states (ND, SD, NE, KS, TX, ID, OR, FL, KY, TN, IN, MI) are exactly
  // where a guess goes wrong: DIK is Mountain but XWA and MOT are Central, PNS is Central.
  ABE: 'America/New_York', ABI: 'America/Chicago', ACA: 'America/Mexico_City',
  ACV: 'America/Los_Angeles', AEX: 'America/Chicago', AGU: 'America/Mexico_City',
  AKL: 'Pacific/Auckland', AMA: 'America/Chicago', ANU: 'America/Antigua', ASE: 'America/Denver',
  ATH: 'Europe/Athens', ATW: 'America/Chicago', ATY: 'America/Chicago', AUA: 'America/Aruba',
  AVL: 'America/New_York', AVP: 'America/New_York', BDA: 'Atlantic/Bermuda', BER: 'Europe/Berlin',
  BFF: 'America/Denver', BFL: 'America/Los_Angeles', BGI: 'America/Barbados',
  BGR: 'America/New_York', BHM: 'America/Chicago', BIL: 'America/Denver', BIS: 'America/Chicago',
  BJX: 'America/Mexico_City', BON: 'America/Kralendijk', BQN: 'America/Puerto_Rico',
  BRO: 'America/Chicago', BTM: 'America/Denver', BTR: 'America/Chicago', BTV: 'America/New_York',
  BZE: 'America/Belize', BZN: 'America/Denver', CAE: 'America/New_York', CAK: 'America/New_York',
  CEA: 'America/Chicago', CHA: 'America/New_York', CHO: 'America/New_York', CID: 'America/Chicago',
  CKB: 'America/New_York', CLD: 'America/Los_Angeles', CMX: 'America/Detroit',
  COD: 'America/Denver', COS: 'America/Denver', COU: 'America/Chicago', CPR: 'America/Denver',
  CRP: 'America/Chicago', CRW: 'America/New_York', CUR: 'America/Curacao', CYS: 'America/Denver',
  CZM: 'America/Cancun', DAY: 'America/New_York', DBV: 'Europe/Zagreb', DDC: 'America/Chicago',
  DEC: 'America/Chicago', DIK: 'America/Denver', DLH: 'America/Chicago', DRO: 'America/Denver',
  DVL: 'America/Chicago', EAR: 'America/Chicago', EAU: 'America/Chicago', ECP: 'America/Chicago',
  EGE: 'America/Denver', EUG: 'America/Los_Angeles', EYW: 'America/New_York',
  FAR: 'America/Chicago', FAT: 'America/Los_Angeles', FCA: 'America/Denver', FMN: 'America/Denver',
  FNT: 'America/Detroit', FOD: 'America/Chicago', FSD: 'America/Chicago',
  FWA: 'America/Indiana/Indianapolis', GCC: 'America/Denver', GCM: 'America/Cayman',
  GEO: 'America/Guyana', GIG: 'America/Sao_Paulo', GJT: 'America/Denver', GLA: 'Europe/London',
  GPT: 'America/Chicago', GRB: 'America/Chicago', GSP: 'America/New_York', GTF: 'America/Denver',
  GUA: 'America/Guatemala', GUC: 'America/Denver', GVA: 'Europe/Zurich', HDN: 'America/Denver',
  HHH: 'America/New_York', HLN: 'America/Denver', HOB: 'America/Denver', HRL: 'America/Chicago',
  HSV: 'America/Chicago', HYS: 'America/Chicago', IDA: 'America/Boise', ILM: 'America/New_York',
  ITH: 'America/New_York', JAC: 'America/Denver', JAN: 'America/Chicago', JLN: 'America/Chicago',
  JMS: 'America/Chicago', JST: 'America/New_York', KEF: 'Atlantic/Reykjavik', KIX: 'Asia/Tokyo',
  LAF: 'America/Indiana/Indianapolis', LAR: 'America/Denver', LBB: 'America/Chicago',
  LBF: 'America/Chicago', LBL: 'America/Chicago', LCH: 'America/Chicago', LEX: 'America/New_York',
  LFT: 'America/Chicago', LIR: 'America/Costa_Rica', LNK: 'America/Chicago',
  LNS: 'America/New_York', LOS: 'Africa/Lagos', LRD: 'America/Chicago', LYH: 'America/New_York',
  MAF: 'America/Chicago', MBJ: 'America/Jamaica', MBS: 'America/Detroit', MCW: 'America/Chicago',
  MDE: 'America/Bogota', MDT: 'America/New_York', MEI: 'America/Chicago', MFE: 'America/Chicago',
  MFR: 'America/Los_Angeles', MGA: 'America/Managua', MGM: 'America/Chicago',
  MGW: 'America/New_York', MHT: 'America/New_York', MID: 'America/Merida', MLB: 'America/New_York',
  MLI: 'America/Chicago', MLM: 'America/Mexico_City', MOB: 'America/Chicago',
  MOT: 'America/Chicago', MRY: 'America/Los_Angeles', MSO: 'America/Denver', MTJ: 'America/Denver',
  MTY: 'America/Monterrey', MXP: 'Europe/Rome', MYR: 'America/New_York', NAP: 'Europe/Rome',
  NAS: 'America/Nassau', NCE: 'Europe/Paris', NZY: 'America/Los_Angeles',
  OAX: 'America/Mexico_City', OPO: 'Europe/Lisbon', OTH: 'America/Los_Angeles',
  PAH: 'America/Chicago', PBC: 'America/Mexico_City', PIA: 'America/Chicago',
  PIB: 'America/Chicago', PIR: 'America/Chicago', PLS: 'America/Grand_Turk', PMI: 'Europe/Madrid',
  PMO: 'Europe/Rome', PNS: 'America/Chicago', POP: 'America/Santo_Domingo',
  POS: 'America/Port_of_Spain', PPT: 'Pacific/Tahiti', PRC: 'America/Phoenix',
  PSC: 'America/Los_Angeles', PUJ: 'America/Santo_Domingo', PVD: 'America/New_York',
  PWM: 'America/New_York', PXM: 'America/Mexico_City', QRO: 'America/Mexico_City',
  RAP: 'America/Denver', RDD: 'America/Los_Angeles', RDM: 'America/Los_Angeles',
  RIW: 'America/Denver', RKS: 'America/Denver', ROA: 'America/New_York', ROW: 'America/Denver',
  RTB: 'America/Tegucigalpa', SAF: 'America/Denver', SAL: 'America/El_Salvador',
  SAP: 'America/Tegucigalpa', SAV: 'America/New_York', SBA: 'America/Los_Angeles',
  SBP: 'America/Los_Angeles', SCE: 'America/New_York', SDF: 'America/Kentucky/Louisville',
  SDQ: 'America/Santo_Domingo', SGF: 'America/Chicago', SGU: 'America/Denver',
  SHR: 'America/Denver', SHV: 'America/Chicago', SJU: 'America/Puerto_Rico',
  SLN: 'America/Chicago', SLP: 'America/Mexico_City', SNN: 'Europe/Dublin',
  SRQ: 'America/New_York', STI: 'America/Santo_Domingo', STN: 'Europe/London',
  STT: 'America/St_Thomas', SUN: 'America/Boise', SUX: 'America/Chicago',
  SXM: 'America/Lower_Princes', TAM: 'America/Monterrey', TVC: 'America/Detroit',
  TYS: 'America/New_York', UIO: 'America/Guayaquil', UVF: 'America/St_Lucia', VCE: 'Europe/Rome',
  VCT: 'America/Chicago', VER: 'America/Mexico_City', WYS: 'America/Denver',
  XPL: 'America/Tegucigalpa', XWA: 'America/Chicago', YEG: 'America/Edmonton',
  YHZ: 'America/Halifax', YOW: 'America/Toronto', YQB: 'America/Toronto', YQR: 'America/Regina',
  YWG: 'America/Winnipeg', ZIH: 'America/Mexico_City',
});

/** The airport's IANA zone, or '' when we do not know it. */
export function airportTz(iata) {
  return AIRPORT_TZ[String(iata || '').toUpperCase()] || '';
}
