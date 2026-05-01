import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const loginJs = readFileSync(new URL('../public/js/pro-auth-login.js', import.meta.url), 'utf8');
const callbackJs = readFileSync(new URL('../public/js/pro-auth-callback.js', import.meta.url), 'utf8');

describe('Pro auth client redirect handling', () => {
  it('rejects protocol-relative next URLs in login and callback pages', () => {
    expect(loginJs).toContain("!n.startsWith('//')");
    expect(callbackJs).toContain("!n.startsWith('//')");
  });

  it('preserves callback recovery CTA by writing error text into the child paragraph', () => {
    expect(callbackJs).toContain("document.getElementById('pro-callback-error-text')");
    expect(callbackJs).toContain('errorTextEl.textContent');
  });
});
