import { execFileSync } from 'node:child_process';

const FALLBACK_DATE = new Date().toISOString().slice(0, 10);
const lastModifiedCache = new Map();

export const homeLastmodPaths = [
  'public/index.html',
  'public/css/style.css',
  'public/data/fleet.json',
  'public/data/starlink.json',
  'src/pages/hubs/index.astro',
  'src/pages/fleet/index.astro',
  'src/layouts/HubLayout.astro',
  'src/layouts/FleetTypeLayout.astro',
];

export const fleetIndexLastmodPaths = [
  'src/pages/fleet/index.astro',
  'src/data/fleet/index.js',
  'public/data/fleet.json',
];

export const hubIndexLastmodPaths = [
  'src/pages/hubs/index.astro',
  'src/data/hubs/index.js',
];

export const newsIndexLastmodPaths = [
  'src/pages/news/index.astro',
  'src/data/news/index.js',
];

function normalizePaths(paths) {
  return Array.isArray(paths) ? paths : [paths];
}

export function getLastModified(paths) {
  const pathList = normalizePaths(paths);
  const cacheKey = pathList.join('\0');
  if (lastModifiedCache.has(cacheKey)) {
    return lastModifiedCache.get(cacheKey);
  }

  let value = FALLBACK_DATE;
  try {
    const output = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...pathList], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (output) {
      value = output;
    }
  } catch {
    value = FALLBACK_DATE;
  }

  lastModifiedCache.set(cacheKey, value);
  return value;
}

export function getFleetRouteLastmodPaths(slug) {
  return [
    'src/pages/fleet/[type].astro',
    'src/layouts/FleetTypeLayout.astro',
    'src/data/fleet/index.js',
    `src/data/fleet/${slug}.js`,
    'public/data/fleet.json',
  ];
}

export function getHubRouteLastmodPaths(slug) {
  return [
    'src/pages/hubs/[hub].astro',
    'src/layouts/HubLayout.astro',
    'src/data/hubs/index.js',
    `src/data/hubs/${slug}.js`,
  ];
}

export function getNewsRouteLastmodPaths(slug) {
  return [
    'src/pages/news/[slug].astro',
    'src/layouts/NewsLayout.astro',
    'src/data/news/index.js',
  ];
}

export const newarkLastmodPaths = [
  'src/pages/newark.astro',
  'public/js/newark-live.js',
  'src/data/hubs/ewr.js',
];

export const tsaLastmodPaths = [
  'src/pages/tsa.astro',
  'src/data/tsa/united-terminals.js',
];

export const trackersIndexLastmodPaths = [
  'src/pages/trackers/index.astro',
  'src/data/trackers/index.js',
  'src/data/trackers/atc.js',
  'src/data/trackers/united-hubs.js',
];

// Per-tracker paths MUST include the tracker's own data file so the two pages
// never report identical lastmod (the shared-template trap the news sitemap
// was explicitly fixed away from — see sitemap.xml.ts).
export function getTrackerRouteLastmodPaths(slug) {
  return [
    `src/pages/trackers/${slug}.astro`,
    `src/data/trackers/${slug}.js`,
    'src/data/trackers/index.js',
    'src/lib/tracker-map.js',
  ];
}

export function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
