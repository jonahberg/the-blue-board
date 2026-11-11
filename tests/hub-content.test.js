// Render-time adjustments to the hub pages' authored HTML (src/lib/hub-content.js), run against
// every real hub data file: the emoji buttons go, their destinations and every other byte stay.
import { describe, expect, it } from 'vitest';

import { hubs } from '../src/data/hubs/index.js';
import { demoteHubCtaRow, splitCompactLiveBar, stripLeadingEmoji } from '../src/lib/hub-content.js';

const EMOJI = /\p{Extended_Pictographic}/u;
const anchors = (html) => [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1], text: m[2] }));
const FULL = Object.entries(hubs).filter(([, d]) => d.variant === 'full');
const COMPACT = Object.entries(hubs).filter(([, d]) => d.variant === 'compact');

describe('stripLeadingEmoji', () => {
  it('drops pictographs with variation selectors and keeps the words', () => {
    expect(stripLeadingEmoji('🗺️ Live ORD Map')).toBe('Live ORD Map');
    expect(stripLeadingEmoji('⚠️ IROPS Monitor')).toBe('IROPS Monitor');
    expect(stripLeadingEmoji('📡 Starlink Fleet')).toBe('Starlink Fleet');
    expect(stripLeadingEmoji('Plain label')).toBe('Plain label');
  });
});

describe('demoteHubCtaRow', () => {
  it('covers every full hub page (the seven US hubs)', () => {
    expect(FULL.map(([k]) => k).sort()).toEqual(['den', 'ewr', 'iad', 'iah', 'lax', 'ord', 'sfo']);
  });

  for (const [key, data] of FULL) {
    it(`${key}: no emoji button survives; the same four destinations do, as plain links`, () => {
      const before = data.contentHtml;
      const after = demoteHubCtaRow(before);
      expect(before).toContain('class="cta"');
      expect(after).not.toContain('class="cta"');

      const ctaHrefs = anchors(before.match(/<div style="display:flex;flex-wrap:wrap[\s\S]*?<\/div>/)[0]).map((a) => a.href);
      expect(ctaHrefs).toHaveLength(4);
      const line = after.match(/<p class="hub-more-links">[\s\S]*?<\/p>/)[0];
      expect(anchors(line).map((a) => a.href)).toEqual(ctaHrefs);
      for (const a of anchors(line)) expect(a.text).not.toMatch(EMOJI);

      // Everything outside the row is byte-identical: headings and copy are untouched.
      const [head, tail] = before.split(/<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px">[\s\S]*?<\/div>/);
      expect(after.startsWith(head)).toBe(true);
      expect(after.endsWith(tail)).toBe(true);
      expect(anchors(after).length).toBe(anchors(before).length);
    });
  }

  it('leaves a string without the row alone', () => {
    expect(demoteHubCtaRow('<p>Hi</p>')).toBe('<p>Hi</p>');
    expect(demoteHubCtaRow(undefined)).toBe('');
  });
});

describe('splitCompactLiveBar', () => {
  it('covers the two compact pages (NRT, GUM)', () => {
    expect(COMPACT.map(([k]) => k).sort()).toEqual(['gum', 'nrt']);
  });

  for (const [key, data] of COMPACT) {
    it(`${key}: removes only the LIVE bar, keeps its live-meta line, and keeps everything else`, () => {
      const split = splitCompactLiveBar(data.contentHtml);
      expect(split).not.toBeNull();
      const { before, after, metaHtml } = split;
      expect(before).toContain('<h1>');
      expect(before).not.toContain('live-bar');
      expect(after).toContain('id="scrollHint"');
      expect(after).toContain('<nav class="jump-nav">');
      expect(after).not.toContain('id="active"');
      expect(after).not.toContain('id="updated-time"');
      expect(metaHtml).toMatch(/^ICAO: (RJAA|PGUM) · Timezone: /);
      // The bar is all that was cut.
      const cut = data.contentHtml.slice(before.length, data.contentHtml.length - after.length);
      expect(cut.startsWith('<div class="live-bar"')).toBe(true);
      expect(cut.endsWith('</div>')).toBe(true);
      expect(cut).toContain('id="active"');
    });
  }

  it('is null for a full hub page or a malformed bar', () => {
    expect(splitCompactLiveBar(hubs.ord.contentHtml)).toBeNull();
    expect(splitCompactLiveBar('<div class="live-bar"><div>')).toBeNull();
  });
});

// Nov 10 2026: a hub page's board is the stored schedule snapshot (src/components/site/HubBoard.astro)
// — it refreshes every two minutes and its data can be a couple of hours old. Only the dashboard's
// live map updates every 30 seconds, so hub copy may promise that rate for the map and nothing else.
describe('hub copy promises no refresh rate the page does not have', () => {
  for (const [key, data] of Object.entries(hubs)) {
    it(`${key}: share copy, subtitle and FAQ`, () => {
      for (const field of ['description', 'ogDescription', 'twitterDescription', 'subtitle']) {
        expect(data[field] ?? '', `${key}.${field}`).not.toMatch(/every 30|30s\b|30 seconds/i);
      }
      expect(data.contentHtml).not.toMatch(/Updated every 30|live status panel/i);
      for (const { answer } of data.faqSchema) {
        expect(answer).not.toMatch(/live status panel/i);
        for (const m of answer.matchAll(/[^.]*\b30 seconds\b[^.]*\./g)) {
          expect(m[0], `${key}: ${m[0]}`).toMatch(/live map/);
        }
      }
    });
  }
});
