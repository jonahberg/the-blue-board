import { articles } from '../data/news/index.js';
import { HUB_LINE_LONG, HUB_LINE_SHORT, TRACKED_BOARDS } from '../data/facts.js';

const BASE_URL = 'https://theblueboard.co';

function xmlEscape(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function GET() {
  const now = new Date().toUTCString();

  const staticItems = [
    {
      title: 'United Airlines Live Flight Dashboard',
      link: `${BASE_URL}`,
      description:
        'Track every United Airlines flight in real time. 600+ flights on a live map updated every 30 seconds. Hub delay alerts, IROPS monitoring, flight search, and weather radar.',
    },
    {
      title: 'United Airlines Fleet Database — 1,078 Aircraft',
      link: `${BASE_URL}/fleet`,
      description:
        'Complete United Airlines fleet database. Search 1,078 mainline aircraft by type, registration, seat configuration, WiFi, and Starlink status.',
    },
    {
      title: `United Airlines Hub Airports — ${TRACKED_BOARDS} Tracked Boards (${HUB_LINE_SHORT})`,
      link: `${BASE_URL}/hubs`,
      description: `Live status across ${HUB_LINE_LONG}. Delays, cancellations, on-time performance at ORD, DEN, IAH, EWR, SFO, IAD, LAX, NRT, and GUM.`,
    },
  ];

  const newsItems = articles.map((a) => ({
    title: a.title,
    link: `${BASE_URL}/news/${a.slug}`,
    description: a.summary,
    pubDate: new Date(a.date + 'T12:00:00Z').toUTCString(),
    guid: `${BASE_URL}/news/${a.slug}`,
    category: a.category,
  }));

  const items = [
    // News articles first (with pubDate), then static pages
    ...newsItems.map(
      (item) => `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${item.link}</link>
      <guid isPermaLink="true">${item.guid}</guid>
      <description>${xmlEscape(item.description)}</description>
      <pubDate>${item.pubDate}</pubDate>
      <category>${xmlEscape(item.category)}</category>
    </item>`
    ),
    ...staticItems.map(
      (item) => `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${item.link}</link>
      <guid isPermaLink="true">${item.link}</guid>
      <description>${xmlEscape(item.description)}</description>
    </item>`
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The Blue Board — United Airlines Flight Tracker</title>
    <link>${BASE_URL}</link>
    <description>Real-time United Airlines operations dashboard and curated news. Live flight tracking, hub delay monitoring, Starlink WiFi fleet status, and operational analytics.</description>
    <language>en-us</language>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${now}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
