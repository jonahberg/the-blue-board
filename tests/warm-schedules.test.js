import { describe, it, expect } from 'vitest';
import { buildWarmPlan } from '../api/cron/warm-schedules.js';

describe('warm-schedules buildWarmPlan', () => {
  const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];
  const TOTAL_TASKS = 9 * 6; // 9 hubs × 6 window tasks (3 days × 2 dirs)

  it('returns an array of warm tasks', () => {
    const plan = buildWarmPlan();
    expect(Array.isArray(plan)).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  });

  it('each task has required fields', () => {
    const plan = buildWarmPlan();
    for (const task of plan) {
      expect(HUBS).toContain(task.hub);
      expect(['departures', 'arrivals']).toContain(task.dir);
      expect([-1, 0, 1]).toContain(task.dayOffset);
      expect(['yesterday', 'today', 'tomorrow']).toContain(task.label);
    }
  });

  it('returns different tasks for different 15-minute slots', () => {
    const t1 = new Date('2026-04-03T00:00:00Z').getTime();
    const t2 = new Date('2026-04-03T00:15:00Z').getTime();

    const plan1 = buildWarmPlan(t1);
    const plan2 = buildWarmPlan(t2);

    // Different time slots should produce different starting positions
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

  it('cycles through all tasks over enough 15-minute intervals', () => {
    const allKeys = new Set();
    const start = new Date('2026-04-03T00:00:00Z').getTime();

    // Run enough intervals to cover all tasks
    for (let i = 0; i < Math.ceil(TOTAL_TASKS / 4) + 2; i++) {
      const plan = buildWarmPlan(start + i * 15 * 60 * 1000);
      for (const task of plan) {
        allKeys.add(`${task.hub}-${task.dir}-${task.label}`);
      }
    }

    // Should eventually cover all hub/dir/day combinations
    expect(allKeys.size).toBe(TOTAL_TASKS);
  });

  it('limits plan size to WARM_TASKS_PER_RUN (default 4)', () => {
    const plan = buildWarmPlan();
    // Default is 4 tasks per run
    expect(plan.length).toBeLessThanOrEqual(8);
    expect(plan.length).toBeGreaterThanOrEqual(1);
  });
});
