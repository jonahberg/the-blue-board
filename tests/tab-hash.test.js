import { describe, expect, it } from 'vitest';

import { canonicalizeHashParams, cleanTabHash, hashTailParams } from '../src/lib/tab-hash.js';
import { resolveTabParam } from '../src/app/tabs';

// The Oct 6 2026 update email's tab links carried their UTM tags after the '#'.
const EMAIL_EXPRESS = { pathname: '/', search: '?view=express', hash: '#fleet&utm_source=email&utm_medium=email&utm_campaign=oct-2026' };
const EMAIL_SCHEDULE = { pathname: '/', search: '', hash: '#schedule?utm_source=email&utm_medium=email&utm_campaign=oct-2026' };

describe('tab hashes with a tail', () => {
  it('finds the tab before the stray params', () => {
    expect(cleanTabHash(EMAIL_EXPRESS.hash)).toBe('#fleet');
    expect(cleanTabHash(EMAIL_SCHEDULE.hash)).toBe('#schedule');
    expect(cleanTabHash('#starlink')).toBe('#starlink');
    expect(cleanTabHash('')).toBe('');
    expect(resolveTabParam(EMAIL_EXPRESS.hash)).toBe('fleet');
    expect(resolveTabParam(EMAIL_SCHEDULE.hash)).toBe('schedule');
    expect(resolveTabParam('#live')).toBe('live');
  });

  it('moves the trapped params into the query, existing keys winning', () => {
    expect(hashTailParams(EMAIL_SCHEDULE.hash)).toBe('utm_source=email&utm_medium=email&utm_campaign=oct-2026');
    expect(canonicalizeHashParams(EMAIL_EXPRESS)).toBe('/?view=express&utm_source=email&utm_medium=email&utm_campaign=oct-2026#fleet');
    expect(canonicalizeHashParams(EMAIL_SCHEDULE)).toBe('/?utm_source=email&utm_medium=email&utm_campaign=oct-2026#schedule');
    expect(canonicalizeHashParams({ pathname: '/', search: '?utm_source=x', hash: '#live&utm_source=email' })).toBe('/?utm_source=x#live');
    expect(canonicalizeHashParams({ pathname: '/', search: '', hash: '#live' })).toBeNull();
  });
});
