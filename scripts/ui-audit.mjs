#!/usr/bin/env node
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  { name: '404',      path: '/this-page-does-not-exist' },
];

// Dashboard tabs, by their accessible tab name (src/app/tabs.ts labels).
const DASHBOARD_TABS = [
  'My Flights', 'Live Ops', 'Schedule', 'Fleet', 'Starlink', 'Delays · Weather · Hubs', 'Stats', 'Sources',
];

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900,  mobile: false },
  { name: 'desktop-1024', width: 1024, height: 768,  mobile: false },
  { name: 'tablet-768',   width: 768,  height: 1024, mobile: true },
  { name: 'mobile-390',   width: 390,  height: 844,  mobile: true },
];

const OUT_DIR = 'audit-output';

/**
 * Dismiss the welcome dialog, then select every dashboard tab and run axe on each. A tab that
 * cannot be selected, or an island that renders nothing, is recorded as an error.
 */
async function auditDashboardTabs(page, dir, viewportName) {
  const results = [];
  // Welcome dialog: its primary button text uses a curly apostrophe, so match loosely.
  const welcome = page.getByRole('dialog');
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.getByRole('button').first().click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }
  for (const name of DASHBOARD_TABS) {
    const entry = { tab: name };
    try {
      const tab = page.getByRole('tab', { name, exact: true });
      if (!(await tab.isVisible().catch(() => false))) {
        // Phones: overflow tabs live behind the bottom nav's "More".
        await page.getByRole('button', { name: /more/i }).first().click({ timeout: 2000 }).catch(() => {});
      }
      await tab.click({ timeout: 5000 });
      await page.waitForFunction(
        (label) => [...document.querySelectorAll('[role=tab]')]
          .some((t) => t.textContent?.trim() === label && t.getAttribute('aria-selected') === 'true'),
        name,
        { timeout: 5000 },
      );
      await page.waitForTimeout(1500);
      const islandChildren = await page.evaluate(() => document.querySelector('astro-island')?.childElementCount ?? 0);
      if (islandChildren === 0) throw new Error('astro-island is empty (the app crashed)');
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '-');
      await page.screenshot({ path: join(dir, `index-tab-${slug}.png`) });
      const axeResults = await new AxeBuilder({ page }).analyze();
      entry.violations = axeResults.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    } catch (err) {
      entry.error = err.message;
      console.log(`    ⚠ ${viewportName} tab "${name}": ${err.message}`);
    }
    results.push(entry);
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
    summary: { totalViolations: 0, bySeverity: {}, mostCommon: [] },
  };

  const violationCounts = {};

  for (const vp of VIEWPORTS) {
    const dir = join(OUT_DIR, 'screenshots', vp.name);
    await mkdir(dir, { recursive: true });

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      userAgent: vp.mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });

    for (const pg of PAGES) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
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
        const tabs = pg.name === 'index' ? await auditDashboardTabs(page, dir, vp.name) : [];
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
  console.log(`\nTo review: read ${reportPath}, then read any screenshot PNGs.`);
}

run().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
