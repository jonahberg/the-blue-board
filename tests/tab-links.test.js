// The dashboard addresses a link opens a whole tab (or the Fleet tab's Airborne Now list, or the
// NAS status panel) with, each written in one place: src/lib/tab-links.js, the Starlink tab's in
// src/lib/starlink-link.js (which the content pages share), the NAS panel's in src/lib/hub-link.js.
// Each is one the dashboard follows in place and a cold load opens the same way, and no dashboard
// file writes one by hand.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { resolveDeepLink } from '../src/app/state/deep-links';
import { TAB_HASHES } from '../src/app/tabs';
import { NAS_STATUS_HREF, hubStatusLink } from '../src/lib/hub-link.js';
import { STARLINK_TAB_HREF } from '../src/lib/starlink-link.js';
import {
  FLEET_AIRBORNE_HREF,
  FLEET_TAB_HREF,
  LIVE_TAB_HREF,
  MY_FLIGHTS_HREF,
  SCHEDULE_TAB_HREF,
  WEATHER_TAB_HREF,
} from '../src/lib/tab-links.js';

const ROOT = resolve(__dirname, '..');
const NOTHING_ELSE = { scrollTo: null, scheduleHub: null, aircraft: null, fleet: null };

describe('the whole-tab addresses', () => {
  it.each([
    [LIVE_TAB_HREF, 'live'],
    [SCHEDULE_TAB_HREF, 'schedule'],
    [FLEET_TAB_HREF, 'fleet'],
    [WEATHER_TAB_HREF, 'weather'],
    [MY_FLIGHTS_HREF, 'myflight'],
    [STARLINK_TAB_HREF, 'starlink'],
  ])('%s opens the %s tab and nothing else, in place', (href, tab) => {
    expect(href).toBe(`/${TAB_HASHES[tab]}`);
    expect(resolveDeepLink(href)).toEqual({ tab, ...NOTHING_ELSE });
  });
});

describe('the two addresses that name more than a tab', () => {
  it('the Fleet tab on Airborne Now, with no filter', () => {
    expect(resolveDeepLink(FLEET_AIRBORNE_HREF)).toEqual({ ...NOTHING_ELSE, tab: 'fleet', fleet: { filter: null, view: 'airborne' } });
  });

  it('the NAS status panel on the Weather tab, the address every FAA code links to', () => {
    expect(resolveDeepLink(NAS_STATUS_HREF)).toEqual({ ...NOTHING_ELSE, tab: 'weather', scrollTo: 'nas-section' });
    for (const code of ['EWR', 'LGA', 'KBOS']) expect(hubStatusLink(code, 'nas')?.href).toBe(NAS_STATUS_HREF);
  });
});

/** Every file under `dir` with one of the extensions. */
function files(dir, extensions) {
  const out = [];
  (function walk(d) {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (extensions.some((ext) => name.endsWith(ext))) out.push(relative(ROOT, path));
    }
  })(resolve(ROOT, dir));
  return out;
}

/** The string literals in a source file (comments are not read). */
function stringLiterals(file, source = readFileSync(resolve(ROOT, file), 'utf8')) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  (function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

describe('one home per address', () => {
  const HOMES = {
    'src/lib/tab-links.js': [LIVE_TAB_HREF, SCHEDULE_TAB_HREF, FLEET_TAB_HREF, FLEET_AIRBORNE_HREF, WEATHER_TAB_HREF, MY_FLIGHTS_HREF],
    'src/lib/starlink-link.js': [STARLINK_TAB_HREF],
    'src/lib/hub-link.js': [NAS_STATUS_HREF],
  };
  const ADDRESSES = new Set(Object.values(HOMES).flat());

  it('no dashboard file or library module writes one of them by hand', () => {
    const scanned = [...files('src/app', ['.ts', '.tsx']), ...files('src/lib', ['.js', '.ts'])];
    expect(scanned.length).toBeGreaterThan(100);
    const typed = scanned.flatMap((file) =>
      stringLiterals(file)
        .filter((text) => ADDRESSES.has(text) && !HOMES[file]?.includes(text))
        .map((text) => `${file}: '${text}'`),
    );
    expect(typed).toEqual([]);
  });

  it('no content page, layout, component or page script writes one by hand either', () => {
    const astro = [...files('src/pages', ['.astro']), ...files('src/layouts', ['.astro']), ...files('src/components', ['.astro'])];
    const scripts = files('src/scripts', ['.ts']);
    expect(astro.length + scripts.length).toBeGreaterThan(50);
    // An .astro template is not TypeScript: an address in quotes is an attribute or a string.
    const quoted = (text) => [...ADDRESSES].filter((address) => ['"', "'", '`'].some((q) => text.includes(`${q}${address}${q}`)));
    const typed = [
      ...astro.flatMap((file) => quoted(readFileSync(resolve(ROOT, file), 'utf8')).map((text) => `${file}: '${text}'`)),
      ...scripts.flatMap((file) => stringLiterals(file).filter((text) => ADDRESSES.has(text)).map((text) => `${file}: '${text}'`)),
    ];
    expect(typed).toEqual([]);
  });

  it('the scan sees a hand-typed copy, and not an address named in a comment', () => {
    const source = "const a = <DashLink href=\"/#live\" />;\nconst b = { href: `/#starlink` };\n// '/#fleet' in a comment";
    expect(stringLiterals('x.tsx', source).filter((text) => ADDRESSES.has(text))).toEqual(['/#live', '/#starlink']);
  });
});
