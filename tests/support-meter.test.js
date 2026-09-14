import { describe, it, expect } from 'vitest';

import { SUPPORT_WARN_PCT, supportMeterModel } from '../src/lib/support-meter.js';

describe('supportMeterModel — the About popover cost meter (inventory §13)', () => {
  it('renders NOTHING rather than an empty frame when there is no usable data', () => {
    // This is the whole design rule for this widget: it may only ever add to the popover.
    expect(supportMeterModel(null)).toBeNull();
    expect(supportMeterModel(undefined)).toBeNull();
    expect(supportMeterModel({})).toBeNull();
    expect(supportMeterModel('nope')).toBeNull();
    expect(supportMeterModel([])).toBeNull();
  });

  it('builds the board-refresh bar from used/budget', () => {
    const model = supportMeterModel({ boards: { used: 42, budget: 700 } });
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({
      key: 'boards',
      label: "Today's board refreshes",
      valueLabel: '42/700',
      warn: false,
    });
    expect(model.rows[0].pct).toBeCloseTo(6, 6);
  });

  it('skips the board bar when the budget is zero, missing or not a number', () => {
    expect(supportMeterModel({ boards: { used: 5, budget: 0 } })).toBeNull();
    expect(supportMeterModel({ boards: { used: 5 } })).toBeNull();
    expect(supportMeterModel({ boards: { used: '5', budget: '700' } })).toBeNull();
  });

  it('adds the live-feed bar only when the feed reports itself configured', () => {
    expect(supportMeterModel({ liveFeed: { configured: false, usedPct: 90 } })).toBeNull();
    expect(supportMeterModel({ liveFeed: { configured: true } })).toBeNull();

    const model = supportMeterModel({ liveFeed: { configured: true, usedPct: 63 } });
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({
      key: 'liveFeed',
      label: 'Live-feed budget this month',
      valueLabel: '~63% used',
      pct: 63,
      warn: false,
    });
  });

  it('shows both bars in board-then-feed order when both are available', () => {
    const model = supportMeterModel({
      boards: { used: 100, budget: 200 },
      liveFeed: { configured: true, usedPct: 10 },
    });
    expect(model.rows.map((row) => row.key)).toEqual(['boards', 'liveFeed']);
  });

  it('flags the warn state at and above 85 %, not before', () => {
    expect(SUPPORT_WARN_PCT).toBe(85);
    expect(supportMeterModel({ boards: { used: 84, budget: 100 } }).rows[0].warn).toBe(false);
    expect(supportMeterModel({ boards: { used: 85, budget: 100 } }).rows[0].warn).toBe(true);
    expect(supportMeterModel({ liveFeed: { configured: true, usedPct: 85 } }).rows[0].warn).toBe(true);
  });

  it('clamps an over-budget bar to 100 % but still calls it a warning', () => {
    const model = supportMeterModel({ boards: { used: 900, budget: 700 } });
    expect(model.rows[0].pct).toBe(100);
    expect(model.rows[0].warn).toBe(true);
    // The FIGURE stays honest even though the bar cannot grow past the track.
    expect(model.rows[0].valueLabel).toBe('900/700');
  });

  it('passes the monthly cost note through, and empties a non-string one', () => {
    expect(
      supportMeterModel({ boards: { used: 1, budget: 10 }, monthlyCostNote: 'About $40/mo' }).note,
    ).toBe('About $40/mo');
    expect(supportMeterModel({ boards: { used: 1, budget: 10 }, monthlyCostNote: 7 }).note).toBe('');
    expect(supportMeterModel({ boards: { used: 1, budget: 10 } }).note).toBe('');
  });
});
