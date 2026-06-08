import { describe, it, expect } from 'vitest';
import { buildScheduleWarmUrl, buildWarmPlan } from '../api/cron/warm-schedules.js';

describe('warm-schedules buildWarmPlan', () => {
  const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];
  const TOTAL_TASKS = 9 * 4; // 9 hubs × 4 window tasks (today+tomorrow × 2 dirs); yesterday is on-demand
  const SLOT_MS = 2 * 60 * 60 * 1000; // must match the cron interval / SLOT_MS in warm-schedules.ts

  it('returns an array of warm tasks', () => {
    const plan = buildWarmPlan();
    expect(Array.isArray(plan)).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  });

  it('each task has required fields and never warms yesterday', () => {
    // Sweep a full rotation so we assert across every window the plan can emit, not just one slot.
    const start = new Date('2026-04-03T00:00:00Z').getTime();
    for (let i = 0; i < TOTAL_TASKS + 4; i++) {
      const plan = buildWarmPlan(start + i * SLOT_MS);
      for (const task of plan) {
        expect(HUBS).toContain(task.hub);
        expect(['departures', 'arrivals']).toContain(task.dir);
        expect([0, 1]).toContain(task.dayOffset);          // today / tomorrow only
        expect(['today', 'tomorrow']).toContain(task.label); // yesterday is on-demand, never warmed
      }
    }
  });

  it('returns different tasks for different 2-hour slots', () => {
    const t1 = new Date('2026-04-03T00:00:00Z').getTime();
    const t2 = new Date('2026-04-03T02:00:00Z').getTime();

    const plan1 = buildWarmPlan(t1);
    const plan2 = buildWarmPlan(t2);

    // Adjacent cron fires (2h apart) should advance to a different starting position
    const keys1 = plan1.map(t => `${t.hub}-${t.dir}-${t.label}`);
    const keys2 = plan2.map(t => `${t.hub}-${t.dir}-${t.label}`);
    expect(keys1).not.toEqual(keys2);
  });

  it('returns consistent results for the same timestamp', () => {
    const t = new Date('2026-04-03T12:00:00Z').getTime();
    const plan1 = buildWarmPlan(t);
    const plan2 = buildWarmPlan(t);
    expect(plan1).toEqual(plan2);
  });

  it('cycles through all tasks over enough cron intervals with no gaps', () => {
    const allKeys = new Set();
    const start = new Date('2026-04-03T00:00:00Z').getTime();

    // Run enough 2h cron fires to cover all windows (sequential stride => full coverage)
    for (let i = 0; i < TOTAL_TASKS + 4; i++) {
      const plan = buildWarmPlan(start + i * SLOT_MS);
      for (const task of plan) {
        allKeys.add(`${task.hub}-${task.dir}-${task.label}`);
      }
    }

    // Should eventually cover every today/tomorrow hub/dir combination
    expect(allKeys.size).toBe(TOTAL_TASKS);
  });

  it('limits plan size to WARM_TASKS_PER_RUN (default 2)', () => {
    const plan = buildWarmPlan();
    // Default is 2 tasks per run to bound metered AeroDataBox spend
    expect(plan.length).toBe(2);
  });

  it('warms via the provider (AeroDataBox) while keeping paid FR24 + dead scrape off', () => {
    const url = buildScheduleWarmUrl('ORD', 'departures', 1778907600);
    expect(url).toContain('/api/schedule?');
    expect(url).toContain('hub=ORD');
    expect(url).toContain('dir=departures');
    expect(url).toContain('timestamp=1778907600');
    // Background warming uses the provider (the only working full-board source) ...
    expect(url).toContain('providerFallback=1');
    // ... but never burns FR24 official credits, and skips the Cloudflare-dead scrape.
    expect(url).toContain('officialFallback=0');
    expect(url).toContain('scraperFallback=0');
  });
});
