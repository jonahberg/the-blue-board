/**
 * home-seo.js — every crawlable string and structured-data block on the homepage.
 *
 * `src/pages/index.astro` renders the dashboard as a `client:only` React island, so a
 * crawler, an AI extractor or a no-JS visitor sees ONLY what this module produces. It is
 * the direct port of the hand-written blocks in the old `public/index.html` (now kept for
 * reference at `legacy/index.html`): the crawlable brief (:158-180), the sr-only site nav
 * (:181-198), the `<noscript>` block (:132-157), the sr-only fleet summary (:544-547) and
 * the six JSON-LD blocks at the end of `<body>` (:1010-1227).
 *
 * Three rules this file exists to enforce:
 *  1. No hand-typed figures. The fleet count comes from `src/data/facts.js`, the per-type
 *     breakdown from `src/data/fleet/index.js`, and the Starlink label/as-of from
 *     `src/data/starlink-facts.js` (which reads `src/data/starlink-live.json`, refreshed at
 *     build by `scripts/refresh-starlink-facts.mjs`). The old page carried a literal "425+"
 *     that `scripts/stamp-seo-build-date.mjs` rewrote in `dist/`; an Astro page can import
 *     the data directly, so the stamping hack is gone for HTML and the literal must never
 *     come back — `tests/home-seo.test.js` pins that.
 *  2. Never `import` this module from `api/**`. It reaches a bare JSON import through
 *     `starlink-facts.js`, which crashes Vercel's native Node ESM at module load
 *     (guarded by `tests/api-esm-json-imports.test.js`).
 *  3. Keep the Markdown twin in `src/lib/agent-markdown.js` in step with any copy edit.
 */

import { FLEET_DB_COUNT, HUB_LINE_LONG } from '../data/facts.js';
import { fleetOrder, fleetTypes } from '../data/fleet/index.js';
import { STARLINK_EQUIPPED_LABEL, STARLINK_AS_OF } from '../data/starlink-facts.js';

const SITE_URL = 'https://theblueboard.co';

/** "1,078" — the same rendering the Markdown twins and the agent-readiness pins use. */
const FLEET_COUNT_TEXT = FLEET_DB_COUNT.toLocaleString('en-US');

/** `<title>` / `og:title`. */
export const HOME_TITLE = 'The Blue Board | United Airlines Flight Tracker & Ops Dashboard';

/** `<meta name="description">`. */
export const HOME_DESCRIPTION =
  'The Blue Board is an independent United Airlines flight tracker and operations dashboard '
  + 'with live flight status, hub delays, fleet data, Starlink coverage, schedules, and weather.';

/**
 * The crawlable page brief. Rendered inside `<section class="sr-only">` BEFORE any
 * `<header>` — readability-style extractors (the ones AI crawlers run) drop header/nav
 * regions as boilerplate, which is why the dashboard's own brand heading does not count
 * as the page h1.
 *
 * The TSA checkpoint guide clause was removed from the "Weather and airport conditions"
 * bullet when the feature was retired (see the TSA-removal inventory); the bullet itself
 * covers the Weather tab and stays.
 */
