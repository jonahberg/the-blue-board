import { existsSync, readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { fleetTypes } from '../src/data/fleet/index.js';
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
import { entryVerifiedProblems, isIsoDay, newestVerified, utcToday } from '../src/data/trackers/verified.js';

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
    expect(trackers.atc.lastVerified).toBe(atcMeta.lastVerified);
    expect(trackers['united-hubs'].lastVerified).toBe(unitedHubsMeta.lastVerified);
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
  for (const [name, meta, entries] of [['atc', atcMeta, atcAirports], ['united-hubs', unitedHubsMeta, unitedProjects]]) {
    it(`${name}: reverse-chronological, ISO-dated, and verification is current`, () => {
      expect(meta.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(meta.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // lastVerified is the day EVERY entry was checked, so after a partial pass it may be older
      // than lastUpdated; the newest check (file-level or an entry's own `verified`) may not be.
      expect(newestVerified(entries, meta) >= meta.lastUpdated).toBe(true);
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

describe('per-entry verified dates', () => {
  for (const [name, meta, entries] of [['atc', atcMeta, atcAirports], ['united-hubs', unitedHubsMeta, unitedProjects]]) {
    it(`${name}: every entry's verified is a real past day, no older than the file's lastVerified`, () => {
      const today = utcToday();
      for (const e of entries) {
        if (e.verified === undefined) continue;
        expect(isIsoDay(e.verified), e.id).toBe(true);
        expect(e.verified <= today, `${e.id} verified in the future`).toBe(true);
        expect(e.verified >= meta.lastVerified, `${e.id} verified before the file's lastVerified`).toBe(true);
        expect(entryVerifiedProblems(e, meta, today), e.id).toEqual([]);
      }
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

// v1.28.0: the united-hubs page's "Club math" sidebar said 650 seats for the Dulles club (the
// pre-opening "around 650") after the entry moved to United's Nov 9 wording, "more than 600". The
// page now reads the figure out of the entry and compares it with the 787-10 cabin from the fleet
// data; "more than a 787-10 carries twice over" no longer held (2 × 318 = 636).
describe('united-hubs "Club math" quotes the Dulles club entry', () => {
  const src = readFileSync(new URL('../src/pages/trackers/united-hubs.astro', import.meta.url), 'utf8');
  const clubMathSrc = src.slice(src.indexOf('id="club-math"'), src.indexOf('</section>', src.indexOf('id="club-math"')));
  const entry = unitedProjects.find((p) => p.id === 'iad-club-concourse-e');
  const stated = /seating for more than (\d+)/.exec(entry?.details ?? '')?.[1];
  const d7810 = Number(fleetTypes['787-10-dreamliner'].seatConfig.total);

  it('types no seat figure: the page reads it from the entry, which states it as "more than N"', () => {
    expect(stated, 'the entry states its seating as "more than N"').toBeTruthy();
    expect(clubMathSrc).toContain('{iadClubSeats}+');
    expect(clubMathSrc).toContain('{D7810_SEATS}');
    expect(clubMathSrc).not.toMatch(/\b650\b|twice over/);
    expect(2 * d7810).toBeGreaterThan(Number(stated));
  });

  const dist = new URL('../dist/trackers/united-hubs.html', import.meta.url);
  it.skipIf(!existsSync(dist))('the built sidebar prints the entry\'s figure and the 787-10 comparison', () => {
    const html = readFileSync(dist, 'utf8');
    const box = html.slice(html.indexOf('id="club-math"'), html.indexOf('</section>', html.indexOf('id="club-math"'))).replace(/\s+/g, ' ');
    expect(box).toMatch(new RegExp(`>\\s*${stated}\\+\\s*<`));
    expect(box).toContain(`roughly two full 787-10s (${d7810} seats each)`);
    expect(box).not.toMatch(/\b650\b/);
  });
});
