import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';
import fleetDb from '../public/data/fleet.json';
import starlinkLive from '../src/data/starlink-live.json';
import { fleetTypes } from '../src/data/fleet/index.js';
import {
  STARLINK_AS_OF,
  STARLINK_BY_TYPE,
  STARLINK_EQUIPPED_LABEL,
  STARLINK_EQUIPPED_SCOPE,
  STARLINK_ROSTER_AS_OF,
} from '../src/data/starlink-facts.js';
import {
  registryStarlinkNote,
  starlinkCountsByType,
  starlinkRosterTails,
  isPlausibleStarlinkRoster,
  starlinkRosterAsOf,
} from '../src/lib/starlink-facts.js';

// The per-type "N of the M … as of D" Starlink sentences on the fleet guide pages are computed
// at build time from the roster in starlink-live.json joined to fleet.json by registration.
// These tests recompute that join independently and require every page to state exactly it.

function independentJoin(type) {
  const roster = new Set(starlinkLive.roster.tails);
  const rows = fleetDb.filter((a) => a.t === type);
  return { equipped: rows.filter((a) => roster.has(a.r)).length, total: rows.length };
}

const PAGES = [
  ['737-800', '737-800'],
  ['737-900er', '737-900ER'],
  ['a321neo', 'A321neo'],
  ['737-max-9', '737 MAX 9'],
  ['737-max-8', '737 MAX 8'],
  ['737-900', '737-900'],
];

describe('build-time Starlink roster', () => {
  it('is committed with a sync date and a non-empty, sorted, upper-case tail list', () => {
    expect(starlinkLive.roster.tails.length).toBeGreaterThan(0);
    expect(starlinkLive.roster.tails).toEqual([...starlinkLive.roster.tails].sort());
    expect(starlinkLive.roster.tails.every((t) => t === t.toUpperCase())).toBe(true);
    expect(STARLINK_ROSTER_AS_OF).toBe(starlinkRosterAsOf(starlinkLive.roster.syncedAt));
    expect(STARLINK_ROSTER_AS_OF).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  });
});

describe.each(PAGES)('/fleet/%s Starlink sentence', (slug, type) => {
  const page = fleetTypes[slug];
  const { equipped, total } = independentJoin(type);
  const phrase = `${equipped} of the ${total}`;

  it('uses the same type code the join is keyed on', () => {
    expect(page.typeCode).toBe(type);
    expect(STARLINK_BY_TYPE[type]).toEqual({ equipped, total });
  });

  it('states the joined count and the roster date in the page body', () => {
    expect(page.contentHtml).toContain(phrase);
    expect(page.contentHtml).toContain(`as of ${STARLINK_ROSTER_AS_OF}`);
  });

  it('states the same count and date in the Starlink FAQ answer (and its JSON-LD)', () => {
    const answers = page.faqSchema.map((f) => f.answer).filter((a) => /Starlink/.test(a) && /as of \d/.test(a));
    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) {
      expect(a).toContain(phrase);
      expect(a).toContain(`as of ${STARLINK_ROSTER_AS_OF}`);
    }
  });

  it('carries no leftover template placeholder', () => {
    expect(page.contentHtml).not.toMatch(/\$\{|undefined|NaN/);
  });
});

describe('starlink roster helpers', () => {
  it('keeps mainline tails only, de-duplicated, and merges mainline overrides', () => {
    const upstream = {
      starlinkPlanes: [
        { TailNumber: ' n101ua ', fleet: 'mainline' },
        { TailNumber: 'N101UA', fleet: 'mainline' },
        { TailNumber: 'N501GJ', fleet: 'express' },
      ],
    };
    expect(starlinkRosterTails(upstream, [{ tail: 'N76265', fleet: 'Mainline' }, { tail: 'N1X', fleet: 'Express' }]))
      .toEqual(['N101UA', 'N76265']);
    expect(starlinkRosterTails(null)).toEqual([]);
  });

  it('rejects an empty roster or one that lost more than a tenth of its tails', () => {
    expect(isPlausibleStarlinkRoster([], 0)).toBe(false);
    expect(isPlausibleStarlinkRoster(Array(90).fill('N'), 100)).toBe(true);
    expect(isPlausibleStarlinkRoster(Array(89).fill('N'), 100)).toBe(false);
  });

  it('joins by registration and counts every fleet type', () => {
    const counts = starlinkCountsByType(
      [{ r: 'N1', t: 'A' }, { r: 'N2', t: 'A' }, { r: 'N3', t: 'B' }],
      ['n1', 'N9'],
    );
    expect(counts).toEqual({ A: { equipped: 1, total: 2 }, B: { equipped: 0, total: 1 } });
  });

  it('formats the as-of day identically on every runtime (no ICU "Sept")', () => {
    expect(starlinkRosterAsOf('2026-09-28T23:59:00Z')).toBe('28 Sep 2026');
    expect(starlinkRosterAsOf('garbage')).toBe('');
  });
});

