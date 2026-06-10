import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendAlert, __resetAlertThrottleForTests } from '../api/_alert.js';

describe('sendAlert', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetAlertThrottleForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ALERT_WEBHOOK_URL;
    __resetAlertThrottleForTests();
  });

  it('no-ops when ALERT_WEBHOOK_URL is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendAlert('title', ['line']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs a Discord-shaped payload when configured', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://discord.test/webhook';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    await sendAlert('⚠️ degraded', ['warmed=0 failed=3']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://discord.test/webhook');
    const body = JSON.parse(opts.body);
    expect(body.content).toContain('degraded');
    expect(body.content).toContain('warmed=0 failed=3');
  });

  it('throttles to one alert per 5 minutes per instance', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://discord.test/webhook';
    vi.useFakeTimers({ now: new Date('2026-06-10T12:00:00Z'), toFake: ['Date'] });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    await sendAlert('first', []);
    await sendAlert('suppressed', []);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-06-10T12:06:00Z'));
    await sendAlert('second', []);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('never throws into the caller when the webhook fails', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://discord.test/webhook';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    await expect(sendAlert('title', [])).resolves.toBeUndefined();
  });
});
