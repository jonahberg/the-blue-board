// Pro auth login page client.
// Reads Supabase config from <script id="supabase-config"> JSON block, loads
// supabase-js from unpkg (allowed by CSP), submits magic-link request, shows
// success state. No inline scripts (CSP forbids unsafe-inline).
(function () {
  'use strict';

  var configEl = document.getElementById('supabase-config');
  if (!configEl) {
    console.error('[pro-auth-login] missing #supabase-config');
    return;
  }
  var config;
  try {
    config = JSON.parse(configEl.textContent || '{}');
  } catch (e) {
    console.error('[pro-auth-login] bad config json', e);
    return;
  }
  if (!config.url || !config.anonKey) {
    console.error('[pro-auth-login] missing url or anonKey');
    return;
  }

  var form = document.getElementById('pro-login-form');
  var input = document.getElementById('pro-login-email');
  var submit = document.getElementById('pro-login-submit');
  var errorEl = document.getElementById('pro-login-error');
  var successEl = document.getElementById('pro-login-success');
  var formWrap = document.getElementById('pro-login-form-wrap');
  if (!form || !input || !submit || !errorEl || !successEl || !formWrap) return;

  function setError(msg) {
    errorEl.textContent = msg || '';
    errorEl.style.display = msg ? 'block' : 'none';
  }
  function setLoading(on) {
    submit.disabled = on;
    submit.textContent = on ? 'Sending…' : 'Send magic link';
  }

  import('https://unpkg.com/@supabase/supabase-js@2/+esm').then(function (mod) {
    var supabase = mod.createClient(config.url, config.anonKey);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      setError('');
      var email = (input.value || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError('Please enter a valid email address.');
        return;
      }
      setLoading(true);
      // Preserve ?next=... through the round-trip so a user clicking
      // Subscribe → /auth/login?next=/pro lands back on /pro after auth
      // (not the default /pro/flights, which 403s for not-yet-Pro users).
      var nextParam = '';
      try {
        var sp = new URLSearchParams(window.location.search);
        var n = sp.get('next');
        if (n && /^\//.test(n)) nextParam = '?next=' + encodeURIComponent(n);
      } catch (_e) { /* ignore */ }

      supabase.auth
        .signInWithOtp({
          email: email,
          options: {
            emailRedirectTo: window.location.origin + '/auth/callback' + nextParam,
          },
        })
        .then(function (result) {
          setLoading(false);
          if (result.error) {
            setError(result.error.message || 'Could not send link. Try again.');
            return;
          }
          formWrap.style.display = 'none';
          successEl.style.display = 'block';
        })
        .catch(function (err) {
          setLoading(false);
          setError((err && err.message) || 'Network error. Try again.');
        });
    });
  }).catch(function (err) {
    console.error('[pro-auth-login] failed to load supabase-js', err);
    setError('Could not load auth library. Refresh and try again.');
  });
})();
