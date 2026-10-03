/**
 * Vercel Web Analytics custom events, for a site that loads the analytics SCRIPT
 * (`/_vercel/insights/script.js`, see src/components/VercelAnalytics.astro) rather than the
 * `@vercel/analytics` package.
 *
 * With the script, `window.va` is a FUNCTION — `va('event', { name, data })` — not an object
 * with a `.track()` method. The dashboard used to call `window.va.track(...)`, which is
 * undefined, so every custom event since the v1.8.0 rebuild was silently dropped (zero events
 * in Web Analytics). This is the one place that knows the calling convention.
 *
 * The script is `defer`red, so a click can land before it has run. Installing Vercel's own
 * queue stub (`vaq`) when `va` is missing means the event waits for the script instead of
 * vanishing; the script drains `vaq` when it loads.
 *
 * Analytics may never break the page: any failure is swallowed.
 *
 * @param {string} name
 * @param {Record<string, string | number | boolean | null>} [data]
 * @param {any} [win] test seam; defaults to `window`
 */
export function track(name, data, win = typeof window === 'undefined' ? undefined : window) {
  try {
    if (!win || !name) return;
    if (typeof win.va !== 'function') {
      win.va = function va() {
        (win.vaq = win.vaq || []).push(arguments);
      };
    }
    win.va('event', data ? { name, data } : { name });
  } catch {
    /* analytics is never allowed to break a link */
  }
}
