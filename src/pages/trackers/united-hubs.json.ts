import { unitedHubsMeta, unitedHubs, unitedProjects } from '../../data/trackers/united-hubs.js';
import { JSON_HEADERS } from '../../lib/tracker-downloads.js';

export function GET() {
  return new Response(
    JSON.stringify({ meta: unitedHubsMeta, hubs: unitedHubs, projects: unitedProjects }, null, 2),
    { headers: JSON_HEADERS }
  );
}
