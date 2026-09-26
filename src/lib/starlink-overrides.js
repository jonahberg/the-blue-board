// Evidence-backed additions that have not reached the upstream tracker yet.
// Keep this list deliberately small and require direct proof. Overrides are merged by tail, so
// the upstream record wins automatically as soon as it appears and no duplicate is created.
//
// N76265: passenger screenshot identified fleet 3265 / tail N76265 with Starlink on 2026-08-29.
// Source: https://github.com/jonahberg/the-blue-board/issues/248
export const VERIFIED_STARLINK_OVERRIDES = Object.freeze([
  Object.freeze({
    tail: 'N76265',
    fleet: 'Mainline',
    type: '737-800',
    operator: 'United Airlines',
    dateFound: '2026-08-29',
    wifi: 'Starlink',
  }),
]);

export function applyVerifiedStarlinkOverrides(aircraft) {
  const knownTails = new Set(aircraft.map((a) => String(a.tail || '').toUpperCase()));
  const additions = VERIFIED_STARLINK_OVERRIDES.filter((a) => !knownTails.has(a.tail));
  return additions.length > 0 ? [...aircraft, ...additions] : aircraft;
}
