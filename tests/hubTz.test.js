import { describe, it, expect } from 'vitest';
import {
  getStartOfHubDay,
  getHubDayLabel,
  getHubLocalDate,
  getHubLocalHour,
  defaultSchedDayOffset,
  HUB_TZ,
} from '../src/lib/hubTz.js';

// Helper: assert that `ts` (Unix seconds) falls exactly at midnight in the
// given tz. Formats back via Intl.DateTimeFormat and compares the hour/minute.
function assertHubMidnight(tsSec, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(tsSec * 1000));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  // Intl can emit "24" for midnight depending on engine; normalize both forms.
  const hour = get('hour') === '24' ? '00' : get('hour');
  expect(hour).toBe('00');
  expect(get('minute')).toBe('00');
  expect(get('second')).toBe('00');
}

describe('getStartOfHubDay — normal days', () => {
  // Pick a normal (non-DST) day at 15:00 UTC so every hub is well clear of its
  // midnight boundary.
  const normalNow = new Date('2026-04-24T15:00:00Z');

  it.each(Object.keys(HUB_TZ))(
    'returns hub-local midnight for today at %s',
    (hub) => {
      const ts = getStartOfHubDay(hub, 0, normalNow);
      assertHubMidnight(ts, HUB_TZ[hub]);
    }
  );

  it.each(Object.keys(HUB_TZ))(
    'returns hub-local midnight for tomorrow at %s',
    (hub) => {
      const ts = getStartOfHubDay(hub, 1, normalNow);
      assertHubMidnight(ts, HUB_TZ[hub]);
    }
  );

  it.each(Object.keys(HUB_TZ))(
    'returns hub-local midnight for yesterday at %s',
    (hub) => {
      const ts = getStartOfHubDay(hub, -1, normalNow);
      assertHubMidnight(ts, HUB_TZ[hub]);
    }
  );
});

describe('getStartOfHubDay — DST transitions (bug #18 regression)', () => {
  it('spring-forward: US Pacific loses an hour on 2026-03-08 (SFO)', () => {
    // At 2026-03-08 15:00 UTC, SFO is past the 2am local spring-forward
    // (which happens at 2026-03-08 10:00 UTC).
    //   yesterday (03-07, all PST)    → today (03-08 00:00 PST)   = 24h
    //   today     (03-08, spans DST)  → tomorrow (03-09 00:00 PDT) = 23h
    const duringDst = new Date('2026-03-08T15:00:00Z');
    const today = getStartOfHubDay('SFO', 0, duringDst);
    const tomorrow = getStartOfHubDay('SFO', 1, duringDst);
    const yesterday = getStartOfHubDay('SFO', -1, duringDst);

    assertHubMidnight(today, HUB_TZ.SFO);
    assertHubMidnight(tomorrow, HUB_TZ.SFO);
    assertHubMidnight(yesterday, HUB_TZ.SFO);

    expect(today - yesterday).toBe(24 * 3600);
    expect(tomorrow - today).toBe(23 * 3600);
  });

  it('fall-back: US Pacific gains an hour on 2026-11-01 (SFO)', () => {
    const duringFallBack = new Date('2026-11-01T10:00:00Z');
    const today = getStartOfHubDay('SFO', 0, duringFallBack);
    const tomorrow = getStartOfHubDay('SFO', 1, duringFallBack);
    const yesterday = getStartOfHubDay('SFO', -1, duringFallBack);

    assertHubMidnight(today, HUB_TZ.SFO);
    assertHubMidnight(tomorrow, HUB_TZ.SFO);
    assertHubMidnight(yesterday, HUB_TZ.SFO);

    // Today (2026-11-01) → tomorrow (2026-11-02) spans the fall-back, so 25h.
    expect(tomorrow - today).toBe(25 * 3600);
    // Yesterday (2026-10-31) → today (2026-11-01) is a normal 24h day.
    expect(today - yesterday).toBe(24 * 3600);
  });

  it('NRT has no DST; days are always 24h apart', () => {
    // Tokyo does not observe DST. Every adjacent-day delta should be exactly
    // 86400 seconds regardless of calendar date.
    const someDate = new Date('2026-03-08T06:00:00Z');
    const today = getStartOfHubDay('NRT', 0, someDate);
    const tomorrow = getStartOfHubDay('NRT', 1, someDate);
    expect(tomorrow - today).toBe(86400);
  });

  it('GUM has no DST; days are always 24h apart', () => {
    const someDate = new Date('2026-11-01T10:00:00Z');
    const today = getStartOfHubDay('GUM', 0, someDate);
    const tomorrow = getStartOfHubDay('GUM', 1, someDate);
    expect(tomorrow - today).toBe(86400);
  });
});

