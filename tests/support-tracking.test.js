// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

import { track } from '../src/lib/track.js';
import {
  SUPPORT_CLICK_EVENT,
  installSupportClickTracking,
  isSupportUrl,
  supportPlacement,
} from '../src/lib/support-tracking.js';

describe('track — Vercel Web Analytics custom events via the script tag', () => {
  it('calls va as a FUNCTION with the event payload (the script has no va.track)', () => {
    const va = vi.fn();
    track('support_click', { from: 'footer' }, { va });
    expect(va).toHaveBeenCalledWith('event', { name: 'support_click', data: { from: 'footer' } });
  });

  it('omits data when none is given', () => {
    const va = vi.fn();
    track('ping', undefined, { va });
    expect(va).toHaveBeenCalledWith('event', { name: 'ping' });
  });

  it('queues into vaq when the deferred script has not loaded yet', () => {
    const win = {};
    track('support_click', { from: 'about' }, win);
    expect(typeof win.va).toBe('function');
    expect(win.vaq).toHaveLength(1);
    expect(Array.from(win.vaq[0])).toEqual(['event', { name: 'support_click', data: { from: 'about' } }]);
  });

  it('regression: the old object-with-.track shape is not what it relies on', () => {
    // Before the fix the dashboard called window.va.track(); with the script, va is a function
    // and .track is undefined, so every event vanished. A function va must receive the call.
    const va = Object.assign(vi.fn(), { track: vi.fn() });
    track('news_banner_click', { slug: 'x' }, { va });
    expect(va).toHaveBeenCalledTimes(1);
    expect(va.track).not.toHaveBeenCalled();
  });

  it('never throws, whatever window looks like', () => {
    expect(() => track('x', undefined, undefined)).not.toThrow();
    expect(() => track('x', undefined, { va: () => { throw new Error('boom'); } })).not.toThrow();
    expect(() => track('', undefined, { va: vi.fn() })).not.toThrow();
  });
});

describe('support click tracking', () => {
  it('recognises Buy Me a Coffee URLs and nothing that merely looks like one', () => {
    expect(isSupportUrl('https://buymeacoffee.com/notjbg')).toBe(true);
    expect(isSupportUrl('https://www.buymeacoffee.com/notjbg/membership')).toBe(true);
    expect(isSupportUrl('https://buymeacoffee.com.evil.example/notjbg')).toBe(false);
    expect(isSupportUrl('https://notbuymeacoffee.com/')).toBe(false);
    expect(isSupportUrl('/fleet')).toBe(false);
    expect(isSupportUrl('not a url')).toBe(false);
  });

  it('labels a click by data-support, falling back to "other"', () => {
    const a = document.createElement('a');
    a.href = 'https://buymeacoffee.com/notjbg';
    expect(supportPlacement(a)).toBe('other');
    a.setAttribute('data-support', 'footer');
    expect(supportPlacement(a)).toBe('footer');
    const other = document.createElement('a');
    other.href = 'https://github.com/jonahberg/the-blue-board';
    other.setAttribute('data-support', 'footer');
    expect(supportPlacement(other)).toBeNull();
    expect(supportPlacement(null)).toBeNull();
  });

  it('sends one event per BMC click, including clicks on a child of the link', () => {
    document.body.innerHTML = `
      <a id="bmc" href="https://buymeacoffee.com/notjbg" data-support="landed-toast"><span id="inner">☕</span></a>
      <a id="gh" href="https://github.com/jonahberg/the-blue-board">GitHub</a>`;
    const send = vi.fn();
    installSupportClickTracking(document, send);
    installSupportClickTracking(document, send); // idempotent: a second install must not double-count

    const prevent = (e) => e.preventDefault(); // jsdom would otherwise try to navigate
    document.addEventListener('click', prevent);
    document.getElementById('inner').click();
    document.getElementById('gh').click();
    document.removeEventListener('click', prevent);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(SUPPORT_CLICK_EVENT, { from: 'landed-toast' });
  });
});
