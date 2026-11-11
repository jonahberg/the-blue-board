// F81 (audit Sep 27 2026, 04:01Z): at Eastern midnight EWR/IAD arrivals "today" were the boards
// the ring had warmed as "tomorrow" 8-17h earlier (IAD 1021 min old), and the UTC-slot ring did
// not reach them for another ~30 min to 3h. The warm plan is now hub-day aware: in the first hour
// after a hub's local midnight its new today boards are injected into the run.
import { describe, it, expect } from 'vitest';

import { UNITED_HUBS } from '../api/_hubs.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
import { applyRolloverPriority, buildWarmPlan, getWarmSlot, rolloverHubs, yesterdayFinalHubs } from '../api/cron/warm-schedules.js';

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

// Nov 2026: /api/irops and the dashboard read YESTERDAY's departures board until 06:00 hub-local,
// and nothing refreshed it after the ring's last pre-midnight pass (IAH 525 min old at 05:45 CST,
// NRT 505 min at 05:55 JST on Nov 11). One final warm per hub, between 00:30 and 06:00 local.
describe('the final warm of yesterday\'s departures board', () => {
  const days = [
    Date.UTC(2026, 10, 11, 0, 0, 5), // the live audit day
    Date.UTC(2026, 8, 27, 0, 0, 5), // the other ring phase
    Date.UTC(2026, 10, 1, 0, 0, 5), // US fall-back
    Date.UTC(2026, 2, 8, 0, 0, 5), // US spring-forward
    Date.UTC(2026, 11, 31, 0, 0, 5),
  ];

  it('the window is [00:30, 06:00) hub-local', () => {
    const cst = Date.UTC(2026, 10, 11, 6, 0); // 00:00 CST
    expect(yesterdayFinalHubs(cst + 29 * 60_000)).not.toContain('ORD');
    expect(yesterdayFinalHubs(cst + 30 * 60_000)).toContain('ORD');
    expect(yesterdayFinalHubs(cst + 359 * 60_000)).toContain('ORD');
    expect(yesterdayFinalHubs(cst + 360 * 60_000)).not.toContain('ORD');
  });

  for (const start of days) {
    it(`warms every hub's yesterday departures exactly once, inside its window (${new Date(start).toISOString().slice(0, 10)})`, () => {
      const at = {};
      for (let i = 0; i < 48; i++) {
        const now = start + i * SLOT_MS;
        const { plan, injected } = applyRolloverPriority(buildWarmPlan(now), now, getWarmSlot(now));
        for (const name of injected.filter((k) => k.endsWith('-yesterday'))) {
          const hub = name.split('-')[0];
          (at[hub] ||= []).push(now);
          expect(name).toBe(`${hub}-departures-yesterday`);
          const task = plan.find((t) => t.hub === hub && t.dayOffset === -1);
          expect(task).toEqual({ hub, dir: 'departures', dayOffset: -1, label: 'yesterday' });
          const sinceMidnight = now - getStartOfHubDay(hub, 0, new Date(now)) * 1000;
          expect(sinceMidnight).toBeGreaterThanOrEqual(30 * 60_000);
          expect(sinceMidnight).toBeLessThan(6 * 3600_000);
        }
      }
      expect(Object.keys(at).sort()).toEqual([...UNITED_HUBS].sort());
      for (const hub of UNITED_HUBS) expect(at[hub]).toHaveLength(1);
    });
  }

  it('a final displaces only tomorrow slots, never a today board, and never grows the run', () => {
    for (const start of [days[0], days[1]]) {
      for (let i = 0; i < 48; i++) {
        const now = start + i * SLOT_MS;
        const base = buildWarmPlan(now);
        const { plan, displaced } = applyRolloverPriority(base, now, getWarmSlot(now));
        expect(plan.length).toBe(base.length);
        for (const d of displaced) expect(d.endsWith('-tomorrow')).toBe(true);
        for (const t of base.filter((b) => b.dayOffset === 0)) expect(plan.map(key)).toContain(key(t));
      }
    }
  }, 20_000);

  it('the today rollover no longer re-warms a board the previous fire of its hour already warmed', () => {
    // Eastern midnight Nov 11: the 05:00Z fire warmed IAD departures + arrivals; the 05:30Z fire
    // used to warm IAD arrivals again. Its slot now goes to EWR, then to EWR's yesterday final.
    const first = Date.UTC(2026, 10, 11, 5, 0, 5);
    const second = first + SLOT_MS;
    const a = applyRolloverPriority(buildWarmPlan(first), first, getWarmSlot(first)).injected;
    const b = applyRolloverPriority(buildWarmPlan(second), second, getWarmSlot(second)).injected;
    expect(a.sort()).toEqual(['IAD-arrivals-today', 'IAD-departures-today']);
    expect(b.sort()).toEqual(['EWR-arrivals-today', 'EWR-departures-today', 'EWR-departures-yesterday']);
  });
});
