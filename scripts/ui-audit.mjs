#!/usr/bin/env node
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { HUB_ORDER } from '../src/lib/hub-health.js';
import {
  LINK_GUARD_ALLOW,
  LINK_GUARD_TABS,
  LINK_GUARD_TAIL_SOURCES,
  coverageGaps,
  findNames,
  findUnlinkedNamesByRegion,
  tailsInPayload,
} from '../src/lib/link-guard.js';

// Production by default. To audit a branch, serve it and point AUDIT_URL at it: `bun run build`,
// then `bunx astro preview` (its /api proxies to production, astro.config.mjs) and
// AUDIT_URL=http://localhost:4321. Without /api the dashboard falls back to its static roster, and
// the link check below then fails for want of flights and hubs rather than passing on a thin tab.
// When Playwright's own browser revision is not installed, PLAYWRIGHT_CHROMIUM_PATH names one that
// is (a `chromium_headless_shell-*/…/chrome-headless-shell` under ~/Library/Caches/ms-playwright).
const BASE_URL = process.env.AUDIT_URL || 'https://theblueboard.co';

// One page of every type the site ships (hubs + trackers + fleet + news + static pages).
// Slugs are real routes from the build; update them if a slug is retired.
const PAGES = [
  { name: 'index',    path: '/' },
  { name: 'hubs',     path: '/hubs/' },
  { name: 'hubs-ord', path: '/hubs/ord' },
  { name: 'hubs-den', path: '/hubs/den' },
  { name: 'hubs-iah', path: '/hubs/iah' },
  { name: 'hubs-ewr', path: '/hubs/ewr' },
  { name: 'hubs-sfo', path: '/hubs/sfo' },
  { name: 'hubs-iad', path: '/hubs/iad' },
  { name: 'hubs-lax', path: '/hubs/lax' },
  { name: 'hubs-nrt', path: '/hubs/nrt' },
  { name: 'hubs-gum', path: '/hubs/gum' },
  { name: 'trackers',        path: '/trackers' },
  { name: 'tracker-atc',     path: '/trackers/atc' },
  { name: 'tracker-united',  path: '/trackers/united-hubs' },
  { name: 'tracker-atc-iah', path: '/trackers/atc/iah' },
  { name: 'tracker-united-iah', path: '/trackers/united-hubs/iah' },
  { name: 'fleet',      path: '/fleet' },
  { name: 'fleet-type', path: '/fleet/787-9-dreamliner' },
  { name: 'news',       path: '/news' },
  { name: 'news-article', path: '/news/united-first-transatlantic-starlink-777' },
  { name: 'newark',     path: '/newark' },
  { name: 'privacy',    path: '/privacy' },
  { name: 'flight',     path: '/flight' },
  { name: 'thanks',     path: '/thanks' },
  { name: '404',      path: '/this-page-does-not-exist' },
];

// Dashboard tabs (src/app/tabs.ts): `label` names the desktop tab and the phone More-sheet row,
// `short` the phone bottom-bar button, `hash` is what the URL reads once the tab is showing.
const DASHBOARD_TABS = [
  { label: 'My Flights', short: 'My Flights', hash: '#myflight' },
  { label: 'Live Ops', short: 'Live', hash: '#live' },
  { label: 'Schedule', short: 'Schedule', hash: '#schedule' },
  { label: 'Fleet', short: null, hash: '#fleet' },
  { label: 'Starlink', short: null, hash: '#starlink' },
  { label: 'Delays · Weather · Hubs', short: 'Weather', hash: '#weather' },
  { label: 'Stats', short: null, hash: '#stats' },
  { label: 'Sources', short: null, hash: '#sources' },
];

for (const id of LINK_GUARD_TABS) {
  if (!DASHBOARD_TABS.some((t) => t.hash === `#${id}`)) throw new Error(`LINK_GUARD_TABS names "${id}", which is not a dashboard tab here`);
}

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900,  mobile: false },
  { name: 'desktop-1024', width: 1024, height: 768,  mobile: false },
  { name: 'tablet-768',   width: 768,  height: 1024, mobile: true },
  { name: 'mobile-390',   width: 390,  height: 844,  mobile: true },
];

