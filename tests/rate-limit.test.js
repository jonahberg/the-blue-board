import { describe, it, expect, vi } from 'vitest';
import { createRateLimiter } from '../api/_rate-limit.js';

describe('createRateLimiter', () => {
  it('returns a function', () => {
    const limiter = createRateLimiter('test-returns-fn', 10);
    expect(typeof limiter).toBe('function');
  });

  it('allows requests under the limit', () => {
    const limiter = createRateLimiter('test-under-limit', 5);
    const req = { headers: { 'x-real-ip': '1.2.3.4' } };

    for (let i = 0; i < 5; i++) {
      expect(limiter(req)).toBe(false);
    }
  });

  it('blocks requests over the limit', () => {
    const limiter = createRateLimiter('test-over-limit', 3);
    const req = { headers: { 'x-real-ip': '5.6.7.8' } };

    expect(limiter(req)).toBe(false);
    expect(limiter(req)).toBe(false);
    expect(limiter(req)).toBe(false);
    // 4th request should be blocked
    expect(limiter(req)).toBe(true);
  });

  it('tracks separate IPs independently', () => {
    const limiter = createRateLimiter('test-separate-ips', 2);
    const req1 = { headers: { 'x-real-ip': '10.0.0.1' } };
    const req2 = { headers: { 'x-real-ip': '10.0.0.2' } };

    expect(limiter(req1)).toBe(false);
    expect(limiter(req1)).toBe(false);
    expect(limiter(req1)).toBe(true); // blocked

    // Different IP should still be allowed
    expect(limiter(req2)).toBe(false);
  });

  it('prefers x-real-ip over x-forwarded-for', () => {
    const limiter = createRateLimiter('test-ip-priority', 1);
    const req = {
      headers: {
        'x-real-ip': '100.0.0.1',
        'x-forwarded-for': '200.0.0.1',
      },
    };

    expect(limiter(req)).toBe(false);
    expect(limiter(req)).toBe(true); // blocked for 100.0.0.1

    // A request from the x-forwarded-for IP should still be allowed
    const req2 = { headers: { 'x-real-ip': '200.0.0.1' } };
    expect(limiter(req2)).toBe(false);
  });

  it('falls back to x-forwarded-for when x-real-ip is missing', () => {
    const limiter = createRateLimiter('test-xff-fallback', 1);
    const req = { headers: { 'x-forwarded-for': '50.0.0.1, 60.0.0.1' } };

    expect(limiter(req)).toBe(false);
    expect(limiter(req)).toBe(true);
  });

  it('handles missing headers gracefully', () => {
    const limiter = createRateLimiter('test-no-headers', 2);
    const req = { headers: {} };

    expect(limiter(req)).toBe(false);
    expect(limiter(req)).toBe(false);
    expect(limiter(req)).toBe(true);
  });

  it('uses separate stores for different endpoint names', () => {
    const limiterA = createRateLimiter('endpoint-a', 1);
    const limiterB = createRateLimiter('endpoint-b', 1);
    const req = { headers: { 'x-real-ip': '99.0.0.1' } };

    expect(limiterA(req)).toBe(false);
    expect(limiterA(req)).toBe(true); // blocked on A

    // Same IP, different endpoint — should still be allowed
    expect(limiterB(req)).toBe(false);
  });

  // ── Sliding-window time behavior ──────────────────────────────────────────
  // The eviction (`while (log[0] < now - windowMs) log.shift()`) is the only
  // time-dependent branch in the limiter. Every synchronous test above still
  // passes if that window is broken (widened or removed), which would silently
  // block legitimate IPs long past the intended window — hence these fake-timer
  // tests that actually advance the clock.

  it('resets the sliding window so a blocked IP is allowed again once the window elapses', () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter('test-window-reset', 2);
      const req = { headers: { 'x-real-ip': '7.7.7.7' } };

      expect(limiter(req)).toBe(false);
      expect(limiter(req)).toBe(false);
      expect(limiter(req)).toBe(true); // 3rd within the 60s window → blocked

      vi.advanceTimersByTime(61_000); // window has fully elapsed
      expect(limiter(req)).toBe(false); // allowed again — not blocked for 10 minutes
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps counting requests within a partial (sub-window) interval', () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter('test-partial-window', 2);
      const req = { headers: { 'x-real-ip': '8.8.8.8' } };

      expect(limiter(req)).toBe(false); // t=0
      vi.advanceTimersByTime(30_000);
      expect(limiter(req)).toBe(false); // t=30s, still inside the same 60s window
      expect(limiter(req)).toBe(true); // 3rd inside the window → blocked (t=0 entry not yet evicted)
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors a custom window: entries persist far past the default 60s', () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter('test-custom-window', 2, 60 * 60 * 1000); // 1h window
      const req = { headers: { 'x-real-ip': '9.9.9.9' } };

      expect(limiter(req)).toBe(false);
      expect(limiter(req)).toBe(false);
      expect(limiter(req)).toBe(true); // 3rd → blocked

      vi.advanceTimersByTime(5 * 60 * 1000); // 5 min — well past the default 60s window
      expect(limiter(req)).toBe(true); // still blocked: the 1h window has not elapsed

      vi.advanceTimersByTime(56 * 60 * 1000); // now past the full hour
      expect(limiter(req)).toBe(false); // window elapsed → allowed
    } finally {
      vi.useRealTimers();
    }
  });
});
