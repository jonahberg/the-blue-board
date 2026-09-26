/**
 * The four copy tiers under the watch list (inventory §6, `renderWatchAlertsFootnote`).
 *
 * These sentences are a PROMISE about where an alert will reach the viewer, so each one
 * is pinned: a panel that says "you'll be notified even when this tab is closed" when no
 * subscription exists is the single most misleading thing this feature can say.
 */
import { describe, it, expect } from 'vitest';

import { watchAlertsFootnote } from '../src/lib/watch-utils.js';

const push = (overrides) => ({
  configured: false,
  bootstrapped: false,
  permission: 'default',
  backgroundActive: false,
  prompted: false,
  enable: async () => 'default',
  dismissPrompt: () => {},
  ...overrides,
});

describe('watchAlertsFootnote', () => {
  it('promises background alerts only when the whole chain holds', () => {
    expect(
      watchAlertsFootnote(push({ configured: true, bootstrapped: true, permission: 'granted', backgroundActive: true })),
    ).toBe('Background alerts on — you’ll be notified even when this tab is closed.');
  });

  it('offers the upgrade when the deployment can do it but this browser has not agreed', () => {
    expect(watchAlertsFootnote(push({ configured: true, bootstrapped: true }))).toBe(
      'Alerts work while this tab is open. Enable notifications for background alerts.',
    );
  });

  it('says so plainly when the deployment has no keys', () => {
    expect(watchAlertsFootnote(push({ bootstrapped: true, configured: false }))).toBe(
      'Alerts work while this tab is open. Background alerts: not yet enabled on this deployment.',
    );
  });

  it('claims nothing about the deployment before the server has answered', () => {
    const text = watchAlertsFootnote(push({ bootstrapped: false }));
    expect(text).toBe('Alerts work while this tab is open.');
    expect(text).not.toContain('not yet enabled on this deployment');
  });

  it('never promises background alerts on permission alone', () => {
    // Granted permission with no server keys is in-tab only.
    expect(
      watchAlertsFootnote(push({ bootstrapped: true, configured: false, permission: 'granted' })),
    ).not.toContain('even when this tab is closed');
  });

  it('never promises background alerts on configuration alone', () => {
    expect(
      watchAlertsFootnote(push({ bootstrapped: true, configured: true, permission: 'denied' })),
    ).not.toContain('even when this tab is closed');
  });
});
