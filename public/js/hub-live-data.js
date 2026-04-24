// Hub page live data refresh. Extracted from src/layouts/HubLayout.astro so
// Content-Security-Policy can drop 'unsafe-inline' from script-src.
//
// IATA code is read from a data attribute on <body> (set by the Astro template).
// The script is a no-op on pages where data-hub-iata is absent.
(function () {
  var iata = document.body && document.body.getAttribute('data-hub-iata');
  if (!iata) return;

  async function loadLiveData() {
    try {
      var r = await fetch('/api/fr24-feed?airline=UAL');
      if (!r.ok) throw new Error('Feed unavailable');
      var d = await r.json();
      var a = 0;
      var f = (d && d.result && d.result.response && d.result.response.data) || d;
      var e = Array.isArray(f) ? f : (typeof f === 'object' ? Object.values(f) : []);
      e.forEach(function (x) {
        var o = Array.isArray(x) ? x[11] : x && x.origin;
        var ds = Array.isArray(x) ? x[12] : x && x.dest;
        if (o === iata || ds === iata) a++;
      });
      var activeEl = document.getElementById('active');
      if (activeEl) activeEl.textContent = a;
      var as = document.getElementById('active-stat');
      if (as) as.textContent = a;
      var updatedEl = document.getElementById('updated-time');
      if (updatedEl) {
        updatedEl.textContent =
          'Updated ' +
          new Date().toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
          });
      }
    } catch (e) {
      var updatedEl = document.getElementById('updated-time');
      if (updatedEl) updatedEl.textContent = 'Live data temporarily unavailable';
    }
  }

  loadLiveData();
  setInterval(loadLiveData, 30000);
})();
