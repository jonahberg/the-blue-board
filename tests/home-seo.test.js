import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { FLEET_DB_COUNT } from '../src/data/facts.js';
import { fleetOrder, fleetTypes } from '../src/data/fleet/index.js';
import { STARLINK_AS_OF, STARLINK_EQUIPPED_LABEL } from '../src/data/starlink-facts.js';
import {
  FLEET_SUMMARY,
  HOME_BRIEF,
  HOME_DESCRIPTION,
  HOME_NAV_LINKS,
  HOME_TITLE,
  NOSCRIPT_LINKS,
  homeJsonLd,
} from '../src/lib/home-seo.js';

// `src/pages/index.astro` mounts the dashboard as a client:only island, so everything a
// crawler, an AI extractor or a no-JS visitor reads on the homepage comes from this module.
// These pins guard the four things that broke before:
//   1. the agent-readiness audit values (Organization @id / contactPoint / address, SearchAction)
//   2. the six JSON-LD blocks all being present and parseable
//   3. figures coming from data, never hand-typed (the old page carried a literal "425+"
//      that a build script had to rewrite in dist/)
//   4. the TSA checkpoint guide staying deleted from the copy

const jsonLd = homeJsonLd({ lastmod: '2026-09-11' });
const block = (type) => jsonLd.find((node) => node['@type'] === type);

/** Every crawlable string the page renders, as a single blob. */
function crawlableText() {
  return [
    HOME_TITLE,
    HOME_DESCRIPTION,
    HOME_BRIEF.h1,
    HOME_BRIEF.intro,
    HOME_BRIEF.checksHeading,
    ...HOME_BRIEF.checks.map((c) => `${c.term} ${c.text}`),
    HOME_BRIEF.howToUseHeading,
    HOME_BRIEF.howToUseHtml.replace(/<[^>]+>/g, ''),
    NOSCRIPT_LINKS.heading,
    NOSCRIPT_LINKS.intro,
    ...NOSCRIPT_LINKS.hubs.map((l) => l.label),
    ...NOSCRIPT_LINKS.resources.map((l) => l.label),
    FLEET_SUMMARY.heading,
    FLEET_SUMMARY.body,
    ...HOME_NAV_LINKS.map((l) => l.label),
  ].join(' ');
}

describe('crawlable page brief', () => {
  it('names the product and the job in the page h1', () => {
    expect(HOME_BRIEF.h1).toContain('The Blue Board');
    expect(HOME_BRIEF.h1).toContain('United Airlines');
  });

  it('ships well past 500 characters of crawlable text', () => {
    // The old public/index.html cleared 3,000 characters of extractable prose; the island
    // renders nothing server-side, so this module has to carry the same weight on its own.
    expect(crawlableText().length).toBeGreaterThan(3000);
  });

  it('offers a bullet for each thing the dashboard answers', () => {
    expect(HOME_BRIEF.checks.length).toBeGreaterThanOrEqual(5);
    for (const check of HOME_BRIEF.checks) {
      expect(check.term.length, JSON.stringify(check)).toBeGreaterThan(0);
      expect(check.text.length, check.term).toBeGreaterThan(40);
    }
    const terms = HOME_BRIEF.checks.map((c) => c.term).join(' ');
    for (const topic of ['Live flight status', 'Hub delays', 'Starlink', 'Weather']) {
      expect(terms, topic).toContain(topic);
    }
  });

  it('points agents at the machine-readable indexes', () => {
    for (const href of ['/llms.txt', '/llms-full.txt', '/sitemap.xml']) {
      expect(HOME_BRIEF.howToUseHtml, href).toContain(`href="${href}"`);
    }
    expect(HOME_BRIEF.howToUseHtml).toContain('Accept: text/markdown');
  });

  it('deep-links the flight query parameter the SearchAction advertises', () => {
    expect(crawlableText()).toContain('/?flight=UA1234');
  });
});

describe('crawlable navigation', () => {
  it('publishes 15 site links, all site-root paths', () => {
    expect(HOME_NAV_LINKS).toHaveLength(15);
    for (const link of HOME_NAV_LINKS) {
      expect(link.href, link.label).toMatch(/^\/[a-z0-9/-]*$/);
      expect(link.label.length).toBeGreaterThan(3);
    }
  });

  it('covers all nine hub guides plus the section indexes', () => {
    const hrefs = HOME_NAV_LINKS.map((l) => l.href);
    for (const hub of ['ord', 'den', 'iah', 'ewr', 'sfo', 'iad', 'lax', 'nrt', 'gum']) {
      expect(hrefs, hub).toContain(`/hubs/${hub}`);
    }
    for (const index of ['/hubs', '/fleet', '/news', '/trackers']) {
      expect(hrefs, index).toContain(index);
    }
  });

  it('the noscript block carries prose, the nine hubs, four resources and the byline', () => {
    expect(NOSCRIPT_LINKS.intro.length).toBeGreaterThan(500);
    expect(NOSCRIPT_LINKS.hubs).toHaveLength(9);
    expect(NOSCRIPT_LINKS.resources).toHaveLength(4);
    expect(NOSCRIPT_LINKS.bylineLink.label).toBe('Jonah Berg');
    expect(NOSCRIPT_LINKS.bylineAfter).toContain('Not affiliated with United Airlines');
  });
});

