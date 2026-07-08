// Live status widget for /newark. Modeled on public/js/hub-live-data.js —
// separate file (not inline) so CSP can keep script-src free of 'unsafe-inline'.
// Two feeds: /api/fr24-feed (active UA flights at EWR) and /api/faa (current
// FAA program status for EWR — ground stop / ground delay / departure delay).
(function () {
  var IATA = 'EWR';

  async function loadFlights() {
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
        if (o === IATA || ds === IATA) a++;
      });
      var activeEl = document.getElementById('newark-active');
      if (activeEl) activeEl.textContent = a;
      setUpdated();
    } catch (e) {
      var activeEl2 = document.getElementById('newark-active');
      if (activeEl2) activeEl2.textContent = '—';
      var updatedEl = document.getElementById('newark-updated-time');
      if (updatedEl) updatedEl.textContent = 'Live data temporarily unavailable';
    }
  }

  function setUpdated() {
    var updatedEl = document.getElementById('newark-updated-time');
    if (updatedEl) {
      updatedEl.textContent =
        'Updated ' +
        new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        });
    }
  }

  async function loadProgram() {
    var statusEl = document.getElementById('newark-program-status');
    if (!statusEl) return;
    try {
      var r = await fetch('/api/faa');
      if (!r.ok) throw new Error('FAA feed unavailable');
      var d = await r.json();
      var list = Array.isArray(d) ? d : [];
      var ewr = list.find(function (x) {
        return x && String(x.airportCode).toUpperCase() === IATA;
      });
      if (!ewr || !ewr.programs || ewr.programs.length === 0) {
        statusEl.textContent = 'No active FAA ground stop or delay program reported for EWR.';
        return;
      }
      var lines = ewr.programs.map(function (p) {
        var label = {
          ground_stop: 'Ground Stop',
          ground_delay: 'Ground Delay Program',
          departure_delay: 'Departure Delay',
          arrival_delay: 'Arrival Delay',
          closure: 'Closure',
        }[p.type] || p.type;
        var bits = [label];
        if (p.reason) bits.push('— ' + p.reason);
        if (p.avgDelay) bits.push('(avg ' + p.avgDelay + ' min)');
        return bits.join(' ');
      });
      statusEl.textContent = lines.join(' · ');
    } catch (e) {
      statusEl.textContent = 'Live program status temporarily unavailable';
    }
  }

  function loadAll() {
    loadFlights();
    loadProgram();
  }

  var timer = null;
  function startPolling() {
    if (timer === null) timer = setInterval(loadAll, 30000);
  }
  function stopPolling() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopPolling();
    } else {
      loadAll();
      startPolling();
    }
  });

  loadAll();
  if (!document.hidden) startPolling();
})();
