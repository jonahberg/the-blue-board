import { describe, expect, it } from 'vitest';

import { FLEET_DB_COUNT } from '../src/data/facts.js';
import { GET } from '../src/pages/feed.xml.ts';

// Audit F50: the five static-page items in feed.xml had no <pubDate>.
describe('feed.xml', () => {
  it('gives every item a valid pubDate and states the fleet count from facts.js', async () => {
    const xml = await GET().text();
    const items = xml.split('<item>').slice(1);
    expect(items.length).toBeGreaterThan(5);
    for (const item of items) {
      const date = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
      expect(date, item.slice(0, 120)).toBeDefined();
      expect(Number.isNaN(Date.parse(date))).toBe(false);
    }
    expect(xml).toContain(`Fleet Database — ${FLEET_DB_COUNT.toLocaleString('en-US')} Aircraft`);
  });
});
