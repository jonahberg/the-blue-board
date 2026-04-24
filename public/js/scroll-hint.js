// Scroll-hint fade, shared by HubLayout and FleetTypeLayout. Extracted so CSP
// can drop 'unsafe-inline' from script-src. No-op on pages without #scrollHint.
(function () {
  var h = document.getElementById('scrollHint');
  if (!h) return;
  var done = false;
  window.addEventListener('scroll', function () {
    if (!done && window.scrollY > 100) {
      h.style.opacity = '0';
      done = true;
      setTimeout(function () {
        h.style.display = 'none';
      }, 500);
    }
  });
})();
