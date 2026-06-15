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
    slug: 'united-a321xlr-blocked-middle-seat',
    title: 'The Blocked Middle Seat: Inside United\'s Plan to Fly the A321XLR With a Leaner Crew',
    date: '2026-06-12',
    category: 'Operations',
    sources: [
      { name: 'View from the Wing', url: 'https://viewfromthewing.com/united-airlines-confirms-it-will-block-middle-seats-on-new-a321xlrs-to-fly-with-fewer-flight-attendants/' },
      { name: 'Paddle Your Own Kanoo', url: 'https://www.paddleyourownkanoo.com/2026/06/10/united-airlines-is-reportedly-working-on-a-new-economy-product-with-a-blocked-middle-seat-to-reduce-flight-attendant-requirements/' },
      { name: 'Simple Flying', url: 'https://simpleflying.com/united-a321xlr-blocked-middle-seats-flight-attendants/' },
    ],
    summary: 'United is blocking two middle seats on its new A321XLR to hold the cabin at 150 seats — a quiet move that keeps the jet under an FAA flight-attendant threshold. The airline calls it customer investment; the labor math tells a more interesting story.',
    body: `<p>Amid all the excitement over United's first A321XLR, eagle-eyed observers caught a strange detail in the cabin: two seats — 32B and 32E — blocked off by a fixed tray table, unusable. Why would an airline deliberately disable seats on a brand-new airplane it just spent a fortune to buy? The answer, reported in mid-June, is one of the more quietly clever pieces of airline math you'll see this year.</p>

<p>It comes down to flight attendants. Under FAA rules (14 CFR §121.391), an airline needs one flight attendant for every 50 seats onboard — and those thresholds turn into real money over the life of a fleet. The wrinkle on the XLR is that its premium cabin, with enclosed Polaris suites, already pushes the staffing requirement up a notch. By blocking two seats and holding the cabin at exactly 150, United keeps the jet from crossing into the next bracket — which, as View from the Wing lays out, is the difference between four flight attendants and five on every single flight. One fewer crew position, across 50 airplanes, for decades.</p>

<p>United, for its part, isn't hiding it — though it's selling the comfort, not the spreadsheet. Asked about the blocked seats, the airline framed the move as "part of our winning strategy to continually invest in the customer, nose-to-tail." And to be fair, there's a real passenger benefit: a blocked middle gives those rows a 2-2 feel, the same trick European carriers use for their short-haul business class. But the staffing math is the part that made aviation watchers sit up.</p>

<p>Here's where it gets murkier — and where we'd urge caution. A separate, widely-shared report claims United is working on a much broader version of this idea: a permanently blocked middle seat in regular Economy, on a tray that unlocks and stows when the seat is actually needed, that could let a denser jet like the 161-seat Coastliner fly with three flight attendants instead of four. That one traces back to a single Reddit post from someone claiming a contact at United's headquarters, and United declined to comment. So to be precise: the blocked middles on the XLR are real and confirmed; a fleet-wide "block the middle to cut a crew member" program is, for now, speculation.</p>

<p>It's worth watching anyway. If it works, it quietly tilts the economics of narrowbody long-haul in United's favor — and the flight attendants' union will almost certainly have something to say about a strategy whose explicit goal is to staff cabins more thinly. For now, file it under: confirmed on the XLR, fascinating everywhere else.</p>`,
    tags: ['ewr', 'a321neo'],
    ogImage: null,
  },
  {
    slug: 'united-first-a321xlr-757-replacement',
    title: 'The 757 Replacement Arrives: United Takes Delivery of Its First A321XLR',
    date: '2026-06-03',
    category: 'Fleet',
    sources: [
      { name: 'AeroTime', url: 'https://www.aerotime.aero/articles/united-first-airbus-a321xlr-arrives-us' },
      { name: 'One Mile at a Time', url: 'https://onemileatatime.com/news/united-airbus-a321xlr/' },
      { name: 'Aerospace Global News', url: 'https://aerospaceglobalnews.com/news/united-airlines-first-airbus-a321xlr-delivered/' },
    ],
    summary: 'United took delivery of its first Airbus A321XLR on June 3 — the long-range narrowbody that finally retires the 757 on transatlantic flying, with 20 lie-flat Polaris suites, free Starlink Wi-Fi, and a 4,700-nautical-mile reach that opens "long and thin" city pairs no widebody could justify.',
    body: `<p>The airplane United spent all spring teasing is now sitting on the ground in Florida. On June 3, the airline took delivery of its first Airbus A321XLR — registration N64321 — ferried straight from the Airbus line in Hamburg to Tampa, where it goes in for Starlink installation before it ever carries a paying passenger. It's the first of 50 on order, and it enters revenue service this summer. After years of "what finally replaces the 757," United has its answer, and it has a tail number.</p>

<p>Here's why this particular airplane matters more than the average fleet addition. The Boeing 757 was the industry's great irreplaceable workhorse: a narrowbody with the legs to cross the Atlantic, perfect for routes too thin to fill a widebody but too long for an ordinary single-aisle. Nothing built since could quite do the job — until the XLR. With roughly 4,700 nautical miles of range (about 8,700 km), it opens exactly the "long and thin" city pairs United has been circling for years: think Newark to Bogotá, Newark to Edinburgh, and a long list of secondary European and South American cities that could never justify a 767.</p>

<p>The cabin is where United made its statement. The XLR carries 150 seats: 20 Polaris business-class suites in a 1-1, all-aisle-access herringbone layout — the same lie-flat suite with privacy doors rolling out on the new 787-9 and the Coastliner — plus 12 Premium Plus seats, 118 economy seats (36 of them Economy Plus), and a snack bar in the back. That's a strikingly premium-heavy load for a single-aisle jet; United is putting 32 premium seats up front where the old 757 had 16 angled-flat ones. Starlink Wi-Fi, free for MileagePlus members, is standard — which is the whole reason the jet detoured to Tampa before flying a single route.</p>

<p>The honest caveat: it's still a narrowbody. Eight-plus hours in a single-aisle tube will never feel like a widebody, no matter how good the seat, and the XLR makes do with a single forward lavatory shared with the flight deck. But measured against the aging 757s it replaces, it isn't close. Passengers get a real lie-flat suite with a door, 4K screens, fast free internet, and a quieter, more efficient airplane.</p>

<p>Step back and the fleet math is the story United wants you to see. Fifty XLRs on order since December 2019, more than half due to be flying by 2028, paired with the 40 Coastliner A321neos — together, 100 new narrowbodies pushing out 40 tired 757s. The first one flies this summer on routes the 757 works today; the new markets come after. The replacement question that hung over United's transatlantic network for a decade just got its first real answer.</p>`,
    tags: ['ewr', 'a321neo', '757-200'],
    ogImage: null,
  },
  {
    slug: 'united-summer-2026-transatlantic-routes',
    title: 'Split, Bari, Glasgow, Santiago — and Reykjavik: United\'s New European Map Goes Live',
    date: '2026-05-27',
    category: 'Routes',
    sources: [
      { name: 'The Points Guy', url: 'https://thepointsguy.com/news/united-airlines-summer-2026-seasonal-routes/' },
      { name: 'Live and Let\'s Fly', url: 'https://liveandletsfly.com/united-airlines-2026-new-routes/' },
    ],
    summary: 'United\'s summer 2026 transatlantic push is now in the air: four new or returning Newark nonstops to secondary European cities, the airline\'s first-ever Washington-Dulles–Reykjavik route, and a year-round Newark–Seoul launch this fall — part of a network no other U.S. carrier comes close to matching.',
    body: `<p>The summer map United sketched out over the winter is now, finally, in the air. Over five weeks this spring the airline lit up a run of new and returning transatlantic routes out of its East Coast hubs — and the through-line is unmistakable: United is going after the secondary cities nobody else flies nonstop.</p>

<p>Start with Newark. Split, Croatia kicked things off on April 30 (three times a week), followed by Bari, Italy on May 1 (four times a week) — both on a "high-J" Boeing 767-300 stuffed with premium seats: 46 Polaris business-class seats and 22 Premium Plus on the Split configuration alone. Then the narrowbodies took over: daily Newark–Glasgow returned on May 8, and Newark–Santiago de Compostela, the end of the Camino in northwest Spain, launched May 22 — both flown by the Boeing 737 MAX 8. A single-aisle MAX crossing the Atlantic to a Spanish pilgrimage town is its own quiet milestone, and a preview of exactly the thin-route economics the incoming A321XLR is built to exploit.</p>

<p>The most interesting new line on the map isn't out of Newark at all. On May 21, United launched daily Washington-Dulles to Reykjavik on a Boeing 757-200 — its first-ever nonstop between the two cities, and a direct shot at Icelandair on its home turf from United's capital hub. Reykjavik is both a destination in its own right and a connecting funnel into the rest of Europe, and United clearly wants a piece of it.</p>

<p>It isn't only Europe. This fall, on September 1, United turns Newark–Seoul into a year-round daily on the Boeing 787-9 Dreamliner — converting one of the more strategically valuable transpacific links from a seasonal play into a permanent fixture of the Newark long-haul bank. And closer to home, United layered in nine Saturday-only summer leisure routes to markets the big carriers usually ignore: Bangor and Portland in Maine, Halifax and Québec City, Burlington, Spokane, Chattanooga, and Cody, Wyoming — the gateway to Yellowstone.</p>

<p>The strategy underneath all of it is the one United keeps coming back to: own the routes the competition can't or won't fly. The airline says it will serve more than 40 overseas cities no other U.S. carrier touches, building toward nearly 3,000 weekly international roundtrips. Split and Santiago and Reykjavik won't move the revenue needle on their own — but as a set, they're a moat. And every one of them feeds the hubs.</p>`,
    tags: ['ewr', 'iad', '767-300er', '737-max-8', '757-200', '787-9-dreamliner'],
    ogImage: null,
  },
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
