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
    slug: 'united-shares-outage-summer-saturday',
    title: '75 Minutes of Downtime, a Full Day of Chaos: Anatomy of United\'s July 18 Meltdown',
    date: '2026-07-18',
    category: 'Operations',
    sources: [
      { name: 'AP via Yahoo', url: 'https://travel.yahoo.com/news/articles/united-airlines-flights-delayed-nationwide-142019752.html' },
      { name: 'The Travel', url: 'https://www.thetravel.com/united-airlines-tech-outage-ground-stops-us-flight-cancellations/' },
      { name: 'AeroXplorer', url: 'https://aeroxplorer.com/articles/united-airlines-technology-outage-disrupts-thousands-of-passengers-across-the-us' },
    ],
    summary: 'United\'s SHARES reservation system went down for about 75 minutes on the morning of July 18 — and that was enough, on a peak-summer Saturday with East Coast storms already brewing, to cancel roughly 268 United flights and delay nearly four in ten. A case study in why airline IT failures never stay small.',
    body: `<p>If you were watching this board on Saturday, July 18, you saw it happen in real time: the delay bars going orange, then red, the cancellation count climbing, Dulles and Newark seizing up. Here's what was behind it. At about 6:00 a.m. Central, SHARES — the passenger service system that underpins United's check-in, boarding, and reservations — went down. It was restored by roughly 7:15 a.m. Seventy-five minutes of downtime. The disruption it caused lasted the rest of the weekend.</p>

<p>The mechanics of why are worth understanding, because they're the same every time. When the reservation system is down, airplanes are fine and crews are fine — but nobody can be checked in, bags can't be tagged, and boarding stops. Every departure in that window leaves late or not at all. Late aircraft miss their next turn, crews time out, and the schedule starts eating itself. Do that at 6 a.m. — the morning bank, when the whole day's schedule is stacked up and ready to launch — on a summer Saturday, and you've poisoned the entire operation before breakfast.</p>

<p>Then the weather arrived. Severe East Coast storms hammered exactly the hubs that were already wounded, and the two failures compounded. By day's end the U.S. system had logged about 2,437 cancellations — to be precise, that's the industry-wide, all-causes number for the day, not a United-only figure. United's own share was roughly 268 cancellations, about 8% of its schedule, plus the worst delay rate of the five biggest carriers: about 39% of its flights ran late. The hardest-hit stations were Washington-Dulles, Newark, and San Francisco — two of them the same hubs United has spent the year holding up as operational success stories.</p>

<p>The uncomfortable part of this story is the system at the center of it. SHARES is old — a Continental inheritance that United has been patching and extending for well over a decade, and the airline has had a string of high-profile outages on it over the years. Every airline has IT failures; Delta's 2024 CrowdStrike recovery took nearly a week. But there's a reason "SHARES outage" is a recognizable phrase to United frequent flyers in a way that has no real equivalent at some competitors. An airline spending billions on Starlink, seatback screens, and new interiors is still running its most operationally critical software on foundations from another era.</p>

<p>The honest framing: United's recovery, by meltdown standards, was actually decent — one bad Saturday and a rough Sunday, not a week-long cascade. But for an airline whose entire premium strategy depends on being the reliable choice, the lesson of July 18 is blunt. The product in the cabin has been transformed. The plumbing underneath it hasn't — and on the wrong Saturday, the plumbing is the product.</p>`,
    tags: ['iad', 'ewr', 'sfo'],
    ogImage: null,
  },
  {
    slug: 'united-q2-2026-earnings-guidance-raise',
    title: 'The $175-Oil Bet Pays Out: United Beats Q2, Raises Guidance, Restores the Schedule',
    date: '2026-07-15',
    category: 'Operations',
    sources: [
      { name: 'United via PR Newswire', url: 'https://www.prnewswire.com/news-releases/united-posts-q2-results-above-wall-street-expectations-and-raises-full-year-2026-adjusted-eps-guidance-despite-a-nearly-6-billion-increase-in-anticipated-fuel-costs-302826793.html' },
      { name: 'CNBC', url: 'https://www.cnbc.com/2026/07/15/united-airlines-ual-2q-2026-earnings.html' },
      { name: 'Aviation A2Z', url: 'https://aviationa2z.com/index.php/2026/07/17/united-airlines-to-retire-80-old-aircraft-in-2027/' },
    ],
    summary: 'United posted $1.99 in adjusted EPS against a $1.88 consensus and raised full-year guidance — while absorbing a fuel bill that\'s up 84% and nearly $6 billion higher than planned. The earnings call had the real news: the full schedule comes back this fall, 80-plus old jets retire in 2027, and Kirby says 20%-higher fares are here to stay.',
    body: `<p>Back in March, when jet fuel doubled in three weeks and Scott Kirby told employees United would plan for $175 oil by investing more instead of retrenching, we called it the boldest bet in the industry and said the proof would come in the numbers. The numbers are in. For the second quarter, United reported adjusted earnings of $1.99 per share against a Wall Street consensus of $1.88, on $17.67 billion in revenue, up 16% year over year. And rather than merely surviving the fuel shock, United raised its full-year adjusted EPS guidance to $9.00–$11.00 — while telling investors that fuel will cost it nearly $6 billion more this year than it planned. The quarter's fuel bill alone was $5.1 billion, up 84% from a year ago.</p>

<p>Look inside the revenue and you see exactly the airline United has spent five years building. Premium revenue up 16%. Loyalty up 11%. Cargo up 23%. Even basic economy up 11%. The premium-heavy mix — all those Polaris suites and Premium Plus cabins we keep writing about — is precisely what's cushioning the fuel blow, because the customers up front don't disappear when fares rise. Margins did compress: 6.2% operating margin versus 8.7% a year ago, and United flagged that fuel volatility since early July will cost about $1.12 per share in the third quarter. The oil is real. The point is that United is absorbing it and still out-earning the estimates.</p>

<p>The earnings call is where the fleet-watchers should lean in. First: the roughly five points of capacity United cut in the spring — the trimmed redeyes, the off-peak days, the point pulled out of O'Hare — comes back this fall. The full schedule returns. (Tel Aviv and Dubai remain suspended through at least early September.) Second: CFO Mike Leskinen said United will retire at least 80 older, less fuel-efficient aircraft in 2027, "a step up from previous years," with the Airbus A319 and A320 fleets wound down by 2030 as the A321neos scale up. At $175 oil, every old thirsty airframe is a liability, and United is acting like it. Third: the first Boeing 737 MAX 10s — 147 on order — are now expected in mid-to-late 2027, up to 20 of them that year. And the Starlink counter keeps spinning: roughly 450 aircraft equipped, a target of 1,000 by the end of this year, the whole fleet by the end of 2027.</p>

<p>Kirby's bluntest line was about your wallet: fares are up about 20% this year, and he framed that as structural — fuel, maintenance, labor, and airport costs have permanently reset, and ticket prices have reset with them. That's a rough message for travelers, but pay attention to the strategic subtext. United and Delta were essentially 100% of U.S. industry profits last year; at these input costs, carriers without a premium revenue base can't cover their bills at prices their customers will pay. Kirby has spent months positioning United to be the buyer, not the seller, if weaker airlines start shedding assets.</p>

<p>The honest caveat is that one good quarter doesn't settle a bet this size — oil could keep climbing, and a $1.12-a-share Q3 headwind is not nothing. But the March playbook — keep the deliveries, keep the clubs, keep the investment, let the balance sheet carry the shock — was designed for exactly this moment, and so far it's doing exactly what Kirby said it would. File this one next to "Scott Kirby's Playbook for $175 Oil" and check back in October.</p>`,
    tags: ['ord', 'ewr', 'a319', 'a320'],
    ogImage: null,
  },
  {
    slug: 'united-a321xlr-elbow-room-economy-plus',
    title: 'Called It: United Will Now Sell You the A321XLR\'s Blocked Middle Seat',
    date: '2026-07-14',
    category: 'Policy',
    sources: [
      { name: 'United via PR Newswire', url: 'https://www.prnewswire.com/news-releases/united-launches-another-economy-class-innovation-economy-plus-seats-with-extra-elbow-room-302825022.html' },
      { name: 'View from the Wing', url: 'https://viewfromthewing.com/united-turns-coach-middle-seats-into-tables-selling-extra-elbow-room-and-staffing-fewer-flight-attendants/' },
      { name: 'Live and Let\'s Fly', url: 'https://liveandletsfly.com/united-airlines-blocked-middle-seats-airbus-jets/' },
    ],
    summary: 'The blocked middle seats we covered in June are now an official product: United will sell an "extra elbow room" Economy Plus row on all 50 A321XLRs, with a custom table where the middle seat used to be and three extra inches of legroom. The staffing math we flagged hasn\'t gone anywhere — United just found a way to get paid for it.',
    body: `<p>A month ago we wrote about the strangest detail on United's brand-new A321XLR: two middle seats, 32B and 32E, deliberately blocked off with fixed tray tables, and the quiet flight-attendant staffing math that explained why. We ended that piece with "file it under: confirmed on the XLR, fascinating everywhere else." Consider the file updated. On July 14, United made it official — and turned it into a product with a price tag.</p>

<p>Here's the announcement: all 50 of United's A321XLRs will feature a special Economy Plus row where the middle seat is replaced by a custom table spanning armrest to armrest, plus three additional inches of legroom over standard Economy Plus. United is pitching it as "extra elbow room" — an economy seat with guaranteed space next to you, no middle-seat roulette, somewhere to put your laptop and your drink at the same time. It becomes bookable later this year; pricing hasn't been announced. Domestic XLR flying starts this fall, with international service into early 2027.</p>

<p>Credit where due: as a product, this is genuinely clever. The premium-economy-without-the-premium-cabin idea — a blocked middle sold as a feature — is what European carriers have done in short-haul business for decades, and travelers demonstrably pay for it. If you're taking a nine-hour narrowbody flight to Europe and can't justify Polaris, a guaranteed empty middle with a table might be the single best value on the airplane, depending entirely on what "pricing to be announced" turns out to mean.</p>

<p>But let's not lose the plot from June, because it hasn't changed. Blocking those middles holds the XLR's seat count at exactly 150 — and under the FAA's one-flight-attendant-per-50-seats rule, that's the line between staffing brackets. Commentators immediately noted that the configuration lets the jet operate domestically with three flight attendants instead of four. United, for its part, points out that it plans to staff most transatlantic XLR flights with five flight attendants, consistent with the 757s the jet replaces — a fair counterpoint, and worth taking at face value for the routes where it applies. Both things can be true: the cabin can be more comfortable and the crew requirement can be lower. What's elegant — or cynical, depending on your seat — is that United found a way to convert a regulatory threshold into ancillary revenue. The seat it blocked to save a crew position is now a seat it sells twice: once as labor savings, once as elbow room.</p>

<p>What we're watching next: the price point, whether the flight attendants' union has anything to say now that the strategy is official, and whether this stays an XLR quirk or starts showing up on other narrowbodies. In June, the fleet-wide version was a single-sourced rumor. After this announcement, it reads a lot more like a roadmap.</p>`,
    tags: ['ewr', 'a321neo'],
    ogImage: null,
  },
  {
    slug: 'united-787-9-elevated-n61101-grounded-again',
    title: 'The Flagship Is a Hangar Queen: N61101 Grounded Again, Days After Boeing "Fixed" It',
    date: '2026-07-04',
    category: 'Fleet',
    sources: [
      { name: 'Paddle Your Own Kanoo', url: 'https://www.paddleyourownkanoo.com/2026/07/04/uniteds-brand-new-787-dreamliner-that-was-sent-back-to-boeing-because-it-kept-breaking-has-been-grounded-just-days-after-being-fixed/' },
      { name: 'Paddle Your Own Kanoo', url: 'https://www.paddleyourownkanoo.com/2026/06/20/uniteds-brand-new-boeing-787-dreamliner-with-swanky-new-cabins-has-been-returned-to-boeing-because-it-keeps-breaking/' },
      { name: 'View from the Wing', url: 'https://viewfromthewing.com/uniteds-brand-new-boeing-787-with-fancy-polaris-suites-is-going-back-to-boeing-because-it-keeps-breaking/' },
    ],
    summary: 'N61101 — the first 787-9 with United\'s Elevated interior and the Polaris Studio suites — spent ten days back at Boeing for recurring collision-avoidance system failures, returned "fixed" on June 30, flew one clean domestic leg, and was grounded again on July 3. The most important airplane in United\'s fleet story keeps refusing to fly.',
    body: `<p>In March we wrote about United opening ticket sales for its first Boeing 787-9 with the new Elevated interior — the eight Polaris Studio suites, the next-generation pods with doors, the 99 premium seats that make it the showcase for everything United Next promises. That airplane is N61101. It is four months old. And it has now been grounded twice in two weeks, including once immediately after Boeing supposedly fixed it.</p>

<p>The timeline reads like a bad relationship. Delivered from Boeing's Charleston line in late February, N61101 was trouble almost immediately — most visibly on April 24, when it turned around minutes after departing Singapore over an electrical burning smell. The recurring gremlin, though, is the TCAS — the traffic alert and collision avoidance system, the electronic last line of defense against midair collisions. An airliner cannot legally be dispatched with TCAS inoperative, so every failure strands the jet wherever it happens to be sitting. After repeated failures disrupted Singapore, London, and domestic rotations, United gave up on line maintenance and, on June 20, ferried the jet to Boeing's Moses Lake facility — the manufacturer taking its own four-month-old airplane back to figure out why it keeps breaking.</p>

<p>Ten days later, on June 30, it came back. Boeing had reportedly replaced both antennas feeding the TCAS — worth noting that detail comes from a single outlet's reporting, but it's consistent with the failure pattern. On July 2, N61101 flew a clean San Francisco–Houston leg and it looked like the saga was over. On July 3, it was supposed to operate the return transatlantic leg of UA939. Cancelled. The TCAS, again. Whatever Boeing fixed in Moses Lake, it wasn't the thing.</p>

<p>Every new airliner has teething problems, and one lemon does not indict a fleet — United has dozens of 787s that fly reliably every day, and 47 more Elevated Dreamliners are scheduled through April 2028. But the specifics here sting. This is the airplane United built its product story around, the one with the suites from the press events, and it has spent a meaningful fraction of its young life either stranded at outstations or parked at the factory. It's also an uncomfortable data point on Boeing delivery quality at the exact moment United's entire fleet plan — the 787s, the incoming MAX 10s — depends on Boeing getting its act together.</p>

<p>For now, the practical takeaway if you've booked the Studio: check your tail number, and don't get attached. The interior is the future of United's long-haul product. The airframe it's bolted into is, so far, a very expensive reminder that the future still has to pass its preflight checks.</p>`,
    tags: ['787-9-dreamliner', 'sfo', 'iah'],
    ogImage: null,
  },
  {
    slug: 'united-first-transatlantic-starlink-777',
    title: 'Starlink Crosses the Atlantic: UA14 Becomes United\'s First Connected Widebody Flight',
    date: '2026-06-22',
    category: 'Fleet',
    sources: [
      { name: 'AeroTime', url: 'https://www.aerotime.aero/articles/united-starlink-transatlantic-widebody-flight' },
      { name: 'AirlineGeeks', url: 'https://airlinegeeks.com/2026/06/22/united-reaches-new-milestone-in-starlink-rollout/' },
    ],
    summary: 'On June 22, a Boeing 777 operating UA14 from Newark to London Heathrow became United\'s first Starlink-equipped mainline widebody flight — free, fast internet finally arriving on the flights where it matters most, with roughly 400 aircraft equipped and the entire widebody fleet targeted by summer 2027.',
    body: `<p>The Starlink rollout we've been tracking since March just cleared its most meaningful milestone yet. On June 22, United flight UA14 from Newark to London Heathrow — flown by a Boeing 777 — became the airline's first mainline widebody service with Starlink aboard, and with it, United's first transatlantic flight offering the home-speed, free-for-MileagePlus-members internet it has been promising. The rollout that started on regional jets and worked through the 737s has finally reached the airplanes that cross oceans.</p>

<p>This is the milestone that actually matters, and it's worth being clear about why. On a 90-minute hop, Wi-Fi is a nice-to-have. On a seven-hour crossing, connectivity is the difference between a workday and a write-off — and long-haul is precisely where legacy satellite systems have been at their worst: overloaded, oversubscribed, and priced like it's 2012. Low-earth-orbit service doesn't degrade mid-ocean the way the old geostationary systems do. The passengers with the most hours in the air, paying the highest fares, have had the worst internet. That inversion is what ended on June 22.</p>

<p>The pace from here is aggressive. As of the UA14 flight, United had roughly 400 aircraft equipped across its regional and mainline fleet, with up to 60 widebodies targeted by the end of this year and the entire widebody fleet by summer 2027. On the Q2 earnings call three weeks later, United updated the count to about 450 and reiterated the bigger targets: 1,000 aircraft by the end of 2026, everything by the end of 2027. For a program that only reached its first mainline narrowbody last fall, that's a remarkable installation tempo — this is why the first A321XLR went to Tampa for its Starlink fit before ever carrying a passenger.</p>

<p>The free part still deserves emphasis, because it's the strategic move. Any MileagePlus member — the free account, not a status tier — gets the full-speed service at no charge. Delta gates its free Wi-Fi behind SkyMiles too, but nobody else is promising Starlink-class speed across an entire widebody fleet on this timeline. If United hits summer 2027, there will be a stretch where the difference between a connected flight to Europe and a frustrating one is simply which airline's logo is on the tail. That's the kind of moat that doesn't show up on a seat map — and exactly the kind United keeps quietly digging.</p>`,
    tags: ['ewr'],
    ogImage: null,
  },
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
