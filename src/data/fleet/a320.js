import { STARLINK_EQUIPPED_LABEL, STARLINK_AS_OF } from '../facts.js';

export const a320 = {
  "slug": "a320",
  "typeCode": "A320",
  "displayName": "Airbus A320",
  "manufacturer": "Airbus",
  "family": "Airbus A320 Family",
  "count": 68,
  "bodyType": "narrowbody",
  "deliveryRange": "1996–2006",
  "role": "Domestic / Short-haul",
  "seatConfig": {
    "total": "150",
    "cabins": [
      {
        "name": "First",
        "seats": 12,
        "cssClass": "cabin-first"
      },
      {
        "name": "Economy Plus",
        "seats": 42,
        "cssClass": "cabin-ep"
      },
      {
        "name": "Economy",
        "seats": 96,
        "cssClass": "cabin-y"
      }
    ],
    "hasPolaris": false,
    "hasPremiumPlus": false,
    "hasFirst": true
  },
  "primaryWifi": "Ku-band satellite (Starlink rollout underway)",
  "ifeType": "AVOD / PDE (mixed)",
  "seatPower": "110V USB / First & E+ only (varies)",
  "aircraftSchema": {
    "manufacturer": "Airbus S.A.S.",
    "model": "A320",
    "bodyType": "Narrow-body",
    "engines": "2x IAE V2500-A5",
    "range": "3,300 nmi (6,110 km)",
    "cruiseSpeed": "Mach 0.78",
    "wingspan": "34.1 m (112 ft)",
    "length": "37.6 m (123 ft)"
  },
  "title": "United Airlines Airbus A320 — 68 Aircraft, Seat Map & 2030 Retirement | The Blue Board",
  "description": "United's 68 Airbus A320s: seat map, cabins, WiFi and IFE. A domestic workhorse now slated for retirement by ~2030 as the A321neo takes over its routes.",
  "keywords": "United Airlines A320, United A320 seat map, United A320 configuration, United A320 WiFi, United A320 retirement, UA A320",
  "ogTitle": "United Airlines Airbus A320 — 68 Aircraft, Retiring by ~2030",
  "ogDescription": "United's 68 Airbus A320s: seat maps, cabins, WiFi and IFE — a domestic workhorse being replaced by the A321neo.",
  "ogImageAlt": "The Blue Board — United Airlines Airbus A320 Fleet",
  "twitterTitle": "United Airlines Airbus A320 — 68 Aircraft, Retiring by ~2030",
  "twitterDescription": "United's 68 Airbus A320s — seat maps, cabins, WiFi and IFE. A domestic workhorse being replaced by the A321neo.",
  "breadcrumbName": "Airbus A320",
  "faqSchema": [
    {
      "question": "How many Airbus A320 aircraft does United Airlines have?",
      "answer": "68 aircraft, delivered between 1996 and 2006. A domestic workhorse flying short- to medium-haul routes alongside the Boeing 737 family."
    },
    {
      "question": "What is the seat configuration on United's A320?",
      "answer": "150 passengers: 12 First (2-2), 42 Economy Plus, 96 Economy. All 68 share the same layout."
    },
    {
      "question": "Is United retiring the A320?",
      "answer": "Yes. United plans to retire the A319 and A320 by around 2030 (announced October 2025), replacing them with the larger, more efficient A321neo."
    },
    {
      "question": "Does the United A320 have WiFi?",
      "answer": "United is rolling out free Starlink WiFi across its fleet — free for MileagePlus members. Until each A320 is upgraded, they carry Ku-band satellite WiFi."
    },
    {
      "question": "Does the United A320 have seatback screens?",
      "answer": "It varies. United is retrofitting A320s with its Signature Interior — seatback screens at every seat — while older frames still stream entertainment to your own device."
    },
    {
      "question": "What routes does United fly the A320 on?",
      "answer": "Short- to medium-haul domestic routes from every United hub, plus smaller markets."
    }
  ],
  "headerTitle": "United Airlines <span class=\"type-badge\">A320</span>",
  "subtitle": "68 aircraft · 150 seats · Retiring by ~2030",
  "jumpNav": [
    {
      "href": "#overview",
      "label": "Overview"
    },
    {
      "href": "#seat-config",
      "label": "Seat Config"
    },
    {
      "href": "#specs",
      "label": "Specs"
    },
    {
      "href": "#wifi",
      "label": "WiFi & IFE"
    },
    {
      "href": "#routes",
      "label": "Routes"
    },
    {
      "href": "#registry",
      "label": "Aircraft List"
    },
    {
      "href": "#faq",
      "label": "FAQ"
    },
    {
      "href": "#all-types",
      "label": "All Types"
    }
  ],
  "contentHtml": `<div class=\"section\"><h2 id=\"overview\">Overview</h2><p>The <strong>Airbus A320</strong> is a domestic workhorse — <strong>68 aircraft</strong> and 150 seats, delivered between 1996 and 2006. It flies short- to medium-haul routes alongside the Boeing 737 family from every United hub. In October 2025 United's chief commercial officer confirmed the A320 and smaller <a href=\"/fleet/a319\">A319</a> will be retired by around 2030, replaced by the larger, more efficient <a href=\"/fleet/a321neo\">A321neo</a>.</p><div class=\"highlight-box\" style=\"border-left-color:var(--ua-yellow)\"><strong>Retiring by ~2030:</strong> United plans to phase out its A320s by the end of the decade. Many are being refreshed with the Signature Interior in the meantime, while the airline's free Starlink WiFi rollout reaches the fleet.</div></div><div class=\"section\"><h2 id=\"seat-config\">Seat Configuration</h2><table class=\"config-table\"><thead><tr><th>Cabin</th><th>Seats</th><th>Layout</th></tr></thead><tbody><tr><td><strong>First</strong></td><td>12</td><td>2-2</td></tr><tr><td><span class=\"cabin-tag cabin-ep\">Economy Plus</span></td><td>42</td><td>3-3</td></tr><tr><td>Economy</td><td>96</td><td>3-3</td></tr></tbody></table></div><div class=\"section\"><h2 id=\"wifi\">WiFi & In-Flight Entertainment</h2><p>Every A320 carries Ku-band satellite WiFi today, but United's fleet-wide <strong>Starlink</strong> rollout — free for MileagePlus members — is reaching aircraft across the fleet (${STARLINK_EQUIPPED_LABEL} jets equipped by ${STARLINK_AS_OF}, on track for about 1,000 by year-end). Entertainment varies by aircraft: United is retrofitting A320s with its <strong>Signature Interior</strong> (seatback screens at every seat, Bluetooth audio and power), while older frames still stream to your own device.</p></div><div class=\"section\"><h2 id=\"routes\">Routes & Hubs</h2><p>Short- to medium-haul domestic routes from every United hub, including <a href=\"/hubs/ord\">Chicago (ORD)</a>, <a href=\"/hubs/den\">Denver (DEN)</a>, <a href=\"/hubs/iah\">Houston (IAH)</a> and <a href=\"/hubs/sfo\">San Francisco (SFO)</a>.</p><h3>Related Aircraft</h3><p><a href=\"/fleet/a319\">A319</a> (76) is the shorter sibling, and the newer <a href=\"/fleet/a321neo\">A321neo</a> (62) is taking over as the A319 and A320 retire.</p></div>`
};
