import { describe, expect, it } from 'vitest';

import {
  DONATE_LATER_COOLDOWN_MS,
  DONATE_PROMPT_STORAGE_KEY,
  DONATE_QUIET_MS,
  DONATE_TAPPED_COOLDOWN_MS,
  chooseDeepUseAsk,
  donatePromptEligible,
  donatePromptMayOpen,
  donatePromptRecord,
  parseDonatePromptRecord,
} from '../src/lib/donate-prompt.js';

const DAY = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000;
const store = (value) => ({ getItem: (key) => (key === DONATE_PROMPT_STORAGE_KEY ? value : null) });
const answered = (outcome, daysAgo) => store(donatePromptRecord(outcome, now - daysAgo * DAY));

describe('donate prompt record', () => {
  it('round-trips both outcomes and rejects anything else', () => {
    expect(parseDonatePromptRecord(donatePromptRecord('later', now))).toEqual({ outcome: 'later', at: now });
    expect(parseDonatePromptRecord(donatePromptRecord('donate', now))).toEqual({ outcome: 'donate', at: now });
    for (const raw of [null, undefined, '', 'later', 'later:', 'paid:123', 'later:0', '1800000000000']) {
      expect(parseDonatePromptRecord(raw)).toBeNull();
    }
  });
});

describe('donatePromptEligible', () => {
  it('is eligible for someone who has never answered it', () => {
    expect(donatePromptEligible(store(null), now)).toBe(true);
    expect(donatePromptEligible(store('garbage'), now)).toBe(true);
  });

  it('stays quiet 30 days after "Maybe later" and 90 after a Donate tap', () => {
    expect(DONATE_LATER_COOLDOWN_MS).toBe(30 * DAY);
    expect(DONATE_TAPPED_COOLDOWN_MS).toBe(90 * DAY);
    expect(donatePromptEligible(answered('later', 29), now)).toBe(false);
    expect(donatePromptEligible(answered('later', 30), now)).toBe(true);
    expect(donatePromptEligible(answered('donate', 89), now)).toBe(false);
    expect(donatePromptEligible(answered('donate', 90), now)).toBe(true);
  });

  it('fails closed without a working store (nowhere to remember the answer)', () => {
    expect(donatePromptEligible(null, now)).toBe(false);
    expect(donatePromptEligible({ getItem: () => { throw new Error('denied'); } }, now)).toBe(false);
  });
});

describe('chooseDeepUseAsk', () => {
  it('gives heavy users the donation prompt first, and the email strip while it cools down', () => {
    expect(chooseDeepUseAsk(store(null), now)).toBe('donate');
    expect(chooseDeepUseAsk(answered('later', 3), now)).toBe('waitlist');
    expect(chooseDeepUseAsk(answered('donate', 3), now)).toBe('waitlist');
    expect(chooseDeepUseAsk(answered('later', 31), now)).toBe('donate');
  });

  it('asks nothing without a store', () => {
    expect(chooseDeepUseAsk(null, now)).toBeNull();
  });

  it('a store that throws on read falls back to the strip, whose own gate then fails closed', () => {
    expect(chooseDeepUseAsk({ getItem: () => { throw new Error('denied'); } }, now)).toBe('waitlist');
  });
});

describe('donatePromptMayOpen', () => {
  const base = { now, lastActivity: now - DONATE_QUIET_MS, otherDialogOpen: false, hidden: false };

  it('opens once the visitor has paused', () => {
    expect(donatePromptMayOpen(base)).toBe(true);
    expect(donatePromptMayOpen({ ...base, lastActivity: now - DONATE_QUIET_MS + 1 })).toBe(false);
  });

  it('never opens over another dialog or sheet, or into a hidden tab', () => {
    expect(donatePromptMayOpen({ ...base, otherDialogOpen: true })).toBe(false);
    expect(donatePromptMayOpen({ ...base, hidden: true })).toBe(false);
  });
});
