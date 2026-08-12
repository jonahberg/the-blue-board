import { describe, expect, it } from 'vitest';
import { atcAirports, unitedHubs, unitedProjects } from '../src/data/trackers/index.js';
import {
  atcAirportSeo,
  atcHubDetailCodes,
  formatTrackerDate,
  trackerParentSeo,
  unitedHubDetailCodes,
  unitedHubSeo,
} from '../src/lib/tracker-detail.js';
import { GET as getAtcCsv } from '../src/pages/trackers/atc.csv.ts';
import { GET as getAtcJson } from '../src/pages/trackers/atc.json.ts';
import { GET as getUnitedCsv } from '../src/pages/trackers/united-hubs.csv.ts';
import { GET as getUnitedJson } from '../src/pages/trackers/united-hubs.json.ts';
import { GET as getSitemap } from '../src/pages/sitemap.xml.ts';

describe('tracker SEO snippets', () => {
  it('keeps parent titles and descriptions inside intentional SERP bounds', () => {
    for (const [slug, seo] of Object.entries(trackerParentSeo)) {
      expect(seo.title.length, `${slug} title`).toBeLessThanOrEqual(60);
      expect(seo.description.length, `${slug} description`).toBeGreaterThanOrEqual(120);
      expect(seo.description.length, `${slug} description`).toBeLessThanOrEqual(160);
    }
  });

  it('keeps every generated detail snippet concise and airport-specific', () => {
    for (const code of unitedHubDetailCodes) {
      const count = unitedProjects.filter((project) => project.hub === code).length;
      const seo = unitedHubSeo(code, count);
      expect(seo.title, code).toContain(code);
      expect(seo.title.length, `${code} United title`).toBeLessThanOrEqual(60);
      expect(seo.description.length, `${code} United description`).toBeLessThanOrEqual(160);
    }
    for (const code of atcHubDetailCodes) {
      const airport = atcAirports.find((item) => item.code === code);
      const seo = atcAirportSeo(airport);
      expect(seo.title, code).toContain(code);
      expect(seo.title.length, `${code} ATC title`).toBeLessThanOrEqual(60);
      expect(seo.description.length, `${code} ATC description`).toBeLessThanOrEqual(160);
    }
  });
});

describe('tracker detail route scope', () => {
  it('formats ISO dates while preserving sourced approximate timelines', () => {
    expect(formatTrackerDate('2026-02')).toBe('February 2026');
    expect(formatTrackerDate('2025-02-25')).toBe('February 25, 2025');
    expect(formatTrackerDate('fall 2026')).toBe('fall 2026');
    expect(formatTrackerDate('timing not finalized')).toBe('timing not finalized');
  });

  it('builds all eight United hub pages', () => {
    expect([...unitedHubDetailCodes].sort()).toEqual(Object.keys(unitedHubs).sort());
  });

  it('builds ATC detail pages only for United hubs in the published TFDM program', () => {
    const atcCodes = new Set(atcAirports.map((airport) => airport.code));
    expect(atcHubDetailCodes).toHaveLength(7);
    for (const code of atcHubDetailCodes) {
      expect(unitedHubs[code], code).toBeDefined();
      expect(atcCodes.has(code), code).toBe(true);
    }
    expect(atcHubDetailCodes).not.toContain('GUM');
  });

  it('registers every detail page in the sitemap', async () => {
    const xml = await getSitemap().text();
    for (const code of atcHubDetailCodes) {
      expect(xml).toContain(`https://theblueboard.co/trackers/atc/${code.toLowerCase()}`);
    }
    for (const code of unitedHubDetailCodes) {
      expect(xml).toContain(`https://theblueboard.co/trackers/united-hubs/${code.toLowerCase()}`);
    }
  });
});

describe('tracker downloads', () => {
  it('exports all ATC records as CSV and JSON with cacheable typed responses', async () => {
    const csvResponse = getAtcCsv();
    const csv = await csvResponse.text();
    expect(csvResponse.headers.get('content-type')).toContain('text/csv');
    expect(csvResponse.headers.get('cache-control')).toContain('s-maxage=86400');
    expect(csv.split('\n')).toHaveLength(atcAirports.length + 2);
    expect(csv).toContain('"last_verified"');

    const jsonResponse = getAtcJson();
    const json = await jsonResponse.json();
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    expect(json.airports).toHaveLength(atcAirports.length);
    expect(json.meta.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('exports all United projects as CSV and JSON', async () => {
    const csv = await getUnitedCsv().text();
    expect(csv.split('\n')).toHaveLength(unitedProjects.length + 2);
    expect(csv).toContain('"project_name"');

    const json = await getUnitedJson().json();
    expect(json.projects).toHaveLength(unitedProjects.length);
    expect(Object.keys(json.hubs)).toHaveLength(unitedHubDetailCodes.length);
  });
});
