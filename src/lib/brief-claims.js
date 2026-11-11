// ═══ OPS BRIEF: CLAIM EXTRACTION ═══
// The one tokenizer behind the brief's verifier (src/lib/brief-verify.js). It reads a sentence
// and lists every checkable claim in it: clock times, percentages, plain numbers (digits and
// number words), flight numbers, runways, airports (codes AND the city/airport names that stand
// for them) and causes ("thunderstorms", "low clouds"). The verifier runs the SAME extractor over
// a fact's `values`, so "what a fact allows" and "what a sentence claims" are measured with one
// ruler: a claim passes when the facts an item cites allow it, and fails otherwise.
//
// Deliberately strict. A false rejection costs one dropped item (the template is the floor); a
// false acceptance puts an invented number in front of every visitor.

import { IATA_CITIES } from './airports.js';
import { AIRPORT_TZ } from './time-format.js';

/** United's hubs, display order of the hub strip. */
export const BRIEF_HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];

/** The name a statement uses for a hub ("Newark", not "EWR"). */
export const HUB_DISPLAY_NAMES = Object.freeze({
  ORD: "Chicago O'Hare", DEN: 'Denver', IAH: 'Houston', EWR: 'Newark', SFO: 'San Francisco',
  IAD: 'Washington Dulles', LAX: 'Los Angeles', NRT: 'Tokyo Narita', GUM: 'Guam',
});

// Names that stand for exactly one airport, beyond src/lib/airports.js IATA_CITIES.
const EXTRA_NAMES = {
  EWR: ['Newark Liberty'],
  IAH: ['Houston Intercontinental', 'Bush Intercontinental', 'Houston Bush'],
  ORD: ["O'Hare"],
  IAD: ['Dulles'],
  NRT: ['Narita'],
  JFK: ['Kennedy'],
  LGA: ['LaGuardia'],
  DCA: ['Reagan National', 'Washington National'],
  HND: ['Haneda'],
  LHR: ['Heathrow'],
  SJC: ['San Jose'],
  DFW: ['Dallas-Fort Worth'],
  MDW: ['Midway'],
  HOU: ['Hobby'],
};

// Names that stand for more than one airport. A sentence using one passes when ANY airport it can
// mean is cited ("Chicago" for an ORD fact), and fails when none is.
const SHARED_NAMES = {
  Chicago: ['ORD', 'MDW'],
  Houston: ['IAH', 'HOU'],
  Washington: ['IAD', 'DCA', 'BWI'],
  'New York': ['EWR', 'JFK', 'LGA'],
  Tokyo: ['NRT', 'HND'],
  Dallas: ['DFW', 'DAL'],
  London: ['LHR'],
};

/**
 * Every surface form a fact may use for one airport: the code, then the names. Hubs lead with
 * their display name. Unknown codes return just the code.
 * @param {string} code
 * @returns {string[]}
 */
export function airportForms(code) {
  const c = String(code || '').toUpperCase();
  const forms = [c];
  const add = (name) => { if (name && !forms.includes(name)) forms.push(name); };
  add(HUB_DISPLAY_NAMES[c]);
  add(IATA_CITIES[c]);
  for (const name of EXTRA_NAMES[c] || []) add(name);
  for (const [name, codes] of Object.entries(SHARED_NAMES)) if (codes.includes(c)) add(name);
  return forms;
}

/** The name a statement uses for an airport: the hub display name, the city, or the code. */
export function airportDisplayName(code) {
  const c = String(code || '').toUpperCase();
  return HUB_DISPLAY_NAMES[c] || IATA_CITIES[c] || c;
}

/** name → Set<code>, every name we can recognise in prose. */
const NAME_INDEX = (() => {
  /** @type {Map<string, Set<string>>} */
  const index = new Map();
  const add = (name, code) => {
    if (!name) return;
    const key = normalizeQuotes(name);
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(code);
  };
  for (const [code, name] of Object.entries(IATA_CITIES)) add(name, code);
  for (const [code, name] of Object.entries(HUB_DISPLAY_NAMES)) add(name, code);
  for (const [code, names] of Object.entries(EXTRA_NAMES)) for (const n of names) add(n, code);
  for (const [name, codes] of Object.entries(SHARED_NAMES)) for (const c of codes) add(name, c);
  return index;
})();

// Longest first, so "Chicago O'Hare" is consumed before "Chicago" can match inside it.
const NAME_RE = (() => {
  const names = [...NAME_INDEX.keys()].sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
})();

