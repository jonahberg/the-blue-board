#!/usr/bin/env bun
// Prewarm Vercel CDN cache for schedule data
// Run every 4-6 hours via cron to keep schedule endpoints hot
// This ensures real users always hit CDN cache, never cold serverless functions

// Marks this file as an ES module so TypeScript permits the top-level `await` below (fixes
// TS1375). Harmless at runtime under `bun scripts/prewarm-cache.ts`.
export {};

const BASE = "https://theblueboard.co/api";
const HUBS = ["ORD", "DEN", "IAH", "EWR", "SFO", "LAX", "IAD", "NRT", "GUM"];
const DIRS = ["departures", "arrivals"];

const now = new Date();
const todayStr = now.toISOString().slice(0, 10);
const TODAY_TS = Math.floor(new Date(todayStr + "T00:00:00Z").getTime() / 1000);

console.log(`${new Date().toISOString()} — Prewarming Blue Board CDN cache`);
console.log(`Timestamp: ${TODAY_TS}`);

let warmed = 0;
let failed = 0;

for (const hub of HUBS) {
  for (const dir of DIRS) {
    const url = `${BASE}/schedule?hub=${hub}&dir=${dir}&timestamp=${TODAY_TS}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        console.log(`  OK  ${hub} ${dir} — ${res.status}`);
        warmed++;
      } else {
        console.log(`  FAIL ${hub} ${dir} — ${res.status}`);
        failed++;
      }
    } catch (e: unknown) {
      console.log(`  FAIL ${hub} ${dir} — ${(e as Error).message}`);
      failed++;
    }
    await Bun.sleep(3000); // respect rate limits
  }
}

// Also warm IROPS and METAR. Count failures in both branches so the script's
// exit code reflects genuine outages (CI alerting relies on non-zero exit for
// FAIL in this loop, which was previously silent).
for (const [label, path] of [
  ["IROPS", "/irops"],
  ["METAR", "/metar?ids=KORD,KDEN,KIAH,KEWR,KSFO,KLAX,KIAD,RJAA,PGUM"],
  ["FAA", "/faa"],
] as const) {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60000) });
    if (res.ok) {
      console.log(`  OK  ${label} — ${res.status}`);
    } else {
      console.log(`  FAIL ${label} — ${res.status}`);
      failed++;
    }
  } catch (e: unknown) {
    console.log(`  FAIL ${label} — ${(e as Error).message}`);
    failed++;
  }
}

console.log(`Done: ${warmed} warmed, ${failed} failed`);
if (failed > 0) process.exit(1);
