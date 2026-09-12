import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard: once 'unsafe-inline' was dropped from script-src (bug #4),
// CI should block any future change that re-adds it.
//
// Astro emits a small number of inline scripts for a client:only React island (the
// `astro:only` shim, the `astro-island` runtime, and the bundled service-worker
// registration). Those are allowed by 'sha256-…' hash, never by re-opening
// 'unsafe-inline' — and scripts/verify-csp-hashes.mjs fails the build if a hash in
// dist/ is missing from the header, so an Astro upgrade that changes one byte is
// caught at build time rather than by a blank dashboard in production.

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')
);

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

  it("allows the island's inline scripts by sha256 hash instead", () => {
    const scriptSrc = directive('script-src');
    const hashes = scriptSrc.match(/'sha256-[A-Za-z0-9+/=]+'/g) || [];
    expect(hashes.length, 'expected sha256 tokens for the Astro island scripts').toBeGreaterThan(0);
    // Base64 of a SHA-256 digest is always 44 characters, the last one '='.
    for (const hash of hashes) {
      expect(hash, hash).toMatch(/^'sha256-[A-Za-z0-9+/]{43}='$/);
    }
  });

  it('fails the build when a dist/ inline script is not in the header', () => {
    // Without this step in `bun run build`, a changed Astro runtime silently stops
    // matching its hash and the production page ships a skeleton with no dashboard —
    // green build, correct HTML, broken only under the real CSP header.
    expect(packageJson.scripts.build).toContain('bun scripts/verify-csp-hashes.mjs');
    expect(existsSync(resolve(__dirname, '..', 'scripts', 'verify-csp-hashes.mjs'))).toBe(true);
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

  it('allows self and the Web Analytics beacon host in connect-src (dropping self breaks /api fetches)', () => {
    const connectSrc = directive('connect-src');
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('https://va.vercel-scripts.com');
    // Speed Insights was canceled on the project in Jul 2026 and removed in 1.7.22; its vitals
    // endpoint must not creep back into the allowlist as dead weight.
    expect(connectSrc).not.toContain('https://vitals.vercel-insights.com');
  });
});

describe('authored markup carries no inline script', () => {
  // public/index.html is retired (kept for reference under legacy/, not served). The
  // homepage is now src/pages/index.astro plus the React island it mounts. Astro's own
  // island runtime is hash-allowed above; what must never come back is an inline
  // <script> or an on*= handler we write ourselves, because either would force
  // 'unsafe-inline' back into script-src.
  //
  // Only .astro files are scanned for handlers: `onClick={...}` in JSX is a React prop,
  // not an HTML attribute, and never reaches the document.

  function astroFilesIn(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) found.push(...astroFilesIn(path));
      else if (entry.name.endsWith('.astro')) found.push(path);
    }
    return found;
  }

  const pageSource = readFileSync(
    resolve(__dirname, '..', 'src', 'pages', 'index.astro'),
    'utf8'
  );

  it('index.astro has no inline executable <script> block', () => {
    // A <script src="..."> is bundled by Astro and served from 'self'; JSON-LD is data.
    const inline =
      pageSource.match(
        /<script(?![^>]*\b(type="application\/ld\+json"|src=))[^>]*>[\s\S]*?<\/script>/g
      ) || [];
    expect(inline).toHaveLength(0);
  });

  it('no .astro file carries an inline event handler', () => {
    const offenders = [];
    for (const file of astroFilesIn(resolve(__dirname, '..', 'src'))) {
      const source = readFileSync(file, 'utf8');
      const handlers =
        source.match(
          /\bon(click|load|error|focus|blur|mouseover|mouseout|submit|change|keydown|keyup|keypress)\s*=\s*["']/gi
        ) || [];
      if (handlers.length) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the dashboard island is client:only, so Astro emits no hydration payload to inline', () => {
    expect(pageSource).toContain('client:only="react"');
  });
});
