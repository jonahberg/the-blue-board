// @ts-check
/**
 * Modern Skies Tracker — FAA TFDM (electronic flight strips) rollout data.
 *
 * DATA MODEL:
 *  - One entry per airport in the FAA's 89-airport TFDM program.
 *  - status: "live"        = electronic strips operational (FAA Modern Skies "Active", or event-dated press)
 *            "in-progress" = deployment physically underway (none currently report this; kept for future use)
 *            "planned"     = in the FAA's Aug-2023 deployment waterfall with a published planned IOC date
 *            "paper"       = cut in the FAA's 2022 descope, restored to scope in 2025 — no published date
 *  - goLiveDate: ONLY where defensible — DOT OIG confirmed-actuals (sites 1–7) or event-dated press
 *    (DCA, MDW, AUS). Eight live airports have no published cutover date; they carry no goLiveDate.
 *    Precision varies (YYYY-MM-DD vs YYYY-MM) to match what the source supports. Do not backfill
 *    from the waterfall — planned IOC dates are not go-live dates.
 *  - plannedIoc: the airport's slot in the FAA's Aug-2023 waterfall (DOT OIG report AV2024031,
 *    Exhibit F). Historic sequencing, NOT a commitment — DCA jumped its slot by ~2.5 years and
 *    BOS/ATL/HOU/SLC have all sailed past theirs. Render with that caveat, never as "expected".
 *  - sources: every entry cites at least one; modernskies.faa.gov is the FAA's own status surface.
 *
 * MAINTENANCE (see MAINTENANCE.md for the full monthly ritual):
 *  - Status pointer: https://modernskies.faa.gov (search by airport code). CAVEATS (verified
 *    2026-07-27): its per-airport answers are AI-generated on request (meta.source:
 *    "ai-generated"), it returns no TFDM project at all for ~10 program airports, it lags
 *    go-live events by weeks (still showed AUS "Planned" after the cutover), and it renders
 *    scheduled and descoped-restored towers identically as "Planned". Treat it as a pointer;
 *    confirm status changes with press/OIG before editing this file.
 *  - Go-live events: Leidos newsroom (leidos.com/insights), FAA newsroom, FedScoop (Lindsey
 *    Wilkinson's beat), local TV in the airport's market.
 *  - After edits: bump atcMeta.lastUpdated, add a changelog entry, run `bun run test`.
 *
 * Last verified: 2026-07-27
 */

/** @typedef {'live'|'in-progress'|'planned'|'paper'} AtcStatus */

/**
 * @typedef {Object} AtcAirport
 * @property {string} id           lowercase IATA, unique
 * @property {string} code         IATA
 * @property {string} name
 * @property {string} city
 * @property {string} state        2-letter USPS (incl. AK/HI/PR territories)
 * @property {number} lat
 * @property {number} lng
 * @property {AtcStatus} status
 * @property {string} [goLiveDate]  YYYY-MM-DD or YYYY-MM — confirmed cutovers only
 * @property {string} [plannedIoc]  YYYY-MM-DD — FAA Aug-2023 waterfall slot (historic, not a promise)
 * @property {string} [note]        one-liner shown in table/map card
 * @property {string[]} sources
 */

