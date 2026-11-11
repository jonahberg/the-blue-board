/**
 * One voice for every ask (Nov 11 2026). The owner found the donation wording weak: seven
 * different asks for one thing, the site's bills as the reason, hedges ("consider"), "we" on one
 * page and "I" on the next, and an empty month that read as failure ("0 of 30 days covered").
 * The deck that replaced it:
 *
 *   - one verb, "cover"; one unit, a day, $17, built from DAILY_COST_USD and never typed;
 *   - one reason, "The Blue Board is free because flyers (or readers) cover it, one day at a time.";
 *   - "I", never "we", where a person speaks;
 *   - no ask says "donate", "donation", "support the project", "server costs", "consider",
 *     "chip in" or "coffee";
 *   - a button that names a day says "Cover today · $17" / "Cover tomorrow · $17" /
 *     "Cover Nov 15 · $17"; one that cannot says "Help cover a day" (no price);
 *   - no sentence promises a name on the Supporters Wall.
 *
 * These pin that vocabulary three ways: on every string src/lib/cover-a-day.js can produce, on
 * the source around every element that carries `data-support` (the donation contexts, so the
 * privacy page and the legal disclaimers, which may say "donation", are not flagged), and on the
 * built pages in dist/ (skipped without a build, required in CI).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import * as words from '../src/lib/cover-a-day.js';
import { SUPPORTERS } from '../src/data/supporters.js';
import { SUPPORT_AMOUNTS, supportUrl } from '../src/lib/support-link.js';

const {
  DAILY_COST_USD,
  UNCONFIGURED_STATUS,
  coverButtonLabel,
  coverSentence,
  flightPageSupportCopy,
  monthLine,
  parseSupportStatus,
  supportCardCopy,
  supportLadder,
  supportStatusFromRows,
  supportStripCopy,
  todayLine,
} = words;

/** The words no ask may use. */
const BANNED = /\bdonat(?:e|es|ed|ion|ions|ing)\b|support the project|server costs?|\bconsider\b|chip in|coffee/i;
/** First person plural, which nobody on this site speaks in any more. */
const WE = /\b(?:we|we're|we've|our|ours|us)\b/i;
/** The labels a button that asks may carry. */
const BUTTON = /^(?:Cover (?:today|tomorrow|[A-Z][a-z]{2} \d{1,2}) · \$17|Help cover a day)$/;

// ── Every string the lib can produce ──

