import { describe, it, expect } from 'vitest';
import {
  atcMeta,
  atcAirports,
  unitedHubsMeta,
  unitedHubs,
  unitedProjects,
  trackerOrder,
  trackerNavLabels,
  trackers,
} from '../src/data/trackers/index.js';

// Structural invariants only — monthly data updates must not require touching this file.
// The one deliberate content pin is the 89-airport program scope: if that changes, the FAA
// changed the program, and the editor should update this number consciously.

describe('tracker barrel coherence', () => {
  it('trackerOrder, navLabels, and the trackers map cover the same slugs', () => {
    expect(Object.keys(trackers).sort()).toEqual([...trackerOrder].sort());
    expect(Object.keys(trackerNavLabels).sort()).toEqual([...trackerOrder].sort());
    for (const slug of trackerOrder) {
      expect(trackers[slug].slug).toBe(slug);
      expect(trackers[slug].href).toBe(`/trackers/${slug}`);
    }
  });

  it('index summaries stay consistent with the underlying data', () => {
    expect(trackers.atc.entryCount).toBe(atcAirports.length);
    expect(trackers['united-hubs'].entryCount).toBe(unitedProjects.length);
    expect(trackers.atc.lastUpdated).toBe(atcMeta.lastUpdated);
    expect(trackers['united-hubs'].lastUpdated).toBe(unitedHubsMeta.lastUpdated);
  });
});

describe('atc data', () => {
  it('covers the FAA 89-airport TFDM program exactly', () => {
    expect(atcAirports.length).toBe(89);
  });

  it('status buckets sum to the total', () => {
    const counts = { live: 0, 'in-progress': 0, planned: 0, paper: 0 };
    for (const a of atcAirports) counts[a.status]++;
    expect(counts.live + counts['in-progress'] + counts.planned + counts.paper).toBe(atcAirports.length);
    expect(counts.live).toBeGreaterThan(0);
  });

  it('every entry cites at least one https source', () => {
    for (const a of atcAirports) {
      expect(a.sources.length, a.id).toBeGreaterThan(0);
      for (const s of a.sources) expect(s, a.id).toMatch(/^https:\/\//);
    }
  });

  it('date semantics hold: goLiveDate only on live, plannedIoc only on planned, paper undated', () => {
    for (const a of atcAirports) {
      if (a.goLiveDate) expect(a.status, a.id).toBe('live');
      if (a.plannedIoc) expect(a.status, a.id).toBe('planned');
      if (a.status === 'paper') {
        expect(a.goLiveDate, a.id).toBeUndefined();
        expect(a.plannedIoc, a.id).toBeUndefined();
      }
    }
  });

  it('ids are unique lowercase IATA', () => {
    const ids = atcAirports.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of atcAirports) expect(a.id).toBe(a.code.toLowerCase());
  });

  it('coordinates are plottable (US incl. AK/HI/PR/GU ranges)', () => {
    for (const a of atcAirports) {
      expect(a.lat, a.id).toBeGreaterThan(10);
      expect(a.lat, a.id).toBeLessThan(72);
      expect(Math.abs(a.lng), a.id).toBeGreaterThan(60);
    }
  });
});

describe('united hub data', () => {
  it('every project belongs to a defined hub and is prefixed by it', () => {
    for (const p of unitedProjects) {
      expect(unitedHubs[p.hub], p.id).toBeDefined();
      expect(p.id.startsWith(`${p.hub.toLowerCase()}-`), p.id).toBe(true);
    }
  });

  it('every hub either has projects or owns an honest quietNote', () => {
    const hubsWithProjects = new Set(unitedProjects.map((p) => p.hub));
    for (const [iata, h] of Object.entries(unitedHubs)) {
      expect(hubsWithProjects.has(iata) || Boolean(h.quietNote), iata).toBe(true);
    }
  });

  it('status/date semantics hold', () => {
    for (const p of unitedProjects) {
      if (p.status === 'open') expect(p.openedDate, p.id).toBeDefined();
      else expect(p.openedDate, p.id).toBeUndefined();
      if (p.status === 'rumored') expect(p.targetDate, p.id).toBeUndefined();
    }
  });

  it('every project cites at least one https source', () => {
    for (const p of unitedProjects) {
      expect(p.sources.length, p.id).toBeGreaterThan(0);
      for (const s of p.sources) expect(s, p.id).toMatch(/^https:\/\//);
    }
  });
});

describe('changelogs', () => {
  for (const [name, meta] of [['atc', atcMeta], ['united-hubs', unitedHubsMeta]]) {
    it(`${name}: reverse-chronological, ISO-dated, none newer than lastUpdated`, () => {
      expect(meta.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      let prev = '9999-99-99';
      for (const c of meta.changelog) {
        expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.date <= prev, `${name} changelog order at ${c.date}`).toBe(true);
        prev = c.date;
      }
      expect(meta.changelog[0].date <= meta.lastUpdated).toBe(true);
    });
  }
});

describe('cross-tracker links', () => {
  it('united hubs that are also TFDM airports resolve to real atc ids', () => {
    const atcCodes = new Set(atcAirports.map((a) => a.code));
    const overlap = Object.keys(unitedHubs).filter((h) => atcCodes.has(h));
    // sanity: the big domestic hubs are all in the TFDM program
    for (const h of ['IAH', 'IAD', 'SFO', 'LAX', 'DEN', 'EWR', 'ORD']) {
      expect(overlap, `${h} should appear in both trackers`).toContain(h);
    }
  });
});
