// @vitest-environment jsdom
/**
 * Links everywhere, part 2: the watch panel (the links plan, slice 2a).
 *
 *  - A watched flight's number is split out of the row's button as its flight page link (the
 *    row's one blue link), per DESIGN.md 2026-11-11 "A number inside a control that does
 *    something else is split out of it". The panel prints the raw watched ident, so the number
 *    links only when `flightLink` accepts it: a provider suffix (UA526H) stays inside the button.
 *  - The button still opens the flight sheet, and the route stays inside it.
 *  - "N of 20 slots used" is a quiet link to My Flights. The panel is a modal sheet the follow's
 *    `fromOverlay` does not close, so the link closes it in the same click: the panel shuts and
 *    My Flights shows.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider; the watch store is stubbed.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import { WatchPanel } from '../src/app/shell/WatchPanel';

const WATCH = vi.hoisted(() => ({
  watched: [
    { flight: 'UA576', route: 'ORD→DEN', status: 'Departed' },
    { flight: 'UA526H', route: '', status: '' },
  ],
  toggle: () => {},
  clearAll: () => {},
  isWatched: () => true,
  justAddedFirst: false,
  push: { prompted: true, permission: 'default', enable: async () => 'default', dismissPrompt: () => {} },
}));
vi.mock('../src/app/state/watch', () => ({ useWatch: () => WATCH }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

let ui: UiValue | null = null;
let panelOpen: boolean | null = null;

function Host() {
  ui = useUi();
  const [open, setOpen] = useState(true);
  panelOpen = open;
  return (
    <>
      {/* The tab panels the follow moves focus to (Dashboard.tsx marks each `TabsContent`). */}
      <div data-tab-panel="live" data-state={ui.tab === 'live' ? 'active' : 'inactive'} tabIndex={0} />
      <div data-tab-panel="myflight" data-state={ui.tab === 'myflight' ? 'active' : 'inactive'} tabIndex={0} />
      <WatchPanel open={open} onOpenChange={setOpen} />
    </>
  );
}

function mount() {
  return render(
    <UiProvider>
      <ScheduleProvider defaultHub="ORD">
        <FollowProvider>
          <Host />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

const panel = () => document.getElementById('watch-panel');
const rowOf = (text: string) => [...panel()!.querySelectorAll('li')].find((li) => li.textContent?.includes(text))!;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  // A frame comes after the commit, as in a browser: the follow moves focus to the panel it opens
  // then, once that panel is active.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
});
afterEach(() => {
  cleanup();
  ui = null;
  panelOpen = null;
});

describe('a watched flight in the panel', () => {
  it('its number is its flight page link, beside the button, in link colour', () => {
    mount();
    const row = rowOf('UA576');
    const link = [...row.querySelectorAll('a')].find((a) => a.textContent === 'UA576')!;
    expect(link.getAttribute('href')).toBe('/flight/UA576');
    expect(link.className.split(/\s+/)).toContain('text-primary');
    expect(link.closest('button')).toBeNull();
  });

  it('the button still opens the flight sheet and closes the panel; the route stays inside it', () => {
    mount();
    const button = rowOf('UA576').querySelector('button')!;
    expect(button.textContent).toContain('ORD→DEN');
    expect(button.textContent).toMatch(/UA576/);
    fireEvent.click(button);
    expect(ui!.selection).toEqual({ kind: 'ident', ident: 'UA576' });
    expect(panelOpen).toBe(false);
  });

  it('a number flightLink refuses (a provider suffix) is not a link and stays inside the button', () => {
    mount();
    const row = rowOf('UA526H');
    expect(row.querySelector('a')).toBeNull();
    expect(row.querySelector('button')!.textContent).toContain('UA526H');
  });
});

describe('"N of 20 slots used"', () => {
  it('is a quiet link to My Flights', () => {
    mount();
    const link = screen.getByRole('link', { name: '2 of 20 slots used' });
    expect(link.getAttribute('href')).toBe('/#myflight');
    expect(link.className.split(/\s+/)).not.toContain('text-primary');
    expect(link.className).toMatch(/decoration-muted-foreground/);
  });

  it('followed in place: the panel closes and My Flights shows, with focus on its panel', async () => {
    mount();
    const link = screen.getByRole('link', { name: '2 of 20 slots used' });
    link.focus();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      link.dispatchEvent(event);
    });
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    expect(event.defaultPrevented).toBe(true);
    expect(panelOpen).toBe(false);
    expect(ui!.tab).toBe('myflight');
    expect(document.activeElement?.getAttribute('data-tab-panel')).toBe('myflight');
  });

  it('a modified click is left to the browser: the panel stays open', () => {
    mount();
    const link = screen.getByRole('link', { name: '2 of 20 slots used' });
    const prevent = (event: Event) => event.preventDefault();
    document.addEventListener('click', prevent);
    try {
      fireEvent.click(link, { metaKey: true });
    } finally {
      document.removeEventListener('click', prevent);
    }
    expect(panelOpen).toBe(true);
    expect(ui!.tab).toBe('live');
  });
});
