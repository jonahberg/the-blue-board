import { describe, it, expect } from 'vitest';
import { FLEET_DB_COUNT } from '../src/data/facts.js';
import { fleetTypes, fleetOrder, fleetNavLabels } from '../src/data/fleet/index.js';
import { FLEET_SUMMARY } from '../src/lib/home-seo.js';

// The per-type aircraft count lives in two hand-maintained places — the per-type file's `count`
// and the parenthesised number in fleetNavLabels — and used to live in a third, the homepage
// prose in public/index.html (documented footgun: "adding a real /fleet type desyncs the
// 1,078/19 hardcodes"). The homepage copy now derives from this data via src/lib/home-seo.js,
// so the third hardcode is gone; what remains to pin is that the parts still sum to the
// FLEET_DB_COUNT that facts.js publishes, and that the derived prose agrees.
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

  it('the per-type counts sum to FLEET_DB_COUNT in facts.js', () => {
    const sum = typeKeys.reduce((n, slug) => n + fleetTypes[slug].count, 0);
    expect(sum).toBe(FLEET_DB_COUNT);
  });

  it("the homepage's fleet summary quotes that same total and every per-type count", () => {
    // Derived, not hand-typed — but a derivation that silently dropped a type would still
    // ship wrong SEO copy, so the heading and the breakdown are pinned to the data here.
    const m = FLEET_SUMMARY.heading.match(/Fleet Database[^0-9]*([0-9,]+)\s*Aircraft/i);
    expect(m, 'fleet total not found in the homepage fleet summary').toBeTruthy();
    expect(Number(m[1].replace(/,/g, ''))).toBe(FLEET_DB_COUNT);
    for (const slug of typeKeys) {
      const type = fleetTypes[slug];
      expect(FLEET_SUMMARY.body, slug).toContain(`${type.typeCode} (${type.count})`);
    }
  });
});
