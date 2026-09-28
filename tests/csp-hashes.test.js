import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inlineScripts, sha256 } from '../scripts/lib/csp-hashes.mjs';

// scripts/verify-csp-hashes.mjs fails `bun run build` when an inline script in dist/ is not
// hash-allowed by the CSP. If the parser wrongly SKIPS an executable script, the drift ships
// with a green build and the browser silently refuses to run it — so the parser gets its own
// tests rather than only a "the build calls it" check.

describe('inlineScripts', () => {
  it('skips JSON-LD and application/json data blocks', () => {
    const html = '<script type="application/ld+json">{"@type":"WebSite"}</script>'
      + '<script type="application/json" data-trk-config>{"a":1}</script>';
    expect(inlineScripts(html)).toEqual([]);
  });

  it('collects classic, type=module and text/javascript inline scripts', () => {
    const html = '<script>a()</script><script type="module">b()</script>'
      + '<script type="text/javascript">c()</script>';
    expect(inlineScripts(html)).toEqual(['a()', 'b()', 'c()']);
  });

  it('matches an unquoted type attribute', () => {
    expect(inlineScripts('<script type=module>m()</script>')).toEqual(['m()']);
    expect(inlineScripts('<script type=application/json>{}</script>')).toEqual([]);
  });

  it('ignores a "<script>" inside an HTML comment', () => {
    const html = '<!-- an old <script>bad()</script> note --><script>real()</script>';
    expect(inlineScripts(html)).toEqual(['real()']);
  });

  it('skips external scripts (src=, covered by self)', () => {
    expect(inlineScripts('<script src="/_astro/x.js"></script>')).toEqual([]);
    expect(inlineScripts('<script type="module" src=/_astro/y.js></script>')).toEqual([]);
  });

  it('still collects an inline script whose attributes merely END in "src" (data-src)', () => {
    // `\bsrc=` matched the tail of `data-src=` and skipped a script that does execute.
    expect(inlineScripts('<script data-src="x">run()</script>')).toEqual(['run()']);
  });

  it('skips an empty or whitespace-only body', () => {
    expect(inlineScripts('<script></script><script>  \n </script>')).toEqual([]);
  });

  it('returns the exact bytes between the tags (no trimming — CSP hashes them verbatim)', () => {
    expect(inlineScripts('<script>\n  x()\n</script>')).toEqual(['\n  x()\n']);
  });
});

describe('sha256', () => {
  it('matches the well-known hash of the empty string', () => {
    expect(sha256('')).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });

  it('hashes UTF-8 bytes in base64', () => {
    const body = "console.log('✈')";
    expect(sha256(body)).toBe(`sha256-${createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64')}`);
  });
});

describe('verify-csp-hashes.mjs end to end', () => {
  const script = resolve(__dirname, '..', 'scripts', 'verify-csp-hashes.mjs');

  function run(scriptSrc) {
    const dir = mkdtempSync(join(tmpdir(), 'csp-verify-'));
    try {
      mkdirSync(join(dir, 'dist', 'hubs'), { recursive: true });
      writeFileSync(join(dir, 'dist', 'hubs', 'index.html'), '<html><script type="module">boot()</script></html>');
      writeFileSync(join(dir, 'vercel.json'), JSON.stringify({
        headers: [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: `script-src ${scriptSrc}` }] }],
      }));
      return spawnSync('bun', [script], { cwd: dir, encoding: 'utf8' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('exits 1 and prints the missing hash when a dist/ inline script is not allowed', () => {
    const result = run("'self'");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(sha256('boot()'));
  });

  it('exits 0 when every inline script is hash-allowed', () => {
    const result = run(`'self' '${sha256('boot()')}'`);
    expect(result.status).toBe(0);
  });
});
