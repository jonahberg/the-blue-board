// ═══ SPECIAL LIVERIES ═══
// United aircraft wearing a special (non-standard) paint scheme, keyed by registration.
//
// This list backs a public promise ("is my plane wearing a special paint job?"), so it is
// curated for ACCURACY over coverage: a wrong livery claim is worse than a missing one.
// Rules for an entry, checked by tests/special-livery.test.js:
//  - `tail` is the registration as the live feed's `reg` field carries it (uppercase, no dash).
//  - `sources` holds at least two independent pages that name the tail (a United press
//    release that names the tail counts on its own), and at least one of them shows the
//    aircraft still in the scheme recently — a livery that has been painted over comes OUT.
//  - `verified` is the date those sources were last checked.
//  - Decal-only aircraft (a "United Together" or Aviate title, the 100-year sticker) are not
//    paint jobs and are left out; the fleet site's own "special" column already flags some.
//
// Deliberately omitted on 2026-10-04 (re-check before adding):
//  - N14102 "Her Art Here: New York/New Jersey" and N14106 "Her Art Here: California" — both
//    photographed back in standard colours (Nov 2025 and Mar 2026).
//  - N645SY "Mountain Ascent" (SkyWest E175) — announced Sep 2026, enters service early 2027.
//  - N75436, Continental's 2009 retro jet — since repainted; the scheme lives on N75435.
//
// Plain ESM on purpose: nothing under api/ may import it (Node ESM and bare JSON imports).

/**
 * @typedef {{
 *   tail: string,
 *   name: string,
 *   short?: string,
 *   type?: 'commemorative'|'heritage'|'sustainability'|'alliance',
 *   description: string,
 *   since?: string,
 *   sources: string[],
 *   verified: string,
 * }} SpecialLivery
 */

const VERIFIED = '2026-10-04';

const STARS_AND_STRIPES_SOURCES = [
  'https://united.mediaroom.com/2026-06-15-United-Celebrates-America-with-Custom-250th-Anniversary-Livery-and-Military-Pilot-Hiring-Program-Milestone',
  'https://runwaygirlnetwork.com/2026/06/united-airlines-leans-into-americas-250th-with-stars-and-stripes-livery/',
  'https://en.airnavradar.com/blog/united-airlines-unveils-stars-and-stripes-special-livery-to-celebrate-americas-250th-anniversary',
];

const PLANECAPTURES = 'https://planecaptures.com/collection/united-airlines-special-colors';

const STAR_ALLIANCE = {
  name: 'Star Alliance',
  short: 'Star Alliance',
  type: /** @type {const} */ ('alliance'),
  description:
    'Star Alliance colors: large STAR ALLIANCE titles on a white fuselage and a black tail with the alliance logo, for the alliance United co-founded in 1997.',
};

