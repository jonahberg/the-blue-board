import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the web-push transport. resetModules() before each test gives a fresh _web-push module
// (its vapidReady memo starts false) and fresh mock fns, so the memo behaviour is testable.
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

async function load() {
  const webpush = (await import('web-push')).default;
  const mod = await import('../api/_web-push.js');
  return { webpush, ...mod };
}

function setVapid(contact = 'mailto:test@example.com') {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'BPublicKey';
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'PrivateKey';
  process.env.WEB_PUSH_CONTACT = contact;
}
function clearVapid() {
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_CONTACT;
}

const TARGET = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } };

describe('_web-push', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    clearVapid();
  });
  afterEach(() => {
    clearVapid();
  });

  describe('sendPush', () => {
    it('maps a resolved send to ok:true / gone:false with the returned statusCode', async () => {
      const { webpush, sendPush } = await load();
      webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
      const r = await sendPush(TARGET, { hello: 'world' });
      expect(r).toEqual({ ok: true, statusCode: 201, gone: false });
    });

    it('defaults statusCode to 201 when the transport omits it', async () => {
      const { webpush, sendPush } = await load();
      webpush.sendNotification.mockResolvedValue({});
      const r = await sendPush(TARGET, {});
      expect(r.ok).toBe(true);
      expect(r.statusCode).toBe(201);
    });

    it('maps a 410 rejection to gone:true (dead subscription)', async () => {
      const { webpush, sendPush } = await load();
      webpush.sendNotification.mockRejectedValue({ statusCode: 410 });
      const r = await sendPush(TARGET, {});
      expect(r).toEqual({ ok: false, statusCode: 410, gone: true });
    });

    it('maps a 404 rejection to gone:true', async () => {
      const { webpush, sendPush } = await load();
      webpush.sendNotification.mockRejectedValue({ statusCode: 404 });
      const r = await sendPush(TARGET, {});
      expect(r.gone).toBe(true);
    });

    it('maps a 500 rejection to ok:false / gone:false (transient, keep the sub)', async () => {
      const { webpush, sendPush } = await load();
      webpush.sendNotification.mockRejectedValue({ statusCode: 500 });
      const r = await sendPush(TARGET, {});
      expect(r).toEqual({ ok: false, statusCode: 500, gone: false });
    });

    it('maps a transport error with no statusCode to statusCode:0 / gone:false', async () => {
      const { webpush, sendPush } = await load();
      webpush.sendNotification.mockRejectedValue(new Error('ECONNRESET'));
      const r = await sendPush(TARGET, {});
      expect(r).toEqual({ ok: false, statusCode: 0, gone: false });
    });

    it('sends with TTL:3600 and the JSON-stringified payload', async () => {
      const { webpush, sendPush } = await load();
      webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
      await sendPush(TARGET, { title: 'hi' });
      const [sub, body, opts] = webpush.sendNotification.mock.calls[0];
      expect(sub).toEqual({ endpoint: TARGET.endpoint, keys: TARGET.keys });
      expect(body).toBe(JSON.stringify({ title: 'hi' }));
      expect(opts).toEqual({ TTL: 3600 });
    });
  });

  describe('sendPush: endpoint allowlist at send time (Oct 28 2026)', () => {
    // A row stored before api/push-subscribe.ts checked the push service must not make the cron
    // POST to an arbitrary URL. Skipped as an ordinary failure (gone:false), so watch-alerts'
    // failed_count bookkeeping prunes it instead of this check deleting rows by itself.
    it.each([
      ['an internal address', 'https://169.254.169.254/latest/meta-data'],
      ['a look-alike host', 'https://fcm.googleapis.com.attacker.com/x'],
      ['plain http', 'http://fcm.googleapis.com/fcm/send/x'],
      ['a non-default port', 'https://fcm.googleapis.com:8443/x'],
      ['a single-label host', 'https://push/x'],
    ])('never contacts %s, logs only the host, and reports ok:false / gone:false', async (_name, endpoint) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { webpush, sendPush } = await load();
      const r = await sendPush({ endpoint, keys: TARGET.keys }, { title: 'hi' });
      expect(r).toEqual({ ok: false, statusCode: 0, gone: false });
      expect(webpush.sendNotification).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/not a known push service/);
      // The path is the subscription's secret; the log carries the host only.
      expect(warn.mock.calls[0][0]).not.toContain('/latest/meta-data');
      warn.mockRestore();
    });

    it('handles a target with no endpoint without throwing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { webpush, sendPush } = await load();
      const r = await sendPush({ keys: TARGET.keys }, {});
      expect(r).toEqual({ ok: false, statusCode: 0, gone: false });
      expect(webpush.sendNotification).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it.each([
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://web.push.apple.com/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ])('sends to %s', async (endpoint) => {
      const { webpush, sendPush } = await load();
      webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
      const r = await sendPush({ endpoint, keys: TARGET.keys }, {});
      expect(r.ok).toBe(true);
      expect(webpush.sendNotification.mock.calls[0][0].endpoint).toBe(endpoint);
    });
  });

  describe('ensureVapidConfigured', () => {
    it('returns false and never configures web-push when unconfigured', async () => {
      const { webpush, ensureVapidConfigured } = await load();
      expect(ensureVapidConfigured()).toBe(false);
      expect(webpush.setVapidDetails).not.toHaveBeenCalled();
    });

    it('configures web-push exactly once across repeat calls (vapidReady memo)', async () => {
      setVapid();
      const { webpush, ensureVapidConfigured } = await load();
      expect(ensureVapidConfigured()).toBe(true);
      expect(ensureVapidConfigured()).toBe(true);
      expect(webpush.setVapidDetails).toHaveBeenCalledTimes(1);
    });

    it('prefixes a bare email contact with mailto:', async () => {
      setVapid('ops@x.com');
      const { webpush, ensureVapidConfigured } = await load();
      ensureVapidConfigured();
      expect(webpush.setVapidDetails.mock.calls[0][0]).toBe('mailto:ops@x.com');
    });

    it('passes an https: contact through unprefixed', async () => {
      setVapid('https://example.com/contact');
      const { webpush, ensureVapidConfigured } = await load();
      ensureVapidConfigured();
      expect(webpush.setVapidDetails.mock.calls[0][0]).toBe('https://example.com/contact');
    });

    it('passes an existing mailto: contact through unchanged', async () => {
      setVapid('mailto:already@x.com');
      const { webpush, ensureVapidConfigured } = await load();
      ensureVapidConfigured();
      expect(webpush.setVapidDetails.mock.calls[0][0]).toBe('mailto:already@x.com');
    });
  });
});
