#!/usr/bin/env node

const HUB_TIMEZONES = {
  ORD: 'America/Chicago',
  DEN: 'America/Denver',
  IAH: 'America/Chicago',
  EWR: 'America/New_York',
  SFO: 'America/Los_Angeles',
  IAD: 'America/New_York',
  LAX: 'America/Los_Angeles',
  NRT: 'Asia/Tokyo',
  GUM: 'Pacific/Guam',
};

const HUBS = Object.keys(HUB_TIMEZONES);
const DAY_WINDOWS = [
  { label: 'yesterday', offset: -1 },
  { label: 'today', offset: 0 },
  { label: 'tomorrow', offset: 1 },
];
const DIRECTIONS = ['departures', 'arrivals'];

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.BLUEBOARD_BASE_URL || 'https://theblueboard.co',
    delayMs: Number(process.env.SCHEDULE_SEED_DELAY_MS || 1500),
    timeoutMs: Number(process.env.SCHEDULE_SEED_TIMEOUT_MS || 65000),
    retries: Number(process.env.SCHEDULE_SEED_RETRIES || 2),
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
    } else if (arg.startsWith('--delay-ms=')) {
      options.delayMs = Number(arg.slice('--delay-ms='.length));
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg.startsWith('--retries=')) {
      options.retries = Number(arg.slice('--retries='.length));
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: bun run seed:schedules -- [options]

Options:
  --base-url=https://theblueboard.co   Target site to seed
  --delay-ms=1500                      Pause between requests
  --timeout-ms=65000                   Per-request timeout
  --retries=2                          Retries per failed request

Env overrides:
  BLUEBOARD_BASE_URL
  SCHEDULE_SEED_DELAY_MS
  SCHEDULE_SEED_TIMEOUT_MS
  SCHEDULE_SEED_RETRIES`);
}

function getStartOfDayForHub(hub, dayOffset) {
  const tz = HUB_TIMEZONES[hub] || 'America/Chicago';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => Number(parts.find((part) => part.type === type)?.value || '0');
  const secondsSinceMidnight = (get('hour') * 3600) + (get('minute') * 60) + get('second');
  const startOfToday = Math.floor(now.getTime() / 1000) - secondsSinceMidnight;
  return startOfToday + (dayOffset * 86400);
}

function buildSeedPlan() {
  const plan = [];
  for (const window of DAY_WINDOWS) {
    for (const dir of DIRECTIONS) {
      for (const hub of HUBS) {
        plan.push({
          hub,
          dir,
          dayLabel: window.label,
          timestamp: getStartOfDayForHub(hub, window.offset),
        });
      }
    }
  }
  return plan;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'BlueBoard-ScheduleSeeder/1.0',
        'Accept': 'application/json',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function seedOne(task, options) {
  const url = new URL('/api/schedule', options.baseUrl);
  url.searchParams.set('hub', task.hub);
  url.searchParams.set('dir', task.dir);
  url.searchParams.set('timestamp', String(task.timestamp));

  let lastError = null;
  for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options.timeoutMs);
      const raw = await response.text();
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
      } else if (body?.error) {
        lastError = new Error(body.error);
      } else {
        return {
          ok: true,
          status: response.status,
          total: Number(body?.total || 0),
          partial: Boolean(body?.partial),
          degraded: Boolean(body?.degraded),
          cached: Boolean(body?.cached),
          source: body?.meta?.source || 'unknown',
        };
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt <= options.retries) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  return {
    ok: false,
    error: lastError?.message || 'Unknown error',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const plan = buildSeedPlan();
  const startedAt = Date.now();
  let ok = 0;
  let failed = 0;

  console.log(`Seeding ${plan.length} schedule windows against ${options.baseUrl}`);
  console.log(`Delay ${options.delayMs}ms · timeout ${options.timeoutMs}ms · retries ${options.retries}`);

  for (let index = 0; index < plan.length; index++) {
    const task = plan[index];
    const label = `${task.hub} ${task.dir} ${task.dayLabel}`;
    const result = await seedOne(task, options);

    if (result.ok) {
      ok++;
      const flags = [];
      if (result.cached) flags.push('cached');
      if (result.partial) flags.push('partial');
      if (result.degraded) flags.push('degraded');
      console.log(`[${index + 1}/${plan.length}] OK   ${label} · ${result.total} flights · ${result.source}${flags.length ? ` · ${flags.join(',')}` : ''}`);
    } else {
      failed++;
      console.log(`[${index + 1}/${plan.length}] FAIL ${label} · ${result.error}`);
    }

    if (index < plan.length - 1 && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`Done in ${elapsedSec}s · ${ok} ok · ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Schedule seed failed:', error);
  process.exitCode = 1;
});
