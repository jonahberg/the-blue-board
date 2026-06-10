import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const headerFor = (source) => (config.headers || []).find((h) => h.source === source);
const cacheControl = (source) => (headerFor(source)?.headers || []).find((h) => h.key === 'Cache-Control')?.value || '';

describe('static asset caching (vercel.json)', () => {
  it('no longer forces max-age=0 on /js/* — repeat visitors should not re-download the bundle every load', () => {
    const cc = cacheControl('/js/(.*)');
    expect(cc).toBeTruthy();
    expect(cc).not.toMatch(/max-age=0/);
    expect(cc).toMatch(/max-age=\d+/);
    expect(Number(cc.match(/max-age=(\d+)/)[1])).toBeGreaterThanOrEqual(3600);
  });

  it('no longer forces max-age=0 on /css/*', () => {
    const cc = cacheControl('/css/(.*)');
    expect(cc).not.toMatch(/max-age=0/);
    expect(Number(cc.match(/max-age=(\d+)/)[1])).toBeGreaterThanOrEqual(3600);
  });

  it('serves stale assets while revalidating so a deploy is picked up without blocking the load', () => {
    expect(cacheControl('/js/(.*)')).toMatch(/stale-while-revalidate=\d+/);
    expect(cacheControl('/css/(.*)')).toMatch(/stale-while-revalidate=\d+/);
  });

  it('keeps the HTML entrypoint uncached so it always carries the latest asset references', () => {
    // index.html must stay no-store, otherwise moderate asset caching could pin an old page that
    // references assets the new deploy changed.
    expect(cacheControl('/')).toMatch(/no-store|no-cache/);
    expect(cacheControl('/index.html')).toMatch(/no-store|no-cache/);
  });
});

describe('TSA cron cadence (vercel.json)', () => {
  it('refresh-tsa no longer runs every 5 minutes against the dead MyTSA upstream', () => {
    const cron = (config.crons || []).find((c) => c.path === '/api/cron/refresh-tsa');
    expect(cron, 'refresh-tsa cron missing').toBeTruthy();
    expect(cron.schedule).not.toBe('*/5 * * * *');
    // Hourly or less frequent until a live wait-times source replaces MyTSA.
    expect(cron.schedule).toMatch(/^0 (\*|\*\/\d+|\d+) \* \* \*$/);
  });
});
