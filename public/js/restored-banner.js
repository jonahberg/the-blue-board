// Data-restored announcement banner. Extracted to its own file (like news-banner.js)
// so Content-Security-Policy can keep 'unsafe-inline' off script-src.
// Shows once; stays dismissed via localStorage. Bump the KEY suffix to re-announce.
(function () {
  var KEY = 'bb_data_restored_dismissed_v1';
  function init() {
    var banner = document.getElementById('data-restored-banner');
    if (!banner) return;
    try {
      if (localStorage.getItem(KEY)) return; // already dismissed — never show
    } catch (e) {}
    banner.style.display = 'flex';
    var btn = document.getElementById('data-restored-dismiss');
    if (btn) {
      btn.addEventListener('click', function () {
        banner.style.display = 'none';
        try {
          localStorage.setItem(KEY, '1');
        } catch (e) {}
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
