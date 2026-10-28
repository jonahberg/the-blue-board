import { describe, expect, it } from 'vitest';
import { endpointHostForLog, isAllowedPushEndpoint, isPushServiceHost } from '../api/_push-endpoint.js';

// The watch-alerts cron POSTs to every stored endpoint, so only a browser vendor's push service may
// be stored or contacted (Oct 28 2026). Endpoint shapes below are the ones each browser hands out.

describe('isAllowedPushEndpoint: accepts each browser push service', () => {
  it.each([
    ['Chrome / Chromium (FCM)', 'https://fcm.googleapis.com/fcm/send/dXyz123:APA91bHq-abc_DEF'],
    ['Chrome (FCM web push v2)', 'https://fcm.googleapis.com/wp/dXyz123:APA91bHq-abc_DEF'],
    ['Safari', 'https://web.push.apple.com/QGuQyavXutnMH8ZqMzh9Oq5ilW-2RQA3qO4nGF1xc8bBQV'],
    ['Safari (other Apple push host)', 'https://api.push.apple.com/3/device/abc'],
    ['Firefox', 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl-abc_DEF='],
    ['Firefox (other autopush host)', 'https://autopush.push.services.mozilla.com/wpush/v1/abc'],
    ['Edge (WNS)', 'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD%2bk%2fabc%3d'],
    ['Edge (another WNS node)', 'https://db5p.notify.windows.com/w/?token=abc'],
  ])('%s', (_name, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it('accepts an uppercase host (URL lowercases it; the authority still matches)', () => {
    expect(isAllowedPushEndpoint('https://FCM.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedPushEndpoint('HTTPS://fcm.googleapis.com/fcm/send/abc')).toBe(true);
  });
});

describe('isAllowedPushEndpoint: rejects everything else', () => {
  it.each([
    // Look-alike hosts: dot-suffix match only, never substring.
    ['suffix appended to the real host', 'https://fcm.googleapis.com.attacker.com/x'],
    ['look-alike with a dash prefix', 'https://evil-fcm.googleapis.com.attacker.com/x'],
    ['prefix glued onto the host', 'https://xfcm.googleapis.com/x'],
    ['subdomain of fcm (exact host only)', 'https://a.fcm.googleapis.com/x'],
    ['other googleapis host', 'https://storage.googleapis.com/x'],
    ['apple without the push label', 'https://web.apple.com/x'],
    ['bare push.apple.com', 'https://push.apple.com/x'],
    ['apple suffix glued on', 'https://evilpush.apple.com/x'],
    ['apple suffix then attacker', 'https://web.push.apple.com.attacker.com/x'],
    ['bare push.services.mozilla.com', 'https://push.services.mozilla.com/x'],
    ['mozilla suffix glued on', 'https://evilpush.services.mozilla.com/x'],
    ['bare notify.windows.com', 'https://notify.windows.com/x'],
    ['windows suffix glued on', 'https://evilnotify.windows.com/x'],
    ['windows suffix then attacker', 'https://wns2.notify.windows.com.attacker.com/x'],
    ['trailing-dot host', 'https://fcm.googleapis.com./x'],
    // Scheme.
    ['http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['ftp', 'ftp://fcm.googleapis.com/x'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/plain,fcm.googleapis.com'],
    // IP literals and internal names.
    ['IPv4 literal', 'https://1.2.3.4/x'],
    ['cloud metadata IP', 'https://169.254.169.254/latest/meta-data'],
    ['IPv6 loopback', 'https://[::1]/x'],
    ['IPv6 literal', 'https://[2001:db8::1]/x'],
    ['decimal IPv4', 'https://2130706433/x'],
    ['localhost', 'https://localhost/x'],
    ['single-label host', 'https://push/x'],
    // Ports.
    ['explicit non-default port', 'https://fcm.googleapis.com:8443/x'],
    ['explicit default port', 'https://fcm.googleapis.com:443/x'],
    ['port on a suffix host', 'https://web.push.apple.com:444/x'],
    // Userinfo and parser-confusion tricks.
    ['userinfo before the real host', 'https://user@fcm.googleapis.com/x'],
    ['user:pass before the real host', 'https://u:p@fcm.googleapis.com/x'],
    ['real host as userinfo', 'https://fcm.googleapis.com@evil.com/x'],
    ['backslash authority', 'https://evil.com\\@fcm.googleapis.com/x'],
    ['backslash after host', 'https://fcm.googleapis.com\\@evil.com/x'],
    ['no path', 'https://fcm.googleapis.com'],
    ['query right after host', 'https://fcm.googleapis.com?x=1'],
    ['fragment right after host', 'https://fcm.googleapis.com#@evil.com'],
    ['leading space', ' https://fcm.googleapis.com/x'],
    ['trailing newline', 'https://fcm.googleapis.com/x\n'],
    ['tab in host', 'https://fcm.google\tapis.com/x'],
    ['newline in host', 'https://evil.com\n.fcm.googleapis.com/x'],
    ['NUL byte', 'https://fcm.googleapis.com/x\u0000'],
    ['percent-encoded host', 'https://fcm%2egoogleapis.com/x'],
    ['scheme-relative', '//fcm.googleapis.com/x'],
    ['not a URL', 'fcm.googleapis.com/fcm/send/abc'],
    ['empty string', ''],
  ])('%s', (_name, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const v of [undefined, null, 42, {}, [], { endpoint: 'https://fcm.googleapis.com/x' }]) {
      expect(isAllowedPushEndpoint(v)).toBe(false);
    }
  });

  it('rejects endpoints over 2048 characters and accepts one at the limit', () => {
    const prefix = 'https://fcm.googleapis.com/fcm/send/';
    expect(isAllowedPushEndpoint(prefix + 'a'.repeat(2048 - prefix.length))).toBe(true);
    expect(isAllowedPushEndpoint(prefix + 'a'.repeat(2049 - prefix.length))).toBe(false);
  });
});

describe('isPushServiceHost', () => {
  it('matches exact hosts and dot-suffixes only', () => {
    expect(isPushServiceHost('fcm.googleapis.com')).toBe(true);
    expect(isPushServiceHost('web.push.apple.com')).toBe(true);
    expect(isPushServiceHost('updates.push.services.mozilla.com')).toBe(true);
    expect(isPushServiceHost('wns2-bl2p.notify.windows.com')).toBe(true);
    expect(isPushServiceHost('.notify.windows.com')).toBe(false);
    expect(isPushServiceHost('notify.windows.com')).toBe(false);
    expect(isPushServiceHost('fcm.googleapis.com.evil.com')).toBe(false);
    expect(isPushServiceHost('')).toBe(false);
  });
});

describe('endpointHostForLog', () => {
  it('returns only the hostname, never the path (the subscription secret)', () => {
    expect(endpointHostForLog('https://evil.example:8443/secret-token')).toBe('evil.example');
  });

  it('describes values that are not parseable URLs', () => {
    expect(endpointHostForLog(undefined)).toBe('(not a string)');
    expect(endpointHostForLog('not a url')).toBe('(unparseable)');
  });
});
