// @ts-check
/**
 * United Hub Tracker — terminal construction + club/lounge buildout data.
 *
 * DATA MODEL:
 *  - One entry per PROJECT (not per hub). The page groups by hub via the `hub` field.
 *  - status: "open"               = operating today (openedDate set)
 *            "under-construction" = shovels in the ground
 *            "announced"          = officially announced, with or without a firm date
 *            "rumored"            = an executive teased it once; no official commitment
 *    The announced/rumored line is load-bearing: readers should never mistake a Kirby
 *    roundtable aside for a committed project.
 *  - builder: who actually funds/builds. "airport-authority" projects (MWAA, Houston Airports,
 *    Chicago DOA, LAWA, Port Authority, DEN) ride on airport capital programs — United is the
 *    tenant/beneficiary, sometimes a funding partner ("joint"). Say so honestly on the page.
 *  - targetDate: as the latest source phrases it ("fall 2026", "end of 2026") — do NOT sharpen
 *    vague targets into fake precision. Slip history belongs in `details`.
 *  - costUsd / sizeSqFt: only where a figure is publishable; disputed figures stay out of the
 *    number fields and get explained in `details` (e.g. IAD Concourse E's $500M-vs-$900M drift).
 *  - sources: every entry cites at least one URL that was read during research.
 *
 * MAINTENANCE (see MAINTENANCE.md):
 *  - United newsroom (united.mediaroom.com), The Points Guy's United coverage, airport-authority
 *    newsrooms (fly2houston, flydulles/MWAA, flychicago, flydenver, panynj, flysfo, lawa).
 *  - After edits: bump unitedHubsMeta.lastUpdated, add a changelog entry, run `bun run test`.
 *
 * Last verified: 2026-07-27
 */

/** @typedef {'club'|'polaris'|'club-fly'|'terminal'|'gates'|'other'} UnitedProjectType */
/** @typedef {'open'|'under-construction'|'announced'|'rumored'} UnitedProjectStatus */
/** @typedef {'united'|'airport-authority'|'joint'} UnitedBuilder */

/**
 * @typedef {Object} UnitedProject
 * @property {string} id            kebab-case, unique
 * @property {string} hub           IATA of hub — must exist in unitedHubs
 * @property {string} name          short traveler-facing name
 * @property {UnitedProjectType} projectType
 * @property {UnitedProjectStatus} status
 * @property {UnitedBuilder} builder
 * @property {string} [targetDate]  latest stated target, source's own phrasing
 * @property {string} [openedDate]  YYYY-MM or YYYY-MM-DD once open
 * @property {number} [sizeSqFt]
 * @property {number} [costUsd]
 * @property {number} [gates]       new gate count if applicable
 * @property {string} details       1–3 sentences, Blue Board voice
 * @property {string[]} sources
 */

/**
 * Hub display data. Coordinates match the hub pages' own airportSchema values
 * (src/data/hubs/*.js) so the two surfaces can never disagree.
 * searchAlias: extra tokens the search box should match (e.g. "Guam" for GUM, whose city is
 * Tamuning and whose airport name contains neither).
 * @type {Record<string, {name: string, city: string, state: string, lat: number, lng: number, quietNote?: string, searchAlias?: string}>}
 */
export const unitedHubs = {
  IAH: { name: "George Bush Intercontinental", city: "Houston", state: "TX", lat: 29.9902, lng: -95.3368 },
  IAD: { name: "Washington Dulles International", city: "Dulles", state: "VA", lat: 38.9531, lng: -77.4565 },
  SFO: { name: "San Francisco International", city: "San Francisco", state: "CA", lat: 37.6213, lng: -122.379 },
  DEN: { name: "Denver International", city: "Denver", state: "CO", lat: 39.8561, lng: -104.6737 },
  ORD: { name: "Chicago O'Hare International", city: "Chicago", state: "IL", lat: 41.9742, lng: -87.9073 },
  EWR: {
    name: "Newark Liberty International", city: "Newark", state: "NJ", lat: 40.6895, lng: -74.1745,
    quietNote: "United finished its EWR lounge portfolio in 2023 — the current construction here is the Port Authority's, not United's.",
  },
  LAX: {
    name: "Los Angeles International", city: "Los Angeles", state: "CA", lat: 33.9425, lng: -118.4081,
    quietNote: "Quiet on United's side — its $573M Terminal 7/8 rebuild wrapped back in 2019, and LAX isn't on United's 2026 club list. What's moving here is LAWA's.",
  },
  GUM: {
    name: "A.B. Won Pat International", city: "Tamuning", state: "GU", lat: 13.4834, lng: 144.796,
    searchAlias: "Guam",
    quietNote: "Mostly quiet. A local report of a new United Club 'nearing completion' couldn't be corroborated — the article has since vanished and neither United nor the airport has announced one.",
  },
};

