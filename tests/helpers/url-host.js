// Which upstream a mocked fetch was asked for, by host — not by a substring of the URL.
//
// `String(url).includes('fr24api.flightradar24.com')` is what CodeQL's
// js/incomplete-url-substring-sanitization flags (Oct 28 2026, 37 alerts across the suite): it is
// also true for https://evil.example/?fr24api.flightradar24.com. In a test that is harmless, but it
// is the habit the rule exists to catch, so the suite routes mocks on the parsed host instead.

/**
 * The host of `url` (lower case, no port), or '' when it is not an absolute URL: a relative path,
 * a Request, undefined. Never throws.
 * @param {unknown} url  a string, URL, or Request
 */
export function hostOf(url) {
  const text = typeof url === 'string' ? url : url instanceof URL ? url.href : typeof url?.url === 'string' ? url.url : '';
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * True when `url`'s host is exactly `host`.
 * @param {unknown} url
 * @param {string} host  e.g. 'fr24api.flightradar24.com'
 */
export function isHost(url, host) {
  return hostOf(url) === String(host).toLowerCase();
}