/** All-caps three-letter tokens that are not airports. Everything else in caps is treated as one. */
const NON_AIRPORT_CODES = new Set([
  'FAA', 'ATC', 'NAS', 'TSA', 'DOT', 'NWS', 'AWC', 'GDP', 'AFP', 'IFR', 'VFR', 'IMC', 'VMC', 'TMI',
  'MIT', 'CDR', 'ILS', 'GLS', 'VOR', 'DME', 'RVR', 'TAF', 'RNP', 'RNAV', 'ADS', 'UTC', 'GMT', 'EST',
  'EDT', 'CST', 'CDT', 'MST', 'MDT', 'PST', 'PDT', 'HST', 'JST', 'USA', 'ETA', 'ETD', 'MAX', 'CRJ',
  'ERJ', 'FBO', 'API', 'TBD', 'AKT', 'OTP', 'GPS', 'EMS', 'ARFF', 'CEO', 'NOW', 'NEW', 'ALL', 'AND',
  'THE', 'FOR', 'NOT', 'ONE', 'TWO', 'WIFI',
]);

const TIME_ZONE_ALIASES = {
  ET: 'ET', EST: 'ET', EDT: 'ET',
  CT: 'CT', CST: 'CT', CDT: 'CT',
  MT: 'MT', MST: 'MT', MDT: 'MT',
  PT: 'PT', PST: 'PT', PDT: 'PT',
  AKT: 'AKT', AKST: 'AKT', AKDT: 'AKT',
  HT: 'HT', HST: 'HT',
  CHST: 'CHST', JST: 'JST',
  UTC: 'UTC', GMT: 'UTC', Z: 'UTC',
};
const ZONE_PATTERN = 'ET|CT|MT|PT|AKT|AKST|AKDT|HT|HST|EST|EDT|CST|CDT|MST|MDT|PST|PDT|ChST|CHST|JST|UTC|GMT|Z';

const NUMBER_WORDS = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, dozen: 12,
};
/** The word a statement uses for a small count ("seven"); digits above twelve. */
export function numberWord(n) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  return Number.isInteger(n) && n >= 0 && n <= 12 ? words[n] : String(n);
}

/**
 * Causes, longest phrase first within each, canonicalised. The order of this list matters:
 * "de-icing" must be consumed before "icing" can read it as ice.
 */
const CAUSES = [
  ['deicing', /\bde-?icing\b/gi],
  ['thunderstorms', /\b(?:thunder\s?storms?|t-?storms?|storms?|convective(?:\s+weather)?|lightning)\b/gi],
  ['ice', /\b(?:freezing\s+(?:rain|drizzle|precipitation|fog)|ice|icing|icy|sleet)\b/gi],
  ['snow', /\b(?:snow(?:fall|storms?)?|blizzards?)\b/gi],
  ['wind', /\b(?:wind\s?shear|cross\s?winds?|winds?|windy|gusts?|gusty|gusting)\b/gi],
  ['low_clouds', /\b(?:low\s+clouds?|low\s+ceilings?|ceilings?|overcast|cloud\s+cover)\b/gi],
  ['low_visibility', /\b(?:low\s+visibility|visibility|fog|foggy|mist|haze|smoke)\b/gi],
  ['rain', /\b(?:heavy\s+rain|rain|rainy|showers?|drizzle|downpours?)\b/gi],
  ['construction', /\b(?:runway\s+construction|construction|runway\s+work)\b/gi],
  ['volume', /\b(?:traffic\s+volume|heavy\s+traffic|volume|congestion|high\s+demand)\b/gi],
  ['staffing', /\b(?:staffing|short-?staffed|understaffed)\b/gi],
  ['equipment', /\b(?:equipment|outages?|out\s+of\s+service)\b/gi],
  ['emergency', /\b(?:emergency|emergencies)\b/gi],
  ['weather', /\bweather\b/gi],
];
/** Causes that "weather" (the umbrella word) may stand for. */
const WEATHER_CAUSES = new Set(['deicing', 'thunderstorms', 'ice', 'snow', 'wind', 'low_clouds', 'low_visibility', 'rain', 'weather']);

/**
 * @typedef {{type: 'time', raw: string, minutes: number, zone: string|null}
 *   | {type: 'percent', raw: string, value: string}
 *   | {type: 'number', raw: string, value: string}
 *   | {type: 'fraction', raw: string, value: string}
 *   | {type: 'flight', raw: string, value: string}
 *   | {type: 'runway', raw: string, value: string}
 *   | {type: 'airport', raw: string, codes: string[]}
 *   | {type: 'cause', raw: string, value: string}
 *   | {type: 'vague', raw: string}} Claim
 */