// ── The combined count on a mainline type page (v1.28.0) ──
// STARLINK_EQUIPPED_LABEL ("675+") counts every United aircraft on the tracker, mainline AND
// Express. On a mainline type page it read as a mainline figure, so every page that prints it must
// say what it counts, from STARLINK_EQUIPPED_SCOPE — never a typed number or a typed scope.
describe('the combined Starlink count says it includes Express', () => {
  const printing = Object.entries(fleetTypes).filter(([, t]) => String(t.contentHtml).includes(STARLINK_EQUIPPED_LABEL));

  it('is printed on the A319, A320 and A321neo pages', () => {
    expect(printing.map(([, t]) => t.slug).sort()).toEqual(['a319', 'a320', 'a321neo']);
  });

  it.each(printing.map(([, t]) => [t.slug, t]))('/fleet/%s names its scope in the same sentence', (_slug, t) => {
    const html = String(t.contentHtml);
    const at = html.indexOf(STARLINK_EQUIPPED_LABEL);
    const sentence = html.slice(html.lastIndexOf('. ', at) + 1, html.indexOf('.', at + STARLINK_EQUIPPED_LABEL.length + 1) + 1);
    expect(sentence).toContain(STARLINK_EQUIPPED_SCOPE);
    expect(sentence).toContain(STARLINK_AS_OF);
  });
});

// ── The registry table and the roster count on one type page (v1.28.0) ──
// The page's "N of the M had Starlink" is the roster (STARLINK_ROSTER_AS_OF); the registry table's
// WiFi column is the fleet database (FLEET_DB_AS_OF). Two sources on two days: a reader counting
// rows found 42 beside "48" on the MAX 9 page. Where they differ, the table says both.
describe('registryStarlinkNote', () => {
  it('is empty when the table and the roster agree', () => {
    expect(registryStarlinkNote({ marked: 42, roster: 42, rosterAsOf: '11 Nov 2026' })).toBe('');
    expect(registryStarlinkNote({ marked: 0, roster: 0, rosterAsOf: '' })).toBe('');
  });

  it('names both counts and the roster day when they differ, in either direction', () => {
    expect(registryStarlinkNote({ marked: 42, roster: 48, rosterAsOf: '11 Nov 2026' })).toBe(
      "Its WiFi column marks 42 with Starlink as of that date; the Starlink tracker's roster listed 48 on 11 Nov 2026.",
    );
    // The committed roster can be OLDER than the fleet database (Oct 3 vs Nov 3): still true.
    expect(registryStarlinkNote({ marked: 42, roster: 30, rosterAsOf: '3 Oct 2026' })).toBe(
      "Its WiFi column marks 42 with Starlink as of that date; the Starlink tracker's roster listed 30 on 3 Oct 2026.",
    );
  });

  it('claims no day it does not have', () => {
    expect(registryStarlinkNote({ marked: 1, roster: 2, rosterAsOf: '' })).toBe(
      "Its WiFi column marks 1 with Starlink as of that date; the Starlink tracker's roster listed 2.",
    );
  });

  it('says nothing about counts it cannot read', () => {
    expect(registryStarlinkNote({ marked: Number.NaN, roster: 2, rosterAsOf: '' })).toBe('');
    // A missing roster count.
    expect(registryStarlinkNote({ marked: 1, rosterAsOf: '' })).toBe('');
  });
});

// The built pages: wherever the clause appears, its first number is the rows the table marks, so a
// reader who counts finds it. Numbers come from the page itself, never pinned (the roster is
// refreshed at build, and restored to the committed copy after).
const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));
if (!hasDist && process.env.CI) {
  throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test` (see test.yml)');
}

describe.skipIf(!hasDist)('fleet type pages: the registry clause counts its own table', () => {
  const pages = hasDist ? Object.values(fleetTypes).map((t) => [t.slug, readFileSync(join(DIST, 'fleet', `${t.slug}.html`), 'utf8')]) : [];

  it.each(pages)('/fleet/%s', (_slug, html) => {
    const registry = html.slice(html.indexOf('id="registry"'));
    const table = registry.slice(registry.indexOf('<table'), registry.indexOf('</table>'));
    const marked = (table.match(/class="starlink-on"/g) ?? []).length;
    const clause = /Its WiFi column marks (\d+) with Starlink as of that date; the Starlink tracker(?:'|&#39;|&#x27;)s roster listed (\d+)/.exec(registry);
    // A clause the pattern cannot read would make this test pass on nothing.
    if (registry.includes('Its WiFi column marks')) expect(clause, 'the clause, as rendered').toBeTruthy();
    if (clause) {
      expect(Number(clause[1])).toBe(marked);
      expect(Number(clause[2])).not.toBe(marked);
    }
  });
});

