/**
 * The Supporters Wall — the names shown in the About dialog (inventory §13).
 *
 * These are people who paid for this to exist. Every name is transcribed VERBATIM from the
 * display name they gave Buy Me a Coffee (casing, "@", "u/" and all): dropping or "tidying"
 * one is not a cosmetic bug. `tests/supporters.test.js` pins the list so a rewrite can't lose
 * anyone silently.
 *
 * The first seventeen are the original wall (Feb 2026, carried over from the legacy page). The
 * rest are appended in the order they supported. Anonymous supporters ("Someone" on BMC) are
 * deliberately left off — they chose not to be named.
 *
 * To check for new supporters: `bun scripts/supporters-diff.mjs` lists public BMC supporters
 * who are not on this wall yet. Adding them stays a manual, reviewed edit — the wall is never
 * filled automatically, because a display name is free text anyone can type.
 */
export const SUPPORTERS = [
  '@LinBros88',
  'Greeby',
  'u/WrldDriftR',
  'LoveBlueBoard',
  '@paytonwolfee',
  'Danny',
  '@misadventurelab',
  'natto',
  '@MissLynsey',
  'K2',
  'James W',
  'Aaron',
  '@pconrad0',
  'Stephen R',
  'FlyerTalk JCG1005',
  'ML',
  'Leo',
  // Mar 2026 →
  '@Benchilada129',
  'Paul Leonard',
  'Mickey Kopanski',
  '/u/bcb354',
  'james macnutt',
  'Greg Calvert',
  'JayS',
];
