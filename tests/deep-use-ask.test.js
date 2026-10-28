/**
 * The deep-use ask chooser (Oct 28 2026): among the asks eligible right now, donate with
 * probability 0.6 and email with 0.4; one eligible → that one; none → the strip; no store →
 * nothing. Plus the email ask's own eligibility rules.
 */

import { describe, expect, it, vi } from 'vitest';

import { DEEP_USE_DONATE_WEIGHT, chooseDeepUseAsk } from '../src/lib/deep-use-ask.js';
import { DONATE_PROMPT_STORAGE_KEY, donatePromptRecord } from '../src/lib/donate-prompt.js';
import {
  EMAIL_PROMPT_COOLDOWN_MS,
  EMAIL_PROMPT_STORAGE_KEY,
  emailPromptEligible,
  emailPromptRecord,
  parseEmailPromptRecord,
} from '../src/lib/email-prompt.js';

const DAY = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000;
const store = (entries = {}) => ({ getItem: (key) => entries[key] ?? null });
const throwing = { getItem: () => { throw new Error('denied'); } };

/** Donate in its 30-day "Maybe later" quiet. */
const donateQuiet = { [DONATE_PROMPT_STORAGE_KEY]: donatePromptRecord('later', now - 3 * DAY) };
/** Email in its 30-day quiet. */
const emailQuiet = { [EMAIL_PROMPT_STORAGE_KEY]: emailPromptRecord(now - 3 * DAY) };

const dice = (value) => vi.fn(() => value);

describe('emailPromptRecord', () => {
  it('round-trips and rejects anything else', () => {
    expect(parseEmailPromptRecord(emailPromptRecord(now))).toEqual({ outcome: 'later', at: now });
    for (const raw of [null, undefined, '', 'later', 'later:', 'donate:123', 'later:0', '1800000000000']) {
      expect(parseEmailPromptRecord(raw)).toBeNull();
    }
  });
});

describe('emailPromptEligible', () => {
  it('is eligible for someone who has never been asked', () => {
    expect(emailPromptEligible(store(), now)).toBe(true);
    expect(emailPromptEligible(store({ [EMAIL_PROMPT_STORAGE_KEY]: 'garbage' }), now)).toBe(true);
  });

  it('stays quiet for 30 days after the email ask is closed without a signup', () => {
    expect(EMAIL_PROMPT_COOLDOWN_MS).toBe(30 * DAY);
    const at = (daysAgo) => store({ [EMAIL_PROMPT_STORAGE_KEY]: emailPromptRecord(now - daysAgo * DAY) });
    expect(emailPromptEligible(at(29), now)).toBe(false);
    expect(emailPromptEligible(at(30), now)).toBe(true);
  });

  it('honours a "no" to the strip or a requested dialog (bb_waitlist_dismissed) for 30 days too', () => {
    const at = (daysAgo) => store({ bb_waitlist_dismissed: String(now - daysAgo * DAY) });
    expect(emailPromptEligible(at(1), now)).toBe(false);
    expect(emailPromptEligible(at(29), now)).toBe(false);
    expect(emailPromptEligible(at(31), now)).toBe(true);
  });

  it('never asks a visitor who already gave an email — from storage or from this session', () => {
    expect(emailPromptEligible(store({ bb_waitlist_submitted: 'true' }), now)).toBe(false);
    expect(emailPromptEligible(store(), now, { submitted: true })).toBe(false);
    // Not even 30+ days on.
    const long = store({ bb_waitlist_submitted: 'true', [EMAIL_PROMPT_STORAGE_KEY]: emailPromptRecord(now - 400 * DAY) });
    expect(emailPromptEligible(long, now)).toBe(false);
  });

  it('fails CLOSED without a working store (nowhere to remember a no)', () => {
    expect(emailPromptEligible(null, now)).toBe(false);
    expect(emailPromptEligible(undefined, now)).toBe(false);
    expect(emailPromptEligible(throwing, now)).toBe(false);
  });
});

describe('chooseDeepUseAsk', () => {
  it('weights the two-way choice 60/40 towards donate', () => {
    expect(DEEP_USE_DONATE_WEIGHT).toBe(0.6);
    expect(chooseDeepUseAsk(store(), now, { random: dice(0.59) })).toBe('donate');
    expect(chooseDeepUseAsk(store(), now, { random: dice(0.61) })).toBe('email');
    // The boundary belongs to email: random() < weight is donate.
    expect(chooseDeepUseAsk(store(), now, { random: dice(0.6) })).toBe('email');
    expect(chooseDeepUseAsk(store(), now, { random: dice(0) })).toBe('donate');
  });

  it('a uniform spread of rolls lands 60/40', () => {
    const counts = { donate: 0, email: 0 };
    for (let i = 0; i < 1000; i += 1) {
      counts[chooseDeepUseAsk(store(), now, { random: () => (i + 0.5) / 1000 })] += 1;
    }
    expect(counts).toEqual({ donate: 600, email: 400 });
  });

  it('defaults to Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(chooseDeepUseAsk(store(), now)).toBe('email');
    spy.mockReturnValue(0.01);
    expect(chooseDeepUseAsk(store(), now)).toBe('donate');
    spy.mockRestore();
  });

  it('only donate eligible → donate, without rolling', () => {
    const random = dice(0.99);
    expect(chooseDeepUseAsk(store(emailQuiet), now, { random })).toBe('donate');
    expect(chooseDeepUseAsk(store({ bb_waitlist_submitted: 'true' }), now, { random })).toBe('donate');
    expect(chooseDeepUseAsk(store(), now, { random, submitted: true })).toBe('donate');
    expect(random).not.toHaveBeenCalled();
  });

  it('only email eligible → email, without rolling', () => {
    const random = dice(0);
    expect(chooseDeepUseAsk(store(donateQuiet), now, { random })).toBe('email');
    const tapped = { [DONATE_PROMPT_STORAGE_KEY]: donatePromptRecord('donate', now - 60 * DAY) };
    expect(chooseDeepUseAsk(store(tapped), now, { random })).toBe('email');
    expect(random).not.toHaveBeenCalled();
  });

  it('neither eligible → the strip, whose own gate (shouldShowWaitlistStrip) still decides', () => {
    const random = dice(0.5);
    expect(chooseDeepUseAsk(store({ ...donateQuiet, ...emailQuiet }), now, { random })).toBe('waitlist');
    expect(chooseDeepUseAsk(store({ ...donateQuiet, bb_waitlist_submitted: 'true' }), now, { random })).toBe('waitlist');
    expect(random).not.toHaveBeenCalled();
  });

  it('a store that throws on read fails both asks closed and falls back to the strip, whose gate also fails closed', () => {
    expect(chooseDeepUseAsk(throwing, now, { random: dice(0) })).toBe('waitlist');
  });

  it('asks nothing without a store', () => {
    expect(chooseDeepUseAsk(null, now, { random: dice(0) })).toBeNull();
  });
});
