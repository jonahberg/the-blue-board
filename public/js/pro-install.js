// Pro install + push registration client.
// Detects: installed-PWA (display-mode standalone), iOS Safari (no install yet),
// Android/Chrome (push works without install).
//
// Flow:
//   1. If standalone (PWA installed) → request push permission, subscribe, POST to /api/pro/push-subscribe
//   2. If iOS Safari + not standalone → show install walkthrough
//   3. Else (Android, desktop) → request push directly
//
// Email fallback: triggered by clicking "I'll install later, send email alerts"
// in the walkthrough — POSTs delivery=email to /api/pro/push-subscribe.
(function () {
  'use strict';

  function isStandalone() {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    // iOS Safari uses navigator.standalone
    if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
    return false;
  }

  function isIosSafari() {
    var ua = navigator.userAgent || '';
    var iOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    var safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return iOS && safari;
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
    return output;
  }

  function getToken() {
    return new Promise(function (resolve) {
      var configEl = document.getElementById('supabase-config');
      if (!configEl) return resolve(null);
      var config;
      try { config = JSON.parse(configEl.textContent || '{}'); } catch (e) { return resolve(null); }
      if (!config.url || !config.anonKey) return resolve(null);
      import('https://unpkg.com/@supabase/supabase-js@2/+esm').then(function (mod) {
        var sb = mod.createClient(config.url, config.anonKey);
        sb.auth.getSession().then(function (r) {
          resolve(r && r.data && r.data.session ? r.data.session.access_token : null);
        });
      }).catch(function () { resolve(null); });
    });
  }

  function postSubscription(payload) {
    return getToken().then(function (token) {
      if (!token) throw new Error('not signed in');
      return fetch('/api/pro/push-subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(payload),
      });
    });
  }

  function showWalkthrough() {
    var el = document.getElementById('pro-install-walkthrough');
    if (el) el.style.display = 'block';
  }
  function hideWalkthrough() {
    var el = document.getElementById('pro-install-walkthrough');
    if (el) el.style.display = 'none';
  }
  function showSuccess(msg) {
    var el = document.getElementById('pro-install-success');
    if (el) {
      el.textContent = msg || 'Notifications enabled.';
      el.style.display = 'block';
    }
  }
  function showError(msg) {
    var el = document.getElementById('pro-install-error');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  function registerPush() {
    var vapidEl = document.getElementById('vapid-public-key');
    if (!vapidEl) return showError('Push not configured.');
    var vapidKey = (vapidEl.textContent || '').trim();
    if (!vapidKey) return showError('Push key missing — admin needs to set VAPID_PUBLIC_KEY.');

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return showError('This browser does not support push notifications.');
    }

    navigator.serviceWorker.ready
      .then(function (reg) {
        return Notification.requestPermission().then(function (permission) {
          if (permission !== 'granted') throw new Error('permission denied');
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          });
        });
      })
      .then(function (sub) {
        var json = sub.toJSON();
        return postSubscription({
          delivery: 'push',
          subscription: { endpoint: json.endpoint, keys: json.keys },
          user_agent: navigator.userAgent,
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error('server rejected subscription');
        showSuccess('Push notifications enabled. You will get an alert when delay risk spikes.');
        hideWalkthrough();
      })
      .catch(function (err) {
        showError('Could not enable push: ' + (err && err.message ? err.message : 'unknown error'));
      });
  }

  function optInToEmail() {
    postSubscription({ delivery: 'email', user_agent: navigator.userAgent })
      .then(function (r) {
        if (!r.ok) throw new Error('server rejected email opt-in');
        showSuccess("Email alerts enabled. We'll email you when delay risk spikes.");
        hideWalkthrough();
      })
      .catch(function (err) {
        showError('Could not enable email alerts: ' + (err && err.message ? err.message : 'unknown error'));
      });
  }

  function init() {
    var enableBtn = document.getElementById('pro-install-enable');
    var emailBtn = document.getElementById('pro-install-email-fallback');
    if (enableBtn) enableBtn.addEventListener('click', registerPush);
    if (emailBtn) emailBtn.addEventListener('click', optInToEmail);

    if (isStandalone()) {
      // Already installed PWA — go straight to push permission
      registerPush();
      return;
    }
    if (isIosSafari()) {
      // Not installed; show iOS walkthrough
      showWalkthrough();
      return;
    }
    // Other platforms (Android, desktop) — try push directly
    registerPush();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
