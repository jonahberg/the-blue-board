// Counted nouns on the tracker pages (phone QA, Oct 3 2026: GUM read "1 TRACKED PROJECTS").
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { countIs, countLabel, plural } from '../src/lib/plural.js';
import { countLabel as trackerCountLabel, unitedHubSeo } from '../src/lib/tracker-detail.js';
import { buildTrackerBriefing } from '../src/lib/tracker-briefing.js';

describe('plural', () => {
  it('is singular at exactly one and plural otherwise, zero included', () => {
    expect(plural(1, 'project')).toBe('project');
    expect(plural(0, 'project')).toBe('projects');
    expect(plural(2, 'project')).toBe('projects');
    expect(plural('1', 'project')).toBe('project');
  });

  it('takes an irregular plural', () => {
    expect(plural(2, 'facility', 'facilities')).toBe('facilities');
    expect(plural(1, 'facility', 'facilities')).toBe('facility');
  });
});

describe('countLabel / countIs', () => {
  it('counts', () => {
    expect(countLabel(1, 'tracked project')).toBe('1 tracked project');
    expect(countLabel(4, 'tracked project')).toBe('4 tracked projects');
  });

  it('agrees the verb with the count', () => {
    expect(countIs(1, 'project')).toBe('1 project is');
    expect(countIs(3, 'project')).toBe('3 projects are');
    expect(countIs(0, 'airport')).toBe('0 airports are');
  });

  it('is the helper the tracker pages already import', () => {
    expect(trackerCountLabel(1, 'United project')).toBe('1 United project');
    expect(unitedHubSeo('GUM', 1).description).toContain('Track 1 United project at GUM');
  });
});

describe('the Weather tab tracker briefing', () => {
  const meta = { lastVerified: '2026-10-01' };
  it('agrees its counts and verbs at one and at many', () => {
    const one = buildTrackerBriefing({
      home: '',
      atcAirports: [{ code: 'ORD', status: 'live' }],
      atcMeta: meta,
      unitedHubsMeta: meta,
      unitedProjects: [{ id: 'a', hub: 'GUM', status: 'open' }],
    });
    expect(one.summary).toContain('1 of 1 tower is digital.');
    expect(one.summary).toContain('1 project is tracked');

    const gum = buildTrackerBriefing({
      home: 'GUM',
      atcAirports: [],
      atcMeta: meta,
      unitedHubsMeta: meta,
      unitedProjects: [{ id: 'a', hub: 'GUM', status: 'open' }],
    });
    expect(gum.summary).toContain('1 hub project,');
  });
});

describe('the tracker pages count through the helper', () => {
  const read = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('the hub detail page has no hard-coded plural beside a count', () => {
    const page = read('src/pages/trackers/united-hubs/[code].astro');
    expect(page).not.toMatch(/>Tracked projects</);
    expect(page).not.toMatch(/>Tracked new gates</);
    expect(page).not.toMatch(/countLabel\([^)]*\)\} are tracked/);
    expect(page).not.toMatch(/\$\{unitedLedCount\} of \$\{projects\.length\} projects are/);
  });

  it('the ATC and index pages do not print a bare "N airports are"', () => {
    expect(read('src/pages/trackers/atc.astro')).not.toMatch(/\$\{liveCount\} airports? are/);
    expect(read('src/pages/trackers/index.astro')).not.toMatch(/\{t\.entryCount\} \{t\.entryNoun\}/);
  });
});
