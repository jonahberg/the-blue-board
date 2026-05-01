// Pro auth callback page client.
// Supabase v2 with detectSessionInUrl=true (default) auto-parses #access_token
// from the URL hash and stores the session in localStorage. We just wait for
// the auth state change, then redirect.
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

  var statusEl = document.getElementById('pro-callback-status');
  var errorEl = document.getElementById('pro-callback-error');
  var errorTextEl = document.getElementById('pro-callback-error-text');
  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }
  function setError(msg) {
    if (errorTextEl) errorTextEl.textContent = msg || '';
    if (errorEl) errorEl.style.display = msg ? 'block' : 'none';
    if (statusEl) statusEl.style.display = 'none';
  }

  // Honor ?next=... if it was preserved from the login page. Restrict to
  // same-origin paths so the param can't be used as an open-redirect.
  var redirect = '/pro/flights';
  try {
    var sp = new URLSearchParams(window.location.search);
    var n = sp.get('next');
    if (n && n.startsWith('/') && !n.startsWith('//') && /^\/[A-Za-z0-9_/?=&%.-]*$/.test(n)) {
      redirect = n;
    }
  } catch (_e) { /* ignore */ }

  import('https://unpkg.com/@supabase/supabase-js@2/+esm').then(function (mod) {
    var supabase = mod.createClient(config.url, config.anonKey, {
      auth: { detectSessionInUrl: true, persistSession: true },
    });

    // Give Supabase a moment to process the URL hash
    setTimeout(function () {
      supabase.auth.getSession().then(function (result) {
        if (result.error) {
          setError('Could not verify your link. Try requesting a new one.');
          return;
        }
        if (!result.data.session) {
          setError('This link has expired. Request a new magic link.');
          return;
        }
        setStatus('Signed in. Redirecting…');
        window.location.replace(redirect);
      });
    }, 200);
  }).catch(function () {
    setError('Could not load auth library. Refresh and try again.');
  });
})();
