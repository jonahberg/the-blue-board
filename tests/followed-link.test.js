import { describe, expect, it } from 'vitest';

import { DEEP_LINK_PARAMS, addressAfterFollow } from '../src/lib/followed-link.js';

describe('addressAfterFollow: the history entry a followed link leaves', () => {
  it('is the path and the new tab hash', () => {
    expect(addressAfterFollow({ pathname: '/', search: '' }, '#schedule')).toBe('/#schedule');
  });

  it("drops the dashboard's own deep-link parameters, which would outrank the hash on a reload", () => {
    expect(addressAfterFollow({ pathname: '/', search: '?tab=fleet&type=A319' }, '#schedule')).toBe('/#schedule');
    expect(addressAfterFollow({ pathname: '/', search: '?aircraft=N78501' }, '#fleet')).toBe('/#fleet');
    const every = `?${DEEP_LINK_PARAMS.map((key) => `${key}=x`).join('&')}`;
    expect(addressAfterFollow({ pathname: '/', search: every }, '#live')).toBe('/#live');
  });

  it('keeps every other parameter (utm_*), in order', () => {
    expect(
      addressAfterFollow({ pathname: '/', search: '?utm_source=email&view=starlink&utm_campaign=oct-2026' }, '#schedule'),
    ).toBe('/?utm_source=email&utm_campaign=oct-2026#schedule');
  });

  it('names every parameter a cold load acts on', () => {
    expect([...DEEP_LINK_PARAMS].sort()).toEqual(
      ['aircraft', 'filter', 'flight', 'hub', 'q', 'section', 'tab', 'type', 'view', 'waitlist', 'watch'].sort(),
    );
  });
});