/** @type {SpecialLivery[]} */
export const SPECIAL_LIVERIES = [
  {
    tail: 'N91007',
    name: 'Stars and Stripes',
    short: 'Stars & Stripes',
    type: 'commemorative',
    description:
      "United's America 250 design, a deep-blue fuselage with 50 white stars and red-and-white stripes, unveiled in June 2026 on this 787-10 and one 737-800.",
    since: '2026',
    sources: [
      ...STARS_AND_STRIPES_SOURCES,
      'https://www.flickr.com/photos/133114814@N02/55567175109/',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N78285',
    name: 'Stars and Stripes',
    short: 'Stars & Stripes',
    type: 'commemorative',
    description:
      "United's America 250 design, a deep-blue fuselage with 50 white stars and red-and-white stripes, unveiled in June 2026 on this 737-800 and one 787-10.",
    since: '2026',
    sources: [
      ...STARS_AND_STRIPES_SOURCES,
      'https://www.flightaware.com/photos/view/53923-7cd1562115f76950e43b7511b3722972a4f27510',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N75435',
    name: 'Continental retro',
    short: 'Continental retro',
    type: 'heritage',
    description:
      'A retro Continental Airlines scheme, a nod to the airline United merged with in 2010.',
    sources: [
      PLANECAPTURES,
      'https://iac.aero/iac-completes-united-airlines-retro-continental-airlines-paint-livery-in-amarillo-tx/',
      'https://www.flightaware.com/photos/view/19044427-413aa30c2e6ce8a16d9bc68f389bda0f74b508aa',
      'https://www.flickr.com/photos/perspectivephotography/55557443289/',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N475UA',
    name: 'Friend Ship',
    short: 'Friend Ship retro',
    type: 'heritage',
    description:
      "United's 1970s \"Friend Ship\" scheme, with red and blue cheatlines and stars on the tail, applied to this A320 in 2011 for the airline's 85th anniversary.",
    since: '2011',
    sources: [
      'https://www.nycaviation.com/2011/04/photos-united-airlines-reveals-retro-friend-ship-livery/14834',
      'https://simpleflying.com/united-airlines-friendship-airbus-a320-guide/',
      'https://www.flickr.com/photos/154462236@N03/55533395387/',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N24988',
    name: 'The Future is SAF',
    short: 'Future is SAF',
    type: 'sustainability',
    description:
      'A sustainable-aviation-fuel livery with blue, teal and green bands along the fuselage and "The future is SAF" on the engines.',
    since: '2024',
    sources: [
      'https://www.aeroxplorer.com/articles/united-airlines-paints-787-in-special-saf-livery.php',
      'https://www.flickr.com/photos/freightcarkid/54204316047/',
      'https://www.flightaware.com/photos/view/2408666-1f169d4f3bc18ebad2fc7d3391b48c7fd9e2996f',
    ],
    verified: VERIFIED,
  },

  // ── Star Alliance (11) ──
  {
    tail: 'N14219',
    ...STAR_ALLIANCE,
    sources: [
      PLANECAPTURES,
      'https://www.flightaware.com/photos/view/2410757-a284e934d9051bd5b07137108351564de5f9a96d',
      'https://www.flickr.com/photos/bwi2muc/55563156623/',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N26210',
    ...STAR_ALLIANCE,
    sources: [
      PLANECAPTURES,
      'https://commons.wikimedia.org/wiki/File:N26210_MIA_Line_Up_And_Wait_UA_B737_824_Star_Alliance_Small_(53489496113).png',
      'https://www.flightaware.com/photos/view/1352940-a2bda51abb57dc6aab022c8897e60c33fff3ebc6',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N76516',
    ...STAR_ALLIANCE,
    sources: [
      PLANECAPTURES,
      'https://commons.wikimedia.org/wiki/File:United_Airlines_Boeing_737-800_N76516_departing_Boston_May_2025.jpg',
      'https://www.flickr.com/photos/162233410@N04/55441619238/',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N14120',
    ...STAR_ALLIANCE,
    sources: [
      PLANECAPTURES,
      'https://www.flightaware.com/photos/view/725126-b3a23f9ab053fdf6f2b381f13553b461748f91cd',
      'https://www.flickr.com/photos/204430978@N03/55394585392/',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N653UA',
    ...STAR_ALLIANCE,
    sources: [
      PLANECAPTURES,
      'https://www.flickr.com/photos/62908736@N08/55559764024/',
      'https://www.flightaware.com/photos/view/8022479-ce2e55836dd2c55c14ef9d67e62aea9fe4fafac3',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N76055',
    ...STAR_ALLIANCE,
    sources: [
      PLANECAPTURES,
      'https://www.flightaware.com/photos/view/725126-56be010822b9154395aa2a8291cfca1f4a3b23ac',
      'https://www.flickr.com/photos/100507254@N06/55434948338/',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N218UA',
    ...STAR_ALLIANCE,
    sources: [
      'https://www.flightaware.com/photos/view/19343617-812708683e84a99e65130be97d25708d5f05ddc3',
      'https://commons.wikimedia.org/wiki/File:United_Airlines_777-200(ER)_N218UA_Star_Alliance_livery_departing_SFO,_4-19-26.jpg',
      'https://www.flickr.com/photos/redripper24/55549173016/',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N76021',
    ...STAR_ALLIANCE,
    sources: [
      PLANECAPTURES,
      'https://www.flightaware.com/photos/view/777395-4113e39349539bc98097d87f8e041edc123c51a8',
      'https://www.flickr.com/photos/bradley-newman/55553967820/',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N77022',
    ...STAR_ALLIANCE,
    sources: [
      PLANECAPTURES,
      'https://www.flickr.com/photos/198586695@N05/55535197441/',
      'https://www.flightaware.com/photos/view/1352940-7f9d1c5070a7838f260e40706d1d90395c809b8e',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N78017',
    ...STAR_ALLIANCE,
    sources: [
      'https://www.flightaware.com/photos/view/28053-5cb0055a9935ae9ad4e4ac38beae80200e5c53ab',
      'https://www.flickr.com/photos/100507254@N06/55488134372/',
      'https://www.flightaware.com/photos/view/20329774-fd8f5d4c1ecff877526492f53c1d20c39a678026',
    ],
    verified: VERIFIED,
  },
  {
    tail: 'N794UA',
    ...STAR_ALLIANCE,
    sources: [
      'https://www.flickr.com/photos/198586695@N05/55548188828/',
      'https://www.flickr.com/photos/cak757/55529620620/',
      'https://www.flightaware.com/photos/view/18155750-27a91c57deceed9497d6948157ed1d09a5fc6fad',
    ],
    verified: VERIFIED,
  },
];

export default SPECIAL_LIVERIES;
