// @ts-check
/**
 * Per-entry "verified" dates for the tracker data files.
 *
 * A tracker file carries one `meta.lastVerified`: the day every entry's sources were last
 * re-checked. A partial pass (Nov 11 2026 re-checked only the two Dulles Concourse E entries)
 * gives the entries it re-checked their own `verified` day instead of moving the file's date
 * forward, so no source panel claims a check that did not happen. Everything a page prints about
 * verification is derived here, from those dates.
 *
 * Pure and DOM-free: the Astro pages, the CSV export, the validator in ./index.js and the tests
 * all call these.
 */

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {{ id?: string, hub?: string, name?: string, verified?: string }} VerifiableEntry
 * @typedef {{ lastUpdated: string, lastVerified: string }} VerifiableMeta
 */

/**
 * A real calendar day written YYYY-MM-DD ("2026-02-30" and "2026-13-45" are not).
 * @param {unknown} value
 * @returns {value is string}
 */
export function isIsoDay(value) {
  if (typeof value !== 'string' || !ISO_DAY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today as a UTC YYYY-MM-DD, for the "not in the future" rule. @param {Date} [now] */
export function utcToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * The day this entry's sources were last checked: its own `verified` after a partial pass,
 * otherwise the file's.
 * @param {VerifiableEntry} entry
 * @param {VerifiableMeta} meta
 */
export function entryVerified(entry, meta) {
  return entry.verified ?? meta.lastVerified;
}

/**
 * Why an entry's `verified` is unusable; [] when it is fine or absent. `today` (UTC YYYY-MM-DD)
 * turns on the not-in-the-future rule. Leave it out where the clock is not ours: the dashboard
 * imports the tracker data in the visitor's browser, and a wrong device clock must not throw.
 * @param {VerifiableEntry} entry
 * @param {VerifiableMeta} meta
 * @param {string} [today]
 * @returns {string[]}
 */
export function entryVerifiedProblems(entry, meta, today) {
  if (entry.verified === undefined) return [];
  if (!isIsoDay(entry.verified)) return [`verified "${entry.verified}" is not a real YYYY-MM-DD day`];
  const problems = [];
  if (today && entry.verified > today) problems.push(`verified ${entry.verified} is in the future (today is ${today} UTC)`);
  if (entry.verified < meta.lastVerified) {
    problems.push(
      `verified ${entry.verified} is older than the file's lastVerified ${meta.lastVerified} — a full pass covers it; drop the field`
    );
  }
  return problems;
}

/**
 * The newest verification behind these entries: the file's date or any entry's own, whichever
 * is later. With no per-entry dates this is `meta.lastVerified`.
 * @param {VerifiableEntry[]} entries
 * @param {VerifiableMeta} meta
 */
export function newestVerified(entries, meta) {
  return entries.reduce((max, e) => {
    const d = entryVerified(e, meta);
    return d > max ? d : max;
  }, meta.lastVerified);
}

/**
 * What a header says about verification for a set of entries (a whole tracker, or one hub's
 * projects): the oldest day any of them was checked, and, when some were re-checked later, the
 * newest day and the entries that carry it. `newest` is null when every entry shares one day.
 * @template {VerifiableEntry} T
 * @param {T[]} entries
 * @param {VerifiableMeta} meta
 * @returns {{ oldest: string, newest: string | null, newestEntries: T[] }}
 */
export function verificationSummary(entries, meta) {
  if (entries.length === 0) return { oldest: meta.lastVerified, newest: null, newestEntries: [] };
  const days = entries.map((e) => entryVerified(e, meta));
  const oldest = days.reduce((a, b) => (b < a ? b : a));
  const newest = days.reduce((a, b) => (b > a ? b : a));
  if (newest === oldest) return { oldest, newest: null, newestEntries: [] };
  return { oldest, newest, newestEntries: entries.filter((e) => entryVerified(e, meta) === newest) };
}

/** @param {string} name */
const words = (name) => name.split(/[\s,()/]+/).filter(Boolean);

/**
 * The longest run of consecutive words every name shares ("Concourse E" from "Concourse E" and
 * "United Club, Concourse E (flagship)"); '' when they share none worth printing.
 * @param {string[]} names
 */
export function sharedNamePhrase(names) {
  if (names.length < 2) return '';
  const [first, ...rest] = names.map(words);
  const restText = rest.map((w) => ` ${w.join(' ')} `);
  let best = '';
  for (let i = 0; i < first.length; i++) {
    for (let j = first.length; j > i; j--) {
      const phrase = first.slice(i, j).join(' ');
      if (phrase.length <= best.length) break;
      if (restText.every((t) => t.includes(` ${phrase} `))) {
        best = phrase;
        break;
      }
    }
  }
  // A lone letter or a two-letter word ("E", "of") names nothing on its own.
  return best.replace(/\s/g, '').length >= 3 ? best : '';
}

/**
 * Words for the entries re-checked later than the rest, from their hub and names:
 * "Dulles Concourse E entries", "Dulles: Concourse E", "2 Dulles entries", "3 entries".
 * The place is the hub's search alias where it has one (Guam, whose city is Tamuning), else its
 * city.
 * @param {VerifiableEntry[]} entries
 * @param {Record<string, { city: string, searchAlias?: string }>} [hubs]
 */
export function verifiedEntriesLabel(entries, hubs = {}) {
  if (entries.length === 0) return '';
  const hubCodes = [...new Set(entries.map((e) => e.hub).filter(Boolean))];
  const hub = hubCodes.length === 1 && entries.every((e) => e.hub) ? hubs[/** @type {string} */ (hubCodes[0])] : undefined;
  const place = hub ? (hub.searchAlias ?? hub.city) : '';
  if (entries.length === 1) {
    const name = entries[0].name ?? entries[0].id ?? 'one entry';
    return place ? `${place}: ${name}` : name;
  }
  const phrase = sharedNamePhrase(entries.map((e) => e.name ?? ''));
  if (phrase) return `${place ? `${place} ` : ''}${phrase} entries`;
  return `${entries.length} ${place ? `${place} ` : ''}entries`;
}

/**
 * The header's parenthetical, or null when every entry was checked on one day:
 * { label: 'Dulles Concourse E entries', iso: '2026-11-11' }.
 * @param {VerifiableEntry[]} entries
 * @param {VerifiableMeta} meta
 * @param {Record<string, { city: string, searchAlias?: string }>} [hubs]
 * @returns {{ label: string, iso: string } | null}
 */
export function verifiedNote(entries, meta, hubs) {
  const { newest, newestEntries } = verificationSummary(entries, meta);
  return newest ? { label: verifiedEntriesLabel(newestEntries, hubs), iso: newest } : null;
}

/**
 * A truthful `dateModified` for a page built from these entries. Their facts cannot have changed
 * after the file's last update, nor after their own last check (a change is made during a check),
 * so the earlier of the two is the latest day the page's content can have changed.
 * @param {VerifiableEntry[]} entries
 * @param {VerifiableMeta} meta
 */
export function contentModified(entries, meta) {
  const verified = newestVerified(entries, meta);
  return verified < meta.lastUpdated ? verified : meta.lastUpdated;
}