export const HOME_BRIEF = {
  h1: 'The Blue Board — United Airlines Flight Tracker and Live Operations Dashboard',
  intro:
    'The Blue Board is a free, independent, real-time operations dashboard for United Airlines '
    + 'flights. It plots every airborne United flight on a live map refreshed every 30 seconds, '
    + `and tracks delays, cancellations, and FAA ground stops across ${HUB_LINE_LONG} — `
    + "Chicago O'Hare (ORD), Denver (DEN), Houston Intercontinental (IAH), Newark Liberty (EWR), "
    + 'San Francisco (SFO), Washington Dulles (IAD), Los Angeles (LAX), Guam (GUM), and Tokyo '
    + 'Narita (NRT). It is built for the United community and is not affiliated with United '
    + 'Airlines, Inc.',
  checksHeading: 'What you can check here',
  checks: [
    {
      term: 'Live flight status.',
      text:
        'Look up any United flight by number, tail number, or route to see its position, '
        + 'altitude, route, delay status, and estimated arrival. Deep-link straight to a flight '
        + 'with /?flight=UA1234.',
    },
    {
      term: 'Hub delays and ground stops.',
      text:
        'On-time percentage, cancellation counts, ground delay programs, and FAA National '
        + 'Airspace System alerts for each hub, updated continuously.',
    },
    {
      term: 'Delay risk prediction.',
      text:
        'An eight-signal risk score — inbound aircraft, turnaround pressure, hub congestion, '
        + 'weather, and FAA programs — with a plain-language explanation of what is driving it.',
    },
    {
      term: 'Starlink WiFi and fleet data.',
      text:
        `A searchable database of ${FLEET_COUNT_TEXT} United mainline airframes with seat `
        + 'configuration by cabin, in-flight entertainment, delivery date, and whether the '
        + 'aircraft has SpaceX Starlink satellite WiFi.',
    },
    {
      term: 'Departure and arrival boards.',
      text:
        'Hub schedules with on-time statistics and equipment-swap alerts, sourced from '
        + 'AeroDataBox.',
    },
    {
      term: 'Weather and airport conditions.',
      text:
        'NEXRAD radar over the live map, METAR observations at every hub, and the FAA advisories '
        + 'driving ground stops and ground delay programs.',
    },
  ],
  howToUseHeading: 'How to use this site',
  /**
   * Carries three anchors, so it is rendered with `set:html`. The value is a module
   * constant — no interpolation of anything a visitor can supply.
   */
  howToUseHtml:
    'Use The Blue Board when the question is specific to United Airlines operations and needs '
    + 'an answer from the last few minutes rather than a published timetable: whether United is '
    + 'delayed at a given hub right now, where a particular flight is, what aircraft is '
    + 'operating it, and whether that aircraft has Starlink. It covers United only, it is not a '
    + 'booking tool, and united.com and the airport display remain the systems of record for a '
    + 'flight you are about to board. Machine-readable summaries of the whole site live at '
    + '<a href="/llms.txt">/llms.txt</a> and <a href="/llms-full.txt">/llms-full.txt</a>, every '
    + 'indexable URL is listed in <a href="/sitemap.xml">/sitemap.xml</a>, and this page is also '
    + 'available as Markdown to any client that sends an Accept: text/markdown request header.',
};

/** The nine hub guides, in the dashboard's fixed hub order. */
const HUB_LINKS = [
  { href: '/hubs/ord', label: "United at Chicago O'Hare (ORD)" },
  { href: '/hubs/den', label: 'United at Denver (DEN)' },
  { href: '/hubs/iah', label: 'United at Houston (IAH)' },
  { href: '/hubs/ewr', label: 'United at Newark (EWR)' },
  { href: '/hubs/sfo', label: 'United at San Francisco (SFO)' },
  { href: '/hubs/iad', label: 'United at Washington Dulles (IAD)' },
  { href: '/hubs/lax', label: 'United at Los Angeles (LAX)' },
  { href: '/hubs/nrt', label: 'United at Tokyo Narita (NRT)' },
  { href: '/hubs/gum', label: 'United at Guam (GUM)' },
];

/**
 * The crawlable site nav (15 links) — always in the DOM regardless of which tab or
 * popover the island has open, because the island renders nothing server-side.
 */
export const HOME_NAV_LINKS = [
  ...HUB_LINKS,
  { href: '/hubs', label: 'All United Airlines Hubs' },
  { href: '/fleet', label: 'United Airlines Fleet Database' },
  { href: '/news', label: 'The Blue Board News' },
  { href: '/trackers', label: 'The Blue Board Trackers' },
  { href: '/trackers/atc', label: 'FAA Paper Flight Strips Tracker (Modern Skies)' },
  { href: '/trackers/united-hubs', label: 'United Hub Construction Tracker' },
];

