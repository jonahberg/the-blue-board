import { describe, it, expect } from 'vitest';
import { onWallMatcher, supporterNameKey } from '../src/lib/supporter-names.js';
import { SUPPORTERS } from '../src/data/supporters.js';

describe('supporterNameKey / onWallMatcher (scripts/supporters-diff.mjs)', () => {
  it('a returning supporter who typed their name differently is on the wall (Oct 2026)', () => {
    const isOnWall = onWallMatcher(['FlyerTalk JCG1005']);
    expect(isOnWall('Flyer Talk JCG1005')).toBe(true);
    expect(isOnWall('flyertalk-jcg1005')).toBe(true);
    expect(isOnWall('  FLYERTALK  JCG1005 ')).toBe(true);
  });

  it('ignores spacing, punctuation and case — nothing else', () => {
    expect(supporterNameKey('@LinBros88')).toBe('linbros88');
    expect(supporterNameKey('u/WrldDriftR')).toBe('uwrlddriftr');
    expect(supporterNameKey('James W')).toBe(supporterNameKey('james w.'));
    expect(supporterNameKey('James W')).not.toBe(supporterNameKey('James M'));
  });

  it('keeps non-Latin letters, and never collapses a symbol-only name to an empty key', () => {
    expect(supporterNameKey('José')).toBe('josé');
    expect(supporterNameKey('王小明')).toBe('王小明');
    expect(onWallMatcher(['王小明'])('李小龙')).toBe(false);
    expect(supporterNameKey('☕')).toBe('☕');
    expect(onWallMatcher(['☕'])('★')).toBe(false);
  });

  it('every name on the wall matches itself', () => {
    const isOnWall = onWallMatcher(SUPPORTERS);
    for (const name of SUPPORTERS) expect(isOnWall(name)).toBe(true);
  });

  it('survives junk input', () => {
    expect(supporterNameKey(undefined)).toBe('');
    expect(onWallMatcher(undefined)('x')).toBe(false);
  });
});
