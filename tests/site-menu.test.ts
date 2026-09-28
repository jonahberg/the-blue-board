// @vitest-environment jsdom
/** SiteHeader's phone menu closes on Escape and on a tap outside it (audit F27). */
import { afterEach, describe, expect, it } from 'vitest';

import { wireSiteMenu } from '../src/components/site/site-menu';

let cleanup: (() => void) | null = null;

function setup() {
  document.body.innerHTML = `
    <header><details data-site-menu><summary>Menu</summary><nav><a href="/hubs">Hubs</a></nav></details></header>
    <main><h1 id="outside">Page</h1></main>`;
  const details = document.querySelector('details') as HTMLDetailsElement;
  cleanup = wireSiteMenu(details);
  details.open = true;
  return details;
}

const pointerDown = (el: Element) => el.dispatchEvent(new Event('pointerdown', { bubbles: true }));

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
});

describe('wireSiteMenu', () => {
  it('Escape closes the open menu and returns focus to the summary', () => {
    const details = setup();
    (details.querySelector('a') as HTMLElement).focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector('summary'));
  });

  it('a tap outside closes it; a tap inside does not', () => {
    const details = setup();
    pointerDown(details.querySelector('a') as Element);
    expect(details.open).toBe(true);
    pointerDown(document.getElementById('outside') as Element);
    expect(details.open).toBe(false);
  });

  it('other keys and a closed menu are left alone', () => {
    const details = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(details.open).toBe(true);
    details.open = false;
    const summary = details.querySelector('summary') as HTMLElement;
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).not.toBe(summary);
  });

  it('SiteHeader wires every menu through a bundled script', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../src/components/site/SiteHeader.astro'), 'utf8');
    expect(src).toContain('<details class="group relative ml-auto md:hidden" data-site-menu>');
    expect(src).toMatch(/<script>\s*import \{ wireSiteMenu \} from '\.\/site-menu';/);
  });
});