describe('getHubDayLabel', () => {
  it('returns a human-readable label for the hub-local date', () => {
    // 2026-04-24 15:00 UTC = 2026-04-24 in SFO (Pacific)
    const now = new Date('2026-04-24T22:00:00Z');
    const label = getHubDayLabel('SFO', 0, now);
    // Format: "Fri, Apr 24"
    expect(label).toMatch(/Apr 24/);
  });

  it('NRT viewer from the Americas labels the correct hub-local date', () => {
    // 2026-04-24 15:00 UTC is already 2026-04-25 in Tokyo (JST = UTC+9).
    const now = new Date('2026-04-24T15:00:00Z');
    const label = getHubDayLabel('NRT', 0, now);
    expect(label).toMatch(/Apr 25/);
  });
});

describe('getHubLocalDate', () => {
  it('returns year/month/day parts in hub tz', () => {
    const ts = new Date('2026-04-24T15:00:00Z').getTime();
    const { year, month, day } = getHubLocalDate('NRT', ts);
    expect(year).toBe('2026');
    expect(month).toBe('04');
    // 15:00 UTC on 04-24 is 00:00 JST on 04-25.
    expect(day).toBe('25');
  });
});

describe('defaultSchedDayOffset', () => {
  // The Schedule tab opened at 00:23 hub-local and showed 644 flights that had not happened yet:
  // 0 operated, 0 on-time, 0 late, 0 cancelled, every row "Expected · RISK: LOW". The completed
  // day sat one click away under "Yesterday". api/irops.ts has always applied this rule
  // server-side ("Before 6 AM local: no flights have departed yet, show yesterday's data");
  // this is the client half of it.

  it('defaults to yesterday before the rollover hour, hub-local', () => {
    // 05:23 UTC = 00:23 CDT — the exact case from the bug report.
    const now = new Date('2026-07-09T05:23:00Z');
    expect(defaultSchedDayOffset('ORD', now)).toBe(-1);
  });

  it('defaults to today once the hub-local day is underway', () => {
    // 14:00 UTC = 09:00 CDT.
    const now = new Date('2026-07-09T14:00:00Z');
    expect(defaultSchedDayOffset('ORD', now)).toBe(0);
  });

  it('switches exactly at the rollover hour, not before', () => {
    // 10:59:59 UTC = 05:59:59 CDT (still yesterday); 11:00 UTC = 06:00 CDT (today).
    expect(defaultSchedDayOffset('ORD', new Date('2026-07-09T10:59:59Z'))).toBe(-1);
    expect(defaultSchedDayOffset('ORD', new Date('2026-07-09T11:00:00Z'))).toBe(0);
  });

  it('is hub-local, not viewer-local: NRT and ORD disagree at the same instant', () => {
    // 05:23 UTC → 00:23 in Chicago (before rollover) but 14:23 in Tokyo (well after).
    const now = new Date('2026-07-09T05:23:00Z');
    expect(defaultSchedDayOffset('ORD', now)).toBe(-1);
    expect(defaultSchedDayOffset('NRT', now)).toBe(0);
  });

  it('handles the midnight hour="24" ICU quirk', () => {
    // 05:00 UTC = exactly 00:00 CDT. partsToObj normalizes hour 24 → 0; 0 < 6 ⇒ yesterday.
    expect(defaultSchedDayOffset('ORD', new Date('2026-07-09T05:00:00Z'))).toBe(-1);
  });

  it('agrees with the server rule in api/irops.ts (hour < 6)', () => {
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 6, 9, (h + 5) % 24, 30));
      const hubHour = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false })
          .format(now)
      ) % 24;
      expect(defaultSchedDayOffset('ORD', now)).toBe(hubHour < 6 ? -1 : 0);
    }
  });
});
