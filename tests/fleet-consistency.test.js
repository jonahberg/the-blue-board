import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fleetTypes, fleetOrder, fleetNavLabels } from '../src/data/fleet/index.js';

// The per-type aircraft count lives in three hand-maintained places: the per-type file's `count`,
// the parenthesised number in fleetNavLabels, and the homepage prose/heading in public/index.html
// (documented footgun: "adding a real /fleet type desyncs the 1,078/19 hardcodes"). These invariants
// fail CI the moment any of the three drifts, instead of shipping a wrong count in a label or the SEO copy.
describe('fleet config consistency (src/data/fleet/index.js)', () => {
  const typeKeys = Object.keys(fleetTypes);
  const navKeys = Object.keys(fleetNavLabels);
  const sorted = (arr) => [...arr].sort();

  it('fleetTypes, fleetOrder, and fleetNavLabels cover the identical slug set', () => {
    expect(sorted(fleetOrder)).toEqual(sorted(typeKeys));
    expect(sorted(navKeys)).toEqual(sorted(typeKeys));
    expect(new Set(fleetOrder).size, 'fleetOrder has a duplicate slug').toBe(fleetOrder.length);
  });

  it('each nav-label count matches its per-type file count', () => {
    for (const slug of typeKeys) {
      const label = fleetNavLabels[slug];
      const m = label.match(/\((\d+)\)/);
      expect(m, `nav label for ${slug} is missing a (count): ${label}`).toBeTruthy();
      expect(Number(m[1]), `nav label count drifted from fleetTypes count for ${slug}`).toBe(fleetTypes[slug].count);
    }
  });

  it('the per-type counts sum to the homepage fleet total in public/index.html', () => {
    const sum = typeKeys.reduce((n, slug) => n + fleetTypes[slug].count, 0);
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    // Matches the authoritative exact-count occurrences ("Fleet Database (1,078 Aircraft)"),
    // not the "1,078+ aircraft" rollout prose.
    const m = html.match(/Fleet Database[^0-9]*([0-9,]+)\s*Aircraft/i);
    expect(m, 'homepage fleet total not found in public/index.html').toBeTruthy();
    const homepageTotal = Number(m[1].replace(/,/g, ''));
    expect(sum).toBe(homepageTotal);
  });
});
