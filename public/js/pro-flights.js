// Pro My Flights page client.
// - Loads supabase-js, gets the user's session token.
// - GET/POST/DELETE to /api/pro/flights with Bearer token.
// - Renders the flight list, handles add/remove.
// - Redirects to /auth/login if no session.
(function () {
  'use strict';

  var configEl = document.getElementById('supabase-config');
  if (!configEl) return;
  var config;
  try {
    config = JSON.parse(configEl.textContent || '{}');
  } catch (e) {
    return;
  }
  if (!config.url || !config.anonKey) return;

  var listEl = document.getElementById('pro-flights-list');
  var emptyEl = document.getElementById('pro-flights-empty');
  var form = document.getElementById('pro-flights-form');
  var input = document.getElementById('pro-flights-input');
  var submit = document.getElementById('pro-flights-submit');
  var errorEl = document.getElementById('pro-flights-error');
  var statusEl = document.getElementById('pro-flights-status');
  var signoutBtn = document.getElementById('pro-flights-signout');
  if (!listEl || !form || !input || !submit) return;

  function setError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg || '';
    errorEl.style.display = msg ? 'block' : 'none';
  }
  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function renderFlights(flights) {
    clearChildren(listEl);
    if (!flights || flights.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    flights.forEach(function (f) {
      var li = document.createElement('li');
      li.className = 'pro-flight-row';
      var label = document.createElement('span');
      label.className = 'pro-flight-label';
      label.textContent = f.flight_number;
      li.appendChild(label);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pro-flight-remove';
      btn.textContent = 'Remove';
      btn.setAttribute('aria-label', 'Remove ' + f.flight_number);
      btn.addEventListener('click', function () { removeFlight(f.flight_number); });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  var token = null;
  var supabase = null;

  function authedFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    return fetch(path, opts);
  }

  // If the user just landed from Stripe checkout, the webhook may not have
  // written the subscription row yet. Poll for up to 20s before bouncing
  // them back to /pro on a 403. After 20s we let the bounce happen — at that
  // point either the webhook genuinely failed (admin needs to investigate)
  // or the user came from somewhere other than checkout.
  function isCheckoutLanding() {
    return /[?&]checkout=success/.test(window.location.search);
  }

  function loadFlights(retryCount) {
    var maxRetries = isCheckoutLanding() ? 20 : 0; // ~20s of polling on success-landing
    var attempt = retryCount || 0;
    setStatus(attempt > 0 ? 'Verifying your subscription…' : 'Loading…');

    authedFetch('/api/pro/flights')
      .then(function (r) {
        if (r.status === 401) { window.location.replace('/auth/login'); return null; }
        if (r.status === 403) {
          if (attempt < maxRetries) {
            // Webhook race — retry in 1s
            setTimeout(function () { loadFlights(attempt + 1); }, 1000);
            return null;
          }
          window.location.replace('/pro');
          return null;
        }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        renderFlights(data.flights || []);
        setStatus('');
        // Strip the checkout=success param so a refresh doesn't re-poll
        if (isCheckoutLanding() && window.history.replaceState) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      })
      .catch(function () {
        setError('Could not load your flights — refresh and try again.');
      });
  }

  function addFlight(flightNumber) {
    setError('');
    var fn = (flightNumber || '').trim().toUpperCase();
    if (!fn) { setError('Enter a flight number.'); return; }
    submit.disabled = true;
    submit.textContent = 'Adding…';
    authedFetch('/api/pro/flights', {
      method: 'POST',
      body: JSON.stringify({ flight_number: fn }),
    })
      .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
      .then(function (res) {
        submit.disabled = false;
        submit.textContent = 'Add flight';
        if (res.status >= 400) {
          setError((res.body && res.body.error) || 'Could not add flight.');
          return;
        }
        input.value = '';
        loadFlights();
      })
      .catch(function () {
        submit.disabled = false;
        submit.textContent = 'Add flight';
        setError('Network error — try again.');
      });
  }

  function removeFlight(flightNumber) {
    authedFetch('/api/pro/flights?flight_number=' + encodeURIComponent(flightNumber), {
      method: 'DELETE',
    }).then(function () { loadFlights(); }).catch(function () {});
  }

  function signOut() {
    if (supabase) {
      supabase.auth.signOut().then(function () {
        window.location.replace('/');
      });
    }
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    addFlight(input.value);
  });
  if (signoutBtn) signoutBtn.addEventListener('click', signOut);

  import('https://unpkg.com/@supabase/supabase-js@2/+esm').then(function (mod) {
    supabase = mod.createClient(config.url, config.anonKey);
    supabase.auth.getSession().then(function (result) {
      if (result.error || !result.data.session) {
        window.location.replace('/auth/login');
        return;
      }
      token = result.data.session.access_token;
      loadFlights();
    });
  }).catch(function () {
    setError('Could not load auth library.');
  });
})();
