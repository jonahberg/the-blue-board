import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isProEnabled } from '../api/_kill-switch.js';

describe('isProEnabled', () => {
  const ORIG = {
    PRO_ENABLED: process.env.PRO_ENABLED,
    PRO_FEATURE_CHECKOUT_ENABLED: process.env.PRO_FEATURE_CHECKOUT_ENABLED,
    PRO_FEATURE_PUSH_ENABLED: process.env.PRO_FEATURE_PUSH_ENABLED,
    PRO_FEATURE_RISK_MONITOR_ENABLED: process.env.PRO_FEATURE_RISK_MONITOR_ENABLED,
  };

  beforeEach(() => {
    delete process.env.PRO_ENABLED;
    delete process.env.PRO_FEATURE_CHECKOUT_ENABLED;
    delete process.env.PRO_FEATURE_PUSH_ENABLED;
    delete process.env.PRO_FEATURE_RISK_MONITOR_ENABLED;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(ORIG)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('returns true by default with no env vars set (safe default)', () => {
    expect(isProEnabled()).toBe(true);
    expect(isProEnabled('checkout')).toBe(true);
    expect(isProEnabled('push')).toBe(true);
    expect(isProEnabled('risk_monitor')).toBe(true);
  });

  it('master switch off disables all features', () => {
    process.env.PRO_ENABLED = 'false';
    expect(isProEnabled()).toBe(false);
    expect(isProEnabled('checkout')).toBe(false);
    expect(isProEnabled('push')).toBe(false);
    expect(isProEnabled('risk_monitor')).toBe(false);
  });

  it('per-feature switch off disables only that feature', () => {
    process.env.PRO_FEATURE_PUSH_ENABLED = 'false';
    expect(isProEnabled()).toBe(true);
    expect(isProEnabled('checkout')).toBe(true);
    expect(isProEnabled('push')).toBe(false);
    expect(isProEnabled('risk_monitor')).toBe(true);
  });

  it('only "false" string disables — other values stay enabled (defensive)', () => {
    process.env.PRO_ENABLED = '0';
    expect(isProEnabled()).toBe(true);
    process.env.PRO_ENABLED = 'no';
    expect(isProEnabled()).toBe(true);
    process.env.PRO_ENABLED = 'true';
    expect(isProEnabled()).toBe(true);
  });

  it('master + per-feature both off — feature stays off', () => {
    process.env.PRO_ENABLED = 'false';
    process.env.PRO_FEATURE_CHECKOUT_ENABLED = 'true';
    expect(isProEnabled('checkout')).toBe(false);
  });
});
