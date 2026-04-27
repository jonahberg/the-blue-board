import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeCacheVersion, CACHE_VERSION_PLACEHOLDER } from '../scripts/computeCacheVersion.mjs';

describe('public/sw.js cache version integration', () => {
  it('contains the __BUILD_SHA__ placeholder for the stamp script to find', async () => {
    const sw = await readFile(resolve('public/sw.js'), 'utf8');
    expect(sw).toContain(CACHE_VERSION_PLACEHOLDER);
  });

  it('declares CACHE_VERSION in the v9-{placeholder} format', async () => {
    const sw = await readFile(resolve('public/sw.js'), 'utf8');
    // The exact pattern the stamp script depends on
    expect(sw).toMatch(/const CACHE_VERSION = 'v9-__BUILD_SHA__';/);
  });

  it('stamp replacement produces a valid version string', () => {
    const sw = `const CACHE_VERSION = 'v9-__BUILD_SHA__';`;
    const version = computeCacheVersion('abc12345def67890');
    const replaced = sw.replaceAll(CACHE_VERSION_PLACEHOLDER, version.replace('v9-', ''));
    expect(replaced).toBe(`const CACHE_VERSION = 'v9-abc12345';`);
  });

  it('stamp replacement with no SHA produces v9-dev', () => {
    const sw = `const CACHE_VERSION = 'v9-__BUILD_SHA__';`;
    const version = computeCacheVersion(undefined);
    const replaced = sw.replaceAll(CACHE_VERSION_PLACEHOLDER, version.replace('v9-', ''));
    expect(replaced).toBe(`const CACHE_VERSION = 'v9-dev';`);
  });
});
