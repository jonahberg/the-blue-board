import { atcAirports, atcMeta } from '../../data/trackers/atc.js';
import { jsonHeaders } from '../../lib/tracker-downloads.js';

export function GET() {
  return new Response(
    JSON.stringify({ meta: atcMeta, airports: atcAirports }, null, 2),
    { headers: jsonHeaders('blue-board-faa-tfdm-airports.json') }
  );
}
