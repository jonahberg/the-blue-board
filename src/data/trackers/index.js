// @ts-check
/**
 * Trackers — barrel + data validation.
 *
 * validate() runs at import time, so a bad record fails `bun run build` (and `astro build` on
 * Vercel) immediately — this is the enforcement layer for the tracker data files, same pattern
 * as src/data/news/index.js. tests/tracker-data.test.js mirrors these rules and adds cross-file
 * invariants.
 */

import { atcMeta, atcAirports } from './atc.js';
import { unitedHubsMeta, unitedHubs, unitedProjects } from './united-hubs.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IATA_RE = /^[A-Z]{3}$/;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_OR_DAY_RE = /^\d{4}-\d{2}(-\d{2})?$/;

const ATC_STATUSES = new Set(['live', 'in-progress', 'planned', 'paper']);
const PROJECT_TYPES = new Set(['club', 'polaris', 'club-fly', 'terminal', 'gates', 'other']);
const PROJECT_STATUSES = new Set(['open', 'under-construction', 'announced', 'rumored']);
const BUILDERS = new Set(['united', 'airport-authority', 'joint']);

/** @param {string} where @param {string} msg */
function fail(where, msg) {
  throw new Error(`trackers data invalid [${where}]: ${msg}`);
}

/** @param {string} where @param {any} entry */
function checkCommon(where, entry) {
  if (!SLUG_RE.test(entry.id)) fail(where, `bad id "${entry.id}"`);
  if (typeof entry.lat !== 'number' || entry.lat < -90 || entry.lat > 90) fail(where, `${entry.id}: bad lat`);
  if (typeof entry.lng !== 'number' || entry.lng < -180 || entry.lng > 180 || entry.lng === 0) fail(where, `${entry.id}: bad lng`);
  if (!Array.isArray(entry.sources) || entry.sources.length === 0) fail(where, `${entry.id}: needs at least one source`);
  for (const s of entry.sources) {
    if (typeof s !== 'string' || !s.startsWith('https://')) fail(where, `${entry.id}: non-https source "${s}"`);
  }
}

/** @param {string} where @param {{lastUpdated: string, lastVerified: string, changelog: {date: string, entry: string}[]}} meta */
function checkMeta(where, meta) {
  if (!ISO_DAY_RE.test(meta.lastUpdated)) fail(where, `lastUpdated "${meta.lastUpdated}" is not YYYY-MM-DD`);
  if (!ISO_DAY_RE.test(meta.lastVerified)) fail(where, `lastVerified "${meta.lastVerified}" is not YYYY-MM-DD`);
  if (meta.lastVerified < meta.lastUpdated) fail(where, 'lastVerified cannot be older than lastUpdated');
  if (!Array.isArray(meta.changelog) || meta.changelog.length === 0) fail(where, 'changelog is empty');
  let prev = '9999-99-99';
  for (const c of meta.changelog) {
    if (!ISO_DAY_RE.test(c.date)) fail(where, `changelog date "${c.date}" is not YYYY-MM-DD`);
    if (!c.entry || typeof c.entry !== 'string') fail(where, `changelog ${c.date}: empty entry`);
    if (c.date > prev) fail(where, `changelog out of order at ${c.date} — keep reverse-chronological`);
    prev = c.date;
  }
  if (meta.changelog[0].date > meta.lastUpdated) fail(where, 'newest changelog entry is newer than lastUpdated');
}

