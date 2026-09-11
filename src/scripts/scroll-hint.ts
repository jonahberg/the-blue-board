/**
 * Scroll-hint fade, shared by HubLayout and FleetTypeLayout (formerly
 * `public/js/scroll-hint.js`).
 *
 * Bundled by Astro from a relative `<script src>`, so Content-Security-Policy
 * keeps `script-src 'self'` with no inline script. A no-op on pages without
 * `#scrollHint`.
 */

const hint = document.getElementById('scrollHint');

if (hint) {
  let dismissed = false;

  const onScroll = () => {
    if (dismissed || window.scrollY <= 100) return;
    dismissed = true;
    hint.style.opacity = '0';
    window.removeEventListener('scroll', onScroll);
    // `style.display` rather than the `hidden` attribute: a Tailwind display
    // utility on the element would outrank the browser's `[hidden]` rule.
    setTimeout(() => {
      hint.style.display = 'none';
    }, 500);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
}

export {};