/** Straight quotes, NFC, and every Unicode space (Intl's U+202F before "PM") as a plain space. */
export function normalizeText(text) {
  return normalizeQuotes(String(text ?? '').normalize('NFC'))
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, ' ');
}
function normalizeQuotes(s) {
  return String(s).replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

function canonicalNumber(raw) {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : String(raw);
}

function zoneOf(raw) {
  if (!raw) return null;
  return TIME_ZONE_ALIASES[String(raw).toUpperCase()] || null;
}

/**
 * Run `re` over the working string; for each match push what `toClaim` returns and blank the span
 * so later, looser patterns cannot re-read it ("9:00" must not also yield the numbers 9 and 0).
 */
function consume(state, re, toClaim) {
  re.lastIndex = 0;
  state.work = state.work.replace(re, (...args) => {
    const match = args[0];
    const claim = toClaim(...args);
    if (claim) state.claims.push(...(Array.isArray(claim) ? claim : [claim]));
    return ' '.repeat(match.length);
  });
}

/**
 * Every checkable claim in a piece of text.
 * @param {string} text
 * @returns {Claim[]}
 */
export function extractClaims(text) {
  const state = { work: normalizeText(text), claims: /** @type {Claim[]} */ ([]) };

  // Airport names (case-sensitive proper nouns), before codes: "New York JFK" is one claim.
  consume(state, NAME_RE, (m) => {
    const key = normalizeQuotes(m).replace(/\s+/g, ' ');
    const codes = NAME_INDEX.get(key);
    return codes ? { type: 'airport', raw: m, codes: [...codes] } : null;
  });

  // Flight numbers: "UA2809", "UA 2809", "UAL2809", "United 2809".
  consume(state, /\b(?:UAL?\s?|United\s+(?:flight\s+)?)(\d{1,4})\b/g, (m, n) => ({ type: 'flight', raw: m, value: `UA${Number(n)}` }));

  // 12-hour clock times, with an optional zone: "9:00 PM ET", "9 p.m.", "7:30pm CDT".
  consume(
    state,
    new RegExp(`\\b(\\d{1,2})(?::([0-5]\\d))?\\s?(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)(?![A-Za-z])(?:\\s?(${ZONE_PATTERN})\\b)?`, 'gi'),
    (m, h, min, ap, zone) => {
      const hour = Number(h);
      if (hour < 1 || hour > 12) return { type: 'number', raw: m, value: canonicalNumber(h) };
      const pm = /^p/i.test(ap);
      const h24 = (hour % 12) + (pm ? 12 : 0);
      return { type: 'time', raw: m, minutes: h24 * 60 + Number(min || 0), zone: zoneOf(zone) };
    },
  );
  consume(state, new RegExp(`\\b(noon|midnight)\\b(?:\\s?(${ZONE_PATTERN})\\b)?`, 'gi'), (m, word, zone) => ({
    type: 'time', raw: m, minutes: /noon/i.test(word) ? 720 : 0, zone: zoneOf(zone),
  }));
  // Zulu / 24-hour times: "0030Z", "2100 UTC", "21:00", "21:00Z".
  consume(state, /\b([01]\d|2[0-3]):?([0-5]\d)\s?(Z|UTC|GMT)\b/g, (m, h, min) => ({
    type: 'time', raw: m, minutes: Number(h) * 60 + Number(min), zone: 'UTC',
  }));
  consume(state, /\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (m, h, min) => ({
    type: 'time', raw: m, minutes: Number(h) * 60 + Number(min), zone: null,
  }));

  // Percentages: "85%", "85 percent", "12.5 per cent".
  consume(state, /(?<![\w.])(\d+(?:\.\d+)?)\s?(?:%|percent\b|per\s+cent\b)/gi, (m, n) => ({ type: 'percent', raw: m, value: canonicalNumber(n) }));

  // Runways: "22L", "runway 4R", "35C". A bare "runway 4" falls through to the number rule.
  consume(state, /\b(?:runways?\s+)?(\d{1,2}[LRC])\b/g, (m, id) => ({ type: 'runway', raw: m, value: id.replace(/^0/, '') }));

  // Fractions: "1/2".
  consume(state, /(?<![\w.])(\d+)\/(\d+)(?![\w])/g, (m, a, b) => ({ type: 'fraction', raw: m, value: `${Number(a)}/${Number(b)}` }));

  // Plain numbers: "630", "1,204", "17.3", "16" in "16–30".
  consume(state, /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\w])/g, (m, int, dec) => ({
    type: 'number', raw: m, value: canonicalNumber(`${int}${dec || ''}`),
  }));

  // Number words. "one" is left out: it is a pronoun as often as a count ("the one hub").
  consume(state, new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi'), (m, w) => ({
    type: 'number', raw: m, value: String(NUMBER_WORDS[w.toLowerCase()]),
  }));

  // Quantities that cannot be grounded at all.
  consume(state, /\b(?:dozens|hundreds|thousands|scores\s+of)\b/gi, (m) => ({ type: 'vague', raw: m }));

  for (const [cause, re] of CAUSES) consume(state, re, (m) => ({ type: 'cause', raw: m, value: cause }));

  // Airport codes: any remaining all-caps three-letter token that is not a known acronym.
  consume(state, /(?<![A-Za-z0-9])([A-Z]{3})(?![A-Za-z0-9])/g, (m, code) =>
    NON_AIRPORT_CODES.has(code) ? null : { type: 'airport', raw: m, codes: [code] });

  return state.claims;
}

