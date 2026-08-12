#!/usr/bin/env node
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL = process.env.AUDIT_URL || 'https://theblueboard.co';

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
  { name: '404',      path: '/this-page-does-not-exist' },
];

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900,  mobile: false },
  { name: 'desktop-1024', width: 1024, height: 768,  mobile: false },
  { name: 'mobile-390',   width: 390,  height: 844,  mobile: true },
];

const OUT_DIR = 'audit-output';

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
        pageEntry.viewports.push({
          viewport: vp.name,
          screenshotPath,
          accessibility: {
            violationCount: violations.length,
            violations,
          },
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
