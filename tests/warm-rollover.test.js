// F81 (audit Sep 27 2026, 04:01Z): at Eastern midnight EWR/IAD arrivals "today" were the boards
// the ring had warmed as "tomorrow" 8-17h earlier (IAD 1021 min old), and the UTC-slot ring did
// not reach them for another ~30 min to 3h. The warm plan is now hub-day aware: in the first hour
// after a hub's local midnight its new today boards are injected into the run.
import { describe, it, expect } from 'vitest';

import { applyRolloverPriority, buildWarmPlan, getWarmSlot, rolloverHubs } from '../api/cron/warm-schedules.js';

const SLOT_MS = 30 * 60 * 1000;
const EDT_MIDNIGHT = Date.UTC(2026, 8, 27, 4, 0, 0); // 00:00 EDT Sun Sep 27
const key = (t) => `${t.hub}-${t.dir}-${t.dayOffset}`;

function planAt(nowMs) {
  return applyRolloverPriority(buildWarmPlan(nowMs), nowMs, getWarmSlot(nowMs));
}

describe('rolloverHubs', () => {
  it('lists the hubs in the first hour of their local day', () => {
    expect(rolloverHubs(EDT_MIDNIGHT + 60_000).sort()).toEqual(['EWR', 'IAD']);
    expect(rolloverHubs(EDT_MIDNIGHT + 45 * 60_000).sort()).toEqual(['EWR', 'IAD']);
    // 01:01 EDT is 00:01 CDT: Eastern is done, Central has just rolled over.
    expect(rolloverHubs(EDT_MIDNIGHT + 61 * 60_000).sort()).toEqual(['IAH', 'ORD']);
    expect(rolloverHubs(EDT_MIDNIGHT - 60_000)).toEqual([]); // 23:59 EDT, 22:59 CDT
  });
});

describe('applyRolloverPriority', () => {
  it("warms EWR and IAD's new today boards across the two fires after Eastern midnight", () => {
    const warmed = new Set();
    for (const at of [EDT_MIDNIGHT + 60_000, EDT_MIDNIGHT + SLOT_MS + 60_000]) {
      for (const t of planAt(at).plan) warmed.add(key(t));
    }
    for (const hub of ['EWR', 'IAD']) {
      for (const dir of ['departures', 'arrivals']) expect(warmed.has(`${hub}-${dir}-0`)).toBe(true);
    }
  });

  it('never grows the plan, and leaves at least one ring slot in every run', () => {
    for (let i = 0; i < 48; i++) {
      const at = EDT_MIDNIGHT + i * SLOT_MS + 60_000;
      const base = buildWarmPlan(at);
      const { plan, injected } = applyRolloverPriority(base, at, getWarmSlot(at));
      expect(plan.length).toBe(base.length);
      expect(injected.length).toBeLessThanOrEqual(base.length - 1);
      expect(new Set(plan.map(key)).size).toBe(plan.length); // no duplicate tasks
    }
  });

  it('still injects when the stride has no tomorrow slot, displacing another hub today board', () => {
    const today = (hub, dir) => ({ hub, dir, dayOffset: 0, label: 'today' });
    const base = [today('ORD', 'departures'), today('DEN', 'departures'), today('SFO', 'arrivals'), today('LAX', 'arrivals')];
    const { plan, injected, displaced } = applyRolloverPriority(base, EDT_MIDNIGHT + 60_000, 0);
    expect(injected.length).toBe(3);
    expect(displaced.length).toBe(3);
    // Rollover boards run first; the surviving ring slot is the FIRST base task.
    expect(plan[plan.length - 1]).toEqual(base[0]);
    expect(plan.slice(0, 3).every((t) => ['EWR', 'IAD'].includes(t.hub) && t.dayOffset === 0)).toBe(true);
  });

  it('prefers tomorrow slots as victims', () => {
    const t = (hub, dir, dayOffset) => ({ hub, dir, dayOffset, label: dayOffset ? 'tomorrow' : 'today' });
    const base = [t('ORD', 'departures', 0), t('DEN', 'arrivals', 1), t('SFO', 'arrivals', 0), t('LAX', 'arrivals', 1)];
    const { displaced } = applyRolloverPriority(base, EDT_MIDNIGHT + 60_000, 0);
    expect(displaced.slice(0, 2).sort()).toEqual(['DEN-arrivals-tomorrow', 'LAX-arrivals-tomorrow']);
  });

  it('is a no-op outside every hub rollover hour', () => {
    const at = Date.UTC(2026, 8, 27, 18, 0, 0); // 13:00 CDT — nobody near midnight
    const base = buildWarmPlan(at);
    expect(applyRolloverPriority(base, at, getWarmSlot(at))).toEqual({ plan: base, injected: [], displaced: [] });
  });
});
