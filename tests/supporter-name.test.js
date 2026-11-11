/**
 * Supporter display names are free text typed by strangers into Stripe's checkout. The owner's
 * rule: never auto-publish a name. Only a strict shape passes; everything else is "a supporter".
 */

import { describe, expect, it } from 'vitest';

import {
  SUPPORTER_FALLBACK_LABEL,
  cleanSupporterName,
  collapseWhitespace,
  supporterIdentityKey,
  supporterLabel,
  supporterNamesEnabled,
} from '../src/lib/supporter-name.js';

describe('cleanSupporterName', () => {
  it('passes ordinary names, in any script, with apostrophes, periods and hyphens', () => {
    for (const name of ['Dana R.', 'Mary-Kate', "O'Neil", 'O’Neil', 'J.R.R. Tolkien', 'José Núñez', 'Zoë', 'Ng', '李小龍', 'Ünal Çelik']) {
      expect(cleanSupporterName(name), name).toBe(name);
    }
  });

  it('collapses whitespace (including no-break spaces) and trims', () => {
    expect(cleanSupporterName('  Dana    R.  ')).toBe('Dana R.');
    expect(cleanSupporterName('Dana\n\tR.')).toBe('Dana R.');
    expect(collapseWhitespace(42)).toBe('');
  });

  it('holds the 2–30 character window, counted after collapsing', () => {
    expect(cleanSupporterName('A')).toBeNull();
    expect(cleanSupporterName('Al')).toBe('Al');
    expect(cleanSupporterName('A'.repeat(30))).toBe('A'.repeat(30));
    expect(cleanSupporterName('A'.repeat(31))).toBeNull();
  });

  it('rejects digits, URLs, domains, emails, handles and markup', () => {
    for (const bad of [
      'Dana 2',
      'UA1234 fan',
      'https://example.com',
      'example.com',
      'visit dana.co',
      'www example',
      'http dana',
      'dana@example',
      '@dana',
      '<b>Dana</b>',
      'Dana &amp; Lee',
      'Dana_R',
      'Dana!',
      'Dana R. 🙂',
      '#1 fan',
    ]) {
      expect(cleanSupporterName(bad), bad).toBeNull();
    }
  });

  it('rejects junk shapes: no letters, one letter, punctuation runs, a dangling hyphen, leading punctuation', () => {
    for (const bad of ['...', "''", '-', 'A.', 'Dana..', "O''Neil", 'Dana-', ".Dana", '- Dana', 'a--b']) {
      expect(cleanSupporterName(bad), bad).toBeNull();
    }
  });

  it('rejects invisible formatting characters and non-strings', () => {
    expect(cleanSupporterName('Da​na')).toBeNull();
    expect(cleanSupporterName('Dana‮R')).toBeNull();
    expect(cleanSupporterName(null)).toBeNull();
    expect(cleanSupporterName(undefined)).toBeNull();
    expect(cleanSupporterName(['Dana'])).toBeNull();
  });
});

describe('supporterLabel', () => {
  it('shows a passing name unless the row is hidden or names are off', () => {
    expect(supporterLabel({ display_name: 'Dana R.' })).toBe('Dana R.');
    expect(supporterLabel({ display_name: 'Dana R.', hidden: true })).toBe(SUPPORTER_FALLBACK_LABEL);
    expect(supporterLabel({ display_name: 'Dana R.' }, { namesOn: false })).toBe(SUPPORTER_FALLBACK_LABEL);
    expect(supporterLabel({ display_name: 'dana.com' })).toBe('a supporter');
    expect(supporterLabel({})).toBe('a supporter');
    expect(supporterLabel(null)).toBe('a supporter');
  });
});

describe('supporterNamesEnabled', () => {
  it('is on unless switched off', () => {
    expect(supporterNamesEnabled(undefined)).toBe(true);
    expect(supporterNamesEnabled('')).toBe(true);
    expect(supporterNamesEnabled('on')).toBe(true);
    for (const off of ['off', 'OFF', '0', 'false', ' no ']) expect(supporterNamesEnabled(off), off).toBe(false);
  });
});

describe('supporterIdentityKey', () => {
  it('keys the same typed name the same way and leaves no-name rows unkeyed', () => {
    expect(supporterIdentityKey({ display_name: 'Dana R.' })).toBe(supporterIdentityKey({ display_name: ' dana  r ' }));
    expect(supporterIdentityKey({ display_name: '' })).toBeNull();
    expect(supporterIdentityKey({})).toBeNull();
  });
});