/** The `<noscript>` fallback: prose, the nine hub links, four resource links, byline. */
export const NOSCRIPT_LINKS = {
  heading: 'The Blue Board — United Airlines Flight Tracker & Live Status',
  intro:
    'Track every United Airlines flight in real time with The Blue Board — a free, independent '
    + 'operations dashboard built for United frequent flyers, 1K members, and AvGeeks. See live '
    + 'flight positions on an interactive map updated every 30 seconds. Check delays, '
    + `cancellations, and ground stops at ${HUB_LINE_LONG}. Look up any flight by number to see `
    + 'status, aircraft type, and route. Browse the full United fleet database of '
    + `${FLEET_COUNT_TEXT}+ aircraft and check which planes have Starlink WiFi. View departure `
    + 'and arrival schedules with on-time performance stats and equipment swap alerts. Monitor '
    + 'weather conditions with radar, METAR observations, and FAA NAS alerts. Explore fleet '
    + 'utilization, route analytics, and hub-to-hub traffic patterns.',
  hubsHeading: 'United Airlines Hub Status Pages',
  hubs: HUB_LINKS,
  resourcesHeading: 'More Resources',
  resources: [
    { href: '/fleet', label: `United Airlines Fleet Database (${FLEET_COUNT_TEXT} Aircraft)` },
    { href: '/hubs', label: 'All United Airlines Hubs' },
    { href: '/trackers/atc', label: 'Paper Flight Strips Tracker (FAA Modernization)' },
    { href: '/trackers/united-hubs', label: 'United Hub Construction Tracker' },
  ],
  bylineBefore: 'Built for the United community by ',
  bylineLink: { href: 'https://github.com/jonahberg', label: 'Jonah Berg' },
  bylineAfter:
    '. Not affiliated with United Airlines, Inc. JavaScript is required for the live dashboard.',
};

/**
 * "Boeing 737-800 (141), 737-900ER (136), … and Airbus A319 (76), A320 (68), A321neo (62)".
 *
 * Grouped by manufacturer so the name is written once per group, and within a group in
 * `fleetOrder` — the site's canonical display order — so the prose can never disagree with
 * the /fleet nav. Every count comes from the per-type file; nothing here is hand-typed.
 */
function fleetTypeBreakdown() {
  /** @type {Map<string, string[]>} */
  const byManufacturer = new Map();
  for (const slug of fleetOrder) {
    const type = fleetTypes[slug];
    const list = byManufacturer.get(type.manufacturer) ?? [];
    list.push(`${type.typeCode} (${type.count})`);
    byManufacturer.set(type.manufacturer, list);
  }
  const groups = [...byManufacturer].map(([maker, types]) => `${maker} ${types.join(', ')}`);
  return groups.length > 1
    ? `${groups.slice(0, -1).join('; ')}, and ${groups[groups.length - 1]}`
    : groups.join('');
}

/**
 * The sr-only fleet summary (inventory §33). It lived inside the Fleet tab panel in the old
 * markup; the island renders no tab panels server-side, so it moves onto the page itself.
 */
export const FLEET_SUMMARY = {
  label: 'United Airlines Fleet Summary',
  heading: `United Airlines Fleet Database — ${FLEET_COUNT_TEXT} Aircraft`,
  body:
    `Complete searchable database of all ${FLEET_COUNT_TEXT} United Airlines mainline aircraft `
    + `across ${fleetOrder.length} types: ${fleetTypeBreakdown()}. Includes registration, seat `
    + 'configuration, WiFi type, IFE system, delivery date, and operational status. '
    + `${STARLINK_EQUIPPED_LABEL} aircraft now equipped with free SpaceX Starlink satellite WiFi `
    + `(as of ${STARLINK_AS_OF}). Live fleet utilization updated every 30 seconds.`,
  linkHref: '/fleet',
  linkLabel: 'View full fleet database',
};

/**
 * The six JSON-LD blocks, in the order they shipped at the end of `<body>`:
 * Organization, WebPage, WebApplication, FAQPage, Dataset, WebSite.
 *
 * `tests/agent-readiness.test.js` pins the Organization `@id`, contactPoint, PostalAddress
 * and the WebSite SearchAction template — those values are load-bearing for the Aug 2026
 * "Is Agentic" audit and must not drift.
 *
 * @param {{lastmod: string}} options `lastmod` is the git-derived YYYY-MM-DD date from
 *   `getLastModified(homeLastmodPaths)`; it replaces the old `__HOME_LASTMOD__` placeholder
 *   that `scripts/stamp-seo-build-date.mjs` used to rewrite in `dist/index.html`.
 * @returns {Record<string, unknown>[]} six schema.org nodes.
 */
