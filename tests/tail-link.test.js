import { describe, expect, it } from 'vitest';

import { tailLink } from '../src/lib/tail-link.js';

describe('tailLink: which printed registrations open the aircraft dialog', () => {
  it('links a US registration to the aircraft dialog, upper-cased and without the hyphen', () => {
    expect(tailLink('n78501')).toEqual({ reg: 'N78501', href: '/?aircraft=N78501' });
    expect(tailLink('N-613UX')).toEqual({ reg: 'N613UX', href: '/?aircraft=N613UX' });
    expect(tailLink(' N75436 ')).toEqual({ reg: 'N75436', href: '/?aircraft=N75436' });
  });

  it('does not link a flight number, a malformed N-number, a foreign registration or an empty value', () => {
    for (const bad of ['UA576', 'N0123', 'JA873A', '', null]) expect(tailLink(bad), String(bad)).toBeNull();
  });

  it('does not link an N-number that is too short or too long, or a non-string', () => {
    for (const bad of ['N', 'N1', 'N123456', 42, undefined, ['N78501']]) {
      expect(tailLink(bad), String(bad)).toBeNull();
    }
  });
});
