import { describe, expect, it } from 'vitest';

import { HUB_ORDER } from '../src/lib/hub-health.js';
import { hubLink, hubStatusLink } from '../src/lib/hub-link.js';
import { WEATHER_CARD_HUBS, weatherScrollTarget } from '../src/lib/tab-hash.js';

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

describe('hubStatusLink: a hub code printed with a status goes where the status is shown', () => {
  it("'weather' links one of the nine hubs to its Weather card", () => {
    expect(hubStatusLink('ewr', 'weather')).toEqual({ code: 'EWR', href: '/?tab=weather&hub=EWR' });
    for (const code of HUB_ORDER) {
      expect(hubStatusLink(code, 'weather'), code).toEqual({ code, href: `/?tab=weather&hub=${code}` });
    }
  });

  it("'weather' is null for an airport without a card, an empty value or a non-string", () => {
    for (const bad of ['LGA', 'BOS', 'XYZ', '', null, 42]) expect(hubStatusLink(bad, 'weather'), String(bad)).toBeNull();
  });

  it("'nas' links any airport code to the NAS status panel, a hub or not", () => {
    expect(hubStatusLink('EWR', 'nas')).toEqual({ code: 'EWR', href: '/?tab=weather&section=nas' });
    expect(hubStatusLink(' lga ', 'nas')).toEqual({ code: 'LGA', href: '/?tab=weather&section=nas' });
    expect(hubStatusLink('KSFO', 'nas')).toEqual({ code: 'KSFO', href: '/?tab=weather&section=nas' });
    for (const bad of ['', 'L', 'LGA1', 'N78501', null, 42]) expect(hubStatusLink(bad, 'nas'), String(bad)).toBeNull();
  });

  it('gives no address for a kind it does not know', () => {
    expect(hubStatusLink('EWR', 'schedule')).toBeNull();
    expect(hubStatusLink('EWR', undefined)).toBeNull();
  });

  it('every address it gives lands where the Weather tab scrolls to on a cold load', () => {
    // A card for every hub it links (the Weather tab's own list), and the NAS panel.
    expect([...WEATHER_CARD_HUBS].sort()).toEqual([...HUB_ORDER].sort());
    for (const code of HUB_ORDER) {
      const href = hubStatusLink(code, 'weather')?.href ?? '';
      expect(weatherScrollTarget(new URL(href, 'https://theblueboard.co').searchParams), code).toBe(`hub-card-${code}`);
    }
    const nas = hubStatusLink('LGA', 'nas')?.href ?? '';
    expect(weatherScrollTarget(new URL(nas, 'https://theblueboard.co').searchParams)).toBe('nas-section');
  });
});
