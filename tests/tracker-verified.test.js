// Per-entry "verified" dates (src/data/trackers/verified.js): a partial source pass dates only the
// entries it re-checked, every surface prints each entry's own date, and the header names the
// entries checked later than the rest. Synthetic fixtures here; the real data is held to the same
// rules structurally in tracker-data.test.js. The page checks need dist/.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contentModified,
  entryVerified,
  entryVerifiedProblems,
  isIsoDay,
  newestVerified,
  sharedNamePhrase,
  utcToday,
  verificationSummary,
  verifiedEntriesLabel,
  verifiedNote,
} from '../src/data/trackers/verified.js';
import { unitedHubs, unitedHubsMeta, unitedProjects } from '../src/data/trackers/index.js';
import { GET as getUnitedCsv } from '../src/pages/trackers/united-hubs.csv.ts';

const META = { lastUpdated: '2026-11-11', lastVerified: '2026-11-03' };
const HUBS = {
  IAD: { city: 'Dulles' },
  DEN: { city: 'Denver' },
  GUM: { city: 'Tamuning', searchAlias: 'Guam' },
};
const e = (id, hub, name, verified) => ({ id, hub, name, ...(verified ? { verified } : {}) });

describe('isIsoDay', () => {
  it('accepts real days only', () => {
    expect(isIsoDay('2026-11-11')).toBe(true);
    expect(isIsoDay('2028-02-29')).toBe(true);
    for (const bad of ['2026-13-45', '2026-02-30', '2027-02-29', '2026-11-1', '11/11/2026', '', null, 20261111]) {
      expect(isIsoDay(bad), String(bad)).toBe(false);
    }
  });

  it('utcToday is the UTC day, whatever the local zone', () => {
    expect(utcToday(new Date('2026-11-12T01:30:00Z'))).toBe('2026-11-12');
  });
});

describe('entryVerifiedProblems', () => {
  const today = '2026-11-11';
  it('is empty for an entry without its own date, or with a good one', () => {
    expect(entryVerifiedProblems(e('a', 'IAD', 'A'), META, today)).toEqual([]);
    expect(entryVerifiedProblems(e('a', 'IAD', 'A', '2026-11-11'), META, today)).toEqual([]);
    expect(entryVerifiedProblems(e('a', 'IAD', 'A', '2026-11-03'), META, today)).toEqual([]);
  });

  it('rejects a malformed or impossible day', () => {
    expect(entryVerifiedProblems(e('a', 'IAD', 'A', '2026-13-45'), META, today)[0]).toMatch(/not a real/);
    expect(entryVerifiedProblems(e('a', 'IAD', 'A', 'Nov 11'), META, today)[0]).toMatch(/not a real/);
  });

  it('rejects a day in the future, but only when given a trusted today', () => {
    expect(entryVerifiedProblems(e('a', 'IAD', 'A', '2026-11-12'), META, today).join()).toMatch(/future/);
    // The browser path (the dashboard imports the data): no clock, no future rule.
    expect(entryVerifiedProblems(e('a', 'IAD', 'A', '2026-11-12'), META)).toEqual([]);
  });

  it('rejects a day older than the file-level date (a full pass covers it)', () => {
    expect(entryVerifiedProblems(e('a', 'IAD', 'A', '2026-11-02'), META, today).join()).toMatch(/older than/);
  });
});

