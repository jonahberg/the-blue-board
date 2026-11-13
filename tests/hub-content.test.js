// Render-time adjustments to the hub pages' authored HTML (src/lib/hub-content.js), run against
// every real hub data file: the emoji buttons go, their destinations and every other byte stay.
import { describe, expect, it } from 'vitest';

import { hubs } from '../src/data/hubs/index.js';
import { demoteHubCtaRow, linkKeyRoutesHubs, splitCompactLiveBar, stripLeadingEmoji } from '../src/lib/hub-content.js';

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

  // Links everywhere (Nov 12 2026): the bar carried the compact pages' only link to the live map,
  // and the split dropped it with the bar. The layout prints it again from `liveHref`.
  it('hands back the bar’s live-map address, so the layout can print it again', () => {
    expect(splitCompactLiveBar(hubs.gum.contentHtml).liveHref).toBe('/?hub=gum');
    expect(splitCompactLiveBar(hubs.nrt.contentHtml).liveHref).toBe('/?hub=nrt');
    expect(splitCompactLiveBar('<div class="live-bar"><div class="live-meta">x</div></div>').liveHref).toBe('');
  });
});

// Links everywhere (Nov 12 2026): the one piece of hub prose that gets links. In the "Key Routes"
// list, a hub code links to its hub page; the page's own code, every other airport and every other
// byte of the string stay as authored.
describe('linkKeyRoutesHubs', () => {
  const keyRoutesList = (html) => html.match(/Key Routes from [A-Z]{3}<\/h[23]>\s*(<ul>[\s\S]*?<\/ul>)/)[1];
  const hrefs = (html) => anchors(html).map((a) => a.href);

  it('ORD (an h3 list): links the other hubs, leaves ORD itself and the foreign airports plain', () => {
    const before = hubs.ord.contentHtml;
    const after = linkKeyRoutesHubs(before, 'ORD');
    const list = keyRoutesList(after);
    expect(hrefs(list)).toEqual(['/hubs/sfo', '/hubs/lax', '/hubs/den', '/hubs/ewr', '/hubs/iad', '/hubs/iah', '/hubs/nrt']);
    expect(list).toContain('<a href="/hubs/sfo">SFO</a>, <a href="/hubs/lax">LAX</a>');
    expect(list).not.toContain('/hubs/ord');
    for (const plain of ['LHR', 'FRA', 'TLV', 'HND', 'CUN', 'SJU']) {
      expect(list).toMatch(new RegExp(`(?<!>)${plain}(?!</a>)`));
    }
    // Only the list changed: everything before and after it is byte-identical.
    const original = keyRoutesList(before);
    const [head, tail] = before.split(original);
    expect(after).toBe(head + list + tail);
  });

  it('NRT (an h2 list): "ORD–NRT" links ORD only; GUM links; CEB, KHH and the rest stay plain', () => {
    const list = keyRoutesList(linkKeyRoutesHubs(hubs.nrt.contentHtml, 'NRT'));
    expect(list).toContain('<a href="/hubs/ord">ORD</a>–NRT');
    expect(list).toContain('<a href="/hubs/gum">GUM</a> (Guam)');
    expect(list).not.toContain('/hubs/nrt');
    expect(hrefs(list).filter((h) => h === '/hubs/ord')).toHaveLength(2);
    for (const plain of ['CEB', 'KHH', 'ROR', 'SPN', 'UBN', 'ANA']) expect(list).toContain(plain);
    expect(list).not.toMatch(/>(CEB|KHH|ROR|SPN|UBN|ANA)<\/a>/);
  });

  it('GUM: links NRT, leaves GUM itself plain in "GUM–ROR–MNL" and "HNL–GUM", and leaves the Island Hopper list and the FAQ alone', () => {
    const before = hubs.gum.contentHtml;
    const after = linkKeyRoutesHubs(before, 'GUM');
    const list = keyRoutesList(after);
    expect(hrefs(list)).toEqual(['/hubs/nrt']);
    expect(list).toContain('GUM–ROR–MNL');
    expect(list).toContain('HNL–GUM');
    // The Island Hopper list (<strong>GUM</strong>, NRT in the FAQ) is outside "Key Routes".
    const hopper = after.slice(after.indexOf('id="island-hopper"'));
    expect(hopper).toBe(before.slice(before.indexOf('id="island-hopper"')));
    expect(hopper).not.toContain('/hubs/');
  });

  for (const [key, data] of Object.entries(hubs)) {
    it(`${key}: links at least one other hub, never its own, and adds nothing outside the list`, () => {
      const after = linkKeyRoutesHubs(data.contentHtml, data.iata);
      const added = anchors(after).length - anchors(data.contentHtml).length;
      const list = keyRoutesList(after);
      expect(added).toBe(hrefs(list).filter((h) => h.startsWith('/hubs/')).length);
      expect(added).toBeGreaterThan(0);
      expect(hrefs(list)).not.toContain(`/hubs/${key}`);
      for (const a of anchors(list)) expect(`/hubs/${a.text.toLowerCase()}`).toBe(a.href);
    });
  }

  it('is idempotent: a second pass finds every code already inside an anchor', () => {
    for (const data of Object.values(hubs)) {
      const once = linkKeyRoutesHubs(data.contentHtml, data.iata);
      expect(linkKeyRoutesHubs(once, data.iata)).toBe(once);
    }
  });

  it('never touches an attribute, a longer word, an existing anchor, or a lower-case word', () => {
    const html =
      '<h3>Key Routes from SFO</h3>\n<ul>' +
      '<li><a href="/hubs/ORD" title="DEN and IAH">see ORD</a> WORDS ORDER xORD ORDx ord EWR</li>' +
      '<li><span data-x="LAX">LAX</span>, GUMBO, NRT.</li>' +
      '</ul><p>DEN outside the list</p>';
    const out = linkKeyRoutesHubs(html, 'sfo');
    expect(out).toBe(
      '<h3>Key Routes from SFO</h3>\n<ul>' +
        '<li><a href="/hubs/ORD" title="DEN and IAH">see ORD</a> WORDS ORDER xORD ORDx ord <a href="/hubs/ewr">EWR</a></li>' +
        '<li><span data-x="LAX"><a href="/hubs/lax">LAX</a></span>, GUMBO, <a href="/hubs/nrt">NRT</a>.</li>' +
        '</ul><p>DEN outside the list</p>',
    );
  });

  it('skips the page’s own hub in any case, and leaves a string with no Key Routes list alone', () => {
    const html = '<h2 id="routes">Key Routes from ORD</h2><ul><li>ORD, DEN</li></ul>';
    expect(linkKeyRoutesHubs(html, 'ord')).toBe('<h2 id="routes">Key Routes from ORD</h2><ul><li>ORD, <a href="/hubs/den">DEN</a></li></ul>');
    expect(linkKeyRoutesHubs('<ul><li>DEN</li></ul>', 'ORD')).toBe('<ul><li>DEN</li></ul>');
    expect(linkKeyRoutesHubs(undefined, 'ORD')).toBe('');
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

// v1.28.0: the Dulles Concourse E box reported an opening in the warning treatment (⚠️ and the
// amber rail). Amber is status only and chrome icons are lucide (DESIGN.md), so it takes the plain
// callout the hub pages use for information ("IAD by the numbers", "Tip"); its words are unchanged.
describe('/hubs/iad Concourse E callout', () => {
  const html = hubs.iad.contentHtml;
  const box = html.match(/<div class="([^"]*)">\s*<span id="construction"><\/span>([\s\S]*?)<\/div>/);

  it('is the informational callout, with no emoji, and keeps its #construction anchor', () => {
    expect(box, 'the #construction callout').toBeTruthy();
    expect(box[1]).toBe('highlight-box');
    expect(box[2]).toMatch(/^<strong>Concourse E Opens November 10, 2026:<\/strong> United and MWAA unveiled/);
    expect(EMOJI.test(box[2])).toBe(false);
  });
});
