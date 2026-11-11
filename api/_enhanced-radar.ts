// Enhanced Radar client: GET /api/v0/airports/status, and nothing else.
//
// PAID: $1.50 per call (priced item `airport_status_update`), charged "after its data is loaded and
// before it is returned" (refs: concepts/billing). The owner's credit is finite, so this client:
//   - refuses to run unless ENHANCED_RADAR_ENABLED is exactly "1" (the cron also checks before it
//     even imports this module) and ENHANCED_RADAR_API_KEY is set;
//   - makes ONE attempt per call and NEVER retries: "a charge is final once it is recorded; if the
//     connection fails after that, the charge is not reversed, and retrying the request can be
//     charged again". The next cron run (after the 90-minute window) is the only retry;
//   - logs X-Charged-Usd and X-Balance-Usd (and X-Request-ID) for every response;
//   - reports `possiblyCharged` for a timeout or dropped connection, so the caller books the full
//     price against its caps.
// The guard (caps, the 90-minute window, the ledger) is api/_radio-status.ts.

export const ER_BASE_URL = 'https://api.enhancedradar.com';
export const ER_AIRPORT_STATUS_PATH = '/api/v0/airports/status';
/** The published price of one airport status (GET /api/v0/pricing, `airport_status_update`). */
export const ER_AIRPORT_STATUS_PRICE_USD = 1.5;
const TIMEOUT_MS = 8_000;

/** Exactly "1" turns it on. Anything else, including "true", leaves it off. */
export function isEnhancedRadarEnabled(): boolean {
  return process.env.ENHANCED_RADAR_ENABLED === '1';
}

export type ErAirportStatusResult = {
  ok: boolean;
  status: number | null;
  /** What the call cost: X-Charged-Usd when present; the full price when it may have been charged without saying. */
  chargedUsd: number;
  balanceUsd: number | null;
  requestId: string | null;
  data: any | null;
  error: string | null;
  /** True when the request may have been billed although no answer arrived (timeout, dropped connection). */
  possiblyCharged: boolean;
  /** False when nothing was sent (switched off, no key, bad id). */
  sent: boolean;
};

function usdHeader(headers: Headers | undefined, name: string): number | null {
  const raw = headers?.get?.(name);
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const notSent = (error: string): ErAirportStatusResult => ({
  ok: false, status: null, chargedUsd: 0, balanceUsd: null, requestId: null, data: null, error, possiblyCharged: false, sent: false,
});

/**
 * One airport status. Never throws, never retries.
 * @param facilityId  an airport facility_id from GET /api/v0/facilities (a uuid)
 */
export async function fetchAirportStatus(
  facilityId: string,
  { fetchImpl = fetch, timeoutMs = TIMEOUT_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ErAirportStatusResult> {
  if (!isEnhancedRadarEnabled()) return notSent('disabled');
  const key = process.env.ENHANCED_RADAR_API_KEY;
  if (!key) return notSent('no_api_key');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(facilityId))) return notSent('bad_facility_id');

  const url = `${ER_BASE_URL}${ER_AIRPORT_STATUS_PATH}?facility_id=${encodeURIComponent(facilityId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'BlueBoard-Brief/1.0' },
    });
  } catch (e: any) {
    clearTimeout(timer);
    const error = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 160);
    console.warn(`enhanced-radar airports/status facility=${facilityId} failed before a response (${error}); booking the full $${ER_AIRPORT_STATUS_PRICE_USD.toFixed(2)} — it may have been charged. Not retrying.`);
    return { ok: false, status: null, chargedUsd: ER_AIRPORT_STATUS_PRICE_USD, balanceUsd: null, requestId: null, data: null, error, possiblyCharged: true, sent: true };
  }

  const charged = usdHeader(resp.headers, 'x-charged-usd');
  const balance = usdHeader(resp.headers, 'x-balance-usd');
  const requestId = resp.headers?.get?.('x-request-id') ?? null;
  console.log(`enhanced-radar airports/status facility=${facilityId} status=${resp.status} charged=${charged === null ? 'n/a' : `$${charged.toFixed(3)}`} balance=${balance === null ? 'n/a' : `$${balance.toFixed(3)}`} request=${requestId ?? 'n/a'}`);

  try {
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      let message = '';
      try { message = String(JSON.parse(body)?.error || ''); } catch { message = body; }
      // 402/403 refusals and 4xx/5xx failures are not charged (concepts/billing); trust the header when present.
      return { ok: false, status: resp.status, chargedUsd: charged ?? 0, balanceUsd: balance, requestId, data: null, error: `HTTP ${resp.status}${message ? `: ${message.slice(0, 160)}` : ''}`, possiblyCharged: false, sent: true };
    }
    // A 200 is charged. A missing header is not proof of a free call: book the price.
    const chargedUsd = charged ?? ER_AIRPORT_STATUS_PRICE_USD;
    try {
      const data = await resp.json();
      return { ok: true, status: resp.status, chargedUsd, balanceUsd: balance, requestId, data, error: null, possiblyCharged: false, sent: true };
    } catch (e: any) {
      return { ok: false, status: resp.status, chargedUsd, balanceUsd: balance, requestId, data: null, error: `unreadable body: ${String(e?.message || e).slice(0, 120)}`, possiblyCharged: false, sent: true };
    }
  } finally {
    clearTimeout(timer);
  }
}