export const atcMeta = {
  slug: "atc",
  name: "Modern Skies Tracker",
  lastUpdated: "2026-07-27",
  // Headline stats that can't be derived from the entries below. Live/paper counts ARE derived —
  // never hardcode them here (tests pin that).
  stats: {
    fiber: {
      label: "of the FAA's copper-to-fiber network rebuild complete",
      value: "50%+",
      asOf: "2026-05-11",
      source: "https://www.l3harris.com/newsroom/editorial/2026/05/l3harris-reaches-over-50-faa-telecommunications-modernization",
    },
    target: {
      label: "FAA target for all 89 airports off paper",
      value: "2028",
      note: "The FAA's stated target. For calibration: the DOT Inspector General's 2024 audit estimated February 2030 — for a smaller, 49-site plan.",
      source: "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/",
    },
  },
  changelog: [
    { date: "2026-07-27", entry: "Tracker first published — 18 airports live, 71 still on paper." },
    { date: "2026-07-15", entry: "The Modern Skies Coalition — 66 aviation groups — asks Congress for another $20B. Not yet appropriated." },
    { date: "2026-07-14", entry: "Austin (AUS) becomes the 18th airport to drop paper strips." },
    { date: "2026-06-22", entry: "FAA awards Air Space Intelligence $875M over 12 years to rebuild the command center's traffic-flow software (FMDS/SMART), beating Palantir and Thales." },
    { date: "2026-05-22", entry: "FAA launches modernskies.faa.gov — per-airport modernization status, searchable by code, updated monthly." },
    { date: "2026-05-11", entry: "Copper-to-fiber conversion passes the halfway mark, per L3Harris." },
    { date: "2026-04-24", entry: "Chicago Midway (MDW) reported live — the 17th airport, about nine months behind its 2023-plan slot." },
    { date: "2026-02-19", entry: "Washington National (DCA) marked live by Transportation Secretary Duffy — it jumped the queue from a July 2028 slot." },
    { date: "2026-02-10", entry: "FAA tells Congress the Peraton integrator contract is worth $1.5B — not the '$12.5B' many headlines claimed." },
    { date: "2026-01-06", entry: "Radar replacement contracts go to RTX and Indra: up to 612 radars by June 2028." },
    { date: "2025-12-04", entry: "Peraton named prime integrator for the new ATC system, beating a joint Parsons/IBM bid." },
    { date: "2025-07-04", entry: "One Big Beautiful Bill signs $12.5B for ATC modernization — and the FAA's public target swings back to ~90 airports, folding the 40 towers cut in 2022 back into the goal." },
    { date: "2024-07-17", entry: "DOT Inspector General documents the program's rough first decade: scope cut 89→49 towers, cost up $795M→$950M, first site nearly three years late." },
    { date: "2022-10-24", entry: "Cleveland (CLE) becomes the first tower in the country on electronic strips." },
  ],
};