const OUT_DIR = 'audit-output';

// Optional narrowing for a quick run: AUDIT_PAGES=index AUDIT_VIEWPORTS=mobile-390,tablet-768.
const only = (env) => (process.env[env] ? new Set(process.env[env].split(',').map((x) => x.trim())) : null);
const ONLY_PAGES = only('AUDIT_PAGES');
const ONLY_VIEWPORTS = only('AUDIT_VIEWPORTS');

/**
 * Show one dashboard tab the way a visitor would. From `lg` that is the tab bar (`role=tab`).
 * Below `lg` there is no tab bar: the four primary tabs are bottom-bar buttons named by their
 * short label, and the other four are rows in the bottom bar's "More" sheet, named by their full
 * label. The switch is confirmed by the URL hash, which every tab writes, and a More sheet is
 * closed again before axe runs, so its overlay is never what gets audited.
 */
async function showTab(page, { label, short, hash }) {
  const tab = page.getByRole('tab', { name: label, exact: true });
  if (await tab.isVisible().catch(() => false)) {
    await tab.click({ timeout: 5000 });
  } else {
    const nav = page.getByRole('navigation', { name: 'Dashboard navigation' });
    if (short) {
      await nav.getByRole('button', { name: short, exact: true }).click({ timeout: 5000 });
    } else {
      await nav.getByRole('button', { name: 'More', exact: true }).click({ timeout: 5000 });
      const sheet = page.getByRole('dialog', { name: 'More' });
      await sheet.getByRole('button', { name: label, exact: true }).click({ timeout: 5000 });
      await sheet.waitFor({ state: 'hidden', timeout: 5000 });
    }
  }
  await page.waitForFunction((want) => window.location.hash === want, hash, { timeout: 5000 });
}

// ── Link guard: a name in a row that is not a link (src/lib/link-guard.js) ────────────────────
// For each tab in LINK_GUARD_TABS, at every viewport: the text inside its table rows, list items
// and `[data-link-row]` elements, each run marked with whether a link or button is around it and
// with the hub of the region it sits in (`data-link-self`, the Schedule board's own hub).
// `findUnlinkedNamesByRegion` decides which runs print a flight number, a known tail or a hub code
// with no link; each is a failure, and so is a run that examined too little to mean anything
// (`coverageGaps`). This script only collects what the browser shows.
//
// What is read is the tab's own panel as it first shows, except where a tab lists its rows only
// after a search (LINK_GUARD_SEARCH): there the audit types the search and reads the search box's
// own block (its results), in the panel at `lg`+ or in the sheet that holds it below `lg`.

/**
 * Tabs whose rows exist only once a search is typed, and what the audit types. Live's search runs
 * over the feed the page already holds; nothing is fetched. "UA" lists United flights (capped at
 * 50 rows), each with its route's ends and its tail. Below `lg` the search box is in the Filters
 * sheet, which the audit opens first and closes after.
 */
const LINK_GUARD_SEARCH = {
  live: { text: 'UA', box: 'input[aria-label="Search the live feed"]', sheet: 'Filters' },
};

/** The tab whose roster rows open a disclosure the check should read too (the Starlink roster's expansion). */
const DISCLOSURE_TABS = new Set(['starlink']);

/** A same-origin data request: what the tab is still waiting on. Fonts and map tiles are not. */
const isDataRequest = (request) => {
  const url = new URL(request.url());
  return url.origin === new URL(BASE_URL).origin && /^\/(?:api|data)\//.test(url.pathname);
};

