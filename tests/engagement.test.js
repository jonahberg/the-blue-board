import { describe, it, expect } from 'vitest';
import {
  recordVisit,
  waitlistState,
  bmacEligible,
  onboardingHubSeed,
  DISMISS_TTL_MS,
  BMAC_LANDED_COOLDOWN_MS,
  TRIGGER_TIME_MS,
  TRIGGER_CLICKS_NEW,
  TRIGGER_CLICKS_RETURNING,
} from '../src/lib/engagement.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _dump: () => Object.fromEntries(map),
  };
}

const NOW = Date.parse('2026-09-11T12:00:00Z');
const DAY = 86400000;

describe('TTL constants', () => {
  it('suppresses a dismissal for 7 days and a BMAC toast for 14', () => {
    expect(DISMISS_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(BMAC_LANDED_COOLDOWN_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('opens the waitlist on time after 5 minutes', () => {
    expect(TRIGGER_TIME_MS).toBe(5 * 60 * 1000);
  });

  it('asks a new visitor sooner than a returning one (edge case — not the reverse)', () => {
    expect(TRIGGER_CLICKS_NEW).toBe(20);
    expect(TRIGGER_CLICKS_RETURNING).toBe(30);
    expect(TRIGGER_CLICKS_NEW).toBeLessThan(TRIGGER_CLICKS_RETURNING);
  });
});

describe('recordVisit', () => {
  // Was shouldShowOnboarding() until Nov 2026, when the welcome dialog stopped opening by
  // itself. The visit record is all that is left, and the waitlist threshold still reads it.
  it('marks a first-time visitor visited and reports the first visit', () => {
    const s = fakeStorage();
    expect(recordVisit(s)).toBe(true);
    expect(s.getItem('bb-visited')).toBe('1');
  });

  it('leaves a returning visitor alone, onboarded or not', () => {
    const onboarded = fakeStorage({ 'bb-visited': '1', 'bb-onboarded': '1' });
    expect(recordVisit(onboarded)).toBe(false);
    expect(onboarded._dump()).toEqual({ 'bb-visited': '1', 'bb-onboarded': '1' });

    const never = fakeStorage({ 'bb-visited': '1' });
    expect(recordVisit(never)).toBe(false);
    expect(never._dump()).toEqual({ 'bb-visited': '1' });
  });

  it('never touches the old onboarding keys (edge case)', () => {
    // Same browser, cleared bb-visited but not the dismissal timestamp: the visit is recorded
    // and the dismissal is left exactly as it was.
    const s = fakeStorage({ bb_onboarding_dismissed: String(NOW - DAY) });
    expect(recordVisit(s)).toBe(true);
    expect(s._dump()).toEqual({ bb_onboarding_dismissed: String(NOW - DAY), 'bb-visited': '1' });
  });

  it('lets a throwing store propagate from the bare read (edge case)', () => {
    // The read is bare (ported unchanged from the legacy main.js), so a throw reaches the
    // caller. initEngagement() in src/app/state/engagement.tsx is where that is decided —
    // it catches and fails CLOSED. Pinned here so nobody "fixes" the lib into fail-open
    // without deciding to: that is a behaviour change, not a refactor.
    const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() {} };
    expect(() => recordVisit(throwing)).toThrow('SecurityError');
  });

  it('lets a throwing setItem propagate on a first visit too (edge case)', () => {
    const throwingWrite = { getItem: () => null, setItem() { throw new Error('QuotaExceeded'); } };
    expect(() => recordVisit(throwingWrite)).toThrow('QuotaExceeded');
  });
});

describe('waitlistState', () => {
  it('is not suppressed for a fresh visitor', () => {
    const st = waitlistState(fakeStorage(), NOW, { clicks: 0 });
    expect(st.submitted).toBe(false);
    expect(st.dismissedRecently).toBe(false);
    expect(st.suppressed).toBe(false);
  });

  it('reports a completed submission but does NOT fold it into suppressed', () => {
    // The first gate is the engagement store's `submitted` (src/app/state/engagement.tsx),
    // seeded from this field by initEngagement(); `suppressed` is only the dismissal-TTL
    // gate that shouldShowWaitlist() composes after it. Folding `submitted` in here would
    // double-gate (the split is ported from the legacy main.js).
    const s = fakeStorage({ bb_waitlist_submitted: 'true' });
    expect(waitlistState(s, NOW, {}).submitted).toBe(true);
    expect(waitlistState(s, NOW, {}).suppressed).toBe(false);
    expect(waitlistState(s, NOW, { forced: true }).suppressed).toBe(false);
  });

  it('suppresses on the dismissal TTL alone, submitted or not', () => {
    const dismissed = { bb_waitlist_dismissed: String(NOW - DAY) };
    expect(waitlistState(fakeStorage(dismissed), NOW, {}).suppressed).toBe(true);
    expect(waitlistState(fakeStorage({ ...dismissed, bb_waitlist_submitted: 'true' }), NOW, {}).suppressed).toBe(true);
  });

  it('is suppressed for 7 days after a dismissal, then opens again', () => {
    expect(waitlistState(fakeStorage({ bb_waitlist_dismissed: String(NOW - 2 * DAY) }), NOW, {}).suppressed).toBe(true);
    expect(waitlistState(fakeStorage({ bb_waitlist_dismissed: String(NOW - 8 * DAY) }), NOW, {}).suppressed).toBe(false);
  });

  it('lets an explicit ?waitlist=1 bypass a live dismissal', () => {
    const s = fakeStorage({ bb_waitlist_dismissed: String(NOW - DAY) });
    expect(waitlistState(s, NOW, { forced: true }).suppressed).toBe(false);
    expect(waitlistState(s, NOW, { forced: false }).suppressed).toBe(true);
  });

  it('sets the click threshold from whether the visitor has been here before', () => {
    expect(waitlistState(fakeStorage(), NOW, {}).isNewVisitor).toBe(true);
    expect(waitlistState(fakeStorage(), NOW, {}).triggerClicks).toBe(TRIGGER_CLICKS_NEW);
    expect(waitlistState(fakeStorage({ 'bb-visited': '1' }), NOW, {}).triggerClicks).toBe(TRIGGER_CLICKS_RETURNING);
  });

  it('fires clicksReached exactly ON the threshold, not after it (edge case)', () => {
    const s = fakeStorage({ 'bb-visited': '1' });
    expect(waitlistState(s, NOW, { clicks: 29 }).clicksReached).toBe(false);
    expect(waitlistState(s, NOW, { clicks: 30 }).clicksReached).toBe(true);
    expect(waitlistState(s, NOW, { clicks: 31 }).clicksReached).toBe(false);
  });

  it('propagates a throwing store from the bare bb-visited read (edge case)', () => {
    // bb_waitlist_submitted is read inside a try/catch so it swallows, but bb-visited is
    // bare and throws (both ported from the legacy main.js). initEngagement() catches it and
    // fails closed, so no modal opens on a broken store.
    const throwing = { getItem() { throw new Error('SecurityError'); } };
    expect(() => waitlistState(throwing, NOW, {})).toThrow('SecurityError');
  });
});

describe('bmacEligible', () => {
  it('is eligible when the toast has never been dismissed', () => {
    expect(bmacEligible(fakeStorage(), NOW)).toBe(true);
  });

  it('is not eligible inside the 14-day cooldown', () => {
    expect(bmacEligible(fakeStorage({ 'bb-bmac-dismissed': String(NOW - 3 * DAY) }), NOW)).toBe(false);
  });

  it('is eligible again once the cooldown has lapsed', () => {
    expect(bmacEligible(fakeStorage({ 'bb-bmac-dismissed': String(NOW - 15 * DAY) }), NOW)).toBe(true);
  });

  it('is eligible when the stored value is 0 or unparseable (edge case)', () => {
    expect(bmacEligible(fakeStorage({ 'bb-bmac-dismissed': '0' }), NOW)).toBe(true);
    expect(bmacEligible(fakeStorage({ 'bb-bmac-dismissed': 'garbage' }), NOW)).toBe(true);
  });

  it('is eligible when storage throws (edge case)', () => {
    expect(bmacEligible({ getItem() { throw new Error('SecurityError'); } }, NOW)).toBe(true);
  });
});

describe('onboardingHubSeed', () => {
  const SENTINEL = '__none__';

  it('seeds the picker with the hub the visitor currently has set', () => {
    expect(onboardingHubSeed('ORD', SENTINEL)).toBe('ORD');
    expect(onboardingHubSeed('DEN', SENTINEL)).toBe('DEN');
  });

  it('falls back to the sentinel when no hub is set', () => {
    // Radix's Select cannot hold "" — every no-preference shape has to become the sentinel.
    expect(onboardingHubSeed('', SENTINEL)).toBe(SENTINEL);
    expect(onboardingHubSeed(null, SENTINEL)).toBe(SENTINEL);
    expect(onboardingHubSeed(undefined, SENTINEL)).toBe(SENTINEL);
  });

  it('never returns an empty string, whatever it is handed', () => {
    for (const value of ['', null, undefined, 0, false]) {
      expect(onboardingHubSeed(value, SENTINEL)).not.toBe('');
    }
  });

  // Whether Onboarding.tsx actually re-applies this on every open (so a hub changed from the
  // header is shown, and not reverted by the dismiss) is a render test:
  // tests/onboarding-wiring.test.tsx.
});
