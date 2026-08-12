import { atcAirports, atcMeta } from '../../data/trackers/atc.js';
import { csvHeaders, toCsv } from '../../lib/tracker-downloads.js';

const columns = [
  'code',
  'name',
  'city',
  'state',
  'status',
  'go_live_date',
  'planned_ioc',
  'note',
  'sources',
  'last_verified',
];

export function GET() {
  const rows = atcAirports.map((airport) => ({
    code: airport.code,
    name: airport.name,
    city: airport.city,
    state: airport.state,
    status: airport.status,
    go_live_date: airport.goLiveDate ?? '',
    planned_ioc: airport.plannedIoc ?? '',
    note: airport.note ?? '',
    sources: airport.sources,
    last_verified: atcMeta.lastVerified,
  }));

  return new Response(toCsv(rows, columns), { headers: csvHeaders('blue-board-faa-tfdm-airports.csv') });
}
