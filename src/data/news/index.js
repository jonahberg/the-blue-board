/**
 * News articles for The Blue Board's United Airlines News Hub.
 *
 * Each article is a curated commentary on United news with links to sources.
 * Tags reference hub slugs (ord, den, etc.) and fleet slugs (737-max-8, etc.)
 * to auto-generate cross-links to existing pages.
 *
 * DATA MODEL:
 *   slug        — URL-safe identifier (a-z, 0-9, hyphens only)
 *   title       — Article headline
 *   date        — ISO date string (YYYY-MM-DD)
 *   category    — Fleet | Routes | Lounges | Policy | Operations
 *   sources     — Array of { name, url } external references
 *   summary     — One-line description for index page + OG meta
 *   body        — Multi-paragraph HTML commentary (your analysis)
 *   tags        — Array of hub/fleet slugs for cross-linking
 *   ogImage     — Optional custom OG image URL (falls back to site default)
 */

import { hubOrder } from '../hubs/index.js';
import { fleetOrder } from '../fleet/index.js';

// ── Validation ──────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORIES = ['Fleet', 'Routes', 'Lounges', 'Policy', 'Operations'];

function validate(articles) {
  const slugs = new Set();
  for (const a of articles) {
    if (!a.slug || !SLUG_RE.test(a.slug)) {
      throw new Error(`News: invalid or missing slug: "${a.slug}"`);
    }
    if (slugs.has(a.slug)) {
      throw new Error(`News: duplicate slug: "${a.slug}"`);
    }
    slugs.add(a.slug);
    if (!a.title) throw new Error(`News [${a.slug}]: missing title`);
    if (!a.date || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) {
      throw new Error(`News [${a.slug}]: invalid or missing date (expected YYYY-MM-DD)`);
    }
    if (!a.summary) throw new Error(`News [${a.slug}]: missing summary`);
    if (!a.body) throw new Error(`News [${a.slug}]: missing body`);
    if (!CATEGORIES.includes(a.category)) {
      throw new Error(`News [${a.slug}]: invalid category "${a.category}" (expected: ${CATEGORIES.join(', ')})`);
    }
    // Validate source URLs are https
    if (a.sources) {
      for (const s of a.sources) {
        if (!s.url || !s.url.startsWith('https://')) {
          throw new Error(`News [${a.slug}]: source URL must be https: "${s.url}"`);
        }
      }
    }
  }
}

// ── Tag resolver ────────────────────────────────────────────────────

const knownHubs = new Set(hubOrder);
const knownFleet = new Set(fleetOrder);

/**
 * Resolves a tag to a { label, url } object, or null if unknown.
 * Hub tags → /hubs/{tag}, fleet tags → /fleet/{tag}.
 */
export function resolveTag(tag) {
  if (knownHubs.has(tag)) {
    return { label: tag.toUpperCase() + ' Hub', url: `/hubs/${tag}` };
  }
  if (knownFleet.has(tag)) {
    // Format fleet label: "737-max-8" → "737 MAX 8"
    const label = tag
      .replace(/-dreamliner$/, ' Dreamliner')
      .replace(/^a(\d)/, 'A$1')
      .replace(/-/g, ' ')
      .replace(/\b(max|er)\b/gi, (m) => m.toUpperCase())
      .replace(/^(\d)/, 'Boeing $1');
    return { label, url: `/fleet/${tag}` };
  }
  console.warn(`News: unknown tag "${tag}" — no cross-link generated`);
  return null;
}

// ── Articles (newest first) ─────────────────────────────────────────

