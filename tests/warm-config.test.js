import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('vercel.json warm-schedules cron config', () => {
  it("fires hourly ('0 * * * *'), in lockstep with SLOT_MS in api/cron/warm-schedules.ts", () => {
    // Documented footgun: buildWarmPlan strides the warm ring once per SLOT_MS (hard-coded to
    // 60 min in api/cron/warm-schedules.ts). The cron interval in vercel.json MUST match it.
    // If the cron schedule changes without SLOT_MS (or vice versa), the ring is either skipped
    // (slots fire but the stride doesn't advance — windows never get warmed) or strided multiple
    // steps per fire (windows silently skipped while quota is still burned). Update both together.
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const cron = (config.crons || []).find((c) => c.path === '/api/cron/warm-schedules');
    expect(cron, 'warm-schedules cron entry missing from vercel.json').toBeTruthy();
    expect(cron.schedule).toBe('0 * * * *');
  });

  it('SLOT_MS in warm-schedules.ts matches the hourly cron (the other side of the lockstep)', () => {
    // Without this, changing SLOT_MS back to 2h while vercel.json stays hourly would pass the
    // test above and silently double-stride the warm ring in production.
    const src = readFileSync(new URL('../api/cron/warm-schedules.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/const SLOT_MS = 60 \* 60 \* 1000/);
  });
});
