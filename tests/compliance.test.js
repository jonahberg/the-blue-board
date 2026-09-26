import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Attribution / announcement-channel compliance pins (audit findings, Jun 2026):
//  1. The static "Data feeds restored" banner announced a one-off June 7 recovery and can
//     never become true again — it must stay deleted (markup + script).
//  2. Schedules are sourced from AeroDataBox, NOT Flightradar24. Public attribution saying
//     otherwise is an FR24 ToS violation. FR24 credit stays only for live aircraft positions.
//  3. Both Leaflet maps draw CARTO tiles over OpenStreetMap data (ODbL) — suppressing the
//     attribution control (`attributionControl: false`) is a license violation.

// The dashboard is the React island under src/app now; public/index.html and
// src/dashboard/main.js no longer render anything a visitor sees.
const APP_DIR = fileURLToPath(new URL('../src/app', import.meta.url));

function filesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/** Comments are prose ABOUT the rules, not the rules — a doc comment quoting a banned
    option must not read as the option being used. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const appFiles = filesUnder(APP_DIR);
const appSource = appFiles.map((file) => stripComments(readFileSync(file, 'utf8'))).join('\n');
const mapSource = appFiles
  .filter((file) => file.includes(`${'/'}app${'/'}map${'/'}`))
  .map((file) => stripComments(readFileSync(file, 'utf8')))
  .join('\n');
const sourcesView = stripComments(
  readFileSync(new URL('../src/app/views/SourcesView.tsx', import.meta.url), 'utf8')
);

describe('stale "Data feeds restored" banner is fully removed', () => {
  it('the dashboard has no reference to restored-banner (markup, ids, or script tag)', () => {
    expect(appSource).not.toContain('restored-banner');
    expect(appSource).not.toContain('data-restored');
  });

  it('public/js/restored-banner.js does not exist', () => {
    const path = fileURLToPath(new URL('../public/js/restored-banner.js', import.meta.url));
    expect(existsSync(path)).toBe(false);
  });
});

describe('schedule attribution names AeroDataBox, not Flightradar24', () => {
  it('the dashboard credits AeroDataBox at least twice (micro-attribution + Sources panel)', () => {
    const count = appSource.split('AeroDataBox').length - 1;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('every "Schedule data via" credit in the dashboard names AeroDataBox, never FR24', () => {
    // Window-free assertion: the provider named FIRST after the phrase must be AeroDataBox.
    // A fixed character window cannot work across both call sites — one wraps the name in a
    // multi-line anchor, the other sits next to the (correct) FR24 positions credit.
    const marker = 'Schedule data via';
    let at = appSource.indexOf(marker);
    expect(at, 'no "Schedule data via" attribution found in src/app').toBeGreaterThan(-1);
    let occurrences = 0;
    while (at !== -1) {
      occurrences += 1;
      const rest = appSource.slice(at + marker.length);
      const aeroAt = rest.search(/AeroDataBox|aerodatabox\.com/);
      const fr24At = rest.search(/Flightradar24|flightradar24\.com/);
      expect(aeroAt, `"${marker}" #${occurrences} does not credit AeroDataBox`).toBeGreaterThan(-1);
      expect(
        fr24At === -1 || aeroAt < fr24At,
        `"${marker}" #${occurrences} names Flightradar24 before AeroDataBox`
      ).toBe(true);
      at = appSource.indexOf(marker, at + 1);
    }
    // Once in the always-visible attribution strip, once in the Sources panel.
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('never claims schedules come from Flightradar24', () => {
    expect(appSource).not.toContain('Schedule data via Flightradar24');
    expect(appSource).not.toMatch(/Schedule data via\s*(?:<[^>]*>\s*)*Flightradar24/);
    expect(appSource).not.toContain('Flight Schedule — Flightradar24');
  });
});

describe('Leaflet maps carry OpenStreetMap/CARTO attribution (ODbL)', () => {
  it('no map module suppresses the attribution control', () => {
    expect(mapSource, 'expected src/app/map/* to exist').not.toBe('');
    expect(mapSource).not.toContain('attributionControl: false');
    expect(mapSource).not.toContain('attributionControl:false');
    expect(mapSource).not.toContain('attributionControl:!1');
  });

  it('the tile layer carries the OpenStreetMap and CARTO credit', () => {
    // Leaflet's attribution control renders whatever the tile layer declares, so the credit
    // living on the layer is what makes it appear on every map that uses it.
    expect(mapSource).toContain('OpenStreetMap');
    expect(mapSource).toContain('carto.com/attributions');
    expect(mapSource).toContain('attribution:');
  });
});

describe('Sources panel lists schedule + basemap providers', () => {
  it('names AeroDataBox as the schedule source', () => {
    expect(sourcesView).toContain('AeroDataBox');
  });

  it('names CARTO and OpenStreetMap for the basemap (ODbL)', () => {
    expect(sourcesView).toContain('CARTO');
    expect(sourcesView).toContain('OpenStreetMap');
  });

  it('credits FR24 for positions only, never for schedules', () => {
    const fr24At = sourcesView.indexOf('Flightradar24');
    expect(fr24At).toBeGreaterThan(-1);
    expect(sourcesView.slice(fr24At, fr24At + 400)).toMatch(/position/i);
  });
});
