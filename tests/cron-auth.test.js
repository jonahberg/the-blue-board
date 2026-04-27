import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAuthorizedCronRequest } from '../api/_cron-auth.js';

describe('isAuthorizedCronRequest', () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret-with-decent-entropy-12345';
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it('accepts a request with the correct Bearer token', () => {
    const req = { headers: { authorization: 'Bearer test-secret-with-decent-entropy-12345' } };
    expect(isAuthorizedCronRequest(req)).toBe(true);
  });

  it('rejects a request with a wrong secret', () => {
    const req = { headers: { authorization: 'Bearer wrong-secret' } };
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });

  it('rejects a request with no authorization header', () => {
    const req = { headers: {} };
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });

  it('rejects an authorization header missing the Bearer prefix', () => {
    const req = { headers: { authorization: 'test-secret-with-decent-entropy-12345' } };
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });

  it('rejects when CRON_SECRET env var is unset', () => {
    delete process.env.CRON_SECRET;
    const req = { headers: { authorization: 'Bearer anything' } };
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });

  it('rejects when CRON_SECRET env var is empty string', () => {
    process.env.CRON_SECRET = '';
    const req = { headers: { authorization: 'Bearer anything' } };
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });

  it('handles a header value shorter than the secret without throwing', () => {
    // crypto.timingSafeEqual throws on mismatched-length buffers; the helper
    // must handle that case (the bug class this work is fixing).
    const req = { headers: { authorization: 'Bearer x' } };
    expect(() => isAuthorizedCronRequest(req)).not.toThrow();
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });

  it('handles a header value longer than the secret without throwing', () => {
    const req = { headers: { authorization: 'Bearer test-secret-with-decent-entropy-12345-and-extra-padding-here' } };
    expect(() => isAuthorizedCronRequest(req)).not.toThrow();
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });

  it('handles array-valued authorization headers (Vercel can pass arrays)', () => {
    const req = { headers: { authorization: ['Bearer test-secret-with-decent-entropy-12345'] } };
    expect(isAuthorizedCronRequest(req)).toBe(true);
  });

  it('rejects array-valued authorization headers with wrong secret', () => {
    const req = { headers: { authorization: ['Bearer wrong'] } };
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });

  it('rejects when authorization header is undefined-typed', () => {
    const req = { headers: { authorization: undefined } };
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });

  it('rejects when req.headers is missing entirely', () => {
    const req = {};
    expect(isAuthorizedCronRequest(req)).toBe(false);
  });
});
