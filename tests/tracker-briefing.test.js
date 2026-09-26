import { describe, it, expect } from 'vitest';
import {
  buildTrackerBriefing,
  parseTrackerWatches,
  TRACKER_STATUS_LABEL,
} from '../src/lib/tracker-briefing.js';
import { atcAirports, atcMeta, unitedHubsMeta, unitedProjects } from '../src/data/trackers/index.js';

const META = { atcMeta, unitedHubsMeta };

describe('buildTrackerBriefing — no home hub (generic copy)', () => {
  const briefing = buildTrackerBriefing({ home: '', atcAirports, unitedProjects, ...META });

  it('is the corpus-wide branch', () => {
    expect(briefing.home).toBe(false);
    expect(briefing.title).toBe('Infrastructure trackers');
  });

  it('counts live towers against the whole corpus and asks for a home hub', () => {
    const live = atcAirports.filter((a) => a.status === 'live').length;
    expect(briefing.summary).toContain(`${live} of ${atcAirports.length} towers are digital`);
    expect(briefing.summary).toContain(`${unitedProjects.length} projects are tracked`);
    expect(briefing.summary).toContain('Set a home hub for the local briefing.');
  });

  it('links the tracker indexes with the shipped labels', () => {
    expect(briefing.hubLink).toEqual({ href: '/trackers/united-hubs', text: 'All hub projects →' });
    expect(briefing.atcLink).toEqual({ href: '/trackers/atc', text: 'All 89 towers →' });
    expect(briefing.watchText).toBe(`Verified ${atcMeta.lastVerified}`);
  });

  it('also applies to a home airport the trackers say nothing about', () => {
    // PSP has neither a tracked tower nor a United hub project.
    const none = buildTrackerBriefing({ home: 'PSP', atcAirports, unitedProjects, ...META });
    expect(none.home).toBe(false);
  });
});

describe('buildTrackerBriefing — home hub branch', () => {
  it('titles and summarises the home hub from its tower status and projects', () => {
    const briefing = buildTrackerBriefing({ home: 'ORD', atcAirports, unitedProjects, ...META });
    const airport = atcAirports.find((a) => a.code === 'ORD');
    const projects = unitedProjects.filter((p) => p.hub === 'ORD');
    expect(briefing.home).toBe(true);
    expect(briefing.title).toBe('ORD infrastructure briefing');
    expect(briefing.summary).toContain(TRACKER_STATUS_LABEL[airport.status]);
    expect(briefing.summary).toContain(`${projects.length} hub project`);
    expect(briefing.summary.endsWith('.')).toBe(true);
  });

  it('deep-links the hub project page and the combined ATC page when both exist', () => {
    const briefing = buildTrackerBriefing({ home: 'ORD', atcAirports, unitedProjects, ...META });
    expect(briefing.hubLink).toEqual({ href: '/trackers/united-hubs/ord', text: 'ORD projects →' });
    expect(briefing.atcLink).toEqual({ href: '/trackers/atc/ord', text: 'ORD tower →' });
  });

  it('falls back to the #row- anchor when the hub has a tower but no projects', () => {
    const briefing = buildTrackerBriefing({
      home: 'BOS',
      atcAirports: [{ code: 'BOS', status: 'planned' }],
      unitedProjects: [],
      ...META,
    });
    expect(briefing.hubLink).toEqual({ href: '/trackers/united-hubs', text: 'Hub projects →' });
    expect(briefing.atcLink).toEqual({ href: '/trackers/atc#row-bos', text: 'BOS tower →' });
    expect(briefing.summary).toBe(`${TRACKER_STATUS_LABEL.planned}.`);
  });

  it('falls back to the ATC index when the hub has projects but no tracked tower', () => {
    const briefing = buildTrackerBriefing({
      home: 'GUM',
      atcAirports: [],
      unitedProjects: [{ id: 'gum-club', hub: 'GUM', status: 'announced' }],
      ...META,
    });
    expect(briefing.atcLink).toEqual({ href: '/trackers/atc', text: 'Tower modernization →' });
    expect(briefing.summary).toBe('1 hub project, 1 active or announced.');
  });

  it('counts only under-construction and announced projects as active', () => {
    const briefing = buildTrackerBriefing({
      home: 'DEN',
      atcAirports: [],
      unitedProjects: [
        { id: 'a', hub: 'DEN', status: 'under-construction' },
        { id: 'b', hub: 'DEN', status: 'announced' },
        { id: 'c', hub: 'DEN', status: 'open' },
        { id: 'd', hub: 'DEN', status: 'rumored' },
      ],
      ...META,
    });
    expect(briefing.summary).toBe('4 hub projects, 2 active or announced.');
  });
});

describe('buildTrackerBriefing — watch state (bb_tracker_watches)', () => {
  const base = {
    home: 'DEN',
    atcAirports: [{ code: 'DEN', status: 'live' }],
    unitedProjects: [{ id: 'den-polaris', hub: 'DEN', status: 'open' }],
    ...META,
  };

  it('says "Verified <date>" with nothing watched', () => {
    expect(buildTrackerBriefing(base).watchText).toBe(`Verified ${unitedHubsMeta.lastVerified}`);
  });

  it('detects a watch on the hub slug, on one of its projects, or on its tower row', () => {
    for (const watch of [
      { slug: 'united-hubs', id: 'den' },
      { slug: 'united-hubs', id: 'den-polaris' },
      { slug: 'atc', id: 'den' },
    ]) {
      expect(buildTrackerBriefing({ ...base, watches: [watch] }).watchText)
        .toBe('Watching on this device');
    }
  });

  it('ignores a watch on some other hub', () => {
    expect(buildTrackerBriefing({ ...base, watches: [{ slug: 'atc', id: 'ord' }] }).watchText)
      .toBe(`Verified ${unitedHubsMeta.lastVerified}`);
  });
});

describe('parseTrackerWatches', () => {
  it('reads the stored array', () => {
    expect(parseTrackerWatches('[{"slug":"atc","id":"den"}]')).toEqual([{ slug: 'atc', id: 'den' }]);
  });

  it('never throws on missing or malformed storage', () => {
    expect(parseTrackerWatches(null)).toEqual([]);
    expect(parseTrackerWatches('')).toEqual([]);
    expect(parseTrackerWatches('not json')).toEqual([]);
    expect(parseTrackerWatches('{"slug":"atc"}')).toEqual([]);
    expect(parseTrackerWatches('[null,{"slug":"atc"},{"id":"den"}]')).toEqual([]);
  });
});
