// TSA page email gate. Extracted from src/pages/tsa.astro so CSP can drop
// 'unsafe-inline' from script-src. No-op on pages without the #tsa-gate element.
(function () {
  'use strict';

  var STORAGE_KEY = 'tsa_email_unlocked';
  var DISMISS_KEY = 'tsa_gate_dismissed';

  var isUnlocked = localStorage.getItem(STORAGE_KEY) === 'true';
  var isDismissed = localStorage.getItem(DISMISS_KEY) === 'true';

  function showGate() {
    var overlay = document.getElementById('tsa-gate');
    if (overlay) overlay.classList.remove('tsa-hidden');
  }

  function hideGate() {
    var overlay = document.getElementById('tsa-gate');
    if (overlay) overlay.classList.add('tsa-hidden');
  }

  if (!isUnlocked && !isDismissed) {
    setTimeout(showGate, 2000);
  }

  // Submit email
  var submitBtn = document.getElementById('tsa-gate-submit');
  var emailInput = document.getElementById('tsa-gate-email');
  var errorEl = document.getElementById('tsa-gate-error');

  if (submitBtn && emailInput) {
    submitBtn.addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorEl.textContent = 'Please enter a valid email address.';
        errorEl.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing up...';
      errorEl.style.display = 'none';

      var controller = new AbortController();
      var fetchTimeout = setTimeout(function () {
        controller.abort();
      }, 10000);

      fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, source: 'tsa-page' }),
        signal: controller.signal,
      })
        .then(function (resp) {
          clearTimeout(fetchTimeout);
          if (resp.ok || resp.status === 409) {
            localStorage.setItem(STORAGE_KEY, 'true');
            isUnlocked = true;
            hideGate();
          } else {
            resp
              .json()
              .catch(function () {
                return {};
              })
              .then(function (data) {
                errorEl.textContent = data.error || 'Something went wrong. Try again.';
                errorEl.style.display = 'block';
              });
            submitBtn.disabled = false;
            submitBtn.textContent = 'Get Free Access →';
          }
        })
        .catch(function (err) {
          clearTimeout(fetchTimeout);
          errorEl.textContent =
            err.name === 'AbortError'
              ? 'Request timed out. Please try again.'
              : 'Network error. Please try again.';
          errorEl.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Get Free Access →';
        });
    });

    emailInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitBtn.click();
    });
  }

  // Dismiss gate
  var dismissBtn = document.getElementById('tsa-gate-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', function () {
      localStorage.setItem(DISMISS_KEY, 'true');
      isDismissed = true;
      hideGate();
    });
  }

  // No live data fetching — MyTSA API is currently unavailable.
  // The API proxy and cron remain in place for when the data source returns.
})();
