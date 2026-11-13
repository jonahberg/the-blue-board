// @vitest-environment jsdom
// Links everywhere, part 3 (Nov 12 2026), on the built hub, tracker and Newark pages (dist/): the
// names these pages print in tables and lists link to their homes, nothing else is painted like a
// link, and the GUM and NRT pages have their live-map link back. Needs `bun run build` first; skips
// without dist/ (and fails in CI, where the build runs first), like tracker-table-phone.test.js.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { HUB_ORDER } from '../src/lib/hub-health.js';
import { unitedProjects } from '../src/data/trackers/united-hubs.js';
import { atcHubDetailCodes, unitedHubDetailCodes } from '../src/lib/tracker-detail.js';

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));
if (!hasDist && process.env.CI) throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test`');

const HUBS = HUB_ORDER.map((c) => c.toLowerCase());
const load = (rel) => new DOMParser().parseFromString(readFileSync(join(DIST, rel), 'utf8'), 'text/html');
const hrefsIn = (root) => [...root.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
const classes = (el) => (el.getAttribute('class') ?? '').split(/\s+/);
const isEntryTone = (a) => classes(a).includes('text-primary');
const isQuiet = (a) => classes(a).includes('decoration-muted-foreground/40') && classes(a).includes('text-foreground');

const detailPages = (dir) => (hasDist ? readdirSync(join(DIST, 'trackers', dir)).map((f) => `trackers/${dir}/${f}`) : []);
const PAGES = [
  'hubs.html',
  ...HUBS.map((h) => `hubs/${h}.html`),
  'newark.html',
  'trackers.html',
  'trackers/atc.html',
  'trackers/united-hubs.html',
  ...detailPages('atc'),
  ...detailPages('united-hubs'),
];

describe.skipIf(!hasDist)('hub pages', () => {
  it('GUM and NRT link to the live map again, beside the board and not as a second button; ORD keeps its own', () => {
    for (const hub of ['gum', 'nrt']) {
      const doc = load(`hubs/${hub}.html`);
      const live = [...doc.querySelectorAll(`a[href="/?hub=${hub}"]`)];
      expect(live, hub).toHaveLength(1);
      expect(live[0].closest('[data-hub-board]'), hub).not.toBeNull();
      expect(live[0].textContent.trim()).toBe(`Live ${hub.toUpperCase()} map`);
      expect(classes(live[0])).not.toContain('bg-primary-fill');
      expect(classes(live[0])).toContain('min-h-11');
    }
    expect(hrefsIn(load('hubs/ord.html'))).toContain('/?hub=ord');
  });

  for (const hub of HUBS) {
    it(`${hub}: "Key Routes" links the other hubs to their pages and never its own`, () => {
      const doc = load(`hubs/${hub}.html`);
      const heading = [...doc.querySelectorAll('h2, h3')].find((h) => /^Key Routes from /.test(h.textContent.trim()));
      expect(heading, 'Key Routes heading').toBeTruthy();
      let list = heading.nextElementSibling;
      while (list && list.tagName !== 'UL') list = list.nextElementSibling;
      const links = [...list.querySelectorAll('a')];
      expect(links.length).toBeGreaterThan(0);
      for (const a of links) {
        const code = a.textContent.trim();
        expect(a.getAttribute('href')).toBe(`/hubs/${code.toLowerCase()}`);
        expect(code).not.toBe(hub.toUpperCase());
        expect(HUBS).toContain(code.toLowerCase());
      }
    });
  }

  it('the departures board template links the destination quietly, apart from the one button', () => {
    const doc = load('hubs/ord.html');
    const row = doc.querySelector('template[data-hb-row]').content;
    const dest = row.querySelector('[data-f="dest"]');
    expect(dest.tagName).toBe('A');
    expect(dest.hasAttribute('href')).toBe(false); // the script sets it per row (hub-board-view.js destHref)
    expect(classes(dest)).not.toContain('text-primary');
    expect(classes(dest)).toContain('decoration-muted-foreground/40');
    expect(classes(dest)).toEqual(expect.arrayContaining(['[&:not([href])]:no-underline', '[&:not([href])]:after:hidden']));
  });

  it('/hubs: "What we track" opens the dashboard views; "Seasonal delay patterns" stays text', () => {
    const doc = load('hubs.html');
    const heading = [...doc.querySelectorAll('h2')].find((h) => h.textContent.includes('What The Blue Board Tracks'));
    const list = heading.closest('section').querySelector('ul');
    expect(hrefsIn(list)).toEqual(['/#live', '/?tab=irops', '/?tab=weather&section=nas', '/#schedule', '/#starlink', '/#weather']);
    const last = list.querySelector('li:last-child');
    expect(last.textContent).toContain('Seasonal delay patterns');
    expect(last.querySelector('a')).toBeNull();
  });
});

describe.skipIf(!hasDist)('/newark', () => {
  const doc = hasDist ? load('newark.html') : null;

  it('the active-flights tile is a link to the Live map filtered to EWR, the whole tile its target', () => {
    const figure = doc.getElementById('newark-active');
    const tile = figure.parentElement;
    const link = tile.querySelector('a');
    expect(link.getAttribute('href')).toBe('/?hub=ewr');
    expect(link.textContent.trim()).toBe('Active United Flights (EWR)');
    expect(classes(link)).toEqual(expect.arrayContaining(['after:absolute', 'after:inset-0']));
    expect(classes(tile)).toContain('relative');
    // The script rewrites the figure, which is not inside the link.
    expect(link.contains(figure)).toBe(false);
  });

  it('the FAA program line links to the NAS panel and keeps the id the script writes into', () => {
    const status = doc.getElementById('newark-program-status');
    expect(status.tagName).toBe('SPAN');
    expect(status.closest('a').getAttribute('href')).toBe('/?tab=weather&section=nas');
  });

  it('the More list carries EWR\'s two tracker entries and links each hub code', () => {
    const list = doc.getElementById('more').closest('section').querySelector('ul');
    const hrefs = hrefsIn(list);
    expect(hrefs).toEqual(expect.arrayContaining(['/trackers/united-hubs/ewr', '/trackers/atc/ewr', ...HUBS.map((h) => `/hubs/${h}`)]));
    expect(list.textContent.replace(/\s+/g, ' ')).toContain('ORD, DEN, IAH, EWR, SFO, IAD, LAX, NRT, and GUM.');
  });
});

describe.skipIf(!hasDist)('tracker pages', () => {
  it('/trackers/atc: each United hub row links its code to the hub page; one link-coloured link per row', () => {
    const doc = load('trackers/atc.html');
    const rows = [...doc.querySelectorAll('tbody tr[data-trk-row]')];
    expect(rows).toHaveLength(89);
    const hubRows = rows.filter((tr) => hrefsIn(tr).some((h) => h.startsWith('/hubs/')));
    expect(hubRows.map((tr) => tr.id).sort()).toEqual(atcHubDetailCodes.map((c) => `row-${c.toLowerCase()}`).sort());
    for (const tr of rows) {
      const links = [...tr.querySelectorAll('a[href^="/"]')];
      expect(links.filter(isEntryTone).length, tr.id).toBeLessThanOrEqual(1);
      for (const a of links.filter((a) => !isEntryTone(a))) expect(isQuiet(a), `${tr.id} ${a.getAttribute('href')}`).toBe(true);
    }
    const ord = doc.getElementById('row-ord');
    const words = Object.fromEntries([...ord.querySelectorAll('a[href^="/"]')].map((a) => [a.getAttribute('href'), a.textContent.replace(/\s+/g, ' ').trim()]));
    expect(words).toEqual({ '/hubs/ord': 'ORD', '/trackers/atc/ord': 'ORD status →', '/trackers/united-hubs/ord': 'ORD projects →' });
    expect(isEntryTone(ord.querySelector('a[href="/trackers/atc/ord"]'))).toBe(true);
    // The hub code is a dense-table link: 44 px on touch, relaxed for a mouse at md.
    expect(classes(ord.querySelector('a[href="/hubs/ord"]'))).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0', 'pointer-fine:md:inline']));
  });

  it('/trackers/united-hubs: the project name is the row\'s link to its card; the hub code goes to the hub page', () => {
    const doc = load('trackers/united-hubs.html');
    const rows = [...doc.querySelectorAll('tbody tr[data-trk-row]')];
    expect(rows).toHaveLength(unitedProjects.length);
    for (const tr of rows) {
      const p = unitedProjects.find((x) => tr.id === `row-t-${x.id}`);
      expect(p, tr.id).toBeTruthy();
      const entry = [...tr.querySelectorAll('a[href^="/"]')].filter(isEntryTone);
      expect(entry.map((a) => a.getAttribute('href')), tr.id).toEqual([`/trackers/united-hubs/${p.hub.toLowerCase()}#${p.id}`]);
      expect(entry[0].textContent.trim()).toBe(p.name);
      expect(hrefsIn(tr)).toContain(`/hubs/${p.hub.toLowerCase()}`);
    }
  });

  it('/trackers/united-hubs: hub-by-hub codes, map places and club math link where they say', () => {
    const doc = load('trackers/united-hubs.html');
    for (const code of unitedHubDetailCodes) {
      const group = doc.getElementById(`hub-${code.toLowerCase()}`);
      expect(group.querySelector('a').getAttribute('href')).toBe(`/hubs/${code.toLowerCase()}`);
      expect(group.querySelector('a').textContent.trim()).toBe(code);
    }
    for (const p of unitedProjects) {
      const card = doc.getElementById(p.id);
      expect(hrefsIn(card)).toContain(`/trackers/united-hubs/${p.hub.toLowerCase()}#${p.id}`);
    }
    // The marker cards carry no links (the slot is swapped on every marker focus or hover, so they
    // could not be reached); Guam's always-visible "Beyond the map" entry carries its two.
    const map = doc.querySelector('[data-trk-map]');
    for (const card of map.querySelectorAll('[data-trk-card]')) expect(hrefsIn(card), card.dataset.trkCard).toEqual([]);
    expect(hrefsIn(map)).toEqual(['/trackers/united-hubs/gum', '/hubs/gum']);
    const club = doc.getElementById('club-math');
    expect(hrefsIn(club)).toEqual([
      '/trackers/united-hubs/iah#iah-club-b-north',
      '/trackers/united-hubs/sfo#sfo-t2-club',
      '/trackers/united-hubs/iad#iad-club-concourse-e',
      '/fleet/787-10-dreamliner',
    ]);
  });

  it('/trackers/atc: no link inside the map (its cards are swapped on every marker focus; SJU is not a hub)', () => {
    const doc = load('trackers/atc.html');
    const map = doc.querySelector('[data-trk-map]');
    expect(map.querySelectorAll('[data-trk-card]').length).toBeGreaterThan(80);
    expect(hrefsIn(map)).toEqual([]);
  });

  for (const [dir, codes] of [['atc', atcHubDetailCodes], ['united-hubs', unitedHubDetailCodes]]) {
    it(`/trackers/${dir}/<code>: each of the ${codes.length} pages links its own hub's page and no other hub's`, () => {
      for (const code of codes) {
        const doc = load(`trackers/${dir}/${code.toLowerCase()}.html`);
        const hubHrefs = hrefsIn(doc.querySelector('main')).filter((h) => /^\/hubs\/[a-z]{3}$/.test(h));
        expect(hubHrefs.length, code).toBeGreaterThan(0);
        expect(new Set(hubHrefs), code).toEqual(new Set([`/hubs/${code.toLowerCase()}`]));
        const door = [...doc.querySelectorAll('header a')].find((a) => a.getAttribute('href') === `/hubs/${code.toLowerCase()}`);
        expect(door.textContent.replace(/\s+/g, ' ').trim()).toBe(`${code} hub guide →`);
      }
    });
  }
});