function validate() {
  // ── ATC ──
  checkMeta('atc', atcMeta);
  const atcIds = new Set();
  for (const a of atcAirports) {
    checkCommon('atc', a);
    if (atcIds.has(a.id)) fail('atc', `duplicate id ${a.id}`);
    atcIds.add(a.id);
    if (!IATA_RE.test(a.code)) fail('atc', `${a.id}: bad IATA "${a.code}"`);
    if (a.id !== a.code.toLowerCase()) fail('atc', `${a.id}: id must be lowercase IATA`);
    if (!ATC_STATUSES.has(a.status)) fail('atc', `${a.id}: bad status "${a.status}"`);
    if (!a.name || !a.city || !/^[A-Z]{2}$/.test(a.state)) fail('atc', `${a.id}: name/city/state incomplete`);
    if (a.goLiveDate !== undefined && !ISO_MONTH_OR_DAY_RE.test(a.goLiveDate)) fail('atc', `${a.id}: bad goLiveDate`);
    if (a.plannedIoc !== undefined && !ISO_DAY_RE.test(a.plannedIoc)) fail('atc', `${a.id}: bad plannedIoc`);
    if (a.status === 'live' && a.plannedIoc) fail('atc', `${a.id}: live entries carry goLiveDate, not plannedIoc`);
    if (a.status === 'planned' && !a.plannedIoc) fail('atc', `${a.id}: planned entries need their waterfall plannedIoc`);
    if (a.status === 'paper' && (a.goLiveDate || a.plannedIoc)) fail('atc', `${a.id}: paper means no published dates`);
    if (a.goLiveDate && a.status !== 'live') fail('atc', `${a.id}: goLiveDate on a non-live entry`);
  }

  // ── United ──
  checkMeta('united-hubs', unitedHubsMeta);
  for (const [iata, h] of Object.entries(unitedHubs)) {
    if (!IATA_RE.test(iata)) fail('united-hubs', `bad hub key "${iata}"`);
    if (!h.name || !h.city || !/^[A-Z]{2}$/.test(h.state)) fail('united-hubs', `${iata}: name/city/state incomplete`);
    if (typeof h.lat !== 'number' || typeof h.lng !== 'number') fail('united-hubs', `${iata}: missing coords`);
  }
  const projIds = new Set();
  for (const p of unitedProjects) {
    checkCommon('united-hubs', { ...p, lat: unitedHubs[p.hub]?.lat ?? NaN, lng: unitedHubs[p.hub]?.lng ?? NaN });
    if (projIds.has(p.id)) fail('united-hubs', `duplicate id ${p.id}`);
    projIds.add(p.id);
    if (!(p.hub in unitedHubs)) fail('united-hubs', `${p.id}: unknown hub "${p.hub}"`);
    if (!p.id.startsWith(`${p.hub.toLowerCase()}-`)) fail('united-hubs', `${p.id}: id must start with its hub code`);
    if (!PROJECT_TYPES.has(p.projectType)) fail('united-hubs', `${p.id}: bad projectType "${p.projectType}"`);
    if (!PROJECT_STATUSES.has(p.status)) fail('united-hubs', `${p.id}: bad status "${p.status}"`);
    if (!BUILDERS.has(p.builder)) fail('united-hubs', `${p.id}: bad builder "${p.builder}"`);
    if (!p.details || p.details.length < 40) fail('united-hubs', `${p.id}: details too thin`);
    if (p.status === 'open' && !p.openedDate) fail('united-hubs', `${p.id}: open projects need openedDate`);
    if (p.openedDate !== undefined && !ISO_MONTH_OR_DAY_RE.test(p.openedDate)) fail('united-hubs', `${p.id}: bad openedDate`);
    if (p.status !== 'open' && p.openedDate) fail('united-hubs', `${p.id}: openedDate on a non-open project`);
    if (p.status === 'rumored' && p.targetDate) fail('united-hubs', `${p.id}: rumors don't get target dates`);
    for (const n of /** @type {const} */ (['sizeSqFt', 'costUsd', 'gates'])) {
      if (p[n] !== undefined && (typeof p[n] !== 'number' || p[n] <= 0)) fail('united-hubs', `${p.id}: bad ${n}`);
    }
  }
}

validate();

export { atcMeta, atcAirports, unitedHubsMeta, unitedHubs, unitedProjects };

export const trackerOrder = ['atc', 'united-hubs'];

export const trackerNavLabels = {
  atc: 'Modern Skies (ATC)',
  'united-hubs': 'United Hubs',
};

/** Summary rows for the /trackers index page. */
export const trackers = {
  atc: {
    slug: 'atc',
    name: atcMeta.name,
    href: '/trackers/atc',
    question: 'Is your airport still running on paper?',
    description:
      "The FAA is finally replacing paper flight strips at 89 airport towers. Airport-by-airport status of the rollout — who's live, who's next, who's still waiting.",
    lastUpdated: atcMeta.lastUpdated,
    lastVerified: atcMeta.lastVerified,
    entryCount: atcAirports.length,
    entryNoun: 'airports',
    metric: `${atcAirports.filter((a) => a.status === 'live').length}/${atcAirports.length} digital`,
    segments: [
      { label: 'Live', count: atcAirports.filter((a) => a.status === 'live').length, tone: 'green' },
      { label: 'Scheduled', count: atcAirports.filter((a) => a.status === 'planned').length, tone: 'amber' },
      { label: 'No date', count: atcAirports.filter((a) => a.status === 'paper').length, tone: 'dim' },
    ],
    latestChange: atcMeta.changelog[0],
  },
  'united-hubs': {
    slug: 'united-hubs',
    name: unitedHubsMeta.name,
    href: '/trackers/united-hubs',
    question: "What's changing at United's hubs?",
    description:
      "United's biggest ground buildout ever: every club, terminal, and gate project across all eight hubs — with honest labels for what's real, what's dated, and what's just a Kirby tease.",
    lastUpdated: unitedHubsMeta.lastUpdated,
    lastVerified: unitedHubsMeta.lastVerified,
    entryCount: unitedProjects.length,
    entryNoun: 'projects',
    metric: `${unitedProjects.filter((p) => p.status === 'under-construction' || p.status === 'announced').length} active`,
    segments: [
      { label: 'Building', count: unitedProjects.filter((p) => p.status === 'under-construction').length, tone: 'amber' },
      { label: 'Announced', count: unitedProjects.filter((p) => p.status === 'announced').length, tone: 'accent' },
      { label: 'Open', count: unitedProjects.filter((p) => p.status === 'open').length, tone: 'green' },
      { label: 'Rumored', count: unitedProjects.filter((p) => p.status === 'rumored').length, tone: 'dim' },
    ],
    latestChange: unitedHubsMeta.changelog[0],
  },
};
