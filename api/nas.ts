import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';

const isRateLimited = createRateLimiter('nas', 60);

// --- ARTCC code → plain-English name ---

const ARTCC_NAMES: Record<string, string> = {
  ZNY: 'New York Center', ZBW: 'Boston Center', ZDC: 'Washington Center',
  ZTL: 'Atlanta Center', ZJX: 'Jacksonville Center', ZMA: 'Miami Center',
  ZAU: 'Chicago Center', ZMP: 'Minneapolis Center', ZKC: 'Kansas City Center',
  ZFW: 'Fort Worth Center', ZHU: 'Houston Center', ZDV: 'Denver Center',
  ZLC: 'Salt Lake Center', ZLA: 'Los Angeles Center', ZOA: 'Oakland Center',
  ZSE: 'Seattle Center', ZME: 'Memphis Center', ZID: 'Indianapolis Center',
  ZOB: 'Cleveland Center', ZAB: 'Albuquerque Center',
};

// --- FAA shorthand decoder ---

const FAA_SHORTHAND: Record<string, string> = {
  GDP: 'Ground Delay Program',
  GS: 'Ground Stop',
  GDS: 'Ground Stop',
  MIT: 'Miles-in-Trail',
  MINIT: 'Minutes-in-Trail',
  CDRS: 'Coded Departure Routes',
  SWAP: 'Severe Weather Avoidance',
  AFP: 'Airspace Flow Program',
  EDCT: 'Expect Departure Clearance Time',
  APREQ: 'Approval Request',
  DSP: 'Departure Spacing Program',
  FCA: 'Flow Constrained Area',
  FEA: 'Flow Evaluation Area',
};

function decodeFaaShorthand(event: string): string {
  let decoded = event.replace(/^-/, '').trim();
  // Replace known abbreviations
  for (const [abbr, full] of Object.entries(FAA_SHORTHAND)) {
    decoded = decoded.replace(new RegExp(`\\b${abbr}\\b`, 'g'), full);
  }
  return decoded;
}

/** Extract 3-letter IATA airport codes from event text */
function extractAirportCodes(text: string): string[] {
  const matches = text.match(/\b([A-Z]{3})\b/g) || [];
  // Filter to known airports (simple heuristic: exclude common abbreviations)
  const exclude = new Set(['AND', 'THE', 'FOR', 'NOT', 'ALL', 'CDR', 'MIT', 'AFP', 'FCA', 'LOW', 'MED', 'EST', 'UTC']);
  return matches.filter(m => !exclude.has(m));
}

function artccName(code: string): string {
  return ARTCC_NAMES[code] || code;
}

// --- Types ---

interface EnrouteProgram {
  name: string;
  reason: string;
  avgDelay: number | null;
  startTime: string;
  endTime: string;
  affectedFacilities: string[];
}

interface PlannedTMI {
  time: string;
  event: string;
  decoded: string;
  affectedAirports: string[];
  type: 'terminal' | 'enroute';
}

interface NASResponse {
  active: EnrouteProgram[];
  planned: PlannedTMI[];
  advisoryUrl: string | null;
}

// --- Parsers ---

function parseEnrouteEvents(data: unknown): EnrouteProgram[] {
  if (!Array.isArray(data)) return [];
  const programs: EnrouteProgram[] = [];

  for (const item of data) {
    const afp = item?.airspaceFlowProgram;
    if (!afp) continue;

    const name = String(afp.afpName || '').trim();
    if (!name) continue;

    programs.push({
      name,
      reason: String(afp.impactingCondition || '').trim(),
      avgDelay: typeof afp.avgDelay === 'number' && Number.isFinite(afp.avgDelay)
        ? Math.round(afp.avgDelay) : null,
      startTime: String(afp.startTime || ''),
      endTime: String(afp.endTime || ''),
      affectedFacilities: [
        ...(Array.isArray(item.departsAny) ? item.departsAny : String(item.departsAny || '').split(',').filter(Boolean)),
        ...(Array.isArray(item.arrivesAny) ? item.arrivesAny : String(item.arrivesAny || '').split(',').filter(Boolean)),
      ].map(s => s.trim()).filter(Boolean),
    });
  }

  return programs;
}

function parseOperationsPlan(data: unknown): { planned: PlannedTMI[]; advisoryUrl: string | null } {
  if (!data || typeof data !== 'object') return { planned: [], advisoryUrl: null };
  const obj = data as any;

  const advisoryUrl = typeof obj.link === 'string' && obj.link.startsWith('https://')
    ? obj.link : null;

  const planned: PlannedTMI[] = [];

  for (const entry of Array.isArray(obj.terminalPlanned) ? obj.terminalPlanned : []) {
    const time = String(entry?.time || '').trim();
    const event = String(entry?.event || '').replace(/^-/, '').trim();
    if (!event) continue;
    planned.push({
      time,
      event,
      decoded: decodeFaaShorthand(event),
      affectedAirports: extractAirportCodes(event),
      type: 'terminal',
    });
  }

  for (const entry of Array.isArray(obj.enRoutePlanned) ? obj.enRoutePlanned : []) {
    const time = String(entry?.time || '').trim();
    const event = String(entry?.event || '').replace(/^-/, '').trim();
    if (!event) continue;
    planned.push({
      time,
      event,
      decoded: decodeFaaShorthand(event),
      affectedAirports: extractAirportCodes(event),
      type: 'enroute',
    });
  }

  return { planned, advisoryUrl };
}

// --- Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  try {
    const [enrouteResult, planResult] = await Promise.allSettled([
      fetchWithTimeout('https://nasstatus.faa.gov/api/enroute-events', 8000),
      fetchWithTimeout('https://nasstatus.faa.gov/api/operations-plan', 8000),
    ]);

    const active = enrouteResult.status === 'fulfilled'
      ? parseEnrouteEvents(enrouteResult.value)
      : [];

    const { planned, advisoryUrl } = planResult.status === 'fulfilled'
      ? parseOperationsPlan(planResult.value)
      : { planned: [], advisoryUrl: null };

    if (enrouteResult.status === 'rejected') {
      console.warn('NAS enroute-events fetch failed:', enrouteResult.reason?.message || enrouteResult.reason);
    }
    if (planResult.status === 'rejected') {
      console.warn('NAS operations-plan fetch failed:', planResult.reason?.message || planResult.reason);
    }

    const response: NASResponse = { active, planned, advisoryUrl };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
  } catch (e: any) {
    console.error('NAS API error:', e);
    return res.status(502).json({ error: 'Upstream service unavailable' });
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