/** The tails the page loaded (LINK_GUARD_TAIL_SOURCES) and its data requests in flight. Attach before `goto`. */
function watchPage(page) {
  const tails = new Set();
  const parsing = [];
  const inFlight = new Set();
  page.on('request', (request) => {
    if (isDataRequest(request)) inFlight.add(request);
  });
  page.on('requestfinished', (request) => inFlight.delete(request));
  page.on('requestfailed', (request) => inFlight.delete(request));
  page.on('response', (response) => {
    if (!LINK_GUARD_TAIL_SOURCES.some((re) => re.test(response.url()))) return;
    parsing.push(
      response.json().then(
        (json) => tailsInPayload(json).forEach((tail) => tails.add(tail)),
        () => {},
      ),
    );
  });
  return { tails, inFlight, parsed: () => Promise.all(parsing) };
}

const ROW_SELECTOR = 'tr, li, [data-link-row]';
const ROOT_MARK = 'data-link-audit-root';

/**
 * In the browser: mark what the check reads, and return whether it was found. By default the tab's
 * own panel: Radix ids a panel `<base>-content-<tab>`, and the dashboard's panels are the outermost
 * ones (visited tabs stay mounted, hidden, and the Fleet tab nests a tab set of its own, so "the
 * active tabpanel" alone can be a hidden Fleet sub-panel). With `box`, the block that holds the
 * first visible element matching it (the Live search box's own block, wherever it is).
 */
function markRoot({ tab, box, mark }) {
  document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark));
  const root = box
    ? [...document.querySelectorAll(box)].find((el) => el.checkVisibility())?.parentElement
    : [...document.querySelectorAll('[role="tabpanel"]')].find(
        (p) => p.id.endsWith(`-content-${tab}`) && !p.parentElement?.closest('[role="tabpanel"]'),
      );
  root?.setAttribute(mark, '');
  return Boolean(root);
}

/** Rows rendered in what `markRoot` marked. */
function countRows({ selector, mark }) {
  const root = document.querySelector(`[${mark}]`);
  return root ? [...root.querySelectorAll(selector)].filter((row) => row.checkVisibility()).length : 0;
}

/** Open the first collapsed row disclosure in a row that has a flight link; false when there is none. */
function openDisclosure({ mark }) {
  const root = document.querySelector(`[${mark}]`);
  const button = root?.querySelector('tr:has(a[data-flight-link]) button[aria-expanded="false"]');
  if (!button || !button.checkVisibility()) return false;
  button.click();
  return true;
}

/** Wait until no data request is in flight and the row count has held for a second (20 s at most). */
async function settleRows(page, watch) {
  const deadline = Date.now() + 20000;
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const count = await page.evaluate(countRows, { selector: ROW_SELECTOR, mark: ROOT_MARK });
    if (count !== last || [...watch.inFlight].length > 0) {
      last = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 1000) {
      return;
    }
    await page.waitForTimeout(250);
  }
}

/**
 * In the browser: every run of text in the marked root's rows, attributed to its nearest row (an
 * Upcoming Flights `li` inside the roster expansion's `tr` is its own row, and so is a
 * `[data-link-row="status-note"]` cell inside a table row, named with its value). Text that is not
 * rendered (`display: none`, a closed `<details>`) is not printed and is skipped; sr-only text is
 * read aloud and is kept. Consecutive text nodes are one run, so `UA{number}` reads as one word.
 * Each run carries its region's hub (`data-link-self`), when a view marked one.
 */
function collectRows({ selector, tab, viewport, mark }) {
  const panel = document.querySelector(`[${mark}]`);
  if (!panel || !panel.checkVisibility()) return { byKind: {}, rowCount: 0, runs: [] };
  const section = (row) => {
    for (let el = row.parentElement; el && el !== panel; el = el.parentElement) {
      if (el.id) return `#${el.id}`;
      if (el.getAttribute('aria-label')) return `"${el.getAttribute('aria-label')}"`;
    }
    return '(panel)';
  };
  const byKind = {};
  const runs = [];
  const rows = [...panel.querySelectorAll(selector)].filter((row) => row.checkVisibility());
  for (const row of rows) {
    const named = row.getAttribute('data-link-row');
    const kind = row.tagName.toLowerCase() + (named === null ? '' : named ? `[data-link-row=${named}]` : '[data-link-row]');
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    const where = `${tab} ${viewport} ${section(row)} ${kind}`;
    const self = row.closest('[data-link-self]')?.getAttribute('data-link-self') || null;
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let run = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest(selector) !== row || !parent.checkVisibility()) continue;
      if (run && node.previousSibling === run.last) {
        run.text += node.data;
        run.last = node;
      } else {
        run = { text: node.data, linked: Boolean(parent.closest('a[href], button')), where, self, last: node };
        runs.push(run);
      }
    }
  }
  return { byKind, rowCount: rows.length, runs: runs.map(({ text, linked, where, self }) => ({ text, linked, where, self })) };
}

