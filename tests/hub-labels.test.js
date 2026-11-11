// Hub label placement on the maps (src/lib/hub-labels.js). Nov 2026: "EWR sits under IAD" on a
// phone, and LAX's label sat on SFO's ring.
import { describe, expect, it } from 'vitest';

import { AIRPORTS } from '../src/lib/airports.js';
import { HUB_LABEL_DIRECTION, hubLabelPlacement } from '../src/lib/hub-labels.js';

describe('hubLabelPlacement', () => {
  it('turns the southern hub of each close pair below its ring, and Newark to its right', () => {
    expect(hubLabelPlacement('IAD')).toEqual({ direction: 'bottom', offset: [0, 10] });
    expect(hubLabelPlacement('LAX')).toEqual({ direction: 'bottom', offset: [0, 10] });
    expect(hubLabelPlacement('EWR')).toEqual({ direction: 'right', offset: [10, 0] });
  });

  it('labels every other hub above its ring, as before', () => {
    for (const hub of ['ORD', 'DEN', 'IAH', 'SFO', 'NRT', 'GUM']) {
      expect(hubLabelPlacement(hub)).toEqual({ direction: 'top', offset: [0, -10] });
    }
    expect(hubLabelPlacement('')).toEqual({ direction: 'top', offset: [0, -10] });
  });

  it('names only real hubs, and never sends San Francisco off a coast-fitted map to the left', () => {
    const hubs = new Set(AIRPORTS.filter((a) => a.hub).map((a) => a.iata));
    for (const code of Object.keys(HUB_LABEL_DIRECTION)) expect(hubs.has(code)).toBe(true);
    expect(HUB_LABEL_DIRECTION.SFO).toBeUndefined();
    expect(Object.values(HUB_LABEL_DIRECTION)).not.toContain('left');
  });
});
