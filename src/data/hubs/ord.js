import { STARLINK_EQUIPPED_LABEL, STARLINK_AS_OF } from '../facts.js';

export const ord = {
  "iata": "ORD",
  "variant": "full",
  "title": "United Airlines ORD Hub Status — Chicago O'Hare Delays, On-Time Performance & Flight Tracker",
  "description": "Live United Airlines status at Chicago O'Hare (ORD). AI-powered delay risk predictions, real-time delays, cancellations, on-time performance, Starlink WiFi aircraft, and departure schedules. United's largest hub — updated every 30 seconds.",
  "keywords": "United Airlines ORD delays, United Chicago O'Hare hub status, United Airlines ORD on-time, United ORD cancellations today, United Airlines Chicago delays, ORD flight status, United hub Chicago, United Airlines O'Hare departures",
  "ogTitle": "United Airlines ORD Hub — Live Chicago O'Hare Status",
  "ogDescription": "Real-time United Airlines operations at Chicago O'Hare. AI delay predictions, cancellations, on-time %, Starlink WiFi fleet, and schedules.",
  "ogImageAlt": "The Blue Board — United Airlines ORD Hub Status",
  "twitterTitle": "United Airlines ORD Hub — Live Chicago O'Hare Status",
  "twitterDescription": "AI delay predictions, cancellations, on-time performance at United's largest hub. Updated every 30 seconds.",
  "breadcrumbName": "ORD — Chicago O'Hare",
  "faqSchema": [
    {
      "question": "Is United Airlines delayed at ORD today?",
      "answer": "The Blue Board tracks every United Airlines flight at Chicago O'Hare in real time. Check the live status panel above for current delay counts, cancellations, and on-time performance. The dashboard updates every 30 seconds with data from Flightradar24 and FAA sources."
    },
    {
      "question": "What terminal is United Airlines at O'Hare?",
      "answer": "United Airlines operates primarily out of Terminal 1 (Concourses B and C) at Chicago O'Hare International Airport. United Club lounges are located in both concourses. United Express regional flights also depart from Terminal 2 (Concourse E and F)."
    },
    {
      "question": "How many United flights depart from ORD daily?",
      "answer": "United Airlines operates up to ~750 daily departures from Chicago O'Hare at summer peak (annual average closer to ~686/day), making it United's largest hub by flight volume. ORD connects to over 200 domestic and international destinations. Note: FAA peak-season caps forced United to trim roughly 9,000 departures (~7.6%) from its summer 2026 O'Hare schedule."
    },
    {
      "question": "Which United planes at ORD have Starlink WiFi?",
      "answer": `United's Starlink WiFi is free for all MileagePlus members, gate-to-gate. As of ${STARLINK_AS_OF}, ${STARLINK_EQUIPPED_LABEL} United aircraft are equipped (about 24% of the combined fleet). United Express regional jets led the rollout — Embraer 175s first, starting May 2025 — and over half the regional fleet is now equipped, so many ORD Express flights already have it. Mainline narrowbody installs (737, A321neo) are ramping through 2026, with a goal of roughly 1,000 equipped aircraft by the end of 2026. Check your specific tail number on The Blue Board's Fleet tab to see if your aircraft has Starlink.`
    },
    {
      "question": "What causes the most delays at ORD for United?",
      "answer": "Chicago O'Hare is susceptible to weather-related delays year-round — thunderstorms and wind shear in summer, snow and ice in winter. ORD's parallel runway configuration can reduce capacity in low-visibility conditions. Ground delay programs (GDPs) and ground stops issued by the FAA are common during severe weather, and ripple effects from East Coast congestion (especially EWR and JFK) frequently impact ORD operations. The Blue Board's AI-powered delay risk engine analyzes 8 signals including weather, FAA programs, hub on-time performance, and inbound aircraft position to predict delays before they happen."
    }
  ],
  "airportSchema": {
    "name": "Chicago O'Hare International Airport",
    "iataCode": "ORD",
    "addressLocality": "Chicago",
    "addressRegion": "IL",
    "addressCountry": "US",
    "latitude": 41.9742,
    "longitude": -87.9073,
    "url": "https://www.flychicago.com/ohare"
  },
  "headerTitle": "United Airlines at <span class=\"iata\">ORD</span> — Chicago O'Hare",
  "subtitle": "United's largest hub · up to ~750 daily departures at summer peak · Terminal 1 (B & C) · Terminal 2 (Express)",
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
  "contentHtml": `\n  <!-- Dive Deep -->\n  <div class=\"section\">\n    <h2>Dive Deep at The Blue Board</h2>\n    <p><strong>The Blue Board</strong> is the only real-time operations dashboard built specifically for United Airlines passengers. Live flight tracking, AI-powered delay risk predictions, inbound aircraft tracking, Starlink WiFi status, and IROPS monitoring, updated in real-time.</p>\n    <p>This page gives you the overview — but the real action is on the dashboard. Track every United flight at ORD in real time, set up flight watch alerts, check equipment swaps, and monitor weather radar overlaid on the live map.</p>\n    <div style=\"display:flex;flex-wrap:wrap;gap:10px;margin-top:12px\">\n      <a class=\"cta\" href=\"/?hub=ord\" style=\"margin:0\">🗺️ Live ORD Map</a>\n      <a class=\"cta\" href=\"/?tab=schedule&hub=ord\" style=\"margin:0\">📋 ORD Schedules</a>\n      <a class=\"cta\" href=\"/?tab=fleet&filter=starlink\" style=\"margin:0\">📡 Starlink Fleet</a>\n      <a class=\"cta\" href=\"/?tab=irops&hub=ord\" style=\"margin:0\">⚠️ IROPS Monitor</a>\n    </div>\n  </div>\n\n  <!-- Hub Overview -->\n  <div class=\"section\">\n    <h2 id=\"overview\">Hub Overview</h2>\n    <p>Chicago O'Hare International Airport is <strong>United Airlines' largest hub</strong> and the backbone of its domestic network. With up to ~750 daily departures at summer peak (annual average closer to ~686/day), ORD connects to over 200 destinations across the United States, Canada, Europe, Asia, and Latin America.</p>\n    <p>United operates primarily from <strong>Terminal 1</strong>, occupying Concourses B and C, with United Club lounges in both concourses (Concourse B mezzanine near B6, Concourse C near C16) and a <strong>United Polaris lounge</strong> in Terminal 1, Concourse C near gate C18 (reopened in 2024 after a renovation that made it roughly 50% larger) for premium international travelers. United Express regional partners (Air Wisconsin, GoJet, Mesa, Republic, SkyWest) operate from Terminal 2, Concourses E and F.</p>\n\n    <div class=\"highlight-box\">\n      <strong>ORD by the numbers:</strong> up to ~750 daily departures at summer peak (annual avg ~686/day) · 200+ destinations · 2 terminals · 8 runways (most in the world) · Chicago hub since 1927 (originally Midway); O'Hare operations began ~1955 · United's global headquarters\n    </div>\n\n\n    <div class=\"highlight-box\" style=\"border-left-color:var(--ua-yellow)\">\n      <span id=\"construction\"></span><strong>⚠️ Construction Alert:</strong> The <a href=\"https://www.flychicago.com/ohare21\" target=\"_blank\" rel=\"noopener noreferrer\">O'Hare 21</a> program (budget ~$8.5B) is actively under construction. Satellite Concourse 1 — an extension of Concourse C — is targeted for around 2028, while the new O'Hare Global Terminal that replaces Terminal 2 is targeted for around 2032, with the full program wrapping up around 2034. Terminal 2 demolition begins in 2026, so expect near-term impacts on ground transportation and terminal access.\n    </div>\n\n    <h3>Key Routes from ORD</h3>\n    <ul>\n      <li><strong>Domestic:</strong> SFO, LAX, DEN, EWR, IAD, IAH — all major United hub connections</li>\n      <li><strong>Transatlantic:</strong> LHR, FRA, CDG, MUC, FCO, DUB, ZRH</li>\n      <li><strong>Pacific:</strong> NRT, HND, ICN, DEL — nonstop widebody service</li>\n      <li><strong>Latin America:</strong> CUN, GDL, SJD, PTY</li>\n      <li><strong>Pacific:</strong> NRT, HND, ICN, PVG (seasonal adjustments apply)</li>\n    </ul>\n  </div>\n\n  <!-- Delay Patterns -->\n  <div class=\"section\">\n    <h2 id=\"delay-patterns\">Delay Patterns at ORD</h2>\n    <p>O'Hare is one of the most delay-prone airports in the United States due to its geography and traffic volume. Understanding typical disruption patterns helps set expectations:</p>\n\n    <h3>Summer (Jun–Aug)</h3>\n    <p>Thunderstorms and convective weather are the primary driver of delays. Ground delay programs (GDPs) and ground stops can cascade across the network. Afternoon and evening departures are most affected. FAA peak-season caps also forced United to trim roughly 9,000 departures (~7.6%) from its summer 2026 O'Hare schedule — thinning the peak-hour bank should ease some congestion, but a canceled-in-advance flight is still a flight you can't take.</p>\n\n    <h3>Winter (Dec–Feb)</h3>\n    <p>Snow, ice, and low-visibility conditions reduce runway capacity. De-icing operations add 15–30 minutes to departure times. ORD's parallel runway configuration is particularly sensitive to crosswinds during winter storms.</p>\n\n    <h3>Year-Round</h3>\n    <p>East Coast congestion — especially at Newark (EWR) and JFK — frequently ripples westward, causing inbound delays at ORD. Late-evening flights are often affected by cumulative delays from earlier in the day.</p>\n\n    <div class=\"highlight-box\">\n      <strong>Tip:</strong> Morning departures (before 10 AM) consistently have the best on-time performance at ORD. If you have flexibility, book early.\n    </div>\n  </div>\n\n  <!-- Starlink -->\n  <div class=\"section\">\n    <h2 id=\"starlink\">Starlink WiFi at ORD</h2>\n    <p>United Airlines is equipping its fleet with <strong>Starlink satellite internet</strong> — the fastest WiFi ever offered on a commercial airline, and <strong>free for all MileagePlus members, gate-to-gate</strong>. As of ${STARLINK_AS_OF}, ${STARLINK_EQUIPPED_LABEL} United aircraft are equipped (about 24% of the combined fleet). United Express regional jets led the rollout — Embraer 175s first, starting May 2025 — and over half the regional fleet is now equipped, so many ORD-based Express flights already have it.</p>\n    <p>Mainline is catching up fast: the first mainline Starlink aircraft was a Boeing 737-800 (first flight Oct 15, 2025, EWR→IAH), and narrowbody installs (737, A321neo) are ramping through 2026. The first widebody (777) entered transatlantic service on June 22, 2026, with the entire widebody fleet expected by summer 2027 and a goal of roughly 1,000 equipped aircraft by the end of 2026.</p>\n    <p>Use <a href=\"/?tab=fleet&filter=starlink\">The Blue Board's Fleet tab</a> to check if your specific aircraft has Starlink. You can search by tail number, flight number, or aircraft type.</p>\n\n    <div class=\"highlight-box\">\n      <strong>How to check:</strong> Look up your flight on The Blue Board → check the aircraft details panel → look for \"Starlink\" in the WiFi field. Equipped aircraft show <span style=\"color:var(--ua-green)\">● Starlink</span>.\n    </div>\n  </div>\n\n  <!-- FAQ (visible, matches schema) -->\n  <div class=\"section\">\n    <h2 id=\"faq\">Frequently Asked Questions</h2>\n\n    <h3>Is United Airlines delayed at ORD today?</h3>\n    <p>Check the live status panel at the top of this page for current on-time performance, delay counts, and cancellations. For flight-level detail, <a href=\"/?hub=ord\">open ORD on The Blue Board</a> to see every flight in real time.</p>\n\n    <h3>What terminal is United at O'Hare?</h3>\n    <p>United mainline flights operate from Terminal 1 (Concourses B and C). United Express regional flights use Terminal 2 (Concourses E and F). Both terminals have United Club lounges and are connected airside via the underground tunnel.</p>\n\n    <h3>How many United flights depart from ORD daily?</h3>\n    <p>Up to ~750 daily departures at summer peak (annual average closer to ~686/day), making ORD United's busiest hub by flight volume — ahead of Denver (DEN) and Houston (IAH). FAA peak-season caps trimmed roughly 9,000 departures (~7.6%) from United's summer 2026 O'Hare schedule.</p>\n\n    <h3>Which United planes at ORD have Starlink WiFi?</h3>\n    <p>Starlink is free for all MileagePlus members, gate-to-gate. As of ${STARLINK_AS_OF}, ${STARLINK_EQUIPPED_LABEL} United aircraft are equipped (~24% of the fleet) — United Express regional jets led the rollout (Embraer 175s first, from May 2025), and mainline narrowbody installs (737, A321neo) are ramping through 2026 toward a goal of ~1,000 aircraft by year-end. Check <a href=\"/?tab=fleet&filter=starlink\">the Fleet tab</a> for the latest count and specific tail numbers.</p>\n  </div>`
};
