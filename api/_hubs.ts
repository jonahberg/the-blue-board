// Single source of truth for the United hub list and terminal assignments.
// Shared by api/schedule.ts (request validation + terminals), api/_schedule-aerodatabox.ts
// (terminals), and api/cron/warm-schedules.ts (warm rotation). The /api/schedule handler
// rejects anything outside this set: every distinct hub value mints its own cache keys and,
// on a miss, fires 2 metered AeroDataBox calls — an open-ended airport parameter is an
// unmetered spend surface.

export const UNITED_HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'] as const;

export const UNITED_HUB_SET: ReadonlySet<string> = new Set(UNITED_HUBS);

// Known United Airlines terminal assignments at each hub (used when the API doesn't provide
// terminal data).
export const UNITED_HUB_TERMINALS: Record<string, { domestic: string; international: string }> = {
  ORD: { domestic: '1', international: '1' },       // Terminal 1 (Concourses B & C); Express uses T2
  DEN: { domestic: 'B', international: 'B' },       // Concourse B
  EWR: { domestic: 'C', international: 'C' },       // Terminal C (primary); some flights use Terminal A
  IAH: { domestic: 'C', international: 'E' },       // Terminal C (domestic), Terminal E (international)
  SFO: { domestic: '3', international: 'G' },       // Terminal 3 (domestic), International Terminal G
  LAX: { domestic: '7', international: '7' },       // Terminals 7 & 8
  IAD: { domestic: 'C', international: 'D' },       // Concourse C (domestic), Concourse D (international)
  NRT: { domestic: '1', international: '1' },       // Terminal 1
  GUM: { domestic: '1', international: '1' },       // Single terminal
};

export function getHubTerminal(iata: string, isIntl: boolean): string {
  const hub = UNITED_HUB_TERMINALS[iata.toUpperCase()];
  if (!hub) return '';
  return isIntl ? hub.international : hub.domestic;
}
