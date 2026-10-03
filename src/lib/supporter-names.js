// ═══ SUPPORTER NAMES: IS THIS PERSON ALREADY ON THE WALL? ═══
// scripts/supporters-diff.mjs compares Buy Me a Coffee display names (free text, retyped on every
// support) with src/data/supporters.js. A returning supporter typed "Flyer Talk JCG1005" against
// the wall's "FlyerTalk JCG1005" and was flagged as new (Oct 2026). The comparison key keeps only
// lowercase letters and digits — any script, so "José" keeps its é — and drops spacing and
// punctuation. A name with no letters or digits at all keeps its trimmed lowercase text instead,
// so two such names can never collide on an empty key.

/**
 * @param {unknown} name
 * @returns {string}
 */
export function supporterNameKey(name) {
  const raw = String(name ?? '').trim().toLowerCase();
  const key = raw.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');
  return key || raw;
}

/**
 * A lookup over the wall that answers by key.
 *
 * @param {Iterable<string>} wall
 * @returns {(name: string) => boolean}
 */
export function onWallMatcher(wall) {
  const keys = new Set();
  for (const name of wall || []) keys.add(supporterNameKey(name));
  return (name) => keys.has(supporterNameKey(name));
}
