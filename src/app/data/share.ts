/**
 * "Copy a link to this" — one implementation, shared by every surface that offers it
 * (inventory §16 "Share").
 *
 * The two fallbacks are not defensive padding. `navigator.clipboard` is unavailable on a
 * page served over plain HTTP and inside several in-app browsers, and `execCommand('copy')`
 * returns false rather than throwing when a browser has retired it — which is exactly how
 * the shipped dashboard once flashed "✓ Copied!" over an empty clipboard. So the last
 * resort is a prompt the visitor can copy out of by hand, and the caller is told which of
 * the two happened so it can say the honest thing.
 *
 * Extracted from `features/FlightSheet.tsx` when the aircraft dialog needed the same
 * behaviour; `main.js:6610-6638` is the original.
 */

export type ShareResult = 'copied' | 'prompted';

export async function shareUrl(url: string): Promise<ShareResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch {
    /* fall through */
  }
  try {
    const input = document.createElement('textarea');
    input.value = url;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    if (ok) return 'copied';
  } catch {
    /* fall through */
  }
  window.prompt('Copy this link', url);
  return 'prompted';
}
