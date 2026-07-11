import { describe, it, expect } from 'vitest';
import { articles, newsOrder, newsMap, resolveTag } from '../src/data/news/index.js';

describe('news data validation', () => {
  it('exports articles as a non-empty array', () => {
    expect(Array.isArray(articles)).toBe(true);
    expect(articles.length).toBeGreaterThan(0);
  });

  it('every article has required fields', () => {
    for (const a of articles) {
      expect(a.slug).toBeTruthy();
      expect(a.title).toBeTruthy();
      expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.summary).toBeTruthy();
      expect(a.body).toBeTruthy();
      expect(['Fleet', 'Routes', 'Lounges', 'Policy', 'Operations']).toContain(a.category);
    }
  });

  it('slugs are unique', () => {
    const slugs = articles.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('slugs use only lowercase, digits, and hyphens', () => {
    for (const a of articles) {
      expect(a.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('source URLs are all https', () => {
    for (const a of articles) {
      if (a.sources) {
        for (const s of a.sources) {
          expect(s.url).toMatch(/^https:\/\//);
        }
      }
    }
  });

  it('newsOrder matches articles order', () => {
    expect(newsOrder).toEqual(articles.map((a) => a.slug));
  });

  it('newsMap has an entry for every slug', () => {
    for (const a of articles) {
      expect(newsMap[a.slug]).toBe(a);
    }
  });
});

describe('resolveTag', () => {
  it('resolves known hub tags', () => {
    const result = resolveTag('ord');
    expect(result).toEqual({ label: 'ORD Hub', url: '/hubs/ord' });
  });

  it('resolves known fleet tags', () => {
    const result = resolveTag('737-max-8');
    expect(result).not.toBeNull();
    expect(result.url).toBe('/fleet/737-max-8');
  });

  it('formats the fleet cross-link label from the slug', () => {
    // The label is the user-facing cross-link text on every news article; the
    // multi-step regex chain (Boeing prefix, Airbus prefix, MAX/ER upcase,
    // Dreamliner suffix) has broken silently before with only the url asserted.
    expect(resolveTag('737-max-8').label).toBe('Boeing 737 MAX 8');
    expect(resolveTag('a321neo').label).toBe('A321neo');
    expect(resolveTag('787-9-dreamliner').label).toBe('Boeing 787 9 Dreamliner');
  });

  it('returns null for unknown tags', () => {
    const result = resolveTag('nonexistent-tag');
    expect(result).toBeNull();
  });

  it('resolves all 9 hub codes', () => {
    const hubs = ['ord', 'den', 'iah', 'ewr', 'sfo', 'iad', 'lax', 'nrt', 'gum'];
    for (const h of hubs) {
      const result = resolveTag(h);
      expect(result).not.toBeNull();
      expect(result.url).toBe(`/hubs/${h}`);
    }
  });
});