/** @type {UnitedProject[]} */
export const unitedProjects = [
  // ───────────────────────────── IAH ─────────────────────────────
  {
    id: "iah-terminal-b",
    hub: "IAH",
    name: "Terminal B transformation",
    projectType: "terminal",
    status: "under-construction",
    builder: "joint",
    targetDate: "fall 2026",
    costUsd: 2_550_000_000,
    gates: 22,
    details:
      "United's rebuild of 1969-vintage Terminal B: a 765,000 sq ft North Concourse with 22 new gates, a nearly doubled central processor for check-in, security and baggage claim behind ~67,000 sq ft of glass, 18 modernized South Concourse regional gates, and a new bag system. United is in for $1.9B+, the City of Houston ~$624M. The B lobby has been closed since January 2025 — B passengers check in at Terminal C until it reopens.",
    sources: [
      "https://www.fly2houston.com/airport-business/newsroom/articles/item/visible-progress-defines-the-iah-terminal-b-transformation/",
      "https://www.fly2houston.com/airport-business/newsroom/articles/item/iah-terminal-b-update-houstons-bold-blueprint-for-the-future-of-travel/",
      "https://stocktitan.net/news/UAL/united-houston-airport-system-invest-more-than-2b-in-terminal-b-o13kihdu1b03.html",
      "https://simpleflying.com/36-new-gates-one-us-airline-wins-big-airport-expansions-2026/",
    ],
  },
  {
    id: "iah-club-b-north",
    hub: "IAH",
    name: "United Club, Terminal B North",
    projectType: "club",
    status: "under-construction",
    builder: "united",
    targetDate: "by end of 2026",
    sizeSqFt: 54_000,
    details:
      "The headliner: a 54,000 sq ft club on the new North Concourse's mezzanine — the largest in United's network and likely the largest airline-branded lounge in the country, more than 50% bigger than the Denver club that currently holds United's crown. Tied to the concourse's fall 2026 completion, so if the concourse slips, the club slips.",
    sources: [
      "https://thepointsguy.com/news/united-airlines-lounge-plans-2026/",
      "https://www.fly2houston.com/airport-business/newsroom/articles/item/visible-progress-defines-the-iah-terminal-b-transformation/",
    ],
  },
  {
    id: "iah-club-fly",
    hub: "IAH",
    name: "United Club Fly, Terminal B South",
    projectType: "club-fly",
    status: "open",
    builder: "united",
    openedDate: "2025-02-25",
    details:
      "United's second grab-and-go Club Fly (after Denver), near gates B12/B20: barista coffee, grab-and-go food, a charging counter — no seating, no alcohol. Built for connectors who want ten good minutes, not two loitering hours.",
    sources: [
      "https://united.mediaroom.com/2025-02-25-United-Opens-Grab-and-Go-Club-in-Houston",
      "https://thepointsguy.com/news/united-club-fly-houston/",
    ],
  },
  {
    id: "iah-itrp",
    hub: "IAH",
    name: "International terminal redevelopment (ITRP)",
    projectType: "terminal",
    status: "open",
    builder: "airport-authority",
    openedDate: "2026-02",
    costUsd: 1_460_000_000,
    details:
      "Houston Airports' own $1.46B program — not United's money, but United's international passengers live in it: the six-gate D-West pier (open since October 2024), a new international ticketing hall, and a rebuilt roadway. 'Open' here means substantially complete — the airport's stated February 2026 finish for the last item, baggage-system certification, not a ribbon-cutting.",
    sources: [
      "https://communityimpact.com/houston/lake-houston-humble-kingwood/transportation/2026/01/29/iah-to-wrap-up-146b-terminal-redevelopment-program-in-early-2026/",
    ],
  },

  // ───────────────────────────── IAD ─────────────────────────────
  {
    id: "iad-concourse-e",
    hub: "IAD",
    name: "Concourse E",
    projectType: "terminal",
    status: "under-construction",
    builder: "airport-authority",
    targetDate: "fall 2026",
    sizeSqFt: 435_000,
    gates: 14,
    details:
      "A 435,000 sq ft midfield concourse built by MWAA and occupied entirely by United: 14 gates sized for both narrowbody and widebody aircraft, 46,000 sq ft of concessions, and a direct AeroTrain connection. MWAA floated September as a possible opening month in mid-July but has set no date. The published cost has drifted — United's 2024 announcement said 'more than $500 million'; 2026 grant coverage puts phase 1 near $900M — so we don't print a single number.",
    sources: [
      "https://www.flydulles.com/Next",
      "https://www.prnewswire.com/news-releases/more-than-half-a-billion-dollar-expansion--modernization-coming-to-uniteds-washington-dulles-hub-302320375.html",
      "https://www.ffxnow.com/2026/05/20/dulles-airport-lands-41m-federal-grant-for-concourse-e-construction/",
    ],
  },
  {
    id: "iad-club-concourse-e",
    hub: "IAD",
    name: "United Club, Concourse E (flagship)",
    projectType: "club",
    status: "under-construction",
    builder: "joint",
    targetDate: "fall 2026",
    sizeSqFt: 40_000,
    details:
      "United's new flagship Dulles club: ~40,000 sq ft above the AeroTrain escalators, seating around 650 — a ~70% jump in United Club space at IAD. The design riffs on L'Enfant's DC street grid ('there's no cul-de-sacs, there's no dead ends,' per United's club chief). Buffet and bar, no showers. Opens with the concourse.",
    sources: [
      "https://thepointsguy.com/news/united-club-washington-dulles-makeover-new-space/",
      "https://thepointsguy.com/news/united-airlines-lounge-plans-2026/",
      "https://www.prnewswire.com/news-releases/more-than-half-a-billion-dollar-expansion--modernization-coming-to-uniteds-washington-dulles-hub-302320375.html",
    ],
  },
  {
    id: "iad-cd-club-renovations",
    hub: "IAD",
    name: "C/D United Club renovations",
    projectType: "club",
    status: "announced",
    builder: "joint",
    details:
      "The three existing C/D clubs stay open after Concourse E debuts, and United says they'll 'evolve' with renovations as the wider Dulles redevelopment progresses. No scope, budget, or timeline published — announced in the loosest sense.",
    sources: ["https://thepointsguy.com/news/united-club-washington-dulles-makeover-new-space/"],
  },
  {
    id: "iad-kirby-second-club",
    hub: "IAD",
    name: "A second, even bigger Dulles club",
    projectType: "club",
    status: "rumored",
    builder: "united",
    details:
      "Kirby has teased a future Dulles club bigger than both the Concourse E club and the Houston flagship, sited on a proposed connector between the main terminal and the A/B concourse. His entire on-record commitment: 'It'll be a big club.' The connector itself only exists inside MWAA's not-yet-released master plan. File under rumor until United says otherwise.",
    sources: ["https://thepointsguy.com/news/united-airlines-lounge-plans-2026/"],
  },
  {
    id: "iad-concourse-e-phase-2",
    hub: "IAD",
    name: "Concourse E phase 2",
    projectType: "gates",
    status: "announced",
    builder: "airport-authority",
    targetDate: "start ~2028",
    details:
      "MWAA plans to extend Concourse E with more gates plus screening for connecting passengers, reportedly starting around 2028 — part of a Dulles-wide revitalization plan (estimates run $20B+) that MWAA was 'putting final touches on' as of mid-July 2026. Proposal-stage dates; treat as soft.",
    sources: [
      "https://www.ffxnow.com/2026/05/20/dulles-airport-lands-41m-federal-grant-for-concourse-e-construction/",
      "https://www.ffxnow.com/2026/07/17/mwaa-almost-ready-to-unveil-dulles-expansion-plan-sought-by-trump/",
    ],
  },

  // ───────────────────────────── SFO ─────────────────────────────
  {
    id: "sfo-t2-club",
    hub: "SFO",
    name: "United Club, Terminal 2",
    projectType: "club",
    status: "announced",
    builder: "united",
    targetDate: "by end of 2026",
    sizeSqFt: 25_000,
    details:
      "United's fourth and largest SFO club: 25,000 sq ft in Terminal 2 with the feature nobody else in the network has — a 4,000 sq ft heated outdoor terrace overlooking the airfield, United's biggest outdoor lounge space ever. Revealed June 2026 with renderings; 'by the end of 2026' is the only date United has put on it.",
    sources: [
      "https://thepointsguy.com/news/united-club-san-francisco-terrace-lounge/",
      "https://simpleflying.com/united-airlines-overhaul-san-francisco-lounges/",
    ],
  },
  {
    id: "sfo-t3-west",
    hub: "SFO",
    name: "Terminal 3 West modernization",
    projectType: "terminal",
    status: "under-construction",
    builder: "airport-authority",
    targetDate: "fall 2027 (first phase)",
    sizeSqFt: 650_000,
    costUsd: 2_600_000_000,
    details:
      "SFO's $2.6B seismic rebuild of the western half of United's home terminal: a new centralized checkpoint, self bag-drop, and 200,000 sq ft of added space. The traveler cost today: United's west T3 counters have moved to Terminal 2 and part of the T3 departures curb is closed into 2027. Airport-funded — United is the anchor tenant, not the builder.",
    sources: [
      "https://www.futuretravelexperience.com/2024/08/sfo-launches-2-6bn-terminal-3-west-modernization-project-to-create-an-extraordinary-airport-experience/",
      "https://airportindustry-news.com/sfo-outlines-changes-to-operations-during-west-terminal-3-modernisation/",
    ],
  },

  // ───────────────────────────── DEN ─────────────────────────────
  {
    id: "den-club-b-east",
    hub: "DEN",
    name: "United Club B-East",
    projectType: "club",
    status: "open",
    builder: "united",
    openedDate: "2023-09",
    sizeSqFt: 35_000,
    details:
      "The current title-holder: United's largest club in the network at ~35,000 sq ft — until Houston's 54,000 sq ft flagship opens and takes the crown. Still the benchmark for what United means by a 'big' club.",
    sources: [
      "https://www.prnewswire.com/news-releases/united-opens-two-new-clubs-in-denver-including-its-largest-club-in-the-world-301925629.html",
      "https://united.mediaroom.com/news-releases?item=125398",
    ],
  },
  {
    id: "den-club-b-west",
    hub: "DEN",
    name: "United Club B-West",
    projectType: "club",
    status: "open",
    builder: "united",
    openedDate: "2025-07-31",
    sizeSqFt: 33_000,
    details:
      "United's fourth Denver lounge: 33,000 sq ft over two levels opposite gate B32, 600+ seats, two bars. Its opening pushed Denver to ~100,000 sq ft of United club space seating nearly 1,600 — the biggest club footprint at any hub.",
    sources: [
      "https://united.mediaroom.com/news-releases?item=125398",
      "https://thepointsguy.com/news/united-airlines-new-denver-club-b-west-concourse",
    ],
  },
  {
    id: "den-club-fly",
    hub: "DEN",
    name: "United Club Fly, B-East",
    projectType: "club-fly",
    status: "open",
    builder: "united",
    openedDate: "2022-11",
    sizeSqFt: 1_500,
    details:
      "The original grab-and-go experiment, between gates B61 and B63: about 1,500 sq ft, ~16 seats, coffee and cold food for connectors. The concept United later copied to Houston.",
    sources: [
      "https://upgradedpoints.com/news/united-club-fly-denver/",
      "https://www.flydenver.com/relax/united-club-fly-b-east/",
      "https://www.prnewswire.com/news-releases/united-customers-can-grab-and-go-at-new-airport-club-in-denver-301669645.html",
    ],
  },
  {
    id: "den-polaris",
    hub: "DEN",
    name: "Polaris Lounge Denver",
    projectType: "polaris",
    status: "announced",
    builder: "united",
    details:
      "Announced in May 2023 as coming 'in a couple of years' — three years on, United has said only that design work has started. No construction, no size, no date. Denver would be the seventh and final domestic Polaris lounge, planned for the A-West mezzanine. The cleanest example on this page of announced-with-a-date-that-evaporated.",
    sources: [
      "https://united.mediaroom.com/news-releases?item=125398",
      "https://thepointsguy.com/news/united-polaris-lounge-denver",
    ],
  },
  {
    id: "den-c-west-gates",
    hub: "DEN",
    name: "Concourse C-West extension (11 gates)",
    projectType: "gates",
    status: "announced",
    builder: "airport-authority",
    targetDate: "timing not finalized",
    sizeSqFt: 400_000,
    costUsd: 700_000_000,
    gates: 11,
    details:
      "DEN's $700M, 11-gate westward extension of Concourse C under its Vision 100 plan. The airport says there's a 'waiting list' for the gates but hasn't said who gets them — United and Southwest are the presumed contenders. Airport project; United connection unconfirmed.",
    sources: [
      "https://thepointsguy.com/news/denver-airports-11-new-gates",
      "https://thebulkheadseat.com/denver-international-airport-is-adding-11-gates-as-part-of-400000-square-foot-expansion/",
    ],
  },
  {
    id: "den-great-hall",
    hub: "DEN",
    name: "Great Hall terminal overhaul",
    projectType: "terminal",
    status: "under-construction",
    builder: "airport-authority",
    targetDate: "end of 2027",
    details:
      "DEN's multi-year rebuild of the main terminal — the part every United flyer touches is security: the 17-lane East Checkpoint opened in August 2025 (early and under budget), more lanes arrive late summer 2026, and the whole program wraps by end of 2027.",
    sources: [
      "https://www.flydenver.com/about-den/projects-and-infrastructure/great-hall-program/",
      "https://www.tsa.gov/news/press/releases/2025/08/04/tsa-begin-operations-new-east-security-checkpoint-den",
    ],
  },

  // ───────────────────────────── ORD ─────────────────────────────
  {
    id: "ord-polaris-renovation",
    hub: "ORD",
    name: "Polaris Lounge renovation",
    projectType: "polaris",
    status: "open",
    builder: "united",
    openedDate: "2025-04-29",
    sizeSqFt: 25_000,
    details:
      "Reopened 50% larger at nearly 25,000 sq ft — 350+ seats, an expanded dining room, and what United says makes it the first US airline running two full-service bars in a business-class lounge. United's most recent finished lounge investment anywhere.",
    sources: [
      "https://www.prnewswire.com/news-releases/reimagined-united-polaris-lounge-opens-in-chicago-with-50-more-space-and-crate--barrel-decor-302440452.html",
      "https://upgradedpoints.com/news/first-look-renovated-polaris-lounge-chicago-ohare/",
    ],
  },
  {
    id: "ord-satellite-1",
    hub: "ORD",
    name: "Satellite Concourse 1 (19 gates)",
    projectType: "gates",
    status: "under-construction",
    builder: "joint",
    targetDate: "late 2028",
    sizeSqFt: 580_000,
    costUsd: 1_300_000_000,
    gates: 19,
    details:
      "The first big piece of the $8.5B O'Hare expansion actually being built: a 580,000 sq ft satellite south of Concourse C, 19 gates convertible between 18 narrowbody and 9 widebody positions. Ground broke August 2025; foundations were ~35% done by June 2026. The City builds it; United and American fund much of it through their rates — and how the gates split between them hasn't been published.",
    sources: [
      "https://news.constructconnect.com/chicago-ohares-1.3b-concourse-d-construction-shifts-to-vertical-build",
      "https://www.chicago.gov/city/en/depts/mayor/press_room/press_releases/2025/august/Concourse-D-Groundbreaking.html",
    ],
  },
  {
    id: "ord-satellite-2",
    hub: "ORD",
    name: "Satellite Concourse 2",
    projectType: "gates",
    status: "announced",
    builder: "joint",
    targetDate: "unsettled — 2029 at best, 2034 in some reporting",
    details:
      "The second satellite (~460,000 sq ft, roughly 24 gates by unofficial counts) is genuinely up in the air: Chicago's aviation chief says it proceeds only 'if enough funding remains after other work,' while one City proposal would pull it forward to 2029. Gate count and date are both soft.",
    sources: [
      "https://chicago.suntimes.com/city-hall/2026/02/05/chicago-aviation-chief-michael-mcmurray-ohare-expansion-video",
      "https://www.dailyherald.com/20251203/transportation/ohare-conundrum-could-upend-when-global-terminal-new-concourses-are-built/",
    ],
  },
  {
    id: "ord-global-terminal",
    hub: "ORD",
    name: "O'Hare Global Terminal",
    projectType: "terminal",
    status: "announced",
    builder: "joint",
    targetDate: "unsettled — 2032 on the books, later in the city's reshuffle",
    details:
      "The Studio Gang-designed replacement for Terminal 2 that would finally let United connect domestic and international under one roof. Announced in 2018 with a 2026 target; construction hasn't started, 2032 is the completion date on the books, and Chicago was still renegotiating sequencing with United and American as of late 2025, with scenarios running past 2033. The definitive case study in why this page distinguishes 'announced' from 'under construction.'",
    sources: [
      "https://ord21.com/projects/Pages/O'Hare-Global-Terminal.aspx",
      "https://www.dailyherald.com/20251203/transportation/ohare-conundrum-could-upend-when-global-terminal-new-concourses-are-built/",
    ],
  },

  // ───────────────────────────── EWR ─────────────────────────────
  {
    id: "ewr-polaris-dining",
    hub: "EWR",
    name: "Polaris Lounge dining room expansion",
    projectType: "polaris",
    status: "open",
    builder: "united",
    openedDate: "2025-06-21",
    sizeSqFt: 1_500,
    details:
      "A dedicated 1,500 sq ft à-la-carte dining room with Manhattan skyline views, taking the Terminal C Polaris Lounge past 30,000 sq ft — the second-largest Polaris in the network, behind SFO. The most recent United-funded work at EWR; nothing newer is announced.",
    sources: [
      "https://onemileatatime.com/news/united-polaris-lounge-newark-expanded-dining-room/",
      "https://thepointsguy.com/news/united-polaris-lounge-newark-dining-room/",
    ],
  },
  {
    id: "ewr-terminal-a-gates",
    hub: "EWR",
    name: "Terminal A gate expansion",
    projectType: "gates",
    status: "announced",
    builder: "airport-authority",
    details:
      "The Port Authority's record $45B 2026–2035 capital plan funds design and construction of additional Terminal A gates. To be clear about who benefits: United's hub lives in Terminal C — Terminal A hosts American, Delta, JetBlue and others — so this is airport-level capacity relief around United's operation, not new United gates. No gate count, cost, or dates have been published.",
    sources: [
      "https://www.panynj.gov/port-authority/en/press-room/press-release-archives/2025-press-releases/port-authority-board-of-commissioners-approves-record--45-billio.html",
      "https://aviationweek.com/air-transport/airports-networks/port-authority-plans-laguardia-newark-terminal-rebuilds",
    ],
  },
  {
    id: "ewr-airtrain",
    hub: "EWR",
    name: "AirTrain replacement",
    projectType: "other",
    status: "under-construction",
    builder: "airport-authority",
    targetDate: "2030",
    costUsd: 3_500_000_000,
    details:
      "The Port Authority's $3.5B replacement of the 1996 monorail — three new stations, capacity up from ~33,000 to ~50,000 daily riders. Ground broke October 2025. For United flyers this is the biggest day-to-day construction pain at EWR between now and 2030, including extended shutdowns of the old system.",
    sources: [
      "https://www.panynj.gov/port-authority/en/press-room/press-release-archives/2026-press-releases/port-authority-advances--3-5-billion-airtrain-newark-replacement.html",
    ],
  },

  // ───────────────────────────── LAX ─────────────────────────────
  {
    id: "lax-people-mover",
    hub: "LAX",
    name: "Automated People Mover (T7/T8 station)",
    projectType: "other",
    status: "under-construction",
    builder: "airport-authority",
    targetDate: "October 2026 at the earliest",
    details:
      "LAWA's 2.25-mile train to the rental-car center and Metro, with its east station serving United's Terminals 7/8. A monument to slipped dates: originally due March 2023, projected finished January 2026 by its lenders' analysts — now ~95% complete with an October 2026 posted date that was already wobbling toward November within days, while LAWA and its contractor fight over money. Not United's project, but it's the thing that will actually change how you get to a United flight at LAX.",
    sources: [
      "https://crankyflier.com/2026/07/23/lets-dig-in-to-the-lax-people-mover-saga/",
      "https://www.lawa.org/transforminglax/projects/terminals-7-and-8",
    ],
  },

  // ───────────────────────────── GUM ─────────────────────────────
  {
    id: "gum-lobby",
    hub: "GUM",
    name: "Check-in lobby refresh",
    projectType: "other",
    status: "open",
    builder: "united",
    openedDate: "2025-12-01",
    details:
      "United rebuilt its Guam check-in lobby with 15 next-generation kiosks and new bag-drop lanes — checking in now takes under two minutes, United says. Announced for mid-October 2025, ribbon-cut December 1: a six-week slip even the small projects aren't immune to.",
    sources: [
      "https://united.mediaroom.com/2025-09-24-United-Transforms-Customer-Experience-in-Guam",
      "https://guam.stripes.com/travel/united-guam-airport-lobby.html",
      "https://www.mbjguam.com/united-airlines-unveils-refreshed-airport-check-lobby",
    ],
  },
];

