import { unitedHubsMeta, unitedHubs, unitedProjects } from '../../data/trackers/united-hubs.js';
import { jsonHeaders } from '../../lib/tracker-downloads.js';

export function GET() {
  return new Response(
    JSON.stringify({ meta: unitedHubsMeta, hubs: unitedHubs, projects: unitedProjects }, null, 2),
    { headers: jsonHeaders('blue-board-united-hub-projects.json') }
  );
}
