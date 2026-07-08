import { injectSpeedInsights } from '@vercel/speed-insights';
import { computeDelayRiskModel, HUB_COORDINATES, HUB_RISK_PROFILES } from '../lib/delay-risk.js';
import { formatDelayExplainFAAStatus, getScheduleRiskContext, describeFaaProgram } from '../lib/delay-explain-context.js';
import { getMetarStationForIata, INTL_AIRPORTS } from '../lib/airport-metadata.js';
import { chunkMetarStationIds, normalizeMetarPayload } from '../lib/metar.js';
import { categorizeFleetStatus, FLEET_HEALTH_CATEGORIES, FLEET_FAMILIES, normalizeWifi } from '../lib/fleet-utils.js';
import { bucketInstallsByMonth, computeInstallPace, buildDeparturesBoard } from '../lib/starlink-utils.js';
import { getFlightPopupMetrics } from '../lib/flight-popup.js';
import { getScheduleFleetFamily } from '../lib/schedule-filters.js';
import { classifySchedStatus } from '../lib/schedule-status.js';
import { getStartOfHubDay, getHubDayLabel } from '../lib/hubTz.js';
import { classifyConnection, MIN_CONNECTION_TIMES, TERMINAL_WALK_TIMES } from '../lib/connection-risk.js';
import { formatDataAge, dataAgeSeverity } from '../lib/data-age.js';
import { parseFr24Feed, applyFeedResult, feedFreshness, nextFeedRetryDelay } from '../lib/feed-health.js';
import { formatDelayMinutes, delayColorVar } from '../lib/delay-format.js';
import { firstFutureIndex, nowDividerIndex, effectiveRowTime } from '../lib/board-now.js';
import { deriveOpsHealth, hubProgramMarker } from '../lib/ops-health.js';
import { displayScheduleStatus } from '../lib/status-display.js';
import { computeScheduleStatCounts } from '../lib/board-stats.js';
import { recordSightings, lookupReg, pruneLedger, deserializeLedger, normalizeFlightNum } from '../lib/reg-ledger.js';
import { applySightingsToBoard } from '../lib/reg-overlay.js';

injectSpeedInsights();

// ═══════════════════════════════════════════════
// SVG ICON CONSTANTS — clean icons for buttons
// ═══════════════════════════════════════════════
const ICO_WATCH = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICO_WATCHING = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill="var(--ua-dark)"/></svg>';
const ICO_SHARE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
const ICO_EXTLINK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

// ═══════════════════════════════════════════════
// HUB LIST — CANONICAL REFERENCE
// All 9 United hubs: ORD, DEN, IAH, EWR, SFO, IAD, LAX, NRT, GUM
// When adding/removing a hub, update ALL of these locations:
//   1. AIRPORTS array (hub:true entries) — ~line 1010
//   2. hubCodes in updateHubHealth() — search "hubCodes"
//   3. SCHED_HUB_TZ — search "SCHED_HUB_TZ"
//   4. preloadHubs in schedule init — search "preloadHubs"
//   5. hubs arrays in hub health bar render — search "const hubs = ["
//   6. HUBS in api/irops.js
//   7. Hub health bar HTML (#hub-health-bar)
//   8. public/sitemap.xml
//   9. public/hubs/*.html (individual hub pages + nav in each)
//  10. Schema/SEO in <head> of this file
// ═══════════════════════════════════════════════

// ═══ DEBOUNCE UTILITY ═══
function debounce(fn, ms) { let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }

// ═══ HTML SANITIZATION ═══
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ═══════════════════════════════════════════════
// EMBEDDED DATA
// ═══════════════════════════════════════════════

let FLEET_DB = [];
// F035: track a fleet.json load failure so the Fleet tab can render an honest
// "database unavailable — retry" state instead of asserting "0 Mainline Aircraft".
let fleetLoadFailed = false;
let STARLINK_DB = [];
let STARLINK_TAILS = new Set();
let STARLINK_FLIGHTS_BY_TAIL = {};  // upcoming flights keyed by tail number
let STARLINK_FLEET_STATS = null;    // { mainline, express, total }
let STARLINK_LAST_UPDATED = null;   // ISO timestamp from upstream
let STARLINK_SYNCED_AT = null;      // ISO timestamp of the served snapshot (BB sync-starlink cron)
let STARLINK_INDUSTRY = null;       // [{ code, name, installed, total, percentage }] from /api/fleet-summary
let pendingFleetDeepLinkFilter = null;

// Build registration lookup
const FLEET_BY_REG = {};

async function loadFleetData() {
  try {
    // Fetch fleet + Starlink data + industry coverage in parallel (saves round trips).
    // The industry fetch is non-blocking: any failure resolves to null and the
    // "Starlink coverage by airline" strip simply doesn't render.
    const [fleetRes, starlinkResult, industryResult] = await Promise.all([
      fetch('/data/fleet.json'),
      fetch('/api/starlink-data').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/fleet-summary').then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    if (!fleetRes.ok) throw new Error('Fleet data load failed');
    FLEET_DB = await fleetRes.json();
    fleetLoadFailed = false;

    // Use live Starlink data if available
    let starlinkLoaded = false;
    if (starlinkResult && Array.isArray(starlinkResult.aircraft) && starlinkResult.aircraft.length > 0) {
      STARLINK_DB = starlinkResult.aircraft;
      STARLINK_FLIGHTS_BY_TAIL = starlinkResult.flightsByTail || {};
      STARLINK_FLEET_STATS = starlinkResult.fleetStats || null;
      STARLINK_LAST_UPDATED = starlinkResult.lastUpdated || null;
      STARLINK_SYNCED_AT = starlinkResult.syncedAt || null;
      starlinkLoaded = true;
    }

    // Fallback to static file
    if (!starlinkLoaded) {
      const starlinkRes = await fetch('/data/starlink.json');
      if (starlinkRes.ok) {
        STARLINK_DB = await starlinkRes.json();
      }
    }

    // Industry coverage strip data (optional). renderSlIndustry() re-validates
    // each row before painting, so we only need the array-or-null here.
    STARLINK_INDUSTRY = (industryResult && Array.isArray(industryResult.airlines) && industryResult.airlines.length > 0)
      ? industryResult.airlines : null;
  } catch (err) {
    console.error('Fleet data load error:', err);
    FLEET_DB = [];
    STARLINK_DB = [];
    fleetLoadFailed = true;
  }

  STARLINK_TAILS = new Set(STARLINK_DB.map(s => s.tail));
  Object.keys(FLEET_BY_REG).forEach(key => delete FLEET_BY_REG[key]);
  FLEET_DB.forEach(a => { FLEET_BY_REG[a.r] = a; });
  buildSpecialAircraftIndex();
}

// FLEET_HEALTH_CATEGORIES and categorizeFleetStatus imported from ../lib/fleet-utils.js

// ═══ SPECIAL AIRCRAFT DETECTION ═══
const SPECIAL_AIRCRAFT = {};

function buildSpecialAircraftIndex() {
  Object.keys(SPECIAL_AIRCRAFT).forEach(k => delete SPECIAL_AIRCRAFT[k]);
  FLEET_DB.forEach(a => {
    if (!a.s) return;
    if (a.s.startsWith('*')) {
      SPECIAL_AIRCRAFT[a.r] = { name: a.s.replace(/^\*+|\*+$/g, '').trim(), type: 'named' };
    } else if (/100 Year Sticker/i.test(a.s)) {
      SPECIAL_AIRCRAFT[a.r] = { name: '100 Year Sticker', type: 'livery' };
    } else if (/Eco Demonstrator/i.test(a.s)) {
      SPECIAL_AIRCRAFT[a.r] = { name: 'Eco Demonstrator Explorer', type: 'livery' };
    }
  });
}

function isSpecialAircraft(reg) {
  return SPECIAL_AIRCRAFT[reg] || null;
}

// ═══ ENGINE TYPE LOOKUP ═══
const ENGINE_BY_TYPE = {
  'A319':'IAE V2524-A5','A320':'IAE V2527-A5','A321neo':'CFM LEAP-1A',
  '737-700':'CFM56-7B22','737-800':'CFM56-7B26','737-900':'CFM56-7B26',
  '737-900ER':'CFM56-7B27','737 MAX 8':'CFM LEAP-1B28','737 MAX 9':'CFM LEAP-1B28',
  '757-200':'RB211-535E4B','757-300':'RB211-535E4B',
  '767-300ER':'CF6-80C2B7F','767-400ER':'CF6-80C2B8F',
  '777-200':'PW4077','777-200ER':'PW4090','777-300ER':'GE90-115B',
  '787-8':'GEnx-1B64','787-9':'GEnx-1B74','787-10':'GEnx-1B76'
};

// ═══ AIRPORT DATABASE (150 airports) ═══
const AIRPORTS = [
  // United Hubs
  {iata:"EWR",lat:40.6925,lon:-74.1687,hub:true},{iata:"IAH",lat:29.9844,lon:-95.3414,hub:true},
  {iata:"ORD",lat:41.9742,lon:-87.9073,hub:true},{iata:"DEN",lat:39.8561,lon:-104.6737,hub:true},
  {iata:"SFO",lat:37.6213,lon:-122.3790,hub:true},{iata:"LAX",lat:33.9425,lon:-118.4081,hub:true},
  {iata:"IAD",lat:38.9531,lon:-77.4565,hub:true},
  // Major US
  {iata:"ATL",lat:33.6407,lon:-84.4277},{iata:"DFW",lat:32.8998,lon:-97.0403},
  {iata:"JFK",lat:40.6413,lon:-73.7781},{iata:"LGA",lat:40.7769,lon:-73.8740},
  {iata:"SEA",lat:47.4502,lon:-122.3088},{iata:"BOS",lat:42.3656,lon:-71.0096},
  {iata:"PHX",lat:33.4373,lon:-112.0078},{iata:"MCO",lat:28.4312,lon:-81.3081},
  {iata:"CLT",lat:35.2140,lon:-80.9431},{iata:"MIA",lat:25.7959,lon:-80.2870},
  {iata:"FLL",lat:26.0742,lon:-80.1506},{iata:"MSP",lat:44.8848,lon:-93.2223},
  {iata:"DTW",lat:42.2162,lon:-83.3554},{iata:"PHL",lat:39.8744,lon:-75.2424},
  {iata:"SLC",lat:40.7899,lon:-111.9791},{iata:"SAN",lat:32.7338,lon:-117.1933},
  {iata:"TPA",lat:27.9755,lon:-82.5332},{iata:"PDX",lat:45.5898,lon:-122.5951},
  {iata:"BNA",lat:36.1263,lon:-86.6774},{iata:"STL",lat:38.7487,lon:-90.3700},
  {iata:"AUS",lat:30.1975,lon:-97.6664},{iata:"RDU",lat:35.8801,lon:-78.7880},
  {iata:"MCI",lat:39.2976,lon:-94.7139},{iata:"SMF",lat:38.6954,lon:-121.5908},
  {iata:"SJC",lat:37.3626,lon:-121.9290},{iata:"OAK",lat:37.7213,lon:-122.2208},
  {iata:"CLE",lat:41.4117,lon:-81.8498},{iata:"CMH",lat:39.9980,lon:-82.8919},
  {iata:"PIT",lat:40.4915,lon:-80.2329},{iata:"IND",lat:39.7173,lon:-86.2944},
  {iata:"MKE",lat:42.9472,lon:-87.8966},{iata:"RSW",lat:26.5362,lon:-81.7552},
  {iata:"JAX",lat:30.4941,lon:-81.6879},{iata:"BDL",lat:41.9389,lon:-72.6832},
  {iata:"ABQ",lat:35.0402,lon:-106.6090},{iata:"ONT",lat:34.0560,lon:-117.6012},
  {iata:"BUR",lat:34.2005,lon:-118.3585},{iata:"HNL",lat:21.3187,lon:-157.9225},
  {iata:"OGG",lat:20.8986,lon:-156.4305},{iata:"KOA",lat:19.7388,lon:-156.0456},
  {iata:"LIH",lat:21.9760,lon:-159.3390},{iata:"ANC",lat:61.1743,lon:-149.9962},
  {iata:"SNA",lat:33.6757,lon:-117.8682},{iata:"DAL",lat:32.8471,lon:-96.8518},
  {iata:"HOU",lat:29.6454,lon:-95.2789},{iata:"MDW",lat:41.7868,lon:-87.7522},
  {iata:"BWI",lat:39.1754,lon:-76.6683},{iata:"DCA",lat:38.8512,lon:-77.0402},
  {iata:"MSY",lat:29.9934,lon:-90.2580},{iata:"RNO",lat:39.4991,lon:-119.7681},
  {iata:"LAS",lat:36.0840,lon:-115.1537},{iata:"PBI",lat:26.6832,lon:-80.0956},
  {iata:"SAT",lat:29.5337,lon:-98.4698},{iata:"CHS",lat:32.8986,lon:-80.0405},
  {iata:"BOI",lat:43.5644,lon:-116.2228},{iata:"TUS",lat:32.1161,lon:-110.9410},
  {iata:"OMA",lat:41.3032,lon:-95.8941},{iata:"DSM",lat:41.5340,lon:-93.6631},
  {iata:"BUF",lat:42.9405,lon:-78.7322},{iata:"ROC",lat:43.1189,lon:-77.6724},
  {iata:"SYR",lat:43.1112,lon:-76.1063},{iata:"ALB",lat:42.7483,lon:-73.8017},
  {iata:"RIC",lat:37.5052,lon:-77.3197},{iata:"ORF",lat:36.8946,lon:-76.2012},
  {iata:"GSO",lat:36.0978,lon:-79.9373},{iata:"CVG",lat:39.0488,lon:-84.6678},
  {iata:"MEM",lat:35.0424,lon:-89.9767},{iata:"OKC",lat:35.3931,lon:-97.6007},
  {iata:"TUL",lat:36.1984,lon:-95.8881},{iata:"ELP",lat:31.8073,lon:-106.3778},
  {iata:"GEG",lat:47.6199,lon:-117.5338},{iata:"PSP",lat:33.8297,lon:-116.5067},
  {iata:"SBN",lat:41.7087,lon:-86.3173},{iata:"GRR",lat:42.8808,lon:-85.5228},
  {iata:"MSN",lat:43.1399,lon:-89.3375},{iata:"XNA",lat:36.2819,lon:-94.3068},
  {iata:"ICT",lat:37.6499,lon:-97.4331},{iata:"LIT",lat:34.7294,lon:-92.2243},
  // International
  {iata:"LHR",lat:51.4700,lon:-0.4543},{iata:"FRA",lat:50.0379,lon:8.5622},
  {iata:"CDG",lat:49.0097,lon:2.5479},{iata:"AMS",lat:52.3105,lon:4.7683},
  {iata:"MUC",lat:48.3538,lon:11.7861},{iata:"ZRH",lat:47.4647,lon:8.5492},
  {iata:"FCO",lat:41.8003,lon:12.2389},{iata:"MAD",lat:40.4983,lon:-3.5676},
  {iata:"BCN",lat:41.2974,lon:2.0833},{iata:"LIS",lat:38.7813,lon:-9.1359},
  {iata:"DUB",lat:53.4213,lon:-6.2701},{iata:"EDI",lat:55.9508,lon:-3.3615},
  {iata:"GUM",lat:13.4834,lon:144.7960,hub:true},{iata:"NRT",lat:35.7720,lon:140.3929,hub:true},{iata:"HND",lat:35.5494,lon:139.7798},
  {iata:"ICN",lat:37.4602,lon:126.4407},{iata:"PEK",lat:40.0799,lon:116.6031},
  {iata:"PVG",lat:31.1443,lon:121.8083},{iata:"HKG",lat:22.3080,lon:113.9185},
  {iata:"SIN",lat:1.3644,lon:103.9915},{iata:"BKK",lat:13.6900,lon:100.7501},
  {iata:"DEL",lat:28.5562,lon:77.1000},{iata:"BOM",lat:19.0896,lon:72.8656},
  {iata:"SYD",lat:-33.9399,lon:151.1753},{iata:"MEL",lat:-37.6690,lon:144.8410},
  {iata:"GRU",lat:-23.4356,lon:-46.4731},{iata:"EZE",lat:-34.8222,lon:-58.5358},
  {iata:"SCL",lat:-33.3930,lon:-70.7858},{iata:"BOG",lat:4.7016,lon:-74.1469},
  {iata:"MEX",lat:19.4363,lon:-99.0721},{iata:"CUN",lat:21.0365,lon:-86.8771},
  {iata:"GDL",lat:20.5218,lon:-103.3113},{iata:"SJD",lat:23.1518,lon:-109.7215},
  {iata:"PVR",lat:20.6801,lon:-105.2544},{iata:"LIM",lat:-12.0219,lon:-77.1143},
  {iata:"PTY",lat:9.0714,lon:-79.3835},{iata:"SJO",lat:9.9939,lon:-84.2088},
  {iata:"YYZ",lat:43.6777,lon:-79.6248},{iata:"YVR",lat:49.1967,lon:-123.1815},
  {iata:"YUL",lat:45.4706,lon:-73.7408},{iata:"YYC",lat:51.1315,lon:-114.0106},
  {iata:"TLV",lat:32.0114,lon:34.8867},{iata:"DOH",lat:25.2731,lon:51.6082},
  {iata:"DXB",lat:25.2532,lon:55.3657},{iata:"ADD",lat:8.9779,lon:38.7993},
  {iata:"ACC",lat:5.6052,lon:-0.1668},{iata:"CPT",lat:-33.9649,lon:18.6017},
  {iata:"JNB",lat:-26.1392,lon:28.2460},{iata:"CAI",lat:30.1219,lon:31.4056},
  {iata:"IST",lat:41.2753,lon:28.7519},{iata:"MNL",lat:14.5086,lon:121.0198},
  {iata:"TPE",lat:25.0777,lon:121.2327},{iata:"BRU",lat:50.9014,lon:4.4844},
  {iata:"OSL",lat:60.1976,lon:11.1004},{iata:"CPH",lat:55.6180,lon:12.6560},
  {iata:"ARN",lat:59.6519,lon:17.9186},{iata:"HEL",lat:60.3172,lon:24.9633}
];

const HUBS = AIRPORTS.filter(a => a.hub);
const HUB_CODES = HUBS.map(h => h.iata);

// ═══ HOME AIRPORT ═══
function getHomeAirport() { return localStorage.getItem('bb_home_airport') || ''; }
function setHomeAirport(code) {
  if (code) localStorage.setItem('bb_home_airport', code);
  else localStorage.removeItem('bb_home_airport');
  updateHomeHubDisplay();
}
function updateHomeHubDisplay() {
  const el = document.getElementById('home-hub-display');
  if (el) el.textContent = getHomeAirport() || '—';
}

// ═══ CONNECTION & DELAY DATA ═══
// MIN_CONNECTION_TIMES + TERMINAL_WALK_TIMES now live in ../lib/connection-risk.js
// (imported above) alongside the pure classifyConnection() verdict logic, so the
// cancelled/diverted + NaN guards (F003/F055) are unit-testable. Both tables are
// re-exported unchanged.
// Known United Airlines terminals at each hub (fallback when API doesn't provide terminal data)
const UNITED_HUB_TERMINALS = {
  ORD:{domestic:'1',international:'1'},       // Terminal 1 (B & C); Express uses T2
  DEN:{domestic:'B',international:'B'},       // Concourse B
  EWR:{domestic:'C',international:'C'},       // Terminal C (primary)
  IAH:{domestic:'C',international:'E'},       // Terminal C (domestic), Terminal E (international)
  SFO:{domestic:'3',international:'G'},       // Terminal 3 (domestic), International Terminal G
  LAX:{domestic:'7',international:'7'},       // Terminals 7 & 8
  IAD:{domestic:'C',international:'D'},       // Concourse C (domestic), Concourse D (international)
  NRT:{domestic:'1',international:'1'},       // Terminal 1
  GUM:{domestic:'1',international:'1'},       // Single terminal
};
function getUnitedTerminal(iata, origIata, destIata) {
  const hub = UNITED_HUB_TERMINALS[iata];
  if (!hub) return '';
  const isIntl = INTL_AIRPORTS.has(origIata) || INTL_AIRPORTS.has(destIata);
  return isIntl ? hub.international : hub.domestic;
}

// ═══ UA ROUTE LOOKUP TABLE ═══
// Static mapping of UA flight numbers to known city pairs (fallback for missing FR24 route data)
const UA_ROUTES = {
  1:{from:'SFO',to:'SIN'},2:{from:'SIN',to:'SFO'},3:{from:'SFO',to:'HKG'},4:{from:'HKG',to:'SFO'},
  5:{from:'SFO',to:'SYD'},6:{from:'SYD',to:'SFO'},7:{from:'SFO',to:'NRT'},8:{from:'NRT',to:'SFO'},
  9:{from:'EWR',to:'CDG'},10:{from:'CDG',to:'EWR'},11:{from:'EWR',to:'BRU'},12:{from:'BRU',to:'EWR'},
  17:{from:'EWR',to:'LHR'},18:{from:'LHR',to:'EWR'},21:{from:'EWR',to:'LIS'},22:{from:'LIS',to:'EWR'},
  23:{from:'SFO',to:'ICN'},24:{from:'ICN',to:'SFO'},25:{from:'EWR',to:'FRA'},26:{from:'FRA',to:'EWR'},
  27:{from:'EWR',to:'ZRH'},28:{from:'ZRH',to:'EWR'},29:{from:'EWR',to:'DUB'},30:{from:'DUB',to:'EWR'},
  31:{from:'EWR',to:'FCO'},32:{from:'FCO',to:'EWR'},33:{from:'EWR',to:'AMS'},34:{from:'AMS',to:'EWR'},
  35:{from:'SFO',to:'TPE'},36:{from:'TPE',to:'SFO'},37:{from:'EWR',to:'IST'},38:{from:'IST',to:'EWR'},
  39:{from:'EWR',to:'MAD'},40:{from:'MAD',to:'EWR'},41:{from:'EWR',to:'BCN'},42:{from:'BCN',to:'EWR'},
  43:{from:'SFO',to:'BKK'},44:{from:'BKK',to:'SFO'},45:{from:'IAH',to:'LHR'},46:{from:'LHR',to:'IAH'},
  50:{from:'EWR',to:'TLV'},51:{from:'TLV',to:'EWR'},52:{from:'IAD',to:'LHR'},53:{from:'LHR',to:'IAD'},
  54:{from:'SFO',to:'DEL'},55:{from:'DEL',to:'SFO'},56:{from:'EWR',to:'DEL'},57:{from:'DEL',to:'EWR'},
  58:{from:'EWR',to:'EDI'},59:{from:'EDI',to:'EWR'},60:{from:'EWR',to:'MUC'},61:{from:'MUC',to:'EWR'},
  62:{from:'EWR',to:'CPH'},63:{from:'CPH',to:'EWR'},64:{from:'EWR',to:'HEL'},65:{from:'HEL',to:'EWR'},
  66:{from:'EWR',to:'ARN'},67:{from:'ARN',to:'EWR'},68:{from:'EWR',to:'OSL'},69:{from:'OSL',to:'EWR'},
  70:{from:'IAD',to:'CDG'},71:{from:'CDG',to:'IAD'},72:{from:'IAD',to:'FRA'},73:{from:'FRA',to:'IAD'},
  78:{from:'ORD',to:'LHR'},79:{from:'LHR',to:'ORD'},80:{from:'ORD',to:'FRA'},81:{from:'FRA',to:'ORD'},
  82:{from:'ORD',to:'CDG'},83:{from:'CDG',to:'ORD'},84:{from:'ORD',to:'MUC'},85:{from:'MUC',to:'ORD'},
  86:{from:'ORD',to:'NRT'},87:{from:'NRT',to:'ORD'},88:{from:'ORD',to:'PEK'},89:{from:'PEK',to:'ORD'},
  90:{from:'ORD',to:'ICN'},91:{from:'ICN',to:'ORD'},92:{from:'ORD',to:'HND'},93:{from:'HND',to:'ORD'},
  94:{from:'ORD',to:'DEL'},95:{from:'DEL',to:'ORD'},96:{from:'SFO',to:'PVG'},97:{from:'PVG',to:'SFO'},
  100:{from:'EWR',to:'PEK'},101:{from:'PEK',to:'EWR'},102:{from:'EWR',to:'PVG'},103:{from:'PVG',to:'EWR'},
  106:{from:'EWR',to:'HND'},107:{from:'HND',to:'EWR'},108:{from:'EWR',to:'NRT'},109:{from:'NRT',to:'EWR'},
  116:{from:'SFO',to:'MNL'},117:{from:'MNL',to:'SFO'},118:{from:'IAH',to:'NRT'},119:{from:'NRT',to:'IAH'},
  120:{from:'LAX',to:'SYD'},121:{from:'SYD',to:'LAX'},122:{from:'LAX',to:'MEL'},123:{from:'MEL',to:'LAX'},
  130:{from:'IAD',to:'TLV'},131:{from:'TLV',to:'IAD'},132:{from:'IAH',to:'EZE'},133:{from:'EZE',to:'IAH'},
  134:{from:'IAH',to:'GRU'},135:{from:'GRU',to:'IAH'},136:{from:'EWR',to:'GRU'},137:{from:'GRU',to:'EWR'},
  138:{from:'IAH',to:'SCL'},139:{from:'SCL',to:'IAH'},142:{from:'IAH',to:'BOG'},143:{from:'BOG',to:'IAH'},
  146:{from:'IAH',to:'LIM'},147:{from:'LIM',to:'IAH'},148:{from:'EWR',to:'BOG'},149:{from:'BOG',to:'EWR'},
  150:{from:'DEN',to:'NRT'},151:{from:'NRT',to:'DEN'},152:{from:'LAX',to:'NRT'},153:{from:'NRT',to:'LAX'},
  154:{from:'LAX',to:'ICN'},155:{from:'ICN',to:'LAX'},156:{from:'LAX',to:'PVG'},157:{from:'PVG',to:'LAX'},
  160:{from:'SFO',to:'LHR'},161:{from:'LHR',to:'SFO'},162:{from:'IAH',to:'FRA'},163:{from:'FRA',to:'IAH'},
  168:{from:'EWR',to:'SIN'},169:{from:'SIN',to:'EWR'},170:{from:'SFO',to:'FRA'},171:{from:'FRA',to:'SFO'},
  174:{from:'EWR',to:'HKG'},175:{from:'HKG',to:'EWR'},176:{from:'EWR',to:'BOM'},177:{from:'BOM',to:'EWR'},
  178:{from:'DEN',to:'LHR'},179:{from:'LHR',to:'DEN'},180:{from:'DEN',to:'FRA'},181:{from:'FRA',to:'DEN'},
  182:{from:'IAH',to:'MEX'},183:{from:'MEX',to:'IAH'},186:{from:'ORD',to:'DUB'},187:{from:'DUB',to:'ORD'},
  194:{from:'LAX',to:'LHR'},195:{from:'LHR',to:'LAX'},198:{from:'IAH',to:'CUN'},199:{from:'CUN',to:'IAH'},
  200:{from:'SFO',to:'GRU'},201:{from:'GRU',to:'SFO'},204:{from:'IAH',to:'PTY'},205:{from:'PTY',to:'IAH'},
  214:{from:'IAD',to:'IST'},215:{from:'IST',to:'IAD'},218:{from:'DEN',to:'NRT'},219:{from:'NRT',to:'DEN'},
  234:{from:'ORD',to:'AMS'},235:{from:'AMS',to:'ORD'},238:{from:'ORD',to:'IST'},239:{from:'IST',to:'ORD'},
  250:{from:'ORD',to:'BCN'},251:{from:'BCN',to:'ORD'},252:{from:'ORD',to:'ZRH'},253:{from:'ZRH',to:'ORD'},
  254:{from:'ORD',to:'FCO'},255:{from:'FCO',to:'ORD'},262:{from:'ORD',to:'EDI'},263:{from:'EDI',to:'ORD'},
  315:{from:'DEN',to:'HND'},316:{from:'HND',to:'DEN'},400:{from:'DEN',to:'SFO'},401:{from:'SFO',to:'DEN'},
  444:{from:'EWR',to:'LAX'},445:{from:'LAX',to:'EWR'},500:{from:'SFO',to:'EWR'},501:{from:'EWR',to:'SFO'},
  507:{from:'LAX',to:'HNL'},508:{from:'HNL',to:'LAX'},509:{from:'SFO',to:'HNL'},510:{from:'HNL',to:'SFO'},
  708:{from:'ORD',to:'DOH'},709:{from:'DOH',to:'ORD'},730:{from:'IAD',to:'ADD'},731:{from:'ADD',to:'IAD'},
  733:{from:'IAD',to:'ACC'},734:{from:'ACC',to:'IAD'},735:{from:'IAD',to:'JNB'},736:{from:'JNB',to:'IAD'},
  737:{from:'EWR',to:'CPT'},738:{from:'CPT',to:'EWR'},780:{from:'EWR',to:'DOH'},781:{from:'DOH',to:'EWR'},
  788:{from:'EWR',to:'DXB'},789:{from:'DXB',to:'EWR'},838:{from:'SFO',to:'ICN'},839:{from:'ICN',to:'SFO'},
  857:{from:'SFO',to:'PEK'},858:{from:'PEK',to:'SFO'},872:{from:'SFO',to:'HND'},873:{from:'HND',to:'SFO'},
  875:{from:'SFO',to:'NRT'},876:{from:'NRT',to:'SFO'},881:{from:'LAX',to:'HND'},882:{from:'HND',to:'LAX'},
  893:{from:'IAH',to:'SYD'},894:{from:'SYD',to:'IAH'},896:{from:'SFO',to:'MEL'},897:{from:'MEL',to:'SFO'},
  1100:{from:'EWR',to:'SFO'},1101:{from:'SFO',to:'EWR'},1200:{from:'SFO',to:'ORD'},1201:{from:'ORD',to:'SFO'},
  1300:{from:'DEN',to:'EWR'},1301:{from:'EWR',to:'DEN'},1400:{from:'IAH',to:'SFO'},1401:{from:'SFO',to:'IAH'},
  1500:{from:'DEN',to:'LAX'},1501:{from:'LAX',to:'DEN'},1600:{from:'ORD',to:'LAX'},1601:{from:'LAX',to:'ORD'},
  1700:{from:'DEN',to:'ORD'},1701:{from:'ORD',to:'DEN'},1800:{from:'IAH',to:'EWR'},1801:{from:'EWR',to:'IAH'},
  1900:{from:'IAD',to:'LAX'},1901:{from:'LAX',to:'IAD'},2000:{from:'IAD',to:'SFO'},2001:{from:'SFO',to:'IAD'}
};

// ═══ IATA → CITY NAME MAPPING ═══
const IATA_CITIES = {
  // United Hubs
  EWR:'Newark',IAH:'Houston',ORD:'Chicago O\'Hare',DEN:'Denver',SFO:'San Francisco',LAX:'Los Angeles',IAD:'Washington Dulles',
  // Major US
  ATL:'Atlanta',DFW:'Dallas/Fort Worth',JFK:'New York JFK',LGA:'New York LaGuardia',SEA:'Seattle',BOS:'Boston',
  PHX:'Phoenix',MCO:'Orlando',CLT:'Charlotte',MIA:'Miami',FLL:'Fort Lauderdale',MSP:'Minneapolis',
  DTW:'Detroit',PHL:'Philadelphia',SLC:'Salt Lake City',SAN:'San Diego',TPA:'Tampa',PDX:'Portland',
  BNA:'Nashville',STL:'St. Louis',AUS:'Austin',RDU:'Raleigh-Durham',MCI:'Kansas City',SMF:'Sacramento',
  SJC:'San José',OAK:'Oakland',CLE:'Cleveland',CMH:'Columbus',PIT:'Pittsburgh',IND:'Indianapolis',
  MKE:'Milwaukee',RSW:'Fort Myers',JAX:'Jacksonville',BDL:'Hartford',ABQ:'Albuquerque',ONT:'Ontario',
  BUR:'Burbank',HNL:'Honolulu',OGG:'Maui Kahului',KOA:'Kona',LIH:'Kauai Lihue',ANC:'Anchorage',
  SNA:'Orange County',DAL:'Dallas Love',HOU:'Houston Hobby',MDW:'Chicago Midway',BWI:'Baltimore',
  DCA:'Washington Reagan',MSY:'New Orleans',RNO:'Reno',LAS:'Las Vegas',PBI:'West Palm Beach',
  SAT:'San Antonio',CHS:'Charleston',BOI:'Boise',TUS:'Tucson',OMA:'Omaha',DSM:'Des Moines',
  BUF:'Buffalo',ROC:'Rochester',SYR:'Syracuse',ALB:'Albany',RIC:'Richmond',ORF:'Norfolk',
  GSO:'Greensboro',CVG:'Cincinnati',MEM:'Memphis',OKC:'Oklahoma City',TUL:'Tulsa',ELP:'El Paso',
  GEG:'Spokane',PSP:'Palm Springs',SBN:'South Bend',GRR:'Grand Rapids',MSN:'Madison',XNA:'Fayetteville',
  ICT:'Wichita',LIT:'Little Rock',
  // Europe
  LHR:'London Heathrow',FRA:'Frankfurt',CDG:'Paris CDG',AMS:'Amsterdam',MUC:'Munich',ZRH:'Zurich',
  FCO:'Rome Fiumicino',MAD:'Madrid',BCN:'Barcelona',LIS:'Lisbon',DUB:'Dublin',EDI:'Edinburgh',
  BRU:'Brussels',OSL:'Oslo',CPH:'Copenhagen',ARN:'Stockholm',HEL:'Helsinki',IST:'Istanbul',
  // Asia-Pacific
  GUM:'Guam',NRT:'Tokyo Narita',HND:'Tokyo Haneda',ICN:'Seoul Incheon',PEK:'Beijing',PVG:'Shanghai Pudong',
  HKG:'Hong Kong',SIN:'Singapore',BKK:'Bangkok',DEL:'Delhi',BOM:'Mumbai',MNL:'Manila',TPE:'Taipei',
  SYD:'Sydney',MEL:'Melbourne',
  // Americas (International)
  GRU:'São Paulo',EZE:'Buenos Aires',SCL:'Santiago',BOG:'Bogotá',MEX:'Mexico City',CUN:'Cancún',
  GDL:'Guadalajara',SJD:'Los Cabos',PVR:'Puerto Vallarta',LIM:'Lima',PTY:'Panama City',SJO:'San José CR',
  YYZ:'Toronto',YVR:'Vancouver',YUL:'Montreal',YYC:'Calgary',
  // Middle East & Africa
  TLV:'Tel Aviv',DOH:'Doha',DXB:'Dubai',ADD:'Addis Ababa',ACC:'Accra',CPT:'Cape Town',
  JNB:'Johannesburg',CAI:'Cairo'
};

// ═══ GLOBALS ═══
let map, flightMarkers = {}, routeLine = null, routeGroup = null, hubMarkers = [], wxLayer = null;
let allFlights = [], showHubs = true, showLonghaul = false, showWeather = false, showStarlinkOnly = false;
// Seen-today reg ledger: flightNumber → {reg, seenAt} harvested from every live-feed poll,
// used to backfill blank schedule-board registrations (see src/lib/reg-ledger.js).
const REG_LEDGER_KEY = 'bb_reg_ledger_v1';
let regLedger = {};
try { regLedger = deserializeLedger(localStorage.getItem(REG_LEDGER_KEY)); } catch (e) { regLedger = {}; }
function recordRegSightings(flights) {
  recordSightings(regLedger, flights, Date.now());
  pruneLedger(regLedger, Date.now());
  try { localStorage.setItem(REG_LEDGER_KEY, JSON.stringify(regLedger)); } catch (e) { /* private mode / quota */ }
}
// Single source of truth for a schedule row's registration: provider value first, ledger
// backfill second. EVERY schedule consumer (row render, Starlink filter, tail search, reg
// sort) must go through this — a row that shows a backfilled ⚡ tail but doesn't match the
// Starlink filter or a search for that tail is a lie of inconsistency.
function schedRegFor(fl) {
  return fl.aircraft?.registration
    || lookupReg(regLedger, fl.identification?.number?.default,
         fl.time?.scheduled?.departure, fl.time?.scheduled?.arrival, Date.now())
    || '';
}
let activeHubFilter = null, activePhaseFilter = null;
let refreshTimer = null, countdown = 30;
let deepLinkHandled = false;

function isSmallScreenViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function getBasemapTileOptions() {
  const smallScreen = isSmallScreenViewport();
  return {
    maxZoom: 18,
    subdomains: smallScreen ? 'ab' : 'abcd',
    tileSize: 256,
    detectRetina: !smallScreen && window.devicePixelRatio > 1,
    // ODbL requires visible credit wherever CARTO/OSM tiles are drawn. Both maps share these
    // options, so the attribution control picks this up automatically — never re-suppress the
    // control in the L.map() options (audit: ODbL violation; pinned by tests/compliance.test.js).
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>'
  };
}

// ═══ TAB SWITCHING ═══
const TAB_HASHES = {'tab-myflight':'#myflight','tab-live':'#live','tab-schedule':'#schedule','tab-fleet':'#fleet','tab-starlink':'#starlink','tab-weather':'#weather','tab-analytics':'#stats','tab-sources':'#sources'};
const HASH_TABS = Object.fromEntries(Object.entries(TAB_HASHES).map(([k,v])=>[v,k]));

function switchToTab(tabId, updateHash) {
  document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); b.setAttribute('tabindex', '-1'); });
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (!btn) return;
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  btn.setAttribute('tabindex', '0');
  document.getElementById(tabId).classList.add('active');
  if (updateHash !== false && TAB_HASHES[tabId]) history.replaceState(null, '', TAB_HASHES[tabId]);
  // Defer heavy tab-specific init to next frame so the click event completes fast (INP fix)
  requestAnimationFrame(() => {
    if (tabId === 'tab-myflight') renderMyFlights();
    if (tabId === 'tab-live' && map) map.invalidateSize();
    if (tabId === 'tab-schedule') { initScheduleTab(); if (schedInitialized && !schedAllFlights.length && !schedLoading) loadScheduleData(); }
    if (tabId === 'tab-fleet') { if (!allFlights.length && !flightsLoading) refreshFlights(); updateLiveFleetPanel(); }
    if (tabId === 'tab-starlink') { if (!allFlights.length && !flightsLoading) refreshFlights(); initStarlinkTab(); }
    if (tabId === 'tab-weather') initWeatherTab();
    if (tabId === 'tab-analytics') updateAnalytics();
  });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
});
// Keyboard navigation for tabs (arrow keys, Home, End)
document.getElementById('tab-bar')?.addEventListener('keydown', function(e) {
  const tabs = Array.from(this.querySelectorAll('.tab-btn'));
  const idx = tabs.indexOf(document.activeElement);
  if (idx < 0) return;
  let next = -1;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % tabs.length;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = tabs.length - 1;
  if (next >= 0) { e.preventDefault(); tabs[next].focus(); tabs[next].click(); }
});

// Deep-link hash on load — visual only (no data loads until initApp finishes)
(function(){
  const h = location.hash;
  if (h && HASH_TABS[h]) {
    const tabId = HASH_TABS[h];
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(p => p.classList.toggle('active', p.id === tabId));
  }
})();

// ═══ QUERY PARAM DEEP-LINKING (hub pages) ═══
(function(){
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab');
  const hub = params.get('hub');
  const fleetFilter = params.get('type') || params.get('filter');
  if (!tab) return;

  // Map ?tab= values to internal tab IDs
  const TAB_MAP = {
    'myflight': 'tab-myflight',
    'live': 'tab-live',
    'schedule': 'tab-schedule',
    'fleet': 'tab-fleet',
    'starlink': 'tab-starlink',
    'weather': 'tab-weather',
    'irops': 'tab-weather',
    'stats': 'tab-analytics',
    'sources': 'tab-sources'
  };

  const tabId = TAB_MAP[tab];
  if (!tabId) return;
  // Visual-only tab switch — data loads deferred to initApp
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(p => p.classList.toggle('active', p.id === tabId));

  // After tab switch, handle sub-navigation
  requestAnimationFrame(() => {
    setTimeout(() => {
      // Scroll to IROPS section if requested
      if (tab === 'irops') {
        const el = document.getElementById('irops-section');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      // Fleet tab: support deep links for either status shortcuts or a specific aircraft type.
      if (tab === 'fleet' && fleetFilter) {
        pendingFleetDeepLinkFilter = fleetFilter;
        applyFleetDeepLinkFilter(fleetFilter, { render: FLEET_DB.length > 0 });
      }

      // Fleet tab: support sub-tab deep links via ?view=starlink|airborne|special
      if (tab === 'fleet') {
        const viewParam = params.get('view');
        if (viewParam === 'starlink') {
          // Starlink is now its own top-level tab — redirect the legacy fleet sub-view deep link.
          switchToTab('tab-starlink');
        } else if (viewParam && ['airborne','special'].includes(viewParam)) {
          // Defer to after fleet data loads
          const waitForFleet = setInterval(() => {
            if (typeof switchFleetView === 'function' && FLEET_DB.length > 0) {
              clearInterval(waitForFleet);
              switchFleetView(viewParam);
            }
          }, 200);
          setTimeout(() => clearInterval(waitForFleet), 10000);
        }
      }

      // Schedule tab: filter by hub airport
      if (tab === 'schedule' && hub) {
        const searchInput = document.getElementById('sched-search');
        if (searchInput) { searchInput.value = hub.toUpperCase(); searchInput.dispatchEvent(new Event('input')); }
      }
    }, 500); // wait for tab content to render
  });
})();

function applyFleetDeepLinkFilter(filter, { render = true } = {}) {
  const statusSel = document.getElementById('fleet-filter-status');
  const typeSel = document.getElementById('fleet-filter-type');
  if (!statusSel || !typeSel) return false;

  const statusValues = new Set(Array.from(statusSel.options).map(opt => opt.value).filter(Boolean));
  const typeValues = new Set(Array.from(typeSel.options).map(opt => opt.value).filter(Boolean));

  if (statusValues.has(filter)) {
    statusSel.value = filter;
    typeSel.value = '';
    if (render) renderFleetTable();
    return true;
  }

  if (typeValues.has(filter)) {
    typeSel.value = filter;
    statusSel.value = '';
    if (render) renderFleetTable();
    return true;
  }

  return false;
}

// ═══ MOBILE BOTTOM NAV (4 tabs + More menu) ═══
(function(){
  var moreBtn = document.getElementById('mobile-more-btn');
  var moreMenu = document.getElementById('mobile-more-menu');
  // Direct tab buttons (not More, not overflow)
  document.querySelectorAll('#mobile-bottom-nav button[data-tab]:not(.bnav-overflow-item)').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#mobile-bottom-nav button').forEach(function(b) { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      if (moreMenu) moreMenu.classList.remove('open');
      switchToTab(btn.dataset.tab);
    });
  });
  // More button toggle
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      moreMenu.classList.toggle('open');
      moreBtn.setAttribute('aria-expanded', moreMenu.classList.contains('open') ? 'true' : 'false');
    });
    // More menu items
    moreMenu.querySelectorAll('button[data-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        moreMenu.classList.remove('open');
        moreBtn.setAttribute('aria-expanded', 'false');
        document.querySelectorAll('#mobile-bottom-nav button').forEach(function(b) { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        moreBtn.classList.add('active');
        moreBtn.setAttribute('aria-selected', 'true');
        switchToTab(btn.dataset.tab);
      });
    });
    // Dismiss on outside tap
    document.addEventListener('click', function(e) {
      if (!moreMenu.contains(e.target) && e.target !== moreBtn) {
        moreMenu.classList.remove('open');
        moreBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }
})();
// Sync bottom nav active state when switchToTab is called from elsewhere
const _origSwitchToTab = switchToTab;
switchToTab = function(tabId, updateHash) {
  _origSwitchToTab(tabId, updateHash);
  var overflowTabs = ['tab-myflight','tab-analytics','tab-sources'];
  var moreBtn = document.getElementById('mobile-more-btn');
  document.querySelectorAll('#mobile-bottom-nav button[data-tab]:not(.bnav-overflow-item)').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  if (moreBtn) moreBtn.classList.toggle('active', overflowTabs.indexOf(tabId) !== -1);
};

// ═══ MOBILE MAP CONTROLS TOGGLE (Change 1) ═══
(function(){
  var toggle = document.getElementById('mobile-ctrl-toggle');
  var controls = document.getElementById('controls');
  if (toggle && controls) {
    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      controls.classList.toggle('ctrl-menu-open');
    });
    document.addEventListener('click', function(e) {
      if (!controls.contains(e.target)) {
        controls.classList.remove('ctrl-menu-open');
      }
    });
  }
})();

// ═══ TICKER FADE ROTATION (mobile + canopy) ═══
(function(){
  var mobileTickerQuery = window.matchMedia('(max-width: 768px)');
  // Fade-rotation applies on mobile AND whenever the ticker lives inside the canopy
  // (#header). A marquee scroll is unreadable in the canopy's narrow flex zone: content
  // clips and there are long blank gaps between cycles. Structural check (not a width
  // measurement) so it can't race against data population changing the zone's size.
  var useFadeRotation = function() {
    if (mobileTickerQuery.matches) return true;
    return !!document.querySelector('#header .ticker-wrap');
  };
  var rotateInterval = null;
  var fadeTimeout = null;
  var currentIndex = 0;

  function clearMobileTickerState() {
    if (fadeTimeout) { clearTimeout(fadeTimeout); fadeTimeout = null; }
    clearInterval(rotateInterval);
    rotateInterval = null;

    var ticker = document.getElementById('ticker');
    if (!ticker) return;
    var items = ticker.querySelectorAll('.ticker-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('mobile-active', 'mobile-fade-out');
    }
  }

  function setupMobileTicker() {
    var ticker = document.getElementById('ticker');
    if (!ticker) return;
    var items = ticker.querySelectorAll('.ticker-item');
    var uniqueCount = Math.ceil(items.length / 2);

    if (!useFadeRotation() || uniqueCount === 0) {
      clearMobileTickerState();
      return;
    }

    // If rotation is already running, just re-apply visibility to current item
    // (innerHTML wipe from data refresh removes all classes — don't restart)
    if (rotateInterval !== null) {
      if (currentIndex >= uniqueCount) currentIndex = 0;
      for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('mobile-active', 'mobile-fade-out');
      }
      if (items[currentIndex]) items[currentIndex].classList.add('mobile-active');
      return;
    }

    // First-time setup
    currentIndex = 0;
    if (items[0]) items[0].classList.add('mobile-active');

    if (uniqueCount <= 1) return;

    rotateInterval = setInterval(function() {
      if (!useFadeRotation()) { clearInterval(rotateInterval); rotateInterval = null; return; }
      var items = ticker.querySelectorAll('.ticker-item');
      var uniqueCount = Math.ceil(items.length / 2);
      if (uniqueCount <= 1) return;

      var current = items[currentIndex];
      if (current) {
        current.classList.add('mobile-fade-out');
        fadeTimeout = setTimeout(function() {
          fadeTimeout = null;
          current.classList.remove('mobile-active', 'mobile-fade-out');
          currentIndex = (currentIndex + 1) % uniqueCount;
          var next = items[currentIndex];
          if (next) next.classList.add('mobile-active');
        }, 400);
      }
    }, 5000);
  }

  // Run on load and whenever ticker content changes
  var tickerEl = document.getElementById('ticker');
  if (tickerEl) {
    var observer = new MutationObserver(function() { setTimeout(setupMobileTicker, 50); });
    observer.observe(tickerEl, { childList: true, subtree: true });
  }

  function handleTickerViewportChange() {
    // setupMobileTicker self-gates on useFadeRotation(), which covers both
    // mobile and the narrow canopy zone — just re-run it on breakpoint changes.
    setupMobileTicker();
  }

  // Mobile browsers emit resize events while their toolbar expands/collapses.
  // Listen for breakpoint changes instead so the ticker does not keep resetting.
  if (typeof mobileTickerQuery.addEventListener === 'function') {
    mobileTickerQuery.addEventListener('change', handleTickerViewportChange);
  } else if (typeof mobileTickerQuery.addListener === 'function') {
    mobileTickerQuery.addListener(handleTickerViewportChange);
  }
  setTimeout(setupMobileTicker, 1000);
})();

// ═══ MOBILE SEARCH TOGGLE ═══
(function(){
  const btn = document.getElementById('mobile-search-toggle');
  const wrap = document.getElementById('global-search-wrap');
  if (btn && wrap) {
    btn.addEventListener('click', () => {
      wrap.classList.toggle('mobile-search-open');
      if (wrap.classList.contains('mobile-search-open')) {
        document.getElementById('global-search-input').focus();
      }
    });
  }
})();

// ═══ MOBILE SIDEBAR TOGGLE ═══
(function(){
  const btn = document.getElementById('mobile-sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  if (btn && sidebar) {
    btn.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-sidebar-open');
      btn.textContent = sidebar.classList.contains('mobile-sidebar-open') ? '🔍 Filters ▴' : '🔍 Filters ▾';
      if (map) setTimeout(() => map.invalidateSize(), 300);
    });
  }
})();

// ═══ CLOCK ═══
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toUTCString().slice(17, 25) + 'Z';
}
setInterval(updateClock, 1000);
updateClock();

// ═══ AIRPORT MATCHING ═══
function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // nm
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function bearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function angleDiff(a, b) { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

function estimateRoute(lat, lon, hdg, alt, vr, flightNum) {
  // Try static UA route lookup first
  if (flightNum) {
    const num = parseInt(String(flightNum).replace(/^UA/i, '').replace(/^UAL/i, ''), 10);
    if (num && UA_ROUTES[num]) {
      const r = UA_ROUTES[num];
      const oApt = AIRPORTS.find(a => a.iata === r.from);
      const dApt = AIRPORTS.find(a => a.iata === r.to);
      if (oApt && dApt) return { origin: oApt, dest: dApt };
    }
  }
  if (!lat || !lon || hdg === null || hdg === undefined) return { origin: null, dest: null };
  const reverseHdg = (hdg + 180) % 360;
  let bestOrigin = null, bestDest = null;
  let bestOrigDist = Infinity, bestDestDist = Infinity;
  const lowAlt = alt !== null && alt < 5000;
  const tolerance = lowAlt ? 90 : 60;

  for (const apt of AIRPORTS) {
    const dist = haversine(lat, lon, apt.lat, apt.lon);
    const brng = bearing(lat, lon, apt.lat, apt.lon);

    // Behind aircraft = origin
    if (angleDiff(brng, reverseHdg) < tolerance && dist < bestOrigDist && dist < 2000) {
      bestOrigDist = dist; bestOrigin = apt;
    }
    // Ahead = destination
    if (angleDiff(brng, hdg) < tolerance && dist < bestDestDist && dist < 2000) {
      bestDestDist = dist; bestDest = apt;
    }
  }

  // For low altitude, nearest airport is likely origin or dest
  if (lowAlt) {
    let nearest = null, nearDist = Infinity;
    for (const apt of AIRPORTS) {
      const d = haversine(lat, lon, apt.lat, apt.lon);
      if (d < nearDist) { nearDist = d; nearest = apt; }
    }
    if (nearest && nearDist < 50) {
      if (vr > 0) bestOrigin = nearest;
      else bestDest = nearest;
    }
  }

  // Don't let origin = dest
  if (bestOrigin && bestDest && bestOrigin.iata === bestDest.iata) {
    if (bestOrigDist < bestDestDist) bestDest = null;
    else bestOrigin = null;
  }

  return { origin: bestOrigin, dest: bestDest };
}

// ═══ FLIGHT PHASE ═══
function getPhase(alt, vr, spd) {
  const altFt = alt != null ? alt * 3.28084 : null;
  const vrFpm = vr != null ? vr * 196.85 : null; // m/s to fpm
  const spdKts = spd != null ? spd * 1.944 : null;

  if (altFt !== null && altFt < 100 && spdKts !== null && spdKts < 50) return { phase: 'Ground', icon: '🅿️', cls: 'phase-ground' };
  if (altFt !== null && altFt < 5000 && vrFpm !== null && vrFpm > 500) return { phase: 'Takeoff', icon: '🛫', cls: 'phase-climb' };
  if (altFt !== null && altFt < 5000 && vrFpm !== null && vrFpm < -300) return { phase: 'Approach', icon: '🛬', cls: 'phase-approach' };
  if (vrFpm !== null && vrFpm > 300) return { phase: 'Climb', icon: '↗️', cls: 'phase-climb' };
  if (vrFpm !== null && vrFpm < -300) return { phase: 'Descent', icon: '↘️', cls: 'phase-descent' };
  if (altFt !== null && altFt > 25000) return { phase: 'Cruise', icon: '✈️', cls: 'phase-cruise' };
  return { phase: 'En Route', icon: '✈️', cls: 'phase-cruise' };
}

// ═══ SQUAWK DECODER ═══
function decodeSquawk(sq) {
  if (!sq) return null;
  const s = String(sq);
  if (s === '7500') return { text: '⚠️ HIJACK', cls: 'squawk-alert' };
  if (s === '7600') return { text: '⚠️ RADIO FAILURE', cls: 'squawk-alert' };
  if (s === '7700') return { text: '⚠️ EMERGENCY', cls: 'squawk-alert' };
  if (s === '1200') return { text: 'VFR', cls: '' };
  return null;
}

// ═══ ICAO24 to N-number (approximate) ═══
function icao24ToNNumber(hex) {
  // US registrations: A00001-AFFFFF (hex)
  const h = parseInt(hex, 16);
  if (h < 0xA00001 || h > 0xAFFFFF) return null;
  const offset = h - 0xA00001;
  // Simplified mapping - not perfectly accurate but works for many
  const d1 = Math.floor(offset / 101711);
  const rem1 = offset % 101711;
  const d2 = Math.floor(rem1 / 10111);
  const rem2 = rem1 % 10111;
  const d3 = Math.floor(rem2 / 951);
  const rem3 = rem2 % 951;

  let nnum = 'N' + (d1 + 1);
  if (d2 > 0) {
    nnum += d2 - 1;
    if (d3 > 0) {
      nnum += d3 - 1;
      if (rem3 > 0) {
        if (rem3 <= 25) nnum += String.fromCharCode(64 + rem3);
        else {
          const d4 = Math.floor((rem3 - 1) / 25);
          const r4 = (rem3 - 1) % 25;
          nnum += d4;
          if (r4 > 0) nnum += String.fromCharCode(64 + r4);
        }
      }
    } else if (rem3 > 0) {
      if (rem3 <= 25) nnum += String.fromCharCode(64 + rem3);
      else {
        nnum += Math.floor((rem3 - 1) / 25);
      }
    }
  } else if (rem2 > 0) {
    if (rem2 <= 25) nnum += String.fromCharCode(64 + rem2);
  }
  return nnum;
}

function matchAircraft(f) {
  // FR24 gives us registration directly — try that first
  if (f.reg) {
    const reg = f.reg.replace('-', '');
    if (FLEET_BY_REG[reg]) return { ...FLEET_BY_REG[reg], nnum: reg };
    if (FLEET_BY_REG[f.reg]) return { ...FLEET_BY_REG[f.reg], nnum: f.reg };
  }
  // Fallback to ICAO24 conversion
  if (f.icao24) {
    const nnum = icao24ToNNumber(f.icao24);
    if (nnum && FLEET_BY_REG[nnum]) return { ...FLEET_BY_REG[nnum], nnum };
  }
  return null;
}

// Single source of truth for "is this live flight a Starlink-equipped tail?".
// Mirrors the popup badge: prefer matchAircraft(f) for membership recovery (handles
// blank-reg via icao24→N-number), then fall back to the raw reg dash-stripped + uppercased
// — the SAME normalization getStarlinkAirborneMap/the popup use — so map markers and the
// popup CONFIRMED badge stay consistent. Returns false in degraded tier (empty STARLINK_TAILS).
function isStarlinkFlight(f) {
  if (!STARLINK_TAILS.size || !f) return false;
  const ac = matchAircraft(f);
  if (ac) return STARLINK_TAILS.has(ac.r);
  return !!(f.reg && STARLINK_TAILS.has(f.reg.replace(/-/g, '').toUpperCase()));
}

// ═══ MAP INIT ═══
function initMap() {
  var homeCode = getHomeAirport();
  var homeAp = homeCode && AIRPORTS.find(a => a.iata === homeCode);
  var mapCenter = homeAp ? [homeAp.lat, homeAp.lon] : [39, -98];
  var mapZoom = homeAp ? 5 : 4;
  var basemapTileOptions = getBasemapTileOptions();
  map = L.map('map', {
    center: mapCenter, zoom: mapZoom, zoomControl: false,
    worldCopyJump: true
  });
  // Default attribution control stays on (ODbL — credit string comes from the tile layer via
  // getBasemapTileOptions). Drop the "Leaflet" prefix: micro-text, dark-theme styled in style.css.
  map.attributionControl.setPrefix('');
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', basemapTileOptions).addTo(map);

  // Clear route on popup close and remove flight URL param
  map.on('popupclose', () => {
    if (routeGroup) { map.removeLayer(routeGroup); routeGroup = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    const url = new URL(window.location);
    if (url.searchParams.has('flight')) {
      url.searchParams.delete('flight');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  });

  // Hub markers
  drawHubs();
  refreshFlights();
  function startRefreshTimer() {
    if (refreshTimer) clearInterval(refreshTimer);
    countdown = 30;
    refreshTimer = setInterval(() => {
      countdown--;
      document.getElementById('countdown').textContent = 'Next refresh: ' + countdown + 's';
      if (countdown <= 0) { refreshFlights(); countdown = 30; }
    }, 1000);
  }
  startRefreshTimer();

  // Pause polling when tab is hidden to save API credits. Chain the timer
  // off refreshFlights().finally() so the countdown starts when we have
  // fresh data, not during the in-flight fetch — avoids wasted no-op refresh
  // attempts that the isRefreshing gate would reject anyway.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      document.getElementById('countdown').textContent = 'Paused (tab hidden)';
    } else {
      refreshFlights().finally(() => startRefreshTimer());
    }
  });
}

function drawHubs() {
  hubMarkers.forEach(m => map.removeLayer(m));
  hubMarkers = [];
  if (!showHubs) return;

  HUBS.forEach(h => {
    const circle = L.circleMarker([h.lat, h.lon], {
      radius: 8, color: '#005DAA', fillColor: '#005DAA', fillOpacity: 0.3, weight: 2
    }).addTo(map);
    circle.bindTooltip(h.iata, { permanent: true, direction: 'top', className: 'hub-tooltip', offset: [0, -10] });
    hubMarkers.push(circle);

    // Pulse
    const pulse = L.circleMarker([h.lat, h.lon], {
      radius: 8, color: '#005DAA', fillOpacity: 0, weight: 1, className: 'hub-pulse'
    }).addTo(map);
    hubMarkers.push(pulse);
  });
}

function toggleHubs() { showHubs = !showHubs; drawHubs(); const el = document.getElementById('btn-hubs'); el.classList.toggle('active'); el.setAttribute('aria-pressed', String(showHubs)); }
function toggleLonghaul() { showLonghaul = !showLonghaul; const el = document.getElementById('btn-longhaul'); el.classList.toggle('active'); el.setAttribute('aria-pressed', String(showLonghaul)); updateMarkers(); }
function toggleStarlinkLayer() {
  // Degraded tier (no Starlink tails loaded) → no-op; the button is also disabled/greyed.
  if (!STARLINK_TAILS.size) return;
  showStarlinkOnly = !showStarlinkOnly;
  const el = document.getElementById('btn-starlink');
  if (el) { el.classList.toggle('active', showStarlinkOnly); el.setAttribute('aria-pressed', String(showStarlinkOnly)); }
  updateMarkers();
}
// Reflect data availability onto the Starlink toggle + legend. Degraded tier
// (static fallback, empty STARLINK_TAILS) disables/greys the control and hides the
// legend rather than offering a filter that would empty the map.
function updateStarlinkControlState() {
  const has = STARLINK_TAILS.size > 0;
  const btn = document.getElementById('btn-starlink');
  if (btn) {
    btn.disabled = !has;
    btn.setAttribute('aria-disabled', String(!has));
    btn.classList.toggle('ctrl-btn-disabled', !has);
    if (!has) {
      // Force the filter off if data disappeared while it was active.
      if (showStarlinkOnly) { showStarlinkOnly = false; btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); if (map) updateMarkers(); }
      btn.title = 'Starlink data unavailable';
    } else {
      btn.removeAttribute('title');
    }
  }
  const legend = document.getElementById('map-legend');
  if (legend) legend.style.display = has ? '' : 'none';
}
function toggleWeather() {
  showWeather = !showWeather;
  const wxBtn = document.getElementById('btn-wx'); wxBtn.classList.toggle('active'); wxBtn.setAttribute('aria-pressed', String(showWeather));
  if (showWeather && !wxLayer) {
    wxLayer = L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png', {
      opacity: 0.5, maxZoom: 18
    }).addTo(map);
  } else if (!showWeather && wxLayer) {
    map.removeLayer(wxLayer); wxLayer = null;
  }
}

let pacificView = false;
const US_VIEW = { center: [39, -98], zoom: 4 };
const PACIFIC_VIEW = { center: [25, 145], zoom: 4 };
function togglePacific() {
  pacificView = !pacificView;
  document.getElementById('btn-pacific').classList.toggle('active');
  const view = pacificView ? PACIFIC_VIEW : US_VIEW;
  map.flyTo(view.center, view.zoom, { duration: 1.2 });
}

// ═══ FLIGHT DATA (FlightRadar24) ═══
let flightsLoading = false;
let isRefreshing = false;
// Freshness + fast-retry state (audit Jul 3: cold-load empty feed left the page in NO DATA
// with no self-recovery, and the LIVE/STALE chip flapped on transport-level cache signals).
let lastGoodFeedTs = 0;   // when a non-empty feed was last committed — the chip keys to THIS
let feedRetryAttempt = 0; // consecutive failed polls (zero-flight 200, 5xx, network error)
let feedRetryTimer = null;

// Full-viewport NO-DATA overlay. Was position:absolute inside .map-area, which collapses to a
// zero-height box (the map itself is position:fixed) — so the one message explaining the empty
// dashboard rendered at the very top edge, clipped behind the canopy header (header z 770 beats
// #tab-live's z-index:1 stacking context; the overlay's z 999 is trapped inside it). Fixed +
// viewport-centered renders fully below the header at any width; z 999 still covers the sidebar/
// controls within #tab-live, and the header/tab dock stay on top and clickable.
function showMapErrorOverlay() {
  if (document.getElementById('map-error-overlay')) return;
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  const overlay = document.createElement('div');
  overlay.id = 'map-error-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;background:rgba(10,14,20,.85);pointer-events:auto';
  overlay.innerHTML = '<div class="error-state"><div class="error-icon">📡</div><div style="color:var(--ua-text);font-size:13px;margin-bottom:4px">Live flight feed unavailable</div><div style="color:var(--ua-muted);font-size:11px">Retrying automatically in a few seconds…</div><button class="retry-btn" data-action="map-error-retry">↻ Retry now</button></div>';
  // Appended inside #tab-live so the overlay hides with the tab; kept out of .map-area's
  // (collapsed) coordinate space by position:fixed above.
  mapEl.parentElement.appendChild(overlay);
}

async function refreshFlights() {
  if (isRefreshing) return;
  isRefreshing = true;
  flightsLoading = true;
  // This refresh (manual, scheduled, or retry-fired) supersedes any pending fast retry.
  if (feedRetryTimer) { clearTimeout(feedRetryTimer); feedRetryTimer = null; }
  document.getElementById('btn-refresh').textContent = '⏳ Loading...';
  let feedFailed = false;
  try {
    const res = await fetch('/api/fr24-feed?airline=UAL');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    // A 200 with ZERO UA flights is never legitimate — United always has hundreds airborne, so a
    // meta-only body ({"full_count":…,"version":…}) is a degraded feed (FR24 rate-limit
    // interstitial / empty upstream). Treat it EXACTLY like the 503 the server now returns for
    // empty upstream bodies: keep last-good flights, fall through to the shared failure path.
    const result = applyFeedResult(allFlights, parseFr24Feed(data));
    if (!result.ok) throw new Error('empty feed (zero aircraft in payload)');

    // Healthy live feed: commit the new flights and show LIVE.
    allFlights = result.flights;
    recordRegSightings(allFlights);
    lastGoodFeedTs = Date.now();
    feedRetryAttempt = 0;
    const dot = document.getElementById('status-dot');
    dot.className = 'status-dot live';
    dot.style.background = ''; // clear the yellow inline override a prior failure set — dot and label must agree
    document.getElementById('status-text').textContent = 'LIVE';
    document.getElementById('header-flight-count').textContent = '· ' + allFlights.length + ' flights';
    const errOverlay = document.getElementById('map-error-overlay');
    if (errOverlay) errOverlay.remove();
  } catch (e) {
    // Shared failure path for zero-flight 200s, 5xx (incl. the server's new empty-upstream 503),
    // and network errors. Never wipes allFlights; a fast retry is scheduled in finally.
    feedFailed = true;
    console.error('FR24 error:', e);
    const dot = document.getElementById('status-dot');
    // Chip keyed to actual payload age (time since last committed feed), NOT to this response's
    // transport state — one failed poll against fresh data stays LIVE instead of flapping.
    const age = lastGoodFeedTs ? Date.now() - lastGoodFeedTs : Infinity;
    if (allFlights.length > 0 && feedFreshness(age) === 'live') {
      dot.className = 'status-dot live';
      dot.style.background = '';
      document.getElementById('status-text').textContent = 'LIVE';
      document.getElementById('header-flight-count').textContent = '· ' + allFlights.length + ' flights';
    } else if (allFlights.length > 0) {
      dot.className = 'status-dot';
      dot.style.background = '#EAB308';
      document.getElementById('status-text').textContent = 'STALE';
      document.getElementById('header-flight-count').textContent = '· ' + allFlights.length + ' flights (stale)';
    } else {
      // No prior data to keep showing — surface the unavailable overlay so the user isn't left
      // staring at an empty "LIVE" map.
      dot.className = 'status-dot';
      dot.style.background = '#EAB308';
      document.getElementById('status-text').textContent = 'NO DATA';
      showMapErrorOverlay();
    }
  } finally {
    // Failed poll → fast retry (5s → 10s → 20s → 30s cap), separate from the normal 30s cadence.
    // This makes the overlay's "Retrying automatically" claim true. The countdown display is set
    // to match so the header never promises a slower refresh than the retry will deliver.
    let nextSecs = 30;
    if (feedFailed) {
      const delay = nextFeedRetryDelay(feedRetryAttempt);
      feedRetryAttempt++;
      nextSecs = Math.round(delay / 1000);
      feedRetryTimer = setTimeout(() => {
        feedRetryTimer = null;
        // Hidden tab: skip (polling is paused to save API credits); the visibilitychange
        // handler refreshes immediately when the tab returns.
        if (!document.hidden) refreshFlights();
      }, delay);
    }
    countdown = nextSecs;
    document.getElementById('btn-refresh').textContent = '🔄 Refresh';
    flightsLoading = false;
    isRefreshing = false;
    // Each updater is independent — one failure must not block the rest
    [updateMarkers, updateStats, updateHubStats, updateTicker].forEach(fn => { try { fn(); } catch(e) { console.error(fn.name + ':', e); } });
    try { if (document.getElementById('tab-myflight')?.classList.contains('active')) renderMyFlights(); } catch(e) { console.error('renderMyFlights:', e); }
    try { if (document.getElementById('tab-fleet')?.classList.contains('active')) updateLiveFleetPanel(); } catch(e) { console.error('updateLiveFleetPanel:', e); }
    try { if (document.getElementById('tab-starlink')?.classList.contains('active') && slInitialized) { renderSlHero(); renderSlTrend(); renderSlRoutesBoard(); renderSlTable(); renderSlVerification(); } } catch(e) { console.error('renderStarlinkTab:', e); }
    try { if (document.getElementById('tab-analytics')?.classList.contains('active')) updateAnalytics(); } catch(e) { console.error('updateAnalytics:', e); }
    // Handle deep link: ?flight=UA1234 on first load (also supports ?q= for SearchAction compatibility)
    if (!deepLinkHandled) {
      const urlParams = new URLSearchParams(window.location.search);
      const flightParam = urlParams.get('flight') || urlParams.get('q');
      if (!flightParam) {
        // Nothing to handle — mark done so we don't re-check every poll.
        deepLinkHandled = true;
      } else if (allFlights.length > 0) {
        // F033: only mark handled once the feed actually loaded. A failed first
        // poll left allFlights empty and the old code set the flag unconditionally,
        // dropping the ?flight= deep link forever. Now it retries on the next
        // successful poll.
        deepLinkHandled = true;
        const q = flightParam.trim().toUpperCase().replace(/\s+/g, '');
        const match = allFlights.find(f => {
          const flt = (f.flightIATA || '').toUpperCase();
          const cs = (f.callsign || '').toUpperCase();
          return flt === q || cs === q || flt === 'UA' + q || cs === 'UAL' + q;
        });
        if (match && flightMarkers[match.icao24]) {
          setTimeout(() => focusFlight(match.icao24), 300);
        } else {
          setTimeout(() => lookupFR24Flight(flightParam), 300);
        }
      }
      // else: deep link present but feed empty — leave unhandled, retry next poll.
    }
  }
}

const AIRPORT_COORDS = {};
AIRPORTS.forEach(a => { AIRPORT_COORDS[a.iata] = a; });

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function isLonghaulFlight(f) {
  // Use airport coords to calculate distance; >2500nm = longhaul
  const orig = AIRPORT_COORDS[f.origin];
  const dest = AIRPORT_COORDS[f.dest];
  if (orig && dest) return haversineNm(orig.lat, orig.lon, dest.lat, dest.lon) > 2500;
  // Fallback: old flight number heuristic (sub-100) for flights without matched airports
  const num = parseInt((f.callsign || '').replace(/^UAL/, ''));
  return num > 0 && num < 100;
}

// Icon cache: key = "hdg_rounded|isLonghaul|phase|isWatched|isStarlink" → L.divIcon
const _iconCache = {};
function createPlaneIcon(hdg, isLonghaul, phase, isWatched, isStarlink) {
  // Round heading to nearest 5° to maximize cache hits
  const hdgRounded = Math.round((hdg || 0) / 5) * 5;
  const cacheKey = `${hdgRounded}|${isLonghaul?1:0}|${phase}|${isWatched?1:0}|${isStarlink?1:0}`;
  if (_iconCache[cacheKey]) return _iconCache[cacheKey];
  // Starlink marker treatment: distinct violet FILL, no glow halo (owner Jul 4 2026 — the
  // stacked drop-shadow "orb" look is gone). Fill priority: watched green → Starlink violet
  // → long-haul amber → phase color. Accepted trade-off: phase color is not visible on
  // Starlink aircraft — the popup and the Starlink-only filter still carry it.
  const color = isWatched ? '#22c55e'
    : isStarlink ? '#A78BFA'
    : isLonghaul ? '#fbbf24'
    : (phase === 'Ground' ? '#64748B' : '#6BAAED');
  const size = isWatched ? 16 : (isLonghaul ? 14 : 10);
  const filter = `drop-shadow(0 0 2px ${color})`;
  // SVG plane pointing north (0°) — classic top-down aircraft silhouette, cross-platform consistent
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256" fill="${color}" style="filter:${filter}"><path d="M128 16c-4 0-8 3-9 7l-15 72-88 34c-3 1-4 4-4 7s2 5 5 6l87 20 4 52-28 18c-2 1-3 3-3 5v8c0 2 1 4 3 4l20-6h28l20 6c2 0 3-2 3-4v-8c0-2-1-4-3-5l-28-18 4-52 87-20c3-1 5-3 5-6s-1-6-4-7l-88-34-15-72c-1-4-5-7-9-7z"/></svg>`;
  const icon = L.divIcon({
    html: `<div style="transform:rotate(${hdgRounded}deg);line-height:0">${svg}</div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2], className: ''
  });
  _iconCache[cacheKey] = icon;
  return icon;
}

function getFilteredFlights() {
  return allFlights.filter(f => {
    if (activeHubFilter) {
      const hub = HUBS.find(h => h.iata === activeHubFilter);
      // FR24 gives real origin/dest — use those first, fall back to estimation
      const matchesHub = f.origin === activeHubFilter || f.dest === activeHubFilter ||
        (f.onGround && hub && haversine(f.lat, f.lon, hub.lat, hub.lon) < 93); // ~50nm
      if (!matchesHub) return false;
    }
    if (activePhaseFilter) {
      const p = getPhase(f.alt, f.vr, f.spd);
      const phaseGroup = getPhaseGroup(p.phase);
      if (phaseGroup !== activePhaseFilter) return false;
    }
    if (showStarlinkOnly && !isStarlinkFlight(f)) return false;
    return true;
  });
}

function getPhaseGroup(phase) {
  if (phase === 'Ground') return 'Ground';
  if (phase === 'Takeoff' || phase === 'Climb') return 'Climb';
  if (phase === 'Cruise' || phase === 'En Route') return 'Cruise';
  if (phase === 'Descent') return 'Descent';
  if (phase === 'Approach') return 'Approach';
  return 'Cruise';
}

function updateMarkers() {
  if (!map) return;
  const filtered = getFilteredFlights();
  const filteredIcaos = new Set(filtered.map(f => f.icao24));
  const allIcaos = new Set(allFlights.map(f => f.icao24));
  const watchedSet = new Set(getWatchedFlights().map(w => w.flight));

  // Remove markers for flights no longer in feed
  Object.keys(flightMarkers).forEach(id => {
    if (!allIcaos.has(id)) { map.removeLayer(flightMarkers[id]); delete flightMarkers[id]; }
  });
  // Hide markers not in filtered set
  Object.keys(flightMarkers).forEach(id => {
    if (!filteredIcaos.has(id)) { map.removeLayer(flightMarkers[id]); }
    else if (!map.hasLayer(flightMarkers[id])) { flightMarkers[id].addTo(map); }
  });

  filtered.forEach(f => {
    const isLonghaul = showLonghaul && isLonghaulFlight(f);
    const phaseInfo = getPhase(f.alt, f.vr, f.spd);
    const flightId = f.flightIATA || '';
    const isWatched = flightId && watchedSet.has(flightId);
    const isStarlink = isStarlinkFlight(f);
    const icon = createPlaneIcon(f.hdg, isLonghaul, phaseInfo.phase, isWatched, isStarlink);

    // Normalize longitude to nearest world copy relative to map center
    // so IDL-crossing flights (e.g. SFO→BNE) are always visible
    let lon = f.lon;
    const centerLng = map.getCenter().lng;
    while (lon - centerLng > 180) lon -= 360;
    while (lon - centerLng < -180) lon += 360;

    if (flightMarkers[f.icao24]) {
      flightMarkers[f.icao24].setLatLng([f.lat, lon]).setIcon(icon);
      flightMarkers[f.icao24].setZIndexOffset(isWatched ? 1000 : 0);
    } else {
      const marker = L.marker([f.lat, lon], { icon, zIndexOffset: isWatched ? 1000 : 0 }).addTo(map);
      marker._icao24 = f.icao24;
      marker.on('click', () => {
        const currentFlight = allFlights.find(fl => fl.icao24 === marker._icao24);
        if (currentFlight) showFlightPopup(currentFlight, marker);
      });
      flightMarkers[f.icao24] = marker;
    }
  });
}

function showFlightPopup(f, marker) {
  // Update URL with flight parameter for shareable links
  const shareFlightId = f.flightIATA || f.callsign || '';
  if (shareFlightId) {
    const url = new URL(window.location);
    url.searchParams.set('flight', shareFlightId);
    history.replaceState(null, '', url);
  }
  // Remove old route layers
  if (routeGroup) { map.removeLayer(routeGroup); routeGroup = null; }
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }

  // FR24 gives us real route data — fall back to estimation only if missing
  const hasRealRoute = f.origin && f.dest;
  let originObj = null, destObj = null;
  if (hasRealRoute) {
    originObj = HUBS.find(h => h.iata === f.origin) || { iata: f.origin, lat: null, lon: null };
    destObj = HUBS.find(h => h.iata === f.dest) || { iata: f.dest, lat: null, lon: null };
  }
  if (!hasRealRoute) {
    const est = estimateRoute(f.lat, f.lon, f.hdg, f.alt ? f.alt * 3.28084 : null, f.vr, f.flightIATA || f.callsign);
    originObj = est.origin;
    destObj = est.dest;
  }

  const phaseInfo = getPhase(f.alt, f.vr, f.spd);
  const squawk = decodeSquawk(f.squawk);
  const aircraft = matchAircraft(f);
  const isStarlink = isStarlinkFlight(f);
  const flightNum = f.flightIATA || f.callsign.replace(/^UAL/, '');
  const displayFlight = f.flightIATA || f.callsign || 'N/A';

  const { altFt, altPct, speedText } = getFlightPopupMetrics(f);

  const origCode = f.origin || originObj?.iata || '???';
  const destCode = f.dest || destObj?.iata || '???';
  const origCity = IATA_CITIES[origCode] || '';
  const destCity = IATA_CITIES[destCode] || '';
  const hasCityNames = origCity && destCity;
  const routeStr = origCode + ' → ' + destCode;

  let html = `<div class="popup-card">`;
  html += `<div class="popup-header"><div>`;
  html += `<div class="popup-callsign">${escapeHtml(displayFlight)}</div>`;
  if (hasCityNames) html += `<div class="popup-route" style="font-size:14px;font-weight:600">${escapeHtml(origCity)} → ${escapeHtml(destCity)}</div>`;
  html += `<div class="popup-route" style="${hasCityNames ? 'font-size:11px;color:var(--ua-muted);margin-top:1px' : ''}">${escapeHtml(routeStr)}</div>`;
  if (!hasRealRoute && (originObj || destObj)) html += `<div class="popup-route-est">estimated route</div>`;
  html += `</div><div>`;
  html += `<span class="popup-phase ${phaseInfo.cls}">${phaseInfo.icon} ${phaseInfo.phase}</span>`;
  if (squawk) html += `<br><span class="${squawk.cls}">${squawk.text}</span>`;
  html += `</div></div>`;

  html += `<div class="popup-grid">`;
  html += `<div class="popup-field"><span class="popup-field-label">Altitude</span><span class="popup-field-value">${altFt ? altFt.toLocaleString() + ' ft' : 'N/A'}</span>`;
  html += `<div class="alt-bar"><div class="alt-bar-fill" style="width:${altPct}%"></div></div></div>`;
  html += `<div class="popup-field"><span class="popup-field-label">Speed</span><span class="popup-field-value">${speedText}</span></div>`;
  html += `<div class="popup-field"><span class="popup-field-label">Heading</span><span class="popup-field-value">${f.hdg ? Math.round(f.hdg) + '°' : 'N/A'}</span></div>`;
  html += `<div class="popup-field"><span class="popup-field-label">V/S</span><span class="popup-field-value">${f.vr ? Math.round(f.vr * 196.85) + ' fpm' : 'N/A'}</span></div>`;
  html += `</div>`;

  // Aircraft info — FR24 type + fleet DB match
  if (aircraft) {
    html += `<div class="popup-aircraft">`;
    html += `<div class="popup-aircraft-type">${escapeHtml(aircraft.t)} <span class="ac-reg-link" data-action="aircraft-detail" data-reg="${escapeHtml(aircraft.r)}" style="font-size:10px">${escapeHtml(aircraft.r)}</span></div>`;
    html += `<div style="font-size:10px;color:var(--ua-muted)">${escapeHtml(aircraft.c || '')} | ${escapeHtml(normalizeWifi(aircraft.w) || '')} | ${escapeHtml(aircraft.i || '')}</div>`;
    if (isStarlink) {
      html += `<span class="starlink-badge">⚡ STARLINK CONFIRMED</span> `;
    } else if (flightNum && flightNum !== 'N/A') {
      html += `<span class="starlink-badge starlink-predict" data-flight="${escapeHtml(flightNum)}" style="background:rgba(100,116,139,.15);color:var(--ua-muted)">⚡ Checking…</span> `;
    }
    const popupSpecial = isSpecialAircraft(aircraft.r);
    if (popupSpecial) html += `<span class="special-badge">⭐ ${escapeHtml(popupSpecial.name)}</span> `;
    if (aircraft.seats && Object.keys(aircraft.seats).length > 0) {
      html += `<div class="popup-seats">`;
      for (const [cls, cnt] of Object.entries(aircraft.seats)) {
        html += `<span class="seat-block seat-${cls}">${cnt}${cls}</span>`;
      }
      html += `<span style="font-size:9px;color:var(--ua-muted);margin-left:4px">(${aircraft.tot} total)</span></div>`;
    }
    html += `</div>`;
  } else {
    // Show FR24 data even without fleet match
    let acInfo = [];
    if (f.acType) acInfo.push(f.acType);
    if (f.reg) acInfo.push(f.reg);
    if (acInfo.length) {
      const note = FLEET_DB.length === 0
        ? 'Loading aircraft data…'
        : 'not in mainline fleet DB — likely United Express';
      html += `<div style="font-size:10px;color:var(--ua-muted);margin:4px 0">${escapeHtml(acInfo.join(' · '))} (${note})</div>`;
    }
  }

  // Departure/Arrival times — placeholder, filled async
  html += `<div id="popup-times-${escapeHtml(f.icao24)}" class="popup-times-loading">✈️ Loading departure & arrival times…</div>`;

  html += `<div class="popup-links">`;
  const fltLink = flightNum.replace(/^UA/, '');
  if (fltLink) html += `<a href="https://flightaware.com/live/flight/UAL${encodeURIComponent(fltLink)}" target="_blank" rel="noopener noreferrer">FlightAware ${ICO_EXTLINK}</a>`;
  const regLink = aircraft?.r || f.reg;
  if (regLink) html += `<a href="https://www.planespotters.net/search?q=${encodeURIComponent(regLink)}" target="_blank" rel="noopener noreferrer">Planespotters ${ICO_EXTLINK}</a>`;
  html += `<a href="https://globe.adsbexchange.com/?icao=${encodeURIComponent(f.icao24)}" target="_blank" rel="noopener noreferrer">ADS-B ${ICO_EXTLINK}</a>`;
  // Watch button in popup
  const popupFlt = displayFlight;
  const popupRoute = (f.origin||'?') + '→' + (f.dest||'?');
  const popupWatched = isFlightWatched(popupFlt);
  html += `<button class="watch-btn${popupWatched ? ' watching' : ''}" data-action="toggle-watch-flight" data-flight="${escapeHtml(popupFlt)}" data-route="${escapeHtml(popupRoute)}" data-status="airborne" data-stop-prop="1" aria-label="${popupWatched ? 'Unwatch flight' : 'Watch flight'}" style="margin-left:auto">${popupWatched ? ICO_WATCHING + ' Watching' : ICO_WATCH + ' Watch'}</button>`;
  html += `<button class="share-btn" data-action="share-flight" data-flight="${escapeHtml(popupFlt)}" data-stop-prop="1" aria-label="Share flight link" title="Copy shareable link">${ICO_SHARE} Share</button>`;
  html += `</div></div>`;

  if (marker.getPopup()) marker.unbindPopup();
  marker.bindPopup(html, { maxWidth: 320, closeButton: true }).openPopup();

  // Async fetch departure/arrival times from FlightAware
  (function fetchFlightTimes() {
    const timesId = 'popup-times-' + f.icao24;
    const fltQuery = f.flightIATA || f.callsign || '';
    if (!fltQuery) {
      const el = document.getElementById(timesId);
      if (el) el.style.display = 'none';
      return;
    }
    fetch('/api/flight-times?flight=' + encodeURIComponent(fltQuery))
      .then(r => r.ok ? r.json() : { success: false })
      .then(data => {
        const el = document.getElementById(timesId);
        if (!el) return;
        if (!data.success) { el.style.display = 'none'; return; }

        const dep = data.departure || {};
        const arr = data.arrival || {};
        const orig = data.origin || {};
        const dest = data.destination || {};

        function fmtTimeInTz(iso, tz) {
          if (!iso) return null;
          try {
            const d = new Date(iso);
            if (isNaN(d)) return null;
            const opts = { hour: 'numeric', minute: '2-digit', hour12: true };
            if (tz) opts.timeZone = tz;
            return d.toLocaleTimeString([], opts);
          } catch(e) { return null; }
        }
        function fmtTimeWithTz(iso, tz) {
          if (!iso) return null;
          try {
            const d = new Date(iso);
            if (isNaN(d)) return null;
            const opts = { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' };
            if (tz) opts.timeZone = tz;
            return d.toLocaleTimeString([], opts);
          } catch(e) { return null; }
        }
        function deltaMin(schedIso, actualIso) {
          if (!schedIso || !actualIso) return null;
          try {
            const diff = Math.round((new Date(actualIso) - new Date(schedIso)) / 60000);
            return isNaN(diff) ? null : diff;
          } catch(e) { return null; }
        }
        function deltaBadge(diff) {
          if (diff === null || isNaN(diff)) return '';
          if (Math.abs(diff) <= 5) return ' <span class="time-delta ontime">On time</span>';
          if (diff > 0) return ' <span class="time-delta late">+' + diff + 'm</span>';
          return ' <span class="time-delta early">' + diff + 'm</span>';
        }

        // Departure: prefer actual, then estimated, then scheduled
        const depGate = dep.gate || {};
        const depTakeoff = dep.takeoff || {};
        const depActual = depGate.actual || depTakeoff.actual;
        const depEst = depGate.estimated || depTakeoff.estimated;
        const depSched = depGate.scheduled || depTakeoff.scheduled;
        const depBest = depActual || depEst || depSched;

        // Arrival: prefer actual, then estimated, then scheduled
        const arrGate = arr.gate || {};
        const arrLand = arr.landing || {};
        const arrActual = arrGate.actual || arrLand.actual;
        const arrEst = arrGate.estimated || arrLand.estimated;
        const arrSched = arrGate.scheduled || arrLand.scheduled;
        const arrBest = arrActual || arrEst || arrSched;

        if (!depBest && !arrBest) { el.style.display = 'none'; return; }

        let h = '<div class="popup-times">';

        // Departure column. orig.terminal and orig.gate come from FlightAware/FR24
        // responses. Wrap every interpolation in escapeHtml — upstream can return
        // arbitrary strings (e.g. a gate label with an HTML tag in it), and this
        // value lands in innerHTML at the end of the block.
        h += '<div class="popup-field"><span class="popup-field-label">Departure' + (orig.terminal ? ' · T' + escapeHtml(String(orig.terminal)) : '') + (orig.gate ? ' G' + escapeHtml(String(orig.gate)) : '') + '</span><span class="popup-field-value">';
        if (depActual) {
          h += (fmtTimeInTz(depActual, orig.tz) || 'N/A') + deltaBadge(deltaMin(depSched, depActual));
        } else if (depEst) {
          h += (fmtTimeInTz(depEst, orig.tz) || 'N/A') + deltaBadge(deltaMin(depSched, depEst));
        } else if (depSched) {
          h += (fmtTimeInTz(depSched, orig.tz) || 'N/A');
        }
        h += '</span>';
        const depDiff = deltaMin(depSched, depActual || depEst);
        if ((depActual || depEst) && depSched && depDiff !== null && Math.abs(depDiff) > 5) {
          h += '<span style="font-size:9px;color:var(--ua-muted)">Sched ' + fmtTimeInTz(depSched, orig.tz) + '</span>';
        }
        h += '</div>';

        // Arrival column. Same upstream-untrusted escape treatment as Departure.
        h += '<div class="popup-field"><span class="popup-field-label">Arrival' + (dest.terminal ? ' · T' + escapeHtml(String(dest.terminal)) : '') + (dest.gate ? ' G' + escapeHtml(String(dest.gate)) : '') + '</span><span class="popup-field-value">';
        if (arrActual) {
          h += (fmtTimeWithTz(arrActual, dest.tz) || 'N/A') + deltaBadge(deltaMin(arrSched, arrActual));
        } else if (arrEst) {
          h += (fmtTimeWithTz(arrEst, dest.tz) || 'N/A') + deltaBadge(deltaMin(arrSched, arrEst));
        } else if (arrSched) {
          h += (fmtTimeWithTz(arrSched, dest.tz) || 'N/A');
        }
        h += '</span>';
        const arrDiff = deltaMin(arrSched, arrActual || arrEst);
        if ((arrActual || arrEst) && arrSched && arrDiff !== null && Math.abs(arrDiff) > 5) {
          h += '<span style="font-size:9px;color:var(--ua-muted)">Sched ' + fmtTimeWithTz(arrSched, dest.tz) + '</span>';
        }
        h += '</div>';

        h += '</div>';
        el.className = '';
        el.innerHTML = h;
      })
      .catch(() => {
        const el = document.getElementById(timesId);
        if (el) el.style.display = 'none';
      });
  })();

  // Async fetch Starlink probability for non-confirmed flights
  fetchStarlinkPredictions();

  // Draw great circle route lines with traveled/remaining segments + endpoint markers
  {
    let oApt = null, dApt = null;
    if (f.origin && f.dest) {
      oApt = HUBS.find(h => h.iata === f.origin) || AIRPORTS.find(a => a.iata === f.origin);
      dApt = HUBS.find(h => h.iata === f.dest) || AIRPORTS.find(a => a.iata === f.dest);
    } else if (originObj && destObj && originObj.lat && destObj.lat) {
      oApt = originObj; dApt = destObj;
    }
    if (oApt && dApt && oApt.lat && dApt.lat) {
      const layers = [];
      const planePos = [f.lat, f.lon];
      // Traveled segment: origin → plane (solid) — continuous lon for IDL crossing
      const traveledPts = normalizeLonContinuity(greatCirclePoints(oApt.lat, oApt.lon, f.lat, f.lon, 60));
      layers.push(L.polyline(traveledPts, { color: '#005DAA', weight: 2.5, opacity: 0.8 }));
      // Remaining segment: plane → destination (dashed)
      const remainPts = normalizeLonContinuity(greatCirclePoints(f.lat, f.lon, dApt.lat, dApt.lon, 60));
      layers.push(L.polyline(remainPts, { color: '#005DAA', weight: 1.5, dashArray: '6,4', opacity: 0.4 }));
      // Origin marker — use normalized lon from route start
      const oLon = traveledPts[0][1];
      const oLabel = oApt.iata + (IATA_CITIES[oApt.iata] ? ' — ' + IATA_CITIES[oApt.iata] : '');
      layers.push(L.circleMarker([oApt.lat, oLon], {radius:5,color:'#005DAA',fillColor:'#005DAA',fillOpacity:0.7,weight:1}).bindTooltip(oLabel,{permanent:false,direction:'top'}));
      // Destination marker — use normalized lon from route end
      const dLon = remainPts[remainPts.length - 1][1];
      const dLabel = dApt.iata + (IATA_CITIES[dApt.iata] ? ' — ' + IATA_CITIES[dApt.iata] : '');
      layers.push(L.circleMarker([dApt.lat, dLon], {radius:5,color:'#005DAA',fillColor:'#fff',fillOpacity:0.9,weight:2}).bindTooltip(dLabel,{permanent:false,direction:'top'}));
      routeGroup = L.layerGroup(layers).addTo(map);
    }
  }
}

function greatCirclePoints(lat1, lon1, lat2, lon2, n) {
  const φ1 = toRad(lat1), λ1 = toRad(lon1), φ2 = toRad(lat2), λ2 = toRad(lon2);
  const d = Math.acos(Math.min(1, Math.max(-1,
    Math.sin(φ1)*Math.sin(φ2) + Math.cos(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1)
  )));
  if (d < 1e-6) return [[lat1,lon1],[lat2,lon2]];
  const sinD = Math.sin(d);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const a = Math.sin((1-f)*d) / sinD;
    const b = Math.sin(f*d) / sinD;
    const x = a*Math.cos(φ1)*Math.cos(λ1) + b*Math.cos(φ2)*Math.cos(λ2);
    const y = a*Math.cos(φ1)*Math.sin(λ1) + b*Math.cos(φ2)*Math.sin(λ2);
    const z = a*Math.sin(φ1) + b*Math.sin(φ2);
    pts.push([toDeg(Math.atan2(z, Math.sqrt(x*x + y*y))), toDeg(Math.atan2(y, x))]);
  }
  return pts;
}

// Normalize a polyline so longitudes are continuous (no >180° jumps).
// Leaflet handles coordinates outside [-180,180] fine — this lets
// transpacific routes render correctly across the antimeridian.
function normalizeLonContinuity(pts) {
  if (!pts || pts.length < 2) return pts || [];
  const out = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    let lon = pts[i][1];
    const prevLon = out[i - 1][1];
    // Shift lon to be within ±180 of previous point
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    out.push([pts[i][0], lon]);
  }
  return out;
}

// Legacy wrapper — no longer splits; just returns a single continuous segment
function splitAtAntimeridian(pts) {
  return [normalizeLonContinuity(pts)];
}

// ═══ STARLINK PREDICTION ═══
const starlinkPredictionCache = new Map();

function fetchStarlinkPredictions() {
  // en-CA emits YYYY-MM-DD in the user's local timezone, which matches the
  // operational date of the displayed flights. Plain toISOString() is UTC and
  // would query tomorrow's date for west-of-UTC users after local afternoon.
  // (Only the legacy tail-known check-flight path is date-scoped.)
  const today = new Date().toLocaleDateString('en-CA');
  document.querySelectorAll('.starlink-predict').forEach(el => {
    const flight = el.getAttribute('data-flight');
    if (!flight || flight === 'N/A') { el.style.display = 'none'; return; }

    // Forecast badges fire where no tail is resolvable, so the right signal is the
    // statistical route base-rate from predict-flight's flight_history model. That
    // model is date-agnostic → drop the date param and cache by flight-number only.
    // Tail-known badges keep their existing date-scoped check-flight path.
    const forecast = el.getAttribute('data-mode') === 'forecast';
    const cacheKey = forecast ? 'forecast|' + flight : flight + '|' + today;
    const cached = starlinkPredictionCache.get(cacheKey);
    if (cached) {
      applyStarlinkPrediction(el, cached);
      return;
    }

    const url = forecast
      ? '/api/predict-flight?flight_number=' + encodeURIComponent(flight)
      : '/api/check-flight?flight_number=' + encodeURIComponent(flight) + '&date=' + today;

    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || data.probability === undefined) {
          el.style.display = 'none';
          return;
        }
        starlinkPredictionCache.set(cacheKey, data);
        applyStarlinkPrediction(el, data);
      })
      .catch(() => { el.style.display = 'none'; });
  });
}

function applyStarlinkPrediction(el, data) {
  // Two distinct badge surfaces share this renderer. Only the NEW forecast badge
  // (data-mode="forecast", driven by predict-flight's statistical base-rate) gets
  // the "likely ~N%" label + low-data gating. The pre-existing deterministic
  // check-flight badge (tail already resolved) must render exactly as it did on
  // main — otherwise a verified-95% confirmation (n_observations≈1) would be
  // demoted to a muted "· low data" with a self-contradictory tooltip.
  const forecast = el.getAttribute('data-mode') === 'forecast';

  if (!forecast) {
    // ---- Legacy check-flight badge — byte-identical to main ----
    const lpct = Math.round(data.probability * 100);
    if (lpct < 5) { el.style.display = 'none'; return; }
    const lcolor = lpct >= 75 ? 'var(--ua-green)' : lpct >= 40 ? 'var(--ua-yellow)' : 'var(--ua-muted)';
    const lbg = lpct >= 75 ? 'rgba(34,197,94,.2)' : lpct >= 40 ? 'rgba(234,179,8,.15)' : 'rgba(100,116,139,.15)';
    el.style.background = lbg;
    el.style.color = lcolor;
    el.textContent = '⚡ Starlink ~' + lpct + '%';
    el.title = 'Confidence: ' + (data.confidence || 'unknown') + ' (' + (data.n_observations || 0) + ' observations)';
    return;
  }

  // ---- Forecast badge — statistical route base-rate from predict-flight ----
  const pct = Math.round((data.probability || 0) * 100);
  // A near-zero base rate is noise, not a signal — hide rather than show "~2%".
  if (pct < 5) { el.style.display = 'none'; return; }

  const n = data.n_observations || 0;
  const confidence = data.confidence || 'unknown';
  // Sample-size gating: a high % off <3 flights (or an explicitly low-confidence
  // model) shouldn't masquerade as a confident green badge. Demote to the muted
  // treatment and carry the caveat in TEXT + SHAPE (dashed underline), never colour
  // alone — per DESIGN.md "status never conveyed by color alone".
  const lowData = n < 3 || confidence === 'low';

  let color, bgColor;
  if (lowData) {
    color = 'var(--ua-muted)';
    bgColor = 'rgba(100,116,139,.15)';
  } else {
    color = pct >= 75 ? 'var(--ua-green)' : pct >= 40 ? 'var(--ua-yellow)' : 'var(--ua-muted)';
    bgColor = pct >= 75 ? 'rgba(34,197,94,.2)' : pct >= 40 ? 'rgba(234,179,8,.15)' : 'rgba(100,116,139,.15)';
  }
  el.style.background = bgColor;
  el.style.color = color;
  el.style.borderBottom = lowData ? '1px dashed currentColor' : '';
  el.textContent = '⚡ Starlink likely ~' + pct + '%' + (lowData ? ' · low data' : '');
  // Read as a statistical estimate, NOT a united.com verification for this date.
  el.title = 'Statistical estimate from ' + n + ' past flights · ' + confidence
    + ' confidence · not a guarantee for this date’s aircraft.';
}

// ═══ STATS ═══
function updateStats() {
  const filtered = getFilteredFlights();
  let airborne = 0, ground = 0, climbing = 0, cruising = 0, descending = 0;
  let totalAlt = 0, altCount = 0, totalSpd = 0, spdCount = 0, starlinkAirborne = 0;

  filtered.forEach(f => {
    const p = getPhase(f.alt, f.vr, f.spd);
    if (f.onGround) ground++;
    else {
      airborne++;
      if (p.phase === 'Climb' || p.phase === 'Takeoff') climbing++;
      else if (p.phase === 'Cruise' || p.phase === 'En Route') cruising++;
      else if (p.phase === 'Descent' || p.phase === 'Approach') descending++;

      if (f.alt) { totalAlt += f.alt * 3.28084; altCount++; }
      if (f.spd) { totalSpd += f.spd * 1.944; spdCount++; }

      const ac = matchAircraft(f);
      if (ac && STARLINK_TAILS.has(ac.r)) starlinkAirborne++;
      else if (f.reg && STARLINK_TAILS.has(f.reg)) starlinkAirborne++;
    }
  });

  const filterLabel = (activeHubFilter || activePhaseFilter) ? ' (filtered)' : '';
  document.getElementById('st-airborne').textContent = airborne;
  document.getElementById('st-ground').textContent = ground;
  document.getElementById('st-climb').textContent = climbing;
  document.getElementById('st-cruise').textContent = cruising;
  document.getElementById('st-desc').textContent = descending;
  document.getElementById('st-avgalt').textContent = altCount ? Math.round(totalAlt / altCount).toLocaleString() + 'ft' : '--';
  document.getElementById('st-avgspd').textContent = spdCount ? Math.round(totalSpd / spdCount) + 'kts' : '--';
  document.getElementById('st-util').textContent = FLEET_DB.length ? Math.round((airborne / FLEET_DB.length) * 100) + '%' + filterLabel : '--';
  document.getElementById('st-starlink').textContent = starlinkAirborne;

  // Phase stats sidebar (always show total counts from allFlights, but make clickable)
  let allGround = 0, allClimb = 0, allCruise = 0, allDescent = 0, allApproach = 0;
  allFlights.forEach(f => {
    const p = getPhase(f.alt, f.vr, f.spd);
    const g = getPhaseGroup(p.phase);
    if (g === 'Ground') allGround++;
    else if (g === 'Climb') allClimb++;
    else if (g === 'Cruise') allCruise++;
    else if (g === 'Descent') allDescent++;
    else if (g === 'Approach') allApproach++;
  });

  document.getElementById('phase-stats').innerHTML = [
    ['🅿️ Ground', allGround, 'Ground'], ['🛫 Climb', allClimb, 'Climb'],
    ['✈️ Cruise', allCruise, 'Cruise'], ['↘️ Descent', allDescent, 'Descent'],
    ['🛬 Approach', allApproach, 'Approach']
  ].map(([label, val, key]) =>
    `<div class="phase-row${activePhaseFilter === key ? ' phase-selected' : ''}" data-action="toggle-phase-filter" data-phase="${key}" role="button" tabindex="0"><span style="color:var(--ua-muted)">${label}</span><span style="color:var(--ua-accent);font-weight:700">${val}</span></div>`
  ).join('');
}

function togglePhaseFilter(phase) {
  activePhaseFilter = activePhaseFilter === phase ? null : phase;
  updateMarkers();
  updateStats();
}

function toggleHubFilter(iata) {
  if (activeHubFilter === iata) {
    activeHubFilter = null;
    map.setView([39, -98], 4);
  } else {
    activeHubFilter = iata;
    const hub = HUBS.find(h => h.iata === iata);
    if (hub) map.setView([hub.lat, hub.lon], 7);
  }
  updateMarkers();
  updateStats();
  updateHubStats();
}

function clearAllFilters() {
  activeHubFilter = null;
  activePhaseFilter = null;
  map.setView([39, -98], 4);
  updateMarkers();
  updateStats();
  updateHubStats();
}

function updateHubStats() {
  const hubData = {};
  HUB_CODES.forEach(h => { hubData[h] = { inbound: 0, outbound: 0 }; });

  allFlights.forEach(f => {
    if (f.onGround) return;
    // Use FR24's real origin/dest
    if (f.origin && hubData[f.origin] !== undefined) hubData[f.origin].outbound++;
    if (f.dest && hubData[f.dest] !== undefined) hubData[f.dest].inbound++;
  });

  let maxTotal = 0, busiestHub = '';
  HUB_CODES.forEach(h => {
    const t = hubData[h].inbound + hubData[h].outbound;
    if (t > maxTotal) { maxTotal = t; busiestHub = h; }
  });

  let html = `<div class="show-all-btn" data-action="clear-filters">⊘ SHOW ALL</div>`;
  html += HUB_CODES.map(h => {
    const d = hubData[h];
    const total = d.inbound + d.outbound;
    const pct = maxTotal > 0 ? (total / maxTotal * 100) : 0;
    const isBusiest = h === busiestHub;
    const isSelected = activeHubFilter === h;
    return `<div class="hub-row${isSelected ? ' hub-selected' : ''}" data-action="toggle-hub-filter" data-hub="${h}">
      <div><span class="hub-code">${h}</span>${isBusiest ? ' <span class="busiest-badge">BUSIEST</span>' : ''}${isSelected ? ' <span style="font-size:9px;color:var(--ua-green)">✓ FILTERED</span>' : ''}</div>
      <div class="hub-counts">↗ ${d.outbound} ↙ ${d.inbound}</div>
    </div>
    <div style="padding:0 12px 6px"><div class="hub-bar"><div class="hub-bar-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
  document.getElementById('hub-stats').innerHTML = html;
}

// ═══ SEARCH ═══
document.getElementById('search-input-side').addEventListener('input', debounce(function() {
  const q = this.value.trim().toUpperCase();
  const results = document.getElementById('search-results-side');
  if (q.length < 2) { results.innerHTML = ''; return; }

  const allMatches = allFlights.filter(f => {
    const cs = (f.callsign || '').toUpperCase();
    const flt = (f.flightIATA || '').toUpperCase();
    const reg = (f.reg || '').toUpperCase();
    const routeStr = ((f.origin || '') + (f.dest || '')).toUpperCase();
    return cs.includes(q) || flt.includes(q) || reg.includes(q) || routeStr.includes(q);
  });
  const matches = allMatches.slice(0, 50);

  // Check if query matches a hub code — suggest hub filter
  const isHub = HUB_CODES.includes(q);
  const hubHint = isHub ? `<div style="padding:6px 12px;font-size:10px;background:rgba(0,93,170,.1);border-bottom:1px solid var(--ua-border);cursor:pointer" data-action="toggle-hub-filter" data-hub="${q}"><span style="color:var(--ua-accent)">🏢 Filter map to ${q}</span> <span style="color:var(--ua-muted)">(${allMatches.length} flights)</span></div>` : '';
  const countHeader = `<div style="padding:4px 12px;font-size:9px;color:var(--ua-muted);border-bottom:1px solid var(--ua-border)">${allMatches.length} flight${allMatches.length !== 1 ? 's' : ''} found${allMatches.length > 50 ? ' (showing 50)' : ''}</div>`;

  if (allMatches.length === 0) {
    results.innerHTML = `<div style="padding:10px 12px;color:var(--ua-muted);font-size:10px;line-height:1.5">
      <div style="margin-bottom:4px">No flights matching "${escapeHtml(q)}"</div>
      <div style="font-size:9px">✈️ Flights at the gate or boarding may not appear until after pushback. Check the <strong style="color:var(--ua-accent);cursor:pointer" data-action="switch-tab" data-tab="tab-schedule">Schedule</strong> tab for gate status.</div>
    </div>`;
  } else {
    results.innerHTML = hubHint + countHeader + matches.map(f => {
      const routeStr = (f.origin || '???') + '→' + (f.dest || '???');
      return `<div class="search-result" data-action="focus-flight" data-icao24="${escapeHtml(f.icao24)}">${escapeHtml(f.flightIATA || f.callsign || f.icao24)} <span style="color:var(--ua-muted)">${escapeHtml(routeStr)} ${escapeHtml(f.reg || '')}</span></div>`;
    }).join('');
  }
}, 150));

function focusFlight(icao24) {
  const f = allFlights.find(fl => fl.icao24 === icao24);
  if (f && flightMarkers[icao24]) {
    // Switch to the LIVE tab so the map is visible
    switchToTab('tab-live');
    // Use marker's actual position (already IDL-normalized)
    const markerPos = flightMarkers[icao24].getLatLng();
    map.setView(markerPos, 8);
    showFlightPopup(f, flightMarkers[icao24]);
  }
}

// ═══ TICKER ═══
function updateTicker() {
  const airborne = allFlights.filter(f=>!f.onGround).length;
  const items = [];

  // Ops health first: derived from the SAME inputs the IROPS panel uses (hub OTP,
  // FAA programs at UA hubs, IROPS index) so the ticker can never say "all systems
  // normal" while the Delays tab shows a red IROPS night. (Audit Jul 3 2026.)
  const opsHealth = deriveOpsHealth({
    hubOtps: hubHealthData,
    faaIndex: faaDelayIndex,
    hubCodes: ['ORD','DEN','IAH','EWR','SFO','IAD','LAX','NRT','GUM'],
    iropsScore: lastIropsScore,
  });
  if (opsHealth.level !== 'normal') {
    items.push({ text: `⚠️ ${opsHealth.text}`, cls: 'advisory' });
  }

  if (allFlights.length > 0) {
    items.push({ text: `${airborne} United flights airborne`, cls: 'info' });
    // Show fleet counts only after fleet data has loaded — avoids misleading "0 aircraft" on initial render
    if (FLEET_DB.length > 0) {
      items.push({ text: `Fleet: ${FLEET_DB.length} mainline aircraft`, cls: 'info' });
      items.push({ text: `${STARLINK_TAILS.size} Starlink-equipped aircraft (incl. United Express)`, cls: 'info' });
    }
  }

  // Check for emergency squawks
  allFlights.forEach(f => {
    const sq = decodeSquawk(f.squawk);
    if (sq && sq.cls === 'squawk-alert') {
      items.push({ text: `${sq.text}: ${escapeHtml(f.callsign)} (${escapeHtml(f.squawk)})`, cls: 'critical' });
    }
  });

  // Default message only when nothing above is an advisory/critical item — an
  // active disruption item suppresses the green "all systems normal" line.
  if (items.length === 0 || items.every(i => i.cls === 'info')) {
    const countStr = allFlights.length > 0 ? ` — tracking ${allFlights.length} United flights` : '';
    items.unshift({ text: `✅ All systems normal${countStr}`, cls: 'info' });
  }

  // Compact disclaimer/attribution in the rotation so it is visible in the mobile
  // first viewport (the footer is far below the fold on phones).
  items.push({ text: 'Unofficial — not affiliated with United Airlines · Data: AeroDataBox · FR24 · AWC · FAA', cls: 'disclaimer' });

  const tickerHtml = items.map(i => `<span class="ticker-item ${escapeHtml(i.cls)}">${escapeHtml(i.text)}</span>`).join('');
  const tickerEl = document.getElementById('ticker');
  tickerEl.innerHTML = `<div class="ticker-cycle">${tickerHtml}</div><div class="ticker-cycle" aria-hidden="true">${tickerHtml}</div>`;
  initTickerAnimation(tickerEl);
}

// JS-driven ticker animation — measures actual content width for reliable scrolling
let _tickerRafId = null;
function initTickerAnimation(tickerEl) {
  // Cancel any previous animation
  if (_tickerRafId) { cancelAnimationFrame(_tickerRafId); _tickerRafId = null; }

  // Fade-rotation (via the ticker rotation IIFE) handles mobile AND the canopy ticker —
  // the marquee scroll only makes sense in a wide standalone bar. Structural check: if the
  // ticker lives inside #header (the canopy), never run the scroll animation. This cannot
  // race against data population the way a width measurement could.
  if (window.innerWidth <= 768 || tickerEl.closest('#header')) {
    tickerEl.style.animation = '';
    tickerEl.style.transform = '';
    return;
  }

  tickerEl.style.animation = 'none';
  tickerEl.style.transform = '';

  // Measure a single ticker cycle directly so short content is not clamped to container width.
  requestAnimationFrame(() => { requestAnimationFrame(() => {
    const firstCycle = tickerEl.querySelector('.ticker-cycle');
    if (!firstCycle) return;
    const contentWidth = Math.round(firstCycle.getBoundingClientRect().width);

    if (contentWidth < 10) return; // no real content

    // Set CSS custom property for the scroll offset and use CSS animation
    tickerEl.style.setProperty('--ticker-offset', `-${contentWidth}px`);
    // Speed: ~50px/s — adjust duration based on content width
    const duration = Math.max(15, contentWidth / 50);
    tickerEl.style.animation = `tickerScroll ${duration}s linear infinite`;

    // JS fallback: detect if CSS animation isn't running after 500ms
    let fallbackTimer = setTimeout(() => {
      // Use rAF to check computed style without forcing layout during critical path
      requestAnimationFrame(() => {
      const computedAnim = getComputedStyle(tickerEl).animationName;
      if (computedAnim === 'none' || computedAnim === '') {
        // CSS animation failed — drive with rAF
        tickerEl.style.animation = 'none';
        let pos = 0;
        const speed = 50; // px/s
        let lastTime = performance.now();
        function tickerStep(now) {
          const dt = (now - lastTime) / 1000;
          lastTime = now;
          pos -= speed * dt;
          if (pos <= -contentWidth) pos += contentWidth;
          tickerEl.style.transform = `translate3d(${pos}px,0,0)`;
          _tickerRafId = requestAnimationFrame(tickerStep);
        }
        _tickerRafId = requestAnimationFrame(tickerStep);
      }
      });
    }, 500);
  }); });
}

// ═══ FLEET TAB ═══
// FLEET_FAMILIES imported from ../lib/fleet-utils.js

let activeFleetType = '';
let activeFleetView = 'all';

let _fleetTabInitialized = false;
function renderFleetLoadError() {
  // F035: honest failure state — the fleet database genuinely didn't load, so
  // don't assert "0 Mainline Aircraft" as fact. refresh-fleet-data reloads the
  // page (fleet.json is fetched fresh on load), so it's a working retry.
  const titleEl = document.getElementById('fleet-overview-title');
  if (titleEl) titleEl.textContent = 'Fleet database unavailable';
  const healthEl = document.getElementById('fleet-health-content');
  if (healthEl) {
    healthEl.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--ua-muted);line-height:1.6">'
      + 'The fleet database could not be loaded, so counts and per-type stats are unavailable right now. '
      + 'This is a load error — not zero aircraft.<br>'
      + '<button data-action="refresh-fleet-data" style="margin-top:10px;padding:5px 14px;background:var(--ua-blue);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">↻ Retry</button>'
      + '</div>';
  }
}

function initFleetTab() {
  if (_fleetTabInitialized) return;
  // F035: if fleet.json failed to load, show the honest error state and DON'T
  // mark the tab initialized — a successful retry re-runs the full init.
  if (fleetLoadFailed && !FLEET_DB.length) {
    renderFleetLoadError();
    return;
  }
  _fleetTabInitialized = true;
  // Set dynamic fleet count in title
  document.getElementById('fleet-overview-title').textContent = 'Fleet Overview — ' + FLEET_DB.length + ' Mainline Aircraft';

  const typeCounts = {};
  FLEET_DB.forEach(a => { typeCounts[a.t] = (typeCounts[a.t] || 0) + 1; });
  const typeOrder = ["A319","A320","A321neo","737-700","737-800","737-900","737-900ER","737 MAX 8","737 MAX 9","757-200","757-300","767-300ER","767-400ER","777-200","777-200ER","777-300ER","787-8","787-9","787-10"];

  // Starlink progress — use live fleet stats if available
  const mainlineStarlink = STARLINK_FLEET_STATS ? STARLINK_FLEET_STATS.mainline : STARLINK_DB.filter(s => s.fleet === 'Mainline').length;
  if (FLEET_DB.length > 0) {
    document.getElementById('starlink-progress').style.width = (mainlineStarlink / FLEET_DB.length * 100) + '%';
    document.getElementById('starlink-pct').textContent = Math.round(mainlineStarlink / FLEET_DB.length * 100) + '% (' + mainlineStarlink + '/' + FLEET_DB.length + ')';
  }

  // Render fleet stats chips if live data available
  if (STARLINK_FLEET_STATS) {
    const statsEl = document.getElementById('starlink-fleet-stats');
    if (statsEl) {
      const fs = STARLINK_FLEET_STATS;
      // Note: all values are pre-sanitized integers from our own API
      const mainlinePct = (fs.mainlinePct != null) ? fs.mainlinePct : (fs.mainlineTotal ? Math.round(fs.mainline / fs.mainlineTotal * 100) : null);
      const expressPct = (fs.expressPct != null) ? fs.expressPct : (fs.expressTotal ? Math.round(fs.express / fs.expressTotal * 100) : null);
      const newThisWeek = STARLINK_DB.filter(s => isRecentlyFound(s.dateFound)).length;
      let chipsHtml = '';
      chipsHtml += '<div class="fleet-starlink-chip" style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2)"><span class="fleet-starlink-chip-val" style="color:var(--ua-green)">' + fs.total + '</span><span class="fleet-starlink-chip-label">Total</span></div>';
      chipsHtml += '<div class="fleet-starlink-chip" style="background:rgba(0,93,170,.1);border:1px solid rgba(0,93,170,.2)"><span class="fleet-starlink-chip-val" style="color:var(--ua-accent)">' + fs.mainline + '</span><span class="fleet-starlink-chip-label">Mainline</span></div>';
      chipsHtml += '<div class="fleet-starlink-chip" style="background:rgba(168,85,247,.1);border:1px solid rgba(168,85,247,.2)"><span class="fleet-starlink-chip-val" style="color:#a855f7">' + fs.express + '</span><span class="fleet-starlink-chip-label">Express</span></div>';
      if (mainlinePct != null) {
        chipsHtml += '<div class="fleet-starlink-chip" style="background:rgba(100,116,139,.08);border:1px solid rgba(100,116,139,.15)"><span class="fleet-starlink-chip-val" style="color:var(--ua-text)">' + mainlinePct + '%</span><span class="fleet-starlink-chip-label">Mainline Fleet</span></div>';
      }
      if (expressPct != null) {
        chipsHtml += '<div class="fleet-starlink-chip" style="background:rgba(100,116,139,.08);border:1px solid rgba(100,116,139,.15)"><span class="fleet-starlink-chip-val" style="color:var(--ua-text)">' + expressPct + '%</span><span class="fleet-starlink-chip-label">Express Fleet</span></div>';
      }
      if (newThisWeek > 0) {
        chipsHtml += '<div class="fleet-starlink-chip" style="background:var(--ua-amber-soft);border:1px solid rgba(196,163,90,.25)"><span class="fleet-starlink-chip-val" style="color:var(--ua-amber)">+' + newThisWeek + '</span><span class="fleet-starlink-chip-label">New (7d)</span></div>';
      }
      statsEl.innerHTML = chipsHtml;
    }
  }

  // (Starlink freshness indicator moved to the dedicated STARLINK tab — see renderSlHero)

  // Populate filters
  const wifiTypes = [...new Set(FLEET_DB.map(a => normalizeWifi(a.w)).filter(Boolean))].sort();
  const typeOptHtml = '<option value="">All Types</option>' +
    typeOrder.map(t => '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + ' (' + (typeCounts[t]||0) + ')</option>').join('');
  document.getElementById('fleet-filter-type').innerHTML = typeOptHtml;
  const wifiOptHtml = '<option value="">All WiFi</option>' +
    wifiTypes.map(w => '<option value="' + escapeHtml(w) + '">' + escapeHtml(w) + '</option>').join('');
  document.getElementById('fleet-filter-wifi').innerHTML = wifiOptHtml;

  if (pendingFleetDeepLinkFilter) {
    applyFleetDeepLinkFilter(pendingFleetDeepLinkFilter, { render: false });
    pendingFleetDeepLinkFilter = null;
  }

  renderFleetComposition();
  renderFleetTable();
  renderAgeChart();
  renderFleetHealth();
  renderSpecialAircraftPanel();
  updateFleetSubtabCounts();

  // Filter listeners — sync variant cards + config when type dropdown changes
  function onFleetFilterChange() {
    renderFleetTable();
    // Sync variant card highlight and config panel with type dropdown
    const typeVal = document.getElementById('fleet-filter-type').value;
    if (typeVal !== activeFleetType) {
      // Deselect old card
      document.querySelectorAll('.variant-card.active').forEach(c => c.classList.remove('active'));
      activeFleetType = typeVal || null;
      // Highlight new card if a type is selected
      if (activeFleetType) {
        document.querySelectorAll('.variant-card').forEach(c => {
          if (c.dataset.type === activeFleetType) c.classList.add('active');
        });
        showConfigGallery(activeFleetType);
      } else {
        showConfigEmpty();
      }
    }
  }
  const debouncedFleetRender = debounce(onFleetFilterChange, 120);
  ['fleet-filter-type','fleet-filter-wifi','fleet-filter-status','fleet-search'].forEach(id => {
    document.getElementById(id).addEventListener('input', debouncedFleetRender);
    document.getElementById(id).addEventListener('change', debouncedFleetRender);
  });
}

// ═══ ZONE 2: FLEET COMPOSITION ═══
function renderFleetComposition() {
  const typeCounts = {};
  FLEET_DB.forEach(a => { typeCounts[a.t] = (typeCounts[a.t] || 0) + 1; });

  let html = '';
  let widebodyDividerShown = false;

  FLEET_FAMILIES.forEach(family => {
    // Show widebody divider before first widebody family
    if (family.widebody && !widebodyDividerShown) {
      html += '<div class="fleet-widebody-divider">WIDEBODY · POLARIS</div>';
      widebodyDividerShown = true;
    }

    // Count total aircraft in this family
    let familyTotal = 0;
    family.subgroups.forEach(sg => sg.types.forEach(t => { familyTotal += typeCounts[t] || 0; }));

    html += '<div class="fleet-family" role="group" aria-label="' + escapeHtml(family.name) + ' family" id="family-' + family.id + '">';
    html += '<div class="fleet-family-header">';
    html += '<span class="fleet-family-name">' + escapeHtml(family.name) + '</span>';
    html += '<span class="fleet-family-count">' + familyTotal + ' aircraft</span>';
    html += '<span class="fleet-family-role">' + escapeHtml(family.role) + '</span>';
    html += '</div>';

    if (family.routeCallout) {
      html += '<div class="fleet-family-route">' + escapeHtml(family.routeCallout) + '</div>';
    }

    html += '<div class="fleet-family-body">';
    family.subgroups.forEach((sg, sgIdx) => {
      if (sgIdx > 0) {
        html += '<div class="fleet-subgroup-sep"></div>';
      }
      html += '<div class="fleet-subgroup">';
      if (sg.label) {
        html += '<div class="fleet-subgroup-label">' + escapeHtml(sg.label) + '</div>';
      }
      html += '<div class="fleet-subgroup-cards">';
      sg.types.forEach(type => {
        const count = typeCounts[type] || 0;
        const isActive = activeFleetType === type;
        html += '<div class="variant-card' + (isActive ? ' active' : '') + '" data-action="filter-fleet-type" data-type="' + escapeHtml(type) + '" tabindex="0" role="button" aria-pressed="' + isActive + '">';
        html += '<div class="variant-count">' + count + '</div>';
        html += '<div class="variant-name">' + escapeHtml(type) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    });
    html += '</div></div>';
  });

  document.getElementById('fleet-families').innerHTML = html;
}

let fleetSortCol = 'r', fleetSortAsc = true;
function renderFleetTable() {
  const typeF = document.getElementById('fleet-filter-type').value;
  const wifiF = document.getElementById('fleet-filter-wifi').value;
  const statusF = document.getElementById('fleet-filter-status').value;
  const searchF = document.getElementById('fleet-search').value.toUpperCase();

  let data = FLEET_DB.filter(a => {
    if (typeF && a.t !== typeF) return false;
    if (wifiF && normalizeWifi(a.w) !== wifiF) return false;
    if (statusF === 'active' && a.s) return false;
    if (statusF === 'stored' && !a.s) return false;
    if (statusF === 'starlink' && !STARLINK_TAILS.has(a.r)) return false;
    if (statusF === 'special' && !isSpecialAircraft(a.r)) return false;
    if (searchF && !a.r.toUpperCase().includes(searchF) && !a.c.toUpperCase().includes(searchF) && !a.t.toUpperCase().includes(searchF)) return false;
    return true;
  });

  data.sort((a, b) => {
    let va = a[fleetSortCol] || '', vb = b[fleetSortCol] || '';
    if (fleetSortCol === 'tot' || fleetSortCol === 'd' || fleetSortCol === 'a') {
      va = parseInt(va) || 0; vb = parseInt(vb) || 0;
    }
    return fleetSortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  const zeroEl = document.getElementById('fleet-zero-results');
  if (data.length === 0 && (typeF || wifiF || statusF || searchF)) {
    zeroEl.style.display = '';
  } else {
    zeroEl.style.display = 'none';
  }

  // Build rows using escapeHtml for all user-sourced data
  const rows = data.map(a => {
    const isSL = STARLINK_TAILS.has(a.r);
    const special = isSpecialAircraft(a.r);
    const rowCls = a.s ? (a.s.toLowerCase().includes('stored') ? 'row-stored' : (special ? '' : 'row-maint')) : '';
    return '<tr class="' + rowCls + '">' +
      '<td class="fleet-td-reg"><span class="ac-reg-link" data-action="aircraft-detail" data-reg="' + escapeHtml(a.r) + '">' + escapeHtml(a.r) + '</span>' + (special ? ' <span class="special-badge">' + escapeHtml(special.name) + '</span>' : '') + '</td>' +
      '<td>' + escapeHtml(a.t) + '</td><td>' + escapeHtml(a.a) + '</td><td>' + escapeHtml(a.c) + '</td>' +
      '<td>' + escapeHtml(String(a.tot ?? '')) + '</td><td>' + escapeHtml(normalizeWifi(a.w)) + '</td><td>' + escapeHtml(a.i) + '</td><td>' + escapeHtml(a.d) + '</td>' +
      '<td class="fleet-td-status">' + escapeHtml(a.s) + '</td>' +
      '<td>' + (isSL ? '<span class="starlink-badge">SL</span>' : '') + '</td>' +
    '</tr>';
  });
  document.getElementById('fleet-tbody').innerHTML = rows.join('');

  updateFleetSubtabCounts();
}

// Sort handler for fleet table
document.querySelectorAll('#fleet-table thead th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (fleetSortCol === col) fleetSortAsc = !fleetSortAsc;
    else { fleetSortCol = col; fleetSortAsc = true; }
    // Update aria-sort attributes
    document.querySelectorAll('#fleet-table thead th[data-sort]').forEach(h => h.setAttribute('aria-sort', 'none'));
    th.setAttribute('aria-sort', fleetSortAsc ? 'ascending' : 'descending');
    renderFleetTable();
  });
});

// ═══ FLEET HEALTH DASHBOARD (Zone 1 Right Panel) ═══
function renderFleetHealth() {
  if (!FLEET_DB.length) return;
  const counts = {};
  FLEET_HEALTH_CATEGORIES.forEach(c => { counts[c.key] = 0; });
  FLEET_DB.forEach(a => {
    const cat = categorizeFleetStatus(a.s);
    counts[cat] = (counts[cat] || 0) + 1;
  });
  const total = FLEET_DB.length;
  const nonActive = total - counts.active;

  let html = '<div class="fleet-health-summary">';
  html += '<div class="big-number">' + total + '</div>';
  html += '<div><div class="big-number-label">Total Mainline Aircraft</div>';
  html += '<div class="fleet-health-active-text">' + counts.active + ' active (' + (counts.active / total * 100).toFixed(1) + '%) · ' + nonActive + ' out of service</div></div>';
  html += '</div>';

  FLEET_HEALTH_CATEGORIES.forEach(cat => {
    const count = counts[cat.key] || 0;
    if (count === 0) return;
    const pct = (count / total * 100).toFixed(1);
    const barWidth = total > 0 ? (count / total * 100) : 0;
    html += '<div class="fleet-health-bar" aria-label="' + escapeHtml(cat.label) + ': ' + count + ' of ' + total + ', ' + pct + '%">';
    html += '<span class="fh-label"><span class="fh-legend-dot" style="background:' + cat.color + '"></span>' + escapeHtml(cat.label) + '</span>';
    html += '<div class="fh-track"><div class="fh-fill" style="width:' + barWidth + '%;background:' + cat.color + '"></div></div>';
    html += '<span class="fh-count">' + count + ' <span class="fh-pct">(' + pct + '%)</span></span>';
    html += '</div>';
  });

  document.getElementById('fleet-health-content').innerHTML = html;
}

// ═══ SPECIAL AIRCRAFT (Zone 3 - Special sub-tab) ═══
function renderSpecialAircraftPanel() {
  if (!FLEET_DB.length) return;
  const specialRegs = Object.keys(SPECIAL_AIRCRAFT);
  if (!specialRegs.length) {
    document.getElementById('special-aircraft-content').innerHTML =
      '<div class="fleet-loading-text">No special aircraft found</div>';
    return;
  }

  // Cross-reference with live flights for airborne status
  const airborneSpecial = {};
  if (allFlights && allFlights.length) {
    allFlights.forEach(f => {
      if (f.onGround) return;
      const reg = f.reg ? f.reg.replace('-', '') : null;
      if (reg && SPECIAL_AIRCRAFT[reg]) {
        airborneSpecial[reg] = {
          flight: f.flightIATA || f.callsign || '',
          route: (f.origin || '???') + ' > ' + (f.dest || '???')
        };
      }
    });
  }

  let gridHtml = '<div class="special-aircraft-grid">';
  specialRegs.forEach(reg => {
    const special = SPECIAL_AIRCRAFT[reg];
    const ac = FLEET_BY_REG[reg];
    if (!ac) return;
    const airborne = airborneSpecial[reg];

    gridHtml += '<div class="special-aircraft-item">';
    gridHtml += '<div>';
    gridHtml += '<div class="sa-name">' + escapeHtml(special.name) + '</div>';
    gridHtml += '<div><span class="sa-reg ac-reg-link" data-action="aircraft-detail" data-reg="' + escapeHtml(reg) + '">' + escapeHtml(reg) + '</span> <span class="sa-type">' + escapeHtml(ac.t) + ' · Del ' + escapeHtml(ac.d || '?') + '</span></div>';
    gridHtml += '</div>';
    gridHtml += '<div class="sa-status">';
    if (airborne) {
      gridHtml += '<span class="special-airborne-badge"><span class="pulse-dot"></span>AIRBORNE</span>';
      gridHtml += '<div class="sa-flight-info">' + escapeHtml(airborne.flight) + ' ' + escapeHtml(airborne.route) + '</div>';
    } else {
      gridHtml += '<span class="special-badge">' + (special.type === 'named' ? 'NAMED' : 'LIVERY') + '</span>';
    }
    gridHtml += '</div>';
    gridHtml += '</div>';
  });
  gridHtml += '</div>';

  document.getElementById('special-aircraft-content').innerHTML = gridHtml;
}

// ═══ ZONE 3: AIRBORNE TABLE ═══
let airborneSortCol = 'type', airborneSortAsc = true;
function renderAirborneTable() {
  if (!allFlights.length) {
    document.getElementById('airborne-tbody').innerHTML = '<tr><td colspan="8" class="fleet-loading-text">Loading live flight data...</td></tr>';
    return;
  }
  const typeF = document.getElementById('fleet-filter-type').value;
  const searchF = document.getElementById('fleet-search').value.toUpperCase();

  const airborne = [];
  allFlights.forEach(f => {
    if (f.onGround) return;
    const ac = matchAircraft(f);
    if (!ac) return;
    if (typeF && ac.t !== typeF) return;
    if (searchF && !ac.r.toUpperCase().includes(searchF) && !ac.t.toUpperCase().includes(searchF)) return;
    const routeStr = (f.origin || '???') + ' > ' + (f.dest || '???');
    const phase = getPhase(f.alt, f.vr, f.spd);
    const isStar = STARLINK_TAILS.has(ac.r) || STARLINK_TAILS.has(f.reg);
    airborne.push({
      reg: ac.r, type: ac.t,
      flight: f.flightIATA || f.callsign,
      route: routeStr,
      alt: f.alt ? Math.round(f.alt * 3.28084).toLocaleString() + 'ft' : '--',
      altRaw: f.alt || 0,
      phase: phase.phase,
      starlink: isStar,
      special: isSpecialAircraft(ac.r)
    });
  });

  airborne.sort((a, b) => {
    let va, vb;
    if (airborneSortCol === 'alt') { va = a.altRaw; vb = b.altRaw; }
    else { va = a[airborneSortCol] || ''; vb = b[airborneSortCol] || ''; }
    return airborneSortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  const rowsHtml = airborne.map(a => {
    return '<tr>' +
      '<td class="fleet-td-reg"><span class="ac-reg-link" data-action="aircraft-detail" data-reg="' + escapeHtml(a.reg) + '">' + escapeHtml(a.reg) + '</span></td>' +
      '<td>' + escapeHtml(a.type) + '</td><td>' + escapeHtml(a.flight) + '</td><td>' + escapeHtml(a.route) + '</td>' +
      '<td>' + escapeHtml(a.alt) + '</td><td>' + escapeHtml(a.phase) + '</td>' +
      '<td>' + (a.starlink ? '<span class="starlink-badge">SL</span>' : '') + '</td>' +
      '<td>' + (a.special ? '<span class="special-badge">' + escapeHtml(a.special.name) + '</span>' : '') + '</td>' +
    '</tr>';
  });
  document.getElementById('airborne-tbody').innerHTML = rowsHtml.join('');
}

// Sort handler for airborne table
document.querySelectorAll('#airborne-table thead th[data-airborne-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.getAttribute('data-airborne-sort');
    if (airborneSortCol === col) airborneSortAsc = !airborneSortAsc;
    else { airborneSortCol = col; airborneSortAsc = true; }
    renderAirborneTable();
  });
});

// ═══ FLEET SUB-TABS ═══
function switchFleetView(view) {
  activeFleetView = view;
  // Update sub-tab buttons
  document.querySelectorAll('.fleet-subtab').forEach(btn => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  // Show/hide panels
  document.querySelectorAll('.fleet-view-panel').forEach(panel => {
    panel.classList.remove('active');
    panel.style.display = 'none';
  });
  const activePanel = document.getElementById('fleet-view-' + view);
  if (activePanel) {
    activePanel.classList.add('active');
    activePanel.style.display = '';
  }
  // Show controls (the Starlink sub-view moved to its own top-level tab — its sub-tab button is now
  // a switch-tab redirect, so this function never receives view === 'starlink')
  const mainControls = document.getElementById('fleet-controls');
  if (mainControls) mainControls.style.display = '';
  // Render the active view
  if (view === 'airborne') renderAirborneTable();
  else if (view === 'special') renderSpecialAircraftPanel();
  else renderFleetTable();
}

function updateFleetSubtabCounts() {
  // All Aircraft count
  const allCount = FLEET_DB.length;
  const allEl = document.getElementById('fleet-subtab-count-all');
  if (allEl) allEl.textContent = '(' + allCount + ')';

  // Airborne count
  const airborneCount = allFlights.filter(f => !f.onGround && matchAircraft(f)).length;
  const airEl = document.getElementById('fleet-subtab-count-airborne');
  if (airEl) airEl.textContent = '(' + airborneCount + ')';

  // Starlink count
  const slEl = document.getElementById('fleet-subtab-count-starlink');
  if (slEl) slEl.textContent = '(' + STARLINK_DB.length + ')';

  // Special count
  const spEl = document.getElementById('fleet-subtab-count-special');
  if (spEl) spEl.textContent = '(' + Object.keys(SPECIAL_AIRCRAFT).length + ')';
}

// ═══ CROSS-ZONE INTERACTION ═══
function filterFleetType(type) {
  // Toggle: clicking the same type again deselects
  if (activeFleetType === type) {
    activeFleetType = '';
    document.getElementById('fleet-filter-type').value = '';
  } else {
    activeFleetType = type;
    document.getElementById('fleet-filter-type').value = type;
  }

  // Update variant card active states
  document.querySelectorAll('.variant-card').forEach(c => {
    const isActive = c.dataset.type === activeFleetType && activeFleetType !== '';
    c.classList.toggle('active', isActive);
    c.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  renderFleetTable();

  // Show config or reset to empty state
  if (activeFleetType) {
    showConfigGallery(activeFleetType);
    // Smooth scroll to Zone 3
    const lookupZone = document.getElementById('fleet-lookup-zone');
    if (lookupZone) lookupZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    showConfigEmpty();
  }

  // Also re-render active sub-tab if it's airborne
  if (activeFleetView === 'airborne') renderAirborneTable();
}

function showConfigGallery(type) {
  const aircraft = FLEET_DB.filter(a => a.t === type);
  const configs = {};
  aircraft.forEach(a => {
    const key = a.c || 'Unknown';
    if (!configs[key]) configs[key] = { count: 0, seats: a.seats, total: a.tot };
    configs[key].count++;
  });

  const colors = { J: '#2563eb', PP: '#0d9488', PE: '#0d9488', F: '#7c3aed', 'E+': '#16a34a', Y: '#475569', Domestic: '#6366f1' };
  let html = '<div class="fleet-config-title">' + escapeHtml(type) + ' Configurations</div>';

  for (const [cfg, data] of Object.entries(configs)) {
    html += '<div class="fleet-config-item">';
    html += '<div class="fleet-config-name"><strong>' + escapeHtml(cfg) + '</strong> <span class="fleet-config-meta">(' + data.count + ' aircraft, ' + (data.total || '?') + ' seats)</span></div>';
    html += '<div class="config-gallery">';
    if (data.seats) {
      for (const [cls, cnt] of Object.entries(data.seats)) {
        const w = Math.max(30, cnt / 2);
        html += '<div class="config-block" style="background:' + (colors[cls]||'#475569') + ';width:' + w + 'px">' + cnt + cls + '</div>';
      }
    }
    html += '</div></div>';
  }

  document.getElementById('config-display').innerHTML = html;
  // Also show in Zone 3 seat config panel
  document.getElementById('fleet-lookup-seat-config').innerHTML = html;
}

function showConfigEmpty() {
  const emptyHtml = '<div class="fleet-config-empty" id="fleet-config-empty">' +
    '<div class="fleet-config-empty-text">Select an aircraft type above to see cabin layout</div>' +
    '<div class="fleet-config-quick-links">' +
      '<span class="fleet-config-quick" data-action="filter-fleet-type" data-type="737-800">737-800</span>' +
      '<span class="fleet-config-quick" data-action="filter-fleet-type" data-type="A321neo">A321neo</span>' +
      '<span class="fleet-config-quick" data-action="filter-fleet-type" data-type="777-300ER">777-300ER</span>' +
    '</div></div>';
  document.getElementById('config-display').innerHTML = emptyHtml;
  document.getElementById('fleet-lookup-seat-config').innerHTML = '';
}

function clearFleetFilters() {
  document.getElementById('fleet-filter-type').value = '';
  document.getElementById('fleet-filter-wifi').value = '';
  document.getElementById('fleet-filter-status').value = '';
  document.getElementById('fleet-search').value = '';
  activeFleetType = '';
  document.querySelectorAll('.variant-card').forEach(c => {
    c.classList.remove('active');
    c.setAttribute('aria-pressed', 'false');
  });
  showConfigEmpty();
  renderFleetTable();
}

function renderAgeChart() {
  const familyColor = {
    'A319': '#8b5cf6', 'A320': '#8b5cf6', 'A321neo': '#a78bfa',
    '737-700': '#3b82f6', '737-800': '#3b82f6', '737-900': '#3b82f6', '737-900ER': '#3b82f6',
    '737 MAX 8': '#22c55e', '737 MAX 9': '#22c55e',
    '757-200': '#f59e0b', '757-300': '#f59e0b',
    '767-300ER': '#ef4444', '767-400ER': '#ef4444',
    '777-200': '#ec4899', '777-200ER': '#ec4899', '777-300ER': '#ec4899',
    '787-8': '#06b6d4', '787-9': '#06b6d4', '787-10': '#06b6d4'
  };
  const familyNames = {
    '#8b5cf6': 'A320 family', '#a78bfa': 'A321neo', '#3b82f6': '737NG',
    '#22c55e': '737 MAX', '#f59e0b': '757', '#ef4444': '767',
    '#ec4899': '777', '#06b6d4': '787'
  };

  // Group by year and family
  const yearData = {};
  FLEET_DB.forEach(a => {
    const y = parseInt(a.d);
    if (!y || y < 1990 || y > 2030) return;
    if (!yearData[y]) yearData[y] = { total: 0, families: {} };
    yearData[y].total++;
    const color = familyColor[a.t] || '#64748b';
    yearData[y].families[color] = (yearData[y].families[color] || 0) + 1;
  });

  const minYear = Math.min(...Object.keys(yearData).map(Number));
  const maxYear = Math.max(...Object.keys(yearData).map(Number));
  const allYears = [];
  for (let y = minYear; y <= maxYear; y++) allYears.push(y);

  const maxCount = Math.max(...Object.values(yearData).map(d => d.total), 1);
  const barH = 140;

  // Build stacked bars
  let barsHtml = '<div style="display:flex;align-items:flex-end;gap:1px;height:' + barH + 'px;padding:0">';
  allYears.forEach(y => {
    const d = yearData[y];
    if (!d) {
      barsHtml += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0"><div style="height:${barH}px"></div></div>`;
      return;
    }
    const totalH = (d.total / maxCount) * barH;
    let stackHtml = '';
    // Stack segments bottom-up
    const segments = Object.entries(d.families).sort((a, b) => b[1] - a[1]);
    segments.forEach(([color, count]) => {
      const segH = Math.max(1, (count / d.total) * totalH);
      stackHtml += `<div style="width:100%;height:${segH}px;background:${color};min-height:1px" title="${count} aircraft"></div>`;
    });

    const showLabel = d.total >= 15;
    barsHtml += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;cursor:default" title="${y}: ${d.total} aircraft">`;
    if (showLabel) barsHtml += `<div style="font-size:8px;color:var(--ua-accent);margin-bottom:1px;font-weight:700">${d.total}</div>`;
    barsHtml += `<div style="width:100%;display:flex;flex-direction:column;border-radius:2px 2px 0 0;overflow:hidden">${stackHtml}</div>`;
    barsHtml += `</div>`;
  });
  barsHtml += '</div>';

  // Year labels (show every 5 years + first/last)
  barsHtml += '<div style="display:flex;gap:1px">';
  allYears.forEach(y => {
    const show = y === minYear || y === maxYear || y % 5 === 0;
    barsHtml += `<div style="flex:1;text-align:center;font-size:8px;color:${show ? 'var(--ua-muted)' : 'transparent'};min-width:0;overflow:hidden">${show ? y : '·'}</div>`;
  });
  barsHtml += '</div>';

  // Legend
  const usedColors = new Set();
  FLEET_DB.forEach(a => { const c = familyColor[a.t]; if (c) usedColors.add(c); });
  barsHtml += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">';
  [...usedColors].forEach(c => {
    barsHtml += `<span style="font-size:9px;color:var(--ua-muted);display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;background:${c};border-radius:2px;display:inline-block"></span>${familyNames[c] || '?'}</span>`;
  });
  barsHtml += '</div>';

  document.getElementById('age-chart').innerHTML = barsHtml;

  // Stats
  const currentYear = new Date().getFullYear();
  const ages = FLEET_DB.filter(a => parseInt(a.d)).map(a => currentYear - parseInt(a.d));
  const avgAge = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : '--';
  const newest = FLEET_DB.filter(a => parseInt(a.d)).sort((a, b) => parseInt(b.d) - parseInt(a.d))[0];
  const oldest = FLEET_DB.filter(a => parseInt(a.d)).sort((a, b) => parseInt(a.d) - parseInt(b.d))[0];

  // Decade breakdown
  const decades = {'0-5y': 0, '6-10y': 0, '11-15y': 0, '16-20y': 0, '20y+': 0};
  ages.forEach(a => {
    if (a <= 5) decades['0-5y']++;
    else if (a <= 10) decades['6-10y']++;
    else if (a <= 15) decades['11-15y']++;
    else if (a <= 20) decades['16-20y']++;
    else decades['20y+']++;
  });

  document.getElementById('age-stats').innerHTML =
    `Average: <strong style="color:var(--ua-accent)">${avgAge}y</strong> · ` +
    `Newest: <strong style="color:var(--ua-green)">${newest?.r} (${newest?.d})</strong> · ` +
    `Oldest: <strong style="color:var(--ua-yellow)">${oldest?.r} (${oldest?.d})</strong><br>` +
    Object.entries(decades).map(([k, v]) => `<span style="margin-right:8px">${k}: <strong>${v}</strong></span>`).join('');
}

// ═══ STARLINK TAB ═══
// Dedicated top-level tab (#tab-starlink): rollout hero + filterable table where every row expands
// inline into that aircraft's flight timeline and actions. Spec:
// docs/superpowers/specs/2026-06-01-starlink-tab-design.md
let slSortKey = 'tail', slSortAsc = true;
let slInitialized = false;
let slExpandedTail = null;   // tail of the one currently-expanded row (null = none)
let slShowNewOnly = false;   // "★ New this week" quick filter
// Verification Ledger: community-spreadsheet Starlink claims that official united.com verification
// OVERRULED. Upstream already excludes these from the served fleet, so a disputed tail should never
// appear in STARLINK_TAILS — see getServedConflictTails() for the render-time integrity tripwire.
let STARLINK_DISPUTED = [];         // [{ tail, aircraft, operator, verifiedAs, verifiedAt, dateFound }]
let STARLINK_VERIFY_SUMMARY = null; // { verifiedStarlink, disputed, unverified, totalPlanes, generatedAt }
let slMismatchesFetched = false;    // one-shot fetch guard (the ledger changes slowly)

// Departures-board state (the hub FIDS panel above the roster table)
let slBoardHub = null;       // active hub filter; null = all hubs
let slBoardWindow = 12;      // departure window in hours: 12 (default) | 48
let slBoardShowAll = false;  // bypass the per-hub render cap (48h view)

// A plane counts as "newly equipped" if upstream first recorded its Starlink (DateFound) within the
// last 7 days. Computed against the live clock so the badge ages out on its own.
function isRecentlyFound(dateFound) {
  if (!dateFound) return false;
  const t = Date.parse(dateFound);
  if (isNaN(t)) return false;
  const now = Date.now();
  return t <= now + 86400000 && (now - t) <= 7 * 86400000;
}

// Format an upstream departure timestamp (UNIX seconds) as a short HH:MM hint.
// Hub-local with the hub TZ abbreviation when the airport is a known hub — the
// Schedule tab is hub-local, and the FIDS board showing unlabeled viewer-local
// times next to it was silently inconsistent (audit Jul 3 2026). Non-hub airports
// fall back to viewer-local but ALWAYS carry a TZ label so the time is never
// ambiguous.
function formatFlightTime(ts, airportIata) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  const tz = SCHED_HUB_TZ[airportIata];
  if (tz) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
      + ' ' + getHubTzAbbrev(airportIata);
  }
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
}

// Map of tail → live airborne flight from the LIVE OPS feed. One pass over allFlights; cheap enough
// to rebuild per render.
function getStarlinkAirborneMap() {
  const live = {};
  for (const f of allFlights) {
    if (f.onGround) continue;
    const reg = (f.reg || '').replace(/-/g, '').toUpperCase();
    if (reg && STARLINK_TAILS.has(reg)) live[reg] = f;
  }
  return live;
}

// Idempotent init for the STARLINK tab — wires filters/sort once, then (re)renders hero + table.
function initStarlinkTab() {
  if (!slInitialized && STARLINK_DB.length > 0) {
    slInitialized = true;

    // Populate type and operator dropdowns from actual data (already normalized server-side)
    const types = [...new Set(STARLINK_DB.map(s => s.type))].sort();
    const operators = [...new Set(STARLINK_DB.map(s => s.operator))].sort();
    const typeSelect = document.getElementById('sl-filter-type');
    const opSelect = document.getElementById('sl-filter-operator');
    types.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; typeSelect.appendChild(o); });
    operators.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; opSelect.appendChild(o); });

    // Filter listeners — any change collapses the expanded row and re-renders
    ['sl-search', 'sl-filter-fleet', 'sl-filter-type', 'sl-filter-operator'].forEach(id => {
      document.getElementById(id).addEventListener(id === 'sl-search' ? 'input' : 'change', () => {
        slExpandedTail = null;
        renderSlTable();
      });
    });

    // "★ New this week" quick filter toggle
    document.getElementById('sl-filter-new').addEventListener('click', function() {
      slShowNewOnly = !slShowNewOnly;
      this.setAttribute('aria-pressed', slShowNewOnly ? 'true' : 'false');
      slExpandedTail = null;
      renderSlTable();
    });

    // Sort headers
    document.querySelectorAll('[data-sl-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sl-sort');
        if (slSortKey === key) slSortAsc = !slSortAsc;
        else { slSortKey = key; slSortAsc = true; }
        slExpandedTail = null;
        renderSlTable();
      });
    });
  }
  renderSlHero();
  renderSlTrend();
  renderSlChart();
  renderSlRoutesBoard();
  renderSlTable();
  fetchStarlinkMismatches(); // lazy/non-blocking; resolves into renderSlVerification()
  renderSlVerification();    // reflect any already-loaded ledger on an idempotent re-open
}

// ═══ VERIFICATION LEDGER ═══
// Fetches the disputed-claims ledger from /api/starlink-mismatches. Mirrors fetchStarlinkPredictions:
// lazy, non-blocking, and a failure or empty list simply hides the panel — it never blocks the tab.
function fetchStarlinkMismatches() {
  if (slMismatchesFetched) return;
  slMismatchesFetched = true;
  fetch('/api/starlink-mismatches')
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && Array.isArray(data.disputed)) {
        STARLINK_DISPUTED = data.disputed;
        STARLINK_VERIFY_SUMMARY = data.summary || null;
      } else {
        STARLINK_DISPUTED = [];
        STARLINK_VERIFY_SUMMARY = null;
        slMismatchesFetched = false; // allow a retry on the next tab open
      }
      renderSlVerification();
      renderSlTable(); // re-render rows so an integrity conflict can flag the offending tail
    })
    .catch(() => {
      STARLINK_DISPUTED = [];
      STARLINK_VERIFY_SUMMARY = null;
      slMismatchesFetched = false;
      renderSlVerification();
    });
}

// Render-time integrity tripwire: disputed tails that upstream STILL serves in the equipped fleet.
// If it ever becomes non-empty, renderSlVerification() raises an INTEGRITY ALERT and renderSlTable()
// flags the offending rows.
//
// Propagation guard: the fleet comes from the 4-hourly sync-starlink snapshot while the disputed
// ledger is near-live (45-min cache), so a tail verified AFTER the served snapshot was taken is a
// normal, self-healing race (next cron prunes it) — not a pipeline fault. Alert only when the
// snapshot POST-dates the verification and still contains the tail. Observed live Jul 2 2026:
// N34131 verified 18:17Z against a 16:00Z snapshot rendered a false "check the data pipeline".
function getServedConflictTails() {
  const set = new Set();
  const syncedMs = STARLINK_SYNCED_AT ? Date.parse(STARLINK_SYNCED_AT) : NaN;
  for (const d of STARLINK_DISPUTED) {
    if (!d || !d.tail || !STARLINK_TAILS.has(d.tail)) continue;
    const verifiedMs = d.verifiedAt ? Date.parse(d.verifiedAt) : NaN;
    // Both timestamps known and the dispute is newer than the served snapshot → propagation lag.
    if (!isNaN(syncedMs) && !isNaN(verifiedMs) && verifiedMs > syncedMs) continue;
    set.add(d.tail);
  }
  return set;
}

function formatVerifyDate(iso) {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// Stat strip + disputed table + the load-bearing integrity guard. Empty/failed ledger → hidden.
function renderSlVerification() {
  const section = document.getElementById('sl-verification');
  if (!section) return;

  const summary = STARLINK_VERIFY_SUMMARY;
  const disputed = Array.isArray(STARLINK_DISPUTED) ? STARLINK_DISPUTED : [];
  const subEl = document.getElementById('sl-hero-verify-sub');

  // Degraded tier / fetch miss / empty ledger → hide the whole panel (mirrors other tab guards).
  // adapt() returns a truthy zero-filled summary on any HTTP 200, so a shape drift (upstream
  // renames a field we don't recognise) would otherwise render a contradictory "0 / 0 / 0" panel
  // and a "0 verified · 0 disputed" hero sub-line under the big 400. Treat "no meaningful data"
  // (no disputed rows AND every summary counter zero/absent) as empty and hide.
  const hasData = disputed.length > 0 || !!(summary && (
    summary.verifiedStarlink || summary.disputed || summary.unverified || summary.totalPlanes
  ));
  if (!hasData) {
    section.style.display = 'none';
    if (subEl) subEl.style.display = 'none';
    return;
  }
  section.style.display = '';

  // (1) Stat strip — verified / disputed / unverified from the summary.
  const v = summary || {};
  const disputedCount = (v.disputed != null) ? v.disputed : disputed.length;
  document.getElementById('sl-verify-verified').textContent = (v.verifiedStarlink != null) ? v.verifiedStarlink : '—';
  document.getElementById('sl-verify-disputed').textContent = disputedCount;
  document.getElementById('sl-verify-unverified').textContent = (v.unverified != null) ? v.unverified : '—';

  // Load-bearing guard.
  const conflicts = getServedConflictTails();
  const alertEl = document.getElementById('sl-verify-alert');
  if (conflicts.size > 0) {
    const tails = [...conflicts].map(escapeHtml).join(', ');
    alertEl.innerHTML = '<span class="sl-verify-alert-badge">⚠ INTEGRITY ALERT</span>' +
      '<span class="sl-verify-alert-text">' + conflicts.size + ' disputed ' +
      (conflicts.size === 1 ? 'tail is' : 'tails are') +
      ' still present in the served Starlink fleet: <strong>' + tails + '</strong>. ' +
      'These were overruled by official verification and should be excluded — check the data pipeline.</span>';
    alertEl.style.display = '';
  } else {
    alertEl.style.display = 'none';
    alertEl.innerHTML = '';
  }

  // (2) Disputed table — Tail · Airframe · "DISPUTED Starlink → Viasat/Thales" · verified-when.
  const tbody = document.getElementById('sl-verify-tbody');
  if (disputed.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="sl-verify-empty">No disputed claims on record.</td></tr>';
  } else {
    tbody.innerHTML = disputed.map(d => {
      const tail = escapeHtml(d.tail || '');
      const air = escapeHtml(d.aircraft || '—');
      const verifiedAs = escapeHtml(d.verifiedAs || 'Not Starlink');
      const when = d.verifiedAt ? escapeHtml(formatVerifyDate(d.verifiedAt)) : '—';
      const conflictDot = conflicts.has(d.tail)
        ? ' <span class="sl-verify-dot" title="Still served in the equipped fleet — integrity conflict">!</span>'
        : '';
      return '<tr>' +
        '<td><span class="sl-tail">' + tail + '</span>' + conflictDot + '</td>' +
        '<td>' + air + '</td>' +
        '<td class="sl-verify-transition"><span class="sl-verify-badge">Disputed</span> Starlink <span class="sl-verify-arrow">→</span> ' + verifiedAs + '</td>' +
        '<td class="sl-verify-when">' + when + '</td>' +
        '</tr>';
    }).join('');
  }

  // Optional muted hero sub-line — keeps the 397/disputed figures strictly inside this panel's
  // context so they never overwrite the served count in the big hero number.
  if (subEl) {
    if (summary && summary.verifiedStarlink != null) {
      // "N disputed" jumps to the verification ledger (a plain hash link can't reach it — the ledger
      // lives inside the #tab-starlink scroll container, so the dispatch handler uses scrollIntoView).
      // Both values are our own integer counts (coerced to Number so the innerHTML can carry no markup).
      subEl.innerHTML = Number(summary.verifiedStarlink) + ' verified · ' +
        '<span class="sl-verify-jump" data-action="sl-jump-verify" role="button" tabindex="0" ' +
        'title="Jump to the verification ledger">' + Number(disputedCount) + ' disputed</span>';
      subEl.style.display = '';
    } else {
      subEl.style.display = 'none';
    }
  }
}

// ═══ INSTALL PACE ═══
// Compact rolling 12-week sparkline + 3-up readout (this week / 8-wk avg / Express ETA), built from
// CSS divs (no chart library). Pace math + backfill clamp live in computeInstallPace (starlink-utils).
// HONESTY: dateFound is a DETECTION date — ~121 tails share one backfill date — so this shows ROLLING
// WEEKLY ADDS over a 12-week window (never an all-time cumulative cliff), clamps backfill spikes, and
// frames the ETA as Express-fleet "at current pace …", never a commitment.
function renderSlTrend() {
  // Pace + ETA, rendered as the caption stat-row inside the Installation Velocity card
  // (#sl-velo-stats). This was a standalone "Install Pace" panel with a 12-week sparkline, but that
  // retold the velocity chart's story at a coarser zoom and led with a partial-week "0" that read as
  // a stalled feed. We keep only the two things the monthly chart can't show: the trailing weekly
  // pace and the Express-fleet "at current pace" ETA. Pace math + backfill clamp live in
  // computeInstallPace (starlink-utils).
  const row = document.getElementById('sl-velo-stats');
  if (!row) return;

  const fs = STARLINK_FLEET_STATS;
  // Express remaining drives the ETA. Mainline (much of which is widebody/retiring that may never get
  // Starlink) is deliberately NOT used as the ETA denominator — see spec.
  const expressRemaining = (fs && fs.expressTotal && fs.express != null)
    ? Math.max(0, fs.expressTotal - fs.express) : null;
  const pace = computeInstallPace(STARLINK_DB, new Date(),
    expressRemaining != null ? { remaining: expressRemaining } : {});

  // Degraded mode (static fallback carries no dateFound): hide the stats, same guard the chart uses.
  if (pace.dated === 0) { row.style.display = 'none'; return; }
  row.style.display = '';

  // Trailing weekly pace — derived from our own data, safe as textContent.
  const paceStr = pace.pace >= 10 ? String(Math.round(pace.pace)) : String(Math.round(pace.pace * 10) / 10);
  document.getElementById('sl-trend-pace').textContent = pace.pace > 0 ? '~' + paceStr : '—';
  const paceNote = document.getElementById('sl-trend-pace-note');
  if (paceNote) paceNote.textContent = pace.paceWeeks > 0 ? pace.paceWeeks + '-wk trailing pace' : 'no complete weeks';

  // Featured amber ETA — Express-fleet, "at current pace", never a commitment. Drops to em-dash when
  // pace or the Express denominator is unavailable.
  const etaEl = document.getElementById('sl-trend-eta');
  const etaNote = document.getElementById('sl-trend-eta-note');
  if (pace.etaDate) {
    const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    etaEl.textContent = '~' + MON[pace.etaDate.getUTCMonth()] + " '" + String(pace.etaDate.getUTCFullYear()).slice(2);
    if (etaNote) etaNote.textContent = 'Express · at current pace';
  } else {
    etaEl.textContent = '—';
    if (etaNote) etaNote.textContent = expressRemaining == null ? 'Express fleet n/a' : 'pace too low';
  }
}

// ═══ INSTALLATION VELOCITY CHART ═══
// Stacked monthly bars (Express green / Mainline blue) + amber cumulative line, built as pure SVG
// from STARLINK_DB dateFound. No chart library. Spec: 2026-06-01-starlink-velocity-chart-design.md
function renderSlChart() {
  const card = document.getElementById('sl-chart-card');
  const svg = document.getElementById('sl-chart');
  if (!card || !svg) return;

  const { months, undated } = bucketInstallsByMonth(STARLINK_DB);
  // Degraded mode (static fallback has no dateFound): keep the card hidden entirely
  if (months.length === 0) { card.style.display = 'none'; return; }
  card.style.display = '';

  // Date-range subtitle — full month + year on both ends for clarity
  const subEl = document.getElementById('sl-chart-sub');
  if (subEl) {
    const fmtYm = (ym) => {
      const [y, mo] = ym.split('-');
      return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(mo) - 1] + ' ' + y;
    };
    subEl.textContent = 'Aircraft equipped per month · ' + fmtYm(months[0].ym) + ' – ' + fmtYm(months[months.length - 1].ym);
  }

  // ── Scales ──
  // Outlier-aware bar cap: if the biggest month dwarfs the second biggest (the Dec '25 tracker
  // catch-up batch), cap the bar axis at the second biggest + headroom and mark capped bars.
  const sorted = months.map(m => m.total).sort((a, b) => b - a);
  const maxT = sorted[0] || 0, secondT = sorted[1] || 0;
  const hasOutlier = months.length > 2 && maxT > 2 * secondT;
  const cap = Math.max(5, Math.ceil((hasOutlier ? secondT * 1.2 : maxT) / 5) * 5);
  const maxCum = months[months.length - 1].cumulative || 1;

  // ── Geometry ──
  const W = 940, H = 280, padL = 40, padR = 46, padT = 18, padB = 34;
  const cw = W - padL - padR, ch = H - padT - padB;
  const n = months.length, step = cw / n, bw = Math.max(8, Math.floor(step * 0.56));

  let s = '';

  // Left-axis gridlines (monthly installs)
  [0, Math.round(cap / 3), Math.round(cap * 2 / 3), cap].forEach(v => {
    const y = padT + ch - (v / cap) * ch;
    s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="var(--ua-border-subtle)" stroke-width="1"/>';
    s += '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" fill="var(--ua-dim)" font-size="9" text-anchor="end">' + v + '</text>';
  });

  // Bars
  const cappedMonths = [];
  months.forEach((d, i) => {
    const x = padL + i * step + (step - bw) / 2;
    const isCapped = d.total > cap;
    const visTotal = Math.min(d.total, cap);
    // Express portion fills from the bottom; Mainline stacks on top (proportional within the cap)
    const eVis = isCapped ? visTotal * (d.express / d.total) : d.express;
    const mVis = visTotal - eVis;
    const eh = (eVis / cap) * ch;
    const mh = (mVis / cap) * ch;
    const yE = padT + ch - eh;
    const yM = yE - mh;
    if (eVis > 0) s += '<rect x="' + x + '" y="' + yE + '" width="' + bw + '" height="' + eh + '" fill="var(--ua-green)" opacity="0.85" rx="1"/>';
    if (mVis > 0) s += '<rect x="' + x + '" y="' + yM + '" width="' + bw + '" height="' + mh + '" fill="var(--ua-accent)" opacity="0.9" rx="1"/>';

    if (isCapped) {
      cappedMonths.push(d);
      // Jagged break marker across the bar top + count label
      const yTop = padT;
      let zig = 'M ' + (x - 2) + ' ' + (yTop + 8);
      for (let z = 0; z < Math.ceil((bw + 4) / 8); z++) zig += ' l 4 -5 l 4 5';
      s += '<path d="' + zig + '" stroke="var(--ua-dim)" fill="none" stroke-width="1.5"/>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (yTop - 6) + '" fill="var(--ua-green)" font-size="10" font-weight="700" text-anchor="middle">' + d.total + '*</text>';
    } else if (d.total > 0) {
      s += '<text x="' + (x + bw / 2) + '" y="' + (padT + ch - (visTotal / cap) * ch - 5) + '" fill="var(--ua-muted)" font-size="9" text-anchor="middle">' + d.total + '</text>';
    }

    // Month label (thin out on dense charts: always label months that carry a year, else every other)
    const showLabel = n <= 18 || d.label.indexOf(' ') !== -1 || i % 2 === 0;
    if (showLabel) s += '<text x="' + (x + bw / 2) + '" y="' + (H - padB + 16) + '" fill="var(--ua-dim)" font-size="8.5" text-anchor="middle">' + d.label + '</text>';
  });

  // Cumulative line + dots (right axis scale)
  let path = '';
  months.forEach((d, i) => {
    const x = padL + i * step + step / 2;
    const y = padT + ch - (d.cumulative / maxCum) * ch;
    path += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
  });
  s += '<path d="' + path + '" stroke="var(--ua-amber)" stroke-width="2" fill="none"/>';
  months.forEach((d, i) => {
    const x = padL + i * step + step / 2;
    const y = padT + ch - (d.cumulative / maxCum) * ch;
    s += '<circle cx="' + x + '" cy="' + y + '" r="2.5" fill="var(--ua-amber)"/>';
  });

  // Right-axis labels (cumulative) + end value
  [0, Math.round(maxCum / 4), Math.round(maxCum / 2), Math.round(maxCum * 3 / 4), maxCum].forEach(v => {
    const y = padT + ch - (v / maxCum) * ch;
    s += '<text x="' + (W - padR + 8) + '" y="' + (y + 3) + '" fill="var(--ua-amber)" opacity="0.7" font-size="9">' + v + '</text>';
  });
  const lastY = padT + ch - ch;
  s += '<text x="' + (W - padR - 4) + '" y="' + (lastY - 4) + '" fill="var(--ua-amber)" font-size="11" font-weight="700" text-anchor="end">' + maxCum + '</text>';

  svg.innerHTML = s;

  // Footnote: capped months (with the known Dec '25 batch context) + undated count
  const fnEl = document.getElementById('sl-chart-footnote');
  if (fnEl) {
    const notes = [];
    cappedMonths.forEach(d => {
      let note = '* ' + d.label + ': ' + d.total + ' (exceeds chart scale)';
      if (d.ym === '2025-12') note += ' — includes a 117-aircraft tracker catch-up batch on Dec 3';
      notes.push(note);
    });
    if (undated > 0) notes.push(undated + ' aircraft have no recorded install date');
    fnEl.textContent = notes.join(' · ');
  }
}

// ═══ HUB DEPARTURES BOARD ═══
// A NOC-style FIDS built 100% client-side from STARLINK_FLIGHTS_BY_TAIL (no endpoint, no server
// change). Flattens the per-tail flights, joins fleet + live-airborne data, keeps hub departures in
// the active window, and groups them under time-bucket section labels. Honesty: callsigns are the
// OPERATING carrier (SKW####/RPA####/…), not UA marketing numbers, and times are scheduled/last-seen
// (served through BB's up-to-6h cache), not live ATC — both are labelled as such on the panel.
function renderSlRoutesBoard() {
  const board = document.getElementById('sl-board');
  if (!board) return;
  const note = document.getElementById('sl-board-note');

  // Degraded tier (static fallback has empty flightsByTail / no fleet): hide the whole panel and
  // surface a one-line note instead — mirrors the sl-next-th column toggle.
  const hasFlights = Object.keys(STARLINK_FLIGHTS_BY_TAIL).length > 0;
  if (!hasFlights || STARLINK_DB.length === 0) {
    board.style.display = 'none';
    if (note) note.style.display = '';
    return;
  }
  board.style.display = '';
  if (note) note.style.display = 'none';

  const aircraftByTail = {};
  for (const s of STARLINK_DB) aircraftByTail[s.tail] = s;
  const airborneByTail = getStarlinkAirborneMap(); // tail → live flight (has icao24)

  const now = Date.now() / 1000;
  const windowSec = slBoardWindow * 3600;
  // Tame the default. The all-hubs 12h list is ~180 rows — a wall that buries the roster and the
  // ledger below it. Cap to a tight per-hub slice in the all-hubs view (the "Show all" button
  // expands it); a single-hub 12h view shows everything; the wide 48h view stays capped at 40/hub.
  const capPerHub = slBoardShowAll ? Infinity
    : !slBoardHub ? 6
    : slBoardWindow >= 48 ? 40
    : Infinity;

  const data = buildDeparturesBoard(STARLINK_FLIGHTS_BY_TAIL, aircraftByTail, airborneByTail, HUB_CODES, {
    now, windowSec, graceSec: 1800, hub: slBoardHub, capPerHub,
  });

  // Freshness — surface STARLINK_LAST_UPDATED so the panel never reads as live ATC.
  const freshEl = document.getElementById('sl-board-updated');
  if (freshEl) {
    if (STARLINK_LAST_UPDATED) {
      const ago = Math.round((Date.now() - new Date(STARLINK_LAST_UPDATED).getTime()) / 60000);
      freshEl.textContent = ago < 60 ? ('updated ' + ago + 'm ago')
        : ago < 1440 ? ('updated ' + Math.round(ago / 60) + 'h ago')
        : ('updated ' + Math.round(ago / 1440) + 'd ago');
    } else {
      freshEl.textContent = 'scheduled times';
    }
  }

  // Window toggle active state
  document.querySelectorAll('#sl-board-windows [data-window]').forEach(btn => {
    const on = Number(btn.dataset.window) === slBoardWindow;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  // Hub-filter pills (Cross-Nav rectangular pill component). Counts are integers from our own data.
  const pillsEl = document.getElementById('sl-board-pills');
  if (pillsEl) {
    const allActive = !slBoardHub;
    const pills = [
      `<button class="sl-board-pill${allActive ? ' active' : ''}" data-action="sl-board-hub" data-hub="" aria-pressed="${allActive}">ALL <span class="sl-board-pill-n">${data.allCount}</span></button>`,
    ];
    for (const h of HUB_CODES) {
      const n = data.hubCounts[h] || 0;
      const active = slBoardHub === h;
      pills.push(
        `<button class="sl-board-pill${active ? ' active' : ''}${n === 0 ? ' sl-board-pill-empty' : ''}" data-action="sl-board-hub" data-hub="${escapeHtml(h)}" aria-pressed="${active}">${escapeHtml(h)} <span class="sl-board-pill-n">${n}</span></button>`
      );
    }
    pillsEl.innerHTML = pills.join('');
  }

  // Body — time-bucket sections
  const body = document.getElementById('sl-board-body');
  if (!body) return;
  if (data.buckets.length === 0) {
    const scope = slBoardHub ? escapeHtml(slBoardHub) : 'the hubs';
    body.innerHTML = `<div class="sl-board-empty">No United Starlink departures from ${scope} in the next ${slBoardWindow}h.</div>`;
    return;
  }

  let html = '';
  for (const bucket of data.buckets) {
    html += `<div class="sl-board-bucket-label">${escapeHtml(bucket.label)} <span class="sl-board-bucket-n">${bucket.rows.length}</span></div>`;
    for (const r of bucket.rows) html += renderSlBoardRow(r, now);
  }
  if (data.hiddenCount > 0) {
    html += `<button class="sl-board-showall" data-action="sl-board-show-all">Show all · ${data.hiddenCount} more departures ▾</button>`;
  }
  body.innerHTML = html;
}

// One departures-board row: scheduled time + relative hint, operating callsign + carrier, route,
// airframe, and live status (📡 Track reuses the existing delegated sl-track → focusFlight action;
// the callsign opens the existing aircraft-detail modal). All fields are escaped.
function renderSlBoardRow(r, now) {
  const t = formatFlightTime(r.departure_ts, r.origin);
  const mins = Math.round((r.departure_ts - now) / 60);
  let rel;
  if (mins < 0) rel = Math.abs(mins) + 'm ago';
  else if (mins < 60) rel = '+' + mins + 'm';
  else { const h = Math.floor(mins / 60), mm = mins % 60; rel = '+' + h + 'h' + (mm ? ' ' + mm + 'm' : ''); }

  // Operator label: drop the " dba UAX"/"dba United Express" tail so the carrier reads cleanly.
  const operator = (r.operator || '').replace(/\s*dba\b.*$/i, '').trim() || 'United';

  const status = r.airborne
    ? '<span class="sl-board-live">● Airborne</span>'
    : '<span class="sl-board-sched">SCHED</span>';
  const track = (r.airborne && r.icao24)
    ? `<button class="sl-board-track" data-action="sl-track" data-icao24="${escapeHtml(r.icao24)}" title="Track ${escapeHtml(r.tail)} on the live map">📡 Track</button>`
    : '';

  return `<div class="sl-board-row${r.airborne ? ' airborne' : ''}">` +
    `<span class="sl-board-time">${escapeHtml(t)}<span class="sl-board-rel">${escapeHtml(rel)}</span></span>` +
    `<button class="sl-board-flt" data-action="aircraft-detail" data-reg="${escapeHtml(r.tail)}" title="Aircraft details · ${escapeHtml(r.tail)}">` +
      `<span class="sl-board-cs">${escapeHtml(r.flight_number || '—')}</span>` +
      `<span class="sl-board-op">${escapeHtml(operator)} · ${escapeHtml(r.tail)}</span>` +
    `</button>` +
    `<span class="sl-board-route"><span class="sl-board-orig">${escapeHtml(r.origin)}</span><span class="sl-board-arrow">→</span><span class="sl-board-dest">${escapeHtml(r.destination || '???')}</span></span>` +
    `<span class="sl-board-type">${escapeHtml(r.type || '')}</span>` +
    `<span class="sl-board-status">${status}${track}</span>` +
  `</div>`;
}

// Hero band: equipped count, Express/Mainline rollout bars, new-this-week + airborne-now chips.
function renderSlHero() {
  const countEl = document.getElementById('sl-hero-count');
  if (!countEl) return;
  const fs = STARLINK_FLEET_STATS;
  const total = fs ? fs.total : STARLINK_DB.length;
  countEl.textContent = total || '—';

  // Rollout bars need fleet denominators — hide them in degraded (static-fallback) mode
  const barsEl = document.getElementById('sl-bars');
  if (fs && fs.expressTotal && fs.mainlineTotal) {
    barsEl.style.display = '';
    const expressPct = (fs.expressPct != null) ? fs.expressPct : Math.round(fs.express / fs.expressTotal * 100);
    const mainlinePct = (fs.mainlinePct != null) ? fs.mainlinePct : Math.round(fs.mainline / fs.mainlineTotal * 100);
    document.getElementById('sl-bar-express').style.width = expressPct + '%';
    document.getElementById('sl-bar-mainline').style.width = mainlinePct + '%';
    document.getElementById('sl-bar-express-val').textContent = fs.express + ' / ' + fs.expressTotal + ' · ' + expressPct + '%';
    document.getElementById('sl-bar-mainline-val').textContent = fs.mainline + ' / ' + fs.mainlineTotal + ' · ' + mainlinePct + '%';
  } else {
    barsEl.style.display = 'none';
  }

  // Chips: new this week (amber) + airborne now (green; only when the live feed has data).
  // Note: counts are integers derived from our own data — safe for innerHTML.
  const newThisWeek = STARLINK_DB.filter(s => isRecentlyFound(s.dateFound)).length;
  const airborneCount = Object.keys(getStarlinkAirborneMap()).length;
  let chips = '';
  if (newThisWeek > 0) chips += '<span class="sl-chip sl-chip-new">+' + newThisWeek + ' NEW THIS WEEK</span>';
  // The live chip is a click-through to the LIVE OPS map with the Starlink filter pre-enabled.
  if (airborneCount > 0) chips += '<span class="sl-chip sl-chip-live sl-chip-clickable" data-action="view-starlink-on-map" role="button" tabindex="0" title="Show these on the live map" aria-label="Show ' + airborneCount + ' airborne Starlink aircraft on the live map">● ' + airborneCount + ' AIRBORNE NOW</span>';
  document.getElementById('sl-hero-chips').innerHTML = chips;

  // Source line: count + freshness
  document.getElementById('sl-count').textContent = STARLINK_DB.length;
  if (STARLINK_LAST_UPDATED) {
    const ago = Math.round((Date.now() - new Date(STARLINK_LAST_UPDATED).getTime()) / 60000);
    document.getElementById('sl-updated').textContent = ago < 60 ? ('Updated ' + ago + 'm ago') : ago < 1440 ? ('Updated ' + Math.round(ago/60) + 'h ago') : ('Updated ' + Math.round(ago/1440) + 'd ago');
  }

  renderSlIndustry();
}

// Industry strip: one thin coverage bar per carrier (UA vs competitors), sorted
// descending. Reuses the hero's .sl-bar-* classes. United is the amber "home
// team"; competitors are muted. Coverage = installed / tracked-fleet from upstream
// (NOT full mainline). Hidden entirely unless every row has a finite percentage,
// mirroring the degraded-tier guards elsewhere on this tab.
function renderSlIndustry() {
  const wrap = document.getElementById('sl-industry');
  if (!wrap) return;
  const barsEl = document.getElementById('sl-industry-bars');

  const rows = STARLINK_INDUSTRY;
  const finitePct = (r) => {
    if (!r || r.percentage == null || r.percentage === '') return false;
    const p = typeof r.percentage === 'string' ? parseFloat(r.percentage) : r.percentage;
    return typeof p === 'number' && Number.isFinite(p);
  };
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(finitePct)) {
    wrap.style.display = 'none';
    if (barsEl) barsEl.innerHTML = '';
    return;
  }

  const sorted = rows.slice().sort((a, b) => Number(b.percentage) - Number(a.percentage));
  barsEl.innerHTML = sorted.map((r) => {
    const code = escapeHtml(String(r.code || '').toUpperCase());
    const isUA = String(r.code || '').toUpperCase() === 'UA';
    const pctNum = Number(r.percentage);
    const pct = Math.round(pctNum);
    const width = Math.max(0, Math.min(100, pctNum));
    const installed = Number.isFinite(Number(r.installed)) ? Number(r.installed) : '—';
    const total = Number.isFinite(Number(r.total)) ? Number(r.total) : '—';
    const fillCls = isUA ? 'sl-bar-fill-ua' : 'sl-bar-fill-muted';
    const labelCls = isUA ? 'sl-bar-label sl-bar-label-ua' : 'sl-bar-label';
    return '<div class="sl-bar-row">' +
      '<span class="' + labelCls + '">' + code + '</span>' +
      '<div class="sl-bar-track"><div class="sl-bar-fill ' + fillCls + '" style="width:' + width + '%"></div></div>' +
      '<span class="sl-bar-val">' + installed + ' / ' + total + ' · ' + pct + '%</span>' +
      '</div>';
  }).join('');
  wrap.style.display = '';
}

// The aircraft table. Every row toggles an inline expansion (one at a time).
function renderSlTable() {
  const tbody = document.getElementById('sl-tbody');
  if (!tbody) return;

  if (STARLINK_DB.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="sl-empty">Starlink fleet data unavailable — try refreshing the page.</td></tr>';
    return;
  }

  const search = (document.getElementById('sl-search').value || '').trim().toUpperCase();
  const fleetFilter = document.getElementById('sl-filter-fleet').value;
  const typeFilter = document.getElementById('sl-filter-type').value;
  const opFilter = document.getElementById('sl-filter-operator').value;

  let filtered = STARLINK_DB.filter(s => {
    if (search && !s.tail.toUpperCase().includes(search)) return false;
    if (fleetFilter && s.fleet !== fleetFilter) return false;
    if (typeFilter && s.type !== typeFilter) return false;
    if (opFilter && s.operator !== opFilter) return false;
    if (slShowNewOnly && !isRecentlyFound(s.dateFound)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const va = (a[slSortKey] || '').toLowerCase();
    const vb = (b[slSortKey] || '').toLowerCase();
    return slSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  document.getElementById('sl-filtered-count').textContent = filtered.length < STARLINK_DB.length ? `${filtered.length} of ${STARLINK_DB.length}` : '';

  const hasFlights = Object.keys(STARLINK_FLIGHTS_BY_TAIL).length > 0;
  const liveMap = getStarlinkAirborneMap();
  const hasLive = allFlights.length > 0;
  const nowSec = Date.now() / 1000;
  // Disputed-but-still-served tails (normally empty). Marked with a red integrity dot below.
  const conflictTails = getServedConflictTails();

  // Hide the Status / Next Flight columns when the data behind them is unavailable (degraded modes)
  document.getElementById('sl-status-th').style.display = hasLive ? '' : 'none';
  document.getElementById('sl-next-th').style.display = hasFlights ? '' : 'none';

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="sl-empty">No aircraft match your filters.</td></tr>';
    return;
  }

  const rows = [];
  for (const s of filtered) {
    const live = liveMap[s.tail];
    const expanded = slExpandedTail === s.tail;

    let statusHtml = '';
    if (hasLive) {
      statusHtml = live
        ? '<td><span class="sl-live-badge">● Airborne</span></td>'
        : '<td><span class="sl-status-sched">Scheduled</span></td>';
    }

    let nextHtml = '';
    if (hasFlights) {
      const flights = STARLINK_FLIGHTS_BY_TAIL[s.tail];
      if (flights && flights.length > 0) {
        // Next UPCOMING departure (flights are chronological; 30-min grace for one that just left),
        // falling back to the latest known flight if all are in the past.
        const next = flights.find(f => (f.departure_ts || 0) >= nowSec - 1800) || flights[flights.length - 1];
        const t = formatFlightTime(next.departure_ts, next.origin);
        nextHtml = `<td style="font-size:9px">${escapeHtml(next.flight_number || '')} ${escapeHtml((next.origin || '') + '→' + (next.destination || ''))}${t ? ` <span class="starlink-next-time">${escapeHtml(t)}</span>` : ''}</td>`;
      } else {
        nextHtml = '<td style="font-size:9px;color:var(--ua-muted)">—</td>';
      }
    }

    const newBadge = isRecentlyFound(s.dateFound) ? ` <span class="starlink-new-badge" title="Starlink equipment first seen ${escapeHtml(s.dateFound)}">NEW</span>` : '';
    const conflictDot = conflictTails.has(s.tail) ? ` <span class="sl-verify-dot" title="Disputed by official verification — should not be served. See the Verification Ledger below.">!</span>` : '';
    rows.push(`<tr class="sl-row${expanded ? ' expanded' : ''}" data-action="sl-row-toggle" data-tail="${escapeHtml(s.tail)}" tabindex="0" role="button" aria-expanded="${expanded}">` +
      `<td><span class="sl-tail">${escapeHtml(s.tail)}</span>${newBadge}${conflictDot}</td>` +
      `<td>${escapeHtml(s.fleet)}</td><td>${escapeHtml(s.type)}</td><td style="font-size:10px">${escapeHtml(s.operator)}</td>` +
      statusHtml + nextHtml + '</tr>');

    if (expanded) rows.push(renderSlExpand(s, live, hasFlights, hasLive, nowSec));
  }
  tbody.innerHTML = rows.join('');
}

// The inline expansion row: meta cards + flight timeline + actions.
function renderSlExpand(s, live, hasFlights, hasLive, nowSec) {
  const colspan = 4 + (hasLive ? 1 : 0) + (hasFlights ? 1 : 0);

  let sinceHtml = 'Unknown';
  if (s.dateFound) {
    const days = Math.max(0, Math.round((Date.now() - Date.parse(s.dateFound)) / 86400000));
    sinceHtml = escapeHtml(s.dateFound) + ' · ' + (days === 0 ? 'today' : days + 'd ago');
  }

  // Flight timeline: up to 5 upcoming flights
  const flights = STARLINK_FLIGHTS_BY_TAIL[s.tail] || [];
  const upcoming = flights.filter(f => (f.departure_ts || 0) >= nowSec - 1800).slice(0, 5);
  let timelineHtml = '<div class="sl-timeline-label">Upcoming Flights</div>';
  if (upcoming.length > 0) {
    timelineHtml += upcoming.map(f => {
      const dep = formatFlightTime(f.departure_ts, f.origin);
      const arrMs = f.arrival_time ? Date.parse(f.arrival_time) : NaN;
      const arr = isNaN(arrMs) ? '' : formatFlightTime(arrMs / 1000, f.destination);
      return `<div class="sl-fl-row"><span class="sl-fl-num">${escapeHtml(f.flight_number || '')}</span>` +
        `<span class="sl-fl-route">${escapeHtml(f.origin || '')} <span class="sl-arrow">→</span> ${escapeHtml(f.destination || '')}</span>` +
        `<span class="sl-fl-time">${escapeHtml(dep)}${arr ? ' – ' + escapeHtml(arr) : ''}</span></div>`;
    }).join('');
  } else {
    timelineHtml += '<div class="sl-fl-empty">No upcoming flights in the feed</div>';
  }

  // Actions: track on map (airborne only) + aircraft details + planespotters
  let actions = '';
  if (live && live.icao24) {
    actions += `<button class="sl-btn sl-btn-primary" data-action="sl-track" data-icao24="${escapeHtml(live.icao24)}">📡 Track on Live Map</button>`;
  }
  actions += `<button class="sl-btn" data-action="aircraft-detail" data-reg="${escapeHtml(s.tail)}">Aircraft Details</button>`;
  actions += `<a class="sl-btn" href="https://www.planespotters.net/search?q=${encodeURIComponent(s.tail)}" target="_blank" rel="noopener noreferrer">Planespotters ↗</a>`;

  return `<tr class="sl-expand"><td colspan="${colspan}"><div class="sl-expand-inner">` +
    `<div class="sl-meta-grid">` +
      `<div class="sl-meta"><div class="sl-meta-k">Starlink Since</div><div class="sl-meta-v sl-meta-amber">${sinceHtml}</div></div>` +
      `<div class="sl-meta"><div class="sl-meta-k">Operator</div><div class="sl-meta-v">${escapeHtml(s.operator)}</div></div>` +
      `<div class="sl-meta"><div class="sl-meta-k">Airframe</div><div class="sl-meta-v">${escapeHtml(s.type)}</div></div>` +
      `<div class="sl-meta"><div class="sl-meta-k">Fleet</div><div class="sl-meta-v">${escapeHtml(s.fleet)}</div></div>` +
    `</div>` + timelineHtml + `<div class="sl-actions">${actions}</div>` +
  `</div></td></tr>`;
}

// Toggle a row's inline expansion (only one open at a time).
function toggleStarlinkExpand(tail) {
  slExpandedTail = (slExpandedTail === tail) ? null : tail;
  renderSlTable();
}

// ═══ FLEET DATA REFRESH ═══
function refreshFleetData() {
  // Fleet data is embedded at build time — a page reload pulls the latest deployment
  location.reload();
}

// ═══ WEATHER TAB ═══
let weatherInitialized = false;
let radarMap = null; // module-level so weather-retry can tear down the prior Leaflet map before re-init
let _weatherRefreshInterval = null;
// Module-level ref so weather-retry can disconnect the prior observer before
// creating a new one. AbortController does not work on observers — the only
// way to release the observed nodes is an explicit disconnect().
let _wxHintObserver = null;
const HUB_NAMES = {EWR:"Newark Liberty",IAH:"Houston Intercontinental",ORD:"O'Hare International",DEN:"Denver International",SFO:"San Francisco Int'l",LAX:"Los Angeles Int'l",IAD:"Washington Dulles",NRT:"Tokyo Narita",GUM:"Guam Int'l"};
const CAT_COLORS = {VFR:'#22c55e',MVFR:'#eab308',IFR:'#ef4444',LIFR:'#c026d3'};

// Compute flight category from raw METAR — strict AIM standard (ceiling + vis only)
function computeFlightCategory(rawMetar) {
  if (!rawMetar) return null;
  // Parse visibility (handle "1 1/2SM", "3SM", "1/2SM")
  let visSM = 99;
  const vmMixed = rawMetar.match(/\b(\d+)\s+(\d+)\/(\d+)SM\b/);
  if (vmMixed) visSM = parseInt(vmMixed[1]) + parseInt(vmMixed[2]) / parseInt(vmMixed[3]);
  else { const vm = rawMetar.match(/\b(\d+)\s*SM\b/); if (vm) visSM = parseInt(vm[1]); }
  const vf = rawMetar.match(/\b(\d+)\/(\d+)SM\b/);
  if (vf && !vmMixed) visSM = parseInt(vf[1]) / parseInt(vf[2]);
  // Parse ceiling (lowest BKN or OVC)
  let ceiling = 99999;
  const cm = [...rawMetar.matchAll(/(BKN|OVC)(\d{3})/g)];
  if (cm.length) ceiling = parseInt(cm[0][2]) * 100;
  // Standard AIM flight category rules
  if (visSM < 1 || ceiling < 500) return 'LIFR';
  if (visSM < 3 || ceiling < 1000) return 'IFR';
  if (visSM <= 5 || ceiling <= 3000) return 'MVFR';
  return 'VFR';
}

// Compute operational impact — considers wind, precip, phenomena beyond just ceiling/vis
// Returns: {level: 'normal'|'caution'|'warning'|'severe', reasons: string[], color: string}
const OPS_COLORS = {normal:'#22c55e',caution:'#eab308',warning:'#ef4444',severe:'#c026d3'};
function computeOpsImpact(rawMetar, fltCat) {
  const reasons = [];
  let level = 'normal';
  const bump = (to) => {
    const rank = {normal:0,caution:1,warning:2,severe:3};
    if (rank[to] > rank[level]) level = to;
  };

  if (!rawMetar) return {level, reasons, color: OPS_COLORS[level]};

  // Flight category impact
  if (fltCat === 'LIFR') { bump('severe'); reasons.push('very low ceilings/visibility'); }
  else if (fltCat === 'IFR') { bump('warning'); reasons.push('instrument conditions'); }
  else if (fltCat === 'MVFR') { bump('caution'); reasons.push('marginal ceilings/visibility'); }

  // Wind/gusts
  const wm = rawMetar.match(/\b\d{3}(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (wm) {
    const spd = parseInt(wm[1]), gust = wm[3] ? parseInt(wm[3]) : spd;
    if (gust >= 40) { bump('warning'); reasons.push(`gusts ${gust}kt`); }
    else if (gust >= 30) { bump('caution'); reasons.push(`gusts ${gust}kt`); }
  }

  // Weather phenomena — parse ALL groups, not just first
  const wxAll = [...rawMetar.matchAll(/\s([+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)(?=\s)/g)];
  const wxCombined = wxAll.map(m => m[1]).join(' ');
  if (wxCombined.includes('TS')) { bump('warning'); reasons.push('thunderstorms'); }
  if (wxCombined.includes('FZ')) { bump('warning'); reasons.push('freezing precipitation'); }
  if (wxCombined.includes('SN')) { bump('caution'); reasons.push('snow'); }
  if (wxCombined.match(/\+/) && (wxCombined.includes('RA') || wxCombined.includes('SN'))) { bump('warning'); reasons.push('heavy precipitation'); }
  else if (wxCombined.includes('RA') || wxCombined.includes('DZ') || wxCombined.includes('SH')) { bump('caution'); reasons.push('precipitation'); }
  if (wxCombined.includes('FG')) { bump('caution'); reasons.push('fog'); }

  // Low clouds + active precip (even if not technically ceiling)
  const allClouds = [...rawMetar.matchAll(/(FEW|SCT|BKN|OVC)(\d{3})/g)];
  const lowestAlt = allClouds.length ? parseInt(allClouds[0][2]) * 100 : 99999;
  if (lowestAlt <= 1500 && wxAll.length > 0 && level === 'normal') {
    bump('caution'); reasons.push('low clouds with active weather');
  }

  // Extract gust speed for delay risk engine
  const gustMatch = rawMetar.match(/\b\d{3}\d{2,3}G(\d{2,3})KT\b/);
  const gustKt = gustMatch ? parseInt(gustMatch[1]) : 0;

  // Extract temperature for de-icing awareness
  const tempMatch = rawMetar.match(/\b(M?\d{2})\/M?\d{2}\b/);
  const tempC = tempMatch ? parseInt(tempMatch[1].replace('M', '-')) : null;

  // Deduplicate reasons
  const unique = [...new Set(reasons)];
  return {level, reasons: unique, color: OPS_COLORS[level], gustKt, tempC,
    hasThunderstorms: unique.includes('thunderstorms'),
    hasFreezingPrecip: unique.includes('freezing precipitation'),
    hasSnow: unique.includes('snow'),
    hasFog: unique.includes('fog'),
  };
}

function formatStructuredVisibility(visib) {
  if (visib === null || visib === undefined || visib === '') return '--';
  const value = String(visib).trim();
  if (!value) return '--';
  if (/SM$/i.test(value) || /m$/i.test(value)) return value;
  if (/^\d+(\.\d+)?$/.test(value) && Number(value) > 50) return `${Math.round(Number(value))}m`;
  return `${value} SM`;
}

function applyStructuredMetarFallback(parsed, metar) {
  if (!metar || typeof metar !== 'object') return parsed;

  if (parsed.temp === '--' && Number.isFinite(metar.temp)) {
    parsed.temp = `${Math.round(metar.temp)}°C / ${Math.round((metar.temp * 9) / 5 + 32)}°F`;
  }

  if (parsed.wind === '--' && Number.isFinite(metar.wspd)) {
    if (metar.wspd === 0) parsed.wind = 'Calm';
    else if (Number.isFinite(metar.wdir)) parsed.wind = `${String(Math.round(metar.wdir)).padStart(3, '0')}° @ ${Math.round(metar.wspd)}kt`;
    else parsed.wind = `${Math.round(metar.wspd)}kt`;
  }

  if (parsed.vis === '--') {
    parsed.vis = formatStructuredVisibility(metar.visib);
  }

  if (parsed.clouds === '--') {
    const cloudLayer = Array.isArray(metar.clouds) && metar.clouds.length ? metar.clouds[0] : null;
    const cloudCover = cloudLayer?.cover || metar.cover || '';
    const cloudBase = Number.isFinite(cloudLayer?.base) ? cloudLayer.base : null;
    const cloudNames = {FEW:'Few',SCT:'Scattered',BKN:'Broken',OVC:'Overcast'};
    if (cloudCover && cloudBase !== null) parsed.clouds = `${cloudNames[cloudCover] || cloudCover} ${cloudBase}ft`;
    else if (cloudCover === 'CLR' || cloudCover === 'SKC') parsed.clouds = 'Clear';
  }

  return parsed;
}

function parseMetarQuick(metar) {
  const raw = typeof metar === 'string' ? metar : (metar?.rawOb || '');
  const r = {temp:'--',wind:'--',vis:'--',clouds:'--'};
  if (!raw) return typeof metar === 'object' ? applyStructuredMetarFallback(r, metar) : r;
  const wm = raw.match(/\b(\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (wm) { r.wind = `${wm[1]}° @ ${wm[2]}kt${wm[4]?' G'+wm[4]:''}`;} else if(raw.includes('00000KT')){r.wind='Calm';}
  const vm = raw.match(/\b(\d+)\s*SM\b/) || raw.match(/\b(\d+\/\d+)SM\b/);
  if (vm) r.vis = vm[0].replace('SM','').trim()+' SM';
  const tm = raw.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  if (tm) { const c=parseInt(tm[1].replace('M','-')); r.temp=`${c}°C / ${Math.round(c*9/5+32)}°F`;}
  const cm = [...raw.matchAll(/(FEW|SCT|BKN|OVC)(\d{3})/g)];
  const cn = {FEW:'Few',SCT:'Scattered',BKN:'Broken',OVC:'Overcast'};
  if (cm.length) { const l=cm[0]; r.clouds=`${cn[l[1]]||l[1]} ${parseInt(l[2])*100}ft`;} else if(raw.includes('CLR')||raw.includes('SKC')){r.clouds='Clear';}
  return typeof metar === 'object' ? applyStructuredMetarFallback(r, metar) : r;
}

function hasRenderableMetarData(metar) {
  if (!metar || typeof metar !== 'object') return false;
  return Boolean(
    metar.rawOb ||
    Number.isFinite(metar.temp) ||
    Number.isFinite(metar.wspd) ||
    (typeof metar.visib === 'string' && metar.visib.trim()) ||
    (Array.isArray(metar.clouds) && metar.clouds.length) ||
    metar.cover
  );
}

async function fetchMetarBatch(allStations) {
  const stationChunks = chunkMetarStationIds(allStations);
  if (!stationChunks.length) return [];

  const payloads = await Promise.all(stationChunks.map(async (stationIds) => {
    const response = await fetch(`/api/metar?ids=${stationIds}`);
    if (!response.ok) throw new Error(`metar-${response.status}`);
    return normalizeMetarPayload(await response.json());
  }));

  return payloads.flat();
}

const UA_HUBS = new Set(['ORD','DEN','IAH','EWR','SFO','IAD','LAX','NRT','GUM']);

function renderNasPanel() {
  let panelEl = document.getElementById('nas-status-panel');
  if (!nasData || ((!nasData.active || !nasData.active.length) && (!nasData.planned || !nasData.planned.length))) {
    if (panelEl) panelEl.style.display = 'none';
    return;
  }

  // Create panel if it doesn't exist — insert into the detail panel (right side)
  // between the IROPS section and the hub-cards scroll hint
  if (!panelEl) {
    panelEl = document.createElement('div');
    panelEl.id = 'nas-status-panel';
    const scrollHint = document.getElementById('wx-scroll-hint');
    if (scrollHint && scrollHint.parentNode) {
      scrollHint.parentNode.insertBefore(panelEl, scrollHint);
    } else {
      const hubCards = document.getElementById('hub-cards');
      if (hubCards) hubCards.parentNode.insertBefore(panelEl, hubCards);
    }
  }

  panelEl.style.display = 'block';

  // --- Severity detection & classification helpers ---
  // All user-facing text is sanitized via escapeHtml before DOM insertion.

  const SEV_LABELS = {
    GS: 'Ground Stop', GDP: 'Ground Delay Program', AFP: 'Airspace Flow Program',
    MIT: 'Miles-in-Trail', MINIT: 'Minutes-in-Trail', CDR: 'Coded Departure Routes',
    SWAP: 'Severe Weather Avoidance', EDCT: 'Expect Departure Clearance Time',
    FCA: 'Flow Constrained Area', DSP: 'Departure Spacing Program',
  };

  function detectSevType(text) {
    const t = text.toUpperCase();
    if (t.includes('GROUND STOP') || /\bGS\b/.test(t) || /\bGDS\b/.test(t)) return 'GS';
    if (t.includes('GROUND DELAY') || /\bGDP\b/.test(t)) return 'GDP';
    if (t.includes('AIRSPACE FLOW') || /\bAFP\b/.test(t)) return 'AFP';
    if (t.includes('MILES-IN-TRAIL') || t.includes('MINUTES-IN-TRAIL') || /\bMINIT\b/.test(t) || /\bMIT\b/.test(t)) return 'MIT';
    if (t.includes('CODED DEPARTURE') || /\bCDRS?\b/.test(t)) return 'CDR';
    if (t.includes('SEVERE WEATHER') || /\bSWAP\b/.test(t)) return 'SWAP';
    if (/\bEDCT\b/.test(t)) return 'EDCT';
    if (/\bFCA\b/.test(t)) return 'FCA';
    if (/\bDSP\b/.test(t)) return 'DSP';
    return 'OTHER';
  }

  // Map severity types to CSS badge classes (known safe string values)
  function sevBadgeClass(sevType) {
    const map = { GS:'gs', GDP:'gdp', AFP:'afp', MIT:'mit', SWAP:'mit', MINIT:'mit', CDR:'cdr', EDCT:'cdr', FCA:'cdr', DSP:'cdr' };
    return 'sev-' + (map[sevType] || 'other');
  }

  // --- Build unified, classified items list ---

  const items = [];
  const allHubs = new Set();

  // Active en-route programs
  for (const prog of (nasData.active || [])) {
    const sevType = detectSevType(prog.name);
    const nameParts = prog.name.split('-');
    const typeCode = nameParts[0] || '';
    const facility = nameParts.length > 1 && /^[A-Z]{3}$/.test(nameParts[1]) ? nameParts[1] : '';
    const typeName = SEV_LABELS[sevType] || typeCode;
    const hubs = [...new Set((prog.affectedFacilities || []).filter(a => UA_HUBS.has(a)))];
    hubs.forEach(h => allHubs.add(h));

    const detailParts = [];
    if (prog.reason) detailParts.push(escapeHtml(prog.reason));
    if (prog.avgDelay) detailParts.push('avg <span class="nas-delay-val">' + escapeHtml(String(prog.avgDelay)) + 'm</span>');
    if (prog.endTime) {
      const endZ = prog.endTime.includes('T') ? prog.endTime.split('T')[1].slice(0, 5) + 'Z' : prog.endTime;
      detailParts.push('ends ' + escapeHtml(endZ));
    }

    items.push({
      tier: sevType === 'GS' ? 'critical' : 'active',
      sevType,
      title: facility ? escapeHtml(facility) + ' ' + escapeHtml(typeName) : escapeHtml(prog.name),
      detail: detailParts.join(' \u00b7 '),
      hubs,
    });
  }

  // Planned TMIs
  for (const tmi of (nasData.planned || [])) {
    const sevType = detectSevType(tmi.event);
    const hubs = (tmi.affectedAirports || []).filter(a => UA_HUBS.has(a));
    hubs.forEach(h => allHubs.add(h));

    let tier;
    if (sevType === 'GS') tier = 'critical';
    else if (sevType === 'GDP' || sevType === 'AFP') tier = 'active';
    else tier = 'monitoring';

    items.push({
      tier,
      sevType,
      title: escapeHtml(tmi.decoded || tmi.event),
      detail: tmi.time ? escapeHtml(tmi.time) : '',
      hubs,
    });
  }

  // Group by tier
  const tiers = {
    critical: items.filter(i => i.tier === 'critical'),
    active: items.filter(i => i.tier === 'active'),
    monitoring: items.filter(i => i.tier === 'monitoring'),
  };

  // --- Render Priority Stack ---
  // All values inserted below are pre-escaped via escapeHtml or derived from
  // known safe constants (CSS class names, tier labels, unicode literals).

  const activeCount = (nasData.active || []).length;
  const plannedCount = (nasData.planned || []).length;
  const hubCount = allHubs.size;
  const countParts = [];
  if (activeCount) countParts.push(activeCount + ' active');
  if (plannedCount) countParts.push(plannedCount + ' planned');
  if (hubCount) countParts.push(hubCount + ' hub' + (hubCount !== 1 ? 's' : ''));

  let html = '<div class="nas-header">';
  html += '<div class="nas-label">NAS STATUS</div>';
  html += '<div class="nas-count">' + escapeHtml(countParts.join(' \u00b7 ')) + '</div>';
  html += '</div>';

  function renderTier(tierClass, label, tierItems) {
    if (!tierItems.length) return '';
    let h = '<div class="nas-tier ' + tierClass + '">';
    h += '<div class="nas-tier-header"><span class="nas-tier-label">' + escapeHtml(label) + '</span><div class="nas-tier-line"></div></div>';
    for (const item of tierItems) {
      const badgeCls = sevBadgeClass(item.sevType);
      const hubTags = item.hubs.map(hub => ' <span class="nas-hub-tag">' + escapeHtml(hub) + '</span>').join('');
      h += '<div class="nas-tier-item">';
      h += '<div class="nas-item-badge"><span class="nas-sev-badge ' + badgeCls + '">' + escapeHtml(item.sevType) + '</span></div>';
      h += '<div class="nas-item-content">';
      h += '<div class="nas-item-title">' + item.title + hubTags + '</div>';
      if (item.detail) h += '<div class="nas-item-detail">' + item.detail + '</div>';
      h += '</div></div>';
    }
    h += '</div>';
    return h;
  }

  html += renderTier('tier-critical', 'CRITICAL', tiers.critical);
  html += renderTier('tier-active', 'ACTIVE / LIKELY', tiers.active);
  html += renderTier('tier-monitoring', 'MONITORING', tiers.monitoring);

  if (nasData.advisoryUrl) {
    html += '<div class="nas-advisory"><a href="' + escapeHtml(nasData.advisoryUrl) + '" target="_blank" rel="noopener noreferrer">View full ATCSCC advisory \u2192</a></div>';
  }

  panelEl.innerHTML = html;
}

function trendIndicator(trend) {
  if (!trend) return '';
  const t = String(trend).toLowerCase();
  if (t === 'increasing') return '<span style="color:var(--ua-red)">↑ Increasing</span>';
  if (t === 'decreasing') return '<span style="color:var(--ua-green)">↓ Decreasing</span>';
  return '<span style="color:var(--ua-muted)">→ Stable</span>';
}

async function initWeatherTab() {
  if (weatherInitialized) return;
  weatherInitialized = true;
  // Ensure IROPS data is loading (may not have fired from idle preload yet)
  fetchIropsFromAPI();

  const hubStations = {EWR:'KEWR',IAH:'KIAH',ORD:'KORD',DEN:'KDEN',SFO:'KSFO',LAX:'KLAX',IAD:'KIAD',NRT:'RJAA',GUM:'PGUM'};
  const hubs = Object.keys(hubStations);

  // Show loading skeletons for hub cards immediately
  const hubCardsEl = document.getElementById('hub-cards');
  hubCardsEl.innerHTML = hubs.map(h => `<div class="hub-card" style="border-top:3px solid #334155;opacity:0.5"><div class="hub-card-top"><span class="hub-card-code">${escapeHtml(h)}</span><span class="cat-badge" style="background:#334155;color:var(--ua-muted)">…</span></div><div class="hub-card-name">${escapeHtml(HUB_NAMES[h]||h)}</div><div style="padding:20px;text-align:center;color:var(--ua-muted);font-size:10px">Loading…</div></div>`).join('');

  // Initialize radar map IMMEDIATELY — don't wait for data fetches
  const basemapTileOptions = getBasemapTileOptions();
  // Tear down any prior Leaflet instance before re-creating — initWeatherTab can run again via the
  // weather-retry action (which resets weatherInitialized), and L.map() on an already-initialized
  // container throws "Map container is already initialized." (Audit P1: weather-retry-double-map-init.)
  if (radarMap) { try { radarMap.remove(); } catch (e) { /* already removed */ } radarMap = null; }
  radarMap = L.map('radar-map', {center:[39,-97],zoom:4,zoomControl:false});
  radarMap.attributionControl.setPrefix(''); // OSM/CARTO credit from tile options (ODbL)
  L.control.zoom({ position: 'bottomleft' }).addTo(radarMap);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', basemapTileOptions).addTo(radarMap);
  L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',{opacity:0.6}).addTo(radarMap);
  setTimeout(() => radarMap.invalidateSize(), 200);
  document.getElementById('radar-title').textContent = `🌧 NEXRAD Radar — ${new Date().toUTCString().slice(17,25)}Z`;

  // Place hub markers immediately with neutral color (updated after METAR loads)
  const radarHubMarkers = {};
  hubs.forEach(hub => {
    const h = HUBS.find(x=>x.iata===hub);
    if (h) {
      radarHubMarkers[hub] = L.circleMarker([h.lat,h.lon],{radius:8,color:'#334155',fillColor:'#334155',fillOpacity:0.8,weight:2})
        .bindTooltip(`<b>${hub}</b>`,{permanent:true,direction:'top',className:'hub-tooltip',offset:[0,-8]})
        .addTo(radarMap);
      radarHubMarkers[hub].on('click', () => {
        const card = document.querySelector(`.hub-card[data-hub="${hub}"]`);
        if (card) {
          card.scrollIntoView({behavior:'smooth',block:'start'});
          card.style.borderColor = 'var(--ua-accent)';
          setTimeout(() => card.style.borderColor = '', 1500);
        }
      });
    }
  });

  // Fetch ALL METARs + FAA + NAS in parallel (3 requests)
  const allStations = Object.values(hubStations).join(',');
  const [metarResult, faaResult, nasResult] = await Promise.allSettled([
    fetchMetarBatch(allStations),
    fetch('/api/faa').then(r => r.ok ? r.json() : Promise.reject(new Error(`faa-${r.status}`))),
    fetch('/api/nas').then(r => r.ok ? r.json() : Promise.reject(new Error(`nas-${r.status}`)))
  ]);
  const metarData = metarResult.status === 'fulfilled' ? metarResult.value : [];
  const faaData = faaResult.status === 'fulfilled' ? faaResult.value : [];
  nasData = nasResult.status === 'fulfilled' ? nasResult.value : null;

  // Index METAR results by station ID → hub
  const stationToHub = {};
  for (const [hub, station] of Object.entries(hubStations)) stationToHub[station] = hub;
  const metarByHub = {};
  if (Array.isArray(metarData)) metarData.forEach(m => {
    const hub = stationToHub[m.icaoId || m.stationId] || stationToHub[m.id];
    if (hub) metarByHub[hub] = m;
  });
  const metarResults = hubs.map(hub => ({hub, data: metarByHub[hub] || null}));
  const loadedMetars = metarResults.filter(({ data }) => hasRenderableMetarData(data)).length;

  // Index FAA data by airport code
  const faaIndex = buildFaaIndex(faaData);
  faaDelayIndex = faaIndex;
  renderHubHealthBar(); // F046/F076: chips blend FAA programs — refresh once programs land

  // Build cards + map markers
  let cardsHtml = '';
  metarResults.forEach(({hub, data}) => {
    const raw = data ? (data.rawOb || '') : '';
    const apiCat = data ? (data.fltCat || data.fltcat || 'UNK') : 'UNK';
    const localCat = computeFlightCategory(raw);
    // Use the worse (more restrictive) of API vs local computation
    const catRank = {LIFR:0,IFR:1,MVFR:2,VFR:3,UNK:3};
    const cat = localCat && (catRank[localCat] ?? 3) < (catRank[apiCat] ?? 3) ? localCat : apiCat;
    const catColor = CAT_COLORS[cat] || '#64748b';
    const m = parseMetarQuick(data || raw);
    const faa = faaIndex[hub];
    const hasDelay = faa && faa.delays && faa.delays.length > 0;

    // Compute ops impact (weather + wind + phenomena)
    const ops = computeOpsImpact(raw, cat);
    // Store globally for delay risk engine
    weatherOpsByHub[hub] = { level: ops.level, reasons: ops.reasons, fltCat: cat,
      hasThunderstorms: ops.hasThunderstorms, hasFreezingPrecip: ops.hasFreezingPrecip,
      hasSnow: ops.hasSnow, hasFog: ops.hasFog, gustKt: ops.gustKt || 0, tempC: ops.tempC };
    // Card border uses worst of: flight category color or ops impact color
    const borderColor = ops.level !== 'normal' ? ops.color : catColor;

    // Status line: FAA delays take priority, then ops impact, then normal
    let faaLine;
    if (hasDelay) {
      // Build enhanced FAA status with programs data. F074: every program type is now
      // formatted via the shared describeFaaProgram() helper (previously only ground_stop
      // and ground_delay were special-cased, so a concurrent departure_delay fell through
      // to its bare reason string and its delay window was lost). Upstream fields are
      // escapeHtml()'d here (F030 hygiene while we're in this line).
      const statusParts = [];
      if (faa.programs && faa.programs.length) {
        for (const prog of faa.programs) {
          const { label, window, extras } = describeFaaProgram(prog);
          // Unknown program type with no mapped label → fall back to its raw reason/type.
          let text = (label === 'Delay' && !prog.type)
            ? String(prog.reason || prog.type || 'Delay')
            : `${label}${window}`;
          if (extras.length) text += ` ${extras.join(' · ')}`;
          statusParts.push(escapeHtml(text));
        }
      } else {
        statusParts.push(...faa.delays.map(d => escapeHtml(d.reason || d.type || 'Delay')));
      }
      faaLine = `<div class="hub-faa delay">⚠ ${statusParts.join(', ')}</div>`;
    } else if (ops.level === 'severe') {
      faaLine = `<div class="hub-faa delay">⚠ Severe Weather Impact — ${ops.reasons.join(', ')}</div>`;
    } else if (ops.level === 'warning') {
      faaLine = `<div class="hub-faa delay">⚠ Weather Advisory — ${ops.reasons.join(', ')}</div>`;
    } else if (ops.level === 'caution') {
      faaLine = `<div class="hub-faa" style="color:var(--ua-yellow)">⚠ Weather Caution — ${ops.reasons.join(', ')}</div>`;
    } else {
      faaLine = `<div class="hub-faa normal">✓ Normal Operations</div>`;
    }

    // Runway config summary line (scan tier)
    let rwyLine = '';
    if (faa && faa.runwayConfig && faa.runwayConfig.arrivalRate > 0) {
      const rc = faa.runwayConfig;
      rwyLine = `<div class="hub-rwy" style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ua-muted);margin-top:4px">RWY: ${escapeHtml(rc.arrivalRunways)}/${escapeHtml(rc.departureRunways)} · ${rc.arrivalRate}/hr</div>`;
    }

    // De-icing badge (scan tier, next to flight category)
    const deiceBadge = faa && faa.deicing
      ? `<span style="background:var(--ua-amber-soft);color:var(--ua-amber);font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:2px 6px;border-radius:3px;margin-left:4px">DE-ICE</span>`
      : '';

    // Detail tier content (expandable)
    const explainer = raw ? explainMETAR(raw, hub, cat) : '';
    const faaExplainer = faa ? explainFAAStatus(hub, faa.delays||[], faa) : '';
    const unavailable = !hasRenderableMetarData(data);
    const availabilityLine = unavailable
      ? '<div class="hub-explainer">Current METAR observation unavailable. Retry in a moment.</div>'
      : '';

    // Advisory links from programs
    let advisoryLinks = '';
    if (faa && faa.programs) {
      const urls = faa.programs.filter(p => p.advisoryUrl).map(p =>
        `<a href="${escapeHtml(p.advisoryUrl)}" target="_blank" rel="noopener noreferrer" style="font-size:9px;color:var(--ua-amber);text-decoration:underline">Advisory</a>`
      );
      if (urls.length) advisoryLinks = `<div style="margin-top:4px">${urls.join(' · ')}</div>`;
    }

    // NOTAM text
    let notamHtml = '';
    if (faa && faa.notam) {
      notamHtml = `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ua-muted);margin-top:6px;padding-top:6px;border-top:1px solid var(--ua-border-subtle)">${escapeHtml(faa.notam)}</div>`;
    }

    const hasDetailContent = explainer || faaExplainer || raw || advisoryLinks || notamHtml;

    cardsHtml += `<div class="hub-card" data-hub="${hub}" style="border-top:3px solid ${borderColor}">
      <div class="hub-card-top"><span class="hub-card-code">${hub}</span>${deiceBadge}<span class="cat-badge" style="background:${catColor};color:#000">${cat}</span></div>
      <div class="hub-card-name">${HUB_NAMES[hub]||hub}</div>
      <div class="hub-metrics">
        <div class="hub-metric"><div class="hub-metric-label">Temperature</div><div class="hub-metric-val">${m.temp}</div></div>
        <div class="hub-metric"><div class="hub-metric-label">Wind</div><div class="hub-metric-val">${m.wind}</div></div>
        <div class="hub-metric"><div class="hub-metric-label">Visibility</div><div class="hub-metric-val">${m.vis}</div></div>
        <div class="hub-metric"><div class="hub-metric-label">Ceiling</div><div class="hub-metric-val">${m.clouds}</div></div>
      </div>
      ${rwyLine}
      ${faaLine}
      ${availabilityLine}
      ${hasDetailContent ? `<div class="hub-card-expand" data-action="hub-card-toggle" tabindex="0" role="button" aria-expanded="false" style="text-align:center;padding:4px 0;cursor:pointer;color:var(--ua-dim);font-size:10px;font-family:'JetBrains Mono',monospace;transition:color 150ms ease">▾ Details</div>
      <div class="hub-card-detail" style="display:none">
        ${explainer?`<div class="hub-explainer">${explainer}</div>`:''}
        ${faaExplainer?`<div class="hub-explainer">${faaExplainer}</div>`:''}
        ${advisoryLinks}
        ${notamHtml}
        ${raw?`<div class="hub-raw">${escapeHtml(raw)}</div>`:''}
      </div>` : ''}
    </div>`;

    // Update radar map marker — use ops impact color for operational awareness
    if (radarHubMarkers[hub]) {
      radarHubMarkers[hub].setStyle({color:borderColor,fillColor:borderColor});
      radarHubMarkers[hub].unbindTooltip();
      const opsTag = ops.level !== 'normal' ? ` (${ops.reasons[0] || ops.level})` : '';
      radarHubMarkers[hub].bindTooltip(`<b>${hub}</b> ${cat}${opsTag}`,{permanent:true,direction:'top',className:'hub-tooltip',offset:[0,-8]});
    }
  });

  if (!cardsHtml || loadedMetars === 0) {
    cardsHtml = '<div class="error-state" style="grid-column:1/-1"><div class="error-icon">🌦</div><div style="color:var(--ua-text)">Weather data unavailable</div><div style="color:var(--ua-muted);font-size:11px">Could not load METAR observations</div><button class="retry-btn" data-action="weather-retry">↻ Retry</button></div>';
  }
  document.getElementById('hub-cards').innerHTML = cardsHtml;

  // Render NAS STATUS panel below radar map
  renderNasPanel();

  // Auto-hide scroll hint once hub cards are visible. Disconnect the prior
  // observer before creating a new one — initWeatherTab can be called again
  // via the weather-retry data-action and each call would otherwise leak an
  // observer still holding references to detached hint/hub-cards nodes.
  if (_wxHintObserver) { _wxHintObserver.disconnect(); _wxHintObserver = null; }
  const wxHint = document.getElementById('wx-scroll-hint');
  const hubCards = document.getElementById('hub-cards');
  if (wxHint && hubCards) {
    _wxHintObserver = new IntersectionObserver(([entry]) => {
      wxHint.style.opacity = entry.isIntersecting ? '0' : '1';
    }, {root: document.getElementById('wx-detail-panel'), threshold: 0.1});
    _wxHintObserver.observe(hubCards);
  }

  // Refresh weather + FAA + NAS data every 5 minutes so the tab stays current
  if (_weatherRefreshInterval) clearInterval(_weatherRefreshInterval);
  _weatherRefreshInterval = setInterval(async () => {
    try {
      const [newMetar, newFaa, newNas] = await Promise.allSettled([
        fetchMetarBatch(allStations),
        fetch('/api/faa').then(r => r.ok ? r.json() : Promise.reject(new Error(`faa-${r.status}`))),
        fetch('/api/nas').then(r => r.ok ? r.json() : Promise.reject(new Error(`nas-${r.status}`)))
      ]);
      const freshMetar = newMetar.status === 'fulfilled' ? newMetar.value : [];
      const freshFaa = newFaa.status === 'fulfilled' ? newFaa.value : [];
      if (newNas.status === 'fulfilled') { nasData = newNas.value; renderNasPanel(); }
      if (!Array.isArray(freshMetar) || freshMetar.length === 0) return;

      // Rebuild METAR index
      const freshMetarByHub = {};
      freshMetar.forEach(m => {
        const h = stationToHub[m.icaoId || m.stationId] || stationToHub[m.id];
        if (h) freshMetarByHub[h] = m;
      });

      // Rebuild FAA index
      faaDelayIndex = buildFaaIndex(freshFaa);
      renderHubHealthBar(); // F046/F076: keep chips' FAA-program blend fresh

      // Update weatherOpsByHub + hub card colors/statuses
      hubs.forEach(hub => {
        const data = freshMetarByHub[hub];
        if (!data) return;
        const raw = data.rawOb || '';
        const apiCat = data.fltCat || data.fltcat || 'UNK';
        const localCat = computeFlightCategory(raw);
        const catRank = {LIFR:0,IFR:1,MVFR:2,VFR:3,UNK:3};
        const cat = localCat && (catRank[localCat] ?? 3) < (catRank[apiCat] ?? 3) ? localCat : apiCat;
        const ops = computeOpsImpact(raw, cat);
        weatherOpsByHub[hub] = { level: ops.level, reasons: ops.reasons, fltCat: cat,
          hasThunderstorms: ops.hasThunderstorms, hasFreezingPrecip: ops.hasFreezingPrecip,
          hasSnow: ops.hasSnow, hasFog: ops.hasFog, gustKt: ops.gustKt || 0, tempC: ops.tempC };
        // Update radar hub marker color
        if (radarHubMarkers[hub]) {
          const catColor = CAT_COLORS[cat] || '#64748b';
          const borderColor = ops.level !== 'normal' ? ops.color : catColor;
          radarHubMarkers[hub].setStyle({color: borderColor, fillColor: borderColor});
        }
      });
      // Update radar timestamp
      const radarTitle = document.getElementById('radar-title');
      if (radarTitle) radarTitle.textContent = `🌧 NEXRAD Radar — ${new Date().toUTCString().slice(17,25)}Z`;
    } catch (e) {
      console.warn('Weather refresh failed:', e);
    }
  }, 5 * 60 * 1000);
}

// ═══ ANALYTICS TAB ═══
function updateAnalytics() {
  const airborneFlights = allFlights.filter(f => !f.onGround);
  const airborne = airborneFlights.length;
  const currentYear = new Date().getFullYear();
  const ages = FLEET_DB.filter(a => parseInt(a.d)).map(a => currentYear - parseInt(a.d));
  const avgAge = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : '--';

  // Count Starlink airborne
  let starlinkAirborne = 0;
  airborneFlights.forEach(f => {
    const ac = matchAircraft(f);
    if ((ac && STARLINK_TAILS.has(ac.r)) || (f.reg && STARLINK_TAILS.has(f.reg))) starlinkAirborne++;
  });
  const starlinkPct = airborne > 0 ? Math.round((starlinkAirborne / airborne) * 100) : 0;
  const utilPct = FLEET_DB.length ? Math.round((airborne / FLEET_DB.length) * 100) : 0;

  document.getElementById('analytics-metrics').innerHTML = [
    { val: airborne, label: 'Flights Airborne' },
    { val: utilPct + '%', label: 'Fleet Utilization' },
    { val: avgAge + 'y', label: 'Avg Fleet Age' },
    { val: starlinkPct + '%', label: 'Starlink Coverage', sub: `${starlinkAirborne} of ${airborne} airborne` }
  ].map(m => `<div class="metric-card"><div class="metric-val">${m.val}</div><div class="metric-label">${m.label}</div>${m.sub ? `<div style="font-size:8px;color:var(--ua-muted);margin-top:2px">${m.sub}</div>` : ''}</div>`).join('');

  // ═══ LIVE FLEET UTILIZATION ═══
  const typeOrder = ["A319","A320","A321neo","737-700","737-800","737-900","737-900ER","737 MAX 8","737 MAX 9","757-200","757-300","767-300ER","767-400ER","777-200","777-200ER","777-300ER","787-8","787-9","787-10"];
  const typeTotals = {};
  const typeAirborne = {};
  FLEET_DB.forEach(a => { typeTotals[a.t] = (typeTotals[a.t] || 0) + 1; });
  typeOrder.forEach(t => { typeAirborne[t] = 0; });

  airborneFlights.forEach(f => {
    const ac = matchAircraft(f);
    if (ac && typeAirborne[ac.t] !== undefined) typeAirborne[ac.t]++;
  });

  document.getElementById('util-chart').innerHTML = typeOrder.map(t => {
    const total = typeTotals[t] || 0;
    const flying = typeAirborne[t] || 0;
    const pct = total > 0 ? Math.round((flying / total) * 100) : 0;
    const color = pct > 60 ? '#22c55e' : pct > 30 ? '#005DAA' : pct > 0 ? '#f59e0b' : '#334155';
    return `<div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px solid rgba(30,41,59,.3)">
      <span style="font-size:10px;min-width:85px;color:var(--ua-text)">${t}</span>
      <div style="flex:1;margin:0 8px;height:10px;background:var(--ua-border);border-radius:4px;overflow:hidden;position:relative">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width .5s"></div>
      </div>
      <span style="font-size:10px;font-weight:700;min-width:70px;text-align:right"><span style="color:${color}">${flying}</span><span style="color:var(--ua-muted)">/${total}</span> <span style="color:${color};font-size:9px">${pct}%</span></span>
    </div>`;
  }).join('');

  // ═══ AIRBORNE BY FLIGHT PHASE ═══
  const phaseCounts = { 'Takeoff': 0, 'Climb': 0, 'Cruise': 0, 'En Route': 0, 'Descent': 0, 'Approach': 0, 'Ground': 0 };
  const phaseColors = { 'Takeoff': '#22c55e', 'Climb': '#3b82f6', 'Cruise': '#005DAA', 'En Route': '#6366f1', 'Descent': '#f59e0b', 'Approach': '#ef4444', 'Ground': '#64748b' };
  const phaseIcons = { 'Takeoff': '🛫', 'Climb': '↗️', 'Cruise': '✈️', 'En Route': '✈️', 'Descent': '↘️', 'Approach': '🛬', 'Ground': '🅿️' };

  allFlights.forEach(f => {
    const p = getPhase(f.alt, f.vr, f.spd);
    if (phaseCounts[p.phase] !== undefined) phaseCounts[p.phase]++;
  });

  const phaseTotal = Object.values(phaseCounts).reduce((a, b) => a + b, 0) || 1;
  const phaseOrder = ['Cruise', 'Climb', 'Descent', 'En Route', 'Takeoff', 'Approach', 'Ground'];

  // Donut segments
  let donutSegments = '';
  let offset = 0;
  const donutData = phaseOrder.filter(p => phaseCounts[p] > 0);
  donutData.forEach(p => {
    const pct = (phaseCounts[p] / phaseTotal) * 100;
    donutSegments += `<circle cx="50" cy="50" r="36" fill="none" stroke="${phaseColors[p]}" stroke-width="12" stroke-dasharray="${pct * 2.26} ${226 - pct * 2.26}" stroke-dashoffset="${-offset * 2.26}" />`;
    offset += pct;
  });

  let phaseHtml = `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">`;
  phaseHtml += `<svg viewBox="0 0 100 100" style="width:120px;height:120px;flex-shrink:0">${donutSegments}<text x="50" y="48" text-anchor="middle" fill="var(--ua-text)" font-size="14" font-weight="700">${phaseTotal}</text><text x="50" y="60" text-anchor="middle" fill="var(--ua-muted)" font-size="6">flights</text></svg>`;
  phaseHtml += `<div style="flex:1;min-width:180px">`;
  phaseOrder.forEach(p => {
    const count = phaseCounts[p];
    if (count === 0) return;
    const pct = Math.round((count / phaseTotal) * 100);
    phaseHtml += `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
      <span style="font-size:12px">${phaseIcons[p]}</span>
      <span style="font-size:10px;min-width:65px;color:var(--ua-text)">${p}</span>
      <div style="flex:1;height:8px;background:var(--ua-border);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${phaseColors[p]};border-radius:4px;transition:width .5s"></div>
      </div>
      <span style="font-size:10px;font-weight:700;color:${phaseColors[p]};min-width:45px;text-align:right">${count} <span style="font-size:8px;color:var(--ua-muted)">${pct}%</span></span>
    </div>`;
  });
  phaseHtml += `</div></div>`;
  document.getElementById('phase-chart').innerHTML = phaseHtml;

  // ═══ HUB-TO-HUB FLOW MATRIX ═══
  const hubCodes = ['ORD','DEN','IAH','EWR','SFO','IAD','LAX','NRT','GUM'];
  const hubSet = new Set(hubCodes);
  const matrix = {};
  hubCodes.forEach(o => { matrix[o] = {}; hubCodes.forEach(d => { matrix[o][d] = 0; }); });

  airborneFlights.forEach(f => {
    if (f.origin && f.dest && hubSet.has(f.origin) && hubSet.has(f.dest) && f.origin !== f.dest) {
      matrix[f.origin][f.dest]++;
    }
  });

  // Find max for color scaling
  let matrixMax = 1;
  hubCodes.forEach(o => hubCodes.forEach(d => { if (matrix[o][d] > matrixMax) matrixMax = matrix[o][d]; }));

  let mHtml = `<table style="border-collapse:collapse;width:100%;font-family:var(--font-mono);font-size:10px">`;
  mHtml += `<thead><tr><th style="padding:4px 6px;color:var(--ua-muted);font-size:9px">FROM \\ TO</th>`;
  hubCodes.forEach(d => { mHtml += `<th style="padding:4px 6px;color:var(--ua-accent);text-align:center">${d}</th>`; });
  mHtml += `<th style="padding:4px 6px;color:var(--ua-muted);text-align:center;font-size:9px">TOTAL</th></tr></thead><tbody>`;

  hubCodes.forEach(o => {
    let rowTotal = 0;
    mHtml += `<tr><td style="padding:4px 6px;color:var(--ua-accent);font-weight:700">${o}</td>`;
    hubCodes.forEach(d => {
      const v = matrix[o][d];
      rowTotal += v;
      if (o === d) {
        mHtml += `<td style="padding:4px 6px;text-align:center;background:rgba(30,41,59,.3);color:var(--ua-muted)">—</td>`;
      } else {
        const intensity = v > 0 ? Math.max(0.15, v / matrixMax) : 0;
        const bg = v > 0 ? `rgba(0,93,170,${intensity})` : 'transparent';
        mHtml += `<td style="padding:4px 6px;text-align:center;background:${bg};color:${v > 0 ? 'var(--ua-text)' : 'var(--ua-muted)'};font-weight:${v > 0 ? '700' : '400'};border:1px solid rgba(30,41,59,.3)">${v || '·'}</td>`;
      }
    });
    mHtml += `<td style="padding:4px 6px;text-align:center;color:var(--ua-muted);font-weight:700;border-left:2px solid var(--ua-border)">${rowTotal}</td>`;
    mHtml += `</tr>`;
  });
  mHtml += `</tbody></table>`;
  document.getElementById('hub-matrix').innerHTML = mHtml;

  // ═══ TOP ROUTES ═══
  const routeCount = {};
  airborneFlights.filter(f => f.origin && f.dest).forEach(f => {
    const key = f.origin + '→' + f.dest;
    routeCount[key] = (routeCount[key] || 0) + 1;
  });

  const topRoutes = Object.entries(routeCount).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const maxRouteCount = topRoutes[0] ? topRoutes[0][1] : 1;

  document.getElementById('route-heatmap').innerHTML = topRoutes.map(([route, count], i) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
      <span style="font-size:9px;color:var(--ua-muted);min-width:16px;text-align:right">${i+1}</span>
      <span style="font-size:11px;min-width:100px;font-weight:600">${route}</span>
      <div style="flex:1;height:6px;background:var(--ua-border);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${count/maxRouteCount*100}%;background:linear-gradient(90deg,var(--ua-blue),var(--ua-accent));border-radius:3px"></div>
      </div>
      <span style="font-size:10px;color:var(--ua-accent);font-weight:700">${count}</span>
    </div>`
  ).join('') || '<div style="color:var(--ua-muted)">Waiting for flight data…</div>';

  // ═══ AVERAGE FLEET AGE ═══
  const typeAges = {};
  FLEET_DB.forEach(a => {
    const y = parseInt(a.d);
    if (y) {
      if (!typeAges[a.t]) typeAges[a.t] = [];
      typeAges[a.t].push(currentYear - y);
    }
  });

  document.getElementById('avg-age-chart').innerHTML = typeOrder.map(t => {
    const tAges = typeAges[t] || [];
    const avg = tAges.length ? (tAges.reduce((a, b) => a + b, 0) / tAges.length).toFixed(1) : 0;
    const maxAge = 30;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(30,41,59,.3)">
      <span style="font-size:10px;min-width:85px">${t}</span>
      <div style="flex:1;margin:0 8px;height:8px;background:var(--ua-border);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${avg / maxAge * 100}%;background:${avg > 20 ? '#ef4444' : avg > 15 ? '#f59e0b' : avg > 8 ? '#005DAA' : '#22c55e'};border-radius:4px"></div>
      </div>
      <span style="font-size:10px;color:var(--ua-accent);font-weight:700;min-width:40px;text-align:right">${avg}y</span>
    </div>`;
  }).join('');
}

// ═══ LIVE FLEET PANEL ═══
function updateLiveFleetPanel() {
  if (!allFlights.length) return;
  const typeOrder = ["A319","A320","A321neo","737-700","737-800","737-900","737-900ER","737 MAX 8","737 MAX 9","757-200","757-300","767-300ER","767-400ER","777-200","777-200ER","777-300ER","787-8","787-9","787-10"];
  const typeCounts = {}; typeOrder.forEach(t => typeCounts[t] = { airborne: 0, total: 0 });
  FLEET_DB.forEach(a => { if (typeCounts[a.t]) typeCounts[a.t].total++; });

  let matched = 0, unmatched = 0;
  allFlights.forEach(f => {
    if (f.onGround) return;
    const ac = matchAircraft(f);
    if (!ac) { unmatched++; return; }
    matched++;
    if (typeCounts[ac.t]) typeCounts[ac.t].airborne++;
  });

  const totalAirborne = allFlights.filter(f => !f.onGround).length;

  // Update Zone 1 left panel — airborne count
  const countEl = document.getElementById('fleet-airborne-count');
  if (countEl) countEl.textContent = totalAirborne;

  const subtitleEl = document.getElementById('fleet-pulse-subtitle');
  if (subtitleEl) subtitleEl.textContent = matched + ' mainline matched · ' + unmatched + ' regional/partner';

  // Fleet utilization percentage
  const utilEl = document.getElementById('fleet-pulse-util');
  if (utilEl && FLEET_DB.length > 0) {
    const utilPct = Math.round(matched / FLEET_DB.length * 100);
    utilEl.textContent = utilPct + '% fleet utilization (' + matched + '/' + FLEET_DB.length + ')';
  }

  // Per-type utilization bars
  const utilBarsEl = document.getElementById('fleet-type-utilization');
  if (utilBarsEl) {
    let barsHtml = '';
    typeOrder.forEach(t => {
      const d = typeCounts[t];
      if (!d.total || d.airborne === 0) return;
      const pct = Math.round(d.airborne / d.total * 100);
      barsHtml += '<div class="type-util-row">' +
        '<span class="type-util-label">' + escapeHtml(t) + '</span>' +
        '<div class="type-util-track"><div class="type-util-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="type-util-count">' + d.airborne + '/' + d.total + ' ' + pct + '%</span>' +
      '</div>';
    });
    utilBarsEl.innerHTML = barsHtml;
  }

  // Update time
  const timeEl = document.getElementById('fleet-live-time');
  if (timeEl) timeEl.textContent = 'Updated ' + new Date().toUTCString().slice(17, 25) + 'Z';

  // Update sub-tab counts and re-render special aircraft (may have airborne status changes)
  updateFleetSubtabCounts();
  renderSpecialAircraftPanel();

  // If currently viewing airborne tab, re-render it
  if (activeFleetView === 'airborne') renderAirborneTable();
}

// ═══ WEATHER EXPLAINERS ═══
function explainMETAR(rawMetar, hub, cat) {
  if (!rawMetar) return '';
  const hubNames = {EWR:"Newark",IAH:"Houston Intercontinental",ORD:"O'Hare",DEN:"Denver International",SFO:"San Francisco",LAX:"Los Angeles",IAD:"Washington Dulles",NRT:"Tokyo Narita",GUM:"Guam"};
  const name = hubNames[hub] || hub;

  // Build context-aware assessment instead of static category blurbs

  let parts = [];

  // Wind
  const windMatch = rawMetar.match(/\b(\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (windMatch) {
    const dir = parseInt(windMatch[1]), spd = parseInt(windMatch[2]), gust = windMatch[4] ? parseInt(windMatch[4]) : null;
    const dirs = ['north','north-northeast','northeast','east-northeast','east','east-southeast','southeast','south-southeast','south','south-southwest','southwest','west-southwest','west','west-northwest','northwest','north-northwest'];
    const dirName = dirs[Math.round(dir / 22.5) % 16];
    parts.push(`Winds from the ${dirName} at ${spd} knots${gust ? ' gusting to ' + gust : ''}`);
  } else if (rawMetar.includes('00000KT')) {
    parts.push('Winds are calm');
  }

  // Visibility
  const visMatch = rawMetar.match(/\b(\d+)\s*SM\b/) || rawMetar.match(/\b(\d+)\/(\d+)SM\b/) || rawMetar.match(/\bM?(\d+\/\d+)SM\b/);
  if (visMatch) {
    const vis = visMatch[0].replace('SM', '').trim();
    parts.push(`Visibility is ${vis} statute miles`);
  }

  // Ceiling / clouds
  const cloudMatches = [...rawMetar.matchAll(/(FEW|SCT|BKN|OVC)(\d{3})/g)];
  const cloudNames = {FEW:'few clouds',SCT:'scattered',BKN:'broken ceiling',OVC:'overcast ceiling'};
  if (cloudMatches.length) {
    const lowest = cloudMatches[0];
    const altHun = parseInt(lowest[2]) * 100;
    parts.push(`${cloudNames[lowest[1]] || lowest[1]} at ${altHun.toLocaleString()} feet`);
  } else if (rawMetar.includes('CLR') || rawMetar.includes('SKC')) {
    parts.push('Clear skies');
  }

  // Weather phenomena
  const wxCodes = {RA:'rain',SN:'snow',DZ:'drizzle',FG:'fog',BR:'mist',HZ:'haze',TS:'thunderstorms',FZ:'freezing',SH:'showers',GR:'hail',PL:'ice pellets'};
  const wxMatch = rawMetar.match(/\s([+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)\s/);
  if (wxMatch) {
    const wx = wxMatch[1];
    let desc = [];
    if (wx.startsWith('-')) desc.push('light');
    else if (wx.startsWith('+')) desc.push('heavy');
    for (const [code, name] of Object.entries(wxCodes)) {
      if (wx.includes(code)) desc.push(name);
    }
    if (desc.length) parts.push(desc.join(' '));
  }

  // Temperature
  const tempMatch = rawMetar.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  if (tempMatch) {
    const t = tempMatch[1].replace('M', '-');
    const tempC = parseInt(t);
    const tempF = Math.round(tempC * 9/5 + 32);
    parts.push(`Temperature is ${tempC}°C (${tempF}°F)`);
  }

  // Altimeter
  const altMatch = rawMetar.match(/A(\d{4})/);
  if (altMatch) {
    const alt = (parseInt(altMatch[1]) / 100).toFixed(2);
    parts.push(`altimeter setting of ${alt} inHg`);
  }

  let text = `${name} is currently reporting ${cat || 'unknown'} conditions`;
  if (parts.length) text += '. ' + parts.join('. ') + '.';

  // Build dynamic operational assessment from actual conditions
  const assessParts = [];
  // Check for active weather phenomena
  const wxMatch2 = rawMetar.match(/\s([+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)\s/);
  if (wxMatch2) {
    const wx = wxMatch2[1];
    if (wx.includes('SN') || wx.includes('FZ')) assessParts.push('winter weather active');
    else if (wx.includes('TS')) assessParts.push('thunderstorm activity');
    else if (wx.includes('RA') || wx.includes('DZ') || wx.includes('SH')) assessParts.push('precipitation');
    else if (wx.includes('FG')) assessParts.push('fog');
    else if (wx.includes('BR') || wx.includes('HZ')) assessParts.push('reduced visibility');
  }
  // Check winds
  const wm2 = rawMetar.match(/\b\d{3}(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (wm2) {
    const gust = wm2[3] ? parseInt(wm2[3]) : parseInt(wm2[1]);
    if (gust >= 30) assessParts.push('strong/gusty winds');
    else if (gust >= 20) assessParts.push('gusty conditions');
  }
  // Check ceiling
  const ceil = [...rawMetar.matchAll(/(BKN|OVC)(\d{3})/g)];
  if (ceil.length) {
    const ceilFt = parseInt(ceil[0][2]) * 100;
    if (ceilFt < 500) assessParts.push('very low ceilings');
    else if (ceilFt < 1000) assessParts.push('low ceilings');
    else if (ceilFt <= 3000) assessParts.push('low overcast');
  }

  if (cat === 'LIFR') {
    text += ` Very low ceilings/visibility — major operational impact, expect ground stops and diversions.`;
  } else if (cat === 'IFR') {
    text += ` Instrument conditions${assessParts.length ? ' with ' + assessParts.join(', ') : ''} — expect significant delays and possible diversions.`;
  } else if (cat === 'MVFR') {
    text += ` Marginal conditions${assessParts.length ? ' with ' + assessParts.join(', ') : ''} — some delays possible.`;
  } else if (assessParts.length) {
    // VFR but with notable conditions
    text += ` ${assessParts.join(', ').replace(/^./, c => c.toUpperCase())} — monitor for changes.`;
  } else {
    text += ` Clear skies, good visibility — no impact on operations.`;
  }

  return text;
}

function explainFAAStatus(airportCode, delays, rawData) {
  if (!delays || delays.length === 0) {
    return `${airportCode} is operating normally — no reported delays or restrictions.`;
  }

  const explanations = delays.map(d => {
    let text = `${airportCode} is currently experiencing `;
    const dtype = (d.type || '').toLowerCase();
    const reason = d.reason || 'unknown causes';

    if (dtype.includes('departure')) text += `departure delays`;
    else if (dtype.includes('arrival')) text += `arrival delays`;
    else if (dtype.includes('ground stop') || dtype.includes('groundstop')) text += `a ground stop`;
    else if (dtype.includes('ground delay') || dtype.includes('gdp')) text += `a ground delay program`;
    else if (dtype.includes('closure') || dtype.includes('closed')) {
      return `${airportCode} is closed${d.startTime ? ' from ' + d.startTime : ''}${d.endTime ? ' to ' + d.endTime : ''}${reason !== 'unknown causes' ? ' due to ' + reason : ''} per NOTAM. This is a recurring restriction.`;
    }
    else text += `delays`;

    if (d.avgDelay || d.minDelay || d.maxDelay) {
      const range = d.minDelay && d.maxDelay ? `${d.minDelay}-${d.maxDelay} minutes` : d.avgDelay ? `approximately ${d.avgDelay} minutes` : '';
      if (range) text += ` of ${range}`;
    }

    text += ` due to ${reason}.`;

    if (d.trend) {
      if (d.trend.toLowerCase().includes('increas')) text += ` This is an increasing trend — delays may get worse.`;
      else if (d.trend.toLowerCase().includes('decreas')) text += ` Delays are decreasing — conditions improving.`;
    }

    return text;
  });

  return explanations.join(' ');
}

// ═══ SCHEDULE TAB ═══
const SCHED_HUB_TZ = {ORD:'America/Chicago',DEN:'America/Denver',IAH:'America/Chicago',EWR:'America/New_York',SFO:'America/Los_Angeles',IAD:'America/New_York',LAX:'America/Los_Angeles',NRT:'Asia/Tokyo',GUM:'Pacific/Guam'};
let schedCache = {}; // key: "hub-dir-day-page"
let schedAllFlights = []; // current filtered UA flights
let schedRawByHub = {}; // key: "hub-dir-day" → [pages of UA flights]
let schedCurrentDay = 0;
let schedCurrentHub = '';
let schedCurrentDir = 'departures';
let schedInitialized = false;
let schedSortCol = 'time';
let schedSortAsc = true;
let schedLoading = false;
let schedBoardMeta = null;        // meta object from the last loaded board (may be null/partial on old cached payloads)
let schedMetaByHub = {};          // key: "hub-dir-day" → that board's meta (disruption minutes are PER HUB)
let schedBoardFetchedAtMs = 0;    // when the current board arrived on this client

// Threads the board's live FAA disruption magnitude into classification so the
// disruption-extended operated-inference grace (schedule-status.js) actually engages.
// Without this opts plumbing at every classify call site, the GDP guard is dead code
// and stale boards mint false "Departed" rows again (review Jul 3 2026).
function classifyOptsFor(meta) {
  const v = Number(meta?.hubDisruptionMinutes);
  return { hubDisruptionMinutes: Number.isFinite(v) && v > 0 ? v : 0 };
}
// Per-hub variant for loops over schedRawByHub keys ("hub-dir-day").
function classifyOptsForKey(hubKey) {
  return classifyOptsFor(schedMetaByHub[hubKey]);
}
// Prefix lookup when only hub+dir are known (day defaults to today's board first).
function metaForHubDir(hub, dir) {
  return schedMetaByHub[`${hub}-${dir}-0`] || schedMetaByHub[`${hub}-${dir}-1`] || null;
}
let schedAutoScrollPending = false; // one-shot: scroll a freshly loaded TODAY board to "now"
let schedLastFutureIdx = -1;      // row index of the first future row in the last render (-1 = none)

// Client→server clock offset (seconds), learned from the schedule API's Date/Age headers on each
// fetch. classifySchedStatus reclassifies a long-past "scheduled" flight as departed based on
// elapsed time, so a device whose clock is skewed (a kiosk/EFB/tablet with bad NTP) would otherwise
// hide genuinely-upcoming flights or fabricate departures. schedNow() returns a server-anchored
// "now" so the reclassification tracks the schedule server's clock, not the device's. Offset 0
// (no header / first call) falls back to the raw device clock — same as before this anchor existed.
let schedClockOffsetSec = 0;
function schedNow() { return Math.floor(Date.now() / 1000) - schedClockOffsetSec; }

function initScheduleTab() {
  if (!schedInitialized) {
    schedInitialized = true;
    updateSchedDayLabels();
    // Day buttons
    document.querySelectorAll('.sched-day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sched-day-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        schedCurrentDay = parseInt(btn.dataset.day);
        loadScheduleData();
      });
    });
    // Filters
    document.getElementById('sched-hub').addEventListener('change', () => { schedCurrentHub = document.getElementById('sched-hub').value; updateSchedDayLabels(); loadScheduleData(); });
    document.getElementById('sched-dir').addEventListener('change', () => { schedCurrentDir = document.getElementById('sched-dir').value; loadScheduleData(); });
    const debouncedSchedRender = debounce(renderScheduleTable, 120);
    const schedFilterChanged = () => { debouncedSchedRender(); updateAdvFilterBtnText(); };
    document.getElementById('sched-status').addEventListener('change', schedFilterChanged);
    document.getElementById('sched-aircraft').addEventListener('change', schedFilterChanged);
    document.getElementById('sched-fleet-family').addEventListener('change', schedFilterChanged);
    document.getElementById('sched-route-type').addEventListener('change', schedFilterChanged);
    document.getElementById('sched-starlink').addEventListener('change', schedFilterChanged);
    document.getElementById('sched-timerange').addEventListener('change', schedFilterChanged);
    document.getElementById('sched-risk').addEventListener('change', schedFilterChanged);
    document.getElementById('sched-search').addEventListener('input', schedFilterChanged);
    // "Find in board" lives directly on the toolbar and drives the SAME text
    // predicate as the drawer's search input (two-way mirror, one filter).
    const schedFind = document.getElementById('sched-find');
    const schedDrawerSearch = document.getElementById('sched-search');
    if (schedFind && schedDrawerSearch) {
      schedFind.addEventListener('input', () => {
        if (schedDrawerSearch.value !== schedFind.value) {
          schedDrawerSearch.value = schedFind.value;
          schedFilterChanged();
        }
      });
      schedDrawerSearch.addEventListener('input', () => {
        if (schedFind.value !== schedDrawerSearch.value) schedFind.value = schedDrawerSearch.value;
      });
    }
    // Sort headers
    document.querySelectorAll('#sched-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (schedSortCol === col) schedSortAsc = !schedSortAsc;
        else { schedSortCol = col; schedSortAsc = true; }
        renderScheduleTable();
      });
    });
    // Auto-load if hub already selected
    if (!schedCurrentHub) {
      var homeHub = getHomeAirport() || 'ORD';
      document.getElementById('sched-hub').value = homeHub;
      schedCurrentHub = homeHub;
    }
    loadScheduleData();
  }
}

// Delegate to the shared hubTz helper so client and server agree on hub-local
// date math. The previous inline implementation added dayOffset * 86400 seconds,
// which is wrong on DST transition days (spring-forward = 23h, fall-back = 25h),
// and constructed labels with new Date(y, m-1, d+offset) in browser-local time,
// which lied for NRT/GUM viewed from the Americas.
function getSchedDayTimestamp(dayOffset) {
  return getStartOfHubDay(schedCurrentHub, dayOffset);
}

function getSchedDayLabel(dayOffset) {
  return getHubDayLabel(schedCurrentHub, dayOffset);
}

function getHubTzAbbrev(hub) {
  const tz = SCHED_HUB_TZ[hub] || 'America/Chicago';
  return new Date().toLocaleTimeString('en-US', { timeZone: tz, timeZoneName: 'short' }).split(' ').pop();
}

function updateSchedDayLabels() {
  const names = { '-1': 'Yesterday', '0': 'Today', '1': 'Tomorrow' };
  document.querySelectorAll('.sched-day-btn').forEach(btn => {
    const day = btn.dataset.day;
    const dateStr = getSchedDayLabel(parseInt(day));
    btn.textContent = `${names[day]} (${dateStr})`;
  });
}

async function preloadScheduleData() {
  // Skip if we already preloaded recently (survives soft navigations / refreshes)
  const PRELOAD_TTL = 10 * 60 * 1000; // 10 minutes
  const lastPreload = parseInt(sessionStorage.getItem('bb_sched_preload_ts') || '0', 10);
  if (Date.now() - lastPreload < PRELOAD_TTL) return;

  // Fetch hubs sequentially to avoid overwhelming FR24 with concurrent aggregations
  const preloadHubs = ['ORD','DEN','EWR'];
  let loaded = 0;
  for (const hub of preloadHubs) {
    try {
      // F022: compute the start-of-day PER HUB. The old code computed ONE
      // ET-anchored timestamp (schedCurrentHub is '' pre-tab-visit → Eastern
      // fallback) and reused it for ORD/DEN/EWR; the API then snapped it to the
      // hub-local day CONTAINING it, fetching YESTERDAY's DEN/ORD board 24/7 and
      // burning AeroDataBox units on the wrong day.
      const timestamp = getStartOfHubDay(hub, 0);
      const result = await fetchScheduleAggregated(hub, 'departures', timestamp);
      const hubKey = `${hub}-departures-0`;
      if (result.flights?.length && !schedRawByHub[hubKey]) {
        schedRawByHub[hubKey] = result.flights;
        schedMetaByHub[hubKey] = result.meta || null;
        loaded++;
      }
    } catch (e) { /* preload is best-effort */ }
  }
  if (loaded > 0) {
    sessionStorage.setItem('bb_sched_preload_ts', String(Date.now()));
    updateHubHealth();
    updateIrops();
  }
}

async function fetchScheduleAggregated(hub, dir, timestamp) {
  const cacheKey = `agg-${hub}-${dir}-${timestamp}`;
  if (schedCache[cacheKey]) return { ...schedCache[cacheKey], fromLocalCache: true };
  const url = `/api/schedule?hub=${encodeURIComponent(hub)}&dir=${encodeURIComponent(dir)}&timestamp=${timestamp}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    // Learn the server clock from this response so time-based status reclassification is immune to
    // device clock skew. Date = serve time; Age = seconds the response sat in a CDN cache, so the
    // edge's "now" is Date + Age. Best-effort: a missing/unparseable header leaves the offset as-is.
    const serverDateMs = Date.parse(resp.headers.get('date') || '');
    if (!Number.isNaN(serverDateMs)) {
      const ageSec = parseInt(resp.headers.get('age') || '0', 10) || 0;
      schedClockOffsetSec = Math.floor(Date.now() / 1000) - (Math.floor(serverDateMs / 1000) + ageSec);
    }
    if (!resp.ok) throw new Error(`Schedule API ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    if (!data.partial) schedCache[cacheKey] = data;
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Schedule request timed out');
    throw e;
  }
}

// classifySchedStatus now lives in ../lib/schedule-status.js (extracted + made time-aware so
// flights that already departed stop showing as "Scheduled"). Schedule-tab call sites pass
// schedCurrentDir so the departures/arrivals leg drives the elapsed-time check. updateHubHealth
// and updateIrops intentionally use the default 'departures' — they aggregate both directions /
// only read canceled+diverted — and must NOT be changed to pass schedCurrentDir.

let _schedPendingReload = false;
async function loadScheduleData() {
  if (schedLoading) { _schedPendingReload = true; return; }
  if (!schedCurrentHub) {
    document.getElementById('sched-loading').style.display = 'block';
    document.getElementById('sched-loading').innerHTML = '<div style="font-size:24px;margin-bottom:8px">📅</div>Select a hub to load schedule data';
    document.getElementById('sched-table-wrap').style.display = 'none';
    return;
  }
  schedLoading = true;
  const loadEl = document.getElementById('sched-loading');
  const tableWrap = document.getElementById('sched-table-wrap');
  loadEl.style.display = 'block';
  tableWrap.style.display = 'none';
  loadEl.innerHTML = `<div style="font-size:24px;margin-bottom:8px;animation:pulse 1.5s infinite">✈️</div>Loading ${escapeHtml(schedCurrentHub)} ${escapeHtml(schedCurrentDir)} for ${escapeHtml(getSchedDayLabel(schedCurrentDay))}...<br><span style="font-size:10px">Fetching via server cache</span>`;
  const btn = document.getElementById('sched-refresh-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Loading...';

  // F034: freeze the hub/dir/day for the ENTIRE load. The retry loop used to
  // re-read the live (mutable) schedCurrentHub each attempt, so switching hubs
  // mid-backoff fetched the NEW hub's data but stored it under the OLD hub's key
  // (frozen hubKey), polluting hub-health/IROPS aggregates. Now the fetch URL,
  // timestamp, storage key, and swap detection all use the frozen values.
  const loadHub = schedCurrentHub;
  const loadDir = schedCurrentDir;
  const loadDay = schedCurrentDay;

  try {
    const timestamp = getStartOfHubDay(loadHub, loadDay);
    const hubKey = `${loadHub}-${loadDir}-${loadDay}`;

    // Always fetch from schedule API for complete data (irops only has ~5 pages)
    let result;
    const MAX_RETRIES = 3;
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          loadEl.innerHTML = `<div style="font-size:24px;margin-bottom:8px;animation:pulse 1.5s infinite">✈️</div>Retrying ${escapeHtml(loadHub)} (attempt ${attempt + 1}/${MAX_RETRIES})...<br><span style="font-size:10px">Waiting ${delay / 1000}s before retry</span>`;
          await new Promise(r => setTimeout(r, delay));
        }
        result = await fetchScheduleAggregated(loadHub, loadDir, timestamp);
        lastErr = null;
        // Retry partial page/deadline fetches, but do not hammer a known first-page outage.
        const partialReason = result.meta?.partialReason || '';
        const failedBeforeAnyFlight = partialReason === 'first_page_failed' && Number(result.total || 0) === 0;
        if (result.partial && !failedBeforeAnyFlight && attempt < MAX_RETRIES - 1) {
          delete schedCache[`agg-${loadHub}-${loadDir}-${timestamp}`];
          continue;
        }
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;

    // F034: if the user switched hub/direction/day while this load was in flight,
    // abort before storing or rendering — the finally block's _schedPendingReload
    // re-runs the load for the current selection. Storing now would file this
    // hub's flights under a stale key and paint them into the new hub's view.
    if (schedCurrentHub !== loadHub || schedCurrentDir !== loadDir || schedCurrentDay !== loadDay) {
      return;
    }
    const allUAFlights = result.flights || [];

    // Show cache indicator
    if (result.cached || result.fromLocalCache) {
      loadEl.innerHTML = `<div style="font-size:24px;margin-bottom:8px;animation:pulse 1.5s infinite">✈️</div>Loading ${escapeHtml(loadHub)} ${escapeHtml(loadDir)}...<br><span style="font-size:10px;color:#4ecdc4">⚡ Served from cache · ${allUAFlights.length} UA flights</span>`;
    }

    schedAllFlights = allUAFlights;
    schedRawByHub[hubKey] = allUAFlights;
    schedBoardMeta = result.meta || null;
    schedMetaByHub[hubKey] = result.meta || null;
    schedBoardFetchedAtMs = Date.now();
    schedAutoScrollPending = loadDay === 0; // anchor Today at NOW on load (tomorrow/yesterday boards skip)
    preloadWeatherAndFAA();
    detectEquipmentSwaps(allUAFlights, loadHub, loadDir, loadDay);
    populateAircraftFilter();
    // Reset advanced filters on hub/direction/day change
    document.getElementById('sched-route-type').value = '';
    document.getElementById('sched-starlink').value = '';
    document.getElementById('sched-timerange').value = '';
    document.getElementById('sched-risk').value = '';
    loadEl.style.display = 'none';
    if (result.partial || result.degraded || result.stale) {
      const meta = result.meta || {};
      let msg = '';
      if (result.degraded && meta.dataAge != null) {
        // Absolute time + consequence, not just a relative age: "from 2h ago" made users do
        // clock math and never said what it MEANS. "Statuses as of 7:12 PM CDT — showing the
        // latest data we have" states both without implying an intentional, resumable stop
        // (owner Jul 4 2026: "paused" read as dishonest). != null (not truthiness): a
        // just-written snapshot has dataAge 0, which must still render with age context.
        const age = formatDataAge(meta.dataAge);
        const asOf = formatBoardAsOf();
        msg = result.partial
          ? `Statuses as of ${asOf} (partial board, ${age} old) — showing the latest data we have.`
          : `Statuses as of ${asOf} (${age} old) — showing the latest data we have.`;
      } else if (result.stale && !result.partial && meta.dataAge != null) {
        // Complete but aged out of the fresh window (degraded=false: nothing is missing). PR #207
        // made these boards degraded=false for honesty, but the banner gate never checked
        // result.stale — so hours-old complete boards rendered with NO warning. This branch (and
        // the gate above) restores the warning; without it the chain falls to the misleading
        // "Some flights may be missing." default, a lie for a complete board.
        msg = `Statuses as of ${formatBoardAsOf()} (${formatDataAge(meta.dataAge)} old) — showing the latest data we have.`;
      } else if (meta.liveFeedFallbackAdded) {
        msg = `Added ${meta.liveFeedFallbackAdded} live active flight(s) while the full schedule feed recovers.`;
      } else if (meta.partialReason === 'live_feed_fallback') {
        msg = 'Showing live active flights while the full schedule feed recovers.';
      } else if (meta.partialReason === 'deadline_exceeded') {
        msg = 'The request timed out before all pages were fetched.';
      } else if (meta.partialReason === 'first_page_failed') {
        msg = 'The upstream data source is not responding.';
      } else if (meta.partialReason === 'actual_only_official') {
        msg = 'Showing same-day actual flight times; scheduled times are unavailable.';
      } else if (meta.partialReason === 'page_fetch_failed') {
        msg = `${meta.pagesFailed || 'Some'} page(s) failed to load.`;
      } else {
        msg = 'Some flights may be missing.';
      }
      const pct = meta.completeness != null && meta.partialReason !== 'actual_only_official' && (result.partial || result.degraded)
        ? result.degraded && result.partial
          ? ` ${Math.round(meta.completeness * 100)}% previously loaded.`
          : !result.degraded
            ? ` ${Math.round(meta.completeness * 100)}% loaded.`
            : ''
        : '';
      // Escalate the banner with data age: teal reads as "all good", which is a lie for a board
      // that is hours old. 1-6h → amber caution; 6h+ (past a full cache lifetime) → red (--ua-red).
      const ageSeverity = (result.degraded || result.stale) && meta.dataAge != null ? dataAgeSeverity(meta.dataAge) : null;
      const palette = ageSeverity === 'stale'
        ? { bg: 'rgba(239,68,68,.12)', border: 'rgba(239,68,68,.3)', text: 'var(--ua-red)', icon: '⚠️' }
        : ageSeverity === 'aging'
          ? { bg: 'rgba(234,179,8,.12)', border: 'rgba(234,179,8,.3)', text: '#eab308', icon: '⏳' }
          : result.degraded
            ? { bg: 'rgba(78,205,196,.12)', border: 'rgba(78,205,196,.3)', text: '#4ecdc4', icon: '⏳' }
            : { bg: 'rgba(234,179,8,.12)', border: 'rgba(234,179,8,.3)', text: '#eab308', icon: '⚠️' };
      const bgColor = palette.bg;
      const borderColor = palette.border;
      const textColor = palette.text;
      const icon = palette.icon;
      loadEl.innerHTML = `<div style="padding:4px 12px;background:${bgColor};border:1px solid ${borderColor};border-radius:4px;font-size:11px;color:${textColor};margin:0">${icon} ${msg}${pct} <button data-action="schedule-retry-cached" style="background:none;border:none;color:var(--ua-accent);cursor:pointer;font-family:var(--font-ui);font-size:11px;text-decoration:underline">↻ Retry</button></div>`;
      loadEl.style.display = 'block';
    } else {
      loadEl.style.display = 'none';
    }
    tableWrap.style.display = 'block';
    renderScheduleTable();
    renderScheduleStats();
    updateHubHealth();
    updateIrops();
    checkWatchedFlightChanges(allUAFlights);
  } catch (err) {
    console.error('Schedule load error:', err);
    loadEl.innerHTML = `<div style="font-size:24px;margin-bottom:8px">⚠️</div>Error loading schedule: ${escapeHtml(err.message)}<br><span style="font-size:10px">Try again in a moment</span><br><button data-action="schedule-retry-reload" style="margin-top:8px;padding:4px 12px;background:var(--ua-blue);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">↻ Retry</button>`;
  } finally {
    schedLoading = false;
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
    if (_schedPendingReload) { _schedPendingReload = false; loadScheduleData(); }
  }
}

function populateAircraftFilter() {
  const sel = document.getElementById('sched-aircraft');
  const current = sel.value;
  const types = {};
  schedAllFlights.forEach(fl => {
    const code = fl.aircraft?.model?.code;
    const name = fl.aircraft?.model?.text;
    if (code) types[code] = name || code;
  });
  const sorted = Object.entries(types).sort((a, b) => a[0].localeCompare(b[0]));
  sel.innerHTML = '<option value="">All Aircraft</option>' + sorted.map(([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(code)} — ${escapeHtml(name)}</option>`).join('');
  if (current && types[current]) sel.value = current;
}

function formatSchedTime(utcTimestamp, hub) {
  if (!utcTimestamp) return '—';
  const tz = SCHED_HUB_TZ[hub] || 'America/Chicago';
  const d = new Date(utcTimestamp * 1000);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
}

// Absolute timestamp (ms) the current board's statuses are valid "as of".
// Prefers meta.generatedAt when the API provides it; falls back to fetch-time
// minus meta.dataAge; finally the fetch time itself. All fields defensive —
// old cached payloads may lack any of them.
function schedBoardAsOfMs() {
  const meta = schedBoardMeta;
  if (meta && meta.generatedAt) {
    const t = Date.parse(meta.generatedAt);
    if (!isNaN(t)) return t;
  }
  const base = schedBoardFetchedAtMs || Date.now();
  if (meta && meta.dataAge != null && Number.isFinite(Number(meta.dataAge))) {
    return base - Number(meta.dataAge) * 1000;
  }
  return base;
}

// "7:12 PM CDT" in the current hub's timezone — the absolute stamp used by the
// stale banner and by "Scheduled (as of …)" unknown-status rows.
function formatBoardAsOf(hub = schedCurrentHub) {
  const tz = SCHED_HUB_TZ[hub] || 'America/Chicago';
  try {
    return new Date(schedBoardAsOfMs()).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short',
    });
  } catch (e) {
    return new Date(schedBoardAsOfMs()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}

// CDN reality (Phase 2 review): clean boards sit at the CDN for up to 6h, so server-stamped
// live flags are usually past the status engine's 20-min recency gate by the time a cached
// board reaches this browser — the server merge persists TAILS cross-user, but "airborne right
// now" needs a fresh clock. The browser's own live feed refreshes every 30s, so re-apply the
// same tested overlay client-side against it. schedRawByHub stays un-overlaid (raw provider
// data for IROPS/equipment-swap paths), matching the server rule that snapshots stay pure.
function applyLiveFeedOverlayToSchedule() {
  if (!schedAllFlights.length || !allFlights.length || !lastGoodFeedTs) return;
  const map = new Map();
  for (const f of allFlights) {
    if (!f || !f.reg) continue;
    const key = normalizeFlightNum(f.flightIATA) || normalizeFlightNum(f.callsign);
    if (!key) continue;
    map.set(key, { reg: f.reg, origin: f.origin || '', dest: f.dest || '', seenAtMs: lastGoodFeedTs });
  }
  if (!map.size) return;
  const out = applySightingsToBoard({ flights: schedAllFlights }, map, Date.now());
  if (out.flights !== schedAllFlights) schedAllFlights = out.flights;
}

function getFilteredScheduleFlights(nowSec = schedNow()) {
  // Overlay first: every consumer (table render, stat strip, filters) funnels through this
  // function, so applying here keeps visible rows and stat counts reconciled by construction.
  applyLiveFeedOverlayToSchedule();
  const statusFilter = document.getElementById('sched-status').value;
  const aircraftFilter = document.getElementById('sched-aircraft').value;
  const fleetFamilyFilter = document.getElementById('sched-fleet-family').value;
  const routeTypeFilter = document.getElementById('sched-route-type').value;
  const starlinkFilter = document.getElementById('sched-starlink').value;
  const timeRangeFilter = document.getElementById('sched-timerange').value;
  const riskFilter = document.getElementById('sched-risk').value;
  const searchFilter = document.getElementById('sched-search').value.toLowerCase().trim();

  return schedAllFlights.filter(fl => {
    // Status filter. canceled_uncertain ("Likely Canceled") groups under the
    // Canceled filter per the dq-jul3 contract — it is a cancellation for
    // filtering purposes, just an unconfirmed one.
    if (statusFilter) {
      const s = classifySchedStatus(fl, schedCurrentDir, nowSec, classifyOptsFor(schedBoardMeta));
      const filterKey = s.key === 'canceled_uncertain' ? 'canceled' : s.key;
      if (filterKey !== statusFilter) return false;
    }
    // Aircraft filter
    if (aircraftFilter && fl.aircraft?.model?.code !== aircraftFilter) return false;
    // Fleet family filter
    if (fleetFamilyFilter) {
      const family = getScheduleFleetFamily(fl.aircraft?.model?.code, fl.aircraft?.model?.text);
      if (family !== fleetFamilyFilter) return false;
    }
    // Route type filter (domestic / international)
    if (routeTypeFilter) {
      const endpoint = schedCurrentDir === 'departures'
        ? fl.airport?.destination?.code?.iata
        : fl.airport?.origin?.code?.iata;
      const isIntl = endpoint && INTL_AIRPORTS.has(endpoint);
      if (routeTypeFilter === 'domestic' && isIntl) return false;
      if (routeTypeFilter === 'international' && !isIntl) return false;
    }
    // Starlink filter (schedRegFor: backfilled tails must match the filter their ⚡ badge implies)
    if (starlinkFilter) {
      const reg = schedRegFor(fl);
      const hasSL = reg && STARLINK_TAILS.has(reg);
      if (starlinkFilter === 'starlink' && !hasSL) return false;
      if (starlinkFilter === 'no-starlink' && hasSL) return false;
    }
    // Time range filter
    if (timeRangeFilter) {
      const ts = schedCurrentDir === 'departures'
        ? fl.time?.scheduled?.departure
        : fl.time?.scheduled?.arrival;
      if (ts) {
        const h = parseInt(new Date(ts * 1000).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: SCHED_HUB_TZ[schedCurrentHub] || 'America/Chicago' }));
        if (timeRangeFilter === 'morning' && !(h >= 5 && h < 12)) return false;
        if (timeRangeFilter === 'afternoon' && !(h >= 12 && h < 17)) return false;
        if (timeRangeFilter === 'evening' && !(h >= 17 && h < 22)) return false;
        if (timeRangeFilter === 'redeye' && !(h >= 22 || h < 5)) return false;
      }
    }
    // Delay risk filter
    if (riskFilter) {
      const status = classifySchedStatus(fl, schedCurrentDir, nowSec, classifyOptsFor(schedBoardMeta));
      if (['scheduled', 'estimated', 'delayed'].includes(status.key)) {
        const risk = computeDelayRiskForScheduleFlight(fl, schedCurrentHub, nowSec);
        const riskLabel = risk ? risk.label : 'LOW';
        // F004: RISK_BANDS (src/lib/delay-risk.js) has two bands at/above the "high" threshold —
        // HIGH and V.HIGH — so the "High Delay" filter must accept both, not just HIGH.
        if (riskFilter === 'high' && riskLabel !== 'HIGH' && riskLabel !== 'V.HIGH') return false;
        if (riskFilter === 'moderate' && riskLabel === 'LOW') return false;
        if (riskFilter === 'low' && riskLabel !== 'LOW') return false;
      } else if (riskFilter === 'high' || riskFilter === 'moderate') {
        return false;
      }
    }
    // Search filter
    if (searchFilter) {
      const flNum = fl.identification?.number?.default?.toLowerCase() || '';
      const callsign = fl.identification?.callsign?.toLowerCase() || '';
      const reg = schedRegFor(fl).toLowerCase(); // incl. backfilled tails — searching a visible reg must hit
      const destName = (fl.airport?.destination?.name || '').toLowerCase();
      const destCode = (fl.airport?.destination?.code?.iata || '').toLowerCase();
      const origName = (fl.airport?.origin?.name || '').toLowerCase();
      const origCode = (fl.airport?.origin?.code?.iata || '').toLowerCase();
      const acType = (fl.aircraft?.model?.code || '').toLowerCase();
      const haystack = `${flNum} ${callsign} ${reg} ${destName} ${destCode} ${origName} ${origCode} ${acType}`;
      if (!haystack.includes(searchFilter)) return false;
    }
    return true;
  });
}

function sortScheduleFlights(flights, nowSec = schedNow()) {
  const dir = schedSortAsc ? 1 : -1;
  return [...flights].sort((a, b) => {
    switch (schedSortCol) {
      case 'time': {
        const tA = (schedCurrentDir === 'departures' ? a.time?.scheduled?.departure : a.time?.scheduled?.arrival) || 0;
        const tB = (schedCurrentDir === 'departures' ? b.time?.scheduled?.departure : b.time?.scheduled?.arrival) || 0;
        return (tA - tB) * dir;
      }
      case 'flight': return ((a.identification?.number?.default || '') .localeCompare(b.identification?.number?.default || '')) * dir;
      case 'route': {
        const rA = schedCurrentDir === 'departures' ? (a.airport?.destination?.code?.iata || '') : (a.airport?.origin?.code?.iata || '');
        const rB = schedCurrentDir === 'departures' ? (b.airport?.destination?.code?.iata || '') : (b.airport?.origin?.code?.iata || '');
        return rA.localeCompare(rB) * dir;
      }
      case 'aircraft': return ((a.aircraft?.model?.code || '').localeCompare(b.aircraft?.model?.code || '')) * dir;
      case 'reg': return (schedRegFor(a).localeCompare(schedRegFor(b))) * dir;
      case 'status': {
        const sA = classifySchedStatus(a, schedCurrentDir, nowSec, classifyOptsFor(schedBoardMeta)).key;
        const sB = classifySchedStatus(b, schedCurrentDir, nowSec, classifyOptsFor(schedBoardMeta)).key;
        return sA.localeCompare(sB) * dir;
      }
      default: return 0;
    }
  });
}

function updateSchedTzFooter() {
  const hub = schedCurrentHub || 'ORD';
  const abbr = getHubTzAbbrev(hub);
  const hubLabel = hub || 'selected hub';
  const footer = document.getElementById('sched-tz-footer');
  if (!footer) return;
  footer.textContent = '';
  footer.appendChild(document.createTextNode('Schedule data via '));
  // Schedules come from AeroDataBox, NOT Flightradar24 — crediting FR24 here was an FR24 ToS
  // violation (audit). FR24 credit belongs only on live aircraft positions.
  const schedSourceLink = document.createElement('a');
  schedSourceLink.href = 'https://aerodatabox.com';
  schedSourceLink.target = '_blank';
  schedSourceLink.rel = 'noopener noreferrer';
  schedSourceLink.style.color = 'var(--ua-green)';
  schedSourceLink.textContent = 'AeroDataBox';
  footer.appendChild(schedSourceLink);
  footer.appendChild(document.createTextNode(' · United flights only · All times ' + hubLabel + ' local ('));
  const bold = document.createElement('b');
  bold.textContent = abbr;
  footer.appendChild(bold);
  footer.appendChild(document.createTextNode(')'));
}

function renderScheduleTable() {
  // Snapshot one server-anchored "now" for the whole render so the filter, sort, row badges, and
  // stat counts all agree on which flights have crossed the departed/landed grace window. Calling
  // schedNow() per classify (per row, per sort comparison) could straddle a 1s tick and disagree
  // within a single frame.
  const now = schedNow();
  const filtered = getFilteredScheduleFlights(now);
  const sorted = sortScheduleFlights(filtered, now);
  const tbody = document.getElementById('sched-tbody');
  const hub = schedCurrentHub;
  updateSchedTzFooter();

  // Update sort indicators and aria-sort
  document.querySelectorAll('#sched-table th[data-sort]').forEach(th => {
    const isActive = th.dataset.sort === schedSortCol;
    const arrow = isActive ? (schedSortAsc ? ' ↑' : ' ↓') : ' ↕';
    th.textContent = th.textContent.replace(/\s[↑↓↕]$/, '') + arrow;
    th.setAttribute('aria-sort', isActive ? (schedSortAsc ? 'ascending' : 'descending') : 'none');
  });

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--ua-muted)"><div style="font-size:24px;margin-bottom:8px">🔍</div>No flights match your filters<br><span style="font-size:10px">Try adjusting hub, status, or search criteria</span></td></tr>`;
    schedLastFutureIdx = -1;
    updateJumpNowPill(false);
    renderScheduleStats(filtered, now);
    return;
  }

  // Shared per-render context for date chips and "as of" stamps.
  const hubTzName = SCHED_HUB_TZ[hub] || 'America/Chicago';
  let boardDayStartSec = 0;
  try { boardDayStartSec = getStartOfHubDay(hub, schedCurrentDay); } catch (e) { boardDayStartSec = 0; }
  const boardAsOfStr = formatBoardAsOf(hub);

  const rows = sorted.map(fl => {
    const ident = fl.identification?.number?.default || '—';
    const schedTime = schedCurrentDir === 'departures' ? fl.time?.scheduled?.departure : fl.time?.scheduled?.arrival;
    const actualTime = schedCurrentDir === 'departures' ? (fl.time?.real?.departure || fl.time?.estimated?.departure) : (fl.time?.real?.arrival || fl.time?.estimated?.arrival);
    const derivedScheduleTime = schedCurrentDir === 'departures' ? fl._source?.scheduleTimeDerivedFromActual?.departure : fl._source?.scheduleTimeDerivedFromActual?.arrival;
    const timeStr = formatSchedTime(schedTime, hub);
    // Rows from a previous hub-local date (yesterday's stragglers on a time-ascending
    // board) get a small date chip so "06:52" is never mistaken for today's 06:52.
    let dateChip = '';
    if (schedTime && boardDayStartSec && schedTime < boardDayStartSec) {
      try {
        const chipLabel = new Date(schedTime * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: hubTzName });
        dateChip = ` <span class="sched-date-chip">${escapeHtml(chipLabel)}</span>`;
      } catch (e) { /* chip is decorative — never break the row */ }
    }
    let timeExtra = '';
    if (derivedScheduleTime) {
      timeExtra = `<div class="sched-time-actual">actual</div>`;
    } else if (actualTime && schedTime && actualTime !== schedTime) {
      const diff = Math.round((actualTime - schedTime) / 60);
      const actualStr = formatSchedTime(actualTime, hub);
      if (diff > 5) timeExtra = `<div class="sched-time-actual">→ ${actualStr} (+${diff}m)</div>`;
      else if (diff < -5) timeExtra = `<div class="sched-time-actual" style="color:var(--ua-green)">→ ${actualStr} (${diff}m)</div>`;
    }

    const dest = fl.airport?.destination;
    const orig = fl.airport?.origin;
    let routeStr;
    if (schedCurrentDir === 'departures') {
      routeStr = `${escapeHtml(hub)} → ${escapeHtml(dest?.code?.iata || '?')}`;
      if (dest?.name) routeStr += `<div style="font-size:9px;color:var(--ua-muted)">${escapeHtml(dest.name.replace(/ Airport| International/g, '').substring(0, 30))}</div>`;
    } else {
      routeStr = `${escapeHtml(orig?.code?.iata || '?')} → ${escapeHtml(hub)}`;
      if (orig?.name) routeStr += `<div style="font-size:9px;color:var(--ua-muted)">${escapeHtml(orig.name.replace(/ Airport| International/g, '').substring(0, 30))}</div>`;
    }

    const acCode = fl.aircraft?.model?.code || '—';
    const acText = fl.aircraft?.model?.text || '';
    const acShort = acText ? acText.replace(/Boeing |Airbus |Embraer /g, '').substring(0, 20) : '';
    // Provider reg first, ALWAYS. When the schedule feed omitted the tail, fall back to the
    // live-feed ledger — a currently-airborne flight fills from this poll's sighting, a
    // departed one from whenever a session saw it airborne. A filled reg also unlocks the
    // FLEET_BY_REG enrichment below (type, Starlink ⚡, special livery) for free.
    const reg = schedRegFor(fl) || '—';
    // Server-merged tails arrive IN aircraft.registration tagged regSource:'live_feed';
    // client-ledger fills leave registration empty. Both get the honesty tooltip.
    const regFromLive = reg !== '—' && (!fl.aircraft?.registration || fl.aircraft?.regSource === 'live_feed');

    const oIata = orig?.code?.iata || '';
    const dIata = dest?.code?.iata || '';
    // Terminal first, gate second ("T1 · C18") — the header says Term / Gate, so a bare
    // gate value must never sit where a terminal is expected (review Jul 3 2026).
    let gate;
    {
      const ap = schedCurrentDir === 'departures' ? orig : dest;
      const t = ap?.info?.terminal || (schedCurrentDir === 'departures'
        ? getUnitedTerminal(oIata, oIata, dIata)
        : getUnitedTerminal(dIata, oIata, dIata));
      const g = ap?.info?.gate;
      gate = t && g ? `T${t} · ${g}` : t ? `T${t}` : g ? `Gate ${g}` : '—';
    }

    const status = classifySchedStatus(fl, schedCurrentDir, now, classifyOptsFor(schedBoardMeta));
    // Display layer: 'unknown' renders as "Scheduled (as of …)", canceled_uncertain
    // gets its "Likely Canceled" label, raw provider strings get title-cased, and
    // presumed (time-inferred) departures get the asterisk treatment.
    const statusDisp = displayScheduleStatus(status);

    // Fleet match + enrichment
    let fleetMatch = '';
    let fleetEnrich = '';
    if (reg && reg !== '—') {
      const regClean = reg.replace('-', '');
      const match = FLEET_BY_REG[regClean] || FLEET_BY_REG[reg];
      if (match) {
        const isStar = STARLINK_TAILS.has(regClean) || STARLINK_TAILS.has(reg);
        fleetMatch = `<span class="sched-fleet-match">${isStar ? '⚡' : '✓'} ${escapeHtml(match.c || match.t)}</span>`;
        // Fleet enrichment inline
        const parts = [];
        if (match.seats && typeof match.seats === 'object') {
          const seatStr = Object.entries(match.seats).map(([cls,cnt]) => cnt + cls).join('/');
          parts.push(seatStr);
        }
        if (match.w) parts.push(normalizeWifi(match.w));
        if (isStar) parts.push('⚡ Starlink');
        if (match.i) parts.push(match.i);
        if (match.d) parts.push('Del ' + match.d);
        if (parts.length) fleetEnrich = `<div class="fleet-enrich-inline">${escapeHtml(parts.join(' · '))}</div>`;
      } else {
        fleetMatch = `<span class="sched-fleet-miss">—</span>`;
      }
    }

    // Equipment change detection with impact analysis
    let equipBadge = '';
    const eqChange = getEquipChangeForFlight(ident);
    if (eqChange) {
      const oldType = ICAO_TO_FLEET_TYPE[eqChange.oldAc] || eqChange.oldAc;
      const newType = ICAO_TO_FLEET_TYPE[eqChange.newAc] || eqChange.newAc;
      const impacts = analyzeSwapImpact(eqChange.oldAc, eqChange.newAc, reg);
      const hasDown = impacts.some(i => i.cls === 'downgrade');
      const hasUp = impacts.some(i => i.cls === 'upgrade');
      const icon = hasDown ? '🔴' : hasUp ? '🟢' : '⚠️';
      const regLink = reg !== '—' ? ` <span class="ac-reg-link" data-action="aircraft-detail" data-reg="${escapeHtml(reg)}" style="font-size:8px">${escapeHtml(reg)}</span>` : '';
      equipBadge = `<div class="equip-change-badge" style="background:${hasDown ? 'rgba(239,68,68,.15);color:var(--ua-red)' : hasUp ? 'rgba(34,197,94,.15);color:var(--ua-green)' : ''}">${icon} ${escapeHtml(oldType)} → ${escapeHtml(newType)}${regLink}</div>`;
      if (impacts.length) {
        equipBadge += `<div class="equip-swap-detail">`;
        impacts.forEach(i => {
          equipBadge += `<span class="equip-swap-item equip-swap-${i.cls}">${escapeHtml(i.text)}</span>`;
        });
        equipBadge += `</div>`;
      }
    }

    // Special aircraft detection
    const schedSpecial = reg !== '—' ? (isSpecialAircraft(reg.replace('-','')) || isSpecialAircraft(reg)) : null;

    // FAA delay context
    let faaContext = '';
    if (status.cls === 'delayed' || (status.key === 'estimated' && status.cls === 'delayed')) {
      const origIata = fl.airport?.origin?.code?.iata;
      const destIata = fl.airport?.destination?.code?.iata;
      const ctx = getFAADelayContext(origIata, destIata);
      if (ctx) faaContext = `<div class="faa-delay-context">${escapeHtml(ctx)}</div>`;
    }

    // Watch button
    const isWatched = isFlightWatched(ident);
    const { origCode, destCode, depHub, arrHub } = getScheduleRiskContext(fl, hub, schedCurrentDir);
    const watchRoute = `${origCode}→${destCode}`;
    const watchBtn = ident !== '—' ? `<button class="watch-btn${isWatched ? ' watching' : ''}" data-action="toggle-watch-flight" data-flight="${escapeHtml(ident)}" data-route="${escapeHtml(watchRoute)}" data-status="${escapeHtml(statusDisp.text)}" data-stop-prop="1" aria-label="${isWatched ? 'Unwatch flight' : 'Watch flight'}" title="${isWatched ? 'Unwatch' : 'Watch'} this flight">${isWatched ? ICO_WATCHING : ICO_WATCH}</button>` : '';

    // Delay risk scoring
    const dRisk = computeDelayRiskForScheduleFlight(fl, hub, now);
    const schedRiskOtp = hubHealthData[depHub];
    const schedRiskWxOrig = weatherOpsByHub[depHub];
    const schedRiskWxDest = weatherOpsByHub[arrHub];
    const schedRiskIrops = iropsHubData[depHub];
    const schedRiskIropsStr = iropsContextStr(schedRiskIrops);
    const schedRiskFaa = formatDelayExplainFAAStatus(depHub, arrHub, faaDelayIndex);
    const riskCell = dRisk ? `<span class="delay-risk-badge" data-action="explain-delay" data-flight="${escapeHtml(ident)}" data-route="${escapeHtml(origCode + '\u2192' + destCode)}" data-status="${escapeHtml(statusDisp.text)}" data-risk-label="${dRisk.label}" data-risk-score="${dRisk.score}" data-risk-factors="${escapeHtml(dRisk.factors.join('|'))}" data-hub="${escapeHtml(depHub)}"${schedRiskOtp !== undefined ? ' data-otp="' + schedRiskOtp + '"' : ''}${schedRiskWxOrig ? ' data-weather="' + escapeHtml(schedRiskWxOrig.level + (schedRiskWxOrig.reasons.length ? ': ' + schedRiskWxOrig.reasons.join(', ') : '')) + '"' : ''}${schedRiskWxDest ? ' data-dest-weather="' + escapeHtml(schedRiskWxDest.level + (schedRiskWxDest.reasons.length ? ': ' + schedRiskWxDest.reasons.join(', ') : '')) + '"' : ''}${schedRiskIropsStr ? ' data-irops="' + escapeHtml(schedRiskIropsStr) + '"' : ''}${schedRiskFaa ? ' data-faa-status="' + escapeHtml(schedRiskFaa) + '"' : ''} style="background:${dRisk.color}20;color:${dRisk.color};cursor:pointer" title="Click for AI analysis">RISK: ${dRisk.label}</span>` : '';

    // DELAY / RISK cell (#2): facts beat predictions. A row with a known
    // actual/estimated delta shows the REAL delay (right-aligned tabular figures,
    // +Nm under 90 min, +XhYYm above); only future rows without a meaningful delta
    // show the AI risk badge — worded "RISK: …" so a prediction can never read as a
    // fact. (Audit Jul 3 2026: a flight with a known +140m delay displayed "V.HIGH".)
    const hasOperatedRow = status.key === 'departed' || status.key === 'enroute' || status.key === 'landed';
    const isTerminalRow = status.key === 'canceled' || status.key === 'canceled_uncertain' || status.key === 'diverted';
    const deltaMin = (actualTime && schedTime) ? Math.round((actualTime - schedTime) / 60) : null;
    let delayCell;
    if (isTerminalRow) {
      delayCell = '<span class="sched-delay-none">\u2014</span>';
    } else if (deltaMin !== null && ((hasOperatedRow && !statusDisp.presumed) || deltaMin > 5)) {
      const deltaSrc = (fl.time?.real?.departure || fl.time?.real?.arrival) ? 'Actual' : 'Estimated';
      delayCell = `<span class="sched-delay-actual" style="color:${delayColorVar(deltaMin)}" title="${deltaSrc} vs scheduled ${schedCurrentDir === 'departures' ? 'departure' : 'arrival'}">${escapeHtml(formatDelayMinutes(deltaMin))}</span>`;
    } else if (riskCell) {
      delayCell = riskCell;
    } else {
      delayCell = '<span class="sched-delay-none">\u2014</span>';
    }

    // Status cell: presumed rows render "Departed*" with an explanatory tooltip;
    // unknown rows render "Scheduled" plus an absolute "as of" sub-stamp (#5/#6).
    const presumedTip = statusDisp.presumed
      ? ` title="Presumed ${status.key === 'landed' ? 'landed' : 'departed'} \u2014 scheduled time passed without a live update"`
      : '';
    let statusCell = `<span class="sched-status ${escapeHtml(statusDisp.cls)}"${statusDisp.live ? ' title="Aircraft seen airborne by live flight tracking"' : presumedTip}>${escapeHtml(statusDisp.text)}${statusDisp.presumed ? '*' : ''}</span>${statusDisp.live ? '<span class="sched-live-chip">LIVE</span>' : ''}`;
    if (statusDisp.asOf) statusCell += `<div class="sched-asof">as of ${escapeHtml(boardAsOfStr)}</div>`;

    return `<tr>
      <td>${escapeHtml(timeStr)}${dateChip}${timeExtra}</td>
      <td style="font-weight:600;color:var(--ua-accent)">${escapeHtml(ident)}</td>
      <td>${routeStr}</td>
      <td title="${escapeHtml(acText)}">${escapeHtml(acCode)}${acShort ? `<div style="font-size:9px;color:var(--ua-muted)">${escapeHtml(acShort)}</div>` : ''}${equipBadge}</td>
      <td style="font-family:var(--font-mono);font-size:10px">${reg !== '—' ? `<span class="ac-reg-link" data-action="aircraft-detail" data-reg="${escapeHtml(reg)}"${regFromLive ? ' title="Tail from live flight tracking (not in the schedule feed)"' : ''}>${escapeHtml(reg)}</span>` : '—'}${schedSpecial ? ' <span class="special-badge">⭐ ' + escapeHtml(schedSpecial.name) + '</span>' : ''}${fleetEnrich}</td>
      <td>${escapeHtml(gate)}</td>
      <td>${statusCell}${faaContext}</td>
      <td class="sched-delay-cell">${delayCell}</td>
      <td>${fleetMatch}</td>
      <td>${watchBtn}</td>
    </tr>`;
  });

  // ── NOW anchor (#3): today boards only, and only under the default time-ascending
  // sort (a divider is meaningless mid-list when sorted by flight/route/status).
  // Tomorrow boards and boards with no future rows skip all of this gracefully —
  // firstFutureIndex returns -1 with no future rows, and nowDividerIndex additionally
  // returns -1 when there are no past rows to divide from.
  schedLastFutureIdx = -1;
  if (schedCurrentDay === 0 && schedSortCol === 'time' && schedSortAsc) {
    // F075: anchor each row against the divider by its EFFECTIVE expected time —
    // max(scheduled, estimated) when no real time exists — so a flight held on the
    // ground (scheduled in the past, not yet departed) floats down below "── NOW ──"
    // instead of masquerading as resolved above it. Rows with a real time keep the
    // scheduled anchor (unchanged). The TIME-column sort order is untouched.
    const dep = schedCurrentDir === 'departures';
    const rowTimes = sorted.map(f => effectiveRowTime({
      scheduled: dep ? f.time?.scheduled?.departure : f.time?.scheduled?.arrival,
      real: dep ? f.time?.real?.departure : f.time?.real?.arrival,
      estimated: dep ? f.time?.estimated?.departure : f.time?.estimated?.arrival,
    }));
    schedLastFutureIdx = firstFutureIndex(rowTimes, now);
    const divIdx = nowDividerIndex(rowTimes, now);
    if (divIdx >= 0) {
      // Re-rendered with a fresh HH:MM on every refresh (renderScheduleTable is the
      // single render path), so the stamp tracks the clock.
      const nowLabel = `${formatSchedTime(now, hub)} ${getHubTzAbbrev(hub)}`;
      rows.splice(divIdx, 0, `<tr class="sched-now-divider" id="sched-now-row" aria-label="Current time marker"><td colspan="10">── NOW · ${escapeHtml(nowLabel)} ──</td></tr>`);
    }
  }
  updateJumpNowPill(schedCurrentDay === 0 && schedLastFutureIdx >= 0);

  tbody.innerHTML = rows.join('');

  // One-shot auto-scroll to NOW after a fresh board load (never on filter re-renders,
  // never when the user is on another tab).
  if (schedAutoScrollPending) {
    schedAutoScrollPending = false;
    if (schedLastFutureIdx >= 0 && document.getElementById('tab-schedule')?.classList.contains('active')) {
      scrollScheduleToNow(false);
    }
  }
  renderScheduleStats(filtered);
}

// Show/hide the "Jump to now" toolbar pill (today boards with at least one future row).
function updateJumpNowPill(visible) {
  const pill = document.getElementById('sched-jump-now');
  if (pill) pill.style.display = visible ? '' : 'none';
}

// Scroll the schedule table's scroll container to the NOW divider (or the first
// future row when the divider was skipped because there are no past rows).
function scrollScheduleToNow(smooth = true) {
  const wrap = document.getElementById('sched-table-wrap');
  const tbody = document.getElementById('sched-tbody');
  if (!wrap || !tbody) return;
  const target = document.getElementById('sched-now-row')
    || (schedLastFutureIdx >= 0 ? tbody.children[schedLastFutureIdx] : null);
  if (!target) return;
  const top = Math.max(0, target.offsetTop - 60);
  requestAnimationFrame(() => {
    if (typeof wrap.scrollTo === 'function') wrap.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    else wrap.scrollTop = top;
  });
}

function renderScheduleStats(filtered, nowSec = schedNow()) {
  if (!filtered) filtered = getFilteredScheduleFlights(nowSec);

  // Bucketing lives in src/lib/board-stats.js so the reconciliation invariant
  // (cards + catch-all === Total) is unit-tested. Audit Jul 3 2026: the strip
  // computed `canceled` but never rendered it — ORD showed Total 717 while the
  // visible cards summed 475, hiding 70 cancellations on an IROPS night.
  const counts = computeScheduleStatCounts(filtered, {
    dir: schedCurrentDir,
    nowSec,
    classify: (fl) => classifySchedStatus(fl, schedCurrentDir, nowSec, classifyOptsFor(schedBoardMeta)),
  });
  const showing = counts.total;

  const otp = counts.otp != null ? counts.otp : (showing > 0 ? '\u2014' : 0);
  const otpColor = typeof otp === 'number' ? (otp >= 70 ? '#22c55e' : otp >= 50 ? '#f59e0b' : '#ef4444') : 'var(--ua-muted)';
  const otpStr = typeof otp === 'number' ? otp + '%' : otp;

  const dayLabel = getSchedDayLabel(schedCurrentDay);
  const dirLabel = schedCurrentDir === 'departures' ? 'DEP' : 'ARR';

  const canceledTitle = counts.canceledUncertain > 0
    ? ` title="Includes ${counts.canceledUncertain} likely canceled (unconfirmed by provider)"`
    : '';
  // Muted catch-all so the visible cards always reconcile with Total instead of
  // lying by omission (diverted, operated rows without usable timestamps, etc.).
  const uncatCard = counts.uncategorized > 0 ? `
    <div class="metric-card" title="Rows that fit no card: diverted, or operated without usable timestamps">
      <span class="metric-val" style="color:var(--ua-dim)">${counts.uncategorized}</span>
      <span class="metric-label">Uncategorized</span>
    </div>` : '';

  document.getElementById('sched-stats').innerHTML = `
    <div class="metric-card">
      <span class="metric-val">${showing}</span>
      <span class="metric-label">UA ${dirLabel} \u00b7 ${dayLabel}</span>
    </div>
    <div class="metric-card">
      <span class="metric-val" style="color:${otpColor}">${otpStr}</span>
      <span class="metric-label">On-Time (${counts.operated} operated)</span>
    </div>
    <div class="metric-card">
      <span class="metric-val" style="color:var(--ua-green)">${counts.onTime}</span>
      <span class="metric-label">On Time</span>
    </div>
    <div class="metric-card">
      <span class="metric-val" style="color:var(--ua-yellow)">${counts.late}</span>
      <span class="metric-label">Late</span>
    </div>
    <div class="metric-card"${canceledTitle}>
      <span class="metric-val" style="color:var(--ua-red)">${counts.canceled}</span>
      <span class="metric-label">Canceled</span>
    </div>
    <div class="metric-card">
      <span class="metric-val" style="color:var(--ua-muted)">${counts.upcoming}</span>
      <span class="metric-label">Upcoming</span>
    </div>${uncatCard}
  `;

  // Sub-strip notes: presumed-departed count (#6) + FAA hub-disruption lag warning.
  const noteEl = document.getElementById('sched-stats-note');
  if (noteEl) {
    let notes = '';
    if (counts.presumed > 0) {
      const verb = schedCurrentDir === 'arrivals' ? 'landed' : 'departed';
      notes += `<span class="sched-note-chip" title="Presumed ${verb} \u2014 scheduled time passed without a live update">\u2708 ${counts.presumed} presumed ${verb}</span>`;
    }
    const hdm = Number(schedBoardMeta?.hubDisruptionMinutes);
    if (Number.isFinite(hdm) && hdm > 60 && schedCurrentHub) {
      notes += `<span class="sched-note-warn">\u26a0 ${escapeHtml(schedCurrentHub)} under FAA delay program (avg ${Math.round(hdm)}min) \u2014 statuses may lag.</span>`;
    }
    noteEl.innerHTML = notes;
    noteEl.style.display = notes ? '' : 'none';
  }
}

// ═══ OFFLINE DETECTION ═══
// Only show offline banner on actual 'offline' event — never proactively on load
// (navigator.onLine can be unreliable during service worker registration, causing a false flash)
function updateOnlineStatus() {
  const banner = document.getElementById('offline-banner');
  if (!navigator.onLine) {
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ═══ GLOBAL SEARCH ═══
document.getElementById('global-search-input').addEventListener('input', debounce(function() {
  hideGlobalSearchError();
  const q = this.value.trim().toUpperCase();
  const results = document.getElementById('global-search-results');
  if (q.length < 2) { results.style.display = 'none'; return; }

  // Normalize route queries: "ORD-DEN", "ORD DEN", "ORD → DEN" all become "ORDDEN"
  const qNorm = q.replace(/[\s\-→>]+/g, '');
  const matches = [];
  // Search live flights
  allFlights.forEach(f => {
    const cs = (f.callsign || '').toUpperCase();
    const flt = (f.flightIATA || '').toUpperCase();
    const reg = (f.reg || '').toUpperCase();
    const routeStr = ((f.origin || '') + (f.dest || '')).toUpperCase();
    const routeRev = ((f.dest || '') + (f.origin || '')).toUpperCase();
    if (cs.includes(q) || flt.includes(q) || reg.includes(q) || routeStr.includes(qNorm) || routeRev.includes(qNorm)) {
      matches.push({ type: 'live', label: `${f.flightIATA || f.callsign} ${f.origin||'?'}→${f.dest||'?'} ${f.reg||''}`, icao24: f.icao24 });
    }
  });
  // Search schedule data
  if (schedAllFlights.length) {
    schedAllFlights.forEach(fl => {
      const ident = (fl.identification?.number?.default || '').toUpperCase();
      const reg = (fl.aircraft?.registration || '').toUpperCase();
      const dest = (fl.airport?.destination?.code?.iata || '').toUpperCase();
      const orig = (fl.airport?.origin?.code?.iata || '').toUpperCase();
      if (ident.includes(q) || reg.includes(q) || dest.includes(q) || orig.includes(q)) {
        matches.push({ type: 'sched', label: `📅 ${fl.identification?.number?.default||'?'} ${orig||'?'}→${dest||'?'} ${fl.aircraft?.registration||''}` });
      }
    });
  }

  // Check if query looks like a flight number for FR24 lookup
  const flightPattern = /^(UA[L]?\s*\d{1,4}|\d{1,4})$/i;
  const normalizedQ = q.replace(/\s+/g, '');
  const looksLikeFlight = flightPattern.test(normalizedQ);
  const fr24Option = looksLikeFlight ? `<div class="search-result" style="border-top:1px solid var(--ua-border);color:var(--ua-accent);font-size:10px" data-action="lookup-fr24" data-query="${escapeHtml(normalizedQ)}" data-close-global="1">🔍 Look up ${escapeHtml(normalizedQ.startsWith('UA') || normalizedQ.startsWith('UAL') ? normalizedQ : 'UA' + normalizedQ)} via FlightRadar24...</div>` : '';

  if (matches.length === 0) {
    // Contextual "no results" message based on query format — all user input passed through escapeHtml()
    const tailPattern = /^N\d{3,5}[A-Z]{0,2}$/i;
    let noResultMsg;
    if (looksLikeFlight) {
      noResultMsg = escapeHtml(normalizedQ.startsWith('UA') || normalizedQ.startsWith('UAL') ? normalizedQ : 'UA' + normalizedQ) + ' is not currently airborne';
    } else if (tailPattern.test(normalizedQ)) {
      noResultMsg = escapeHtml(normalizedQ) + ' not found in live feed';
    } else {
      noResultMsg = 'No results for "' + escapeHtml(q) + '"';
    }
    results.innerHTML = '<div style="padding:10px 12px;color:var(--ua-muted);font-size:10px">' + noResultMsg + '</div>' + fr24Option;
  } else {
    results.innerHTML = matches.slice(0, 20).map(m => {
      if (m.type === 'live') return `<div class="search-result" data-action="focus-flight" data-icao24="${escapeHtml(m.icao24)}" data-close-global="1">${escapeHtml(m.label)}</div>`;
      return `<div class="search-result" data-action="switch-tab" data-tab="tab-schedule" data-close-global="1"><span style="color:var(--ua-muted)">${escapeHtml(m.label)}</span></div>`;
    }).join('') + fr24Option;
  }
  results.style.display = 'block';
}, 150));
document.addEventListener('click', function(e) { if (!document.getElementById('global-search-wrap').contains(e.target)) document.getElementById('global-search-results').style.display = 'none'; });

// ═══ EQUIPMENT SWAP DETECTION ═══
const ICAO_TO_FLEET_TYPE = {
  'A319':'A319','A320':'A320','A21N':'A321neo',
  'B737':'737-700','B738':'737-800','B739':'737-900',
  'B39M':'737 MAX 9','B38M':'737 MAX 8',
  'B752':'757-200','B753':'757-300',
  'B763':'767-300ER','B764':'767-400ER',
  'B772':'777-200','B77E':'777-200ER','B77W':'777-300ER',
  'B788':'787-8','B789':'787-9','B78X':'787-10'
};

// Cabin class rankings: higher = more premium
const CABIN_RANK = { 'J': 4, 'F': 3, 'PP': 2, 'PE': 2, 'E+': 1, 'Y': 0 };

// WiFi display name normalization (raw data → clean labels)
// normalizeWifi imported from ../lib/fleet-utils.js

// WiFi quality ranking: higher = better (uses normalized names)
const WIFI_RANK = { 'Starlink': 3, 'ViaSat Ka': 2, 'Satellite Ka': 1, 'Satellite Ka (US)': 1, 'Satellite Ku': 1, 'NO': 0 };

// IFE quality ranking
const IFE_RANK = { 'AVOD': 3, 'AVOD+PDE': 3, 'AVOD/PDE': 3, 'Seatback': 2, 'DTV/PDE': 1, 'PDE': 0 };

function getTypicalFleetStats(icaoCode) {
  const fleetType = ICAO_TO_FLEET_TYPE[icaoCode];
  if (!fleetType || !FLEET_DB.length) return null;
  // Find all aircraft of this type to get typical stats
  const ofType = FLEET_DB.filter(a => a.t === fleetType && categorizeFleetStatus(a.s) === 'active');
  if (!ofType.length) return null;
  // Use the most common config (mode)
  const configCounts = {};
  ofType.forEach(a => { const k = a.c || ''; configCounts[k] = (configCounts[k] || 0) + 1; });
  const topConfig = Object.entries(configCounts).sort((a, b) => b[1] - a[1])[0][0];
  const representative = ofType.find(a => (a.c || '') === topConfig) || ofType[0];
  // Collect WiFi types used by this fleet type
  const wifiCounts = {};
  ofType.forEach(a => { if (a.w) { const nw = normalizeWifi(a.w); wifiCounts[nw] = (wifiCounts[nw] || 0) + 1; } });
  const topWifi = Object.entries(wifiCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  // Check if any have Starlink
  const hasStarlink = ofType.some(a => STARLINK_TAILS.has(a.r));
  // Premium cabin: highest cabin class available
  const topCabin = representative.seats ? Object.keys(representative.seats).reduce((best, cls) =>
    (CABIN_RANK[cls] || 0) > (CABIN_RANK[best] || 0) ? cls : best, 'Y') : 'Y';
  return {
    type: fleetType,
    seats: representative.seats || {},
    tot: representative.tot || 0,
    wifi: topWifi,
    ife: representative.i || '',
    topCabin,
    hasStarlink
  };
}

function analyzeSwapImpact(oldAcCode, newAcCode, newReg) {
  const impacts = [];
  const oldStats = getTypicalFleetStats(oldAcCode);
  const newStats = getTypicalFleetStats(newAcCode);

  // If we have the actual new aircraft registration, use it for precise data
  let newActual = null;
  if (newReg && newReg !== '—') {
    const regClean = newReg.replace(/-/g, '');
    newActual = FLEET_BY_REG[regClean] || FLEET_BY_REG[newReg];
  }

  if (!oldStats && !newStats) return impacts;

  // Cabin class comparison
  if (oldStats && (newActual || newStats)) {
    const oldTop = oldStats.topCabin;
    const newSeats = newActual?.seats || newStats?.seats || {};
    const newTop = Object.keys(newSeats).reduce((best, cls) =>
      (CABIN_RANK[cls] || 0) > (CABIN_RANK[best] || 0) ? cls : best, 'Y');
    const oldRank = CABIN_RANK[oldTop] || 0;
    const newRank = CABIN_RANK[newTop] || 0;
    const cabinLabels = { 'J': 'Polaris', 'F': 'First', 'PP': 'Premium Plus', 'PE': 'Premium Plus', 'E+': 'Economy Plus', 'Y': 'Economy' };
    if (oldRank > newRank) {
      impacts.push({ text: 'Lost ' + (cabinLabels[oldTop] || oldTop), cls: 'downgrade' });
    } else if (newRank > oldRank) {
      impacts.push({ text: '+ ' + (cabinLabels[newTop] || newTop), cls: 'upgrade' });
    }
  }

  // Seat count comparison
  const oldTot = oldStats?.tot || 0;
  const newTot = newActual?.tot || newStats?.tot || 0;
  if (oldTot && newTot && oldTot !== newTot) {
    const delta = newTot - oldTot;
    impacts.push({
      text: (delta > 0 ? '+' : '') + delta + ' seats',
      cls: delta > 0 ? 'lateral' : 'downgrade'
    });
  }

  // WiFi comparison
  const oldWifi = normalizeWifi(oldStats?.wifi || '');
  const newWifi = normalizeWifi(newActual?.w || newStats?.wifi || '');
  if (oldWifi && newWifi && oldWifi !== newWifi) {
    const oldWR = WIFI_RANK[oldWifi] ?? 1;
    const newWR = WIFI_RANK[newWifi] ?? 1;
    if (oldWR !== newWR) {
      const shortWifi = (newActual && STARLINK_TAILS.has(newActual.r)) ? 'Starlink' : newWifi;
      impacts.push({
        text: shortWifi + ' WiFi',
        cls: newWR > oldWR ? 'upgrade' : 'downgrade'
      });
    }
  }

  // Starlink specifically (even if WiFi field doesn't change, Starlink is special)
  if (newActual && STARLINK_TAILS.has(newActual.r) && oldStats && !oldStats.hasStarlink) {
    if (!impacts.some(i => i.text.includes('Starlink'))) {
      impacts.push({ text: '⚡ Starlink', cls: 'upgrade' });
    }
  } else if (newActual && !STARLINK_TAILS.has(newActual.r) && oldStats?.hasStarlink) {
    if (!impacts.some(i => i.text.includes('Starlink'))) {
      impacts.push({ text: 'Lost Starlink', cls: 'downgrade' });
    }
  }

  // IFE comparison
  const oldIfe = oldStats?.ife || '';
  const newIfe = newActual?.i || newStats?.ife || '';
  if (oldIfe && newIfe && oldIfe !== newIfe) {
    const oldIR = IFE_RANK[oldIfe] ?? 1;
    const newIR = IFE_RANK[newIfe] ?? 1;
    if (oldIR !== newIR) {
      impacts.push({
        text: newIfe.replace('AVOD/PDE', 'AVOD').replace('AVOD+PDE', 'AVOD').replace('DTV/PDE', 'DTV'),
        cls: newIR > oldIR ? 'upgrade' : 'downgrade'
      });
    }
  }

  return impacts;
}

let equipmentChanges = [];

function detectEquipmentSwaps(flights, hub, dir, day) {
  const storageKey = `bb_sched_${hub}_${dir}_${day}`;
  const newMap = {};
  const regMap = {};
  flights.forEach(fl => {
    const fnum = fl.identification?.number?.default;
    const acCode = fl.aircraft?.model?.code;
    if (fnum && acCode) {
      newMap[fnum] = acCode;
      regMap[fnum] = fl.aircraft?.registration || '';
    }
  });
  equipmentChanges = [];
  try {
    const oldData = localStorage.getItem(storageKey);
    if (oldData) {
      const oldMap = JSON.parse(oldData);
      for (const [fnum, newAc] of Object.entries(newMap)) {
        if (oldMap[fnum] && oldMap[fnum] !== newAc) {
          equipmentChanges.push({ flight: fnum, oldAc: oldMap[fnum], newAc, reg: regMap[fnum] || '' });
        }
      }
    }
    localStorage.setItem(storageKey, JSON.stringify(newMap));
  } catch(e) { /* localStorage full or unavailable */ }
  updateEquipChangeSummary();
}

function updateEquipChangeSummary() {
  const el = document.getElementById('equip-change-summary');
  if (equipmentChanges.length > 0) {
    el.style.display = 'block';
    el.style.animation = 'equipFlash 1.5s ease';
    el.onclick = () => { const p = document.getElementById('sched-adv-filters'); if (p && (p.style.display === 'none' || !p.style.display)) toggleScheduleMoreFilters(); };
    // Count upgrades/downgrades/lateral
    let ups = 0, downs = 0;
    equipmentChanges.forEach(c => {
      const impacts = analyzeSwapImpact(c.oldAc, c.newAc, c.reg);
      if (impacts.some(i => i.cls === 'downgrade')) downs++;
      else if (impacts.some(i => i.cls === 'upgrade')) ups++;
    });
    let detail = '';
    if (downs) detail += ` · <span style="color:var(--ua-red)">${downs} downgrade${downs > 1 ? 's' : ''}</span>`;
    if (ups) detail += ` · <span style="color:var(--ua-green)">${ups} upgrade${ups > 1 ? 's' : ''}</span>`;
    el.innerHTML = `⚠️ ${equipmentChanges.length} equipment swap${equipmentChanges.length > 1 ? 's' : ''} detected${detail}`;
  } else {
    el.style.display = 'none';
  }
}

function getEquipChangeForFlight(flightNum) {
  return equipmentChanges.find(c => c.flight === flightNum);
}

// ═══ HUB HEALTH ═══
let hubHealthData = {};
// Hubs whose OTP came from the server /api/irops response. Server values are
// authoritative: the client-side computation may only FILL hubs the server
// response lacks, never overwrite them (audit Jul 3 2026: the DEN 68→100 flap —
// a thin client sample gated only by a ≥5-flight floor clobbered the server's
// much larger sample).
let hubHealthServerHubs = new Set();
// Latest IROPS severity index (0-100) from either computation path — feeds the
// header ticker so it can never say "normal" during a red IROPS night.
let lastIropsScore = null;
// F002: the server /api/irops response (all 9 hubs, one direction, one day, held-flight
// aware) is the AUTHORITATIVE IROPS writer — the same "single writer" rule v1.5.26 applied
// to OTP. Once the server has answered, the client-side updateIrops() recompute (partial
// boards, mixing directions/days, estimated-time delays) must NOT overwrite the panel or
// lastIropsScore; it may only fill the gap when the server value is absent (e.g. /api/irops
// failed), and it labels itself "estimated" when it does.
let iropsServerValuePresent = false;

// Single renderer for the hub health bar — reads from hubHealthData (shared state).
// Both IROPS and schedule paths write to hubHealthData, then call this.
function renderHubHealthBar() {
  const bar = document.getElementById('hub-health-bar');
  const hubs = ['ORD','DEN','IAH','EWR','SFO','IAD','LAX','NRT','GUM'];
  // F046/F076: chip severity is the WORSE of on-time% and any active FAA program at the
  // hub, so a ground-stopped hub can't render 🟢 while the ticker says "Disrupted". A
  // color-independent marker (⛔/⚠) is shown when a program is active (DESIGN.md: status
  // is never color-alone), e.g. "EWR ⛔ 84%".
  const tooltip = '% of operated departures within 30 min of schedule, blended with active FAA programs. 🟢 &gt;70% · 🟡 50–70% · 🔴 &lt;50% · ⛔ ground stop/closure (→red) · ⚠ ground delay/departure program (→amber)';
  if (!Object.keys(hubHealthData).length) {
    bar.innerHTML = `<span class="hh-label">Hub Health</span><span class="hh-explainer">ON-TIME %</span><span class="hh-info">?<span class="hh-tooltip">${tooltip}</span></span><span style="color:var(--ua-muted)">Load schedule data for hub health</span>`;
    return;
  }
  const SEV_RANK = { red: 3, amber: 2, green: 1 };
  const SEV_COLOR = { red: '#ef4444', amber: '#f59e0b', green: '#22c55e' };
  const homeHub = getHomeAirport();
  let html = `<span class="hh-label">Hub Health</span><span class="hh-explainer">ON-TIME %</span><span class="hh-info">?<span class="hh-tooltip">${tooltip}</span></span>`;
  hubs.forEach((hub, i) => {
    const isHome = hub === homeHub;
    const homeStyle = isHome ? ';border:1px solid var(--ua-accent);border-radius:3px;padding:2px 6px' : '';
    const pct = hubHealthData[hub];
    const prog = hubProgramMarker(faaDelayIndex, hub);
    const otpSev = pct === undefined ? null : (pct > 70 ? 'green' : pct >= 50 ? 'amber' : 'red');
    // Blend: worst of OTP severity and FAA-program severity.
    let sev = otpSev;
    if (prog && (!sev || SEV_RANK[prog.severity] > SEV_RANK[sev])) sev = prog.severity;
    const codeLink = `<a href="/hubs/${hub.toLowerCase()}" class="hh-code" style="color:inherit;text-decoration:none" title="${hub} Hub Guide">${isHome ? '🏠 ' : ''}${hub}</a>`;
    // When a program is active, its glyph replaces the plain severity circle (and is
    // colored by the blended severity); otherwise show the on-time circle.
    const progMark = prog ? `<span title="${escapeHtml(prog.label)}" style="color:${SEV_COLOR[sev]}">${prog.marker}</span> ` : '';
    if (pct === undefined) {
      // No OTP reading yet. If a program is active, still surface it in its severity color.
      const valSpan = prog
        ? `<span style="color:${SEV_COLOR[sev]}">—</span>`
        : '<span style="color:var(--ua-muted)">⚪ —</span>';
      html += `<span class="hh-hub" style="${homeStyle}">${codeLink} ${progMark}${valSpan}</span>`;
    } else {
      const emoji = prog ? '' : (sev === 'green' ? '🟢' : sev === 'amber' ? '🟡' : '🔴');
      html += `<span class="hh-hub" style="${homeStyle}">${codeLink} ${progMark}${emoji ? emoji + ' ' : ''}<span class="hh-pct" style="color:${SEV_COLOR[sev]}">${pct}%</span></span>`;
    }
    if (i < hubs.length - 1) html += '<span class="hh-sep">│</span>';
  });
  const pcts = hubs.map(h => hubHealthData[h]).filter(p => p !== undefined);
  if (pcts.length) {
    const avg = Math.round(pcts.reduce((a,b)=>a+b,0) / pcts.length);
    const avgLabel = avg > 70 ? 'Smooth Ops' : avg >= 50 ? 'Some Delays' : 'Rough Day';
    const avgColor = avg > 70 ? '#22c55e' : avg >= 50 ? '#f59e0b' : '#ef4444';
    html += `<span class="hh-sep">│</span><span class="hh-avg" style="color:${avgColor};font-size:9px;font-weight:700">${avgLabel}</span>`;
  }
  bar.innerHTML = html;
}

// Update hubHealthData from schedule data, then re-render.
// Only SETS data for hubs with sufficient operated flights — never deletes
// IROPS-derived data for hubs without schedule data.
function updateHubHealth() {
  const hubs = ['ORD','DEN','IAH','EWR','SFO','IAD','LAX','NRT','GUM'];
  const totalsByHub = {};
  hubs.forEach(hub => { totalsByHub[hub] = { onTime: 0, operated: 0 }; });

  // Gather OTP from all loaded schedule data.
  // Multiple keys can exist per hub (arrivals/departures + day), so aggregate
  // instead of letting whichever key is iterated last overwrite the hub value.
  for (const key of Object.keys(schedRawByHub)) {
    const flights = schedRawByHub[key];
    if (!flights || !flights.length) continue;
    const keyParts = key.split('-');
    const hub = keyParts[0];
    const boardDir = keyParts[1] === 'arrivals' ? 'arrivals' : 'departures';
    if (!totalsByHub[hub]) continue;
    flights.forEach(fl => {
      // The key carries each board's true direction — use it (a hardcoded 'departures' misreads
      // arrivals rows: direction picks which real timestamp resolves inference and
      // canceled_uncertain). Disruption opts are per-hub too. (review Jul 3 2026)
      const status = classifySchedStatus(fl, boardDir, schedNow(), classifyOptsForKey(key));
      const hasOp = status.key === 'departed' || status.key === 'enroute' || status.key === 'landed';
      if (!hasOp) return;
      // Time-inferred operated rows (a long-past "scheduled" the classifier reclassified, with no
      // real out-time) have no trustworthy baseline — exclude them, exactly as renderScheduleStats
      // does. Without this, a stale arrival carrying real.arrival but no real.departure would slip
      // past the realT check below and score a bogus cross-leg delay. (maintainability review)
      if (status.inferred) return;
      // Exclude degraded synthetic rows, exactly as the per-board OTP card does (updateSchedStats):
      // live-feed rescue rows carry last-seen/ETA times (not a true schedule baseline), and rows
      // whose schedule time was derived from the actual time always score on-time (delay 0) —
      // inflating hub OTP toward 100% precisely when the FR24 feed is degraded.
      // (Audit P1: degraded-rows-inflate-hub-otp.)
      if (fl._source?.liveFeedFallback) return;
      if (fl._source?.scheduleTimeDerivedFromActual?.departure || fl._source?.scheduleTimeDerivedFromActual?.arrival) return;
      const schedT = fl.time?.scheduled?.departure || fl.time?.scheduled?.arrival;
      const realT = fl.time?.real?.departure || fl.time?.real?.arrival;
      if (!realT || !schedT) return; // skip flights without real timestamps
      totalsByHub[hub].operated++;
      if (realT <= schedT + 1800) totalsByHub[hub].onTime++;
    });
  }

  hubs.forEach(hub => {
    // Server /api/irops OTP is authoritative when present — the client-side
    // computation only fills hubs the server response lacks, and never writes
    // from a thin sample (n < 25). Audit Jul 3 2026: DEN flapped 68→100 because
    // a 5-flight client sample overwrote the server's reading.
    if (hubHealthServerHubs.has(hub)) return;
    const { onTime, operated } = totalsByHub[hub];
    if (operated >= 25) {
      hubHealthData[hub] = Math.round((onTime / operated) * 100);
    }
    // Don't delete hubHealthData[hub] — IROPS may have set it
  });

  renderHubHealthBar();
  updateTicker(); // ticker health derives from hub OTP — keep it in lockstep
}

// ═══ IROPS DASHBOARD ═══
let faaDelayIndex = {};
let nasData = null;       // Global NAS status (en-route programs + planned TMIs) — populated by initWeatherTab
let weatherOpsByHub = {};  // Global METAR-derived ops impact per hub — populated by preloadWeatherAndFAA or initWeatherTab

/** Build faaDelayIndex from the /api/faa response (new per-airport shape with programs[]) */
function buildFaaIndex(faaResponse) {
  const index = {};
  if (!Array.isArray(faaResponse)) return index;
  for (const airport of faaResponse) {
    const code = airport.airportCode;
    if (!code) continue;
    // The new API returns per-airport objects directly — store them as-is
    // with backward-compat fields already populated by the server
    index[code] = airport;
  }
  return index;
}
let iropsHubData = {};    // Global IROPS cancellation/delay rates per hub — for delay risk engine

// Compact IROPS descriptor for the delay-risk badge's AI context. F007/F015: when the
// hub cleared the small-sample floor we report the rates; below the floor we expose the
// raw cancellation COUNT (never a rate a single flight inflated), and say so. Returns ''
// when there is nothing meaningful to report.
function iropsContextStr(irops) {
  if (!irops) return '';
  if (irops.cancellationRate !== null && irops.cancellationRate !== undefined) {
    return `${irops.cancellationRate}% cancelled, ${irops.delayed60Rate || 0}% delayed 60min+`;
  }
  const c = irops.cancellations || 0;
  if (c > 0) return `${c} of ${irops.total || '?'} cancelled (small sample — rate withheld)`;
  return '';
}
let aircraftJourneyCache = {};  // { reg: { segments, ts } } — aircraft history cache (5min TTL)
let connectionIndex = {};  // { flightNum: { connFlight, hub, minutes, risk } } — connection context for AI

// Preload weather (METAR) + FAA data on app init — so delay risk engine has data
// before user opens Weather tab. Also fetches weather for non-hub destinations
// of watched flights via single METAR batch request.
let _weatherPreloadPromise = null;
function preloadWeatherAndFAA() {
  if (_weatherPreloadPromise) return _weatherPreloadPromise;
  _weatherPreloadPromise = _doPreloadWeatherAndFAA().finally(() => {
    _weatherPreloadPromise = null;
  });
  return _weatherPreloadPromise;
}
async function _doPreloadWeatherAndFAA() {
  try {
    const hubStations = {EWR:'KEWR',IAH:'KIAH',ORD:'KORD',DEN:'KDEN',SFO:'KSFO',LAX:'KLAX',IAD:'KIAD',NRT:'RJAA',GUM:'PGUM'};
    const hubs = Object.keys(hubStations);
    const stationToHub = {};
    for (const [hub, station] of Object.entries(hubStations)) stationToHub[station] = hub;

    const extraAirports = new Map();
    const addExtraAirport = (iata) => {
      const code = (iata || '').trim().toUpperCase();
      if (!code || code.length !== 3 || hubStations[code]) return;
      const station = getMetarStationForIata(code);
      if (!station) return;
      extraAirports.set(code, station);
    };

    // Collect non-hub airports from watched flights for origin/destination weather
    try {
      const watchedRaw = localStorage.getItem('bb_watched_flights') || localStorage.getItem('watchedFlights');
      if (watchedRaw) {
        const wf = JSON.parse(watchedRaw);
        wf.forEach(w => {
          const route = w.route || '';
          const parts = route.split('\u2192').length > 1 ? route.split('\u2192') : route.split('→');
          addExtraAirport(parts[0]);
          addExtraAirport(parts[1]);
        });
      }
    } catch(e) {}

    Object.values(schedRawByHub).forEach(flights => {
      if (!Array.isArray(flights)) return;
      flights.forEach(fl => {
        addExtraAirport(fl.airport?.origin?.code?.iata);
        addExtraAirport(fl.airport?.destination?.code?.iata);
      });
    });

    // Map non-hub IATA to ICAO for METAR API (US airports = K + IATA)
    const extraStations = {};
    extraAirports.forEach((station, iata) => {
      extraStations[iata] = station;
      stationToHub[station] = iata;
    });

    const allStations = [...Object.values(hubStations), ...Object.values(extraStations)].join(',');
    const [metarResult, faaResult] = await Promise.allSettled([
      fetchMetarBatch(allStations),
      fetch('/api/faa').then(r => r.ok ? r.json() : Promise.reject(new Error('faa'))),
    ]);

    // Parse METAR and populate weatherOpsByHub (for hubs AND non-hub destinations)
    const metarByHub = {};
    if (metarResult.status === 'fulfilled') {
      metarResult.value.forEach(m => {
        const key = stationToHub[m.icaoId || m.stationId] || stationToHub[m.id];
        if (key) metarByHub[key] = m;
      });
      [...hubs, ...extraAirports.keys()].forEach(apt => {
        const data = metarByHub[apt];
        if (!data) return;
        const raw = data.rawOb || '';
        const apiCat = data.fltCat || data.fltcat || 'UNK';
        const localCat = computeFlightCategory(raw);
        const catRank = {LIFR:0,IFR:1,MVFR:2,VFR:3,UNK:3};
        const cat = localCat && (catRank[localCat] ?? 3) < (catRank[apiCat] ?? 3) ? localCat : apiCat;
        const ops = computeOpsImpact(raw, cat);
        weatherOpsByHub[apt] = { level: ops.level, reasons: ops.reasons, fltCat: cat,
          hasThunderstorms: ops.hasThunderstorms, hasFreezingPrecip: ops.hasFreezingPrecip,
          hasSnow: ops.hasSnow, hasFog: ops.hasFog, gustKt: ops.gustKt || 0, tempC: ops.tempC };
      });
    }

    // Parse FAA data (covers ALL airports with active delays, not just hubs)
    if (faaResult.status === 'fulfilled' && Array.isArray(faaResult.value)) {
      faaDelayIndex = buildFaaIndex(faaResult.value);
      renderHubHealthBar(); // F046/F076: chips blend FAA programs — refresh once programs land
    }

    if (document.getElementById('tab-schedule')?.classList.contains('active') && schedAllFlights.length) {
      renderScheduleTable();
      renderScheduleStats();
    }
  } catch(e) {
    console.error('Weather/FAA preload error:', e);
  }
}

function updateIrops() {
  // F002 single-writer rule: the server value is authoritative. Once /api/irops has
  // populated the panel + lastIropsScore, this client recompute must not touch either —
  // it exists only to fill the gap when the server never answered.
  if (iropsServerValuePresent) return;

  const content = document.getElementById('irops-content');
  // Gather schedule data. F002: restrict the fallback to today's DEPARTURES boards only —
  // the old path mixed directions and days (double-counting the same physical flight from
  // an arrivals board, and mixing tomorrow's schedule into a "today" index). One board per
  // hub, one direction, one day keeps the fallback's denominator honest.
  let allSchedFlts = [];
  for (const [key, flights] of Object.entries(schedRawByHub)) {
    if (!Array.isArray(flights)) continue;
    const parts = key.split('-');
    const dir = parts[1] === 'arrivals' ? 'arrivals' : 'departures';
    const day = parts[2];
    if (dir !== 'departures' || day !== '0') continue;
    for (const fl of flights) allSchedFlts.push({ fl, dir, key });
  }

  if (allSchedFlts.length === 0) {
    content.innerHTML = '<div class="irops-bar"><span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-muted)">—</span><span class="irops-bar-label">Loading schedule data…</span></span></div>';
    return;
  }

  let cancellations = 0, delayed30 = 0, delayed60 = 0, diversions = 0, totalFlights = allSchedFlts.length;

  const worstDelays = [];

  allSchedFlts.forEach(({ fl, dir, key }) => {
    // Direction matters here: canceled_uncertain resolves via the direction-appropriate real
    // timestamp (an arrivals row with real.arrival must clear the suspicion) — a hardcoded
    // 'departures' miscounts arrivals boards' likely-canceled rows. (review Jul 3 2026)
    const s = classifySchedStatus(fl, dir, schedNow(), classifyOptsForKey(key));
    if (s.key === 'canceled' || s.key === 'canceled_uncertain') cancellations++; // Likely Canceled groups with cancellations
    if (s.key === 'diverted') diversions++;
    const schedT = fl.time?.scheduled?.departure || fl.time?.scheduled?.arrival || 0;
    const actT = fl.time?.real?.departure || fl.time?.real?.arrival || fl.time?.estimated?.departure || fl.time?.estimated?.arrival || 0;
    if (schedT && actT && actT > schedT) {
      const delayMin = Math.round((actT - schedT) / 60);
      if (delayMin > 30) delayed30++;
      if (delayMin > 60) delayed60++;
      if (delayMin > 15) {
        const ident = fl.identification?.number?.default || '?';
        const orig = fl.airport?.origin?.code?.iata || '?';
        const dest = fl.airport?.destination?.code?.iata || '?';
        worstDelays.push({ ident, route: `${orig}→${dest}`, delay: delayMin });
      }
    }
  });

  // Ground stops from FAA
  const groundStops = Object.values(faaDelayIndex).filter(d => {
    return d.groundStop || (d.delays && d.delays.some(dl => (dl.type||'') === 'ground_stop'));
  }).length;

  // F017: weight each flight once — 60m+ delays are ×2, the exclusive 30–60m bucket is ×1
  // (a 61-min delay must not score 1+2=3, i.e. as much as a cancellation). delayed30 stays
  // cumulative so the ">30m" card below remains truthful.
  const delayed30to60 = Math.max(0, delayed30 - delayed60);
  const score = totalFlights > 0 ? ((cancellations * 3 + delayed60 * 2 + delayed30to60 + diversions * 2) / totalFlights * 100).toFixed(1) : 0;
  const scoreCls = score < 5 ? 'low' : score < 15 ? 'med' : 'high';
  const scoreLabel = score < 5 ? 'NORMAL OPERATIONS' : score < 15 ? 'MINOR DISRUPTION' : 'SIGNIFICANT DISRUPTION';

  worstDelays.sort((a, b) => b.delay - a.delay);
  const top5 = worstDelays.slice(0, 5);

  // NOTE: All values here are computed numbers/strings from internal schedule data,
  // not user input. FAA alerts use escapeHtml() below.
  let html = '<div class="irops-bar">';
  // Plain-language severity instead of a bare 0-100 index (owner Jul 4 2026: the number
  // wasn't helpful). The numeric score is still computed below for the ticker's gating.
  // F002: this is the client FALLBACK (server /api/irops unavailable) \u2014 mark it "estimated"
  // so it never masquerades as the authoritative network-wide figure.
  html += `<span class="irops-bar-item"><span class="irops-score ${scoreCls}" style="font-size:12px;padding:2px 8px">${scoreLabel}</span><span class="irops-partial-tag" style="font-size:9px;color:var(--ua-muted);margin-left:6px;font-family:var(--font-mono)">est \u00b7 loaded boards</span><span class="hh-info">?<span class="hh-tooltip">Estimated from the schedule boards loaded in your session (server IROPS feed unavailable). Severity weights cancellations (\u00d73), diversions (\u00d72), 60min+ delays (\u00d72) and 30\u201360min delays (\u00d71) per 100 scheduled flights: Normal \u00b7 Minor \u00b7 Significant.</span></span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-red)">${cancellations}</span><span class="irops-bar-label">Cancellations</span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-yellow)">${delayed30}</span><span class="irops-bar-label">&gt;30m</span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-red)">${delayed60}</span><span class="irops-bar-label">&gt;60m</span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:#c026d3">${diversions}</span><span class="irops-bar-label">Diversions</span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-accent)">${totalFlights}</span><span class="irops-bar-label">Total Flights</span></span>`;
  html += '</div>';

  // FAA alerts — separate line below bar (escapeHtml for safety)
  const faaAlerts = [];
  for (const [apt, data] of Object.entries(faaDelayIndex)) {
    if (data.delays && data.delays.length > 0) {
      data.delays.forEach(d => faaAlerts.push(`${apt}: ${d.type || d.reason || 'Delay'}`));
    }
  }
  if (faaAlerts.length) {
    html += `<div class="irops-bar-faa">${faaAlerts.map(a => escapeHtml(a)).join(' · ')}</div>`;
  }
  content.innerHTML = html;

  lastIropsScore = Number(score);
  updateTicker(); // ticker health derives from the IROPS index — keep it in lockstep
}

function autoLoadIrops() {
  // Try server-side precomputed IROPS first
  fetchIropsFromAPI();
}

let _iropsPromise = null;
function fetchIropsFromAPI() {
  if (_iropsPromise) return _iropsPromise;
  _iropsPromise = _doFetchIropsFromAPI().finally(() => {
    _iropsPromise = null;
  });
  return _iropsPromise;
}
async function _doFetchIropsFromAPI() {
  const content = document.getElementById('irops-content');
  // Keep the default bar with — placeholders during load (already in HTML)
  try {
    const resp = await fetch('/api/irops');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderIropsFromAPI(data);
  } catch (e) {
    console.error('IROPS API failed, falling back to manual:', e);
    if (content) content.innerHTML = '<div class="irops-bar"><span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-muted)">—</span><span class="irops-bar-label">IROPS unavailable</span></span></div>';
  }
}

function renderIropsFromAPI(data) {
  // Store IROPS hub data globally for delay risk engine.
  // F007/F015: a cancellation RATE from a tiny sample is a lie — one cancelled GUM flight
  // on a 4-flight board is not a "25% cancellation rate" to feed the delay-risk engine
  // (up to 12 pts) and the AI explanation. Apply the same small-sample floor the OTP path
  // uses just below: only publish a rate when total >= 10 OR cancellations >= 3. Below the
  // floor, expose the raw counts (so consumers can still say "1 of 4 cancelled") but leave
  // the rates null so every rate threshold degrades to "signal omitted", never a zero or a
  // small-sample spike.
  if (data.hubMetrics) {
    for (const [hub, m] of Object.entries(data.hubMetrics)) {
      if (m && m.total > 0) {
        const cancellations = m.cancellations || 0;
        const hasRateFloor = m.total >= 10 || cancellations >= 3;
        iropsHubData[hub] = {
          cancellations,
          total: m.total,
          cancellationRate: hasRateFloor ? Math.round((cancellations / m.total) * 100) : null,
          delayed60Rate: hasRateFloor ? Math.round(((m.delayed60 || 0) / m.total) * 100) : null,
        };
      }
    }
  }

  // Populate hubHealthData from IROPS hubMetrics, then render the shared bar.
  if (data.hubMetrics) {
    for (const [hub, m] of Object.entries(data.hubMetrics)) {
      if (!m || !m.total) continue;
      const operated = Number(m.operated || 0);
      const onTime = Number(m.onTime || 0);
      const cancelRate = m.total > 10 ? Number(m.cancellations || 0) / m.total : 0;
      if (operated < 5 && cancelRate >= 0.5) {
        hubHealthData[hub] = 0; // mostly cancelled — show as critical
        hubHealthServerHubs.add(hub); // server value is authoritative from here on
      } else if (operated >= 5) {
        hubHealthData[hub] = Math.round((onTime / operated) * 100);
        hubHealthServerHubs.add(hub); // server value is authoritative from here on
      }
      // operated < 5 and low cancel rate: leave hub alone (no data yet)
    }
    renderHubHealthBar();
  }

  const content = document.getElementById('irops-content');
  const score = data.score;
  const scoreCls = score < 5 ? 'low' : score < 15 ? 'med' : 'high';
  const scoreLabel = score < 5 ? 'NORMAL OPERATIONS' : score < 15 ? 'MINOR DISRUPTION' : 'SIGNIFICANT DISRUPTION';

  // NOTE: All values here are from the IROPS API (internal, not user input).
  let html = '<div class="irops-bar">';
  // Authoritative network-wide index (all 9 hubs). Tooltip states the exact F017 weights.
  html += `<span class="irops-bar-item"><span class="irops-score ${scoreCls}" style="font-size:12px;padding:2px 8px">${scoreLabel}</span><span class="hh-info">?<span class="hh-tooltip">Network-wide severity across all United hubs, weighting cancellations (\u00d73), diversions (\u00d72), 60min+ delays (\u00d72) and 30\u201360min delays (\u00d71) \u2014 including flights held past schedule \u2014 per 100 scheduled flights: Normal \u00b7 Minor \u00b7 Significant.</span></span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-red)">${data.cancellations || '—'}</span><span class="irops-bar-label">Cancellations</span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-yellow)">${data.delayed30}</span><span class="irops-bar-label">&gt;30m</span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-red)">${data.delayed60}</span><span class="irops-bar-label">&gt;60m</span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:#c026d3">${data.diversions}</span><span class="irops-bar-label">Diversions</span></span>`;
  html += '<span class="irops-bar-sep">│</span>';
  html += `<span class="irops-bar-item"><span class="irops-bar-val" style="color:var(--ua-accent)">${data.totalFlights}</span><span class="irops-bar-label">Total Flights</span></span>`;
  html += '</div>';

  content.innerHTML = html;

  // F002: mark the server value present so the client fallback (updateIrops) stops
  // overwriting the panel / lastIropsScore. From here, this is the single writer.
  iropsServerValuePresent = true;
  lastIropsScore = Number(score);
  updateTicker(); // ticker health derives from the IROPS index — keep it in lockstep

  if (document.getElementById('tab-schedule')?.classList.contains('active') && schedAllFlights.length) {
    renderScheduleTable();
    renderScheduleStats();
  }
}

// ═══ FAA DELAY CONTEXT ═══
function getFAADelayContext(originIata, destIata) {
  const contexts = [];
  [originIata, destIata].forEach(apt => {
    if (!apt) return;
    const faa = faaDelayIndex[apt];
    if (!faa || !faa.delays || !faa.delays.length) return;
    faa.delays.forEach(d => {
      const dtype = (d.type || '').toLowerCase();
      let label = 'Delay';
      if (dtype.includes('ground stop')) label = 'Ground Stop';
      else if (dtype.includes('ground delay') || dtype.includes('gdp')) label = 'GDP';
      else if (dtype.includes('departure')) label = 'Dep Delay';
      else if (dtype.includes('arrival')) label = 'Arr Delay';
      const avg = d.avgDelay ? `, avg ${d.avgDelay} min` : '';
      contexts.push(`${label} at ${apt}${avg}`);
    });
  });
  return contexts.join(' · ');
}

// ═══ FLIGHT WATCH ═══
const MAX_WATCHED = 20;

function getWatchedFlights() {
  try { return JSON.parse(localStorage.getItem('bb_watched_flights') || '[]'); } catch(e) { return []; }
}

function saveWatchedFlights(list) {
  try { localStorage.setItem('bb_watched_flights', JSON.stringify(list.slice(0, MAX_WATCHED))); } catch(e) {}
  updateWatchBadge();
}

function isFlightWatched(flightNum) {
  return getWatchedFlights().some(w => w.flight === flightNum);
}

function toggleWatchFlight(flightNum, route, currentStatus) {
  let watched = getWatchedFlights();
  const idx = watched.findIndex(w => w.flight === flightNum);
  let isWatched;
  if (idx >= 0) {
    watched.splice(idx, 1);
    isWatched = false;
  } else {
    watched.push({ flight: flightNum, route: route || '', status: currentStatus || '', ts: Date.now() });
    isWatched = true;
    // Show push notification prompt if not yet asked
    const prompted = localStorage.getItem('bb_push_prompted');
    if (!prompted && 'Notification' in window && Notification.permission === 'default') {
      setTimeout(() => {
        document.getElementById('push-prompt').classList.add('show');
        setTimeout(() => document.getElementById('push-prompt').classList.remove('show'), 15000);
      }, 500);
    }
  }
  saveWatchedFlights(watched);
  renderScheduleTable();
  renderWatchPanel();
  updateMarkers();
  // Re-render MY FLIGHTS if that tab is active
  if (document.getElementById('tab-myflight')?.classList.contains('active')) renderMyFlights();
  syncWatchButtons(flightNum, isWatched);
  showWatchNotification(isWatched ? `👁️ Watching ${flightNum}` : `✕ Removed ${flightNum} from watched flights`);
  return isWatched;
}

function syncWatchButtons(flightNum, isWatched) {
  document.querySelectorAll('[data-action="toggle-watch-flight"]').forEach(el => {
    if (el.dataset.flight !== flightNum || el.classList.contains('watch-remove')) return;
    if (!el.classList.contains('watch-btn')) return;

    el.classList.toggle('watching', isWatched);
    el.setAttribute('aria-label', isWatched ? 'Unwatch flight' : 'Watch flight');
    if (el.title) el.title = isWatched ? 'Unwatch this flight' : 'Watch this flight';

    const showLabel = el.closest('.popup-links') || el.closest('.ac-modal-footer');
    el.innerHTML = showLabel
      ? (isWatched ? ICO_WATCHING + ' Watching' : ICO_WATCH + ' Watch')
      : (isWatched ? ICO_WATCHING : ICO_WATCH);
  });
}

function updateWatchBadge() {
  const watched = getWatchedFlights();
  const badge = document.getElementById('watch-badge');
  if (watched.length > 0) {
    badge.style.display = 'block';
    badge.textContent = watched.length;
  } else {
    badge.style.display = 'none';
  }
}

function toggleWatchPanel() {
  const panel = document.getElementById('watch-panel');
  panel.classList.toggle('show');
  const btn = document.getElementById('watch-header-btn');
  if (btn) btn.setAttribute('aria-expanded', panel.classList.contains('show') ? 'true' : 'false');
  renderWatchPanel();
}

function renderWatchPanel() {
  const watched = getWatchedFlights();
  const list = document.getElementById('watch-panel-list');
  if (watched.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ua-muted);font-size:10px">No watched flights<br>Click the watch icon on any flight to track it</div>';
    return;
  }
  list.innerHTML = watched.map(w => `<div class="watch-flight-item">
    <div class="watch-flight-info"><span class="wf-num">${escapeHtml(w.flight)}</span> <span class="wf-route">${escapeHtml(w.route)}</span></div>
    <div style="display:flex;align-items:center;gap:4px"><span class="watch-flight-status" style="font-size:9px;color:var(--ua-muted)">${escapeHtml(w.status)}</span><button class="watch-remove" data-action="toggle-watch-flight" data-flight="${escapeHtml(w.flight)}" data-stop-prop="1" aria-label="Remove watched flight" title="Remove">✕</button></div>
  </div>`).join('');
}

function clearAllWatched() {
  saveWatchedFlights([]);
  renderWatchPanel();
  renderScheduleTable();
}

// ═══ MY FLIGHTS DASHBOARD ═══
let myFlightsInterval = null;
let myFlightsCountdownInterval = null;
let myFlightsTimeData = {};
let myFlightsRenderToken = 0;
// F008: consecutive flight-times failures per watched flight. After a few misses
// (all tiers dark for this number) the card shows a terminal "status unavailable"
// state instead of re-rendering "LOADING…" on every 30s poll forever. Reset to 0
// on any successful fetch so a recovered feed clears the terminal state.
let myFlightsFailCount = {};
const MY_FLIGHTS_FAIL_TERMINAL = 2;

function getMyFlightCacheJitter(flightNumber) {
  return (flightNumber || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 20000;
}

function getMyFlightTimeCacheTTL(flightNumber, timeData) {
  const jitter = getMyFlightCacheJitter(flightNumber);
  if (!timeData || timeData.success === false) return 30000 + jitter;

  const status = resolveFlightStatus(timeData, null);
  if (status === 'cancelled' || status === 'diverted' || status === 'landed') {
    return 300000 + jitter;
  }

  const departureTime = timeData.departure?.gate?.estimated || timeData.departure?.gate?.scheduled;
  const departureMs = departureTime ? new Date(departureTime).getTime() : null;
  if (departureMs && departureMs - Date.now() < 90 * 60000) return 45000 + jitter;
  if (departureMs && departureMs - Date.now() < 6 * 60 * 60 * 1000) return 60000 + jitter;
  return 120000 + jitter;
}

async function renderMyFlights() {
  const renderToken = ++myFlightsRenderToken;
  const flights = getWatchedFlights();
  const container = document.getElementById('myflight-cards');
  const empty = document.getElementById('myflight-empty');
  const connCheck = document.getElementById('myflight-check');
  if (!container) return;

  if (connCheck) connCheck.style.display = '';
  if (!flights.length) {
    empty.style.display = '';
    container.innerHTML = '';
    document.getElementById('myflight-connection-risk').innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  // Fetch ALL data sources in parallel — weather+FAA, IROPS+OTP, and per-flight times.
  // This ensures computeDelayRisk() has real weather, FAA programs, IROPS, and OTP data
  // before scoring. Zero extra latency since everything runs concurrently.
  const flightTimePromises = flights.map(w => {
    const cacheKey = 'mf_' + w.flight;
    const cached = myFlightsTimeData[cacheKey];
    if (cached && Date.now() - cached.ts < getMyFlightTimeCacheTTL(w.flight, cached.data)) {
      return Promise.resolve(cached.data);
    }
    return fetch('/api/flight-times?flight=' + encodeURIComponent(w.flight))
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) { myFlightsTimeData[cacheKey] = { data: d, ts: Date.now() }; myFlightsFailCount[w.flight] = 0; }
        else { myFlightsFailCount[w.flight] = (myFlightsFailCount[w.flight] || 0) + 1; }
        return d;
      })
      .catch(() => { myFlightsFailCount[w.flight] = (myFlightsFailCount[w.flight] || 0) + 1; return cached ? cached.data : null; });
  });

  const allResults = await Promise.allSettled([
    preloadWeatherAndFAA(),     // → populates weatherOpsByHub, faaDelayIndex
    fetchIropsFromAPI(),       // → populates iropsHubData, hubHealthData
    ...flightTimePromises,      // → per-flight schedule/gate/time data
  ]);

  // First 2 results are weather+IROPS (void), rest are flight times
  const timeData = allResults.slice(2).map(r => r.status === 'fulfilled' ? r.value : null);
  if (renderToken !== myFlightsRenderToken) return;

  container.innerHTML = flights.map((w, i) => buildMyFlightCard(w, timeData[i])).join('');
  detectAndRenderConnections(flights, timeData);
  fetchStarlinkPredictions();

  // Fetch aircraft journey chains for watched flights, then re-render cards
  // with inbound data factored into risk scores (Signal 7)
  const journeyPromises = flights.map((w, i) => {
    const td2 = timeData[i];
    // F001: flight-times returns the real tail in `registration` now (`aircraft`
    // is the human-readable TYPE string). Deriving a "reg" from the type used to
    // fail aircraft-history's /^[A-Z0-9]{4,8}$/ and killed the journey chain.
    const reg2 = td2 ? (td2.registration || '').replace('-', '') : null;
    if (!reg2) return Promise.resolve();
    const route2 = (w.route || '').split(/[→\-]/);
    return fetchAircraftJourney(reg2, w.flight, (route2[0] || '').trim(), (route2[1] || '').trim());
  });
  Promise.allSettled(journeyPromises).then(() => {
    if (renderToken !== myFlightsRenderToken) return;
    // Re-render cards now that journey data populates aircraftJourneyCache
    // and allFlights inbound detection works for Signal 7 scoring
    if (container && document.getElementById('tab-myflight')?.classList.contains('active')) {
      container.innerHTML = flights.map((w, i) => buildMyFlightCard(w, timeData[i])).join('');
      detectAndRenderConnections(flights, timeData);
      // F045/F053: the innerHTML rebuild recreates every "⚡ Checking…" placeholder.
      // Re-run predictions so already-resolved badges re-apply instantly from
      // starlinkPredictionCache and unresolved ones re-fetch — otherwise the badge
      // was wiped back to "Checking…" forever on the very next render.
      fetchStarlinkPredictions();
    }
  });

  // Start countdown ticker
  if (myFlightsCountdownInterval) clearInterval(myFlightsCountdownInterval);
  myFlightsCountdownInterval = setInterval(updateMyFlightsCountdowns, 1000);
}

function resolveFlightStatus(td, liveFlight) {
  if (!td || td.success === false) return '';
  if (td.cancelled) return 'cancelled';
  if (td.diverted) return 'diverted';
  const st = (td.status || '').toLowerCase();
  if (st.includes('land') || st.includes('arrived')) return 'landed';
  if (st.includes('en-route') || st.includes('en route') || st.includes('airborne') ||
      st.includes('in air') || st.includes('active') || st.includes('in flight')) return 'en-route';
  if (st.includes('depart') || st.includes('taxiing')) return 'departed';
  if (st.includes('delay')) return 'delayed';
  // Cross-reference with live FR24 feed data
  if (liveFlight && !liveFlight.onGround) return 'en-route';
  if (liveFlight && liveFlight.onGround) {
    const hasActualDep = td.departure?.takeoff?.actual || td.departure?.gate?.actual;
    if (hasActualDep) return 'landed';
  }
  // Detect delay from time comparison (estimated vs scheduled gate departure)
  const schedDep = td.departure?.gate?.scheduled;
  const estDep = td.departure?.gate?.estimated;
  if (schedDep && estDep) {
    const diffMin = (new Date(estDep) - new Date(schedDep)) / 60000;
    if (diffMin >= 15) return 'delayed';
  }
  return 'scheduled';
}

// ═══ AIRCRAFT JOURNEY CHAIN ═══

function buildJourneyChainHtml(reg, segments, myFlight, origCode, destCode) {
  // Filter out our own flight, show prior segments (most recent last for visual timeline)
  const priorSegs = segments
    .filter(s => s.flightNumber !== myFlight)
    .slice(0, 3)
    .reverse(); // chronological order (oldest first)

  if (!priorSegs.length) return '';

  let html = '<div class="mf-journey">';
  html += '<div class="mf-journey-title">Aircraft Journey (' + escapeHtml(reg) + ')</div>';

  priorSegs.forEach(function(seg) {
    var delay = seg.delayMin;
    var delayCls = delay === null ? '' : delay <= 5 ? 'on-time' : delay <= 45 ? 'minor' : 'major';
    var delayText = delay === null ? '' : delay <= 0 ? 'On time' : '+' + delay + 'min';
    var statusLower = (seg.status || '').toLowerCase();
    var isAirborne = statusLower === 'en-route' || statusLower === 'airborne' || statusLower === 'en route';
    var isLanded = statusLower === 'landed' || statusLower === 'arrived';
    var segCls = isAirborne ? 'airborne' : isLanded ? 'landed' : '';
    var statusText = isAirborne ? 'Airborne' : isLanded ? 'Landed' : seg.status || '';

    html += '<div class="mf-journey-seg ' + segCls + '">';
    html += '<span class="mf-journey-flt">' + escapeHtml(seg.flightNumber) + '</span>';
    html += '<span class="mf-journey-route">' + escapeHtml(seg.origin) + ' \u2192 ' + escapeHtml(seg.destination) + '</span>';
    if (delayText) html += '<span class="mf-journey-delay ' + delayCls + '">' + escapeHtml(delayText) + '</span>';
    html += '<span class="mf-journey-status">' + escapeHtml(statusText) + '</span>';
    html += '</div>';
  });

  // Show current flight at the bottom
  html += '<div class="mf-journey-seg current">';
  html += '<span class="mf-journey-flt">' + escapeHtml(myFlight) + '</span>';
  html += '<span class="mf-journey-route">' + escapeHtml(origCode) + ' \u2192 ' + escapeHtml(destCode) + '</span>';
  html += '<span class="mf-journey-delay">Your flight</span>';
  html += '</div>';

  html += '</div>';
  return html;
}

function buildJourneyContextStr(reg, segments, myFlight, origCode, destCode) {
  var priorSegs = segments
    .filter(function(s) { return s.flightNumber !== myFlight; })
    .slice(0, 3)
    .reverse();

  if (!priorSegs.length) return '';

  var lines = ['Aircraft ' + reg + ' journey today:'];
  priorSegs.forEach(function(seg, i) {
    var delay = seg.delayMin;
    var delayStr = delay === null ? 'unknown delay' : delay <= 0 ? 'on time' : 'departed ' + delay + 'min late';
    var statusLower = (seg.status || '').toLowerCase();
    var statusStr = statusLower === 'en-route' || statusLower === 'airborne' || statusLower === 'en route'
      ? ', currently airborne'
      : statusLower === 'landed' || statusLower === 'arrived' ? ', landed' : '';
    lines.push('Seg ' + (i + 1) + ': ' + seg.flightNumber + ' ' + seg.origin + '\u2192' + seg.destination + ', ' + delayStr + statusStr);
  });

  // Summary
  var delays = priorSegs.map(function(s) { return s.delayMin; }).filter(function(d) { return d !== null && d > 0; });
  if (delays.length > 0) {
    var avg = Math.round(delays.reduce(function(a, b) { return a + b; }, 0) / delays.length);
    lines.push('Your flight ' + myFlight + ' ' + origCode + '\u2192' + destCode + ' \u2014 aircraft averaging +' + avg + 'min delays across ' + delays.length + ' prior segment' + (delays.length > 1 ? 's' : ''));
  }

  return lines.join('\n');
}

async function fetchAircraftJourney(reg, myFlight, origCode, destCode) {
  if (!reg) return;

  // Replace a stuck "Loading aircraft journey…" placeholder with a graceful
  // unavailable state. Guarded on .mf-journey-loading so it never clobbers a
  // live "Where's My Plane?" inbound card already rendered for this tail.
  function showJourneyUnavailable() {
    var el = document.getElementById('journey-' + reg);
    if (el && el.querySelector('.mf-journey-loading')) {
      el.innerHTML = '<div class="mf-journey-loading">Flight history unavailable</div>';
    }
  }

  // Check cache
  var cached = aircraftJourneyCache[reg];
  if (cached && Date.now() - cached.ts < 300000) return; // 5min TTL

  try {
    var resp = await fetch('/api/aircraft-history?reg=' + encodeURIComponent(reg));
    if (!resp.ok) {
      // Upstream error (e.g. FR24 502 / credit-blocked): cache an empty marker so
      // the post-fetch re-render renders the graceful state instead of rebuilding
      // a perpetual loading line, and update the live placeholder now.
      aircraftJourneyCache[reg] = { segments: [], ts: Date.now() };
      showJourneyUnavailable();
      return;
    }
    var data = await resp.json();
    if (!data.success || !data.segments) {
      aircraftJourneyCache[reg] = { segments: [], ts: Date.now() };
      showJourneyUnavailable();
      return;
    }

    aircraftJourneyCache[reg] = { segments: data.segments, ts: Date.now() };

    // Update the journey chain UI in the card
    var container = document.getElementById('journey-' + reg);
    if (container && data.segments.length > 0) {
      container.innerHTML = buildJourneyChainHtml(reg, data.segments, myFlight, origCode, destCode);

      // Also update the data-inbound attribute on any risk badges/buttons for this flight
      var richInbound = buildJourneyContextStr(reg, data.segments, myFlight, origCode, destCode);
      if (richInbound) {
        document.querySelectorAll('[data-action="explain-delay"][data-flight="' + myFlight + '"]').forEach(function(el) {
          el.dataset.inbound = richInbound;
        });
      }
    } else if (container) {
      // Lookup succeeded but no recent segments — surface the graceful state
      // (matches the failed-fetch path) instead of leaving an empty section.
      showJourneyUnavailable();
    }
  } catch (e) {
    // Network/parse failure — cache an empty marker and replace the loading
    // placeholder with the graceful state (journey chain is supplementary).
    aircraftJourneyCache[reg] = { segments: [], ts: Date.now() };
    showJourneyUnavailable();
  }
}

function buildMyFlightCard(watched, td) {
  const flightNum = escapeHtml(watched.flight);
  const routeParts = (watched.route || '').split(/[→\-]/);
  // Resolve origin/destination: prefer stored route, fall back to timeData API response
  const origCode = (routeParts[0] || '').trim() || (td?.origin?.iata) || '';
  const destCode = (routeParts[1] || '').trim() || (td?.destination?.iata) || '';
  const origCity = IATA_CITIES[origCode] || origCode;
  const destCity = IATA_CITIES[destCode] || destCode;

  // Backfill watched.route if it was empty/missing (manual search or deep link)
  if (origCode && destCode && (!watched.route || watched.route.includes('?'))) {
    watched.route = origCode + '→' + destCode;
    saveWatchedFlights(getWatchedFlights().map(w => w.flight === watched.flight ? { ...w, route: watched.route } : w));
  }

  // Resolve live flight early — needed for status detection and equipment
  const liveFlight = allFlights.find(f => f.flightIATA === watched.flight || f.callsign === 'UAL' + watched.flight.replace(/\D/g,''));

  // Status + countdown
  let statusHtml = '', countdownHtml = '', countdownClass = '';
  const resolvedStatus = td ? resolveFlightStatus(td, liveFlight) : '';
  if (td && td.success !== false) {
    const depTime = td.departure?.gate?.estimated || td.departure?.gate?.scheduled;
    const arrTime = td.arrival?.gate?.estimated || td.arrival?.gate?.scheduled
      || td.arrival?.landing?.estimated || td.arrival?.landing?.scheduled;

    switch (resolvedStatus) {
      case 'cancelled':
        statusHtml = '<span class="mf-status" style="background:rgba(239,68,68,.2);color:var(--ua-red)">CANCELLED</span>';
        countdownClass = 'landed';
        break;
      case 'diverted':
        statusHtml = '<span class="mf-status" style="background:rgba(249,115,22,.2);color:#f97316">DIVERTED</span>';
        countdownClass = 'landed';
        break;
      case 'landed':
        statusHtml = '<span class="mf-status" style="background:rgba(34,197,94,.2);color:var(--ua-green)">LANDED</span>';
        countdownHtml = 'Landed';
        countdownClass = 'landed';
        break;
      case 'en-route':
        statusHtml = '<span class="mf-status" style="background:var(--ua-blue-soft);color:var(--ua-accent)">EN ROUTE</span>';
        if (arrTime) {
          const eta = new Date(arrTime);
          const diff = eta - Date.now();
          countdownHtml = diff > 0 ? formatCountdown(diff) + ' to arrival' : 'Arriving';
        }
        countdownClass = 'departed';
        break;
      case 'departed':
        statusHtml = '<span class="mf-status" style="background:rgba(34,197,94,.2);color:var(--ua-green)">DEPARTED</span>';
        countdownClass = 'departed';
        if (arrTime) {
          const eta = new Date(arrTime);
          const diff = eta - Date.now();
          countdownHtml = diff > 0 ? formatCountdown(diff) + ' to arrival' : 'Arriving';
        }
        break;
      case 'delayed':
        statusHtml = '<span class="mf-status" style="background:rgba(245,158,11,.2);color:var(--ua-yellow)">DELAYED</span>';
        if (depTime) {
          const dep = new Date(depTime);
          const diff = dep - Date.now();
          countdownHtml = diff > 0 ? formatCountdown(diff) + ' to departure' : 'Expected to depart';
        }
        countdownClass = '';
        break;
      default:
        statusHtml = '<span class="mf-status" style="background:rgba(107,170,237,.15);color:var(--ua-accent)">SCHEDULED</span>';
        if (depTime) {
          const dep = new Date(depTime);
          const diff = dep - Date.now();
          if (diff > 0) {
            const boardDiff = diff - 30 * 60000;
            countdownHtml = boardDiff > 0 ? formatCountdown(boardDiff) + ' to boarding' : formatCountdown(diff) + ' to departure';
          } else {
            countdownHtml = 'Expected to depart';
          }
        }
        break;
    }
  } else {
    // F008: after repeated all-tier failures for this flight, stop re-rendering an
    // eternal "LOADING…" and show a terminal, honest state. The 30s poll keeps
    // retrying silently, so a recovered feed still flips it back automatically.
    const failed = (myFlightsFailCount[watched.flight] || 0) >= MY_FLIGHTS_FAIL_TERMINAL;
    statusHtml = failed
      ? '<span class="mf-status" style="background:rgba(100,116,139,.2);color:var(--ua-muted)">STATUS UNAVAILABLE</span>'
      : '<span class="mf-status" style="background:rgba(100,116,139,.2);color:var(--ua-muted)">LOADING...</span>';
  }

  // F008: terminal-state body note (only when the loading state has given up).
  let unavailableNote = '';
  if (!(td && td.success !== false) && (myFlightsFailCount[watched.flight] || 0) >= MY_FLIGHTS_FAIL_TERMINAL) {
    unavailableNote = `<div class="mf-unavailable" style="font-size:11px;color:var(--ua-muted);padding:2px 0">Live status is unavailable right now — check <a href="https://www.united.com" target="_blank" rel="noopener noreferrer" style="color:var(--ua-accent)">united.com</a> for the latest. We'll keep retrying.</div>`;
  }

  // Gate info
  let gateHtml = '';
  if (td && td.success !== false) {
    const oIata = td.origin?.iata || '';
    const dIata = td.destination?.iata || '';
    const oTerm = td.origin?.terminal || getUnitedTerminal(oIata, oIata, dIata);
    const dTerm = td.destination?.terminal || getUnitedTerminal(dIata, oIata, dIata);
    const oGate = td.origin?.gate ? `T${oTerm || '?'} Gate ${td.origin.gate}` : (oTerm ? `T${oTerm}` : '—');
    const dGate = td.destination?.gate ? `T${dTerm || '?'} Gate ${td.destination.gate}` : (dTerm ? `T${dTerm}` : '—');
    gateHtml = `<div class="mf-grid">
      <div><span class="mf-label">Origin Gate</span><div class="mf-value">${escapeHtml(oGate)}</div></div>
      <div><span class="mf-label">Dest Gate</span><div class="mf-value">${escapeHtml(dGate)}</div></div>
    </div>`;
  }

  // Equipment
  let equipHtml = '';
  // F001: prefer the live-feed tail, then the flight-times `registration` field.
  // `td.aircraft` is the TYPE string (displayed below) — never a tail.
  const reg = liveFlight ? liveFlight.reg?.replace('-','') : (td && td.registration ? td.registration.replace('-','') : null);
  if (reg && FLEET_BY_REG[reg]) {
    const ac = FLEET_BY_REG[reg];
    const isStar = STARLINK_TAILS.has(reg);
    const seatStr = ac.seats ? Object.entries(ac.seats).map(([cls,cnt]) => cnt + cls).join('/') : (ac.c || '');
    equipHtml = `<div class="mf-grid">
      <div><span class="mf-label">Aircraft</span><div class="mf-value">${escapeHtml(ac.t)} <span class="ac-reg-link" data-action="aircraft-detail" data-reg="${escapeHtml(reg)}" style="font-size:10px">${escapeHtml(reg)}</span></div></div>
      <div><span class="mf-label">Config</span><div class="mf-value">${escapeHtml(seatStr)}${isStar ? ' <span class="starlink-badge">⚡ Starlink Confirmed</span>' : ` <span class="starlink-badge starlink-predict" data-flight="${escapeHtml(flightNum)}" style="background:rgba(100,116,139,.15);color:var(--ua-muted)">⚡ Checking…</span>`}</div></div>
    </div>`;
  } else if (td && td.aircraft) {
    // No resolvable tail here (e.g. future-dated lookups): we know the route but not
    // the metal, so STARLINK_TAILS can't confirm and a route base-rate is the right
    // signal. Surface a statistical forecast badge instead of leaving Starlink blank.
    // data-mode="forecast" routes it to the date-agnostic predict-flight model in
    // fetchStarlinkPredictions(); it hides itself if the model has no useful estimate.
    const forecastBadge = (flightNum && flightNum !== 'N/A')
      ? ` <span class="starlink-badge starlink-predict" data-flight="${escapeHtml(flightNum)}" data-mode="forecast" style="background:rgba(100,116,139,.15);color:var(--ua-muted)">⚡ Checking…</span>`
      : '';
    // F001 graceful degradation: state honestly that the specific tail isn't known
    // yet (rather than implying a fake lookup) when no registration resolved.
    const noTailNote = reg ? '' : '<div style="font-size:9px;color:var(--ua-dim);margin-top:2px">Tail not yet assigned</div>';
    equipHtml = `<div><span class="mf-label">Aircraft</span><div class="mf-value">${escapeHtml(td.aircraft)}${forecastBadge}</div>${noTailNote}</div>`;
  }

  // Inbound aircraft tracking + journey chain
  let inboundHtml = '';
  let inboundStr = '';
  if (reg) {
    // Find this registration operating a DIFFERENT flight heading to our origin (only when our flight isn't airborne)
    var inbound = null;
    if (!(liveFlight && !liveFlight.onGround)) {
      inbound = allFlights.find(f => f.reg?.replace('-','') === reg && f.flightIATA !== watched.flight && f.dest === origCode && !f.onGround);
      if (inbound) {
        const inbCity = IATA_CITIES[inbound.origin] || inbound.origin;
        inboundStr = inbound.flightIATA + ' from ' + inbCity + ' (' + inbound.origin + '), airborne';
      }
    }
    // Check if we already have cached journey data for richer inbound context
    const cached = aircraftJourneyCache[reg];
    const cacheFresh = cached && Date.now() - cached.ts < 300000;
    if (cacheFresh && cached.segments && cached.segments.length > 0) {
      inboundHtml = buildJourneyChainHtml(reg, cached.segments, watched.flight, origCode, destCode);
      inboundStr = buildJourneyContextStr(reg, cached.segments, watched.flight, origCode, destCode);
    } else if (inbound) {
      const inbCity = IATA_CITIES[inbound.origin] || inbound.origin;
      inboundHtml = `<div class="mf-inbound">
        <div class="mf-inbound-title">Where's My Plane?</div>
        Your aircraft is currently operating <strong>${escapeHtml(inbound.flightIATA)}</strong> from ${escapeHtml(inbCity)} (${escapeHtml(inbound.origin)}) \u2192 ${escapeHtml(origCity)} (${escapeHtml(origCode)}) at ${Math.round(inbound.alt * 3.28084).toLocaleString()}ft
      </div>`;
    }
    // Async journey chain slot. While the history fetch is still pending (no fresh
    // cache yet) show a loading line; once it has completed but produced nothing
    // usable \u2014 upstream error or no recent segments \u2014 show a graceful unavailable
    // state instead of a perpetual "Loading\u2026" line. (The fetch won't re-run until
    // the 5-min TTL, and the post-fetch re-render rebuilds this card from cache.)
    if (!inboundHtml && reg) {
      const journeyBody = cacheFresh
        ? '<div class="mf-journey-loading">Flight history unavailable</div>'
        : '<div class="mf-journey-loading">Loading aircraft journey\u2026</div>';
      inboundHtml = `<div class="mf-journey" id="journey-${escapeHtml(reg)}">${journeyBody}</div>`;
    } else if (inboundHtml && reg) {
      // Wrap existing html with an ID for async update
      inboundHtml = `<div id="journey-${escapeHtml(reg)}">${inboundHtml}</div>`;
    }
  }

  // Delay risk — pass timeData and liveFlight for multi-signal scoring.
  // Never default to LOW on missing inputs (audit Jul 3 2026: card said LOW while
  // the board said V.HIGH for the same flight, purely because the flight-times
  // feed was dark). When the card lacks the inputs the board's risk had, reuse
  // the board's computed score if the flight is on a loaded board; otherwise
  // show an explicit "RISK N/A".
  let riskHtml = '';
  const hasRiskInputs = !!(td && td.success !== false && (td.departure?.gate?.scheduled || td.departure?.gate?.estimated));
  let risk = null;
  let riskNA = false;
  if (hasRiskInputs) {
    risk = computeDelayRisk(watched, origCode, destCode, td, liveFlight);
  } else {
    risk = findBoardRiskForFlight(watched.flight);
    if (!risk) riskNA = true;
  }
  const riskOtp = hubHealthData[origCode];
  const riskWx = weatherOpsByHub[origCode];
  const riskWxDest = weatherOpsByHub[destCode];
  const riskIrops = iropsHubData[origCode];
  const riskIropsStr = iropsContextStr(riskIrops);
  const riskFaaStatus = formatDelayExplainFAAStatus(origCode, destCode, faaDelayIndex);
  const riskConn = connectionIndex[flightNum];
  const riskConnStr = riskConn ? (riskConn.isOutbound
    ? 'Connecting from ' + riskConn.connFlight + ' via ' + riskConn.hub + ', ' + riskConn.minutes + 'min layover (' + riskConn.risk + ')'
    : 'Connects to ' + riskConn.connFlight + ' ' + riskConn.hub + '\u2192' + (riskConn.dest || '?') + ', ' + riskConn.minutes + 'min layover (' + riskConn.risk + ')') : '';
  if (risk && (resolvedStatus === 'scheduled' || resolvedStatus === 'delayed' || resolvedStatus === '' || !resolvedStatus)) {
    riskHtml = `<span class="delay-risk-badge" data-action="explain-delay" data-flight="${flightNum}" data-route="${escapeHtml(origCode + '\u2192' + destCode)}" data-status="${escapeHtml(resolvedStatus || 'scheduled')}" data-risk-label="${risk.label}" data-risk-score="${risk.score}" data-risk-factors="${escapeHtml(risk.factors.join('|'))}" data-hub="${escapeHtml(origCode)}"${riskOtp !== undefined ? ' data-otp="' + riskOtp + '"' : ''}${riskWx ? ' data-weather="' + escapeHtml(riskWx.level + (riskWx.reasons.length ? ': ' + riskWx.reasons.join(', ') : '')) + '"' : ''}${riskWxDest ? ' data-dest-weather="' + escapeHtml(riskWxDest.level + (riskWxDest.reasons.length ? ': ' + riskWxDest.reasons.join(', ') : '')) + '"' : ''}${riskIropsStr ? ' data-irops="' + escapeHtml(riskIropsStr) + '"' : ''}${riskFaaStatus ? ' data-faa-status="' + escapeHtml(riskFaaStatus) + '"' : ''}${riskConnStr ? ' data-connection="' + escapeHtml(riskConnStr) + '"' : ''}${inboundStr ? ' data-inbound="' + escapeHtml(inboundStr) + '"' : ''} style="background:${risk.color}20;color:${risk.color};cursor:pointer" title="Click for AI analysis">${risk.label} RISK</span>`;
  } else if (riskNA && (resolvedStatus === 'scheduled' || resolvedStatus === 'delayed' || resolvedStatus === '' || !resolvedStatus)) {
    riskHtml = `<span class="delay-risk-badge" style="background:rgba(100,116,139,.15);color:var(--ua-muted);cursor:default" title="Not enough live data to score this flight">RISK N/A</span>`;
  }

  // Departure/arrival time data attributes for countdown timer
  const depISO = td?.departure?.gate?.estimated || td?.departure?.gate?.scheduled || '';
  const arrISO = td?.arrival?.gate?.estimated || td?.arrival?.gate?.scheduled
    || td?.arrival?.landing?.estimated || td?.arrival?.landing?.scheduled || '';
  const statusKey = resolvedStatus || '';

  return `<div class="mf-card" data-mf-dep="${escapeHtml(depISO)}" data-mf-arr="${escapeHtml(arrISO)}" data-mf-status="${escapeHtml(statusKey)}">
    <div class="mf-card-header">
      <div>
        <div class="mf-flight-num">${flightNum}</div>
        <div class="mf-route">${escapeHtml(origCity)} (${escapeHtml(origCode)}) → ${escapeHtml(destCity)} (${escapeHtml(destCode)})</div>
      </div>
      <div style="text-align:right">
        <div class="mf-countdown ${countdownClass}" data-mf-countdown>${countdownHtml}</div>
        <div style="margin-top:4px">${statusHtml} ${riskHtml}</div>
      </div>
    </div>
    <div class="mf-body">
      ${unavailableNote}
      ${gateHtml}
      ${equipHtml}
      ${inboundHtml}
    </div>
    <div class="mf-actions">
      ${liveFlight ? `<button data-action="focus-flight" data-icao24="${escapeHtml(liveFlight.icao24)}">View on Map</button>` : ''}
      ${reg ? `<button data-action="aircraft-detail" data-reg="${escapeHtml(reg)}">Aircraft Details</button>` : ''}
      ${risk ? `<button class="delay-explain-btn" data-action="explain-delay" data-flight="${flightNum}" data-route="${escapeHtml(origCode + '\u2192' + destCode)}" data-status="${escapeHtml(resolvedStatus || 'scheduled')}" data-risk-label="${risk.label}" data-risk-score="${risk.score}" data-risk-factors="${escapeHtml(risk.factors.join('|'))}" data-hub="${escapeHtml(origCode)}"${riskOtp !== undefined ? ' data-otp="' + riskOtp + '"' : ''}${riskWx ? ' data-weather="' + escapeHtml(riskWx.level + (riskWx.reasons.length ? ': ' + riskWx.reasons.join(', ') : '')) + '"' : ''}${riskWxDest ? ' data-dest-weather="' + escapeHtml(riskWxDest.level + (riskWxDest.reasons.length ? ': ' + riskWxDest.reasons.join(', ') : '')) + '"' : ''}${riskIropsStr ? ' data-irops="' + escapeHtml(riskIropsStr) + '"' : ''}${riskFaaStatus ? ' data-faa-status="' + escapeHtml(riskFaaStatus) + '"' : ''}${riskConnStr ? ' data-connection="' + escapeHtml(riskConnStr) + '"' : ''}${inboundStr ? ' data-inbound="' + escapeHtml(inboundStr) + '"' : ''}>Explain Delay Risk</button>` : ''}
      <button data-action="toggle-watch-flight" data-flight="${flightNum}" data-route="${escapeHtml(watched.route)}" data-status="${escapeHtml(watched.status)}" data-stop-prop="1">Unwatch</button>
    </div>
  </div>`;
}

function formatCountdown(ms) {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

function updateMyFlightsCountdowns() {
  document.querySelectorAll('.mf-card[data-mf-dep]').forEach(card => {
    const el = card.querySelector('[data-mf-countdown]');
    if (!el) return;
    const st = card.dataset.mfStatus || '';
    if (st === 'cancelled' || st === 'diverted') return;
    const isLanded = st === 'landed';
    const isEnRoute = st === 'en-route';
    const isDeparted = st === 'departed';

    if (isLanded) { el.textContent = 'Landed'; return; }

    if (isEnRoute || isDeparted) {
      const arr = card.dataset.mfArr;
      if (arr) {
        const diff = new Date(arr) - Date.now();
        el.textContent = diff > 0 ? formatCountdown(diff) + ' to arrival' : 'Arriving';
      }
      return;
    }

    // Scheduled: countdown to boarding (30 min before departure)
    const dep = card.dataset.mfDep;
    if (dep) {
      const depTime = new Date(dep);
      const diff = depTime - Date.now();
      if (diff > 0) {
        const boardDiff = diff - 30 * 60000;
        el.textContent = boardDiff > 0 ? formatCountdown(boardDiff) + ' to boarding' : formatCountdown(diff) + ' to departure';
      } else {
        el.textContent = 'Expected to depart';
      }
    }
  });
}

// ═══ DELAY RISK ENGINE v4 — Shared Scoring Model ═══

function buildInboundRiskContext(reg, currentFlightNumber, originHub, allowInbound) {
  const journey = reg && aircraftJourneyCache[reg] && aircraftJourneyCache[reg].segments
    ? aircraftJourneyCache[reg]
    : null;

  if (!allowInbound || !reg || typeof allFlights === 'undefined') {
    return { inboundFlight: null, aircraftJourney: journey };
  }

  const inbound = allFlights.find(function(flight) {
    return flight.reg
      && flight.reg.replace('-', '') === reg
      && flight.flightIATA !== currentFlightNumber
      && flight.dest === originHub
      && !flight.onGround;
  });

  if (!inbound) {
    return { inboundFlight: null, aircraftJourney: journey };
  }

  const inboundWeather = weatherOpsByHub[inbound.origin] || null;
  const inboundFaa = faaDelayIndex[inbound.origin] || null;

  return {
    inboundFlight: {
      origin: inbound.origin,
      lat: inbound.lat,
      lon: inbound.lon,
      spd: inbound.spd,
      alt: inbound.alt,
      vr: inbound.vr,
      acType: inbound.acType,
      originWeatherLevel: inboundWeather ? inboundWeather.level : '',
      originFaaGroundStop: !!(inboundFaa && inboundFaa.groundStop),
      originFaaGroundDelay: !!(inboundFaa && inboundFaa.groundDelay),
    },
    aircraftJourney: journey,
  };
}

function computeDelayRisk(watched, origHub, destHub, timeData, liveFlight) {
  // F001: the inbound-turnaround signal keys on the real tail (registration), not
  // the aircraft TYPE string — otherwise Signal 7 could never match a live-feed tail.
  const reg = timeData && timeData.registration ? timeData.registration.replace('-', '') : '';
  const allowInbound = !!(timeData && !(liveFlight && !liveFlight.onGround));
  const inboundContext = buildInboundRiskContext(reg, watched.flight, origHub, allowInbound);

  return computeDelayRiskModel({
    currentFlightNumber: watched.flight,
    nowMs: Date.now(),
    scheduledTime: timeData?.departure?.gate?.scheduled || timeData?.departure?.gate?.estimated || '',
    comparisonTime: timeData?.departure?.gate?.estimated || timeData?.departure?.gate?.actual || '',
    originHub: origHub,
    destinationHub: destHub,
    originFaa: faaDelayIndex[origHub],
    destinationFaa: faaDelayIndex[destHub],
    originWeather: weatherOpsByHub[origHub],
    destinationWeather: weatherOpsByHub[destHub],
    originOtp: hubHealthData[origHub],
    timeZone: SCHED_HUB_TZ[origHub] || 'America/Chicago',
    inboundFlight: inboundContext.inboundFlight,
    originCoordinates: HUB_COORDINATES[origHub],
    aircraftJourney: inboundContext.aircraftJourney,
    hubProfile: HUB_RISK_PROFILES[origHub],
    originIrops: iropsHubData[origHub],
    destinationIrops: iropsHubData[destHub],
    plannedTmis: nasData?.planned || null,
  });
}

function computeDelayRiskForScheduleFlight(fl, hub, nowSec = schedNow(), dir = schedCurrentDir) {
  const { depHub, arrHub } = getScheduleRiskContext(fl, hub, dir);
  const status = classifySchedStatus(fl, dir, nowSec, classifyOptsFor(metaForHubDir(hub, dir)));
  // Only score not-yet-departed flights
  if (status.key !== 'scheduled' && status.key !== 'estimated' && status.key !== 'delayed') return null;

  const schedTime = fl.time?.scheduled?.departure || fl.time?.scheduled?.arrival;
  const estTime = fl.time?.estimated?.departure || fl.time?.estimated?.arrival;
  const actTime = fl.time?.real?.departure || fl.time?.real?.arrival;
  const compTime = actTime || estTime;
  const result = computeDelayRiskModel({
    currentFlightNumber: fl.identification?.number?.default || '',
    nowMs: Date.now(),
    scheduledTime: schedTime || '',
    comparisonTime: compTime || '',
    originHub: depHub,
    destinationHub: arrHub,
    originFaa: faaDelayIndex[depHub],
    destinationFaa: faaDelayIndex[arrHub],
    originWeather: weatherOpsByHub[depHub],
    destinationWeather: weatherOpsByHub[arrHub],
    originOtp: hubHealthData[depHub],
    timeZone: SCHED_HUB_TZ[depHub] || 'America/Chicago',
    originCoordinates: HUB_COORDINATES[depHub],
    hubProfile: HUB_RISK_PROFILES[depHub],
    originIrops: iropsHubData[depHub],
    destinationIrops: iropsHubData[arrHub],
    plannedTmis: nasData?.planned || null,
  });

  return result.score === 0 ? null : result;
}

// Reuse the schedule board's computed risk for a flight when the My Flights card
// lacks the inputs the board had (flight-times feed dark → no scheduledTime →
// the model degenerates to a default LOW that contradicts the board's V.HIGH,
// same flight — audit Jul 3 2026). Scans every loaded board; returns null when
// the flight is on no loaded board.
function findBoardRiskForFlight(flightNum) {
  if (!flightNum) return null;
  for (const [key, flights] of Object.entries(schedRawByHub)) {
    if (!Array.isArray(flights) || !flights.length) continue;
    const parts = key.split('-');
    const boardHub = parts[0];
    const boardDir = parts[1] === 'arrivals' ? 'arrivals' : 'departures';
    const fl = flights.find(f => f.identification?.number?.default === flightNum);
    if (!fl) continue;
    const risk = computeDelayRiskForScheduleFlight(fl, boardHub, schedNow(), boardDir);
    if (risk) return risk;
  }
  return null;
}

// ═══ CONNECTION RISK CALCULATOR ═══
function detectAndRenderConnections(flights, timeDataArray) {
  const connContainer = document.getElementById('myflight-connection-risk');
  if (!connContainer) return;

  const connections = [];
  for (let i = 0; i < flights.length; i++) {
    for (let j = 0; j < flights.length; j++) {
      if (i === j) continue;
      const td1 = timeDataArray[i], td2 = timeDataArray[j];
      if (!td1 || !td2 || td1.success === false || td2.success === false) continue;
      const arrHub = td1.destination?.iata;
      const depHub = td2.origin?.iata;
      if (!arrHub || arrHub !== depHub || !HUB_CODES.includes(arrHub)) continue;
      const arrTime = td1.arrival?.gate?.estimated || td1.arrival?.gate?.scheduled;
      const depTime = td2.departure?.gate?.estimated || td2.departure?.gate?.scheduled;
      if (!arrTime || !depTime) continue;
      const arr = new Date(arrTime), dep = new Date(depTime);
      const diffMin = (dep - arr) / 60000;
      if (diffMin > 0 && diffMin < 480) {
        connections.push({ inbound: { w: flights[i], td: td1 }, outbound: { w: flights[j], td: td2 }, hub: arrHub, minutes: diffMin });
      }
    }
  }

  if (!connections.length) { connContainer.innerHTML = ''; connectionIndex = {}; return; }

  // Build connection index for AI context
  connectionIndex = {};
  connContainer.innerHTML = connections.map(conn => {
    const risk = computeConnectionRisk(conn);
    // Index both flights so the AI knows about the connection
    const inFlt = conn.inbound.w.flight;
    const outFlt = conn.outbound.w.flight;
    const outDest = conn.outbound.td.destination?.iata || '?';
    const inOrig = conn.inbound.td.origin?.iata || '?';
    connectionIndex[inFlt] = { connFlight: outFlt, hub: conn.hub, dest: outDest, minutes: risk.connectionMin, risk: risk.risk, label: risk.label };
    connectionIndex[outFlt] = { connFlight: inFlt, hub: conn.hub, orig: inOrig, minutes: risk.connectionMin, risk: risk.risk, label: risk.label, isOutbound: true };
    return renderConnectionRiskCard(conn, risk);
  }).join('');
}

function computeConnectionRisk(conn) {
  const hub = conn.hub;
  const inTd = conn.inbound.td;
  const outTd = conn.outbound.td;

  const isDomIn = !INTL_AIRPORTS.has(inTd.origin?.iata || '');
  const isDomOut = !INTL_AIRPORTS.has(outTd.destination?.iata || '');
  const mctKey = (isDomIn ? 'd' : 'i') + (isDomOut ? 'd' : 'i');
  const mct = MIN_CONNECTION_TIMES[hub]?.[mctKey] || 60;

  const inTerminal = inTd.destination?.terminal || getUnitedTerminal(hub, inTd.origin?.iata || '', hub) || '?';
  const outTerminal = outTd.origin?.terminal || getUnitedTerminal(hub, hub, outTd.destination?.iata || '') || '?';
  const walkKey = [inTerminal, outTerminal].sort().join('-');
  const walkTime = inTerminal === outTerminal ? 5 : (TERMINAL_WALK_TIMES[hub]?.[walkKey] || TERMINAL_WALK_TIMES[hub]?.default || 10);

  // F003/F055: delegate the verdict to the pure classifier so a cancelled/diverted
  // leg (never SAFE) and missing/NaN gate times (→ "insufficient data", never SAFE)
  // are gated BEFORE any buffer math. `new Date('')`/`new Date(undefined)` → NaN,
  // which classifyConnection treats as insufficient rather than falling through
  // to a green verdict.
  const arrMs = new Date(inTd.arrival?.gate?.estimated || inTd.arrival?.gate?.scheduled).getTime();
  const depMs = new Date(outTd.departure?.gate?.estimated || outTd.departure?.gate?.scheduled).getTime();
  const result = classifyConnection({
    arrMs, depMs, mct, walkTime,
    inboundCancelled: !!inTd.cancelled, outboundCancelled: !!outTd.cancelled,
    inboundDiverted: !!inTd.diverted, outboundDiverted: !!outTd.diverted,
    inboundFlight: conn.inbound?.w?.flight || 'the inbound flight',
    outboundFlight: conn.outbound?.w?.flight || 'the outbound flight',
  });
  return { ...result, inTerminal, outTerminal };
}

function renderConnectionRiskCard(conn, risk) {
  const inFlight = escapeHtml(conn.inbound.w.flight);
  const outFlight = escapeHtml(conn.outbound.w.flight);
  const hub = escapeHtml(conn.hub);
  const hubCity = IATA_CITIES[conn.hub] || conn.hub;
  const inOrig = escapeHtml(conn.inbound.td.origin?.iata || '?');
  const outDest = escapeHtml(conn.outbound.td.destination?.iata || '?');

  // F055: only assert connection/buffer numbers when we actually scored the
  // connection, and label the MCT honestly — MIN_CONNECTION_TIMES is OUR padded
  // comfort guidance, not United's published minimum (which is lower).
  let detailHtml = '';
  if (risk.state === 'scored' && risk.hasData) {
    detailHtml = `<div class="conn-risk-detail">
      ${risk.connectionMin}min connection · ${risk.mct}min comfortable minimum (our conservative guidance — United's published MCT is lower) · T${escapeHtml(risk.inTerminal)} → T${escapeHtml(risk.outTerminal)} (~${risk.walkTime}min walk) · ${risk.buffer}min buffer after walking
    </div>`;
  } else if (risk.state === 'insufficient') {
    detailHtml = `<div class="conn-risk-detail" style="color:var(--ua-muted)">We don't have gate times for one or both legs yet — check united.com for the latest before relying on this connection.</div>`;
  } else if (risk.state === 'disrupted') {
    detailHtml = `<div class="conn-risk-detail" style="color:var(--ua-muted)">A leg is cancelled or diverted — re-book or confirm with United before counting on this connection.</div>`;
  }

  return `<div class="conn-risk-card" style="border-left-color:${risk.color}">
    <div class="conn-risk-header">
      <span class="conn-risk-label">Connection at ${hub} (${escapeHtml(hubCity)})</span>
      <span class="conn-risk-badge" style="background:${risk.color}20;color:${risk.color}">${escapeHtml(risk.risk)}</span>
    </div>
    <div class="conn-risk-flights">
      <div>${inFlight} ${inOrig} → <strong>${hub}</strong> &nbsp; Arrives → walks → departs</div>
      <div>${outFlight} <strong>${hub}</strong> → ${outDest}</div>
    </div>
    ${detailHtml}
    <div style="margin-top:6px;font-size:10px;color:${risk.color}">${escapeHtml(risk.label)}</div>
  </div>`;
}

async function checkManualConnection() {
  const inFlt = (document.getElementById('conn-inbound')?.value || '').trim().toUpperCase().replace(/\s+/g, '');
  const outFlt = (document.getElementById('conn-outbound')?.value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!inFlt || !outFlt) return;

  const resultEl = document.getElementById('conn-manual-result');
  if (!resultEl) return;
  resultEl.innerHTML = '<div style="color:var(--ua-muted);font-size:10px">Checking...</div>';

  const normalize = f => f.startsWith('UA') ? f : 'UA' + f.replace(/^UAL?/i, '');
  try {
    const [r1, r2] = await Promise.all([
      fetch('/api/flight-times?flight=' + encodeURIComponent(normalize(inFlt))).then(r => r.ok ? r.json() : null),
      fetch('/api/flight-times?flight=' + encodeURIComponent(normalize(outFlt))).then(r => r.ok ? r.json() : null)
    ]);
    // r===null means the HTTP request itself failed (404/5xx). Right now the flight-times feed is
    // dark for every flight (FlightAware soft-blocks server-side scrapes; the FR24 summary fallback
    // is credit-dead), so the old blanket "check the flight numbers" blamed the user for a backend
    // outage on every valid input. Distinguish a feed outage (neutral) from a genuine 200+not-found.
    if (r1 === null || r2 === null) {
      resultEl.innerHTML = '<div style="color:var(--ua-muted);font-size:11px">Flight times are temporarily unavailable. Please try again later.</div>';
      return;
    }
    if (r1.success === false || r2.success === false) {
      resultEl.innerHTML = '<div style="color:var(--ua-red);font-size:11px">Could not find one or both flights. Check the flight numbers.</div>';
      return;
    }
    const arrHub = r1.destination?.iata;
    const depHub = r2.origin?.iata;
    if (arrHub !== depHub) {
      resultEl.innerHTML = `<div style="color:var(--ua-red);font-size:11px">These flights don't connect — ${escapeHtml(normalize(inFlt))} arrives at ${escapeHtml(arrHub || '?')}, ${escapeHtml(normalize(outFlt))} departs from ${escapeHtml(depHub || '?')}.</div>`;
      return;
    }
    const conn = {
      inbound: { w: { flight: normalize(inFlt), route: (r1.origin?.iata||'')+'→'+(r1.destination?.iata||'') }, td: r1 },
      outbound: { w: { flight: normalize(outFlt), route: (r2.origin?.iata||'')+'→'+(r2.destination?.iata||'') }, td: r2 },
      hub: arrHub, minutes: 0
    };
    const risk = computeConnectionRisk(conn);
    resultEl.innerHTML = renderConnectionRiskCard(conn, risk);
  } catch(e) {
    resultEl.innerHTML = '<div style="color:var(--ua-red);font-size:11px">Error checking connection. Try again.</div>';
  }
}

function isSignificantStatusChange(oldStatus, newStatus) {
  if (!oldStatus || !newStatus || oldStatus === newStatus) return false;
  const nl = newStatus.toLowerCase();
  // Always notify: cancelled, diverted, landed, departed
  if (nl.includes('cancel') || nl.includes('divert') || nl.includes('landed') || nl.includes('departed')) return true;
  // Notify if delay appeared or gate changed
  if (nl.includes('delay')) return true;
  if (nl.includes('gate') && nl !== oldStatus.toLowerCase()) return true;
  // Generic status text changed (e.g. scheduled → en route)
  const ol = oldStatus.toLowerCase();
  const significantKeys = ['cancel', 'divert', 'landed', 'departed', 'en route', 'delay', 'gate'];
  if (significantKeys.some(k => nl.includes(k) || ol.includes(k))) return true;
  return false;
}

function checkWatchedFlightChanges(flights) {
  let watched = getWatchedFlights();
  if (!watched.length) return;
  let changed = false;
  flights.forEach(fl => {
    const ident = fl.identification?.number?.default;
    if (!ident) return;
    const wIdx = watched.findIndex(w => w.flight === ident);
    if (wIdx < 0) return;
    const s = classifySchedStatus(fl, schedCurrentDir, schedNow(), classifyOptsFor(schedBoardMeta));
    // A time-inferred status (we guessed "Departed"/"Landed" because the clock crossed the grace
    // window, not because the provider confirmed it) must NOT fire a watch notification, a BMAC
    // landing toast, or overwrite the stored status. Skip until a real provider transition
    // arrives — otherwise watchers get speculative "your flight departed/landed" alerts and the
    // fabricated status masks the genuine change later. (adversarial review)
    if (s.inferred) return;
    // Transitions INTO 'unknown' are pipeline noise, not flight events — tonight
    // this fired "Unknown (was: Departed)" toasts. Skip entirely: don't notify and
    // don't overwrite the stored status, so the next REAL transition still compares
    // against the last meaningful state. (Audit Jul 3 2026.)
    if (s.key === 'unknown') return;
    const newStatus = s.text;
    const oldStatus = watched[wIdx].status;
    if (oldStatus && newStatus !== oldStatus && isSignificantStatusChange(oldStatus, newStatus)) {
      const orig = fl.airport?.origin?.code?.iata || '?';
      const dest = fl.airport?.destination?.code?.iata || '?';
      const msg = `🔔 ${ident} ${orig}→${dest}: ${newStatus} (was: ${oldStatus})`;
      if (document.hidden) {
        // Page not visible — fire native notification
        if ('Notification' in window && Notification.permission === 'granted') {
          const n = new Notification('The Blue Board', {
            body: `${ident}: ${newStatus} (was: ${oldStatus})`,
            icon: '/icons/icon-192.png',
            tag: 'bb-watch-' + ident,
            data: { flight: ident }
          });
          n.onclick = function() { window.focus(); focusWatchedFlight(ident); };
        }
      } else {
        // Page visible — show in-page banner
        showWatchNotification(msg);
      }
      // Show BMAC prompt when a watched flight lands
      if (newStatus.toLowerCase().includes('landed') && typeof window.showBmacLandingToast === 'function') {
        window.showBmacLandingToast(ident);
      }
      changed = true;
    }
    watched[wIdx].status = newStatus;
    watched[wIdx].ts = Date.now();
  });
  if (changed) saveWatchedFlights(watched);
}

function focusWatchedFlight(ident) {
  const match = allFlights.find(f => (f.flightIATA || f.callsign) === ident);
  if (match && flightMarkers[match.icao24]) {
    focusFlight(match.icao24);
  }
}

function showWatchNotification(msg) {
  const el = document.getElementById('watch-notification');
  document.getElementById('wn-text').textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 10000);
}

function hideGlobalSearchResults() {
  const results = document.getElementById('global-search-results');
  if (results) results.style.display = 'none';
}

// Inline (non-blocking) error line under the header search field. A failed
// lookup used to open a full-screen modal — a dead end for a quick search.
function showGlobalSearchError(msg) {
  const el = document.getElementById('global-search-error');
  if (!el) return false;
  el.textContent = msg;
  el.style.display = 'block';
  return true;
}
function hideGlobalSearchError() {
  const el = document.getElementById('global-search-error');
  if (el) el.style.display = 'none';
}

function toggleSidebarFilters() {
  const panel = document.getElementById('sidebar-extra-filters');
  const btn = document.getElementById('sidebar-filters-toggle');
  if (!panel || !btn) return;
  panel.classList.toggle('show');
  const expanded = panel.classList.contains('show');
  btn.textContent = expanded ? 'Filters ▴' : 'Filters ▾';
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function getActiveAdvFilterCount() {
  let count = 0;
  if (document.getElementById('sched-status')?.value) count++;
  if (document.getElementById('sched-aircraft')?.value) count++;
  if (document.getElementById('sched-fleet-family')?.value) count++;
  if (document.getElementById('sched-route-type')?.value) count++;
  if (document.getElementById('sched-starlink')?.value) count++;
  if (document.getElementById('sched-timerange')?.value) count++;
  if (document.getElementById('sched-risk')?.value) count++;
  if (document.getElementById('sched-search')?.value?.trim()) count++;
  return count;
}
function updateAdvFilterBtnText() {
  const btn = document.getElementById('sched-more-filters-btn');
  if (!btn) return;
  const panel = document.getElementById('sched-adv-filters');
  const isOpen = panel && panel.style.display === 'flex';
  const count = getActiveAdvFilterCount();
  if (count > 0) {
    btn.textContent = `Filters (${count} active) ${isOpen ? '▴' : '▾'}`;
    btn.style.color = 'var(--ua-accent)';
  } else {
    btn.textContent = isOpen ? 'Less Filters ▴' : 'Filter: Fleet, Aircraft, Starlink… ▾';
    btn.style.color = 'var(--ua-muted)';
  }
}
function toggleScheduleMoreFilters() {
  const panel = document.getElementById('sched-adv-filters');
  const btn = document.getElementById('sched-more-filters-btn');
  if (!panel || !btn) return;
  const isHidden = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = isHidden ? 'flex' : 'none';
  btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  updateAdvFilterBtnText();
}

// Keyboard support: Enter/Space triggers click on [data-action][role="button"] elements
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    const el = e.target.closest('[data-action][role="button"]');
    if (el) { e.preventDefault(); el.click(); }
  }
});
document.addEventListener('click', function(e) {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  if (actionEl.dataset.preventDefault) e.preventDefault();
  if (actionEl.dataset.stopProp) e.stopPropagation();
  const action = actionEl.dataset.action;
  switch (action) {
    case 'dismiss-watch-notification': {
      const wn = document.getElementById('watch-notification');
      if (wn) wn.classList.remove('show');
      break;
    }
    case 'toggle-watch-panel':
      toggleWatchPanel();
      break;
    case 'clear-all-watched':
      clearAllWatched();
      break;
    case 'toggle-sidebar-filters':
      toggleSidebarFilters();
      break;
    case 'toggle-hubs':
      toggleHubs();
      break;
    case 'toggle-longhaul':
      toggleLonghaul();
      break;
    case 'toggle-starlink-layer':
      toggleStarlinkLayer();
      break;
    case 'view-starlink-on-map':
      // Click-through from the STARLINK tab's "● N AIRBORNE NOW" chip: jump to the
      // LIVE OPS map with the Starlink-only filter pre-enabled.
      switchToTab('tab-live');
      if (STARLINK_TAILS.size && !showStarlinkOnly) toggleStarlinkLayer();
      break;
    case 'toggle-weather':
      toggleWeather();
      break;
    case 'view-pacific':
      togglePacific();
      break;
    case 'refresh-flights':
      refreshFlights();
      break;
    case 'sched-jump-now':
      scrollScheduleToNow(true);
      break;
    case 'schedule-refresh':
      { const ts = getSchedDayTimestamp(schedCurrentDay);
        delete schedCache[`agg-${schedCurrentHub}-${schedCurrentDir}-${ts}`]; }
      loadScheduleData();
      break;
    case 'schedule-retry-cached':
      // Same as schedule-refresh: clear the cache key for the current day and
      // reload. Replaces an inline onclick that drove XSS amplification risk
      // via CSP 'unsafe-inline'.
      { const ts = getSchedDayTimestamp(schedCurrentDay);
        delete schedCache[`agg-${schedCurrentHub}-${schedCurrentDir}-${ts}`]; }
      loadScheduleData();
      break;
    case 'schedule-retry-reload':
      // Post-error retry — no cache to clear, just reload.
      loadScheduleData();
      break;
    case 'hub-card-toggle': {
      // Migrated from inline onclick at the hub-card-expand element. Toggles
      // the sibling detail panel's visibility and flips the expander glyph.
      const d = actionEl.nextElementSibling;
      if (!d) break;
      const open = d.style.display !== 'none';
      d.style.display = open ? 'none' : 'block';
      actionEl.textContent = open ? '▾ Details' : '▴ Details';
      actionEl.setAttribute('aria-expanded', String(!open));
      break;
    }
    case 'schedule-more-filters':
      toggleScheduleMoreFilters();
      break;
    case 'refresh-fleet-data':
      refreshFleetData();
      break;
    case 'irops-load':
      autoLoadIrops();
      break;
    case 'map-error-retry': {
      const overlay = actionEl.closest('#map-error-overlay');
      if (overlay) overlay.remove();
      refreshFlights();
      break;
    }
    case 'weather-retry':
      weatherInitialized = false;
      // initWeatherTab is async; surface (don't swallow) any re-init failure.
      initWeatherTab().catch(e => console.error('weather-retry failed:', e));
      break;
    case 'toggle-watch-flight':
      toggleWatchFlight(actionEl.dataset.flight, actionEl.dataset.route, actionEl.dataset.status);
      break;
    case 'share-flight': {
      const flightId = actionEl.dataset.flight;
      const shareUrl = new URL(window.location);
      shareUrl.searchParams.set('flight', flightId);
      shareUrl.hash = '';
      // ICO_SHARE is a hardcoded SVG constant — safe for innerHTML
      const shareResetHtml = ICO_SHARE + ' Share';
      navigator.clipboard.writeText(shareUrl.toString()).then(() => {
        actionEl.classList.add('copied');
        actionEl.textContent = '\u2713 Copied!';
        setTimeout(() => { actionEl.classList.remove('copied'); actionEl.innerHTML = shareResetHtml; }, 2000);
      }).catch(() => {
        // Fallback for older browsers. execCommand is deprecated; check its
        // boolean return and, on failure, prompt the user so they can copy
        // manually rather than seeing a lying "Copied!" state.
        const ta = document.createElement('textarea');
        ta.value = shareUrl.toString();
        document.body.appendChild(ta);
        ta.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
        document.body.removeChild(ta);
        if (!copied) {
          try { window.prompt('Copy this link:', shareUrl.toString()); } catch (e) {}
          return;
        }
        actionEl.classList.add('copied');
        actionEl.textContent = '\u2713 Copied!';
        setTimeout(() => { actionEl.classList.remove('copied'); actionEl.innerHTML = shareResetHtml; }, 2000);
      });
      break;
    }
    case 'enable-push':
      if ('Notification' in window) {
        Notification.requestPermission().then(p => {
          if (p === 'granted') showWatchNotification('🔔 Push notifications enabled for watched flights');
        });
      }
      try { localStorage.setItem('bb_push_prompted', '1'); } catch(e) {}
      document.getElementById('push-prompt').classList.remove('show');
      break;
    case 'dismiss-push':
      try { localStorage.setItem('bb_push_prompted', '1'); } catch(e) {}
      document.getElementById('push-prompt').classList.remove('show');
      break;
    case 'toggle-phase-filter':
      togglePhaseFilter(actionEl.dataset.phase);
      break;
    case 'clear-filters':
      clearAllFilters();
      break;
    case 'toggle-hub-filter':
      toggleHubFilter(actionEl.dataset.hub);
      break;
    case 'focus-flight':
      focusFlight(actionEl.dataset.icao24);
      if (actionEl.dataset.closeGlobal) hideGlobalSearchResults();
      break;
    case 'filter-fleet-type':
      filterFleetType(actionEl.dataset.type);
      break;
    case 'fleet-subtab':
      switchFleetView(actionEl.dataset.view);
      break;
    case 'fleet-clear-filters':
      clearFleetFilters();
      break;
    case 'switch-tab':
      switchToTab(actionEl.dataset.tab);
      if (actionEl.dataset.closeGlobal) hideGlobalSearchResults();
      break;
    case 'go-home':
      e.preventDefault();
      switchToTab('tab-live');
      window.scrollTo({top:0,behavior:'smooth'});
      break;
    case 'lookup-fr24':
      lookupFR24Flight(actionEl.dataset.query || '');
      if (actionEl.dataset.closeGlobal) hideGlobalSearchResults();
      break;
    case 'show-disclaimer':
      showDisclaimer();
      break;
    case 'hide-disclaimer':
      hideDisclaimer();
      break;
    case 'check-connection':
      checkManualConnection();
      break;
    case 'cycle-home-hub': {
      const hubs = ['','ORD','DEN','IAH','EWR','SFO','IAD','LAX','NRT','GUM'];
      const cur = getHomeAirport();
      const idx = hubs.indexOf(cur);
      const next = hubs[(idx + 1) % hubs.length];
      setHomeAirport(next);
      break;
    }
    case 'close-bmac': {
      const toast = actionEl.closest('#bmac-toast');
      if (toast) toast.remove();
      else if (actionEl.parentElement) actionEl.parentElement.remove();
      localStorage.setItem('bb-bmac-dismissed', Date.now());
      break;
    }
    case 'close-waitlist': {
      const wlModal = document.getElementById('waitlist-modal');
      if (wlModal) wlModal.style.display = 'none';
      break;
    }
    case 'close-fr24-modal': {
      const modal = document.getElementById('fr24-modal');
      if (modal) modal.style.display = 'none';
      break;
    }
    case 'explain-delay': {
      const el = actionEl;
      showDelayExplanation({
        flight: el.dataset.flight,
        route: el.dataset.route,
        status: el.dataset.status,
        riskLabel: el.dataset.riskLabel,
        riskScore: el.dataset.riskScore,
        factors: (el.dataset.riskFactors || '').split('|').filter(Boolean),
        hub: el.dataset.hub,
        otp: el.dataset.otp,
        weather: el.dataset.weather,
        destWeather: el.dataset.destWeather,
        faaStatus: el.dataset.faaStatus,
        inbound: el.dataset.inbound,
        irops: el.dataset.irops,
        hubTime: el.dataset.hubTime,
        connection: el.dataset.connection,
      });
      break;
    }
    case 'close-delay-explain': {
      const dem = document.getElementById('delay-explain-modal');
      if (dem) dem.style.display = 'none';
      break;
    }
    case 'sl-row-toggle': {
      const slTail = actionEl.dataset.tail;
      if (slTail) toggleStarlinkExpand(slTail);
      break;
    }
    case 'sl-track': {
      const slIcao = actionEl.dataset.icao24;
      if (slIcao) focusFlight(slIcao); // focusFlight switches to LIVE OPS and centers the map
      break;
    }
    case 'sl-board-hub': {
      const h = actionEl.dataset.hub || '';
      slBoardHub = h || null;
      slBoardShowAll = false; // a new hub selection resets the per-hub cap
      renderSlRoutesBoard();
      break;
    }
    case 'sl-board-window': {
      const w = Number(actionEl.dataset.window);
      if (w === 12 || w === 48) { slBoardWindow = w; slBoardShowAll = false; renderSlRoutesBoard(); }
      break;
    }
    case 'sl-board-show-all': {
      slBoardShowAll = true;
      renderSlRoutesBoard();
      break;
    }
    case 'sl-jump-verify': {
      // Hero "N disputed" → verification ledger. scrollIntoView (not a hash link) because the ledger
      // lives inside the #tab-starlink scroll container, which a fragment URL can't reach.
      document.getElementById('sl-verification')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
    case 'aircraft-detail': {
      const reg = actionEl.dataset.reg;
      if (reg) showAircraftDetail(reg);
      break;
    }
    case 'close-aircraft-modal': {
      const acm = document.getElementById('aircraft-detail-modal');
      if (acm) acm.style.display = 'none';
      break;
    }
    case 'focus-live-flight': {
      const icao24 = actionEl.dataset.icao24;
      if (icao24) {
        const acm = document.getElementById('aircraft-detail-modal');
        if (acm) acm.style.display = 'none';
        focusFlight(icao24);
      }
      break;
    }
    case 'share-aircraft': {
      const shareReg = actionEl.dataset.reg;
      if (shareReg) {
        const shareUrl = new URL(window.location);
        shareUrl.searchParams.set('aircraft', shareReg);
        // ICO_SHARE is a hardcoded SVG constant — safe for innerHTML
        const acShareResetHtml = ICO_SHARE + ' Share';
        navigator.clipboard.writeText(shareUrl.toString()).then(function() {
          actionEl.textContent = '\u2713 Copied!';
          setTimeout(function() { actionEl.innerHTML = acShareResetHtml; }, 2000);
        }).catch(function() {
          // Fallback clipboard path \u2014 verify execCommand's return value and
          // prompt the user on failure instead of flashing a false "Copied!".
          const ta = document.createElement('textarea');
          ta.value = shareUrl.toString();
          document.body.appendChild(ta);
          ta.select();
          let copied = false;
          try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
          document.body.removeChild(ta);
          if (!copied) {
            try { window.prompt('Copy this link:', shareUrl.toString()); } catch (e) {}
            return;
          }
          actionEl.textContent = '\u2713 Copied!';
          setTimeout(function() { actionEl.innerHTML = acShareResetHtml; }, 2000);
        });
      }
      break;
    }
    default:
      break;
  }
});

// Close watch panel on outside click
document.addEventListener('click', function(e) {
  const wp = document.getElementById('watch-panel');
  const wb = document.getElementById('watch-header-btn');
  if (wp && wb && !wp.contains(e.target) && !wb.contains(e.target)) { wp.classList.remove('show'); wb.setAttribute('aria-expanded', 'false'); }
});

document.addEventListener('click', function(e) {
  const modal = document.getElementById('disclaimer-modal');
  if (modal && e.target === modal) hideDisclaimer();
});

// ═══ INIT ═══
// ═══ TIP STRIP ═══
(function() {
  const TIPS = {
    'tab-live': [
      'Click any aircraft registration (N-number) in a popup to see full details, seat config & Starlink status',
      'Click a hub name in the sidebar to filter the map to just that hub\'s flights',
      'Toggle the weather radar overlay with the rain cloud button on the map'
    ],
    'tab-schedule': [
      'Use "Filter: Fleet, Aircraft, Starlink…" to narrow by family, equipment, or WiFi',
      'Click any registration in the schedule table to see full aircraft details'
    ],
    'tab-myflight': [
      'Watch 2+ connecting flights and we\'ll automatically check your connection risk',
      'The "Where\'s My Plane?" section shows the inbound aircraft for your watched flight'
    ],
    'tab-weather': [
      'Load schedule data in the Schedule tab to unlock the IROPS disruption monitor'
    ],
    'tab-fleet': [
      'Click any fleet type chip to filter the aircraft database instantly'
    ]
  };
  const strip = document.getElementById('tip-strip');
  const textEl = document.getElementById('tip-text');
  if (!strip || !textEl) return;
  const DISMISS_KEY = 'bb_tips_dismissed';
  const DISMISS_DAYS = 7;
  function isDismissed() {
    const ts = localStorage.getItem(DISMISS_KEY);
    return ts && (Date.now() - parseInt(ts)) < DISMISS_DAYS * 86400000;
  }
  function getActiveTab() {
    const btn = document.querySelector('.tab-btn.active');
    return btn ? btn.dataset.tab : 'tab-live';
  }
  let tipTimer = null;
  function showTip() {
    if (isDismissed()) { strip.style.display = 'none'; return; }
    const tab = getActiveTab();
    const pool = TIPS[tab] || TIPS['tab-live'];
    const tip = pool[Math.floor(Math.random() * pool.length)];
    textEl.classList.add('tip-fade');
    setTimeout(() => { textEl.textContent = tip; textEl.classList.remove('tip-fade'); }, 300);
    strip.style.display = '';
  }
  function startRotation() {
    showTip();
    if (tipTimer) clearInterval(tipTimer);
    tipTimer = setInterval(showTip, 45000);
  }
  // Listen for tab switches
  document.getElementById('tab-bar')?.addEventListener('click', (e) => {
    if (e.target.closest('.tab-btn')) setTimeout(showTip, 100);
  });
  // Dismiss handler
  strip.querySelector('[data-action="dismiss-tips"]')?.addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    strip.style.display = 'none';
    if (tipTimer) clearInterval(tipTimer);
  });
  // Start after short delay
  setTimeout(startRotation, 2000);
})();

async function initApp() {
  updateWatchBadge();
  updateHomeHubDisplay();
  // My Flights quick-add search
  var mfSearch = document.getElementById('myflight-search');
  if (mfSearch) mfSearch.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var val = mfSearch.value.trim().toUpperCase().replace(/\s+/g,'');
      if (!val) return;
      var flt = val.startsWith('UA') ? val : 'UA' + val.replace(/^UAL?/i,'');
      if (!isFlightWatched(flt)) toggleWatchFlight(flt, '', '');
      mfSearch.value = '';
    }
  });
  // Connection-checker inputs submit on Enter (parity with the button)
  ['conn-inbound', 'conn-outbound'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('keydown', function(e) { if (e.key === 'Enter') checkManualConnection(); });
  });
  // Rotating search placeholders
  (function() {
    // Header search keeps ONE flight-first placeholder everywhere (its static
    // HTML placeholder) — the old rotation mutated it to "Look up an aircraft…"
    // on whatever tab you were on, teaching users the wrong primary use.
    const mfHints = [
      'Add a flight (e.g. UA 1234)',
      'Try a tail number (N37502)'
    ];
    function rotator(el, list) {
      if (!el) return;
      let idx = 0, timer = null;
      function cycle() {
        el.classList.add('ph-fade');
        setTimeout(() => { idx = (idx + 1) % list.length; el.placeholder = list[idx]; el.classList.remove('ph-fade'); }, 300);
      }
      timer = setInterval(cycle, 4000);
      el.addEventListener('focus', () => { clearInterval(timer); timer = null; });
      el.addEventListener('blur', () => { if (!el.value && !timer) timer = setInterval(cycle, 4000); });
    }
    rotator(document.getElementById('myflight-search'), mfHints);
  })();
  // Init map immediately so the user sees something
  initMap();
  // Always await fleet data before init returns. The previous requestIdleCallback
  // deferral created a race where flight popups opened before FLEET_BY_REG
  // populated showed "(not in mainline fleet DB — likely United Express)" for
  // valid mainline tails. Edge cache (24h) + browser cache (1h) make the FCP
  // cost of this ~194KB fetch negligible for repeat visitors.
  var acDeepLink = new URLSearchParams(location.search).get('aircraft');
  const loadFleetAndInit = async () => {
    await loadFleetData();
    // STARLINK_TAILS is now populated (or empty in degraded tier) — sync the map toggle + legend.
    updateStarlinkControlState();
    if (allFlights.length > 0) {
      updateStats();
      updateAnalytics();
      updateLiveFleetPanel();
    }
    // If a popup is open from before fleet loaded (race window), re-render it
    // so it shows the matched aircraft instead of "Loading aircraft data…".
    const openMarker = Object.values(flightMarkers).find(m => m.isPopupOpen && m.isPopupOpen());
    if (openMarker) {
      const f = allFlights.find(fl => fl.icao24 === openMarker._icao24);
      if (f) showFlightPopup(f, openMarker);
    }
    updateTicker();
    initFleetTab();
    var onboardingEl = document.getElementById('onboarding-overlay');
    if (acDeepLink && FLEET_DB.length > 0 && (!onboardingEl || onboardingEl.style.display === 'none')) setTimeout(function() { showAircraftDetail(acDeepLink); }, 500);
    if (activeFleetType) showConfigGallery(activeFleetType);
    else showConfigEmpty();
  };
  await loadFleetAndInit();
  updateTicker();
  // Now that map + fleet data are ready, activate the hash-linked tab's data layer.
  // The hash IIFE only set the visual state; this triggers the actual data loads.
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab && activeTab !== 'tab-live') switchToTab(activeTab, false);
  // Defer IROPS + schedule preload to idle — they're only needed for Weather/Schedule tabs
  // Background preload: fetch top 3 hubs on idle so Schedule tab is fast without hammering mobile
  const idlePreload = () => { preloadScheduleData(); fetchIropsFromAPI(); preloadWeatherAndFAA(); };
  if ('requestIdleCallback' in window) requestIdleCallback(idlePreload); else setTimeout(idlePreload, 5000);
}

// Both Leaflet and dashboard are deferred — Leaflet loads first (script order preserved).
// Wait for DOM ready in case DOMContentLoaded hasn't fired yet.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initApp());
} else {
  initApp();
}

// ═══ DISCLAIMER MODAL ═══
function showDisclaimer() {
  document.getElementById('disclaimer-modal').style.display = 'flex';
}
function hideDisclaimer() {
  document.getElementById('disclaimer-modal').style.display = 'none';
}

// === Engagement & Onboarding ===

(function(){
  var overlay=document.getElementById('onboarding-overlay');
  var btn=document.getElementById('onboarding-dismiss');
  var helpBtn=document.getElementById('onboarding-help');
  function hideOverlay(){var hubSel=document.getElementById('onboarding-home-hub');if(hubSel&&hubSel.value){setHomeAirport(hubSel.value)}overlay.classList.add('ob-hidden');localStorage.setItem('bb-onboarded','1');try{localStorage.setItem('bb_onboarding_dismissed',String(Date.now()))}catch(e){}setTimeout(function(){overlay.style.display='none'},300)}
  function showOverlay(){overlay.style.display='flex';overlay.classList.remove('ob-hidden');overlay.style.animation='none';requestAnimationFrame(function(){requestAnimationFrame(function(){overlay.style.animation='obFadeIn .4s ease forwards'})})}

  // ═══ WAITLIST / ENGAGEMENT MODAL ═══
  var DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  var waitlistShownThisSession = false;
  var waitlistSubmitted = false;
  try { waitlistSubmitted = localStorage.getItem('bb_waitlist_submitted') === 'true'; } catch(e) {}
  var engagementInteractions = 0;

  function isDismissedRecently(key) {
    try {
      var ts = parseInt(localStorage.getItem(key), 10);
      return ts > 0 && (Date.now() - ts) < DISMISS_TTL_MS;
    } catch(e) { return false; }
  }

  // AbortController for the modal's document-level Escape listener. Tying it
  // to modal lifecycle means the listener is torn down on close rather than
  // staying live on document for the rest of the session.
  var waitlistEscController = null;

  function closeWaitlistModal() {
    var modal = document.getElementById('waitlist-modal');
    if (modal) modal.style.display = 'none';
    if (waitlistEscController) {
      waitlistEscController.abort();
      waitlistEscController = null;
    }
    waitlistShownThisSession = true;
    try { localStorage.setItem('bb_waitlist_dismissed', String(Date.now())); } catch(e) {}
  }

  function showWaitlistModal(force) {
    if (waitlistSubmitted) return;
    if (!force && waitlistShownThisSession) return;
    if (!force && isDismissedRecently('bb_waitlist_dismissed')) return;
    // Don't stack on top of onboarding overlay (Codex P2 finding)
    if (!force && overlay && overlay.style.display !== 'none' && !overlay.classList.contains('ob-hidden')) return;
    if (document.getElementById('waitlist-modal')) {
      document.getElementById('waitlist-modal').style.display = 'flex';
      waitlistShownThisSession = true;
      // Re-arm Escape handler — the previous controller was aborted on close.
      if (waitlistEscController) waitlistEscController.abort();
      waitlistEscController = new AbortController();
      document.addEventListener(
        'keydown',
        function (e) {
          if (e.key === 'Escape') {
            var modal = document.getElementById('waitlist-modal');
            if (modal && modal.style.display !== 'none') closeWaitlistModal();
          }
        },
        { signal: waitlistEscController.signal }
      );
      return;
    }
    waitlistShownThisSession = true;

    // Build modal entirely with DOM methods (no innerHTML — XSS hardening)
    var backdrop = document.createElement('div');
    backdrop.id = 'waitlist-modal';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);padding:16px';
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) closeWaitlistModal(); });

    var card = document.createElement('div');
    card.style.cssText = 'background:var(--ua-panel);border:1px solid var(--ua-border);border-radius:10px;max-width:480px;width:100%;color:var(--ua-text);font-family:var(--font-ui);position:relative;overflow:hidden;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.6)';

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.style.cssText = 'position:absolute;top:12px;right:16px;background:none;border:none;color:var(--ua-muted);cursor:pointer;font-size:20px;z-index:1;padding:4px';
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', closeWaitlistModal);
    card.appendChild(closeBtn);

    // Content wrapper
    var content = document.createElement('div');
    content.style.cssText = 'padding:32px 28px 24px';

    // Heading
    var heading = document.createElement('div');
    heading.style.cssText = 'font-size:22px;font-weight:700;color:var(--ua-text);margin-bottom:8px;font-family:var(--font-display)';
    heading.textContent = '\u2708 Enjoying The Blue Board?';
    content.appendChild(heading);

    // Subtext
    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:14px;color:var(--ua-muted);margin-bottom:24px;line-height:1.5';
    sub.textContent = 'Big updates are coming \u2014 Pro features, smarter alerts, and more.';
    content.appendChild(sub);

    // Form container (will be replaced on success)
    var formWrap = document.createElement('div');
    formWrap.id = 'waitlist-form-wrap';

    // Email input
    var emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.placeholder = 'Email';
    emailInput.setAttribute('autocomplete', 'email');
    emailInput.setAttribute('aria-label', 'Email address');
    emailInput.style.cssText = 'width:100%;padding:12px 14px;background:var(--ua-dark);border:1px solid var(--ua-border);border-radius:8px;color:var(--ua-text);font-size:14px;font-family:var(--font-ui);outline:none;box-sizing:border-box;margin-bottom:12px;transition:border-color .2s';
    emailInput.addEventListener('focus', function() { emailInput.style.borderColor = 'var(--ua-accent)'; });
    emailInput.addEventListener('blur', function() { emailInput.style.borderColor = 'var(--ua-border)'; });
    formWrap.appendChild(emailInput);

    // Feature request textarea
    var featureInput = document.createElement('textarea');
    featureInput.placeholder = 'Any features you\'d love to see? (optional)';
    featureInput.setAttribute('aria-label', 'Feature request');
    featureInput.rows = 3;
    featureInput.style.cssText = 'width:100%;padding:12px 14px;background:var(--ua-dark);border:1px solid var(--ua-border);border-radius:8px;color:var(--ua-text);font-size:14px;font-family:var(--font-ui);outline:none;box-sizing:border-box;margin-bottom:16px;resize:vertical;min-height:60px;transition:border-color .2s';
    featureInput.addEventListener('focus', function() { featureInput.style.borderColor = 'var(--ua-accent)'; });
    featureInput.addEventListener('blur', function() { featureInput.style.borderColor = 'var(--ua-border)'; });
    formWrap.appendChild(featureInput);

    // Error message
    var errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'color:var(--ua-red);font-size:12px;margin-bottom:8px;display:none';
    formWrap.appendChild(errorMsg);

    // Submit button
    var submitBtn = document.createElement('button');
    submitBtn.textContent = 'Stay in the Loop';
    submitBtn.style.cssText = 'width:100%;padding:14px;background:var(--ua-blue);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;font-family:var(--font-ui);cursor:pointer;transition:background .2s';
    submitBtn.addEventListener('mouseenter', function() { submitBtn.style.background = '#0070cc'; });
    submitBtn.addEventListener('mouseleave', function() { submitBtn.style.background = 'var(--ua-blue)'; });

    submitBtn.addEventListener('click', function() {
      var email = emailInput.value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorMsg.textContent = 'Please enter a valid email address.';
        errorMsg.style.display = 'block';
        return;
      }
      errorMsg.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting\u2026';
      submitBtn.style.opacity = '0.7';

      fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          source: 'popup',
          featureRequest: featureInput.value.trim() || undefined
        })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.success || data.error === 'duplicate') {
          // Show success state — replace form contents
          try { localStorage.setItem('bb_waitlist_submitted', 'true'); } catch(e) {}
          waitlistSubmitted = true;
          while (formWrap.firstChild) formWrap.removeChild(formWrap.firstChild);
          var success = document.createElement('div');
          success.style.cssText = 'text-align:center;padding:20px 0';
          var successIcon = document.createElement('div');
          successIcon.style.cssText = 'font-size:32px;margin-bottom:8px';
          successIcon.textContent = '\u2708\uFE0F';
          success.appendChild(successIcon);
          var successText = document.createElement('div');
          successText.style.cssText = 'font-size:16px;font-weight:600;color:var(--ua-green)';
          successText.textContent = 'You\'re on the list! \u2708';
          success.appendChild(successText);
          var successSub = document.createElement('div');
          successSub.style.cssText = 'font-size:12px;color:var(--ua-muted);margin-top:8px';
          successSub.textContent = 'We\'ll keep you posted on launch updates.';
          success.appendChild(successSub);
          formWrap.appendChild(success);
        } else {
          errorMsg.textContent = data.error || 'Something went wrong. Please try again.';
          errorMsg.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Stay in the Loop';
          submitBtn.style.opacity = '1';
        }
      }).catch(function() {
        errorMsg.textContent = 'Network error. Please try again.';
        errorMsg.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Stay in the Loop';
        submitBtn.style.opacity = '1';
      });
    });
    formWrap.appendChild(submitBtn);
    content.appendChild(formWrap);

    // Trust badges
    var badges = document.createElement('div');
    badges.style.cssText = 'margin-top:20px;font-size:12px;color:var(--ua-muted);line-height:1.8';
    var badge1 = document.createElement('div');
    badge1.textContent = '\u2713 22,000+ flyers have used The Blue Board';
    badges.appendChild(badge1);
    var badge2 = document.createElement('div');
    badge2.textContent = '\u2713 No spam, just launch updates';
    badges.appendChild(badge2);
    content.appendChild(badges);

    // Donation CTA (prominent)
    var donateWrap = document.createElement('div');
    donateWrap.style.cssText = 'margin-top:20px;padding-top:16px;border-top:1px solid var(--ua-border);text-align:center';
    var donateText = document.createElement('div');
    donateText.style.cssText = 'font-size:14px;color:var(--ua-fg);line-height:1.5;margin-bottom:12px';
    donateText.textContent = 'Free. No ads. No paywalls. Just one United nerd who hates bad flight trackers. A $5 donation covers a full day of live flights, API calls, and everything that keeps this running.';
    donateWrap.appendChild(donateText);
    var donateBtn = document.createElement('a');
    donateBtn.href = 'https://buymeacoffee.com/notjbg';
    donateBtn.target = '_blank';
    donateBtn.rel = 'noopener noreferrer';
    donateBtn.style.cssText = 'display:inline-block;padding:10px 28px;background:rgba(255,255,255,0.08);border:1px solid var(--ua-accent);color:var(--ua-accent);border-radius:8px;font-size:14px;font-weight:600;font-family:var(--font-ui);text-decoration:none;transition:background .2s,color .2s;cursor:pointer';
    donateBtn.textContent = 'Donate';
    donateBtn.addEventListener('mouseenter', function() { donateBtn.style.background = 'var(--ua-accent)'; donateBtn.style.color = '#fff'; });
    donateBtn.addEventListener('mouseleave', function() { donateBtn.style.background = 'rgba(255,255,255,0.08)'; donateBtn.style.color = 'var(--ua-accent)'; });
    donateWrap.appendChild(donateBtn);
    content.appendChild(donateWrap);

    card.appendChild(content);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    // Escape key handler scoped to modal lifecycle via AbortController.
    if (waitlistEscController) waitlistEscController.abort();
    waitlistEscController = new AbortController();
    document.addEventListener(
      'keydown',
      function waitlistEsc(e) {
        if (e.key === 'Escape') {
          var modal = document.getElementById('waitlist-modal');
          if (modal && modal.style.display !== 'none') closeWaitlistModal();
        }
      },
      { signal: waitlistEscController.signal }
    );

    // Focus email input
    setTimeout(function() { emailInput.focus(); }, 100);
  }

  // Trigger thresholds: aggressive for new visitors, gentle for returning
  var isNewVisitor = !localStorage.getItem('bb-visited');
  var TRIGGER_TIME_MS = isNewVisitor ? 90 * 1000 : 5 * 60 * 1000;    // 90s new, 5min returning
  var TRIGGER_CLICKS  = isNewVisitor ? 8 : 30;                         // 8 new, 30 returning

  // Trigger 1: After time threshold of active use
  setTimeout(function() {
    if (!waitlistShownThisSession && !waitlistSubmitted) {
      showWaitlistModal();
    }
  }, TRIGGER_TIME_MS);

  // Trigger 2: After click threshold interactions (tab switches, searches, flight clicks)
  document.addEventListener('click', function() {
    engagementInteractions++;
    if (engagementInteractions === TRIGGER_CLICKS && !waitlistShownThisSession && !waitlistSubmitted) {
      showWaitlistModal();
    }
  });

  // Trigger 3: Flight watch landing payoff (called from checkWatchedFlightChanges)
  window.showBmacLandingToast = function() {
    if (waitlistSubmitted) return;
    setTimeout(function() {
      showWaitlistModal();
    }, 3000);
  };

  // Trigger 4: ?waitlist=1 deep link (from news articles, external links)
  // Force-open: intentional user action bypasses passive guards (session + TTL)
  if (new URLSearchParams(location.search).get('waitlist') === '1') {
    showWaitlistModal(true);
  }

  var visited=localStorage.getItem('bb-visited');
  if(!visited){localStorage.setItem('bb-visited','1');if(isDismissedRecently('bb_onboarding_dismissed')){overlay.style.display='none'}}
  else if(localStorage.getItem('bb-onboarded')||isDismissedRecently('bb_onboarding_dismissed')){overlay.style.display='none'}
  btn.addEventListener('click',hideOverlay);
  overlay.addEventListener('click',function(e){if(e.target===overlay)hideOverlay()});
  helpBtn.addEventListener('click',showOverlay);
})();

// ═══ AIRCRAFT DETAIL MODAL ═══
const SEAT_BAR_COLORS = {
  'J':'rgba(0,93,170,.5)','F':'rgba(139,92,246,.5)',
  'PP':'rgba(20,184,166,.5)','PE':'rgba(20,184,166,.5)',
  'E+':'rgba(34,197,94,.5)','Y':'rgba(100,116,139,.5)'
};

// ═══ AI DELAY EXPLANATION MODAL ═══
function showDelayExplanation(ctx) {
  if (!ctx || !ctx.flight) return;

  let modal = document.getElementById('delay-explain-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'delay-explain-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'AI delay risk explanation');
    modal.style.cssText = 'position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.7);backdrop-filter:blur(4px)';
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modal.style.display !== 'none') modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  // Compute hub local time dynamically (current time when user clicks)
  if (ctx.hub && SCHED_HUB_TZ[ctx.hub]) {
    try {
      ctx.hubTime = new Date().toLocaleTimeString('en-US', { timeZone: SCHED_HUB_TZ[ctx.hub], hour: '2-digit', minute: '2-digit', hour12: true }) + ' local';
    } catch(e) {}
  }

  const riskColor = ctx.riskLabel === 'V.HIGH' ? '#dc2626' : ctx.riskLabel === 'HIGH' ? '#ef4444' : ctx.riskLabel === 'MOD' ? '#eab308' : '#22c55e';
  const factorsHtml = (ctx.factors || []).map(function(f) {
    return '<div class="delay-explain-factor">\u2022 ' + escapeHtml(f) + '</div>';
  }).join('');

  modal.style.display = 'flex';
  modal.innerHTML = '<div class="ac-modal-card" style="max-width:420px">' +
    '<div class="ac-modal-header">' +
    '<button class="ac-modal-close" data-action="close-delay-explain" aria-label="Close">\u2715</button>' +
    '<div style="display:flex;align-items:center;gap:8px">' +
    '<div style="font-size:18px;font-weight:700;color:var(--ua-accent)">' + escapeHtml(ctx.flight) + '</div>' +
    '<span class="delay-risk-badge" style="background:' + riskColor + '20;color:' + riskColor + ';font-size:10px;padding:2px 8px;font-weight:700">' + escapeHtml(ctx.riskLabel || 'LOW') + ' RISK</span>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--ua-muted);margin-top:4px">' + escapeHtml(ctx.route || '') + ' &middot; Score ' + (ctx.riskScore || 0) + '/100</div>' +
    '</div>' +
    '<div class="ac-modal-body">' +
    '<div id="delay-explain-content" class="delay-explain-loading">' +
    '<div style="font-size:12px;margin-bottom:10px">Analyzing delay risk\u2026</div>' +
    '<div class="shimmer"></div><div class="shimmer" style="width:80%"></div><div class="shimmer" style="width:90%"></div>' +
    '</div>' +
    (factorsHtml ? '<div class="delay-explain-factors"><div class="delay-explain-factors-title">Contributing Factors</div>' + factorsHtml + '</div>' : '') +
    '</div>' +
    '<div class="delay-explain-footer">Powered by Claude AI</div>' +
    '</div>';

  // Fetch AI explanation
  fetchDelayExplanation(ctx);
}

async function fetchDelayExplanation(ctx) {
  const contentEl = document.getElementById('delay-explain-content');
  if (!contentEl) return;

  try {
    // F011: ctx.riskScore originates from el.dataset.riskScore (always a string); the
    // server's `typeof === 'number'` check zeroed it out before this fix. Number() it
    // here and omit entirely (JSON.stringify drops undefined) rather than send NaN.
    const numRiskScore = Number(ctx.riskScore);
    const resp = await fetch('/api/delay-explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flight: ctx.flight,
        route: ctx.route,
        status: ctx.status,
        riskLabel: ctx.riskLabel,
        riskScore: Number.isFinite(numRiskScore) ? numRiskScore : undefined,
        factors: ctx.factors,
        hub: ctx.hub,
        otp: ctx.otp,
        weather: ctx.weather,
        destWeather: ctx.destWeather,
        faaStatus: ctx.faaStatus,
        inbound: ctx.inbound,
        irops: ctx.irops,
        hubTime: ctx.hubTime,
        connection: ctx.connection,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(function() { return {}; });
      contentEl.innerHTML = '<div class="delay-explain-error">\u26A0\uFE0F ' + escapeHtml(err.error || 'Unable to generate analysis') + '</div>';
      return;
    }

    const data = await resp.json();
    contentEl.className = 'delay-explain-text';
    contentEl.textContent = data.explanation || 'No analysis available.';
  } catch (e) {
    contentEl.innerHTML = '<div class="delay-explain-error">\u26A0\uFE0F Unable to reach analysis service</div>';
  }
}

function showAircraftDetail(reg) {
  if (!reg) return;
  reg = reg.replace(/-/g, '').toUpperCase();

  let modal = document.getElementById('aircraft-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'aircraft-detail-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Aircraft detail');
    modal.style.display = 'none';
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modal.style.display !== 'none') modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  const ac = FLEET_BY_REG[reg];
  if (!ac) {
    modal.style.display = 'flex';
    modal.innerHTML = '<div class="ac-modal-card"><div class="ac-modal-header">' +
      '<button class="ac-modal-close" data-action="close-aircraft-modal" aria-label="Close">✕</button>' +
      '<div class="ac-modal-reg">' + escapeHtml(reg) + '</div>' +
      '<div class="ac-modal-type" style="color:var(--ua-muted)">Not in mainline fleet database</div>' +
      '</div><div class="ac-modal-body">' +
      '<div style="text-align:center;padding:20px;color:var(--ua-muted);font-size:11px">' +
      'This aircraft is not in the United mainline fleet database.<br>It may be a United Express (regional) aircraft.</div>' +
      '</div><div class="ac-modal-footer">' +
      '<a class="ac-action-btn" href="https://www.planespotters.net/search?q=' + encodeURIComponent(reg) + '" target="_blank" rel="noopener noreferrer">Planespotters ' + ICO_EXTLINK + '</a>' +
      '</div></div>';
    return;
  }

  modal.style.display = 'flex';
  modal.innerHTML = buildAircraftDetailHTML(ac, reg);
}

function buildAircraftDetailHTML(ac, reg) {
  const special = isSpecialAircraft(reg);
  const isSL = STARLINK_TAILS.has(reg);
  const age = ac.d ? (new Date().getFullYear() - parseInt(ac.d)) : null;
  const engine = ENGINE_BY_TYPE[ac.t] || 'Unknown';
  const category = categorizeFleetStatus(ac.s);
  const catInfo = FLEET_HEALTH_CATEGORIES.find(c => c.key === category) || { label: 'Active', color: '#22c55e' };

  // Live flight lookup
  const liveFlight = allFlights.find(function(f) {
    var fReg = (f.reg || '').replace(/-/g, '');
    return fReg === reg && !f.onGround;
  });

  var html = '<div class="ac-modal-card">';

  // ── Header ──
  html += '<div class="ac-modal-header">';
  html += '<button class="ac-modal-close" data-action="close-aircraft-modal" aria-label="Close">✕</button>';
  html += '<div class="ac-modal-reg">' + escapeHtml(reg) + '</div>';
  html += '<div class="ac-modal-type">' + escapeHtml(ac.t);
  if (ac.a) html += ' <span class="ac-modal-acnum">AC# ' + escapeHtml(ac.a) + '</span>';
  html += '</div>';
  if (special) html += '<span class="special-badge" style="margin-top:4px;display:inline-block">⭐ ' + escapeHtml(special.name) + '</span> ';
  if (isSL) html += '<span class="starlink-badge" style="margin-top:4px;display:inline-block">⚡ STARLINK</span>';
  html += '</div>';

  // ── Body ──
  html += '<div class="ac-modal-body">';

  // Biography section
  html += '<div class="ac-section"><div class="ac-section-title">Biography</div>';
  html += '<div class="ac-detail-grid">';
  html += '<div><div class="ac-detail-label">Delivered</div><div class="ac-detail-value">' + escapeHtml(ac.d || '—') + (age !== null ? ' (' + age + ' yrs)' : '') + '</div></div>';
  html += '<div><div class="ac-detail-label">Total Seats</div><div class="ac-detail-value">' + escapeHtml(String(ac.tot || '—')) + '</div></div>';
  html += '<div><div class="ac-detail-label">WiFi</div><div class="ac-detail-value">' + escapeHtml(normalizeWifi(ac.w) || '—') + '</div></div>';
  html += '<div><div class="ac-detail-label">IFE</div><div class="ac-detail-value">' + escapeHtml(ac.i || '—') + '</div></div>';
  html += '<div><div class="ac-detail-label">Power</div><div class="ac-detail-value">' + escapeHtml(ac.p || '—') + '</div></div>';
  html += '<div><div class="ac-detail-label">Engine</div><div class="ac-detail-value">' + escapeHtml(engine) + '</div></div>';
  html += '<div><div class="ac-detail-label">Starlink</div><div class="ac-detail-value" style="color:' + (isSL ? 'var(--ua-green)' : 'var(--ua-muted)') + '">' + (isSL ? 'Yes ⚡' : 'No') + '</div></div>';
  if (ac.c) html += '<div><div class="ac-detail-label">Config</div><div class="ac-detail-value">' + escapeHtml(ac.c) + '</div></div>';
  html += '</div></div>';

  // Fleet health status
  html += '<div class="ac-section"><div class="ac-section-title">Status</div>';
  html += '<span class="ac-status-badge" style="background:' + catInfo.color + '22;color:' + catInfo.color + ';border:1px solid ' + catInfo.color + '44">' + escapeHtml(catInfo.label) + '</span>';
  if (ac.s && !ac.s.startsWith('*')) html += '<span style="font-size:10px;color:var(--ua-muted);margin-left:8px">' + escapeHtml(ac.s) + '</span>';
  html += '</div>';

  // Live flight status
  if (liveFlight) {
    html += '<div class="ac-section ac-live-flight" data-action="focus-live-flight" data-icao24="' + escapeHtml(liveFlight.icao24) + '" role="button" tabindex="0" aria-label="View flight on map">';
  } else {
    html += '<div class="ac-section ac-live-ground">';
  }
  html += '<div class="ac-section-title" style="display:flex;justify-content:space-between;align-items:center">Live Status';
  if (liveFlight) html += '<span style="font-size:10px;font-weight:400;color:var(--ua-muted)">View on map →</span>';
  html += '</div>';
  if (liveFlight) {
    var fltNum = liveFlight.flightIATA || liveFlight.callsign || '?';
    var origCode = liveFlight.origin || '?';
    var destCode = liveFlight.dest || '?';
    var origCity = IATA_CITIES[origCode] || '';
    var destCity = IATA_CITIES[destCode] || '';
    var altFt = liveFlight.alt ? Math.round(liveFlight.alt * 3.28084) : null;
    var spdKts = liveFlight.spd ? Math.round(liveFlight.spd * 1.944) : null;
    var phaseInfo = getPhase(liveFlight.alt, liveFlight.vr, liveFlight.spd);

    html += '<div style="font-size:13px;font-weight:700;color:var(--ua-green);margin-bottom:6px">' + phaseInfo.icon + ' Airborne — ' + escapeHtml(fltNum) + '</div>';
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:4px">';
    if (origCity && destCity) html += escapeHtml(origCity) + ' → ' + escapeHtml(destCity) + ' ';
    html += '<span style="color:var(--ua-muted);font-size:10px">' + escapeHtml(origCode) + ' → ' + escapeHtml(destCode) + '</span></div>';
    html += '<div class="ac-detail-grid" style="margin-top:6px">';
    html += '<div><div class="ac-detail-label">Altitude</div><div class="ac-detail-value">' + (altFt ? altFt.toLocaleString() + ' ft' : '—') + '</div></div>';
    html += '<div><div class="ac-detail-label">Speed</div><div class="ac-detail-value">' + (spdKts ? spdKts + ' kts' : '—') + '</div></div>';
    html += '<div><div class="ac-detail-label">Heading</div><div class="ac-detail-value">' + (liveFlight.hdg ? Math.round(liveFlight.hdg) + '°' : '—') + '</div></div>';
    html += '<div><div class="ac-detail-label">Phase</div><div class="ac-detail-value">' + escapeHtml(phaseInfo.phase) + '</div></div>';
    html += '</div>';
  } else {
    html += '<div style="font-size:11px;color:var(--ua-muted)">On ground / Not currently tracked</div>';
  }
  html += '</div>';

  // Seat configuration
  if (ac.seats && Object.keys(ac.seats).length > 0) {
    html += '<div class="ac-section"><div class="ac-section-title">Seat Configuration</div>';
    html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">';
    Object.entries(ac.seats).forEach(function(entry) {
      html += '<span class="seat-block seat-' + entry[0] + '">' + entry[1] + entry[0] + '</span>';
    });
    if (ac.tot) html += '<span style="font-size:9px;color:var(--ua-muted);align-self:center;margin-left:2px">(' + ac.tot + ' total)</span>';
    html += '</div>';
    // Proportional bar
    html += '<div class="ac-seat-bar">';
    Object.entries(ac.seats).forEach(function(entry) {
      var pct = ac.tot ? (entry[1] / ac.tot * 100) : 0;
      var barColor = SEAT_BAR_COLORS[entry[0]] || 'rgba(100,116,139,.5)';
      html += '<div style="flex:' + entry[1] + ';background:' + barColor + '">' + (pct > 8 ? entry[1] + entry[0] : '') + '</div>';
    });
    html += '</div>';
    html += '</div>';
  }

  html += '</div>'; // end body

  // ── Footer ──
  html += '<div class="ac-modal-footer">';
  if (liveFlight) {
    var watchFlt = liveFlight.flightIATA || liveFlight.callsign || '';
    var watchRoute = (liveFlight.origin || '?') + '→' + (liveFlight.dest || '?');
    var watched = watchFlt ? isFlightWatched(watchFlt) : false;
    html += '<button class="ac-action-btn watch-btn' + (watched ? ' watching' : '') + '" data-action="toggle-watch-flight" data-flight="' + escapeHtml(watchFlt) + '" data-route="' + escapeHtml(watchRoute) + '" data-status="airborne" data-stop-prop="1">' + (watched ? ICO_WATCHING + ' Watching' : ICO_WATCH + ' Watch') + '</button>';
  }
  html += '<a class="ac-action-btn" href="https://www.planespotters.net/search?q=' + encodeURIComponent(reg) + '" target="_blank" rel="noopener noreferrer">Planespotters ' + ICO_EXTLINK + '</a>';
  html += '<a class="ac-action-btn" href="https://flightaware.com/resources/registration/' + encodeURIComponent(reg) + '" target="_blank" rel="noopener noreferrer">FlightAware ' + ICO_EXTLINK + '</a>';
  html += '<button class="ac-action-btn" data-action="share-aircraft" data-reg="' + escapeHtml(reg) + '">' + ICO_SHARE + ' Share</button>';
  html += '</div>';

  html += '</div>'; // end card
  return html;
}

// ═══ FR24 FLIGHT LOOKUP ═══
function lookupFR24Flight(query) {
  let q = query.trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d{1,4}$/.test(q)) q = 'UA' + q;
  if (q.startsWith('UAL') && /\d/.test(q[3])) q = 'UA' + q.slice(3);

  // Show loading modal
  let modal = document.getElementById('fr24-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fr24-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);backdrop-filter:blur(4px)';
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = '<div style="background:var(--ua-panel);border:1px solid var(--ua-border);border-radius:10px;padding:24px;max-width:420px;width:90%;color:var(--ua-text);font-family:var(--font-mono);position:relative"><div style="text-align:center;padding:20px;color:var(--ua-muted)"><div style="font-size:24px;margin-bottom:8px">🔍</div>Looking up ' + escapeHtml(q) + '...</div></div>';

  fetch('/api/fr24-flight?flight=' + encodeURIComponent(q))
    .then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(b => Promise.reject(new Error(b.error || 'HTTP ' + r.status))))
    .then(data => {
      if (!data.success || !data.flight) {
        // Failure is never a blocking modal (audit Jul 3 2026): close the loading
        // modal and render inline error text under the header search field. Modal
        // fallback only if the inline slot is missing from the DOM.
        const msg = (data.error || 'No data found for ' + q) + ' — the flight may not be active right now. Check the Schedule tab for gate status.';
        if (showGlobalSearchError(msg)) {
          modal.style.display = 'none';
        } else {
          modal.innerHTML = '<div style="background:var(--ua-panel);border:1px solid var(--ua-border);border-radius:10px;padding:24px;max-width:420px;width:90%;color:var(--ua-text);font-family:var(--font-mono);position:relative"><button data-action="close-fr24-modal" aria-label="Close" style="position:absolute;top:8px;right:12px;background:none;border:none;color:var(--ua-muted);cursor:pointer;font-size:16px">✕</button><div style="text-align:center;padding:20px"><div style="font-size:24px;margin-bottom:8px">✈️</div><div style="color:var(--ua-muted);font-size:11px">' + escapeHtml(data.error || 'No data found for ' + q) + '</div><div style="margin-top:12px;font-size:9px;color:var(--ua-muted)">The flight may not be active right now.<br>Check the Schedule tab for gate status.</div></div></div>';
        }
        return;
      }
      renderFR24Modal(data.flight, data.source, data.cached, data);
    })
    .catch(err => {
      console.error('FR24 lookup error:', err);
      if (showGlobalSearchError('Lookup failed for ' + q + ' — try again in a moment.')) {
        modal.style.display = 'none';
      } else {
        modal.innerHTML = '<div style="background:var(--ua-panel);border:1px solid var(--ua-border);border-radius:10px;padding:24px;max-width:420px;width:90%;color:var(--ua-text);font-family:var(--font-mono);position:relative"><button data-action="close-fr24-modal" aria-label="Close" style="position:absolute;top:8px;right:12px;background:none;border:none;color:var(--ua-muted);cursor:pointer;font-size:16px">✕</button><div style="text-align:center;padding:20px;color:var(--ua-muted)"><div style="font-size:24px;margin-bottom:8px">⚠️</div>Failed to look up flight. Try again later.</div></div>';
      }
    });
}

function renderFR24Modal(f, source, cached, meta) {
  var modal = document.getElementById('fr24-modal');
  var statusColors = {'en-route':'#22c55e','on-ground':'#f59e0b','landed':'#3b82f6','scheduled':'#6b7280','unknown':'#6b7280'};
  var statusColor = statusColors[f.status] || statusColors['unknown'];
  var statusLabel = (f.status || 'unknown').replace(/-/g, ' ');

  // Cross-reference with FLEET_DB for enrichment
  var fleetInfo = '';
  if (f.aircraft && f.aircraft.reg && typeof FLEET_DB !== 'undefined') {
    var match = FLEET_DB.find(function(a) { return a.r === f.aircraft.reg; });
    if (match) {
      fleetInfo = '<div style="margin-top:8px;padding:8px;background:rgba(0,93,170,.1);border-radius:4px;font-size:10px">' +
        '<span style="color:var(--ua-accent)">Fleet Match:</span> ' + escapeHtml(match.t) +
        (match.c ? ' • ' + escapeHtml(match.c) : '') +
        (match.w ? ' • WiFi: ' + escapeHtml(normalizeWifi(match.w)) : '') +
        '</div>';
    }
  }

  var posHtml = '';
  if (f.position && f.position.lat != null && f.position.lon != null) {
    posHtml = '<div style="margin-top:8px;padding:8px;background:rgba(15,23,41,.6);border-radius:4px;font-size:10px">' +
      '<span style="color:var(--ua-muted)">Position:</span> ' + Number(f.position.lat).toFixed(2) + '°, ' + Number(f.position.lon).toFixed(2) + '°' +
      (f.position.alt != null ? ' • ' + f.position.alt.toLocaleString() + ' ft' : '') +
      (f.position.speed != null ? ' • ' + f.position.speed + ' kts' : '') +
      (f.position.heading != null ? ' • hdg ' + f.position.heading + '°' : '') +
      '</div>';
  }

  function fmtTime(t) {
    if (!t) return '—';
    try { var d = new Date(typeof t === 'number' ? t * 1000 : t); return isNaN(d) ? String(t) : d.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',timeZoneName:'short'}); }
    catch(e) { return String(t); }
  }

  var html = '<div style="background:var(--ua-panel);border:1px solid var(--ua-border);border-radius:10px;padding:0;max-width:420px;width:90%;color:var(--ua-text);font-family:var(--font-mono);position:relative;overflow:hidden">';
  // Header
  html += '<div style="background:linear-gradient(135deg,rgba(0,93,170,.3),rgba(0,50,100,.2));padding:16px 20px;border-bottom:1px solid var(--ua-border)">';
  html += '<button data-action="close-fr24-modal" aria-label="Close" style="position:absolute;top:8px;right:12px;background:none;border:none;color:var(--ua-muted);cursor:pointer;font-size:16px">✕</button>';
  html += '<div style="font-size:16px;font-weight:700;color:var(--ua-accent)">' + escapeHtml(f.flightNumber || '?') + '</div>';
  if (f.callsign) html += '<div style="font-size:10px;color:var(--ua-muted)">' + escapeHtml(f.callsign) + '</div>';
  html += '<div style="margin-top:6px"><span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:600;background:' + statusColor + '22;color:' + statusColor + ';border:1px solid ' + statusColor + '44">' + escapeHtml(statusLabel.toUpperCase()) + '</span></div>';
  html += '</div>';
  // Body
  html += '<div style="padding:16px 20px">';
  // Route
  var origLabel = (f.origin && f.origin.iata) ? f.origin.iata : '?';
  var destLabel = (f.destination && f.destination.iata) ? f.destination.iata : '?';
  var origName = (f.origin && f.origin.name) ? f.origin.name : '';
  var destName = (f.destination && f.destination.name) ? f.destination.name : '';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
  html += '<div style="text-align:center"><div style="font-size:18px;font-weight:700">' + escapeHtml(origLabel) + '</div><div style="font-size:9px;color:var(--ua-muted);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(origName) + '</div></div>';
  html += '<div style="flex:1;text-align:center;color:var(--ua-muted);font-size:16px">✈ →</div>';
  html += '<div style="text-align:center"><div style="font-size:18px;font-weight:700">' + escapeHtml(destLabel) + '</div><div style="font-size:9px;color:var(--ua-muted);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(destName) + '</div></div>';
  html += '</div>';
  // F048: the live/summary tier returns whichever leg of this flight number is
  // currently active or most recent — not necessarily the user's date/route.
  // Surface the leg's date and a one-line disclaimer so the modal isn't silently
  // authoritative. Label only (no ranking change).
  var liveLeg = !!(meta && meta.liveLeg) || (String(source || '').indexOf('live') !== -1);
  if (liveLeg) {
    var legDateStr = '';
    var ld = meta && meta.legDate;
    if (ld) { try { var ldd = new Date(ld); if (!isNaN(ldd)) legDateStr = ldd.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'}); } catch(e) {} }
    html += '<div style="margin-bottom:10px;padding:7px 10px;background:var(--ua-amber-soft);border-left:3px solid var(--ua-amber);border-radius:0 4px 4px 0;font-size:9px;line-height:1.5;color:var(--ua-muted)">'
      + (legDateStr ? '<span style="color:var(--ua-amber);font-weight:600">Leg date: ' + escapeHtml(legDateStr) + '</span><br>' : '')
      + 'Flight numbers fly multiple legs daily — this is the leg currently active or most recent, not necessarily your date or route.'
      + '</div>';
  }
  // Aircraft
  if (f.aircraft && (f.aircraft.type || f.aircraft.reg)) {
    html += '<div style="font-size:10px;margin-bottom:4px"><span style="color:var(--ua-muted)">Aircraft:</span> ' + escapeHtml(f.aircraft.type || '?') + (f.aircraft.reg ? ' • <span class="ac-reg-link" data-action="aircraft-detail" data-reg="' + escapeHtml(f.aircraft.reg) + '">' + escapeHtml(f.aircraft.reg) + '</span>' : '') + '</div>';
  }
  // Times
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;font-size:10px">';
  html += '<div><span style="color:var(--ua-muted)">Dep Sched:</span><br>' + escapeHtml(fmtTime(f.departure?.scheduled)) + '</div>';
  html += '<div><span style="color:var(--ua-muted)">Dep Actual:</span><br>' + escapeHtml(fmtTime(f.departure?.actual)) + '</div>';
  html += '<div><span style="color:var(--ua-muted)">Arr Sched:</span><br>' + escapeHtml(fmtTime(f.arrival?.scheduled)) + '</div>';
  html += '<div><span style="color:var(--ua-muted)">Arr Est:</span><br>' + escapeHtml(fmtTime(f.arrival?.estimated)) + '</div>';
  html += '</div>';
  html += fleetInfo;
  html += posHtml;
  html += '</div>';
  // Footer
  html += '<div style="padding:10px 20px;border-top:1px solid var(--ua-border);display:flex;justify-content:space-between;align-items:center">';
  html += '<div style="font-size:8px;color:var(--ua-muted)">Powered by Flightradar24 Official API' + (cached ? ' • cached' : '') + '</div>';
  html += '<button class="share-btn" data-action="share-flight" data-flight="' + escapeHtml(f.flightNumber || '') + '" aria-label="Share flight link" title="Copy shareable link">' + ICO_SHARE + ' Share</button>';
  html += '</div>';
  html += '</div>';

  modal.innerHTML = html;
}

// Expose functions/vars needed by JS-generated onclick handlers (IIFE scope → global scope)
window.loadScheduleData = loadScheduleData;
window.escapeHtml = escapeHtml;
window.focusWatchedFlight = focusWatchedFlight;
window.hideDisclaimer = hideDisclaimer;
window.schedCache = schedCache;
