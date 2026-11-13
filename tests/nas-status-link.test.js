// The dashboard address content pages use for "the FAA's status" (src/lib/nas-status-link.js):
// the Delays · Weather tab, landed on its NAS status panel, by the dashboard's own resolver.
import { describe, expect, it } from 'vitest';

import { NAS_STATUS_HREF } from '../src/lib/nas-status-link.js';
import { weatherScrollTarget } from '../src/lib/tab-hash.js';

describe('NAS_STATUS_HREF', () => {
  it('opens the Weather tab on the NAS status panel', () => {
    expect(NAS_STATUS_HREF).toBe('/?tab=weather&section=nas');
    const url = new URL(NAS_STATUS_HREF, 'https://theblueboard.co');
    expect(url.pathname).toBe('/');
    expect(weatherScrollTarget(url.searchParams)).toBe('nas-section');
  });
});
