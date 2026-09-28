import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ogImageType } from '../src/lib/og-image-type.js';

// v1.8.0 declared og:image:type image/png on 64 pages whose og:image is a JPEG (audit F40).
describe('ogImageType', () => {
  it('matches the extension of the real share images', () => {
    expect(ogImageType('https://theblueboard.co/og/og-fleet.jpg')).toBe('image/jpeg');
    expect(ogImageType('/og/og-news.JPEG')).toBe('image/jpeg');
    expect(ogImageType('https://theblueboard.co/og-image.png')).toBe('image/png');
    expect(ogImageType('/og/card.webp?v=2')).toBe('image/webp');
    expect(ogImageType('/og/card.jpg#x')).toBe('image/jpeg');
  });

  it('is what Seo.astro emits, not a literal', () => {
    const seo = readFileSync(resolve(__dirname, '../src/components/site/Seo.astro'), 'utf8');
    expect(seo).toContain('<meta property="og:image:type" content={ogImageType(imageUrl)} />');
    expect(seo).not.toMatch(/og:image:type" content="image\//);
  });
});
