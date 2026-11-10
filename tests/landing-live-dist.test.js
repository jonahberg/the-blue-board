// The built hub and fleet type pages (dist/), after the live board / live strip landed: the static
// HTML must be complete without JS, carry no emoji controls and no leftover one-number LIVE box,
// and keep every structured-data block it had. Runs after `bun run build` (CI builds first), like
// dist-a11y.test.js.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { fleetOrder } from '../src/data/fleet/index.js';
import { hubOrder, hubs } from '../src/data/hubs/index.js';

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));
const read = (rel) => readFileSync(join(DIST, rel), 'utf8');
const jsonLdTypes = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])['@type']);
const EMOJI = /\p{Extended_Pictographic}/u;
const linkTexts = (html) => [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());

describe.skipIf(!hasDist)('built hub pages', () => {
  for (const key of hubOrder) {
    const html = hasDist ? read(`hubs/${key}.html`) : '';
    const iata = hubs[key].iata;

    it(`${key}: one departures board, static first, with the one primary link into the Schedule board`, () => {
      expect(html.match(/data-hub-board="/g)).toHaveLength(1);
      expect(html).toContain(`data-hub-board="${iata}"`);
      expect(html).toContain('data-state="static"');
      expect(html).toContain('<template data-hb-row>');
      expect(html).toContain(`href="/?tab=schedule&amp;hub=${key}"`);
      expect(html).toMatch(new RegExp(`Open the full ${iata} board`));
      // The quiet line a JS-off reader (or a failed fetch) sees.
      expect(html).toContain('data-hb-fallback');
      // Height is reserved only while scripting is enabled — never an empty frame without JS.
      expect(html).toMatch(/\[@media\(scripting:enabled\)\]:min-h-\[/);
      expect(html).not.toMatch(/aria-live="(polite|assertive)"[^>]*data-hb/);
    });

    it(`${key}: no emoji controls and no old one-number LIVE box`, () => {
      expect(html).not.toContain('class="cta"');
      expect(html).not.toContain('id="active"');
      expect(html).not.toContain('id="updated-time"');
      expect(html).not.toContain('Active United Flights');
      for (const text of linkTexts(html)) expect(text, `link "${text}"`).not.toMatch(EMOJI);
    });

    it(`${key}: keeps its structured data and h1`, () => {
      const types = jsonLdTypes(html);
      expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'FAQPage', 'Airport']));
      expect(html.match(/<h1\b/g)).toHaveLength(1);
    });
  }

  it('the compact pages keep the old bar’s ICAO / time-zone line as copy', () => {
    expect(read('hubs/nrt.html')).toContain('ICAO: RJAA · Timezone: JST (UTC+9)');
    expect(read('hubs/gum.html')).toContain('ICAO: PGUM · Timezone: ChST (UTC+10)');
  });

  it('ships no inline executable script (CSP: script-src self + two hashed island scripts)', () => {
    for (const key of hubOrder) {
      const inline = [...read(`hubs/${key}.html`).matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/g)];
      expect(inline, key).toEqual([]);
    }
  });
});

describe.skipIf(!hasDist)('built fleet type pages', () => {
  const fleetDb = JSON.parse(readFileSync(resolve(__dirname, '..', 'public', 'data', 'fleet.json'), 'utf8'));

  for (const slug of fleetOrder) {
    const html = hasDist ? read(`fleet/${slug}.html`) : '';

    it(`${slug}: one live strip carrying exactly this type's registry tails`, async () => {
      const { fleetTypes } = await import('../src/data/fleet/index.js');
      const typeCode = fleetTypes[slug].typeCode;
      const expected = fleetDb.filter((a) => a.t === typeCode).map((a) => a.r).sort();
      const m = html.match(/data-tails="([^"]*)"/);
      expect(m).not.toBeNull();
      expect(m[1].split(',').sort()).toEqual(expected);
      expect(html).toContain('data-fl-fallback');
      expect(html).toMatch(/\[@media\(scripting:enabled\)\]:min-h-\[/);
    });

    it(`${slug}: keeps its structured data`, () => {
      expect(jsonLdTypes(html)).toEqual(expect.arrayContaining(['BreadcrumbList', 'FAQPage', 'AboutPage']));
    });
  }
});