/**
 * @typedef {{
 *   times: Array<{minutes: number, zone: string|null}>,
 *   percents: Set<string>, numbers: Set<string>, fractions: Set<string>, flights: Set<string>,
 *   runways: Set<string>, airports: Set<string>, sharedNames: Set<string>, causes: Set<string>,
 * }} Allowance
 */

/** @returns {Allowance} */
export function emptyAllowance() {
  return {
    times: [], percents: new Set(), numbers: new Set(), fractions: new Set(), flights: new Set(),
    runways: new Set(), airports: new Set(), sharedNames: new Set(), causes: new Set(),
  };
}

/**
 * What a list of values allows: every claim the extractor finds in them.
 * @param {Iterable<string>} values
 * @param {Allowance} [into]
 * @returns {Allowance}
 */
export function allowanceFromValues(values, into = emptyAllowance()) {
  for (const value of values || []) {
    for (const claim of extractClaims(String(value))) {
      switch (claim.type) {
        case 'time': into.times.push({ minutes: claim.minutes, zone: claim.zone }); break;
        case 'percent': into.percents.add(claim.value); break;
        case 'number': into.numbers.add(claim.value); break;
        case 'fraction': into.fractions.add(claim.value); break;
        case 'flight': into.flights.add(claim.value); break;
        case 'runway': into.runways.add(claim.value); break;
        // A name that stands for ONE airport allows that airport. A shared name ("New York",
        // "Chicago") in a fact's values allows only that name: it must not let an EWR fact vouch
        // for LGA, or an ORD fact for Midway.
        case 'airport':
          if (claim.codes.length === 1) into.airports.add(claim.codes[0]);
          else into.sharedNames.add(normalizeQuotes(claim.raw).replace(/\s+/g, ' '));
          break;
        case 'cause': into.causes.add(claim.value); break;
        default: break;
      }
    }
  }
  return into;
}

/**
 * Why a claim is not allowed, or null when it is.
 * @param {Claim} claim
 * @param {Allowance} allowed
 * @returns {string|null}
 */
export function claimFailure(claim, allowed) {
  switch (claim.type) {
    case 'time': {
      const hit = allowed.times.some((t) => t.minutes === claim.minutes && (!claim.zone || !t.zone || t.zone === claim.zone));
      if (hit) return null;
      const sameClock = allowed.times.some((t) => t.minutes === claim.minutes);
      return sameClock ? `time_wrong_zone:${claim.raw}` : `time_not_in_facts:${claim.raw}`;
    }
    case 'percent':
      return allowed.percents.has(claim.value) ? null : `number_not_in_facts:${claim.raw}`;
    case 'number':
      // A bare number may repeat a percentage's figure ("between 85 and 100%"); a percentage may
      // never be made out of a plain count.
      return allowed.numbers.has(claim.value) || allowed.percents.has(claim.value) ? null : `number_not_in_facts:${claim.raw}`;
    case 'fraction':
      return allowed.fractions.has(claim.value) ? null : `number_not_in_facts:${claim.raw}`;
    case 'flight':
      return allowed.flights.has(claim.value) ? null : `flight_not_in_facts:${claim.raw}`;
    case 'runway':
      return allowed.runways.has(claim.value) ? null : `runway_not_in_facts:${claim.raw}`;
    case 'airport':
      if (claim.codes.length > 1 && allowed.sharedNames.has(normalizeQuotes(claim.raw).replace(/\s+/g, ' '))) return null;
      return claim.codes.some((c) => allowed.airports.has(c)) ? null : `uncited_airport:${claim.raw}`;
    case 'cause': {
      if (allowed.causes.has(claim.value)) return null;
      if (claim.value === 'weather' && [...allowed.causes].some((c) => WEATHER_CAUSES.has(c))) return null;
      return `cause_not_in_facts:${claim.raw}`;
    }
    case 'vague':
      return `vague_quantity:${claim.raw}`;
    default:
      return null;
  }
}

/** True for codes we can turn into a local clock (src/lib/time-format.js AIRPORT_TZ). */
export function isKnownAirportCode(code) {
  return Boolean(AIRPORT_TZ[String(code || '').toUpperCase()] || IATA_CITIES[String(code || '').toUpperCase()]);
}
