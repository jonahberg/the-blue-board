import { describe, expect, it } from 'vitest';

import { hubOrder, hubs } from '../src/data/hubs/index.js';

// Audit F77/F78: NRT and GUM rendered description-less cards on /hubs, and ORD's "Key Routes"
// list carried two different "Pacific:" rows.
describe('hub copy', () => {
  it.each(hubOrder)('%s has a card subtitle', (key) => {
    expect(typeof hubs[key].subtitle).toBe('string');
    expect(hubs[key].subtitle.length).toBeGreaterThan(20);
  });

  it('no hub page repeats a label within one list', () => {
    for (const key of hubOrder) {
      for (const list of hubs[key].contentHtml.match(/<ul>[\s\S]*?<\/ul>/g) ?? []) {
        const labels = [...list.matchAll(/<li><strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
        expect(new Set(labels).size, `${key}: ${labels.join(', ')}`).toBe(labels.length);
      }
    }
  });
});
