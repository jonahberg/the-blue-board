import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAIN = readFileSync(fileURLToPath(new URL('../src/dashboard/main.js', import.meta.url)), 'utf8');

/**
 * Every function extracted into src/lib during the dashboard-logic refactor, mapped to
 * the module that now owns it. main.js must IMPORT each one, not define it — otherwise
 * the React port would inherit a second, drifting copy.
 */
const EXTRACTED_FUNCTIONS = {
  'src/lib/flight-phase.js': ['getPhase', 'getPhaseGroup', 'decodeSquawk'],
  'src/lib/geo.js': ['haversineNm', 'bearing', 'angleDiff', 'greatCirclePoints', 'normalizeLonContinuity', 'isLonghaul'],
  'src/lib/airports.js': ['cityFor', 'nearestAirport'],
  'src/lib/route-estimate.js': ['estimateRoute'],
  'src/lib/plane-icon.js': ['planeIconSpec'],
  'src/lib/metar-explain.js': ['parseMetarQuick', 'applyStructuredMetarFallback', 'formatStructuredVisibility', 'hasRenderableMetarData', 'explainMETAR', 'worstCategory'],
  'src/lib/faa-context.js': ['buildFaaIndex', 'explainFAAStatus', 'getFAADelayContext'],
  'src/lib/nas-severity.js': ['detectSevType', 'sevBadgeClass', 'tierNasEvents'],
  'src/lib/hub-health.js': ['computeBoardOtp', 'mergeHubHealth', 'serverOtpFromMetrics', 'hubHealthSeverity', 'networkLabel'],
  'src/lib/starlink-view.js': ['isRecentlyFound', 'getServedConflictTails', 'formatFlightTime', 'airborneByTail', 'boardCapPolicy'],
  'src/lib/watch-utils.js': ['readWatched', 'writeWatched', 'isSignificantStatusChange', 'flightTimesCacheTtl'],
  'src/lib/journey.js': ['shapeJourney', 'journeyDelayClass', 'buildJourneyContextStr'],
  'src/lib/special-aircraft.js': ['indexSpecialAircraft'],
  'src/lib/equipment-swaps.js': ['getTypicalFleetStats', 'detectEquipmentSwaps'],
  'src/lib/hub-terminals.js': ['getUnitedTerminal'],
  'src/lib/home-airport.js': ['readHomeAirport', 'writeHomeAirport', 'nextHomeAirport'],
  'src/lib/tips.js': ['pickTip'],
  'src/lib/ticker.js': ['buildTickerItems'],
  'src/lib/live-stats.js': ['computeLiveStats'],
  'src/lib/analytics.js': ['typeUtilization', 'phaseBreakdown', 'hubMatrix', 'topRoutes', 'avgAgeByType'],
  'src/lib/global-search.js': ['normalizeQuery', 'matchLiveFlights', 'matchScheduleFlights', 'classifyEmptyState'],
  'src/lib/engagement.js': ['shouldShowOnboarding', 'waitlistState', 'bmacEligible'],
};

/**
 * Data tables that moved out with them. `function X(` says nothing about a const, so
 * these are checked separately — otherwise a re-pasted AIRPORTS array would sail past.
 */
const EXTRACTED_CONSTANTS = {
  'src/lib/airports.js': ['AIRPORTS', 'AIRPORT_COORDS', 'IATA_CITIES'],
  'src/lib/route-estimate.js': ['UA_ROUTES'],
  'src/lib/flight-phase.js': ['PHASE_ICONS'],
  'src/lib/special-aircraft.js': ['ENGINE_BY_TYPE', 'SEAT_BAR_COLORS', 'CABIN_COLORS'],
  'src/lib/equipment-swaps.js': ['ICAO_TO_FLEET_TYPE'],
  'src/lib/hub-terminals.js': ['UNITED_HUB_TERMINALS'],
  'src/lib/home-airport.js': ['HOME_HUB_CYCLE'],
  'src/lib/tips.js': ['TIPS'],
  'src/lib/nas-severity.js': ['SEV_LABELS'],
  'src/lib/metar-explain.js': ['CAT_COLORS', 'CAT_RANK'],
  'src/lib/hub-health.js': ['HUB_ORDER'],
};

const allFunctions = Object.entries(EXTRACTED_FUNCTIONS).flatMap(([mod, names]) => names.map((n) => [mod, n]));
const allConstants = Object.entries(EXTRACTED_CONSTANTS).flatMap(([mod, names]) => names.map((n) => [mod, n]));

describe('src/dashboard/main.js no longer defines extracted functions', () => {
  it.each(allFunctions)('%s owns %s', (_mod, name) => {
    const declaration = new RegExp(`(^|\\n)\\s*(async\\s+)?function\\s+${name}\\s*\\(`);
    expect(declaration.test(MAIN), `main.js still declares function ${name}()`).toBe(false);
  });
});

describe('src/dashboard/main.js no longer defines extracted data tables', () => {
  it.each(allConstants)('%s owns %s', (_mod, name) => {
    const declaration = new RegExp(`(^|\\n)\\s*(const|let|var)\\s+${name}\\s*=`);
    expect(declaration.test(MAIN), `main.js still declares ${name}`).toBe(false);
  });
});

describe('src/dashboard/main.js imports what it uses', () => {
  it.each(Object.keys(EXTRACTED_FUNCTIONS))('imports from %s', (mod) => {
    const spec = mod.replace('src/lib/', '../lib/');
    expect(MAIN.includes(`from '${spec}'`), `main.js does not import ${spec}`).toBe(true);
  });
});

describe('extracted modules stay free of browser globals', () => {
  const MODULES = [...new Set([...Object.keys(EXTRACTED_FUNCTIONS), ...Object.keys(EXTRACTED_CONSTANTS)])];

  it.each(MODULES)('%s touches no DOM, storage or Leaflet', (mod) => {
    const src = readFileSync(fileURLToPath(new URL('../' + mod, import.meta.url)), 'utf8');
    // Strip comments so prose like "main.js wraps it in L.divIcon" does not trip the check.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
    expect(/\bdocument\./.test(code), `${mod} touches document`).toBe(false);
    expect(/\bwindow\./.test(code), `${mod} touches window`).toBe(false);
    expect(/\blocalStorage\b/.test(code), `${mod} touches localStorage`).toBe(false);
    expect(/\bsessionStorage\b/.test(code), `${mod} touches sessionStorage`).toBe(false);
    expect(/\bL\.[a-zA-Z]/.test(code), `${mod} touches Leaflet`).toBe(false);
  });
});