describe('summary, label and dateModified', () => {
  const plain = [e('den-a', 'DEN', 'Club B-East'), e('den-b', 'DEN', 'Polaris Lounge Denver')];
  const dulles = [
    e('iad-e', 'IAD', 'Concourse E', '2026-11-11'),
    e('iad-club', 'IAD', 'United Club, Concourse E (flagship)', '2026-11-11'),
  ];

  it('no entry newer than the file: one date, no note; dateModified is the last check', () => {
    expect(verificationSummary(plain, META)).toEqual({ oldest: '2026-11-03', newest: null, newestEntries: [] });
    expect(verifiedNote(plain, META, HUBS)).toBeNull();
    expect(newestVerified(plain, META)).toBe('2026-11-03');
    // Updated Nov 11, but these entries were not touched after their Nov 3 check.
    expect(contentModified(plain, META)).toBe('2026-11-03');
  });

  it('some entries newer: the oldest day, plus the newer entries named from their hub and names', () => {
    const all = [...plain, ...dulles];
    const s = verificationSummary(all, META);
    expect(s.oldest).toBe('2026-11-03');
    expect(s.newest).toBe('2026-11-11');
    expect(s.newestEntries.map((x) => x.id)).toEqual(['iad-e', 'iad-club']);
    expect(verifiedNote(all, META, HUBS)).toEqual({ label: 'Dulles Concourse E entries', iso: '2026-11-11' });
    expect(contentModified(all, META)).toBe('2026-11-11');
    expect(entryVerified(all[0], META)).toBe('2026-11-03');
    expect(entryVerified(all[2], META)).toBe('2026-11-11');
  });

  it('every entry newer: their date alone, no note', () => {
    expect(verificationSummary(dulles, META)).toEqual({ oldest: '2026-11-11', newest: null, newestEntries: [] });
    expect(verifiedNote(dulles, META, HUBS)).toBeNull();
  });

  it('only the newest group is named when three days are in play', () => {
    const mixed = [...plain, e('den-c', 'DEN', 'Great Hall', '2026-11-07'), ...dulles];
    expect(verifiedNote(mixed, META, HUBS)).toEqual({ label: 'Dulles Concourse E entries', iso: '2026-11-11' });
  });

  it('labels: one entry, no shared phrase, two hubs, Guam', () => {
    expect(verifiedEntriesLabel([dulles[0]], HUBS)).toBe('Dulles: Concourse E');
    expect(verifiedEntriesLabel(plain, HUBS)).toBe('2 Denver entries');
    expect(verifiedEntriesLabel([plain[0], dulles[0]], HUBS)).toBe('2 entries');
    expect(verifiedEntriesLabel([e('x', 'DEN', 'Polaris Lounge Denver'), e('y', 'IAD', 'Polaris Lounge Dulles')], HUBS)).toBe(
      'Polaris Lounge entries'
    );
    expect(verifiedEntriesLabel([e('g1', 'GUM', 'Lobby A'), e('g2', 'GUM', 'Lobby B')], HUBS)).toBe('Guam Lobby entries');
  });

  it('sharedNamePhrase ignores a lone letter', () => {
    expect(sharedNamePhrase(['Concourse E', 'United Club, Concourse E (flagship)'])).toBe('Concourse E');
    expect(sharedNamePhrase(['Gate E', 'Club E'])).toBe('');
    expect(sharedNamePhrase(['One'])).toBe('');
  });
});

describe('united-hubs: every surface prints each entry its own date', () => {
  it('the CSV last_verified column is per row', async () => {
    const csv = await getUnitedCsv().text();
    for (const p of unitedProjects) {
      const row = csv.split('\n').find((line) => line.includes(`"${p.id}"`));
      expect(row, p.id).toBeDefined();
      expect(row.endsWith(`"${entryVerified(p, unitedHubsMeta)}"`), p.id).toBe(true);
    }
  });

  const DIST = resolve(__dirname, '..', 'dist');
  const hasDist = existsSync(join(DIST, 'index.html'));
  if (!hasDist && process.env.CI) throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test`');
  const fmt = (iso) =>
    new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const jsonLd = (html) =>
    [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  // "verified Nov 3, 2026" inside the source panel of the element with this id.
  const panelDates = (html, id) => {
    const at = html.indexOf(`id="${id}"`);
    const chunk = html.slice(at, html.indexOf('</details>', at));
    return [...chunk.matchAll(/verified ([A-Z][a-z]{2} \d{1,2}, \d{4})/g)].map((m) => m[1]);
  };

  it.skipIf(!hasDist)('/trackers/united-hubs: cards, table rows, header note, Dataset dateModified', () => {
    const html = readFileSync(join(DIST, 'trackers/united-hubs.html'), 'utf8');
    for (const p of unitedProjects) {
      expect(panelDates(html, p.id), `card ${p.id}`).toEqual([fmt(entryVerified(p, unitedHubsMeta))]);
      expect(panelDates(html, `row-t-${p.id}`), `row ${p.id}`).toEqual([fmt(entryVerified(p, unitedHubsMeta))]);
    }
    const note = verifiedNote(unitedProjects, unitedHubsMeta, unitedHubs);
    if (note) {
      expect(html).toContain(`(${note.label} <time datetime="${note.iso}"`);
    }
    const dataset = jsonLd(html).find((n) => n['@type'] === 'Dataset');
    expect(dataset.dateModified).toBe(contentModified(unitedProjects, unitedHubsMeta));
  });

  it.skipIf(!hasDist)('/trackers/united-hubs/<hub>: cards, header note, Article dateModified', () => {
    for (const code of Object.keys(unitedHubs)) {
      const projects = unitedProjects.filter((p) => p.hub === code);
      const html = readFileSync(join(DIST, `trackers/united-hubs/${code.toLowerCase()}.html`), 'utf8');
      for (const p of projects) {
        expect(panelDates(html, p.id), `${code} ${p.id}`).toEqual([fmt(entryVerified(p, unitedHubsMeta))]);
      }
      const note = verifiedNote(projects, unitedHubsMeta, unitedHubs);
      if (note) expect(html, code).toContain(`(${note.label} <time datetime="${note.iso}"`);
      else expect(html, code).not.toMatch(/\([^()<]* <time datetime="\d{4}-\d{2}-\d{2}"/);
      const article = jsonLd(html).find((n) => n['@type'] === 'Article');
      expect(article.dateModified, code).toBe(contentModified(projects, unitedHubsMeta));
    }
  });
});
