import { unitedHubsMeta, unitedHubs, unitedProjects } from '../../data/trackers/united-hubs.js';
import { csvHeaders, toCsv } from '../../lib/tracker-downloads.js';

const columns = [
  'hub',
  'airport',
  'city',
  'state',
  'project_id',
  'project_name',
  'project_type',
  'status',
  'builder',
  'target_date',
  'opened_date',
  'size_sq_ft',
  'cost_usd',
  'gates',
  'details',
  'sources',
  'last_verified',
];

export function GET() {
  const rows = unitedProjects.map((project) => {
    const hub = unitedHubs[project.hub];
    return {
      hub: project.hub,
      airport: hub.name,
      city: hub.city,
      state: hub.state,
      project_id: project.id,
      project_name: project.name,
      project_type: project.projectType,
      status: project.status,
      builder: project.builder,
      target_date: project.targetDate ?? '',
      opened_date: project.openedDate ?? '',
      size_sq_ft: project.sizeSqFt ?? '',
      cost_usd: project.costUsd ?? '',
      gates: project.gates ?? '',
      details: project.details,
      sources: project.sources,
      last_verified: unitedHubsMeta.lastVerified,
    };
  });

  return new Response(toCsv(rows, columns), { headers: csvHeaders('blue-board-united-hub-projects.csv') });
}
