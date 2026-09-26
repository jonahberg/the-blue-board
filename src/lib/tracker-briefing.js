// ═══ TRACKER BRIEFING (Weather tab) ═══
// The "Infrastructure watch" card: a generic line about the tracker corpus until the
// visitor has set a home hub, and a two-fact local briefing once they have.
//
// Extracted verbatim from src/dashboard/main.js (:255-303 updateTrackerBriefing). Pure:
// the tracker data and the `bb_tracker_watches` list are injected, so the copy and the
// deep links are testable without a DOM or localStorage.

/** @type {Record<string, string>} */
export const TRACKER_STATUS_LABEL = {
  live: 'Tower is live on electronic flight strips',
  'in-progress': 'Tower modernization is in progress',
  planned: "Tower has a date in the FAA's 2023 sequence",
  paper: 'Tower is still on paper with no published date',
};

/**
 * @typedef {Object} TrackerBriefing
 * @property {string} title
 * @property {string} summary
 * @property {{href: string, text: string}} hubLink
 * @property {{href: string, text: string}} atcLink
 * @property {string} watchText
 * @property {boolean} home  true when this is the home-hub branch.
 */

/**
 * @param {Object} input
 * @param {string} [input.home]  the viewer's home hub IATA, '' when unset.
 * @param {Array<{code: string, status: string}>} input.atcAirports
 * @param {{lastVerified: string}} input.atcMeta
 * @param {{lastVerified: string}} input.unitedHubsMeta
 * @param {Array<{id: string, hub: string, status: string}>} input.unitedProjects
 * @param {Array<{slug: string, id: string}>} [input.watches]  `bb_tracker_watches`.
 * @returns {TrackerBriefing}
 */
export function buildTrackerBriefing({
  home,
  atcAirports,
  atcMeta,
  unitedHubsMeta,
  unitedProjects,
  watches = [],
}) {
  const code = String(home || '').toUpperCase();
  const airport = (atcAirports || []).find((entry) => entry.code === code) || null;
  const projects = (unitedProjects || []).filter((project) => project.hub === code);
  const activeProjects = projects.filter(
    (project) => project.status === 'under-construction' || project.status === 'announced',
  ).length;

  // No home hub, or a home hub the trackers say nothing about → the corpus-wide line.
  if (!code || (!airport && projects.length === 0)) {
    const liveCount = (atcAirports || []).filter((item) => item.status === 'live').length;
    return {
      home: false,
      title: 'Infrastructure trackers',
      summary:
        `${liveCount} of ${(atcAirports || []).length} towers are digital. `
        + `${(unitedProjects || []).length} projects are tracked across United's eight hubs. `
        + 'Set a home hub for the local briefing.',
      hubLink: { href: '/trackers/united-hubs', text: 'All hub projects →' },
      atcLink: { href: '/trackers/atc', text: 'All 89 towers →' },
      watchText: `Verified ${atcMeta.lastVerified}`,
    };
  }

  const facts = [];
  if (airport) facts.push(TRACKER_STATUS_LABEL[airport.status] || 'tower status is tracked');
  if (projects.length) {
    facts.push(
      `${projects.length} hub ${projects.length === 1 ? 'project' : 'projects'}, ${activeProjects} active or announced`,
    );
  }

  const slug = code.toLowerCase();
  const watchedIds = new Set((watches || []).map((item) => `${item.slug}:${item.id}`));
  const watchingHub =
    watchedIds.has(`united-hubs:${slug}`)
    || projects.some((project) => watchedIds.has(`united-hubs:${project.id}`));
  const watchingAtc = watchedIds.has(`atc:${slug}`);

  return {
    home: true,
    title: `${code} infrastructure briefing`,
    summary: `${facts.join('. ')}.`,
    hubLink: projects.length
      ? { href: `/trackers/united-hubs/${slug}`, text: `${code} projects →` }
      : { href: '/trackers/united-hubs', text: 'Hub projects →' },
    atcLink: airport
      ? {
          // A hub with projects has its own combined page; otherwise deep-link the row.
          href: projects.length ? `/trackers/atc/${slug}` : `/trackers/atc#row-${slug}`,
          text: `${code} tower →`,
        }
      : { href: '/trackers/atc', text: 'Tower modernization →' },
    watchText:
      watchingHub || watchingAtc
        ? 'Watching on this device'
        : `Verified ${unitedHubsMeta.lastVerified}`,
  };
}

/**
 * Parse `bb_tracker_watches` (written by the tracker pages, read here — inventory §29).
 * @param {string|null|undefined} raw
 * @returns {Array<{slug: string, id: string}>}
 */
export function parseTrackerWatches(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.slug && item.id) : [];
  } catch (e) {
    return [];
  }
}
