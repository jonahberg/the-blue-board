import { STARLINK_EQUIPPED_LABEL, STARLINK_AS_OF } from '../facts.js';

export const sfo = {
  "iata": "SFO",
  "variant": "full",
  "title": "United Airlines SFO Hub Status — San Francisco Delays, On-Time Performance & Flight Tracker",
  "description": "Live United Airlines status at San Francisco International (SFO). AI-powered delay risk predictions, real-time delays, cancellations, on-time performance, Starlink WiFi aircraft, and departure schedules. United's Asia-Pacific gateway — updated every 30 seconds.",
  "keywords": "United Airlines SFO delays, United San Francisco hub status, United Airlines SFO on-time, United SFO cancellations today, United Airlines San Francisco delays, SFO flight status, United hub San Francisco, United Airlines SFO departures",
  "ogTitle": "United Airlines SFO Hub — Live San Francisco International Status",
  "ogDescription": "Real-time United Airlines operations at San Francisco International. AI delay predictions, cancellations, on-time %, Starlink WiFi fleet, and schedules.",
  "ogImageAlt": "The Blue Board — United Airlines SFO Hub Status",
  "twitterTitle": "United Airlines SFO Hub — Live San Francisco International Status",
  "twitterDescription": "AI delay predictions, cancellations, on-time performance at United's Asia-Pacific gateway. Updated every 30 seconds.",
  "breadcrumbName": "SFO — San Francisco",
  "faqSchema": [
    {
      "question": "Is United Airlines delayed at SFO today?",
      "answer": "The Blue Board tracks every United Airlines flight at San Francisco International in real time. Check the live status panel above for current delay counts, cancellations, and on-time performance. The dashboard updates every 30 seconds with data from Flightradar24 and FAA sources."
    },
    {
      "question": "What terminal is United Airlines at SFO?",
      "answer": "United Airlines domestic flights operate from Terminal 3 at San Francisco International Airport. United international flights use the International Terminal (Terminal G). United Club lounges are located in Terminal 3 (Boarding Area E near gate E4, Boarding Area F near gate F11) and the International Terminal Boarding Area G. United Express regional flights depart from Terminal 3."
    },
    {
      "question": "How many United flights depart from SFO daily?",
      "answer": "United Airlines operates approximately 300 daily departures from San Francisco International, making it United's primary Asia-Pacific gateway. SFO is located in the heart of Silicon Valley and serves as a critical hub for tech corridor travel."
    },
    {
      "question": "Which United planes at SFO have Starlink WiFi?",
      "answer": `Starlink satellite WiFi is free for all MileagePlus members, gate to gate. ${STARLINK_EQUIPPED_LABEL} United aircraft were equipped as of ${STARLINK_AS_OF} (about 24% of the combined fleet). The rollout began with United Express regional jets — Embraer 175s from May 2025 — and over half the regional fleet is now equipped; the first mainline Starlink aircraft (a Boeing 737-800) entered service in October 2025 and the first widebody in June 2026, with the full widebody fleet expected by summer 2027. Check The Blue Board's Fleet tab to see whether your specific tail number is equipped.`
    },
    {
      "question": "What causes the most delays at SFO for United?",
      "answer": "Fog is the signature delay driver at SFO. Marine layer fog from the Pacific regularly reduces visibility, forcing SFO to switch from parallel approaches to single-runway operations — cutting arrival capacity in half. Summer fog season (June–August) is paradoxically SFO's worst period for delays. SFO's closely-spaced parallel runways require visual separation in good weather but can only handle one stream of traffic in low visibility. The Blue Board's AI delay risk engine factors in weather, FAA programs, hub performance, and inbound aircraft to predict delays in real time."
    }
  ],
  "airportSchema": {
    "name": "San Francisco International Airport",
    "iataCode": "SFO",
    "addressLocality": "San Francisco",
    "addressRegion": "CA",
    "addressCountry": "US",
    "latitude": 37.6213,
    "longitude": -122.379,
    "url": "https://www.flysfo.com"
  },
  "headerTitle": "United Airlines at <span class=\"iata\">SFO</span> — San Francisco International",
  "subtitle": "United's Asia-Pacific gateway · ~300 daily departures · Terminal 3 · International Terminal G",
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
  "contentHtml": `\n  <!-- Dive Deep -->\n  <div class=\"section\">\n    <h2>Dive Deep at The Blue Board</h2>\n    <p><strong>The Blue Board</strong> is the only real-time operations dashboard built specifically for United Airlines passengers. Live flight tracking, AI-powered delay risk predictions, inbound aircraft tracking, Starlink WiFi status, and IROPS monitoring, updated in real-time.</p>\n    <p>This page gives you the overview — but the real action is on the dashboard. Track every United flight at SFO in real time, set up flight watch alerts, check equipment swaps, and monitor weather radar overlaid on the live map.</p>\n    <div style=\"display:flex;flex-wrap:wrap;gap:10px;margin-top:12px\">\n      <a class=\"cta\" href=\"/?hub=sfo\" style=\"margin:0\">🗺️ Live SFO Map</a>\n      <a class=\"cta\" href=\"/?tab=schedule&hub=sfo\" style=\"margin:0\">📋 SFO Schedules</a>\n      <a class=\"cta\" href=\"/?tab=fleet&filter=starlink\" style=\"margin:0\">📡 Starlink Fleet</a>\n      <a class=\"cta\" href=\"/?tab=irops&hub=sfo\" style=\"margin:0\">⚠️ IROPS Monitor</a>\n    </div>\n  </div>\n\n  <!-- Hub Overview -->\n  <div class=\"section\">\n    <h2 id=\"overview\">Hub Overview</h2>\n    <p>San Francisco International Airport is <strong>United Airlines' primary Asia-Pacific gateway</strong> and a critical hub for the tech corridor connecting Silicon Valley to the world. With approximately 300 daily departures, SFO connects to over 130 destinations domestically and internationally.</p>\n    <p>United domestic flights operate from <strong>Terminal 3</strong>, while international flights use the <strong>International Terminal (Terminal G)</strong>. United Club lounges are located in Terminal 3 (Boarding Area E near gate E4, Boarding Area F near gate F11) and the International Terminal Boarding Area G, including the <strong>United Polaris lounge</strong> — the largest Polaris lounge in United's network — for premium international travelers. United Express regional partners operate from Terminal 3.</p>\n\n    <div class=\"highlight-box\">\n      <strong>SFO by the numbers:</strong> ~300 daily departures · 130+ destinations · Terminal 3 + International Terminal G · United's #1 Asia-Pacific hub · Heart of Silicon Valley · Largest Polaris lounge in the network\n    </div>\n\n\n    <div class=\"highlight-box\" style=\"border-left-color:var(--ua-green)\">\n      <span id=\"construction\"></span><strong>✅ Terminal Update:</strong> Harvey Milk Terminal 1 renovation is complete (serves Southwest, JetBlue, and others). United's Terminal 3 facilities continue to see incremental improvements. SFO AirTrain connects all terminals and the BART station for downtown access.\n    </div>\n\n    <h3>Key Routes from SFO</h3>\n    <ul>\n      <li><strong>Domestic:</strong> ORD, DEN, LAX, EWR, IAH, IAD — all major United hub connections plus extensive West Coast network</li>\n      <li><strong>Asia-Pacific:</strong> NRT, HND, ICN, PVG, PEK, SIN, SYD, TPE, BOM, DEL — the most extensive transpacific schedule in United's network</li>\n      <li><strong>Transatlantic:</strong> LHR, FRA, CDG, MUC, ZRH, DUB</li>\n      <li><strong>Latin America:</strong> CUN, GDL, PVR</li>\n    </ul>\n  </div>\n\n  <!-- Delay Patterns -->\n  <div class=\"section\">\n    <h2 id=\"delay-patterns\">Delay Patterns at SFO</h2>\n    <p>San Francisco International has a unique delay profile driven primarily by fog and runway configuration. Understanding these patterns is essential for SFO travelers:</p>\n\n    <h3>Fog Season (Jun–Aug)</h3>\n    <p>Paradoxically, summer is SFO's worst season for delays. Marine layer fog rolls in from the Pacific, reducing visibility and forcing SFO to switch from dual parallel approaches to single-runway operations. This cuts arrival capacity roughly in half and triggers ground delay programs that ripple across the network. Fog is typically worst in the morning and evening.</p>\n\n    <h3>Winter (Nov–Feb)</h3>\n    <p>Pacific storm systems bring rain and low ceilings. While less impactful than fog, sustained rain events reduce approach rates and can cause moderate delays. Atmospheric rivers can produce extended periods of reduced operations.</p>\n\n    <h3>Runway Configuration</h3>\n    <p>SFO's closely-spaced parallel runways (28L/28R) are only 750 feet apart — too close for simultaneous independent approaches in instrument conditions. This is the structural reason fog has such an outsized impact on SFO operations compared to other airports.</p>\n\n    <div class=\"highlight-box\">\n      <strong>Tip:</strong> Midday departures (10 AM–2 PM) often have the best on-time performance at SFO, as morning fog typically burns off by late morning. Early morning and late evening flights are most fog-affected.\n    </div>\n  </div>\n\n  <!-- Starlink -->\n  <div class=\"section\">\n    <h2 id=\"starlink\">Starlink WiFi at SFO</h2>\n    <p>United Airlines is rapidly equipping its fleet with <strong>Starlink satellite internet</strong> — high-speed WiFi that is <strong>free for all MileagePlus members, gate to gate</strong>. As of ${STARLINK_AS_OF}, <strong>${STARLINK_EQUIPPED_LABEL} United aircraft are equipped (~24% of the combined fleet)</strong>. The rollout started with United Express regional jets — Embraer 175s first, beginning May 2025 — and over half the regional fleet is now equipped. The first mainline Starlink aircraft, a Boeing 737-800, entered service in October 2025, and the first Starlink widebody — a Boeing 777 — began transatlantic flying in June 2026. For SFO's transpacific travelers, that widebody rollout matters most: United expects its entire widebody fleet equipped by summer 2027, with a goal of roughly 1,000 aircraft by the end of 2026.</p>\n    <p>Use <a href=\"/?tab=fleet&filter=starlink\">The Blue Board's Fleet tab</a> to check if your specific aircraft has Starlink. You can search by tail number, flight number, or aircraft type.</p>\n\n    <div class=\"highlight-box\">\n      <strong>How to check:</strong> Look up your flight on The Blue Board → check the aircraft details panel → look for \"Starlink\" in the WiFi field. Equipped aircraft show <span style=\"color:var(--ua-green)\">● Starlink</span>.\n    </div>\n  </div>\n\n  <!-- FAQ (visible, matches schema) -->\n  <div class=\"section\">\n    <h2 id=\"faq\">Frequently Asked Questions</h2>\n\n    <h3>Is United Airlines delayed at SFO today?</h3>\n    <p>Check the live status panel at the top of this page for current on-time performance, delay counts, and cancellations. For flight-level detail, <a href=\"/?hub=sfo\">open SFO on The Blue Board</a> to see every flight in real time.</p>\n\n    <h3>What terminal is United at SFO?</h3>\n    <p>United domestic flights operate from Terminal 3. International flights use the International Terminal (Terminal G). United Club lounges are in both terminals, and the United Polaris lounge — the largest in United's network — serves premium international travelers.</p>\n\n    <h3>How many United flights depart from SFO daily?</h3>\n    <p>Approximately 300 daily departures, making SFO United's primary Asia-Pacific gateway and a key West Coast hub.</p>\n\n    <h3>Which United planes at SFO have Starlink WiFi?</h3>\n    <p>Starlink is free for all MileagePlus members, gate to gate. As of ${STARLINK_AS_OF}, ${STARLINK_EQUIPPED_LABEL} United aircraft are equipped — the rollout began with United Express regional jets in May 2025, the first mainline 737-800 flew in October 2025, and the first widebody in June 2026 (full widebody fleet expected by summer 2027). Check <a href=\"/?tab=fleet&filter=starlink\">the Fleet tab</a> for the latest count and your specific tail number.</p>\n  </div>`
};
