import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

// Sep 2026: Vercel Web Analytics showed requestPath "/" and nothing else for a month — every
// Astro-rendered page (fleet, hubs, trackers, tsa, news, 404, privacy, newark) only carried Speed
// Insights, which had been canceled on the project since Jul 14 2026. This pins the replacement:
// one shared wrapper that loads /_vercel/insights/script.js, mounted from every static document
// entrypoint, and no Speed Insights residue anywhere (its script would 404 against a canceled
// product and its CSP allowance would be dead weight).
describe('Web Analytics integration', () => {
  it('uses a shared Astro wrapper component that loads the Web Analytics script', () => {
    const component = readProjectFile('src/components/VercelAnalytics.astro');

    expect(component).toContain('<script is:inline defer src="/_vercel/insights/script.js"></script>');
    expect(component).not.toContain('speed-insights');
  });

  it('the dashboard loads the same script exactly once, as a static tag', () => {
    const dashboardEntry = readProjectFile('src/dashboard/main.js');
    const dashboardHtml = readProjectFile('public/index.html');

    expect(dashboardHtml.match(/\/_vercel\/insights\/script\.js/g)).toHaveLength(1);
    expect(dashboardHtml).toContain('<script defer src="/_vercel/insights/script.js"></script>');
    expect(dashboardEntry).not.toContain('@vercel/analytics');
    expect(dashboardEntry).not.toContain('speed-insights');
  });

  it('mounts the shared wrapper from every static Astro document entrypoint', () => {
    const entrypoints = [
      'src/layouts/FleetTypeLayout.astro',
      'src/layouts/HubLayout.astro',
      'src/layouts/NewsLayout.astro',
      'src/pages/404.astro',
      'src/pages/fleet/index.astro',
      'src/pages/hubs/index.astro',
      'src/pages/news/index.astro',
      'src/pages/newark.astro',
      'src/pages/privacy.astro',
      'src/pages/tsa.astro',
      'src/pages/trackers/index.astro',
      'src/pages/trackers/atc.astro',
      'src/pages/trackers/united-hubs.astro',
      'src/components/trackers/TrackerDetailLayout.astro',
    ];

    for (const file of entrypoints) {
      const source = readProjectFile(file);

      expect(source, file).toContain("/VercelAnalytics.astro'");
      expect(source, file).toContain('<VercelAnalytics />');
    }
  });

  it('Speed Insights (canceled on the Vercel project Jul 2026) is fully removed', () => {
    expect(existsSync(resolve(process.cwd(), 'src/components/VercelSpeedInsights.astro'))).toBe(false);
    const pkg = JSON.parse(readProjectFile('package.json'));
    expect(pkg.dependencies?.['@vercel/speed-insights']).toBeUndefined();
    expect(pkg.devDependencies?.['@vercel/speed-insights']).toBeUndefined();
    expect(readProjectFile('vercel.json')).not.toContain('vitals.vercel-insights.com');
  });
});
