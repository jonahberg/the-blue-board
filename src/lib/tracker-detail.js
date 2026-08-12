// @ts-check

import { atcAirports, unitedHubs, unitedProjects } from '../data/trackers/index.js';

export const unitedHubDetailCodes = Object.keys(unitedHubs);
const atcCodeSet = new Set(atcAirports.map((airport) => airport.code));
export const atcHubDetailCodes = unitedHubDetailCodes.filter((code) => atcCodeSet.has(code));

export const trackerParentSeo = {
  index: {
    title: 'Aviation Trackers: FAA Modernization & United Hubs',
    description: 'Track the FAA’s electronic flight strip rollout and United’s hub construction projects with sourced maps, airport-level data, and monthly updates.',
  },
  atc: {
    title: 'FAA Electronic Flight Strips Tracker: 89 Airports',
    description: `The FAA is replacing paper flight strips at 89 airport towers. Live airport-by-airport TFDM tracker: ${atcAirports.filter((airport) => airport.status === 'live').length} airports digital, ${atcAirports.filter((airport) => airport.status !== 'live').length} still on paper. Check yours.`,
  },
  'united-hubs': {
    title: 'United Hub Construction Tracker: Clubs, Gates & Terminals',
    description: 'Track every United hub construction project: new clubs, terminals and gates at all eight hubs, with sourced status, dates and monthly verification.',
  },
};

/** @param {string | undefined} value */
export function formatTrackerDate(value) {
  if (!value) return 'No published date';
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return value;
  const normalized = value.length === 7 ? `${value}-15` : value;
  return new Date(`${normalized}T12:00:00Z`).toLocaleDateString('en-US',
    value.length === 7
      ? { month: 'long', year: 'numeric' }
      : { month: 'long', day: 'numeric', year: 'numeric' }
  );
}

/** @param {number | undefined} value */
export function formatCompactNumber(value) {
  if (!value) return '';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** @param {number} count @param {string} singular */
export function countLabel(count, singular) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** @param {string} code */
export function getHubProjects(code) {
  return unitedProjects.filter((project) => project.hub === code);
}

/** @param {string} code */
export function getAtcAirport(code) {
  return atcAirports.find((airport) => airport.code === code);
}

/** @param {string} code @param {number} projectCount */
export function unitedHubSeo(code, projectCount) {
  return {
    title: `United ${code} Construction Tracker: Clubs, Gates & Terminals`,
    description: `Track ${countLabel(projectCount, 'United project')} at ${code}: clubs, terminals and gates, with sourced status, dates and monthly verification.`,
  };
}

/** @param {{code: string, name: string}} airport */
export function atcAirportSeo(airport) {
  return {
    title: `${airport.code} Electronic Flight Strips: FAA TFDM Status`,
    description: `Does ${airport.code} use electronic flight strips? See the FAA TFDM status, published timeline, sources and latest verification for ${airport.name}.`,
  };
}
