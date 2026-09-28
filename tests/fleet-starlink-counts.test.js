import { describe, it, expect } from 'vitest';
import fleetDb from '../public/data/fleet.json';
import starlinkLive from '../src/data/starlink-live.json';
import { fleetTypes } from '../src/data/fleet/index.js';
import { STARLINK_BY_TYPE, STARLINK_ROSTER_AS_OF } from '../src/data/starlink-facts.js';
import {
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
