import { STARLINK_EQUIPPED_LABEL, STARLINK_AS_OF, STARLINK_FLEET_SHARE_PCT } from '../starlink-facts.js';

export const iah = {
  "iata": "IAH",
  "variant": "full",
  "title": "United Houston Hub Delays & On-Time",
  "description": "Live United delays, cancellations and on-time performance at Houston Intercontinental (IAH), United's Latin America gateway, with delay-risk scores.",
  "keywords": "United Airlines IAH delays, United Houston hub status, United Airlines IAH on-time, United IAH cancellations today, United Airlines Houston delays, IAH flight status, United hub Houston, United Airlines Houston departures",
  "ogTitle": "United Houston (IAH) Hub — Live Delays & On-Time",
  "ogDescription": "Real-time United Airlines operations at Houston Intercontinental. Delay-risk scores, cancellations, on-time %, Starlink WiFi fleet, and schedules.",
  "ogImageAlt": "The Blue Board — United Airlines IAH Hub Status",
  "twitterTitle": "United Houston (IAH) Hub — Live Delays & On-Time",
  "twitterDescription": "Delay-risk scores, cancellations, on-time performance at United's Latin America gateway. Plus the next departures.",
  "breadcrumbName": "IAH — Houston",
  "faqSchema": [
    {
      "question": "Is United Airlines delayed at IAH today?",
      "answer": "The Blue Board tracks every United Airlines flight at Houston Intercontinental in real time. The departures board near the top of this page lists the next United departures with their delays, plus today's on-time share and cancellations, and says what time its data is from. For flight-level detail, open IAH on The Blue Board, where the live map updates every 30 seconds."
    },
    {
      "question": "What terminal is United Airlines at Houston IAH?",
      "answer": "United Airlines uses three terminals at George Bush Intercontinental Airport: Terminal B for United Express regional flights plus mainline flights at the new 22-gate Terminal B North Concourse (opened October 22, 2026), Terminal C for mainline domestic flights, and Terminal E for domestic plus international flights (the United Polaris lounge is in Terminal E near gate E12). United Club lounges are located across these terminals — including the new 54,000 sq ft club in Terminal B North near gate B11 — and the Subway people mover connects all terminals. Note: the Terminal B check-in lobby is still closed during the Terminal B Transformation, so Terminal B passengers check in at Terminal C."
    },
    {
      "question": "How many United flights depart from IAH daily?",
      "answer": "United Airlines operates about 500 daily departures from Houston, according to United (October 2026), making Houston Intercontinental United's primary gateway to Latin America and one of its largest hubs by geographic footprint."
    },
    {
      "question": "Which United planes at IAH have Starlink WiFi?",
      "answer": `United's Starlink WiFi is free for all MileagePlus members, gate-to-gate. As of ${STARLINK_AS_OF}, ${STARLINK_EQUIPPED_LABEL} United aircraft are equipped (about ${STARLINK_FLEET_SHARE_PCT}% of the combined fleet). United Express regional jets led the rollout — Embraer 175s first, starting May 2025 — and over half the regional fleet is now equipped. The first mainline Starlink aircraft was a Boeing 737-800, whose first flight on Oct 15, 2025 was EWR→IAH; mainline narrowbody (737, A321neo) installs are ramping through 2026, and the first widebody (777) entered transatlantic service on June 22, 2026; United expects Starlink on about 61% of its flights by the end of 2026 and fleet-wide by the end of 2027. IAH sees both narrowbody and widebody aircraft — check your specific tail number on The Blue Board's Fleet tab to see if your aircraft has Starlink.`
    },
    {
      "question": "What causes the most delays at IAH for United?",
      "answer": "Houston's subtropical climate makes thunderstorms the dominant delay driver, particularly during summer months (May–September). Tropical systems and hurricanes can disrupt operations for days. IAH's five runways provide capacity, but convective weather along the Gulf Coast frequently triggers ground delay programs and ground stops. The Blue Board's rule-based delay risk score factors in weather, FAA programs, hub performance, and inbound aircraft to predict delays in real time, with an AI-written explanation of what is driving it."
    }
  ],
  "airportSchema": {
    "name": "George Bush Intercontinental Airport",
    "iataCode": "IAH",
    "addressLocality": "Houston",
    "addressRegion": "TX",
    "addressCountry": "US",
    "latitude": 29.9902,
    "longitude": -95.3368,
    "url": "https://www.fly2houston.com/iah"
  },
  "headerTitle": "United Airlines at <span class=\"iata\">IAH</span> — Houston Intercontinental",
  "subtitle": "United's Latin America gateway · ~500 daily departures · Terminals B, C & E",
  "jumpNav": [
    {
      "href": "#overview",
      "label": "Overview"
    },
    {
      "href": "#delay-patterns",
      "label": "Delay Patterns"
    },
    {
      "href": "#starlink",
      "label": "Starlink WiFi"
    },
    {
      "href": "#construction",
      "label": "Construction"
    },
    {
      "href": "#faq",
      "label": "FAQ"
    },
    {
      "href": "#all-hubs",
      "label": "All Hubs"
    }
  ],
  "contentHtml": `\n  <!-- Dive Deep -->\n  <div class=\"section\">\n    <h2>Dive Deep at The Blue Board</h2>\n    <p><strong>The Blue Board</strong> is the only real-time operations dashboard built specifically for United Airlines passengers. Live flight tracking, delay risk scores with AI-written explanations, inbound aircraft tracking, Starlink WiFi status, and IROPS monitoring, updated in real-time.</p>\n    <p>This page gives you the overview — but the real action is on the dashboard. Track every United flight at IAH in real time, set up flight watch alerts, check equipment swaps, and monitor weather radar overlaid on the live map.</p>\n    <div style=\"display:flex;flex-wrap:wrap;gap:10px;margin-top:12px\">\n      <a class=\"cta\" href=\"/?hub=iah\" style=\"margin:0\">🗺️ Live IAH Map</a>\n      <a class=\"cta\" href=\"/?tab=schedule&hub=iah\" style=\"margin:0\">📋 IAH Schedules</a>\n      <a class=\"cta\" href=\"/?tab=fleet&filter=starlink\" style=\"margin:0\">📡 Starlink Fleet</a>\n      <a class=\"cta\" href=\"/?tab=irops&hub=iah\" style=\"margin:0\">⚠️ IROPS Monitor</a>\n    </div>\n  </div>\n\n  <!-- Hub Overview -->\n  <div class=\"section\">\n    <h2 id=\"overview\">Hub Overview</h2>\n    <p>George Bush Intercontinental Airport is <strong>United Airlines' primary gateway to Latin America</strong> and one of its largest hubs by geographic footprint. With about 500 daily departures (United's October 2026 figure), IAH connects to about 165 nonstop destinations across the Americas, Europe, and beyond.</p>\n    <p>United uses three terminals, connected by the Subway automated people mover (formerly TerminaLink): <strong>Terminal B</strong> for United Express regional flights plus mainline flights at the new North Concourse, <strong>Terminal C</strong> for mainline domestic flights, and <strong>Terminal E</strong> for domestic and international flights, including the United Polaris lounge near gate E12 for premium international travelers. United Club lounges are located across these terminals, including United's largest club anywhere: 54,000 sq ft and 800 seats in Terminal B North, near gate B11.</p>\n\n    <div class=\"highlight-box\">\n      <strong>IAH by the numbers:</strong> ~500 daily departures · ~165 destinations · Terminals B, C & E · 5 runways · United's #1 Latin America hub · Largest hub campus by area (11,000+ acres)\n    </div>\n\n\n    <div class=\"highlight-box highlight-warn\">\n      <span id=\"construction\"></span><strong>⚠️ Construction Alert:</strong> The <strong>$1.4B+ Mickey Leland International Terminal (MLIT)</strong> redevelopment is essentially complete (wrapped up in early 2026) — it is now IAH's international terminal. The active project on the ground is the <strong>Terminal B Transformation</strong>: its new 22-gate North Concourse <strong>opened October 22, 2026</strong>, along with United's largest club anywhere (54,000 sq ft, 800 seats). United is bringing the North Concourse gates into service in stages through the end of 2026, and work continues on the rest of Terminal B. <strong>The Terminal B check-in lobby is still closed — Terminal B passengers check in at Terminal C</strong>, so allow extra time. Check <a href=\"https://www.fly2houston.com/iah\" target=\"_blank\" rel=\"noopener noreferrer\">Houston Airports</a> for the latest.\n    </div>\n\n    <h3>Key Routes from IAH</h3>\n    <ul>\n      <li><strong>Domestic:</strong> ORD, DEN, SFO, LAX, EWR, IAD — all major United hub connections plus extensive Texas/Gulf Coast network</li>\n      <li><strong>Latin America:</strong> MEX, GDL, CUN, BOG, LIM, GRU, EZE (paused Oct 24–Nov 10, 2026 for runway work at Buenos Aires), PTY, SJO, SAL, GUA, plus SCL (seasonal) and new Tuxtla Gutiérrez (TGZ), with Cartagena (CTG) starting in December 2026 — the most extensive Latin American network of any U.S. carrier</li>\n      <li><strong>Transatlantic:</strong> LHR, FRA, AMS</li>\n      <li><strong>Pacific:</strong> NRT, plus seasonal nonstop SYD (back daily since Oct 24, 2026)</li>\n    </ul>\n  </div>\n\n  <!-- Delay Patterns -->\n  <div class=\"section\">\n    <h2 id=\"delay-patterns\">Delay Patterns at IAH</h2>\n    <p>Houston's Gulf Coast location means weather is the dominant factor in IAH delays. Understanding seasonal patterns helps set expectations:</p>\n\n    <h3>Summer (May–Sep)</h3>\n    <p>Intense afternoon thunderstorms are nearly daily occurrences in Houston. Convective cells build quickly, producing heavy rain, lightning, and occasional hail. Ground stops and ground delay programs are common between 2–8 PM. The extended summer storm season (May through September) is IAH's most challenging period.</p>\n\n    <h3>Hurricane Season (Jun–Nov)</h3>\n    <p>Tropical storms and hurricanes in the Gulf of Mexico can shut down IAH operations for days. Even distant tropical systems can produce sustained rain bands and wind that reduce capacity. Hurricane preparations may trigger preemptive cancellations 24–48 hours before landfall.</p>\n\n    <h3>Winter (Dec–Feb)</h3>\n    <p>Rare ice storms and freezing rain events can paralyze operations, as IAH has limited de-icing infrastructure compared to northern hubs. Fog is also common in winter mornings along the Gulf Coast.</p>\n\n    <div class=\"highlight-box\">\n      <strong>Tip:</strong> Morning departures (before 11 AM) have the best on-time performance at IAH. Summer thunderstorms build in the afternoon, so early flights consistently outperform evening departures.\n    </div>\n  </div>\n\n  <!-- Starlink -->\n  <div class=\"section\">\n    <h2 id=\"starlink\">Starlink WiFi at IAH</h2>\n    <p>United Airlines is equipping its fleet with <strong>Starlink satellite internet</strong> — the fastest WiFi ever offered on a commercial airline, and <strong>free for all MileagePlus members, gate-to-gate</strong>. As of ${STARLINK_AS_OF}, ${STARLINK_EQUIPPED_LABEL} United aircraft are equipped (about ${STARLINK_FLEET_SHARE_PCT}% of the combined fleet). United Express regional jets led the rollout — Embraer 175s first, starting May 2025 — and over half the regional fleet is now equipped.</p>\n    <p>IAH has a special place in the mainline rollout: the first mainline Starlink aircraft, a Boeing 737-800, flew its first Starlink service <strong>EWR→IAH on Oct 15, 2025</strong>. Narrowbody installs (737, A321neo) are ramping through 2026, and the first widebody (777) entered transatlantic service on June 22, 2026 — relevant for IAH's mix of narrowbody and widebody flying. The entire widebody fleet is expected by summer 2027; United expects Starlink on about 61% of its flights by the end of 2026 and fleet-wide by the end of 2027.</p>\n    <p>Use <a href=\"/?tab=fleet&filter=starlink\">The Blue Board's Fleet tab</a> to check if your specific aircraft has Starlink. You can search by tail number, flight number, or aircraft type.</p>\n\n    <div class=\"highlight-box\">\n      <strong>How to check:</strong> Look up your flight on The Blue Board → check the aircraft details panel → look for \"Starlink\" in the WiFi field. Equipped aircraft show <span class=\"starlink-on\">● Starlink</span>.\n    </div>\n  </div>\n\n  <!-- FAQ (visible, matches schema) -->\n  <div class=\"section\">\n    <h2 id=\"faq\">Frequently Asked Questions</h2>\n\n    <h3>Is United Airlines delayed at IAH today?</h3>\n    <p>Check the departures board near the top of this page for the next United departures with their delays, plus today's on-time share and cancellations; it says what time its data is from. For flight-level detail, <a href=\"/?hub=iah\">open IAH on The Blue Board</a> to see every flight in real time.</p>\n\n    <h3>What terminal is United at Houston?</h3>\n    <p>United uses three terminals: Terminal B for United Express regional flights plus mainline flights at the new North Concourse (opened October 22, 2026), Terminal C for mainline domestic flights, and Terminal E for domestic and international flights (the United Polaris lounge is in Terminal E near gate E12). The Subway people mover connects all terminals. Note: the Terminal B check-in lobby is still closed during the Terminal B Transformation, so Terminal B passengers check in at Terminal C — allow extra time.</p>\n\n    <h3>How many United flights depart from IAH daily?</h3>\n    <p>About 500 daily departures from Houston, according to United (October 2026), making IAH United's primary Latin American gateway and one of its largest hubs by geographic footprint.</p>\n\n    <h3>Which United planes at IAH have Starlink WiFi?</h3>\n    <p>Starlink is free for all MileagePlus members, gate-to-gate. As of ${STARLINK_AS_OF}, ${STARLINK_EQUIPPED_LABEL} United aircraft are equipped (~${STARLINK_FLEET_SHARE_PCT}% of the combined fleet) — United Express regional jets led the rollout (Embraer 175s first, from May 2025), and mainline installs are ramping through 2026 (the first mainline Starlink flight was EWR→IAH on Oct 15, 2025) — United expects Starlink on about 61% of its flights by year-end and fleet-wide by the end of 2027. Check <a href=\"/?tab=fleet&filter=starlink\">the Fleet tab</a> for the latest count and specific tail numbers.</p>\n  </div>`
};