/**
 * Type a tab's search (LINK_GUARD_SEARCH), opening the sheet that holds the box when it is not
 * showing. True when the sheet was opened, so it is closed again after.
 */
async function typeSearch(page, { text, box, sheet }) {
  let opened = false;
  if (!(await page.locator(box).first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: sheet, exact: true }).click({ timeout: 5000 });
    await page.getByRole('dialog', { name: sheet }).waitFor({ timeout: 5000 });
    opened = true;
  }
  await page.locator(box).first().fill(text, { timeout: 5000 });
  return opened;
}

/** Clear the search again, and close the sheet it was typed in. */
async function clearSearch(page, { box, sheet }, opened) {
  await page.locator(box).first().fill('', { timeout: 5000 }).catch(() => {});
  if (opened) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('dialog', { name: sheet }).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
}

/**
 * Check one guarded tab at one viewport. On a tab in LINK_GUARD_SEARCH, types its search first and
 * reads the search box's block. On a tab in DISCLOSURE_TABS, opens one collapsed row disclosure
 * first (a row that has a flight link and an `aria-expanded="false"` button), so the rows it
 * reveals are checked too.
 */
async function checkTabLinks(page, watch, tab, viewport) {
  const search = LINK_GUARD_SEARCH[tab] ?? null;
  const sheetOpened = search ? await typeSearch(page, search) : false;
  let collected;
  let opened = false;
  try {
    await page.evaluate(markRoot, { tab, box: search?.box ?? null, mark: ROOT_MARK });
    await settleRows(page, watch);
    opened = DISCLOSURE_TABS.has(tab) ? await page.evaluate(openDisclosure, { mark: ROOT_MARK }) : false;
    if (opened) await settleRows(page, watch);
    await watch.parsed();
    collected = await page.evaluate(collectRows, { selector: ROW_SELECTOR, tab, viewport, mark: ROOT_MARK });
  } finally {
    await page.evaluate((mark) => document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark)), ROOT_MARK).catch(() => {});
    if (search) await clearSearch(page, search, sheetOpened);
  }
  const { byKind, rowCount, runs } = collected;
  const known = { hubs: HUB_ORDER, tails: watch.tails };
  const names = { flight: 0, tail: 0, hub: 0 };
  for (const { kind } of findNames(runs, known)) names[kind] += 1;
  const unlinked = findUnlinkedNamesByRegion(runs, known, LINK_GUARD_ALLOW);
  const gaps = coverageGaps(tab, { rows: rowCount, names, knownTails: known.tails.size });
  const rowsText = Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
  console.log(
    `    link guard ${tab} @ ${viewport}: ${rowCount} rows (${rowsText}${opened ? '; one disclosure opened' : ''}), ` +
      `names flight ${names.flight} / tail ${names.tail} / hub ${names.hub}, ${known.tails.size} known tails → ` +
      `${unlinked.length} unlinked`,
  );
  for (const name of unlinked) console.log(`    ✗ unlinked ${name.kind} "${name.text}" at ${name.where}`);
  for (const gap of gaps) console.log(`    ✗ link guard ${tab} @ ${viewport}: ${gap}`);
  return { rows: rowCount, byKind, disclosureOpened: opened, names, knownTails: known.tails.size, unlinked, gaps };
}

