// Service worker registration. Imported as a module by the page entrypoint so
// Content-Security-Policy can keep `script-src 'self'` with no inline scripts.
// Keep small and dependency-free — this runs on every page load.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export {};
