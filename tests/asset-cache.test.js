import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const headerFor = (source) => (config.headers || []).find((h) => h.source === source);
const cacheControl = (source) => (headerFor(source)?.headers || []).find((h) => h.key === 'Cache-Control')?.value || '';
const maxAge = (source) => Number(cacheControl(source).match(/max-age=(\d+)/)?.[1] ?? NaN);

describe('static asset caching (vercel.json)', () => {
  it('keeps the HTML entrypoint uncached so it always carries the latest asset references', () => {
    // index.html must stay no-store, otherwise moderate asset caching could pin an old page that
    // references assets the new deploy changed.
    expect(cacheControl('/')).toMatch(/no-store|no-cache/);
    expect(cacheControl('/index.html')).toMatch(/no-store|no-cache/);
  });

  it('caches hashed /_astro/* bundles as immutable — their filenames change on every content change', () => {
    const cc = cacheControl('/_astro/(.*)');
    expect(cc).toMatch(/immutable/);
    expect(maxAge('/_astro/(.*)')).toBeGreaterThanOrEqual(31536000);
  });

  // Every prerendered content section gets the same treatment: cacheable for an hour in the
  // browser, a day at the edge, and served stale while it revalidates so a deploy is picked up
  // without blocking the load. A section missing from this list is a section every visitor
  // re-downloads on every navigation.
  it.each(['/hubs/(.*)', '/fleet/(.*)', '/news/(.*)', '/trackers/(.*)'])(
    'caches %s pages like the other content sections',
    (source) => {
      expect(cacheControl(source), `${source} has no Cache-Control rule`).toBeTruthy();
      expect(maxAge(source)).toBeGreaterThanOrEqual(3600);
      expect(cacheControl(source)).toMatch(/stale-while-revalidate=\d+/);
    },
  );

  it.each(['/icons/(.*)', '/og/(.*)'])('caches %s images for a day', (source) => {
    expect(cacheControl(source), `${source} has no Cache-Control rule`).toBeTruthy();
    expect(maxAge(source)).toBeGreaterThanOrEqual(86400);
  });

  it('no longer carries rules for /js/* or /css/* — both directories are gone (v1.8.0)', () => {
    // The unhashed `public/js/` bundle and `public/css/style.css` were the old dashboard's
    // app code, and their max-age=3600 rule was the compromise that tolerated an unhashed
    // filename. Everything they shipped is now content-hashed under `_astro/` and covered by
    // the immutable rule above, so a rule here would only match dead paths — and a NEW rule
    // under either prefix would mean unhashed app code had come back.
    expect(headerFor('/js/(.*)')).toBeUndefined();
    expect(headerFor('/css/(.*)')).toBeUndefined();
  });
});