describe('figures come from data, never from the copy', () => {
  it('carries no hard-coded Starlink figure — they come from starlink-live.json', () => {
    const everything = `${crawlableText()} ${JSON.stringify(jsonLd)}`;
    // "425+" / "mid-2026" were the committed literals scripts/stamp-seo-build-date.mjs had to
    // rewrite in dist/index.html. An Astro page imports the data, so they must never return.
    expect(everything).not.toContain('425+');
    expect(everything).not.toContain('mid-2026');
    expect(everything).toContain(STARLINK_EQUIPPED_LABEL);
    expect(everything).toContain(STARLINK_AS_OF);
  });

  it('quotes the fleet database count from facts.js', () => {
    const expected = FLEET_DB_COUNT.toLocaleString('en-US');
    expect(FLEET_SUMMARY.heading).toContain(expected);
    expect(FLEET_SUMMARY.body).toContain(expected);
  });

  it('breaks the fleet down from the per-type files, and the parts sum to the total', () => {
    const sum = fleetOrder.reduce((n, slug) => n + fleetTypes[slug].count, 0);
    expect(sum).toBe(FLEET_DB_COUNT);
    expect(FLEET_SUMMARY.body).toContain(`across ${fleetOrder.length} types`);
    for (const slug of fleetOrder) {
      const type = fleetTypes[slug];
      expect(FLEET_SUMMARY.body, slug).toContain(`${type.typeCode} (${type.count})`);
    }
  });
});

describe('TSA checkpoint guide is gone from the homepage copy', () => {
  it('no brief bullet, noscript link or JSON-LD answer mentions it', () => {
    const everything = `${crawlableText()} ${JSON.stringify(jsonLd)}`.toLowerCase();
    expect(everything).not.toContain('tsa');
    expect(everything).not.toContain('checkpoint');
  });
});

describe('JSON-LD', () => {
  it('publishes exactly the six blocks, in order', () => {
    expect(jsonLd.map((node) => node['@type'])).toEqual([
      'Organization',
      'WebPage',
      'WebApplication',
      'FAQPage',
      'Dataset',
      'WebSite',
    ]);
  });

  it('is serialisable and carries @context on every block', () => {
    for (const node of jsonLd) {
      expect(node['@context'], String(node['@type'])).toBe('https://schema.org');
      expect(() => JSON.parse(JSON.stringify(node))).not.toThrow();
    }
  });

  it('Organization keeps the audited @id, contactPoint and PostalAddress', () => {
    const org = block('Organization');
    expect(org['@id']).toBe('https://theblueboard.co/#organization');
    expect(org.email).toBe('hello@theblueboard.co');
    expect(org.contactPoint).toMatchObject({
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'hello@theblueboard.co',
    });
    expect(org.address).toMatchObject({
      '@type': 'PostalAddress',
      addressLocality: 'Los Angeles',
      addressRegion: 'CA',
      addressCountry: 'US',
    });
  });

  it('WebSite advertises the ?flight= SearchAction', () => {
    const site = block('WebSite');
    expect(site['@id']).toBe('https://theblueboard.co/#website');
    expect(site.potentialAction.target.urlTemplate).toBe(
      'https://theblueboard.co/?flight={flight_number}',
    );
    expect(site.potentialAction['query-input']).toBe('required name=flight_number');
  });

  it('stamps the build lastmod into WebPage and Dataset instead of a placeholder', () => {
    expect(block('WebPage').dateModified).toBe('2026-09-11');
    expect(block('Dataset').dateModified).toBe('2026-09-11');
    expect(JSON.stringify(jsonLd)).not.toContain('__HOME_LASTMOD__');
  });

  it('WebApplication lists 14 features and FAQPage answers 8 questions', () => {
    expect(block('WebApplication').featureList).toHaveLength(14);
    expect(block('FAQPage').mainEntity).toHaveLength(8);
    for (const entry of block('FAQPage').mainEntity) {
      expect(entry['@type']).toBe('Question');
      expect(entry.acceptedAnswer['@type']).toBe('Answer');
      expect(entry.acceptedAnswer.text.length).toBeGreaterThan(80);
    }
  });

  it('Dataset names the four variables it measures', () => {
    const names = block('Dataset').variableMeasured.map((v) => v.name);
    expect(names).toEqual([
      'Flight Status',
      'Hub On-Time Performance',
      'Starlink WiFi Equipment',
      'Fleet Composition',
    ]);
  });

  it('credits Jonah Berg only — never the legal surname (public-copy rule)', () => {
    const everything = `${crawlableText()} ${JSON.stringify(jsonLd)}`;
    expect(everything).toContain('Jonah Berg');
    // Public name only — the author's full legal surname must never appear (positive check).
    expect(everything).not.toMatch(/Berg-[A-Z][a-z]+/);
  });
});

describe('the module stays out of the api/** import graph', () => {
  it('reaches starlink-live.json through starlink-facts.js, which api/** must never import', () => {
    // A bare JSON import anywhere reachable from api/** crashes Vercel's native Node ESM at
    // module load (tests/api-esm-json-imports.test.js walks that graph). home-seo.js is
    // Vite/Astro-only; this pins the import it relies on so the risk stays visible here too.
    const source = readFileSync(new URL('../src/lib/home-seo.js', import.meta.url), 'utf8');
    expect(source).toContain("from '../data/starlink-facts.js'");
    expect(source).not.toMatch(/^\s*import\s[^\n]*\.json['"]/m);
  });
});
