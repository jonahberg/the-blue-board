// Where a Starlink fact on a content page links (src/lib/starlink-link.js): the dashboard's
// Starlink tab, the address the dashboard itself opens that tab from.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TAB_HASHES } from '../src/app/tabs';
import { STARLINK_TAB_HREF } from '../src/lib/starlink-link.js';

const ROOT = resolve(__dirname, '..');

describe('STARLINK_TAB_HREF', () => {
  it('is the dashboard at the Starlink tab', () => {
    expect(STARLINK_TAB_HREF).toBe('/#starlink');
    const url = new URL(STARLINK_TAB_HREF, 'https://theblueboard.co');
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
    // The dashboard opens a tab from location.hash by an exact match against TAB_HASHES.
    expect(url.hash).toBe(TAB_HASHES.starlink);
  });
});

describe('the content pages take the address from here', () => {
  it('no content page, layout, component or page script types /#starlink by hand', () => {
    const files = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(astro|ts|js)$/.test(name)) files.push(relative(ROOT, path));
      }
    })(resolve(ROOT, 'src'));
    const content = files.filter((p) => /^src\/(pages|layouts|components|scripts)\//.test(p));
    const typed = content.filter((p) => /["'`]\/#starlink["'`]/.test(readFileSync(resolve(ROOT, p), 'utf8')));
    expect(content.length).toBeGreaterThan(50);
    expect(typed).toEqual([]);
  });
});
