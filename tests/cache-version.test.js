import { describe, it, expect } from 'vitest';
import { computeCacheVersion, CACHE_VERSION_PLACEHOLDER } from '../scripts/computeCacheVersion.mjs';

describe('computeCacheVersion', () => {
  it('returns versioned string with first 8 chars of provided SHA', () => {
    expect(computeCacheVersion('abc12345def67890')).toBe('v9-abc12345');
  });

  it('truncates SHAs longer than 8 chars to exactly 8', () => {
    expect(computeCacheVersion('1234567890abcdef1234567890abcdef')).toBe('v9-12345678');
  });

  it('uses full SHA if shorter than 8 chars', () => {
    expect(computeCacheVersion('abc123')).toBe('v9-abc123');
  });

  it('returns dev marker when SHA is undefined (local build)', () => {
    expect(computeCacheVersion(undefined)).toBe('v9-dev');
  });

  it('returns dev marker when SHA is empty string', () => {
    expect(computeCacheVersion('')).toBe('v9-dev');
  });

  it('returns dev marker when SHA is null', () => {
    expect(computeCacheVersion(null)).toBe('v9-dev');
  });

  it('exports the placeholder constant for use in source files', () => {
    expect(CACHE_VERSION_PLACEHOLDER).toBe('__BUILD_SHA__');
  });

  it('produces a different version for different SHAs (cache busts on every deploy)', () => {
    const a = computeCacheVersion('aaaaaaaaaa');
    const b = computeCacheVersion('bbbbbbbbbb');
    expect(a).not.toBe(b);
  });

  it('produces stable version for the same SHA (no time component)', () => {
    const a = computeCacheVersion('abc12345');
    const b = computeCacheVersion('abc12345');
    expect(a).toBe(b);
  });
});