export const articles = [
  {
    slug: 'united-250-planes-coastliner-a321xlr-crj450',
    title: 'United Unveils Coastliner, A321XLR, and CRJ450 — 250+ Aircraft in Two Years',
    date: '2026-03-24',
    category: 'Fleet',
    sources: [
      { name: 'United Airlines Elevated', url: 'https://www.united.com/en/us/newsroom/elevated.html' },
    ],
    summary: 'United announces the most aircraft deliveries of any airline in a two-year period — 250+ new planes by April 2028, headlined by the Coastliner A321neo for transcon, the A321XLR for international, and a reimagined CRJ450 regional jet.',
    body: `<p>United went big today. In a dual-city event out of Chicago and Los Angeles, the airline dropped the next phase of its United Next strategy: more than 250 new aircraft deliveries by April 2028 — the most by any airline in a two-year span — plus three entirely new aircraft variants. This is the kind of fleet announcement that changes the competitive landscape.</p>

<p>Start with the one everyone's going to be talking about: the "Coastliner." It's a custom A321neo subfleet built from the ground up for transcontinental service between SFO, LAX, and Newark. That's it. Those routes, those hubs. And it makes sense — more than 10,000 passengers fly those corridors every day, connecting into United's global networks on both coasts: 17 Pacific destinations from the west coast, 42 Atlantic destinations from Newark. The Coastliner puts a widebody experience on a narrowbody frame: 20 all-aisle-access lie-flat Polaris seats, 12 Premium Plus seats (a first on any domestic narrowbody), 129 Economy seats, and a snack bar in the back of the cabin. United actually removed three seats to make room for it.</p>

<p>Two details that will matter to frequent flyers. First, Polaris lounge access — previously limited to international itineraries — comes to domestic Coastliner passengers. That alone changes the JFK/EWR transcon calculus. Second, the Polaris seat itself is a new patented design, the product of five years of R&D and two rounds of customer sleep trials. It's wider at the shoulder and elbow than comparable seats at Delta and JetBlue, with semi-translucent suite walls that split the difference between privacy and claustrophobia. The plane gets its own livery too — bright blue bands wrapping the aft fuselage, United's name on the belly for the LAX spotters. Fifty on order. First one flies this summer.</p>

<p>Then there's the A321XLR — the airplane that does what the 757 was always supposed to do but couldn't anymore. The 757 carried 16 premium seats. The XLR carries 32. Same Polaris suite as the Coastliner, plus privacy doors, 4K OLED screens at every seat (19-inch in Polaris, 16 in Premium Plus, 13 in Economy), larger bins, and another rear snack bar. It takes over existing 757 routes to smaller European and South American cities this summer, and eventually opens city pairs the 757 couldn't reach. United has 50 XLRs coming, launching with a "Born to Explore" decal. More than half should be flying by 2028.</p>

<p>Between the Coastliner and the XLR, that's 100 new narrowbodies replacing 40 older 757s — and United says the combined fleet will give them nearly double the lie-flat seats of their next closest competitor. That's a staggering gap if it holds.</p>

<p>The wildcard of the day is the CRJ450 — a 41-seat reimagining of the CRJ200, operated by SkyWest. This one's clever. United ripped out the overhead bins in the First cabin entirely and put in a big luggage closet instead. The result is an open, airy feel that reads more Gulfstream than regional jet. Economy gets rollaboard-sized bins — rare on a jet this small — with interior finishes that match the mainline fleet. Starlink Wi-Fi, free for MileagePlus members. It connects smaller cities into Denver and Chicago starting this fall, joining the CRJ550 (which has some of the highest passenger satisfaction scores in the regional fleet) in a premium regional lineup that should top 170 aircraft by 2028.</p>

<p>The full delivery count through April 2028 breaks down like this: 47 Boeing 787-9 Dreamliners with the Elevated interior (33 in the higher-premium configuration), 40 Coastliners, 28 A321XLRs, 18 standard A321neos, and 119 Boeing 737 MAX. For context on how fast United's been moving: since 2021, the airline has taken 22 Dreamliners, 237 MAX, and 67 A321neos. They've retrofitted 70% of the narrowbody mainline fleet, replaced over 100 regional jets with larger aircraft, grown premium seats per North American departure by 40%, and hired 60,000 people.</p>

<p>Scott Kirby framed it as the payoff of a decade-plus investment arc: "We've invested billions in our product, service, and technology as part of our plan to be the best brand loyal airline in the world." CCO Andrew Nocella was more direct: "United is setting the pace and innovating for our customers at a scope and scale unheard of in aviation history — and we're not taking our foot off the gas." Given today's news, that's hard to argue with.</p>`,
    tags: ['sfo', 'lax', 'ewr', 'ord', 'den', 'a321neo', '787-9-dreamliner', '757-200'],
    ogImage: null,
  },
  {
    slug: 'united-elevated-relax-row-starlink-chefs-table',
    title: 'Relax Row, Free Starlink, Chef\'s Table: Inside United\'s Onboard Overhaul',
    date: '2026-03-24',
    category: 'Fleet',
    sources: [
      { name: 'United Airlines Elevated', url: 'https://www.united.com/en/us/newsroom/elevated.html' },
    ],
    summary: 'Alongside 250+ new aircraft, United rolls out a full onboard experience overhaul — Relax Row for Economy long-haul, free Starlink for all MileagePlus members, a Chef\'s Table dining partnership, and seatback screens at every seat across 1,200+ planes.',
    body: `<p>The fleet news grabbed the headlines today, but there's an equally important story buried in the details: United is overhauling what it actually feels like to sit on its airplanes, in every cabin, on every type of flight. This isn't a press release about one new seat or one new route — it's a top-to-bottom rethinking of the onboard product.</p>

<p>The one that jumped off the page is the United Relax Row℠. It's a new Economy cabin product for long-haul international flights that transforms a row of standard economy seats into something closer to a couch. Full details are still coming, but the pitch is aimed squarely at the biggest gap in the airline pricing ladder: the traveler who can't stomach $8,000 for a transatlantic business class ticket but also doesn't want to spend 10 hours folded into a 31-inch seat. That's most people. Air New Zealand has had its Skycouch for years, and it has a cultishly devoted fanbase — if United's version lands well, it could become a quiet revenue monster on those SFO–Singapore and EWR–London legs where Economy passengers are willing to pay a bit more but not three times more.</p>

<p>Starlink is the one that's going to affect the most passengers. United's been rolling it out already on select flights, and the promise is simple: home-speed internet at 35,000 feet, free for any MileagePlus member. Not Platinum. Not Premier 1K. Just... a member. A free loyalty account. That's a major play. It's expected on all United dual-cabin aircraft by the end of 2027, which covers the vast majority of the mainline fleet. If you fly United once a month and you've been putting up with Gogo or paying $8 for two hours of email-speed connectivity, this is the single biggest quality-of-life improvement the airline's made in years. Fast, free Wi-Fi changes whether a cross-country flight is dead time or productive time. It changes whether your kid watches whatever's on the seatback or streams their own thing. It sounds boring on paper but it's the kind of thing that actually drives loyalty.</p>

<p>The food story is interesting too. United's partnering with Chef's Table — the brand behind the Netflix series — to bring dishes from acclaimed chefs onto select routes starting this summer. This is a premium-cabin play, not an Economy one, but it signals where United's head is at: food as a brand statement, not a cost to be minimized. For years, airline catering has been a race to the bottom. Delta invested in it early and it paid off in brand perception. United's now coming in with Netflix-level culinary credibility, which is a different angle than just hiring a celebrity chef to slap their name on a menu.</p>

<p>On the hardware side, the numbers are wild. United wants seatback screens at every seat across more than 1,200 aircraft — that's 227,000 screens within two years. Every screen gets in-seat power and Bluetooth connectivity so you can use your own headphones. The entertainment library is stacking up too: Apple TV, HBO Max, A24 films, Spotify. It's getting to the point where the inflight entertainment on a United 787 might actually be competitive with what you'd watch at home on a Friday night. And bigger overhead bins — the ones that actually fit a rollaboard without the gate-check roulette — are now on close to 570 planes.</p>

<p>Then there are the smaller touches that add up. Softer blankets on long-haul Economy. Better earbuds than the cheap ones that come in the plastic wrap. The United app picking up turn-by-turn wayfinding for connections (anyone who's sprinted through Denver concourse B at 11pm knows the value), a virtual gate that pings you when it's time to board, real-time bag tracking with Apple AirTag integration, and live United Club capacity so you know before you walk over whether it's worth the trip.</p>

<p>None of these things alone win a loyalty war. But taken together — Relax Row, free fast Wi-Fi, Chef's Table food, screens everywhere, bins that work, an app that actually helps — it adds up to a different experience than what United was offering even two years ago. The airline's clearly decided that "premium" isn't just a word for the front of the plane. It's the whole thing. And when you pair this with the 250+ new aircraft coming in, the Coastliner, and the A321XLR, the picture that emerges is an airline that's trying to pull away from the pack at every level. Whether they can execute it all at this pace is the open question — but the ambition is unmistakable.</p>`,
    tags: ['sfo', 'ewr', '787-9-dreamliner'],
    ogImage: null,
  },
  {
    slug: 'kirby-playbook-for-175-oil-invest-more',
    title: 'Scott Kirby\'s Playbook for $175 Oil: Invest More, Not Less',
    date: '2026-03-20',
    category: 'Operations',
    sources: [
      { name: 'United Airlines Newsroom', url: 'https://www.united.com/en/us/newsroom/announcements/cision-125448' },
    ],
    summary: 'CEO Scott Kirby tells employees United is prepared for jet fuel prices that have more than doubled — planning for $175/barrel oil through 2027 while trimming ~5 points of near-term capacity and accelerating investments in new clubs, hub infrastructure, and all 120+ aircraft deliveries for 2026.',
    body: `<p>In a memo to employees, United CEO Scott Kirby laid out the airline's response to jet fuel prices that have more than doubled in three weeks following the war in Iran. Rather than the industry's typical playbook of cost cuts, furloughs, and deferred aircraft orders, Kirby says United will do the opposite: invest more.</p>

<p>The math is sobering — at current prices, United faces an extra $11 billion in annual fuel expense, more than double the airline's best-ever annual profit. But Kirby points to three pillars of preparation: roughly triple the cash reserves United had entering COVID, industry-leading profit margins (United and Delta represented ~100% of total U.S. industry profitability in 2025), and the highest credit rating in 30+ years.</p>

<p>In the near term, United is trimming about 5 points of capacity: canceling off-peak flying (redeyes, Tuesday/Wednesday/Saturday) in Q2 and Q3, pulling a point of capacity at O'Hare, and suspending Tel Aviv and Dubai service. All cuts are planned to restore this fall. Meanwhile, the airline will continue full speed on ~120 new aircraft deliveries this year, including 20 new 787s, and is accelerating investments in new United Clubs, hub infrastructure, and an expansion at Newark targeting 100 widebody departures per day.</p>

<p>The subtext is clear: Kirby sees high oil as a competitive weapon. With weaker carriers describing "hope" as their strategy, United is positioning to acquire assets and absorb network changes if the environment persists — much as it did during COVID.</p>`,
    tags: ['ewr', 'ord'],
    ogImage: null,
  },
  {
    slug: 'united-opens-tickets-for-787-9-elevated-interior',
    title: 'United\'s First 787-9 with Polaris Studio Suites Enters Fleet April 22',
    date: '2026-03-19',
    category: 'Fleet',
    sources: [
      { name: 'PR Newswire (United Airlines)', url: 'https://www.prnewswire.com/news-releases/tickets-on-sale-today-for-uniteds-first-boeing-787-9-dreamliner-with-elevated-interior-flights-302718311.html' },
    ],
    summary: 'United begins selling tickets for its redesigned 787-9 Dreamliner featuring new Polaris Studio suites, 4K OLED screens at every seat, and Bluetooth connectivity throughout — inaugural SFO–Singapore flight departs April 22.',
    body: `<p>United's long-teased "Elevated" interior is finally bookable. Starting today, travelers can purchase seats on the airline's redesigned 787-9 Dreamliner — the most premium-dense international aircraft in United's fleet, with 99 of 222 seats in premium cabins.</p>

<p>The headliner is the new United Polaris Studio℠ suite: eight lie-flat, all-aisle-access seats that are 25% larger than standard Polaris seats, with privacy doors, a companion ottoman, wireless charging, and a massive 27-inch 4K OLED screen — the largest seatback display among U.S. carriers. Even Economy gets a meaningful upgrade: 13-inch 4K OLED screens with Bluetooth at every seat and larger overhead bins.</p>

<p>The inaugural international flight, UA1, departs San Francisco for Singapore on April 22, with SFO–London following on April 30. United plans to have at least 30 Elevated 787-9s flying by the end of 2027 — a significant fleet-wide transformation for long-haul travelers.</p>`,
    tags: ['sfo', '787-9-dreamliner'],
    ogImage: null,
  },
  {
    slug: 'united-delivers-first-737-max-to-guam',
    title: 'United Delivers First 737 MAX to Guam Fleet',
    date: '2026-03-19',
    category: 'Fleet',
    sources: [
      { name: 'United Airlines Newsroom', url: 'https://www.united.com/en/us/newsroom' },
    ],
    summary: 'United Airlines has stationed its first Boeing 737 MAX aircraft at Guam, expanding its Pacific island hub with modern, fuel-efficient narrowbodies.',
    body: `<p>United Airlines has delivered its first Boeing 737 MAX to its Guam hub, marking a significant fleet modernization for the airline's Pacific island operations. The 737 MAX replaces older 737-800s on key island-hopping routes across Micronesia.</p>

<p>The MAX's improved range and fuel efficiency make it well-suited for Guam's unique route network, which connects far-flung island communities across thousands of miles of open ocean. United is the only major U.S. carrier serving Guam as a hub, and the fleet upgrade signals continued investment in the Pacific.</p>

<p>For travelers, the 737 MAX brings Starlink WiFi eligibility, larger overhead bins, and improved cabin pressure — a meaningful upgrade on routes where the aircraft is often the only connection to the outside world.</p>`,
    tags: ['gum', '737-max-8'],
    ogImage: null,
  },
];

// ── Exports ─────────────────────────────────────────────────────────

// Validate at import time — build fails immediately on bad data
validate(articles);

/** Ordered list of slugs (newest first — same order as articles array) */
export const newsOrder = articles.map((a) => a.slug);

/** Map of slug → article for quick lookup */
export const newsMap = Object.fromEntries(articles.map((a) => [a.slug, a]));

/** Categories used across all articles */
export const newsCategories = CATEGORIES;