/**
 * Dismiss any dialog open on load, then show every dashboard tab and run axe on each. A tab that
 * cannot be shown, or an island that renders nothing, is recorded as an error. A tab in
 * LINK_GUARD_TABS also gets the link check.
 */
async function auditDashboardTabs(page, dir, viewportName, watch) {
  const results = [];
  // Against `astro dev`, the dev toolbar sits over the phone bottom bar and takes its clicks.
  await page.addStyleTag({ content: 'astro-dev-toolbar{display:none!important}' }).catch(() => {});
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
  }
  for (const entry of DASHBOARD_TABS) {
    const result = { tab: entry.label };
    const guarded = LINK_GUARD_TABS.find((id) => entry.hash === `#${id}`);
    try {
      await showTab(page, entry);
      await page.waitForTimeout(1500);
      const islandChildren = await page.evaluate(() => document.querySelector('astro-island')?.childElementCount ?? 0);
      if (islandChildren === 0) throw new Error('astro-island is empty (the app crashed)');
      const slug = entry.label.toLowerCase().replace(/[^a-z]+/g, '-');
      await page.screenshot({ path: join(dir, `index-tab-${slug}.png`) });
      const axeResults = await new AxeBuilder({ page }).analyze();
      result.violations = axeResults.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
      if (guarded) result.linkGuard = await checkTabLinks(page, watch, guarded, viewportName);
    } catch (err) {
      result.error = err.message;
      console.log(`    ⚠ ${viewportName} tab "${entry.label}": ${err.message}`);
      // A guarded tab that could not be checked is not a pass.
      if (guarded && !result.linkGuard) {
        console.log(`    ✗ link guard ${guarded} @ ${viewportName}: not checked: ${err.message}`);
        result.linkGuard = { unlinked: [], gaps: [`not checked: ${err.message}`] };
      }
    }
    results.push(result);
  }
  return results;
}

