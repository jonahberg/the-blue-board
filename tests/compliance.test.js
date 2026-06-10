import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Attribution / announcement-channel compliance pins (audit findings, Jun 2026):
//  1. The static "Data feeds restored" banner announced a one-off June 7 recovery and can
//     never become true again — it must stay deleted (markup + script).
//  2. Schedules are sourced from AeroDataBox, NOT Flightradar24. Public attribution saying
//     otherwise is an FR24 ToS violation. FR24 credit stays only for live aircraft positions.
//  3. Both Leaflet maps draw CARTO tiles over OpenStreetMap data (ODbL) — suppressing the
//     attribution control (`attributionControl: false`) is a license violation.

const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const mainJs = readFileSync(new URL('../src/dashboard/main.js', import.meta.url), 'utf8');

describe('stale "Data feeds restored" banner is fully removed', () => {
  it('index.html has no reference to restored-banner (markup, ids, or script tag)', () => {
    expect(indexHtml).not.toContain('restored-banner');
    expect(indexHtml).not.toContain('data-restored');
  });

  it('public/js/restored-banner.js does not exist', () => {
    const path = fileURLToPath(new URL('../public/js/restored-banner.js', import.meta.url));
    expect(existsSync(path)).toBe(false);
  });
});

describe('schedule attribution names AeroDataBox, not Flightradar24', () => {
  it('index.html credits AeroDataBox at least twice (micro-attribution + Sources panel)', () => {
    const count = indexHtml.split('AeroDataBox').length - 1;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('index.html no longer claims "Schedule data via Flightradar24"', () => {
    expect(indexHtml).not.toContain('Schedule data via Flightradar24');
    // The live markup wraps the source in an anchor ("Schedule data via <a ...>Flightradar24</a>"),
    // so also pin the tag-tolerant variant — the plain-string check above can't see it.
    expect(indexHtml).not.toMatch(/Schedule data via\s*(?:<[^>]*>\s*)*Flightradar24/);
    expect(indexHtml).not.toContain('Flight Schedule — Flightradar24');
  });

  it('the dynamic schedule footer (updateSchedTzFooter) credits AeroDataBox, not FR24', () => {
    // main.js REBUILDS #sched-tz-footer on every schedule render, so the static index.html
    // fix alone is overwritten at runtime. Pin the JS side: every "Schedule data via" builder
    // must link AeroDataBox within the following code, and never Flightradar24.
    const marker = 'Schedule data via';
    let at = mainJs.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    while (at !== -1) {
      const builder = mainJs.slice(at, at + 800);
      expect(builder).toContain('aerodatabox.com');
      expect(builder).not.toContain("'Flightradar24'");
      at = mainJs.indexOf(marker, at + 1);
    }
  });
});

describe('Leaflet maps carry OpenStreetMap/CARTO attribution (ODbL)', () => {
  it('main.js never suppresses the attribution control', () => {
    expect(mainJs).not.toContain('attributionControl: false');
    expect(mainJs).not.toContain('attributionControl:false');
    expect(mainJs).not.toContain('attributionControl:!1');
  });

  it('main.js contains the OpenStreetMap credit string', () => {
    expect(mainJs).toContain('OpenStreetMap');
  });
});

describe('Sources panel lists schedule + basemap providers', () => {
  // Slice the SOURCES tab panel out of index.html so the assertions can't be satisfied by
  // strings elsewhere on the page (e.g. preconnect hints or the disclaimer modal).
  const start = indexHtml.indexOf('id="tab-sources"');
  const end = indexHtml.indexOf('disclaimer-modal');
  const sourcesPanel = indexHtml.slice(start, end);

  it('tab-sources panel exists and precedes the disclaimer modal', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('contains an AeroDataBox schedule entry', () => {
    expect(sourcesPanel).toContain('AeroDataBox');
  });

  it('contains a CARTO / OpenStreetMap basemap row', () => {
    expect(sourcesPanel).toContain('CARTO');
    expect(sourcesPanel).toContain('OpenStreetMap');
  });
});
