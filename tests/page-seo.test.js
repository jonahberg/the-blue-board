import { describe, it, expect } from 'vitest';

import { fleetOrder, fleetTypes } from '../src/data/fleet/index.js';
import { hubOrder, hubs } from '../src/data/hubs/index.js';
import { articles } from '../src/data/news/index.js';
import {
  BRAND_SUFFIX,
  DESCRIPTION_MAX,
  SHARE_TITLE_MAX,
  TITLE_MAX,
  TITLE_TARGET,
  fillCount,
  fleetSeo,
  hubSeo,
  newsHeadline,
  newsSeo,
  withBrand,
} from '../src/lib/page-seo.js';

describe('withBrand', () => {
  it('appends the brand only while the title stays within the target', () => {
    expect(withBrand("United O'Hare Hub Delays & On-Time")).toBe("United O'Hare Hub Delays & On-Time | The Blue Board");
    expect(withBrand('United 787-9 Dreamliner: 59 Aircraft & Seat Maps')).toBe('United 787-9 Dreamliner: 59 Aircraft & Seat Maps');
    const exact = 'x'.repeat(TITLE_TARGET - BRAND_SUFFIX.length);
    expect(withBrand(exact)).toBe(`${exact}${BRAND_SUFFIX}`);
    expect(withBrand(`${exact}x`)).toBe(`${exact}x`);
  });
});

describe('fillCount', () => {
  it('formats the count and replaces every token', () => {
    expect(fillCount('{count} jets, {count} total', 1139)).toBe('1,139 jets, 1,139 total');
    expect(fillCount(undefined, 5)).toBeUndefined();
  });
});

describe('fleet type SEO', () => {
  it.each(fleetOrder)('%s: title leads with "United", carries the live count, fits the SERP', (slug) => {
    const data = fleetTypes[slug];
    const seo = fleetSeo(data);
    expect(seo.title.startsWith('United ')).toBe(true);
    expect(seo.title).toContain(`${data.count.toLocaleString('en-US')} Aircraft`);
    expect(seo.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(seo.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(seo.ogTitle.length).toBeLessThanOrEqual(SHARE_TITLE_MAX);
    expect(seo.twitterTitle.length).toBeLessThanOrEqual(SHARE_TITLE_MAX);
    expect(seo.ogDescription.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(seo.twitterDescription.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it.each(fleetOrder)('%s: the count is a {count} token in the data, never hand-typed', (slug) => {
    const data = fleetTypes[slug];
    const handTyped = new RegExp(`(^|[^\\d.,-])${data.count}(?![\\d,])`);
    for (const field of ['title', 'description', 'ogTitle', 'ogDescription', 'twitterTitle', 'twitterDescription']) {
      expect(data[field], `${slug}.${field}`).toContain('{count}');
      expect(data[field], `${slug}.${field}`).not.toMatch(handTyped);
    }
  });

  it('the owner-approved 787-9 title', () => {
    expect(fleetSeo(fleetTypes['787-9-dreamliner']).title).toBe(
      `United 787-9 Dreamliner: ${fleetTypes['787-9-dreamliner'].count} Aircraft & Seat Maps`,
    );
  });
});

describe('hub SEO', () => {
  it.each(hubOrder)('%s: title leads with "United" and fits the SERP', (code) => {
    const seo = hubSeo(hubs[code]);
    expect(seo.title.startsWith('United ')).toBe(true);
    expect(seo.title.length).toBeLessThanOrEqual(TITLE_TARGET);
    expect(seo.description.length).toBeGreaterThanOrEqual(120);
    expect(seo.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(seo.ogTitle.length).toBeLessThanOrEqual(SHARE_TITLE_MAX);
    expect(seo.twitterDescription.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it('the owner-approved ORD title', () => {
    expect(hubSeo(hubs.ord).title).toBe("United O'Hare Hub Delays & On-Time | The Blue Board");
  });
});

describe('news SEO', () => {
  it.each(articles.map((a) => [a.slug, a]))('%s: short title and description, full headline kept', (_slug, a) => {
    const seo = newsSeo(a);
    expect(seo.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(seo.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(seo.ogTitle.length).toBeLessThanOrEqual(SHARE_TITLE_MAX);
    expect(a.title.length).toBeGreaterThan(0);
  });

  it('derives the headline before ":" when no seoTitle is set (owner-approved football title)', () => {
    const football = articles.find((a) => a.slug === 'united-dish-live-football-starlink-seatback');
    expect(newsSeo(football).title).toBe('Live Football at 35,000 Feet | The Blue Board');
    expect(newsHeadline({ title: 'Short: tail' })).toBe('Short: tail');
    expect(newsHeadline({ title: 'A long enough headline — with a tail', seoTitle: 'Override' })).toBe('Override');
  });

  it('falls back to the summary when no seoDescription is set', () => {
    expect(newsSeo({ title: 'T', summary: 'S' }).description).toBe('S');
  });
});
