// Pro landing page client.
// Click "Subscribe" → check session → POST /api/stripe/checkout → redirect to Stripe.
// If not signed in, redirect to /auth/login first.
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

  var subscribeBtn = document.getElementById('pro-subscribe-btn');
  var errorEl = document.getElementById('pro-landing-error');
  if (!subscribeBtn) return;

  function setError(msg) {
    if (errorEl) {
      errorEl.textContent = msg || '';
      errorEl.style.display = msg ? 'block' : 'none';
    }
  }
  function setLoading(on) {
    subscribeBtn.disabled = on;
    subscribeBtn.textContent = on ? 'Loading…' : 'Subscribe — $5.99/mo';
  }

  subscribeBtn.addEventListener('click', function () {
    setError('');
    setLoading(true);
    import('https://unpkg.com/@supabase/supabase-js@2/+esm').then(function (mod) {
      var sb = mod.createClient(config.url, config.anonKey);
      sb.auth.getSession().then(function (r) {
        if (r.error || !r.data.session) {
          // Redirect to login with return URL set so user comes back here
          window.location.assign('/auth/login?next=/pro');
          return;
        }
        var token = r.data.session.access_token;
        return fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({}),
        })
          .then(function (resp) {
            return resp.json().then(function (b) { return { status: resp.status, body: b }; });
          })
          .then(function (res) {
            setLoading(false);
            if (res.status === 409) {
              // Already a subscriber — go to flights
              window.location.assign('/pro/flights');
              return;
            }
            if (res.status >= 400 || !res.body.url) {
              setError((res.body && res.body.error) || 'Could not start checkout.');
              return;
            }
            window.location.assign(res.body.url);
          })
          .catch(function () {
            setLoading(false);
            setError('Network error — try again.');
          });
      });
    }).catch(function () {
      setLoading(false);
      setError('Could not load auth library.');
    });
  });
})();