let id = 1;
const NOW = Date.parse('2026-11-10T18:00:00Z');
const at = (day, month = 11) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T15:00:00Z`;
const pay = (dollars, paidAt, extra = {}) => ({
  id: id++,
  amount_cents: dollars * 100,
  currency: 'usd',
  paid_at: paidAt,
  refunded: false,
  amount_refunded_cents: 0,
  display_name: null,
  hidden: false,
  ...extra,
});
const status = (rows, now = NOW) => parseSupportStatus(supportStatusFromRows(rows, now), now);

const STATES = {
  unconfigured: UNCONFIGURED_STATUS,
  'nobody this month': status([]),
  'one day covered, today open': status([pay(17, at(2))]),
  'today covered by a name, tomorrow open': status([pay(17, at(10), { display_name: 'Dana R.' })]),
  'today pooled by three supporters': status([pay(5, at(10)), pay(5, at(10)), pay(7, at(10))]),
  'covered through Nov 14': status([pay(17 * 5, at(10), { display_name: 'Dana R.' })]),
  'whole month covered': status([pay(17 * 30, at(1))]),
  'nothing open within a year': status([pay(17 * 400, at(10))]),
};

function libStrings() {
  const out = [];
  for (const [name, value] of Object.entries(words)) {
    if (typeof value === 'string' && /\s/.test(value)) out.push([name, value]);
  }
  for (const [state, s] of Object.entries(STATES)) {
    out.push([`coverButtonLabel(${state})`, coverButtonLabel(s)]);
    out.push([`todayLine(${state})`, todayLine(s)]);
    out.push([`monthLine(${state})`, monthLine(s)]);
    out.push([`coverSentence(${state})`, coverSentence(s)]);
    const strip = supportStripCopy(s, { flightsThisMonth: 12 });
    if (strip) for (const key of ['lead', 'text', 'short', 'button']) out.push([`strip.${key}(${state})`, strip[key]]);
    const flight = flightPageSupportCopy(s);
    out.push([`flight.text(${state})`, flight.text], [`flight.link(${state})`, flight.link]);
  }
  const card = supportCardCopy({ checkedAgainst: 'Fleet data is cross-checked against the FAA registry.', supporterCount: SUPPORTERS.length });
  for (const [key, value] of Object.entries(card)) out.push([`card.${key}`, value]);
  const ladder = supportLadder('fleet-end', { other: 'fleet-end' });
  for (const step of ladder.amounts) out.push([`ladder ${step.amount}`, step.text]);
  out.push(['ladder other', ladder.other.text]);
  return out.filter(([, value]) => typeof value === 'string');
}

describe('the words in src/lib/cover-a-day.js', () => {
  const all = libStrings();

  it('use none of the retired ask words', () => {
    for (const [name, value] of all) expect(value, name).not.toMatch(BANNED);
  });

  it('speak as "I", never "we"', () => {
    for (const [name, value] of all) expect(value, name).not.toMatch(WE);
    expect(words.THANKS_COST_LINE).toMatch(/\bI'm one person\b/);
    expect(words.THANKS_COUNT_LINE).toMatch(/^I count/);
    expect(supportCardCopy({ supporterCount: 3 }).intro).toMatch(/^I'm Jonah, and I build/);
  });

  it('price a day only from DAILY_COST_USD, and never as "Cover a day · $17"', () => {
    expect(DAILY_COST_USD).toBe(17);
    const allowed = new Set([`$${DAILY_COST_USD}`, '$500', ...SUPPORT_AMOUNTS.map((a) => `$${a}`)]);
    for (const [name, value] of all) {
      for (const price of value.match(/\$\d+/g) || []) expect(allowed.has(price), `${name}: ${price}`).toBe(true);
      expect(value, name).not.toMatch(/Cover a day · \$/);
    }
  });

  it('give every button one of the allowed labels', () => {
    for (const [state, s] of Object.entries(STATES)) {
      expect(coverButtonLabel(s), state).toMatch(BUTTON);
      expect(flightPageSupportCopy(s).link, state).toMatch(BUTTON);
      const strip = supportStripCopy(s);
      if (strip) expect(strip.button, state).toMatch(BUTTON);
    }
    expect(supportCardCopy({ supporterCount: 3 }).button).toMatch(BUTTON);
    expect(words.HELP_COVER_LABEL).toMatch(BUTTON);
  });

  it('promise nobody a place on the Supporters Wall: the reward is the day', () => {
    for (const [name, value] of all) expect(value, name).not.toMatch(/Supporters Wall|on the wall|your name here/i);
    expect(words.NAME_LINE).toBe('You can add a name at checkout to show on the day you cover.');
  });

  it('give the one reason in the two audiences', () => {
    expect(words.CORE_LINE_FLYERS).toBe('The Blue Board is free because flyers cover it, one day at a time.');
    expect(words.CORE_LINE_READERS).toBe('The Blue Board is free because readers cover it, one day at a time.');
    expect(words.UNIT_LINE).toBe('$17 pays for one day of live flight data, schedules and servers.');
    expect(words.THIRTY_LINE).toBe('It takes about 30 people a month, one for each day.');
    expect(words.ANY_AMOUNT_LINE).toBe('Any amount counts toward a day.');
    expect(words.LANDED_TOAST_LINE).toBe('Glad you landed ✈️ The Blue Board is free because flyers cover it, one day at a time.');
  });
});

// ── The source around every donation link ──

const ROOT = process.cwd();
const DIRS = ['src/app', 'src/components', 'src/pages', 'src/layouts'];

function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.(astro|tsx|ts)$/.test(name) ? [path] : [];
  });
}

/** The source with comments blanked (line count kept), so a doc comment is never "copy". */
function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
}

/** What a visitor reads or hears in a stretch of markup: text between tags, string children, titles and labels. */
function visibleText(chunk) {
  const out = [];
  for (const m of chunk.matchAll(/>([^<>{}]+)</g)) out.push(m[1]);
  for (const m of chunk.matchAll(/\{\s*(['"`])([^'"`]*)\1\s*\}/g)) out.push(m[2]);
  for (const m of chunk.matchAll(/\b(?:title|aria-label)=(?:"([^"]*)"|\{`([^`]*)`\})/g)) out.push(m[1] ?? m[2]);
  return out.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => /[a-z]/i.test(t));
}

const donationContexts = DIRS.flatMap(sourceFiles).flatMap((path) => {
  const lines = stripComments(readFileSync(join(ROOT, path), 'utf8')).split('\n');
  const out = [];
  lines.forEach((line, i) => {
    // A link that asks: `data-support=…`, or the dialogs' `<Ext … support="…">`.
    if (!/\bdata-support=|<Ext\b[^>]*\bsupport=/.test(line)) return;
    const chunk = lines.slice(Math.max(0, i - 8), i + 9).join('\n');
    out.push({ where: `${path}:${i + 1}`, text: visibleText(chunk) });
  });
  return out;
});

describe('the source around every element that carries data-support', () => {
  it('finds the donation links on the dashboard, the content pages and the flight page', () => {
    const files = new Set(donationContexts.map((c) => c.where.split(':')[0]));
    for (const file of [
      'src/app/features/SupportStrip.tsx',
      'src/app/features/BmacToast.tsx',
      'src/app/features/CoverADay.tsx',
      'src/app/features/DisclaimerDialog.tsx',
      'src/app/features/LegalPopover.tsx',
      'src/components/site/SupportNote.astro',
      'src/components/site/SiteFooter.astro',
      'src/layouts/NewsLayout.astro',
      'src/pages/flight/index.astro',
    ]) {
      expect(files.has(file), file).toBe(true);
    }
  });

  it('uses none of the retired ask words near any of them', () => {
    for (const { where, text } of donationContexts) {
      for (const t of text) expect(t, where).not.toMatch(BANNED);
    }
  });

  it('labels no menu or button "Donate" anywhere in the island or the pages', () => {
    for (const path of DIRS.flatMap(sourceFiles)) {
      const src = stripComments(readFileSync(join(ROOT, path), 'utf8'));
      for (const m of src.matchAll(/\b(?:title|aria-label)=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        expect(m[1] ?? m[2], path).not.toMatch(BANNED);
      }
    }
  });
});

// ── The built pages ──

const DIST = resolve(ROOT, 'dist');
const hasDist = existsSync(join(DIST, 'flight.html'));
if (!hasDist && process.env.CI) throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test`');

function page(rel) {
  const html = readFileSync(join(DIST, rel), 'utf8');
  return new JSDOM(html).window.document;
}
const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();
const firstHtml = (dir) => readdirSync(join(DIST, dir)).find((f) => f.endsWith('.html'));

describe.skipIf(!hasDist)('the built pages', () => {
  const pages = () => ['fleet.html', 'hubs.html', 'flight.html', 'thanks.html', `fleet/${firstHtml('fleet')}`, `hubs/${firstHtml('hubs')}`, `news/${firstHtml('news')}`];

  it('say none of the retired ask words in or around a data-support link', () => {
    for (const rel of pages()) {
      const doc = page(rel);
      const links = [...doc.querySelectorAll('[data-support]')];
      expect(links.length, rel).toBeGreaterThan(0);
      for (const a of links) {
        expect(squash(a.textContent), `${rel} ${a.getAttribute('data-support')}`).not.toMatch(BANNED);
        const block = a.closest('p, aside, li, div');
        expect(squash(block?.textContent), `${rel} ${a.getAttribute('data-support')} (block)`).not.toMatch(BANNED);
      }
    }
  });

  it('the footer button says "Help cover a day"', () => {
    const footer = page('fleet.html').querySelector('a[data-support="footer"]');
    expect(squash(footer.textContent)).toBe('Help cover a day');
    expect(footer.getAttribute('href')).toBe(supportUrl('footer'));
  });

  it('the content pages: the line under the header and the card after the content', () => {
    const doc = page('fleet.html');
    const inline = doc.querySelector('[data-support-note="inline"]');
    expect(squash(inline.textContent)).toBe(
      'Kept current by one person, with no ads and no paywall. Readers cover the cost, one day at a time. Help cover a day',
    );
    const card = doc.querySelector('[data-support-note="card"]');
    const paragraphs = [...card.querySelectorAll('p')].map((p) => squash(p.textContent));
    expect(squash(card.querySelector('h2').textContent)).toBe('Did this page help?');
    expect(paragraphs[0]).toBe(
      "I'm Jonah, and I build The Blue Board on my own. Fleet data is cross-checked against the FAA registry and United's own announcements. There are no ads, no paywall and no login: readers cover the cost, one day at a time. $17 pays for one day of live flight data, schedules and servers.",
    );
    expect(paragraphs[1]).toBe(`It takes about 30 people a month, one for each day. ${SUPPORTERS.length} readers have backed it so far.`);
    expect(paragraphs[2]).toBe('Any amount counts toward a day.');
    expect(squash(card.textContent)).not.toMatch(/— Jonah/);
    // The four fixed links are set, so the ladder takes the single button's place.
    const ladder = [...card.querySelectorAll('[data-support-ladder] a')];
    expect(ladder.map((a) => [squash(a.textContent), a.getAttribute('data-support')])).toEqual([
      ['$5', 'fleet-index-end-5'],
      ['$10', 'fleet-index-end-10'],
      ['$17 · one day', 'fleet-index-end-17'],
      ['$100 · nearly six days', 'fleet-index-end-100'],
      ['Other amount', 'fleet-index-end'],
    ]);
    expect(ladder[4].getAttribute('href')).toBe(supportUrl('fleet-index-end'));
  });

  it('the news box: the sentence, a space, "Help cover a day", a period', () => {
    const doc = page(`news/${firstHtml('news')}`);
    const link = doc.querySelector('a[data-support="news-article"]');
    expect(squash(link.parentElement.textContent)).toBe(
      'The Blue Board has no ads and no paywall. Readers cover the cost, one day at a time. Help cover a day.',
    );
  });

  it('the flight page ships the words for an unknown status', () => {
    const line = page('flight.html').querySelector('[data-fp-support]');
    expect(squash(line.textContent)).toBe('This page is free because flyers cover The Blue Board, one day at a time. Help cover a day');
  });

  it('/thanks speaks as Jonah, in days, and checks the About route it names', () => {
    const doc = page('thanks.html');
    const body = [...doc.querySelectorAll('main p')].map((p) => squash(p.textContent));
    expect(body).toContain(
      "You just helped keep The Blue Board free, with no ads. It costs about $500 a month to run, about $17 a day: the live flight and schedule data, the servers, and the AI delay explanations. I'm one person, and this is how it gets paid for.",
    );
    expect(body).toContain(
      "I count what comes in as days: every $17 covers one day, the day it is given or, if that day is already covered, the next open day after it. Smaller amounts add up with other people's until they make a day. The dashboard's About section (ⓘ → About on a computer, More → About on a phone) shows this month's days.",
    );
    expect(body[body.length - 1]).toBe('— Jonah');
    expect(squash(doc.querySelector('main').textContent)).not.toMatch(WE);
    expect(squash(doc.querySelector('h1').textContent)).toBe('Thank you.');
  });
});
