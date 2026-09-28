// F81 (audit Sep 27 2026, 04:01Z): at Eastern midnight EWR/IAD arrivals "today" were the boards
// the ring had warmed as "tomorrow" 8-17h earlier (IAD 1021 min old), and the UTC-slot ring did
// not reach them for another ~30 min to 3h. The warm plan is now hub-day aware: in the first hour
// after a hub's local midnight its new today boards are injected into the run.
import { describe, it, expect } from 'vitest';

import { UNITED_HUBS } from '../api/_hubs.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
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
  it("warms a zone's new today boards across the two fires when the strides have tomorrow slots", () => {
    // 01:01/01:31 EDT Sep 27 = Central midnight; both strides carry tomorrow slots.
    const CDT_MIDNIGHT = EDT_MIDNIGHT + 60 * 60_000;
    const warmed = new Set();
    for (const at of [CDT_MIDNIGHT + 60_000, CDT_MIDNIGHT + SLOT_MS + 60_000]) {
      for (const t of planAt(at).plan) warmed.add(key(t));
    }
    for (const hub of ['ORD', 'IAH']) {
      for (const dir of ['departures', 'arrivals']) expect(warmed.has(`${hub}-${dir}-0`)).toBe(true);
    }
  });

  it('defers at Eastern midnight Sep 27, whose two strides are all today boards (D3)', () => {
    for (const at of [EDT_MIDNIGHT + 60_000, EDT_MIDNIGHT + SLOT_MS + 60_000]) {
      const base = buildWarmPlan(at);
      const { plan, injected } = applyRolloverPriority(base, at, getWarmSlot(at));
      expect(injected).toEqual([]);
      expect(plan.map(key).sort()).toEqual(base.map(key).sort());
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

  it('defers (never displaces another hub today board) when the stride has no tomorrow slot (D3)', () => {
    // Live audit Sep 28 2026: "Rollover warm priority: injected [NRT-arrivals-today] displacing
    // [LAX-departures-today]" — LAX departures then reached 183 min old. Same rule as IROPS
    // since v1.8.2: only TOMORROW slots give way. The rollover window is two fires, and a
    // viewed today board refreshes organically on its 1h TTL.
    const today = (hub, dir) => ({ hub, dir, dayOffset: 0, label: 'today' });
    const base = [today('ORD', 'departures'), today('DEN', 'departures'), today('SFO', 'arrivals'), today('LAX', 'arrivals')];
    const { plan, injected, displaced } = applyRolloverPriority(base, EDT_MIDNIGHT + 60_000, 0);
    expect(injected).toEqual([]);
    expect(displaced).toEqual([]);
    expect(plan.map(key).sort()).toEqual(base.map(key).sort());
  });

  it('the production case: NRT rollover at 15:31Z leaves LAX departures today in the run', () => {
    const at = Date.UTC(2026, 8, 27, 15, 31, 0);
    const base = buildWarmPlan(at);
    const { plan, displaced } = applyRolloverPriority(base, at, getWarmSlot(at));
    expect(displaced.some((d) => d.endsWith('-today'))).toBe(false);
    for (const t of base.filter((b) => b.dayOffset === 0)) expect(plan.map(key)).toContain(key(t));
  });

  it('never displaces a today board at any fire of the day', () => {
    for (let i = 0; i < 48 * 3; i++) {
      const at = Date.UTC(2026, 8, 26, 0, 1, 0) + i * SLOT_MS;
      const { displaced } = applyRolloverPriority(buildWarmPlan(at), at, getWarmSlot(at));
      expect(displaced.filter((d) => d.endsWith('-today'))).toEqual([]);
    }
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

// D4 (live audit Sep 28 2026): GUM departures for the current Guam day were a 603-min-old
// prefetch. The planner is not the cause — these pin that every hub, GUM and NRT included,
// gets its rollover hour and that GUM's boards are planned in it.
describe('rollover covers every hub, GUM and NRT included (D4)', () => {
  const dates = [
    Date.UTC(2026, 8, 27, 12), // Sep 27
    Date.UTC(2026, 10, 1, 12), // Nov 1 — US fall-back day
    Date.UTC(2026, 2, 8, 12), // Mar 8 — US spring-forward day
    Date.UTC(2026, 11, 31, 12), // Dec 31
  ];
  for (const noon of dates) {
    for (const hub of UNITED_HUBS) {
      it(`${hub} is a rollover hub in the first hour of its ${new Date(noon).toISOString().slice(0, 10)}`, () => {
        const midnightMs = getStartOfHubDay(hub, 0, new Date(noon)) * 1000;
        expect(rolloverHubs(midnightMs + 60_000)).toContain(hub);
        expect(rolloverHubs(midnightMs + 31 * 60_000)).toContain(hub);
        expect(rolloverHubs(midnightMs - 60_000)).not.toContain(hub);
        expect(rolloverHubs(midnightMs + 61 * 60_000)).not.toContain(hub);
      });
    }
  }

  it("plans both of GUM's new today boards in the Guam rollover hour (14:00Z)", () => {
    const GUM_MIDNIGHT = Date.UTC(2026, 8, 27, 14, 0, 0);
    const warmed = new Set();
    for (const at of [GUM_MIDNIGHT + 60_000, GUM_MIDNIGHT + SLOT_MS + 60_000]) {
      for (const t of planAt(at).plan) warmed.add(key(t));
    }
    expect(warmed.has('GUM-departures-0')).toBe(true);
    expect(warmed.has('GUM-arrivals-0')).toBe(true);
  });

  it('GUM departures today stays on the ring every ~3h across the Guam day', () => {
    const GUM_MIDNIGHT = Date.UTC(2026, 8, 27, 14, 0, 0);
    let last = GUM_MIDNIGHT;
    let maxGapMin = 0;
    for (let i = 0; i < 48; i++) {
      const at = GUM_MIDNIGHT + i * SLOT_MS + 60_000;
      if (planAt(at).plan.some((t) => key(t) === 'GUM-departures-0')) {
        maxGapMin = Math.max(maxGapMin, (at - last) / 60_000);
        last = at;
      }
    }
    expect(maxGapMin).toBeLessThanOrEqual(3 * 60 + 1);
  });
});