async function run() {
  console.log(`\nUI Audit — ${BASE_URL}\n${'─'.repeat(40)}`);

  // Use PLAYWRIGHT_CHROMIUM_PATH env var to override the browser binary,
  // otherwise let Playwright find its own installed Chromium
  const launchOpts = {};
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  const browser = await chromium.launch(launchOpts);
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    pages: [],
    summary: {
      totalViolations: 0,
      bySeverity: {},
      mostCommon: [],
      // Kept apart from axe's counts: `bySeverity` is keyed by axe impact.
      linkGuard: { tabs: [...LINK_GUARD_TABS], checks: 0, unlinked: 0, gaps: 0 },
    },
  };

  const violationCounts = {};

  for (const vp of VIEWPORTS.filter((v) => !ONLY_VIEWPORTS || ONLY_VIEWPORTS.has(v.name))) {
    const dir = join(OUT_DIR, 'screenshots', vp.name);
    await mkdir(dir, { recursive: true });

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      // Touch emulation changes chrome heights and every `pointer-coarse:` rule.
      hasTouch: vp.mobile,
      userAgent: vp.mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });

    for (const pg of PAGES.filter((p) => !ONLY_PAGES || ONLY_PAGES.has(p.name))) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      // Before `goto`: the dashboard loads the Starlink roster at boot.
      const watch = pg.name === 'index' ? watchPage(page) : null;
      const url = `${BASE_URL}${pg.path}`;
      const screenshotPath = join(dir, `${pg.name}.png`);

      console.log(`  ${vp.name} / ${pg.name} ...`);

      try {
        // Use domcontentloaded + settle time instead of networkidle,
        // since pages load external resources (fonts, APIs) that may hang
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Let JS rendering and layout settle
        await page.waitForTimeout(pg.name === 'index' ? 5000 : 2000);

        await page.screenshot({ path: screenshotPath, fullPage: true });

        // Run accessibility audit
        const axeResults = await new AxeBuilder({ page }).analyze();
        const violations = axeResults.violations.map(v => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.length,
        }));

        // Track violation counts
        for (const v of violations) {
          report.summary.totalViolations += 1;
          report.summary.bySeverity[v.impact] = (report.summary.bySeverity[v.impact] || 0) + 1;
          violationCounts[v.id] = (violationCounts[v.id] || 0) + 1;
        }

        // Find or create page entry in report
        let pageEntry = report.pages.find(p => p.name === pg.name);
        if (!pageEntry) {
          pageEntry = { name: pg.name, path: pg.path, viewports: [] };
          report.pages.push(pageEntry);
        }
        const tabs = pg.name === 'index' ? await auditDashboardTabs(page, dir, vp.name, watch) : [];
        // Tab-level findings count in the summary too: below `lg` they were never collected.
        for (const tab of tabs) {
          for (const v of tab.violations ?? []) {
            report.summary.totalViolations += 1;
            report.summary.bySeverity[v.impact] = (report.summary.bySeverity[v.impact] || 0) + 1;
            violationCounts[v.id] = (violationCounts[v.id] || 0) + 1;
          }
          if (tab.linkGuard) {
            report.summary.linkGuard.checks += 1;
            report.summary.linkGuard.unlinked += tab.linkGuard.unlinked.length;
            report.summary.linkGuard.gaps += tab.linkGuard.gaps.length;
          }
        }
        if (pageErrors.length) {
          console.log(`    ⚠ uncaught page errors: ${pageErrors.join(' | ')}`);
          report.summary.pageErrors = (report.summary.pageErrors || 0) + pageErrors.length;
        }
        pageEntry.viewports.push({
          viewport: vp.name,
          screenshotPath,
          pageErrors,
          accessibility: {
            violationCount: violations.length,
            violations,
          },
          tabs,
        });
      } catch (err) {
        console.log(`    ⚠ Error: ${err.message}`);
        // The dashboard never reached its tabs, so the guarded ones were not checked: not a pass.
        if (watch) {
          for (const id of LINK_GUARD_TABS) {
            console.log(`    ✗ link guard ${id} @ ${vp.name}: not checked: ${err.message}`);
            report.summary.linkGuard.gaps += 1;
          }
        }
        let pageEntry = report.pages.find(p => p.name === pg.name);
        if (!pageEntry) {
          pageEntry = { name: pg.name, path: pg.path, viewports: [] };
          report.pages.push(pageEntry);
        }
        pageEntry.viewports.push({
          viewport: vp.name,
          screenshotPath: null,
          error: err.message,
        });
      }

      await page.close();
    }

    await context.close();
  }

  await browser.close();

  // Compute most common violations
  report.summary.mostCommon = Object.entries(violationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }));

  // Write report
  const reportPath = join(OUT_DIR, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Screenshots: ${OUT_DIR}/screenshots/`);
  console.log(`Report:      ${reportPath}`);
  console.log(`\nAccessibility summary:`);
  console.log(`  Total violations: ${report.summary.totalViolations}`);
  for (const [severity, count] of Object.entries(report.summary.bySeverity)) {
    console.log(`    ${severity}: ${count}`);
  }
  if (report.summary.mostCommon.length > 0) {
    console.log(`  Most common:`);
    for (const { id, count } of report.summary.mostCommon) {
      console.log(`    ${id} (${count}x)`);
    }
  }
  const lg = report.summary.linkGuard;
  console.log(`\nLink guard (names in rows that are not links; tabs: ${lg.tabs.join(', ')}):`);
  console.log(`  Checks run: ${lg.checks}`);
  console.log(`  Unlinked names: ${lg.unlinked}`);
  console.log(`  Coverage gaps: ${lg.gaps}`);
  // The guard fails the run; axe findings stay a report, as they always have.
  if (lg.unlinked > 0 || lg.gaps > 0) {
    console.log(`  ✗ FAILED — each one is listed above with its tab, viewport and row`);
    process.exitCode = 1;
  }
  console.log(`\nTo review: read ${reportPath}, then read any screenshot PNGs.`);
}

run().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