export const unitedHubsMeta = {
  slug: "united-hubs",
  name: "United Hub Tracker",
  lastUpdated: "2026-07-27",
  // Headline stats that can't be derived from the entries above. Counts of projects/clubs ARE
  // derived at build time — never hardcode them here (tests pin that).
  stats: {
    newClubSqFt2026: {
      label: "new club space opening in 2026",
      value: "~119,000 sq ft",
      note: "IAH 54,000 + IAD 40,000 (MWAA's figure; TPG says 39,000) + SFO 25,000 — the three clubs United has publicly committed to opening by end of 2026.",
      source: "https://thepointsguy.com/news/united-airlines-lounge-plans-2026/",
    },
    newGates2026: {
      label: "new gates targeted for fall 2026",
      value: "36",
      note: "22 at IAH Terminal B North + 14 at IAD Concourse E.",
      source: "https://simpleflying.com/36-new-gates-one-us-airline-wins-big-airport-expansions-2026/",
    },
    largestClub: {
      label: "largest club in the network (once IAH opens)",
      value: "54,000 sq ft",
      note: "Today's largest is Denver B-East at ~35,000 sq ft.",
      source: "https://thepointsguy.com/news/united-airlines-lounge-plans-2026/",
    },
  },
  changelog: [
    { date: "2026-07-27", entry: "Tracker first published — 8 hubs, 26 projects." },
    { date: "2026-07-26", entry: "United pulls 11 planned O'Hare routes after the FAA extends its ORD schedule cap through October 2027." },
    { date: "2026-07-09", entry: "O'Hare's annual gate shuffle lands: American wins back three gates effective October 2026, though United still nets two more than last year (one via reallocation, one bought from Spirit)." },
    { date: "2026-06-16", entry: "SFO Terminal 2 club revealed: 25,000 sq ft with a 4,000 sq ft heated outdoor terrace — United's largest-ever outdoor lounge space." },
    { date: "2026-06-11", entry: "First look inside the ~40,000 sq ft Dulles Concourse E club — opening with the concourse this fall." },
    { date: "2026-05-20", entry: "IAD Concourse E lands a $41.8M FAA grant; MWAA says the 14-gate first phase is on track for fall." },
    { date: "2026-04-14", entry: "United quietly cuts Polaris Lounge access for most Star Alliance partners — the crowding fight comes to the premium side." },
    { date: "2026-04-01", entry: "Kirby's mandate goes on the record: 'build a club that is oversized' — and he teases a second, even bigger Dulles club (no date, no commitment)." },
    { date: "2025-12-01", entry: "Guam check-in lobby refresh opens — six weeks behind its announced date." },
    { date: "2025-07-31", entry: "Denver B-West club opens: 33,000 sq ft, taking DEN to ~100,000 sq ft of United club space." },
    { date: "2025-06-21", entry: "Newark Polaris Lounge gets a 1,500 sq ft dining room expansion." },
    { date: "2025-04-29", entry: "O'Hare Polaris Lounge reopens 50% larger with the first two-bar setup in a US business-class lounge." },
    { date: "2025-02-25", entry: "Houston gets United's second grab-and-go Club Fly, in Terminal B South." },
  ],
};