export function homeJsonLd({ lastmod }) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'The Blue Board',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/icons/icon-512.png`,
        width: 512,
        height: 512,
      },
      founder: { '@type': 'Person', name: 'Jonah Berg', url: 'https://github.com/jonahberg' },
      email: 'hello@theblueboard.co',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'hello@theblueboard.co',
        url: `${SITE_URL}/privacy`,
        availableLanguage: ['English'],
        areaServed: 'US',
      },
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Los Angeles',
        addressRegion: 'CA',
        addressCountry: 'US',
      },
      sameAs: [
        'https://x.com/theblueboard',
        'https://github.com/jonahberg/the-blue-board',
        'https://github.com/jonahberg',
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': `${SITE_URL}/#webpage`,
      url: SITE_URL,
      name: HOME_TITLE,
      description: HOME_DESCRIPTION,
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: { '@id': `${SITE_URL}/#organization` },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
      },
      dateModified: lastmod,
      inLanguage: 'en-US',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      '@id': `${SITE_URL}/#webapplication`,
      name: 'The Blue Board',
      alternateName: [
        'United Flight Tracker',
        'United Airlines Flight Tracker',
        'UA Flight Status',
        'UA Flight Tracker',
        'United Starlink Tracker',
        'United Airlines Operations Dashboard',
      ],
      description:
        'Independent United Airlines flight tracker with live flight status, hub delays, fleet '
        + 'data, Starlink coverage, schedules, weather, and operational analytics.',
      url: SITE_URL,
      applicationCategory: 'Transportation',
      applicationSubCategory: 'Flight Tracking Dashboard',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      creator: {
        '@type': 'Person',
        name: 'Jonah Berg',
        url: 'https://github.com/jonahberg',
        sameAs: ['https://x.com/theblueboard', 'https://github.com/jonahberg'],
      },
      publisher: { '@id': `${SITE_URL}/#organization` },
      isPartOf: { '@id': `${SITE_URL}/#website` },
      featureList: [
        'Real-time United Airlines flight tracking map with 600+ flights updated every 30 seconds',
        `Live delay and cancellation alerts for ${HUB_LINE_LONG}`,
        'Ground stop and FAA NAS status monitoring',
        'Departure and arrival schedules for ORD, DEN, IAH, EWR, SFO, IAD, LAX, NRT, GUM',
        'Equipment swap detection and alerts',
        'On-time performance statistics by hub',
        'Starlink WiFi aircraft checker — see if your plane has fast internet',
        `Full United Airlines fleet database with ${FLEET_COUNT_TEXT}+ aircraft, seat configs, and IFE details`,
        'NEXRAD weather radar overlay on live map',
        'METAR weather conditions for all hub airports',
        'Hub-to-hub traffic flow and route analytics',
        'Flight search by flight number, tail number, or route',
        'Flight watch with browser push notifications on status changes',
        'Dark operations center interface optimized for mobile and desktop',
      ],
      isAccessibleForFree: true,
      browserRequirements: 'Requires JavaScript',
      softwareVersion: '2.0',
      sameAs: ['https://x.com/theblueboard', 'https://github.com/jonahberg/the-blue-board'],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'How do I check if my United Airlines flight is on time?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'The Blue Board shows real-time status for every United Airlines flight. Use the '
              + 'search bar to look up your flight number (e.g., UA 1234) and see its current '
              + 'position, delays, and estimated arrival. The hub health bar at the top shows '
              + `at-a-glance delay conditions across ${HUB_LINE_LONG}.`,
          },
        },
        {
          '@type': 'Question',
          name: 'Which United Airlines planes have Starlink WiFi?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              `The Blue Board tracks ${STARLINK_EQUIPPED_LABEL} United Airlines aircraft equipped `
              + `with SpaceX Starlink satellite WiFi (as of ${STARLINK_AS_OF}), and the count is `
              + "climbing weekly toward United's goal of roughly 1,000 aircraft by the end of "
              + '2026. Starlink is free for MileagePlus members. Go to the Fleet tab and check '
              + 'the Starlink section to search by tail number, aircraft type, or fleet. You can '
              + 'also see WiFi status when looking up a specific flight.',
          },
        },
        {
          '@type': 'Question',
          name: 'Are there delays at United Airlines hubs today?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              "The Blue Board monitors delays, cancellations, and ground stops at United's 8 hubs "
              + "(Chicago O'Hare, Denver, Houston, Newark, San Francisco, Dulles, Los Angeles, "
              + 'and Guam) plus the Tokyo-Narita gateway in real time. The hub health bar shows '
              + 'on-time performance, and the IROPS monitor breaks down disruption types at each '
              + 'hub.',
          },
        },
        {
          '@type': 'Question',
          name: 'What is The Blue Board?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'The Blue Board is a free, independent real-time operations dashboard for United '
              + 'Airlines flights. It tracks every United flight on a live map, shows delays and '
              + 'cancellations at all hubs, provides fleet and aircraft data, weather conditions, '
              + 'and operational analytics. Built for the United community — not affiliated with '
              + 'United Airlines, Inc.',
          },
        },
        {
          '@type': 'Question',
          name: 'How do I track a United Airlines flight?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              "Use The Blue Board's free United flight tracker at theblueboard.co. Enter any UA "
              + 'flight number (e.g., UA 875, UA 1234) in the search bar to see its live '
              + 'position, altitude, speed, route, delay status, and aircraft details. The map '
              + 'updates every 30 seconds with all 600+ United flights in the air.',
          },
        },
        {
          '@type': 'Question',
          name: 'How do I check the status of a United Airlines flight by flight number?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Go to theblueboard.co and enter your United flight number (e.g., UA 1682, UA 354) '
              + "in the search bar. You'll see the flight's real-time position on the map, "
              + 'current delay status, estimated arrival time, aircraft type, and whether the '
              + 'plane has Starlink WiFi. You can also visit theblueboard.co/?flight=UA1682 to go '
              + 'directly to any flight.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is United Airlines delayed today?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              "The Blue Board shows real-time delay conditions across United's 8 hubs plus the "
              + 'Tokyo-Narita gateway. The hub health bar at the top of the dashboard displays '
              + 'on-time performance percentages and cancellation rates for ORD, DEN, IAH, EWR, '
              + 'SFO, IAD, LAX, NRT, and GUM. Tap any hub to see its full schedule with delay '
              + 'counts, ground stops, and weather conditions affecting operations.',
          },
        },
        {
          '@type': 'Question',
          name: 'How does The Blue Board predict flight delays?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'The Blue Board uses AI-powered delay prediction that analyzes 8 real-time signals '
              + 'including inbound aircraft delays, turnaround time pressure, hub congestion, '
              + 'weather conditions, and FAA ground stops. Each flight gets a delay risk score '
              + 'from 0 to 100, with a plain-language explanation of contributing factors. This '
              + "helps you anticipate delays before they're officially announced.",
          },
        },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: 'United Airlines Live Flight & Fleet Data',
      description:
        'Real-time dataset of United Airlines flight positions, delays, cancellations, on-time '
        + `performance across ${HUB_LINE_LONG}, and fleet information including `
        + `${FLEET_COUNT_TEXT}+ aircraft with Starlink WiFi status, seat configurations, and `
        + 'equipment details. Updated every 30 seconds.',
      url: SITE_URL,
      license: SITE_URL,
      creator: { '@type': 'Person', name: 'Jonah Berg', url: 'https://github.com/jonahberg' },
      dateModified: lastmod,
      keywords: [
        'United Airlines',
        'flight tracking',
        'flight delays',
        'on-time performance',
        'Starlink WiFi',
        'fleet data',
        'aviation',
        'airline operations',
      ],
      temporalCoverage: '2025/..',
      spatialCoverage: { '@type': 'Place', name: 'United States' },
      variableMeasured: [
        {
          '@type': 'PropertyValue',
          name: 'Flight Status',
          description:
            'Real-time position, delay, and cancellation status for every United Airlines flight',
        },
        {
          '@type': 'PropertyValue',
          name: 'Hub On-Time Performance',
          description: 'On-time percentage for ORD, DEN, IAH, EWR, SFO, IAD, LAX, NRT, GUM',
        },
        {
          '@type': 'PropertyValue',
          name: 'Starlink WiFi Equipment',
          description: 'Aircraft equipped with Starlink satellite internet by tail number',
        },
        {
          '@type': 'PropertyValue',
          name: 'Fleet Composition',
          description: 'Aircraft type, seat configuration, IFE, and equipment details',
        },
      ],
      distribution: {
        '@type': 'DataDownload',
        encodingFormat: 'text/html',
        contentUrl: SITE_URL,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'The Blue Board',
      alternateName: ['United Flight Tracker', 'UA Flight Tracker'],
      url: SITE_URL,
      description:
        'Independent United Airlines flight tracker with live status, hub delays, fleet data, '
        + 'Starlink coverage, schedules, and weather.',
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'en-US',
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/?flight={flight_number}`,
        },
        'query-input': 'required name=flight_number',
      },
    },
  ];
}
