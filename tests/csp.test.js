import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard: once 'unsafe-inline' was dropped from script-src (bug #4),
// CI should block any future change that re-adds it. This test also asserts
// that the inline script blocks in public/index.html have all been extracted
// to external files, since CSP will block them otherwise.

describe('Content-Security-Policy configuration', () => {
  const vercelJson = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'vercel.json'), 'utf8')
  );
  const globalHeaders = vercelJson.headers.find((h) => h.source === '/(.*)');
  const cspHeader = globalHeaders.headers.find(
    (h) => h.key === 'Content-Security-Policy'
  );
  const csp = cspHeader.value;

  function directive(name) {
    const match = csp.match(new RegExp(`${name}\\s+([^;]+)`));
    return match ? match[1].trim() : '';
  }

  it('defines a CSP header for all paths', () => {
    expect(cspHeader).toBeTruthy();
    expect(csp).toMatch(/script-src/);
    expect(csp).toMatch(/style-src/);
  });

  it('does NOT include unsafe-inline in script-src (bug #4)', () => {
    const scriptSrc = directive('script-src');
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('does NOT include unsafe-eval in script-src', () => {
    const scriptSrc = directive('script-src');
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('retains unsafe-inline in style-src (documented gap, migration in v1.5.6)', () => {
    // Inline styles are pervasive throughout the onboarding overlay, hub cards,
    // ticker — migrating them all to classes is a v1.5.6 task. Tightening
    // script-src alone is the 90% security win.
    const styleSrc = directive('style-src');
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it('allows the trusted leaflet CDN for stylesheets and scripts', () => {
    expect(directive('script-src')).toContain('https://unpkg.com');
    expect(directive('style-src')).toContain('https://unpkg.com');
  });

  it('allows Vercel analytics script endpoints', () => {
    expect(directive('script-src')).toContain('https://va.vercel-scripts.com');
  });

  it('disallows framing (frame-ancestors none)', () => {
    expect(csp).toMatch(/frame-ancestors\s+'none'/);
  });

  it('allows the basemap + radar tile hosts in img-src (dropping one blanks the map)', () => {
    // Leaflet loads the CARTO basemap and Iowa Mesonet NEXRAD radar as <img> tiles;
    // both are gated by img-src. Removing a host silently blanks the map/radar —
    // the same visible outcome as the guarded Leaflet-CSS incident.
    const imgSrc = directive('img-src');
    expect(imgSrc).toContain('https://*.basemaps.cartocdn.com');
    expect(imgSrc).toContain('https://*.tile.openstreetmap.org');
    expect(imgSrc).toContain('https://mesonet.agron.iastate.edu');
  });

  it('allows self and Vercel vitals in connect-src (dropping them breaks /api fetches)', () => {
    const connectSrc = directive('connect-src');
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('https://vitals.vercel-insights.com');
  });
});

describe('public/index.html inline script audit', () => {
  const indexHtml = readFileSync(
    resolve(__dirname, '..', 'public', 'index.html'),
    'utf8'
  );

  it('contains no inline executable <script> blocks', () => {
    // JSON-LD structured data (<script type="application/ld+json">) is not
    // executable and is not blocked by CSP; those are allowed. The assertion
    // excludes those and any <script> with a src= attribute.
    const scriptBlocks = indexHtml.match(/<script(?![^>]*\b(type="application\/ld\+json"|src=))[^>]*>[\s\S]*?<\/script>/g) || [];
    expect(scriptBlocks).toHaveLength(0);
  });

  it('contains no inline event handlers (onclick/onload/onerror/etc.)', () => {
    // Any on*="..." attribute would require 'unsafe-inline' in script-src.
    // This regex intentionally matches only the common inline-handler names.
    const inlineHandlers = indexHtml.match(
      /\bon(click|load|error|focus|blur|mouseover|mouseout|submit|change|keydown|keyup|keypress)\s*=/gi
    ) || [];
    expect(inlineHandlers).toHaveLength(0);
  });
});
