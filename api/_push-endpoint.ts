// Which Web Push endpoints the server will store and POST to.
//
// A push subscription's endpoint is a URL the browser hands us, and the watch-alerts cron later
// POSTs to it from our infrastructure (api/_web-push.ts → web-push → https.request). Accepting any
// https URL made that a blind server-side request to an address of the caller's choosing, so the
// endpoint must be on a browser vendor's push service:
//
//   Chrome, Opera, Samsung Internet, other Chromium  fcm.googleapis.com
//   Safari (macOS 13+, iOS 16.4+)                    web.push.apple.com (any *.push.apple.com)
//   Firefox                                          updates.push.services.mozilla.com (any *.push.services.mozilla.com)
//   Edge                                             *.notify.windows.com (WNS)
//
// Hosts match exactly or by a dot-suffix, never by substring: `evil-fcm.googleapis.com.example`
// and `xfcm.googleapis.com` both fail.
//
// web-push re-parses the endpoint with Node's legacy url.parse(), not WHATWG URL. So that the two
// parsers can't disagree about the host, the raw string must also begin with exactly
// `https://<host>/`: no userinfo, no port, nothing unusual between the scheme and the path.
// Browsers serialize PushSubscription.endpoint that way, so real endpoints always pass.

const MAX_ENDPOINT_LENGTH = 2048;

const EXACT_HOSTS: ReadonlySet<string> = new Set([
  'fcm.googleapis.com',
  'web.push.apple.com',
  'updates.push.services.mozilla.com',
]);

const HOST_SUFFIXES: readonly string[] = [
  '.push.apple.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
];

/** True when `hostname` (already lowercased by URL) is one of the known push services. */
export function isPushServiceHost(hostname: string): boolean {
  if (EXACT_HOSTS.has(hostname)) return true;
  return HOST_SUFFIXES.some((suffix) => hostname.length > suffix.length && hostname.endsWith(suffix));
}

/** True when `endpoint` is an https URL on a known push service that is safe to store and POST to. */
export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return false;
  }
  // Whitespace and control characters: WHATWG URL silently strips tabs/newlines and trims the
  // ends, so the string we would store and the URL we checked could differ.
  if (/[\s\u0000-\u001f\u007f]/.test(endpoint)) return false;

  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username !== '' || u.password !== '') return false;
  if (u.port !== '') return false;
  if (!isPushServiceHost(u.hostname)) return false;

  // The authority must be exactly the hostname, as any parser would read it.
  return endpoint.toLowerCase().startsWith(`https://${u.hostname}/`);
}

/** The endpoint's hostname for logging (never the path, which is the subscription's secret). */
export function endpointHostForLog(endpoint: unknown): string {
  if (typeof endpoint !== 'string') return '(not a string)';
  try {
    return new URL(endpoint).hostname || '(no host)';
  } catch {
    return '(unparseable)';
  }
}
