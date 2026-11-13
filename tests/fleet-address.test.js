import { describe, expect, it } from 'vitest';

import { fleetDeepLinksFrom } from '../src/lib/fleet-address.js';

const read = (query) => fleetDeepLinksFrom(new URLSearchParams(query));

describe("fleetDeepLinksFrom: the Fleet tab's slice of an address", () => {
  it('reads ?type= (preferred) or ?filter=, as given', () => {
    expect(read('?tab=fleet&type=737%20MAX%209')).toEqual({ filter: '737 MAX 9', view: null });
    expect(read('?filter=starlink')).toEqual({ filter: 'starlink', view: null });
    expect(read('?type=A319&filter=starlink')).toEqual({ filter: 'A319', view: null });
  });

  it('reads only the Fleet sub-views, in any case; ?view=starlink is tab routing', () => {
    expect(read('?view=Express')).toEqual({ filter: null, view: 'express' });
    expect(read('?view=airborne&type=A319')).toEqual({ filter: 'A319', view: 'airborne' });
    expect(read('?view=special')).toEqual({ filter: null, view: 'special' });
    expect(read('?view=starlink')).toEqual({ filter: null, view: null });
    expect(read('?view=bogus')).toEqual({ filter: null, view: null });
  });

  it('nothing named is nothing', () => {
    expect(read('')).toEqual({ filter: null, view: null });
    expect(read('?utm_source=email')).toEqual({ filter: null, view: null });
  });
});
