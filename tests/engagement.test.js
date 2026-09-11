import { describe, it, expect } from 'vitest';
import {
  shouldShowOnboarding,
  waitlistState,
  bmacEligible,
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

describe('shouldShowOnboarding', () => {
  it('shows the overlay to a first-time visitor and marks them visited', () => {
    const s = fakeStorage();
    expect(shouldShowOnboarding(s, NOW)).toBe(true);
    expect(s.getItem('bb-visited')).toBe('1');
  });

  it('hides it for a returning visitor who already completed onboarding', () => {
    const s = fakeStorage({ 'bb-visited': '1', 'bb-onboarded': '1' });
    expect(shouldShowOnboarding(s, NOW)).toBe(false);
  });

  it('hides it for a returning visitor who dismissed it inside 7 days', () => {
    const s = fakeStorage({ 'bb-visited': '1', bb_onboarding_dismissed: String(NOW - 2 * DAY) });
    expect(shouldShowOnboarding(s, NOW)).toBe(false);
  });

  it('shows it again once the 7-day dismissal has lapsed', () => {
    const s = fakeStorage({ 'bb-visited': '1', bb_onboarding_dismissed: String(NOW - 8 * DAY) });
    expect(shouldShowOnboarding(s, NOW)).toBe(true);
  });

  it('hides it even on a first visit when a dismissal is still live (edge case)', () => {
    // Same browser, cleared bb-visited but not the dismissal timestamp.
    const s = fakeStorage({ bb_onboarding_dismissed: String(NOW - DAY) });
    expect(shouldShowOnboarding(s, NOW)).toBe(false);
    expect(s.getItem('bb-visited')).toBe('1'); // still recorded
  });

  it('shows the overlay when storage throws rather than trapping the visitor (edge case)', () => {
    expect(shouldShowOnboarding({ getItem() { throw new Error('SecurityError'); }, setItem() {} }, NOW)).toBe(true);
  });
});

describe('waitlistState', () => {
  it('is not suppressed for a fresh visitor', () => {
    const st = waitlistState(fakeStorage(), NOW, { clicks: 0 });
    expect(st.submitted).toBe(false);
    expect(st.dismissedRecently).toBe(false);
    expect(st.suppressed).toBe(false);
  });

  it('is permanently suppressed once the visitor has submitted', () => {
    const s = fakeStorage({ bb_waitlist_submitted: 'true' });
    expect(waitlistState(s, NOW, {}).submitted).toBe(true);
    expect(waitlistState(s, NOW, {}).suppressed).toBe(true);
    // Even a forced open respects a completed submission.
    expect(waitlistState(s, NOW, { forced: true }).suppressed).toBe(true);
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

  it('treats an unreadable store as "nothing dismissed" (edge case)', () => {
    const st = waitlistState({ getItem() { throw new Error('SecurityError'); } }, NOW, {});
    expect(st.submitted).toBe(false);
    expect(st.dismissedRecently).toBe(false);
    expect(st.suppressed).toBe(false);
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
