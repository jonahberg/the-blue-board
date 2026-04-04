import { describe, it, expect } from 'vitest';
import {
  xmlEscape,
  getFleetRouteLastmodPaths,
  getHubRouteLastmodPaths,
  getNewsRouteLastmodPaths,
  homeLastmodPaths,
  fleetIndexLastmodPaths,
  hubIndexLastmodPaths,
  newsIndexLastmodPaths,
} from '../src/lib/buildMetadata.js';

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
});
