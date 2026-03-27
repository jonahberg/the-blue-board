import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Speed Insights integration', () => {
  it('uses a shared Astro wrapper component', () => {
    const component = readProjectFile('src/components/VercelSpeedInsights.astro');

    expect(component).toContain("import SpeedInsights from '@vercel/speed-insights/astro';");
    expect(component).toContain('<SpeedInsights />');
  });

  it('injects Speed Insights from the dashboard bundle and avoids a duplicate static script', () => {
    const dashboardEntry = readProjectFile('src/dashboard/main.js');
    const dashboardHtml = readProjectFile('public/index.html');

    expect(dashboardEntry).toContain("import { injectSpeedInsights } from '@vercel/speed-insights';");
    expect(dashboardEntry).toContain('injectSpeedInsights();');
    expect(dashboardHtml).toContain('<script defer src="/_vercel/insights/script.js"></script>');
    expect(dashboardHtml).not.toContain('/_vercel/speed-insights/script.js');
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
      'src/pages/tsa.astro',
    ];

    for (const file of entrypoints) {
      const source = readProjectFile(file);

      expect(source, file).toContain('VercelSpeedInsights');
      expect(source, file).toContain('<VercelSpeedInsights />');
    }
  });
});
