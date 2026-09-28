import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('vercel.json warm-schedules cron config', () => {
  it("fires every 30 min ('*/30 * * * *'), in lockstep with SLOT_MS in api/cron/warm-schedules.ts", () => {
    // Documented footgun: buildWarmPlan strides the warm ring once per SLOT_MS (exported from
    // api/cron/warm-schedules.ts). The cron interval in vercel.json MUST match it.
    // If the cron schedule changes without SLOT_MS (or vice versa), the ring is either skipped
    // (slots fire but the stride doesn't advance — windows never get warmed) or strided multiple
    // steps per fire (windows silently skipped while quota is still burned). Update both together.
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const cron = (config.crons || []).find((c) => c.path === '/api/cron/warm-schedules');
    expect(cron, 'warm-schedules cron entry missing from vercel.json').toBeTruthy();
    expect(cron.schedule).toBe('*/30 * * * *');
  });

  it('SLOT_MS in warm-schedules.ts matches the 30-min cron (the other side of the lockstep)', async () => {
    // Without this, changing SLOT_MS back to 60 min while vercel.json stays at */30 would pass the
    // test above and silently half-stride the warm ring in production.
    const { SLOT_MS } = await import('../api/cron/warm-schedules.ts');
    expect(SLOT_MS).toBe(30 * 60 * 1000);
  });
});
