export const FR24_SCHEDULE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.flightradar24.com/',
  'Origin': 'https://www.flightradar24.com',
};

type ScraperResult = {
  data: any;
  transport: 'scrapingbee' | 'http-json';
};

function remainingTimeout(deadlineMs?: number): number {
  const remaining = deadlineMs ? deadlineMs - Date.now() - 500 : 20000;
  return Math.max(1500, Math.min(remaining, 20000));
}

function scraperMode(): 'scrapingbee' | 'http-json' | 'off' {
  const explicit = String(process.env.SCHEDULE_SCRAPER_MODE || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'none', 'disabled'].includes(explicit)) return 'off';
  if (explicit === 'scrapingbee') return 'scrapingbee';
  if (['http-json', 'generic', 'proxy'].includes(explicit)) return 'http-json';
  if (process.env.SCHEDULE_SCRAPER_URL) return 'http-json';
  if (process.env.SCRAPINGBEE_API_KEY) return 'scrapingbee';
  return 'off';
}

export function hasConfiguredFr24ScraperTransport(): boolean {
  const mode = scraperMode();
  if (mode === 'scrapingbee') return Boolean(process.env.SCRAPINGBEE_API_KEY);
  if (mode === 'http-json') return Boolean(process.env.SCHEDULE_SCRAPER_URL);
  return false;
}

function parseJsonCandidate(value: any): any | null {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const preMatch = trimmed.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (preMatch) {
      const preBody = preMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#x22;/gi, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      try {
        return JSON.parse(preBody);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeTransportPayload(payload: any): any | null {
  const parsed = parseJsonCandidate(payload);
  if (!parsed) return null;

  if (parsed?.result?.response?.airport) return parsed;
  if (parsed?.json) return normalizeTransportPayload(parsed.json);
  if (parsed?.body) return normalizeTransportPayload(parsed.body);
  if (parsed?.data?.result?.response?.airport) return parsed.data;
  if (parsed?.data?.json || parsed?.data?.body) return normalizeTransportPayload(parsed.data);

  return null;
}

async function readJsonFromResponse(resp: Response): Promise<any | null> {
  const text = await resp.text().catch(() => '');
  return normalizeTransportPayload(text);
}

async function fetchWithAbort(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaScrapingBee(targetUrl: string, deadlineMs?: number): Promise<ScraperResult | null> {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) return null;

  const timeoutMs = remainingTimeout(deadlineMs);
  const url = new URL('https://app.scrapingbee.com/api/v1');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('url', targetUrl);
  url.searchParams.set('render_js', String(process.env.SCHEDULE_SCRAPER_RENDER_JS || 'false'));
  url.searchParams.set('premium_proxy', String(process.env.SCHEDULE_SCRAPER_PREMIUM_PROXY || 'true'));
  url.searchParams.set('country_code', process.env.SCHEDULE_SCRAPER_COUNTRY || 'us');

  try {
    const resp = await fetchWithAbort(url.toString(), {
      headers: {
        'Accept': 'application/json,text/plain,*/*',
        'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
      },
    }, timeoutMs);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`ScrapingBee FR24 schedule scrape returned ${resp.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await readJsonFromResponse(resp);
    return data ? { data, transport: 'scrapingbee' } : null;
  } catch (e: any) {
    console.error(`ScrapingBee FR24 schedule scrape failed: ${e?.message || e}`);
    return null;
  }
}

async function fetchViaHttpJsonTransport(targetUrl: string, deadlineMs?: number): Promise<ScraperResult | null> {
  const endpoint = process.env.SCHEDULE_SCRAPER_URL;
  if (!endpoint) return null;

  const timeoutMs = remainingTimeout(deadlineMs);
  const headers: Record<string, string> = {
    'Accept': 'application/json,text/plain,*/*',
    'Content-Type': 'application/json',
    'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
  };
  if (process.env.SCHEDULE_SCRAPER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SCHEDULE_SCRAPER_TOKEN}`;
  }

  try {
    const resp = await fetchWithAbort(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: targetUrl,
        method: 'GET',
        headers: FR24_SCHEDULE_HEADERS,
        timeoutMs,
      }),
    }, timeoutMs);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`FR24 schedule scraper transport returned ${resp.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const payload = await readJsonFromResponse(resp);
    return payload ? { data: payload, transport: 'http-json' } : null;
  } catch (e: any) {
    console.error(`FR24 schedule scraper transport failed: ${e?.message || e}`);
    return null;
  }
}

export async function fetchFr24ScheduleViaScraperTransport(targetUrl: string, deadlineMs?: number): Promise<ScraperResult | null> {
  switch (scraperMode()) {
    case 'scrapingbee':
      return await fetchViaScrapingBee(targetUrl, deadlineMs);
    case 'http-json':
      return await fetchViaHttpJsonTransport(targetUrl, deadlineMs);
    default:
      return null;
  }
}
