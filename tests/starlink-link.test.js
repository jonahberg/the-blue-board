// Where a Starlink fact on a content page links (src/lib/starlink-link.js): the dashboard's
// Starlink tab, the address the dashboard itself opens that tab from.
import { describe, expect, it } from 'vitest';

import { TAB_HASHES } from '../src/app/tabs';
import { STARLINK_TAB_HREF } from '../src/lib/starlink-link.js';

describe('STARLINK_TAB_HREF', () => {
  it('is the dashboard at the Starlink tab', () => {
    expect(STARLINK_TAB_HREF).toBe('/#starlink');
    const url = new URL(STARLINK_TAB_HREF, 'https://theblueboard.co');
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
    // The dashboard opens a tab from location.hash by an exact match against TAB_HASHES.
    expect(url.hash).toBe(TAB_HASHES.starlink);
  });
});
