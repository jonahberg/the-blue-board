// Service worker registration, extracted from public/index.html so Content-
// Security-Policy can drop 'unsafe-inline' from script-src. Keep small and
// dependency-free — this runs on every page load.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function () {});
}
