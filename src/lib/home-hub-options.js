// ═══ THE HOME-HUB PICKER'S OPTIONS ═══
// One list for every home-hub picker: the phone More sheet (src/app/shell/MobileNav.tsx) and the
// "What is this dashboard?" dialog (src/app/features/Onboarding.tsx) both read it here. The codes
// follow HOME_HUB_CYCLE (src/lib/home-airport.js), minus its "no preference" slot.

/** @type {ReadonlyArray<{code: string, name: string}>} */
export const HOME_HUB_OPTIONS = Object.freeze([
  { code: 'ORD', name: "Chicago O'Hare" },
  { code: 'DEN', name: 'Denver' },
  { code: 'IAH', name: 'Houston' },
  { code: 'EWR', name: 'Newark' },
  { code: 'SFO', name: 'San Francisco' },
  { code: 'IAD', name: 'Washington Dulles' },
  { code: 'LAX', name: 'Los Angeles' },
  { code: 'NRT', name: 'Tokyo Narita' },
  { code: 'GUM', name: 'Guam' },
]);
