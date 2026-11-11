// ═══ ASK THE BOARD: THE RULES PARSER ═══
// Most questions people type into ⌘K are made of words the dashboard already knows: a flight number,
// a tail, a hub's code or city, "arrivals", "787", "starlink", "over the Atlantic", "late". This
// parser reads those with no network call and no cost, and answers either CONFIDENT (every word that
// carries meaning was understood) or NOT SURE. Only a not-sure question goes to POST /api/ask.
//
// Confidence is strict on purpose: one word it does not know ("polaris", "tonight", "Dubai to") and it
// says not sure, because a confident answer that silently ignored a word is a wrong filter the
// visitor did not ask for. Its output goes through the same validator as the model's
// (ask-vocabulary.js validateAskResult).
//
// DOM-free; api/ask.ts runs it first too, so a client that skips it cannot spend the model budget on
// a question the rules can answer.

import {
  ASK_CITY_NAMES,
  ASK_HUBS,
  ASK_AIRPORTS,
  normalizeFlight,
  normalizeTail,
  validateAskResult,
} from './ask-vocabulary.js';

/** The longest query the server accepts; the palette input is capped to match. */
export const ASK_MAX_QUERY_CHARS = 200;

// Control characters, zero-width characters and bidi overrides: a query is data, and none of these
// carry meaning in a question about flights.
// eslint-disable-next-line no-control-regex
const STRIP_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/**
 * The query as the server and the parser both see it: control characters out, whitespace collapsed,
 * trimmed, at most ASK_MAX_QUERY_CHARS characters.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeAskQuery(raw) {
  // Cut long input before any regex runs over it; the real cap is applied after cleaning.
  const text = String(raw ?? '').slice(0, ASK_MAX_QUERY_CHARS * 4).replace(STRIP_RE, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, ASK_MAX_QUERY_CHARS).trim();
}

/** The cache key for a query: case, punctuation and spacing do not change what it asks. */
export function askCacheKey(raw) {
  return normalizeAskQuery(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Lexicon ─────────────────────────────────────────────────────────────────────────────────────
// Every entry maps a lower-case phrase (one to four words) to the facts it carries.

/** @typedef {{kind: string, value?: unknown}} Fact */

/** @type {Map<string, Fact[]>} */
const LEXICON = new Map();
function add(phrases, ...facts) {
  for (const p of phrases) LEXICON.set(p, facts);
}

// Aircraft families. Bare 737/757/767/777/787 are families, never flight numbers (UA787 is a flight).
add(['787', 'b787', '787s', 'dreamliner', 'dreamliners', 'boeing 787', '787 dreamliner'], { kind: 'family', value: '787' });
add(['777', 'b777', '777s', 'triple seven', 'triple sevens', 'triple 7', 'boeing 777'], { kind: 'family', value: '777' });
add(['767', 'b767', '767s', 'boeing 767'], { kind: 'family', value: '767' });
add(['757', 'b757', '757s', 'boeing 757'], { kind: 'family', value: '757' });
add(['737', 'b737', '737s', 'boeing 737', '737 family'], { kind: 'family', value: '737' });
add(['max', 'maxes', 'maxs', '737 max', '737max', 'max jets', 'boeing max', '737 maxes', '737 maxs'], { kind: 'family', value: '737MAX' });
add(['airbus', 'airbuses', 'a320 family', 'a32x', 'a320neo family'], { kind: 'family', value: 'A320' });
add(['e175', 'e-175', 'e175s', 'erj175', 'erj-175', 'erj 175', 'embraer', 'embraers', 'embraer 175', 'e jet', 'e-jet', 'ejet', 'ejets', 'e jets'], { kind: 'family', value: 'E175' });
add(['crj', 'crjs', 'crj200', 'crj-200', 'crj550', 'crj-550', 'crj700', 'crj-700', 'crj7', 'crj2', 'canadair', 'bombardier'], { kind: 'family', value: 'CRJ' });
// Aircraft types (ICAO). Bare digit codes (788, 789, 738 …) stay flight numbers; plurals and the
// lettered forms are types.
add(['787-8', '7878', '788s', 'b788', '787 8'], { kind: 'type', value: 'B788' });
add(['787-9', '7879', '789s', 'b789', '787 9'], { kind: 'type', value: 'B789' });
add(['787-10', '78x', '78xs', '78j', 'b78x', '787 10'], { kind: 'type', value: 'B78X' });
add(['777-200', '777-200er', '772s', 'b772', '777 200', '777 200er', '777-200s'], { kind: 'type', value: 'B772' });
add(['777-300', '777-300er', '77w', '77ws', 'b77w', '773s', '777 300', '777 300er', '777-300ers', '777-300s'], { kind: 'type', value: 'B77W' });
add(['767-300', '767-300er', '763s', 'b763', '767 300'], { kind: 'type', value: 'B763' });
add(['767-400', '767-400er', '764s', 'b764', '767 400'], { kind: 'type', value: 'B764' });
add(['757-200', '752s', 'b752', '757 200'], { kind: 'type', value: 'B752' });
add(['757-300', '753s', 'b753', '757 300'], { kind: 'type', value: 'B753' });
add(['737-700', '73g', 'b73g', '737 700'], { kind: 'type', value: 'B737' });
add(['737-800', '738s', 'b738', '73h', '737 800'], { kind: 'type', value: 'B738' });
add(['737-900', '737-900er', '739s', 'b739', '73j', '737 900', '737 900er'], { kind: 'type', value: 'B739' });
add(['max 8', 'max8', 'max-8', '737 max 8', '737-8', 'b38m', '7m8', '38m', 'max 8s'], { kind: 'type', value: 'B38M' });
add(['max 9', 'max9', 'max-9', '737 max 9', '737-9', 'b39m', '7m9', '39m', 'max 9s'], { kind: 'type', value: 'B39M' });
add(['a319', 'a319s', 'airbus 319'], { kind: 'type', value: 'A319' });
add(['a320', 'a320s', 'airbus 320'], { kind: 'type', value: 'A320' });
add(['a321', 'a321s', 'a321neo', 'a321neos', 'a321 neo', 'a321-neo', 'a21n', 'neo', 'neos', 'xlr', 'a321xlr', 'a321 xlr', 'airbus 321'], { kind: 'type', value: 'A21N' });

// Starlink.
add(['starlink', 'starlinks', 'starlink wifi', 'starlink wi fi', 'starlink internet', 'starlink equipped', 'with starlink', 'have starlink', 'has starlink'], { kind: 'starlink', value: true });
add(['without starlink', 'no starlink', 'non starlink', 'not starlink', 'without starlink wifi', 'lacking starlink', 'no starlink wifi'], { kind: 'starlink', value: false });

// Map regions (where aircraft ARE, not where they are going).
add(['atlantic', 'the atlantic', 'north atlantic', 'transatlantic', 'trans atlantic', 'europe', 'over europe', 'the pond', 'nat tracks'], { kind: 'region', value: 'europe' });
add(['pacific', 'the pacific', 'north pacific', 'transpacific', 'trans pacific', 'hawaii', 'hawaiian islands'], { kind: 'region', value: 'pacific' });
add(['asia', 'east asia', 'japan', 'korea', 'china', 'taiwan'], { kind: 'region', value: 'east-asia' });
add(['southeast asia', 'se asia', 'south east asia'], { kind: 'region', value: 'southeast-asia' });
add(['australia', 'oceania', 'new zealand', 'down under'], { kind: 'region', value: 'oceania' });
add(['caribbean', 'the caribbean'], { kind: 'region', value: 'caribbean' });
add(['mexico', 'central america', 'mexico and central america'], { kind: 'region', value: 'central-america' });
add(['south america', 'latin america'], { kind: 'region', value: 'south-america' });
add(['africa'], { kind: 'region', value: 'africa' });
add(['middle east', 'india', 'the middle east'], { kind: 'region', value: 'middle-east-india' });
add(['lower 48', 'the lower 48', 'continental us', 'contiguous us', 'usa', 'u s a', 'united states', 'the united states', 'the us', 'over the us', 'the states'], { kind: 'region', value: 'us' });

// In the air / on the ground.
add(['in the air', 'airborne', 'flying', 'in flight', 'inflight', 'en route', 'enroute', 'aloft', 'in the sky', 'up in the air', 'flying right now', 'currently flying'], { kind: 'airborne', value: true });
add(['on the ground', 'on ground', 'parked', 'at the gate', 'at gate', 'at the gates', 'at gates', 'sitting on the ground', 'on the tarmac', 'grounded'], { kind: 'airborne', value: false });

// Status buckets.
add(['delayed', 'delay', 'delays', 'late', 'running late', 'behind schedule', 'tardy', 'lates'], { kind: 'status', value: 'delayed' });
add(['canceled', 'cancelled', 'cancellation', 'cancellations', 'cancelation', 'cancelations', 'cancel', 'cancels', 'scrubbed'], { kind: 'status', value: 'canceled' });
add(['on time', 'ontime', 'punctual', 'on schedule'], { kind: 'status', value: 'on-time' });

// Board direction. Each also opens a slot for the airport that follows ("arrivals into DEN").
add(['arrivals', 'arrival', 'arriving', 'arrive', 'arrives', 'inbound', 'incoming', 'landing', 'landings', 'inbounds'], { kind: 'direction', value: 'arrivals' }, { kind: 'slot', value: 'destination' });
add(['departures', 'departure', 'departing', 'depart', 'departs', 'outbound', 'takeoffs', 'take offs', 'outbounds', 'leaving'], { kind: 'direction', value: 'departures' }, { kind: 'slot', value: 'origin' });

// Prepositions that say what the next airport is.
add(['to', 'into', 'toward', 'towards', 'bound for', 'headed to', 'heading to', 'going to', 'headed for', 'destined for'], { kind: 'slot', value: 'destination' });
add(['landing at', 'landing in', 'arriving at', 'arriving in', 'arriving into'], { kind: 'direction', value: 'arrivals' }, { kind: 'slot', value: 'destination' });
add(['flying to', 'flying into', 'en route to', 'enroute to', 'in the air to'], { kind: 'airborne', value: true }, { kind: 'slot', value: 'destination' });
add(['from', 'out of', 'coming from'], { kind: 'slot', value: 'origin' });
add(['leaving from', 'departing from', 'departing out of', 'leaving out of'], { kind: 'direction', value: 'departures' }, { kind: 'slot', value: 'origin' });
add(['flying from', 'flying out of'], { kind: 'airborne', value: true }, { kind: 'slot', value: 'origin' });
add(['at', 'in', 'around', 'near', 'for', 'inside', 'of'], { kind: 'slot', value: 'hub' });

// View hints.
add(['weather', 'wrong', 'problem', 'problems', 'issue', 'issues', 'ground stop', 'ground stops', 'ground delay', 'ground delay program', 'gdp', 'irops', 'disruption', 'disruptions', 'disrupted', 'storm', 'storms', 'thunderstorm', 'thunderstorms', 'snow', 'fog', 'foggy', 'icing', 'deicing', 'de icing', 'metar', 'conditions', 'happening', 'going on', 'meltdown', 'mess', 'chaos', 'faa', 'atc'], { kind: 'view', value: 'weather' });
add(['fleet', 'how many', 'registrations', 'seat map', 'seat maps', 'seats', 'configuration', 'configurations', 'config', 'configs', 'oldest', 'newest', 'deliveries', 'delivered', 'does united have', 'does united own', 'united has', 'united owns', 'in the fleet'], { kind: 'view', value: 'fleet' });
add(['roster', 'installed', 'installs', 'retrofit', 'retrofits', 'retrofitted', 'starlink roster', 'starlink tab', 'starlink tracker'], { kind: 'view', value: 'starlink' });
add(['schedule', 'board', 'boards', 'fids', 'timetable', 'departure board', 'arrivals board', 'departures board', 'arrival board'], { kind: 'view', value: 'schedule' });
add(['map', 'live map', 'the map', 'live'], { kind: 'view', value: 'live' });

// Airports by name. City names unique in the airport table, plus the names people actually use.
const CITY_ALIASES = {
  chicago: 'ORD', ohare: 'ORD', 'o hare': 'ORD', 'chicago ohare': 'ORD', midway: 'MDW',
  houston: 'IAH', 'bush intercontinental': 'IAH', 'houston intercontinental': 'IAH', hobby: 'HOU',
  washington: 'IAD', dulles: 'IAD', 'washington dulles': 'IAD', reagan: 'DCA', 'reagan national': 'DCA',
  newark: 'EWR', 'newark liberty': 'EWR',
  'san francisco': 'SFO', sf: 'SFO', 'bay area': 'SFO', 'los angeles': 'LAX', la: 'LAX', 'l a': 'LAX',
  tokyo: 'NRT', narita: 'NRT', haneda: 'HND', 'tokyo narita': 'NRT', 'tokyo haneda': 'HND',
  guam: 'GUM', denver: 'DEN',
  heathrow: 'LHR', 'london heathrow': 'LHR', paris: 'CDG', 'charles de gaulle': 'CDG', rome: 'FCO',
  vegas: 'LAS', 'las vegas': 'LAS', dallas: 'DFW', 'dallas fort worth': 'DFW', dfw: 'DFW',
  maui: 'OGG', kauai: 'LIH', kona: 'KOA', honolulu: 'HNL', seoul: 'ICN', shanghai: 'PVG',
  'hong kong': 'HKG', 'sao paulo': 'GRU', 'buenos aires': 'EZE', 'mexico city': 'MEX', cancun: 'CUN',
  'cabo': 'SJD', 'los cabos': 'SJD', 'tel aviv': 'TLV', 'new orleans': 'MSY', 'salt lake': 'SLC',
  'salt lake city': 'SLC', 'st louis': 'STL', 'saint louis': 'STL', 'twin cities': 'MSP',
  'orange county': 'SNA', 'palm springs': 'PSP', 'cape town': 'CPT', toronto: 'YYZ', vancouver: 'YVR',
};
// Names more than one airport answers to (src/lib/airport-codes.js keeps the same list).
const AMBIGUOUS_NAMES = new Set([
  'portland', 'panama city', 'santiago', 'fayetteville', 'rochester', 'columbus', 'charleston',
  'jacksonville', 'albany', 'richmond', 'birmingham', 'manchester', 'springfield', 'wilmington',
  'greenville', 'burlington', 'lafayette', 'ontario', 'kansas city', 'melbourne', 'sydney', 'dublin',
  'san jose', 'cambridge', 'london', 'new york',
]);

function plain(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’.]/g, '')
    .replace(/[/&]/g, ' ')
    .replace(/(?<=[a-z])-(?=[a-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @type {Map<string, string>} name → airport code */
const AIRPORT_NAMES = (() => {
  const map = new Map();
  const counts = new Map();
  for (const city of Object.values(ASK_CITY_NAMES)) counts.set(plain(city), (counts.get(plain(city)) || 0) + 1);
  for (const [code, city] of Object.entries(ASK_CITY_NAMES)) {
    const key = plain(city);
    if (counts.get(key) === 1 && !AMBIGUOUS_NAMES.has(key)) map.set(key, code);
  }
  for (const [name, code] of Object.entries(CITY_ALIASES)) map.set(name, code);
  return map;
})();

/**
 * Three-letter codes that are also everyday words. They count as airports only when typed in capitals
 * or right after "to", "from", "at" and the like ("flights to SEA", "from san").
 */
const WORDLIKE_CODES = new Set(['ADD', 'CAN', 'MAN', 'MAD', 'SEA', 'SIN', 'OAK', 'BOG', 'LIT', 'SAN', 'PIT', 'DEL', 'NAN', 'IND', 'MEL', 'MEM', 'TUL', 'BUF', 'BUR', 'ALB', 'LIM', 'LIS', 'ROC', 'RIC', 'DOH', 'AMS', 'CAI', 'ACC', 'OSL', 'OMA', 'ONT', 'AUS', 'ATL', 'ICT', 'PHX', 'MIA']);

const HUB_SET = new Set(ASK_HUBS);

/** Words that carry no filter: question words, articles, "flights", "united", "right now". */
const STOPWORDS = new Set(`
a an the any all every some each this these those that there here it its is are was were be been being am
do does did doing has have had having will would can could should may might must shall
what which who whom whose where when why how whats wheres hows whos
show shows showing me my mine i im we us our you your list find give get see view display tell look looking
please pls plz thanks just only also still yet now right currently current today presently moment
flights flight plane planes aircraft aircrafts airplane airplanes jet jets airliner airliners
united ua ual airline airlines united's uniteds
with and or plus but not no without about like kind type types family families series model models
version versions variant variants equipped
on up out over across within whole entire
are there going operating operated operate operates running scheduled
wifi wi fi internet status statuses info information details
many much number count total lot lots
really actually exactly yes ok okay hey hi hello
`.split(/\s+/).filter(Boolean));

/** Tokens: words of the query, lower-cased, with the original casing kept for airport codes. */
function tokenize(query) {
  const cleaned = String(query)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/’/g, "'")
    .replace(/'s\b/gi, '')
    .replace(/'/g, '')
    .replace(/\./g, '')
    .replace(/[^A-Za-z0-9#\s-]/g, ' ')
    .replace(/(?<=[A-Za-z])-(?=[A-Za-z])/g, ' ')
    .replace(/(^|\s)-+|-+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned.split(' ').map((raw) => ({ raw, low: raw.toLowerCase() }));
}

const FAMILY_NUMBERS = new Set(['737', '747', '757', '767', '777', '787']);
const FLIGHT_TOKEN_RE = /^(?:ua|ual|#)?(\d{1,4})$/;
const FLIGHT_PREFIXES = new Set(['ua', 'ual', 'flight', 'flt', 'united', '#', 'number']);
const TAIL_TOKEN_RE = /^n\d{1,5}[a-z]{0,2}$/;

/**
 * Read a query.
 *
 * @param {string} rawQuery
 * @returns {{confident: true, result: {view: string, filters: Record<string, unknown>}, leftovers: string[]}
 *   | {confident: false, reason: 'unknown_words'|'conflict'|'nothing'|'invalid', leftovers: string[], facts: Fact[]}}
 */
export function parseAsk(rawQuery) {
  // "ORD-DEN", "ORD → DEN", "ord>den": a route pair reads as "from ORD to DEN".
  const query = normalizeAskQuery(rawQuery).replace(
    /\b([A-Za-z]{3})\s*(?:-|–|—|→|>|\/)\s*([A-Za-z]{3})\b/g,
    (whole, a, b) => (ASK_AIRPORTS.has(a.toUpperCase()) && ASK_AIRPORTS.has(b.toUpperCase()) ? `from ${a.toUpperCase()} to ${b.toUpperCase()}` : whole),
  );
  const tokens = tokenize(query);
  /** @type {Fact[]} */
  const facts = [];
  /** @type {string[]} */
  const leftovers = [];
  /** The slot an airport will fill: set by "to", "from", "at", "arrivals" … */
  let slot = /** @type {string|null} */ (null);

  const airportFact = (code) => {
    // No preposition at all ("ORD to DEN", "denver"): decided once every fact is in (resolveFacts).
    const kind = slot === 'destination' ? 'destination' : slot === 'origin' ? 'origin' : slot === 'hub' ? 'hubMention' : 'bareAirport';
    facts.push({ kind, value: code });
    slot = null;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    // 1. Flight numbers: "UA1432", "ua 1432", "flight 1432", "united 1432", a bare "1432".
    // "united 787" is an aircraft; "UA 787" and "flight 787" are flights.
    const prefixed = FLIGHT_PREFIXES.has(tok.low) && tokens[i + 1] && /^\d{1,4}$/.test(tokens[i + 1].low)
      && !(tok.low === 'united' && FAMILY_NUMBERS.has(tokens[i + 1].low));
    if (prefixed) {
      const flight = normalizeFlight(tokens[i + 1].low);
      if (flight) { facts.push({ kind: 'flight', value: flight }); i += 1; continue; }
    }
    const lettered = tok.low.match(/^(?:ua|ual|#)(\d{1,4})$/);
    if (lettered) {
      const flight = normalizeFlight(lettered[1]);
      if (flight) { facts.push({ kind: 'flight', value: flight }); continue; }
    }

    // 2. Phrases, longest first (four words down to one).
    let matched = false;
    for (let n = Math.min(4, tokens.length - i); n >= 1; n -= 1) {
      const phrase = plain(tokens.slice(i, i + n).map((t) => t.low).join(' '));
      // The last word may be a plural the lexicon lists in the singular ("737 max 9s").
      const singular = phrase.length > 3 && phrase.endsWith('s') ? phrase.slice(0, -1) : '';
      const lexicon = LEXICON.get(phrase)
        || LEXICON.get(tokens.slice(i, i + n).map((t) => t.low).join(' '))
        || (singular ? LEXICON.get(singular) : undefined);
      if (lexicon) {
        // "to Europe" names where a flight is going, which the vocabulary cannot say (a region is
        // where aircraft ARE); leave it to the server rather than read it as a map region.
        if ((slot === 'destination' || slot === 'origin') && lexicon.some((fact) => fact.kind === 'region')) {
          leftovers.push(phrase);
          slot = null;
          i += n - 1;
          matched = true;
          break;
        }
        for (const fact of lexicon) {
          if (fact.kind === 'slot') slot = /** @type {string} */ (fact.value);
          else facts.push(fact);
        }
        i += n - 1;
        matched = true;
        break;
      }
      const name = AIRPORT_NAMES.get(phrase);
      if (name) {
        airportFact(name);
        i += n - 1;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 3. Airport codes: a hub in any case; any other code in capitals, or after "to"/"from"; a code
    //    that is also an everyday word ("sea", "man") only in capitals or after "to"/"from".
    if (/^[a-z]{3}$/i.test(tok.raw)) {
      const code = tok.raw.toUpperCase();
      const typedAsCode = tok.raw === code;
      const endpointSlot = slot === 'origin' || slot === 'destination';
      if (ASK_AIRPORTS.has(code) && !STOPWORDS.has(tok.low)) {
        if (HUB_SET.has(code) || typedAsCode || endpointSlot || (slot && !WORDLIKE_CODES.has(code))) {
          airportFact(code);
          continue;
        }
        if (!WORDLIKE_CODES.has(code)) {
          // A lower-case non-hub code with nothing saying which end it is: not sure.
          leftovers.push(tok.raw);
          continue;
        }
      }
    }

    // 4. Tails.
    if (TAIL_TOKEN_RE.test(tok.low)) {
      const tail = normalizeTail(tok.low);
      if (tail) { facts.push({ kind: 'tail', value: tail }); continue; }
    }

    // 5. A bare number that is not an aircraft family is a United flight number.
    if (FLIGHT_TOKEN_RE.test(tok.low) && !FAMILY_NUMBERS.has(tok.low)) {
      const flight = normalizeFlight(tok.low);
      if (flight) { facts.push({ kind: 'flight', value: flight }); continue; }
    }

    // 6. Words that carry no filter.
    if (STOPWORDS.has(tok.low)) continue;

    // 7. A plural we do not list ("dreamlinerz" is not this) — try the singular once.
    if (tok.low.length > 3 && tok.low.endsWith('s')) {
      const single = LEXICON.get(tok.low.slice(0, -1));
      if (single) {
        for (const fact of single) {
          if (fact.kind === 'slot') slot = /** @type {string} */ (fact.value);
          else facts.push(fact);
        }
        continue;
      }
    }

    leftovers.push(tok.raw);
  }

  if (leftovers.length) return { confident: false, reason: 'unknown_words', leftovers, facts };
  if (!facts.length) return { confident: false, reason: 'nothing', leftovers, facts };

  const resolved = resolveFacts(facts);
  if (!resolved) return { confident: false, reason: 'conflict', leftovers, facts };
  const checked = validateAskResult(resolved);
  if (!checked.ok) return { confident: false, reason: 'invalid', leftovers, facts };
  // The validator may only drop what it cannot apply; if it dropped something the visitor asked
  // for, the rules did not really understand the question.
  // A flight number or a tail is the answer whatever else was said around it ("is UA1432 late?").
  if (checked.result.view === 'flight') return { confident: true, result: checked.result, leftovers: [] };
  const asked = new Set(Object.keys(resolved.filters));
  const kept = new Set(Object.keys(checked.result.filters));
  const lost = [...asked].filter((k) => !kept.has(k) && !(k === 'hub' && checked.result.filters.hub === undefined && (kept.has('origin') || kept.has('destination')))
    && !(k === 'family' && kept.has('type'))
    && !(k === 'starlink' && checked.result.view === 'starlink')
    && !(['origin', 'destination', 'direction'].includes(k) && kept.has('hub')));
  if (lost.length) return { confident: false, reason: 'invalid', leftovers: lost, facts };
  return { confident: true, result: checked.result, leftovers: [] };
}

/**
 * Facts → one {view, filters}. Returns null on a contradiction the vocabulary cannot hold (two
 * different hubs with no "from"/"to", two families, Starlink and no Starlink).
 * @param {Fact[]} facts
 */
function resolveFacts(facts) {
  /** @type {Record<string, unknown>} */
  const f = {};
  const views = new Set();
  const set = (name, value) => {
    if (f[name] !== undefined && f[name] !== value) return false;
    f[name] = value;
    return true;
  };
  for (const fact of facts) {
    let ok = true;
    switch (fact.kind) {
      case 'view': views.add(fact.value); break;
      case 'hubMention': ok = set('hub', fact.value); break;
      case 'bareAirport': break;
      default: ok = set(fact.kind, fact.value);
    }
    if (!ok) return null;
  }
  // A bare airport is the other end of a route when one end is named ("ORD to DEN" → from ORD),
  // and otherwise the hub ("denver 787s").
  for (const fact of facts) {
    if (fact.kind !== 'bareAirport') continue;
    let ok;
    if (f.destination && !f.origin && fact.value !== f.destination) ok = set('origin', fact.value);
    else if (f.origin && !f.destination && fact.value !== f.origin) ok = set('destination', fact.value);
    else ok = set('hub', fact.value);
    if (!ok) return null;
  }
  // A hub mention that is not a hub ("in SEA"): an endpoint we cannot place.
  if (f.hub && !HUB_SET.has(/** @type {string} */ (f.hub))) return null;

  let view = 'live';
  if (f.flight || f.tail) view = 'flight';
  else if (views.has('weather') && !f.status && !f.direction && !f.region && f.airborne === undefined && !f.family && !f.type) view = 'weather';
  else if (f.status || views.has('schedule') || (f.direction && f.region === undefined && f.airborne === undefined)) view = 'schedule';
  else if (views.has('live') || f.region !== undefined || f.airborne !== undefined || f.origin || f.destination) view = 'live';
  else if (views.has('fleet') && !f.hub) view = 'fleet';
  else if (views.has('starlink') || (f.starlink === true && !f.family && !f.type && !f.hub)) view = f.hub && !views.has('starlink') ? 'live' : 'starlink';
  if (views.has('weather') && view !== 'weather' && view !== 'flight') return null;

  // Nothing that filters and no view asked for: not an answer.
  const filterCount = Object.keys(f).length;
  if (!filterCount && !views.size) return null;
  return { view, filters: f };
}
