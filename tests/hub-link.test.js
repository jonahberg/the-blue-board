import { describe, expect, it } from 'vitest';

import { HUB_ORDER } from '../src/lib/hub-health.js';
import { hubLink } from '../src/lib/hub-link.js';

describe('hubLink: which printed hub codes link, and where', () => {
  it('links a hub code to its Schedule board on the dashboard and its page on the site', () => {
    expect(hubLink('ord', 'dashboard')).toEqual({ code: 'ORD', href: '/?tab=schedule&hub=ORD' });
    expect(hubLink('ORD', 'site')).toEqual({ code: 'ORD', href: '/hubs/ord' });
  });

  it('links each of the nine hubs, and only those', () => {
    expect(HUB_ORDER).toHaveLength(9);
    for (const code of HUB_ORDER) {
      expect(hubLink(code, 'dashboard'), code).toEqual({ code, href: `/?tab=schedule&hub=${code}` });
      expect(hubLink(code, 'site'), code).toEqual({ code, href: `/hubs/${code.toLowerCase()}` });
    }
  });

  it('reads the printed code trimmed', () => {
    expect(hubLink(' den ', 'site')).toEqual({ code: 'DEN', href: '/hubs/den' });
  });

  it('does not link a non-hub airport, an empty value or a non-string', () => {
    for (const bad of ['LHR', 'XYZ', '', null, 42]) expect(hubLink(bad, 'dashboard'), String(bad)).toBeNull();
  });

  it('gives no address for a side it does not know, rather than guessing one', () => {
    expect(hubLink('ORD', 'Site')).toBeNull();
    expect(hubLink('ORD', undefined)).toBeNull();
  });
});
