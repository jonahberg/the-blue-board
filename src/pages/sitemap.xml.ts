import { fleetOrder, fleetTypes } from '../data/fleet/index.js';
import { hubOrder } from '../data/hubs/index.js';
import { articles } from '../data/news/index.js';
import {
  fleetIndexLastmodPaths,
  getFleetRouteLastmodPaths,
  getHubRouteLastmodPaths,
  getLastModified,
  homeLastmodPaths,
  hubIndexLastmodPaths,
  newsIndexLastmodPaths,
  getNewsRouteLastmodPaths,
  xmlEscape,
} from '../lib/buildMetadata.js';

const BASE_URL = 'https://theblueboard.co';

function renderUrl(path: string, lastmod: string, changefreq: string, priority: string) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(`${BASE_URL}${path}`)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

export function GET() {
  const fleetKeys = fleetOrder as Array<keyof typeof fleetTypes>;
  const urls = [
    renderUrl('/', getLastModified(homeLastmodPaths), 'daily', '1.0'),
    renderUrl('/fleet', getLastModified(fleetIndexLastmodPaths), 'daily', '0.9'),
    ...fleetKeys.map((key) =>
      renderUrl(
        `/fleet/${fleetTypes[key].slug}`,
        getLastModified(getFleetRouteLastmodPaths(fleetTypes[key].slug)),
        'weekly',
        '0.8'
      )
    ),
    renderUrl('/hubs', getLastModified(hubIndexLastmodPaths), 'weekly', '0.9'),
    ...hubOrder.map((key) =>
      renderUrl(`/hubs/${key}`, getLastModified(getHubRouteLastmodPaths(key)), 'weekly', '0.8')
    ),
    renderUrl('/news', getLastModified(newsIndexLastmodPaths), 'daily', '0.9'),
    ...articles.map((a) =>
      renderUrl(`/news/${a.slug}`, getLastModified(getNewsRouteLastmodPaths(a.slug)), 'weekly', '0.7')
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