/** @type {AtcAirport[]} */
export const atcAirports = [
  {
      "id": "cle",
      "code": "CLE",
      "name": "Cleveland Hopkins International",
      "city": "Cleveland",
      "state": "OH",
      "lat": 41.4117,
      "lng": -81.8498,
      "status": "live",
      "goLiveDate": "2022-10-24",
      "note": "First tower in the country to drop paper — TFDM’s Build 1 key site.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://www.leidos.com/insights/leidos-deploys-new-terminal-flight-management-capability-cleveland-hopkins-international"
      ]
  },
  {
      "id": "ind",
      "code": "IND",
      "name": "Indianapolis International",
      "city": "Indianapolis",
      "state": "IN",
      "lat": 39.7173,
      "lng": -86.2944,
      "status": "live",
      "goLiveDate": "2023-05-15",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "phx",
      "code": "PHX",
      "name": "Phoenix Sky Harbor International",
      "city": "Phoenix",
      "state": "AZ",
      "lat": 33.4353,
      "lng": -112.0059,
      "status": "live",
      "goLiveDate": "2023-06-05",
      "note": "First full-capability (Config A) airport. Often miscredited as the program’s key site — that was Cleveland.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "rdu",
      "code": "RDU",
      "name": "Raleigh-Durham International",
      "city": "Raleigh/Durham",
      "state": "NC",
      "lat": 35.8787,
      "lng": -78.7873,
      "status": "live",
      "goLiveDate": "2023-07-24",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "cmh",
      "code": "CMH",
      "name": "John Glenn Columbus International",
      "city": "Columbus",
      "state": "OH",
      "lat": 39.998,
      "lng": -82.8919,
      "status": "live",
      "goLiveDate": "2023-09-11",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "las",
      "code": "LAS",
      "name": "Harry Reid International",
      "city": "Las Vegas",
      "state": "NV",
      "lat": 36.0834,
      "lng": -115.1518,
      "status": "live",
      "goLiveDate": "2023-10-30",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "sjc",
      "code": "SJC",
      "name": "Norman Y. Mineta San Jose International",
      "city": "San Jose",
      "state": "CA",
      "lat": 37.3625,
      "lng": -121.9292,
      "status": "live",
      "goLiveDate": "2024-02-27",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "dca",
      "code": "DCA",
      "name": "Ronald Reagan Washington National",
      "city": "Washington",
      "state": "DC",
      "lat": 38.8521,
      "lng": -77.0377,
      "status": "live",
      "goLiveDate": "2026-02",
      "note": "Jumped the queue from a July 2028 slot. Leidos says it deployed 45% faster than its usual cycle.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.leidos.com/insights/leidos-system-installed-help-improve-efficiency-and-safety-reagan-national-airport",
          "https://www.aerotime.aero/articles/reagan-national-dca-electronic-flight-strips-leidos"
      ]
  },
  {
      "id": "mdw",
      "code": "MDW",
      "name": "Chicago Midway International",
      "city": "Chicago",
      "state": "IL",
      "lat": 41.786,
      "lng": -87.7524,
      "status": "live",
      "goLiveDate": "2026-04",
      "note": "17th airport off paper — about nine months behind its slot in the 2023 schedule.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://www.aol.com/news/faa-goes-digital-midway-airport-205335176.html"
      ]
  },
  {
      "id": "aus",
      "code": "AUS",
      "name": "Austin-Bergstrom International",
      "city": "Austin",
      "state": "TX",
      "lat": 30.1975,
      "lng": -97.662,
      "status": "live",
      "goLiveDate": "2026-07-14",
      "note": "18th airport off paper — went live July 14; the FAA’s own dashboard was still calling it planned two weeks later.",
      "sources": [
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/",
          "https://www.yahoo.com/news/us/articles/austin-airport-begins-transition-electronic-133238558.html"
      ]
  },
  {
      "id": "clt",
      "code": "CLT",
      "name": "Charlotte Douglas International",
      "city": "Charlotte",
      "state": "NC",
      "lat": 35.214,
      "lng": -80.9431,
      "status": "live",
      "note": "Key site for TFDM’s surface-metering build. Its 2024 cutover slipped on a software defect and the FAA never published the final date.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "iah",
      "code": "IAH",
      "name": "George Bush Intercontinental",
      "city": "Houston",
      "state": "TX",
      "lat": 29.9844,
      "lng": -95.3414,
      "status": "live",
      "note": "Confirmed live on the FAA’s Modern Skies dashboard — the FAA hasn’t published the cutover date.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "lax",
      "code": "LAX",
      "name": "Los Angeles International",
      "city": "Los Angeles",
      "state": "CA",
      "lat": 33.9425,
      "lng": -118.408,
      "status": "live",
      "note": "Confirmed live on the FAA’s Modern Skies dashboard — the FAA hasn’t published the cutover date.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "mia",
      "code": "MIA",
      "name": "Miami International",
      "city": "Miami",
      "state": "FL",
      "lat": 25.796,
      "lng": -80.2898,
      "status": "live",
      "note": "Confirmed live on the FAA’s Modern Skies dashboard — the FAA hasn’t published the cutover date.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "oak",
      "code": "OAK",
      "name": "San Francisco Bay Oakland International",
      "city": "Oakland",
      "state": "CA",
      "lat": 37.7201,
      "lng": -122.2212,
      "status": "live",
      "note": "Confirmed live on the FAA’s Modern Skies dashboard — the FAA hasn’t published the cutover date.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "sea",
      "code": "SEA",
      "name": "Seattle-Tacoma International",
      "city": "Seattle",
      "state": "WA",
      "lat": 47.4479,
      "lng": -122.3103,
      "status": "live",
      "note": "Confirmed live on the FAA’s Modern Skies dashboard — the FAA hasn’t published the cutover date.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "sfo",
      "code": "SFO",
      "name": "San Francisco International",
      "city": "San Francisco",
      "state": "CA",
      "lat": 37.6198,
      "lng": -122.3748,
      "status": "live",
      "note": "Confirmed live on the FAA’s Modern Skies dashboard — the FAA hasn’t published the cutover date.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "tpa",
      "code": "TPA",
      "name": "Tampa International",
      "city": "Tampa",
      "state": "FL",
      "lat": 27.9755,
      "lng": -82.5332,
      "status": "live",
      "note": "Confirmed live on the FAA’s Modern Skies dashboard — the FAA hasn’t published the cutover date.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf",
          "https://fedscoop.com/faa-digital-flight-strip-system-atc-modernization/"
      ]
  },
  {
      "id": "bos",
      "code": "BOS",
      "name": "Boston Logan International",
      "city": "Boston",
      "state": "MA",
      "lat": 42.362,
      "lng": -71.0079,
      "status": "planned",
      "plannedIoc": "2026-03-03",
      "note": "Its March 2026 slot in the FAA’s schedule came and went — still listed as planned.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "atl",
      "code": "ATL",
      "name": "Hartsfield-Jackson Atlanta International",
      "city": "Atlanta",
      "state": "GA",
      "lat": 33.6367,
      "lng": -84.4281,
      "status": "planned",
      "plannedIoc": "2026-04-28",
      "note": "Its April 2026 slot in the FAA’s schedule has passed — still listed as planned.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "hou",
      "code": "HOU",
      "name": "William P. Hobby",
      "city": "Houston",
      "state": "TX",
      "lat": 29.6453,
      "lng": -95.2768,
      "status": "planned",
      "plannedIoc": "2026-06-02",
      "note": "Named by the FAA in July 2026 as one of the next deployments, though its June 2026 slot has passed.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "slc",
      "code": "SLC",
      "name": "Salt Lake City International",
      "city": "Salt Lake City",
      "state": "UT",
      "lat": 40.7889,
      "lng": -111.9799,
      "status": "planned",
      "plannedIoc": "2026-07-07",
      "note": "Its July 2026 slot in the FAA’s schedule has passed — still listed as planned.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "san",
      "code": "SAN",
      "name": "San Diego International",
      "city": "San Diego",
      "state": "CA",
      "lat": 32.7336,
      "lng": -117.19,
      "status": "planned",
      "plannedIoc": "2026-08-04",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "cvg",
      "code": "CVG",
      "name": "Cincinnati/Northern Kentucky International",
      "city": "Cincinnati/Covington",
      "state": "KY",
      "lat": 39.0488,
      "lng": -84.6678,
      "status": "planned",
      "plannedIoc": "2026-09-01",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "den",
      "code": "DEN",
      "name": "Denver International",
      "city": "Denver",
      "state": "CO",
      "lat": 39.86,
      "lng": -104.6738,
      "status": "planned",
      "plannedIoc": "2026-09-29",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "dfw",
      "code": "DFW",
      "name": "Dallas Fort Worth International",
      "city": "Dallas-Fort Worth",
      "state": "TX",
      "lat": 32.8968,
      "lng": -97.038,
      "status": "planned",
      "plannedIoc": "2026-10-27",
      "note": "Three towers to convert. Named by the FAA in July 2026 as one of the next deployments.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "dal",
      "code": "DAL",
      "name": "Dallas Love Field",
      "city": "Dallas",
      "state": "TX",
      "lat": 32.8448,
      "lng": -96.8477,
      "status": "planned",
      "plannedIoc": "2027-03-02",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "msp",
      "code": "MSP",
      "name": "Minneapolis-Saint Paul International",
      "city": "Minneapolis",
      "state": "MN",
      "lat": 44.8801,
      "lng": -93.2217,
      "status": "planned",
      "plannedIoc": "2027-03-30",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "sdf",
      "code": "SDF",
      "name": "Louisville Muhammad Ali International",
      "city": "Louisville",
      "state": "KY",
      "lat": 38.1706,
      "lng": -85.7351,
      "status": "planned",
      "plannedIoc": "2027-04-27",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "ord",
      "code": "ORD",
      "name": "Chicago O'Hare International",
      "city": "Chicago",
      "state": "IL",
      "lat": 41.9786,
      "lng": -87.9048,
      "status": "planned",
      "plannedIoc": "2027-06-08",
      "note": "Three towers to convert.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "bna",
      "code": "BNA",
      "name": "Nashville International",
      "city": "Nashville",
      "state": "TN",
      "lat": 36.1245,
      "lng": -86.6782,
      "status": "planned",
      "plannedIoc": "2027-07-06",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "iad",
      "code": "IAD",
      "name": "Washington Dulles International",
      "city": "Dulles",
      "state": "VA",
      "lat": 38.9445,
      "lng": -77.4558,
      "status": "planned",
      "plannedIoc": "2027-08-03",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "mem",
      "code": "MEM",
      "name": "Memphis International",
      "city": "Memphis",
      "state": "TN",
      "lat": 35.0438,
      "lng": -89.9763,
      "status": "planned",
      "plannedIoc": "2027-08-31",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "fll",
      "code": "FLL",
      "name": "Fort Lauderdale-Hollywood International",
      "city": "Fort Lauderdale",
      "state": "FL",
      "lat": 26.0726,
      "lng": -80.1527,
      "status": "planned",
      "plannedIoc": "2027-09-28",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "mco",
      "code": "MCO",
      "name": "Orlando International",
      "city": "Orlando",
      "state": "FL",
      "lat": 28.4294,
      "lng": -81.309,
      "status": "planned",
      "plannedIoc": "2027-10-26",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "sat",
      "code": "SAT",
      "name": "San Antonio International",
      "city": "San Antonio",
      "state": "TX",
      "lat": 29.5337,
      "lng": -98.4698,
      "status": "planned",
      "plannedIoc": "2028-02-29",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "dtw",
      "code": "DTW",
      "name": "Detroit Metropolitan Wayne County",
      "city": "Detroit",
      "state": "MI",
      "lat": 42.2138,
      "lng": -83.3538,
      "status": "planned",
      "plannedIoc": "2028-03-28",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "isp",
      "code": "ISP",
      "name": "Long Island MacArthur",
      "city": "Islip",
      "state": "NY",
      "lat": 40.7963,
      "lng": -73.1017,
      "status": "planned",
      "plannedIoc": "2028-04-25",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "bwi",
      "code": "BWI",
      "name": "Baltimore/Washington International Thurgood Marshall",
      "city": "Baltimore",
      "state": "MD",
      "lat": 39.1754,
      "lng": -76.6683,
      "status": "planned",
      "plannedIoc": "2028-05-23",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "pbi",
      "code": "PBI",
      "name": "Palm Beach International",
      "city": "West Palm Beach",
      "state": "FL",
      "lat": 26.6832,
      "lng": -80.0956,
      "status": "planned",
      "plannedIoc": "2028-06-20",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "pdx",
      "code": "PDX",
      "name": "Portland International",
      "city": "Portland",
      "state": "OR",
      "lat": 45.5887,
      "lng": -122.598,
      "status": "planned",
      "plannedIoc": "2028-08-22",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "phl",
      "code": "PHL",
      "name": "Philadelphia International",
      "city": "Philadelphia",
      "state": "PA",
      "lat": 39.8719,
      "lng": -75.2411,
      "status": "planned",
      "plannedIoc": "2028-09-26",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "ewr",
      "code": "EWR",
      "name": "Newark Liberty International",
      "city": "Newark",
      "state": "NJ",
      "lat": 40.6894,
      "lng": -74.1705,
      "status": "planned",
      "plannedIoc": "2028-10-24",
      "note": "Late in the queue — New York towers also need a departure-sequencing interface.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "lga",
      "code": "LGA",
      "name": "LaGuardia",
      "city": "New York",
      "state": "NY",
      "lat": 40.7772,
      "lng": -73.8726,
      "status": "planned",
      "plannedIoc": "2029-02-27",
      "note": "Late in the queue — New York towers also need a departure-sequencing interface.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "teb",
      "code": "TEB",
      "name": "Teterboro",
      "city": "Teterboro",
      "state": "NJ",
      "lat": 40.8501,
      "lng": -74.0608,
      "status": "planned",
      "plannedIoc": "2029-03-27",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "jfk",
      "code": "JFK",
      "name": "John F. Kennedy International",
      "city": "New York",
      "state": "NY",
      "lat": 40.6394,
      "lng": -73.7793,
      "status": "planned",
      "plannedIoc": "2029-04-24",
      "note": "Late in the queue — New York towers also need a departure-sequencing interface.",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "hpn",
      "code": "HPN",
      "name": "Westchester County",
      "city": "White Plains",
      "state": "NY",
      "lat": 41.067,
      "lng": -73.7076,
      "status": "planned",
      "plannedIoc": "2029-05-22",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "pit",
      "code": "PIT",
      "name": "Pittsburgh International",
      "city": "Pittsburgh",
      "state": "PA",
      "lat": 40.4915,
      "lng": -80.2329,
      "status": "planned",
      "plannedIoc": "2029-06-19",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "stl",
      "code": "STL",
      "name": "St. Louis Lambert International",
      "city": "St. Louis",
      "state": "MO",
      "lat": 38.7487,
      "lng": -90.37,
      "status": "planned",
      "plannedIoc": "2029-07-17",
      "note": "Last slot in the FAA’s published schedule.",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "abq",
      "code": "ABQ",
      "name": "Albuquerque International Sunport",
      "city": "Albuquerque",
      "state": "NM",
      "lat": 35.04,
      "lng": -106.6089,
      "status": "paper",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "alb",
      "code": "ALB",
      "name": "Albany International",
      "city": "Albany",
      "state": "NY",
      "lat": 42.7483,
      "lng": -73.8017,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "anc",
      "code": "ANC",
      "name": "Ted Stevens Anchorage International",
      "city": "Anchorage",
      "state": "AK",
      "lat": 61.179,
      "lng": -149.9926,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "bdl",
      "code": "BDL",
      "name": "Bradley International",
      "city": "Windsor Locks",
      "state": "CT",
      "lat": 41.9386,
      "lng": -72.688,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "bhm",
      "code": "BHM",
      "name": "Birmingham-Shuttlesworth International",
      "city": "Birmingham",
      "state": "AL",
      "lat": 33.5629,
      "lng": -86.7507,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "boi",
      "code": "BOI",
      "name": "Boise Air Terminal/Gowen Field",
      "city": "Boise",
      "state": "ID",
      "lat": 43.5644,
      "lng": -116.223,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "buf",
      "code": "BUF",
      "name": "Buffalo Niagara International",
      "city": "Buffalo",
      "state": "NY",
      "lat": 42.9405,
      "lng": -78.7322,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "bur",
      "code": "BUR",
      "name": "Hollywood Burbank",
      "city": "Burbank",
      "state": "CA",
      "lat": 34.2028,
      "lng": -118.3581,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "chs",
      "code": "CHS",
      "name": "Charleston International",
      "city": "Charleston",
      "state": "SC",
      "lat": 32.8962,
      "lng": -80.0382,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "day",
      "code": "DAY",
      "name": "James M. Cox Dayton International",
      "city": "Dayton",
      "state": "OH",
      "lat": 39.9024,
      "lng": -84.2194,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "dsm",
      "code": "DSM",
      "name": "Des Moines International",
      "city": "Des Moines",
      "state": "IA",
      "lat": 41.534,
      "lng": -93.6567,
      "status": "paper",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "elp",
      "code": "ELP",
      "name": "El Paso International",
      "city": "El Paso",
      "state": "TX",
      "lat": 31.8099,
      "lng": -106.3756,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "geg",
      "code": "GEG",
      "name": "Spokane International",
      "city": "Spokane",
      "state": "WA",
      "lat": 47.6199,
      "lng": -117.534,
      "status": "paper",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "grr",
      "code": "GRR",
      "name": "Gerald R. Ford International",
      "city": "Grand Rapids",
      "state": "MI",
      "lat": 42.8808,
      "lng": -85.5228,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "gso",
      "code": "GSO",
      "name": "Piedmont Triad International",
      "city": "Greensboro",
      "state": "NC",
      "lat": 36.0994,
      "lng": -79.9373,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "hnl",
      "code": "HNL",
      "name": "Daniel K. Inouye International",
      "city": "Honolulu",
      "state": "HI",
      "lat": 21.3184,
      "lng": -157.9257,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "ict",
      "code": "ICT",
      "name": "Wichita Dwight D. Eisenhower National",
      "city": "Wichita",
      "state": "KS",
      "lat": 37.6503,
      "lng": -97.4286,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "jax",
      "code": "JAX",
      "name": "Jacksonville International",
      "city": "Jacksonville",
      "state": "FL",
      "lat": 30.4925,
      "lng": -81.6878,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "lit",
      "code": "LIT",
      "name": "Bill & Hillary Clinton National",
      "city": "Little Rock",
      "state": "AR",
      "lat": 34.7292,
      "lng": -92.2236,
      "status": "paper",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "mci",
      "code": "MCI",
      "name": "Kansas City International",
      "city": "Kansas City",
      "state": "MO",
      "lat": 39.3017,
      "lng": -94.7139,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "mke",
      "code": "MKE",
      "name": "Milwaukee Mitchell International",
      "city": "Milwaukee",
      "state": "WI",
      "lat": 42.9472,
      "lng": -87.8966,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "msn",
      "code": "MSN",
      "name": "Dane County Regional Airport (Truax Field)",
      "city": "Madison",
      "state": "WI",
      "lat": 43.1399,
      "lng": -89.3375,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "msy",
      "code": "MSY",
      "name": "Louis Armstrong New Orleans International",
      "city": "New Orleans",
      "state": "LA",
      "lat": 29.9934,
      "lng": -90.2647,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "okc",
      "code": "OKC",
      "name": "Will Rogers World",
      "city": "Oklahoma City",
      "state": "OK",
      "lat": 35.3934,
      "lng": -97.5982,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "oma",
      "code": "OMA",
      "name": "Eppley Airfield",
      "city": "Omaha",
      "state": "NE",
      "lat": 41.3032,
      "lng": -95.8941,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "ont",
      "code": "ONT",
      "name": "Ontario International",
      "city": "Ontario",
      "state": "CA",
      "lat": 34.056,
      "lng": -117.601,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "orf",
      "code": "ORF",
      "name": "Norfolk International",
      "city": "Norfolk",
      "state": "VA",
      "lat": 36.8953,
      "lng": -76.201,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "pvd",
      "code": "PVD",
      "name": "Rhode Island T. F. Green International",
      "city": "Providence/Warwick",
      "state": "RI",
      "lat": 41.725,
      "lng": -71.4257,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "ric",
      "code": "RIC",
      "name": "Richmond International",
      "city": "Richmond",
      "state": "VA",
      "lat": 37.5052,
      "lng": -77.3197,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "rno",
      "code": "RNO",
      "name": "Reno-Tahoe International",
      "city": "Reno",
      "state": "NV",
      "lat": 39.4991,
      "lng": -119.768,
      "status": "paper",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "roc",
      "code": "ROC",
      "name": "Frederick Douglass Greater Rochester International",
      "city": "Rochester",
      "state": "NY",
      "lat": 43.1189,
      "lng": -77.6724,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "rsw",
      "code": "RSW",
      "name": "Southwest Florida International",
      "city": "Fort Myers",
      "state": "FL",
      "lat": 26.5347,
      "lng": -81.7528,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "sav",
      "code": "SAV",
      "name": "Savannah/Hilton Head International",
      "city": "Savannah",
      "state": "GA",
      "lat": 32.1266,
      "lng": -81.2,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "sju",
      "code": "SJU",
      "name": "Luis Munoz Marin International",
      "city": "San Juan",
      "state": "PR",
      "lat": 18.4394,
      "lng": -66.0018,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "smf",
      "code": "SMF",
      "name": "Sacramento International",
      "city": "Sacramento",
      "state": "CA",
      "lat": 38.6954,
      "lng": -121.591,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "sna",
      "code": "SNA",
      "name": "John Wayne Airport (Orange County)",
      "city": "Santa Ana",
      "state": "CA",
      "lat": 33.6751,
      "lng": -117.8693,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "syr",
      "code": "SYR",
      "name": "Syracuse Hancock International",
      "city": "Syracuse",
      "state": "NY",
      "lat": 43.1112,
      "lng": -76.1063,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "tul",
      "code": "TUL",
      "name": "Tulsa International",
      "city": "Tulsa",
      "state": "OK",
      "lat": 36.1971,
      "lng": -95.8862,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "tus",
      "code": "TUS",
      "name": "Tucson International",
      "city": "Tucson",
      "state": "AZ",
      "lat": 32.115,
      "lng": -110.9381,
      "status": "paper",
      "sources": [
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  },
  {
      "id": "tys",
      "code": "TYS",
      "name": "McGhee Tyson",
      "city": "Knoxville",
      "state": "TN",
      "lat": 35.811,
      "lng": -83.994,
      "status": "paper",
      "sources": [
          "https://modernskies.faa.gov/",
          "https://www.oig.dot.gov/sites/default/files/library-items/FAA%20Terminal%20Flight%20Data%20Manager%20Final%20Report%207.17.24.pdf"
      ]
  }
];
