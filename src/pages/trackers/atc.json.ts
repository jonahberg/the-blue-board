import { atcAirports, atcMeta } from '../../data/trackers/atc.js';
import { JSON_HEADERS } from '../../lib/tracker-downloads.js';

export function GET() {
  return new Response(
    JSON.stringify({ meta: atcMeta, airports: atcAirports }, null, 2),
    { headers: JSON_HEADERS }
  );
}
