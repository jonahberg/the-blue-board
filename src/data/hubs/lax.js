import { STARLINK_EQUIPPED_LABEL, STARLINK_AS_OF } from '../facts.js';

export const lax = {
  "iata": "LAX",
  "variant": "full",
  "title": "United Airlines LAX Status — Los Angeles Delays, On-Time Performance & Flight Tracker",
  "description": "Live United Airlines status at Los Angeles International (LAX). AI-powered delay risk predictions, real-time delays, cancellations, on-time performance, Starlink WiFi aircraft, and departure schedules. United's Pacific gateway hub — updated every 30 seconds.",
  "keywords": "United Airlines LAX delays, United Los Angeles status, United Airlines LAX on-time, United LAX cancellations today, United Airlines Los Angeles delays, LAX flight status, United LAX, United Airlines LAX departures",
  "ogTitle": "United Airlines LAX — Live Los Angeles International Status",
  "ogDescription": "Real-time United Airlines operations at Los Angeles International. AI delay predictions, cancellations, on-time %, Starlink WiFi fleet, and schedules.",
  "ogImageAlt": "The Blue Board — United Airlines LAX Hub Status",
  "twitterTitle": "United Airlines LAX — Live Los Angeles International Status",
  "twitterDescription": "AI delay predictions, cancellations, on-time performance at United's Pacific gateway. Updated every 30 seconds.",
  "breadcrumbName": "LAX — Los Angeles",
  "faqSchema": [
    {
      "question": "Is United Airlines delayed at LAX today?",
      "answer": "The Blue Board tracks every United Airlines flight at Los Angeles International in real time. Check the live status panel above for current delay counts, cancellations, and on-time performance. The dashboard updates every 30 seconds with data from Flightradar24 and FAA sources."
    },
    {
      "question": "What terminal is United Airlines at LAX?",
      "answer": "United Airlines operates from Terminals 7 and 8 at Los Angeles International Airport. Terminal 7 handles most domestic flights, while Terminal 8 serves additional domestic and some international departures. United Club lounges are located in both terminals. United Express regional flights also depart from Terminals 7 and 8."
    },
    {
      "question": "How many United flights depart from LAX daily?",
      "answer": "United Airlines operates approximately 200 daily departures from Los Angeles International. LAX is United's smallest mainland hub and a key Pacific gateway, connecting to destinations across the U.S., Asia, Australia, and the Pacific Islands."
    },
    {
      "question": "Which United planes at LAX have Starlink WiFi?",
      "answer": `Starlink satellite WiFi is free for all MileagePlus members, gate to gate. ${STARLINK_EQUIPPED_LABEL} United aircraft were equipped as of ${STARLINK_AS_OF} (about 24% of the combined fleet). The rollout began with United Express regional jets — Embraer 175s from May 2025 — and over half the regional fleet is now equipped; the first mainline Starlink aircraft (a Boeing 737-800) entered service in October 2025 and the first widebody in June 2026, with the full widebody fleet — the aircraft on LAX's transpacific routes — expected by summer 2027. Check The Blue Board's Fleet tab to see whether your specific tail number is equipped.`
    },
    {
      "question": "What causes the most delays at LAX for United?",
      "answer": "LAX delays are most commonly caused by morning marine layer fog (May Gray / June Gloom) that can reduce visibility and require instrument approaches, reducing runway throughput. LAX's complex airspace shared with nearby airports (BUR, SNA, LGB, ONT) creates congestion. Late-night construction on taxiways and runways can also cause delays during early morning hours. The Blue Board's AI delay risk engine factors in weather, FAA programs, hub performance, and inbound aircraft to predict delays in real time."
    }
  ],
  "airportSchema": {
    "name": "Los Angeles International Airport",
    "iataCode": "LAX",
    "addressLocality": "Los Angeles",
    "addressRegion": "CA",
    "addressCountry": "US",
    "latitude": 33.9425,
    "longitude": -118.4081,
    "url": "https://www.flylax.com"
  },
  "headerTitle": "United Airlines at <span class=\"iata\">LAX</span> — Los Angeles International",
  "subtitle": "United's Pacific gateway hub · ~200 daily departures · Terminals 7 & 8",
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
  "contentHtml": `\n  <!-- Dive Deep -->\n  <div class=\"section\">\n    <h2>Dive Deep at The Blue Board</h2>\n    <p><strong>The Blue Board</strong> is the only real-time operations dashboard built specifically for United Airlines passengers. Live flight tracking, AI-powered delay risk predictions, inbound aircraft tracking, Starlink WiFi status, and IROPS monitoring, updated in real-time.</p>\n    <p>This page gives you the overview — but the real action is on the dashboard. Track every United flight at LAX in real time, set up flight watch alerts, check equipment swaps, and monitor weather radar overlaid on the live map.</p>\n    <div style=\"display:flex;flex-wrap:wrap;gap:10px;margin-top:12px\">\n      <a class=\"cta\" href=\"/?hub=lax\" style=\"margin:0\">🗺️ Live LAX Map</a>\n      <a class=\"cta\" href=\"/?tab=schedule&hub=lax\" style=\"margin:0\">📋 LAX Schedules</a>\n      <a class=\"cta\" href=\"/?tab=fleet&filter=starlink\" style=\"margin:0\">📡 Starlink Fleet</a>\n      <a class=\"cta\" href=\"/?tab=irops&hub=lax\" style=\"margin:0\">⚠️ IROPS Monitor</a>\n    </div>\n  </div>\n\n  <!-- Hub Overview -->\n  <div class=\"section\">\n    <h2 id=\"overview\">Hub Overview</h2>\n    <p>Los Angeles International Airport is <strong>United Airlines' smallest mainland hub</strong> and a key Pacific gateway on the West Coast. With approximately 200 daily departures, LAX connects to destinations across the U.S., Asia, Australia, and the Pacific Islands, and is critical for United's transcontinental and transpacific operations.</p>\n    <p>United operates from <strong>Terminals 7 and 8</strong>, located on the south side of the LAX horseshoe. Terminal 7 handles the majority of domestic flights, while Terminal 8 serves additional domestic routes and some international departures. United Club lounges are available in both terminals (Terminal 7 near gate 71, Terminal 8 near gate 80s), plus a <strong>United Polaris lounge</strong> in Terminal 7, between gates 73 and 75A — the smallest Polaris lounge in United's network — for premium international travelers. United Express partners operate from the same terminals.</p>\n\n    <div class=\"highlight-box\">\n      <strong>LAX by the numbers:</strong> ~200 daily departures · Terminals 7 & 8 · United's smallest mainland hub · Key Pacific gateway · Widebody-heavy route mix · Polaris service to Asia & Australia\n    </div>\n\n\n    <div class=\"highlight-box\" style=\"border-left-color:var(--ua-yellow)\">\n      <span id=\"construction\"></span><strong>⚠️ Construction Alert:</strong> The <a href=\"https://www.flylax.com/lax-people-mover\" target=\"_blank\" rel=\"noopener noreferrer\">LAX Automated People Mover (APM)</a> elevated train has seen its opening slip repeatedly; with testing underway since April 2026, the latest target is October 6, 2026 at the earliest. Once open, it will connect the terminals to the Metro K Line and the consolidated rental car facility. Expect ongoing construction impacts on ground transportation until then.\n    </div>\n\n    <h3>Key Routes from LAX</h3>\n    <ul>\n      <li><strong>Domestic:</strong> SFO, ORD, DEN, EWR, IAH, IAD — all major United hub connections plus extensive West Coast network</li>\n      <li><strong>Transpacific:</strong> NRT, HND, SYD, MEL, PVG, TPE — United's largest Pacific gateway</li>\n      <li><strong>Transatlantic:</strong> LHR (year-round widebody service)</li>\n      <li><strong>Latin America:</strong> CUN, GDL, PVR, SJD, MEX</li>\n      <li><strong>Hawaii:</strong> HNL, OGG, LIH, KOA — multiple daily frequencies</li>\n    </ul>\n  </div>\n\n  <!-- Delay Patterns -->\n  <div class=\"section\">\n    <h2 id=\"delay-patterns\">Delay Patterns at LAX</h2>\n    <p>LAX benefits from Southern California's generally mild weather but faces unique operational challenges from its complex airspace and marine layer conditions:</p>\n\n    <h3>Marine Layer (May–Jun)</h3>\n    <p>\"May Gray\" and \"June Gloom\" bring persistent morning fog and low clouds that can reduce visibility below IFR minimums. When marine layer is thick, LAX switches to instrument approaches which reduce throughput from 4 runways to 2, causing cascading delays. Conditions typically burn off by midday.</p>\n\n    <h3>Santa Ana Winds (Oct–Jan)</h3>\n    <p>Hot, dry Santa Ana winds can force runway configuration changes and create turbulent approach conditions. While not a major delay driver, they occasionally require go-arounds and diversions, especially for regional jets.</p>\n\n    <h3>Year-Round: Airspace Congestion</h3>\n    <p>LAX shares the LA Basin airspace with Burbank (BUR), Long Beach (LGB), Orange County (SNA), and Ontario (ONT). This creates one of the most complex approach corridors in the U.S. Late arrivals from East Coast airports — especially weather-delayed EWR and JFK flights — ripple into LAX evening operations.</p>\n\n    <div class=\"highlight-box\">\n      <strong>Tip:</strong> Afternoon departures from LAX typically have the best on-time performance. Morning marine layer affects early flights in May–June, and East Coast ripple effects hit evening departures year-round.\n    </div>\n  </div>\n\n  <!-- Starlink -->\n  <div class=\"section\">\n    <h2 id=\"starlink\">Starlink WiFi at LAX</h2>\n    <p>United Airlines is rapidly equipping its fleet with <strong>Starlink satellite internet</strong> — high-speed WiFi that is <strong>free for all MileagePlus members, gate to gate</strong>. As of ${STARLINK_AS_OF}, <strong>${STARLINK_EQUIPPED_LABEL} United aircraft are equipped (~24% of the combined fleet)</strong>. The rollout started with United Express regional jets — Embraer 175s first, beginning May 2025 — and over half the regional fleet is now equipped. The first mainline Starlink aircraft, a Boeing 737-800, entered service in October 2025, and the first Starlink widebody — a Boeing 777 — began transatlantic flying in June 2026. For LAX's widebody-heavy transpacific route mix (777, 787 Dreamliner), the widebody rollout is the one to watch: United expects its entire widebody fleet equipped by summer 2027, with a goal of roughly 1,000 aircraft by the end of 2026.</p>\n    <p>Use <a href=\"/?tab=fleet&filter=starlink\">The Blue Board's Fleet tab</a> to check if your specific aircraft has Starlink. You can search by tail number, flight number, or aircraft type.</p>\n\n    <div class=\"highlight-box\">\n      <strong>How to check:</strong> Look up your flight on The Blue Board → check the aircraft details panel → look for \"Starlink\" in the WiFi field. Equipped aircraft show <span style=\"color:var(--ua-green)\">● Starlink</span>.\n    </div>\n  </div>\n\n  <!-- FAQ (visible, matches schema) -->\n  <div class=\"section\">\n    <h2 id=\"faq\">Frequently Asked Questions</h2>\n\n    <h3>Is United Airlines delayed at LAX today?</h3>\n    <p>Check the live status panel at the top of this page for current on-time performance, delay counts, and cancellations. For flight-level detail, <a href=\"/?hub=lax\">open LAX on The Blue Board</a> to see every flight in real time.</p>\n\n    <h3>What terminal is United at LAX?</h3>\n    <p>United Airlines operates from Terminals 7 and 8 on the south side of the LAX horseshoe. Both terminals have United Club lounges. Terminals 7 and 8 are connected airside, so you can move between them without re-clearing security.</p>\n\n    <h3>How many United flights depart from LAX daily?</h3>\n    <p>Approximately 200 daily departures. LAX is United's smallest mainland hub and a key Pacific gateway, with widebody service to Asia, Australia, and extensive Hawaii frequencies.</p>\n\n    <h3>Which United planes at LAX have Starlink WiFi?</h3>\n    <p>Starlink is free for all MileagePlus members, gate to gate. As of ${STARLINK_AS_OF}, ${STARLINK_EQUIPPED_LABEL} United aircraft are equipped — the rollout began with United Express regional jets in May 2025, the first mainline 737-800 flew in October 2025, and the first widebody in June 2026 (full widebody fleet expected by summer 2027). Check <a href=\"/?tab=fleet&filter=starlink\">the Fleet tab</a> for the latest count and your specific tail number.</p>\n  </div>`
};
