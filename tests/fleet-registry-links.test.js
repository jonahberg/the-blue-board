// What a /fleet/{type} registry row links to (src/lib/fleet-registry-links.js): the tail to the
// dashboard's aircraft dialog, a Starlink Wi-Fi cell to the Starlink tab, nothing else.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isStarlinkWifi, registryRowLinks } from '../src/lib/fleet-registry-links.js';
import { STARLINK_TAB_HREF } from '../src/lib/starlink-link.js';

const FLEET = JSON.parse(readFileSync(resolve(__dirname, '..', 'public', 'data', 'fleet.json'), 'utf8'));

describe('registryRowLinks', () => {
  it('links the tail to the aircraft dialog and Starlink to the Starlink tab', () => {
    expect(registryRowLinks({ r: 'N78501', w: 'Starlink' })).toEqual({ reg: '/?aircraft=N78501', wifi: '/#starlink' });
    expect(registryRowLinks({ r: 'N686UA', w: 'Satl Ku' })).toEqual({ reg: '/?aircraft=N686UA', wifi: null });
    expect(registryRowLinks({ r: 'N686UA', w: '' })).toEqual({ reg: '/?aircraft=N686UA', wifi: null });
    // The one shared address for a Starlink fact on a content page.
    expect(registryRowLinks({ r: 'N78501', w: 'Starlink' }).wifi).toBe(STARLINK_TAB_HREF);
  });

  it('a value that is not a US registration prints as text', () => {
    expect(registryRowLinks({ r: '', w: 'Starlink' }).reg).toBeNull();
    expect(registryRowLinks({ r: 'C-FABC' }).reg).toBeNull();
    expect(registryRowLinks(null)).toEqual({ reg: null, wifi: null });
  });

  it('every registry row in the fleet database gets a tail link', () => {
    expect(FLEET.length).toBeGreaterThan(1000);
    const unlinked = FLEET.filter((a) => !registryRowLinks(a).reg).map((a) => a.r);
    expect(unlinked).toEqual([]);
    for (const a of FLEET) expect(registryRowLinks(a).reg).toBe(`/?aircraft=${a.r}`);
  });

  it('reads Starlink in the Wi-Fi field case-blind, and nothing else as Starlink', () => {
    expect(isStarlinkWifi('Starlink')).toBe(true);
    expect(isStarlinkWifi('starlink ')).toBe(true);
    expect(isStarlinkWifi('Satl KU')).toBe(false);
    expect(isStarlinkWifi(undefined)).toBe(false);
  });
});