// ── Every content page's links, from the built HTML ──────────────────────────────────────────
// The static-page guard for links everywhere: no page links to itself (a self-link does nothing
// when clicked; the current nav pill, marked aria-current, is navigation chrome), no link sits in
// a button or in another link, and no internal link to a hub, fleet or tracker page points at a
// page the build did not make. Read from the raw HTML, because the parser silently closes an <a>
// that a second <a> opens inside, and <template> rows (the hub board's, the strip's) are not in
// the DOM tree a selector walks.

/**
 * The link faults in one built page's raw HTML, in document order, each as "<kind>: <a …>".
 * `isBuilt(path)` says whether the build made a page or file at that path ('/hubs/ord',
 * '/trackers/atc.csv').
 */
function linkFaults(html, pagePath, isBuilt) {
  const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const attr = (attrs, name) => {
    const m = attrs.match(new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=\\s|/|$)`, 'i'));
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
  };
  const decode = (s) => s.replace(/&amp;|&#38;/g, '&');
  const norm = (p) => p.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const ORIGIN = 'https://theblueboard.co';
  const depth = { a: 0, button: 0 };
  const out = [];
  for (const [, close, rawName, attrs] of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const name = rawName.toLowerCase();
    if (name !== 'a' && name !== 'button') continue;
    if (close) {
      depth[name] = Math.max(0, depth[name] - 1);
      continue;
    }
    if (name === 'button') {
      depth.button++;
      continue;
    }
    const href = attr(attrs, 'href');
    const dataF = attr(attrs, 'data-f');
    const tag = href !== null ? `<a href="${href}">` : dataF !== null ? `<a data-f="${dataF}">` : '<a>';
    if (depth.a > 0) out.push(`link inside a link: ${tag}`);
    if (depth.button > 0) out.push(`link inside a button: ${tag}`);
    depth.a++;
    if (href === null || attr(attrs, 'aria-current') !== null) continue;
    const url = new URL(decode(href), `${ORIGIN}${pagePath}`);
    if (url.origin !== ORIGIN) continue;
    const path = norm(url.pathname);
    // Any fragment, even a bare "#" (a placeholder a page script fills), is an in-page jump.
    const jump = href.includes('#');
    if (path === norm(pagePath) && !jump && !url.search) out.push(`self-link: ${tag}`);
    else if (/^\/(hubs|fleet|trackers)(\/|$)/.test(path) && !isBuilt(path)) out.push(`no built page: ${tag}`);
  }
  return out;
}

/** The build made a page (`<path>.html`, `<path>/index.html`) or a file (a CSV or JSON download) at `path`. */
const builtInDist = (path) =>
  [`${path}.html`, `${path}/index.html`, path].some((p) => existsSync(join(DIST, p)) && statSync(join(DIST, p)).isFile());

describe.skipIf(!hasDist)('every content page links only to other pages that exist, and never inside another control', () => {
  it('hubs, fleet, trackers, Newark and the flight page: no self-link, no link in a link or button, no link to an unbuilt page', () => {
    const htmlIn = (dir) => readdirSync(join(DIST, dir)).filter((f) => f.endsWith('.html')).map((f) => `${dir}/${f}`);
    const pages = [
      'hubs.html', ...htmlIn('hubs'),
      'fleet.html', ...htmlIn('fleet'),
      'trackers.html', ...htmlIn('trackers'), ...htmlIn('trackers/atc'), ...htmlIn('trackers/united-hubs'),
      'newark.html',
      'flight.html',
    ];
    expect(pages).toHaveLength(50); // 10 hub, 20 fleet, 18 tracker pages, Newark and the flight page
    let links = 0;
    const found = pages.flatMap((rel) => {
      const html = readFileSync(join(DIST, rel), 'utf8');
      links += html.match(/<a\b/g)?.length ?? 0;
      return linkFaults(html, `/${rel.replace(/\.html$/, '')}`, builtInDist).map((fault) => `${rel}: ${fault}`);
    });
    expect(links).toBeGreaterThan(4500); // 4,931 on Nov 12 2026
    expect(found).toEqual([]);
  });
});

describe('the content-page link sweep catches what it is for', () => {
  const BUILT = new Set(['/hubs/ord', '/hubs/den', '/hubs/sfo', '/fleet', '/trackers/atc', '/trackers/atc.csv']);
  const faults = (html) => linkFaults(html, '/hubs/ord', (path) => BUILT.has(path));

  it('a self-link, a link in a link (in a template too), a link in a button, and a link to a page that was not built', () => {
    expect(faults('<a href="/hubs/ord">ORD</a>')).toEqual(['self-link: <a href="/hubs/ord">']);
    expect(faults('<a href="/hubs/ord/">ORD</a><a href="">x</a>')).toEqual(['self-link: <a href="/hubs/ord/">', 'self-link: <a href="">']);
    expect(faults('<a href="/hubs/den"><a href="/hubs/sfo">SFO</a></a>')).toEqual(['link inside a link: <a href="/hubs/sfo">']);
    expect(faults('<template data-row><li><a href="/hubs/den">DEN<a data-f="dest">x</a></a></li></template>')).toEqual([
      'link inside a link: <a data-f="dest">',
    ]);
    expect(faults('<button type="button"><span><a href="/hubs/den">DEN</a></span></button>')).toEqual(['link inside a button: <a href="/hubs/den">']);
    expect(faults('<a href="/hubs/xyz">XYZ</a><a href="/fleet/nope">n</a><a href="/trackers/united-hubs/zzz#p">p</a>')).toEqual([
      'no built page: <a href="/hubs/xyz">',
      'no built page: <a href="/fleet/nope">',
      'no built page: <a href="/trackers/united-hubs/zzz#p">',
    ]);
  });

  it('lets the current nav pill, in-page jumps, built pages, downloads and other addresses through', () => {
    for (const ok of [
      '<a href="/hubs/ord" aria-current="page">ORD</a>',
      '<a href="#main">Skip to content</a><a href="/hubs/ord#faq">FAQ</a><a href="#" hidden>Open entry</a>',
      '<a href="/hubs/den">DEN</a></a><a href="/hubs/sfo">SFO</a>',
      '<a href="/fleet/">Fleet</a><a href="/trackers/atc.csv">CSV</a><a href="/trackers/atc?x=1">ATC</a>',
      '<a href="/?tab=fleet&amp;type=A319">x</a><a href="/news/x">n</a><a href="https://example.com/hubs/zzz">e</a>',
      '<button type="button">x</button><a href="/hubs/den">DEN</a>',
      // Comments and scripts are not markup.
      '<!-- <a href="/hubs/ord">old</a> --><script>const s = \'<a href="/hubs/zzz"><a>\';</script>',
    ]) {
      expect(faults(ok), ok).toEqual([]);
    }
  });
});

/** Inside a card made clickable whole by a stretched link (DESIGN.md 2026-11-11): a click on it follows that link. */
const inStretchedCard = (el) => {
  for (let up = el.parentElement; up; up = up.parentElement) {
    if (classes(up).includes('relative') && [...up.querySelectorAll('a')].some((a) => classes(a).includes('after:inset-0'))) return true;
  }
  return false;
};

describe.skipIf(!hasDist)('link colour means link on these pages', () => {
  it('no element carries text-primary or an underline unless it is, or sits in, a link, button or disclosure', () => {
    let seen = 0;
    const offenders = [];
    for (const rel of PAGES) {
      const doc = load(rel);
      for (const el of doc.querySelectorAll('main [class]')) {
        const toks = classes(el);
        if (!toks.includes('text-primary') && !toks.includes('underline')) continue;
        seen++;
        if (!el.closest('a, button, summary') && !inStretchedCard(el)) offenders.push(`${rel} <${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 40)}"`);
      }
    }
    expect(seen).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
