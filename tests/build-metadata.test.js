import { describe, it, expect, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

import { execFileSync } from 'node:child_process';
import {
  xmlEscape,
  getFleetRouteLastmodPaths,
  getHubRouteLastmodPaths,
  getNewsRouteLastmodPaths,
  getTrackerRouteLastmodPaths,
  getTrackerDetailRouteLastmodPaths,
  homeLastmodPaths,
  fleetIndexLastmodPaths,
  hubIndexLastmodPaths,
  newsIndexLastmodPaths,
  trackersIndexLastmodPaths,
  getLastModified,
} from '../src/lib/buildMetadata.js';

const TODAY = new Date().toISOString().slice(0, 10); // matches the module's FALLBACK_DATE

describe('xmlEscape', () => {
  it('escapes ampersands', () => {
    expect(xmlEscape('A & B')).toBe('A &amp; B');
  });

  it('escapes angle brackets', () => {
    expect(xmlEscape('<tag>')).toBe('&lt;tag&gt;');
  });

  it('escapes double quotes', () => {
    expect(xmlEscape('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quotes (apostrophes)', () => {
    expect(xmlEscape("it's")).toBe('it&apos;s');
  });

  it('escapes multiple special characters in one string', () => {
    expect(xmlEscape('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('returns empty string unchanged', () => {
    expect(xmlEscape('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(xmlEscape('hello world')).toBe('hello world');
  });
});

describe('route lastmod path helpers', () => {
  it('getFleetRouteLastmodPaths includes slug-specific data file', () => {
    const paths = getFleetRouteLastmodPaths('737-800');
    expect(paths).toContain('src/data/fleet/737-800.js');
    expect(paths).toContain('src/pages/fleet/[type].astro');
  });

  it('getHubRouteLastmodPaths includes slug-specific data file', () => {
    const paths = getHubRouteLastmodPaths('den');
    expect(paths).toContain('src/data/hubs/den.js');
    expect(paths).toContain('src/pages/hubs/[hub].astro');
  });

  it('getNewsRouteLastmodPaths includes layout and data index', () => {
    const paths = getNewsRouteLastmodPaths('some-article');
    expect(paths).toContain('src/layouts/NewsLayout.astro');
    expect(paths).toContain('src/data/news/index.js');
  });
});

describe('getLastModified', () => {
  // Drives the sitemap lastmod dates: a git shell-out, an output-vs-fallback
  // branch, and a cross-call memo. Each case uses a unique path list so the
  // module-level cache never bleeds between tests.
  it('returns the git commit date as a YYYY-MM-DD string', () => {
    execFileSync.mockReturnValue('2026-05-01\n');
    const value = getLastModified(['fixture/tracked-a.js']);
    expect(value).toBe('2026-05-01');
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back to the build date when git produces no output', () => {
    execFileSync.mockReturnValue('');
    const value = getLastModified(['fixture/untracked-b.js']);
    expect(value).toBe(TODAY);
  });

  it('falls back to the build date when the git shell-out throws', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    const value = getLastModified(['fixture/throws-c.js']);
    expect(value).toBe(TODAY);
  });

  it('memoizes per path list — git is invoked once across repeat calls', () => {
    execFileSync.mockReset();
    execFileSync.mockReturnValue('2026-06-15\n');
    const paths = ['fixture/memo-d.js'];
    const first = getLastModified(paths);
    const second = getLastModified(paths);
    expect(first).toBe('2026-06-15');
    expect(second).toBe('2026-06-15');
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('static lastmod path arrays', () => {
  it('homeLastmodPaths includes index.html and style.css', () => {
    expect(homeLastmodPaths).toContain('public/index.html');
    expect(homeLastmodPaths).toContain('public/css/style.css');
  });

  it('fleetIndexLastmodPaths includes fleet page and data', () => {
    expect(fleetIndexLastmodPaths).toContain('src/pages/fleet/index.astro');
    expect(fleetIndexLastmodPaths).toContain('public/data/fleet.json');
  });

  it('hubIndexLastmodPaths includes hubs page', () => {
    expect(hubIndexLastmodPaths).toContain('src/pages/hubs/index.astro');
  });

  it('newsIndexLastmodPaths includes news page and data', () => {
    expect(newsIndexLastmodPaths).toContain('src/pages/news/index.astro');
    expect(newsIndexLastmodPaths).toContain('src/data/news/index.js');
  });

  it('trackersIndexLastmodPaths includes the index page and both data files', () => {
    expect(trackersIndexLastmodPaths).toContain('src/pages/trackers/index.astro');
    expect(trackersIndexLastmodPaths).toContain('src/data/trackers/atc.js');
    expect(trackersIndexLastmodPaths).toContain('src/data/trackers/united-hubs.js');
  });

  it('per-tracker lastmod paths include the slug-specific page AND data file so the two trackers never share a lastmod', () => {
    const atc = getTrackerRouteLastmodPaths('atc');
    const united = getTrackerRouteLastmodPaths('united-hubs');
    expect(atc).toContain('src/pages/trackers/atc.astro');
    expect(atc).toContain('src/data/trackers/atc.js');
    expect(united).toContain('src/data/trackers/united-hubs.js');
    expect(atc.filter((p) => !united.includes(p)).length).toBeGreaterThan(0);
  });

  it('tracker detail lastmod paths include the route template, shared layout, helper, and own data', () => {
    const atc = getTrackerDetailRouteLastmodPaths('atc');
    const united = getTrackerDetailRouteLastmodPaths('united-hubs');
    expect(atc).toContain('src/pages/trackers/atc/[code].astro');
    expect(atc).toContain('src/data/trackers/atc.js');
    expect(united).toContain('src/pages/trackers/united-hubs/[code].astro');
    expect(united).toContain('src/data/trackers/united-hubs.js');
    expect(atc).toContain('src/components/trackers/TrackerDetailLayout.astro');
  });
});
