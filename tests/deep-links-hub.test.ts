// @vitest-environment jsdom
/**
 * `/?hub=den` — the hub pages' "Live DEN Map" CTA (F13/F45). The Live view seeds its hub
 * filter from `readLiveHubDeepLink()`; the welcome overlay stays down on a deep-link arrival.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { isDeepLinkArrival, readLiveHubDeepLink } from '../src/app/state/deep-links';

const HUBS = ['EWR', 'IAH', 'ORD', 'DEN', 'SFO', 'LAX', 'IAD', 'NRT', 'GUM'];
const go = (search: string) => window.history.replaceState(null, '', `/${search}`);

afterEach(() => go(''));

describe('readLiveHubDeepLink', () => {
  it('reads ?hub= with no tab as the Live map hub, case-insensitively', () => {
    go('?hub=den');
    expect(readLiveHubDeepLink(HUBS)).toBe('DEN');
  });

  it('accepts ?tab=live&hub=', () => {
    go('?tab=live&hub=ORD');
    expect(readLiveHubDeepLink(HUBS)).toBe('ORD');
  });

  it('leaves ?tab=schedule&hub= and ?tab=irops&hub= to their own tabs', () => {
    go('?tab=schedule&hub=den');
    expect(readLiveHubDeepLink(HUBS)).toBeNull();
    go('?tab=irops&hub=den');
    expect(readLiveHubDeepLink(HUBS)).toBeNull();
  });

  it('ignores a hub the map does not know rather than filtering to nothing', () => {
    go('?hub=xyz');
    expect(readLiveHubDeepLink(HUBS)).toBeNull();
    go('');
    expect(readLiveHubDeepLink(HUBS)).toBeNull();
  });
});

describe('isDeepLinkArrival', () => {
  it('is true for the published deep links and false for a bare visit', () => {
    for (const q of ['?hub=den', '?tab=fleet&filter=starlink', '?flight=UA1', '?aircraft=N1']) {
      go(q);
      expect(isDeepLinkArrival()).toBe(true);
    }
    go('');
    expect(isDeepLinkArrival()).toBe(false);
    go('?utm_source=x');
    expect(isDeepLinkArrival()).toBe(false);
  });
});
