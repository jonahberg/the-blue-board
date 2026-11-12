// @vitest-environment jsdom
/**
 * Live audit Oct 4 2026: the IROPS "What does this mean?" button did nothing when tapped on a
 * touch screen. Radix tooltips open on hover and focus only, so every tooltip on the site — the
 * "?", the dotted jargon terms, the hub chips — was invisible on a phone. A touch or pen tap now
 * toggles the tooltip; mouse and keyboard keep Radix's behaviour, and the trigger's own click
 * (a link, a button) still runs.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { tapToggleOpen } from '../src/lib/tap-tooltip.js';

beforeAll(() => {
  // Radix positions the content with floating-ui, which needs a ResizeObserver jsdom lacks.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(cleanup);

describe('tapToggleOpen', () => {
  it('flips the tooltip on a touch or pen tap', () => {
    expect(tapToggleOpen({ pointerType: 'touch', wasOpen: false })).toBe(true);
    expect(tapToggleOpen({ pointerType: 'touch', wasOpen: true })).toBe(false);
    expect(tapToggleOpen({ pointerType: 'pen', wasOpen: false })).toBe(true);
  });

  it('leaves mouse clicks and keyboard activation to Radix', () => {
    expect(tapToggleOpen({ pointerType: 'mouse', wasOpen: false })).toBeNull();
    expect(tapToggleOpen(null)).toBeNull(); // no pointerdown: Enter/Space
    expect(tapToggleOpen(undefined)).toBeNull();
  });

  it('closes on a tap whose click the trigger took in place (a dashboard link followed without a reload)', () => {
    expect(tapToggleOpen({ pointerType: 'touch', wasOpen: false }, { handledInPlace: true })).toBe(false);
    expect(tapToggleOpen({ pointerType: 'pen', wasOpen: true }, { handledInPlace: true })).toBe(false);
    expect(tapToggleOpen({ pointerType: 'mouse', wasOpen: false }, { handledInPlace: true })).toBeNull();
    expect(tapToggleOpen(null, { handledInPlace: true })).toBeNull();
  });
});

function renderTip(onClick: (event: { preventDefault: () => void }) => void = () => {}) {
  render(
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="What does this mean?" onClick={onClick}>
            ?
          </button>
        </TooltipTrigger>
        <TooltipContent>Score explained</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
  return screen.getByRole('button', { name: 'What does this mean?' });
}

// Real event orders (verified in Chromium with touch emulation). A touch tap focuses the trigger
// AFTER pointerup — Radix answers that focus by opening the tooltip, then the click closes it;
// leaving out the focus step is how a fix can pass here and fail on a phone. A mouse focuses it
// on mousedown, while the pointer is still down, which Radix deliberately ignores.
async function tap(el: HTMLElement, pointerType = 'touch') {
  await act(async () => {
    fireEvent.pointerDown(el, { pointerType, button: 0 });
    if (pointerType === 'mouse') el.focus();
    fireEvent.pointerUp(el, { pointerType, button: 0 });
    if (pointerType !== 'mouse') el.focus();
    fireEvent.click(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Tooltip on a touch screen', () => {
  it('opens on a tap and closes on a second tap', async () => {
    const trigger = renderTip();
    expect(screen.queryByRole('tooltip')).toBeNull();

    await tap(trigger);
    expect(screen.getByRole('tooltip').textContent).toContain('Score explained');

    await tap(trigger); // already focused: no focus event this time
    expect(screen.queryByRole('tooltip')).toBeNull();

    await tap(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('still runs the trigger’s own click — a tap adds the explanation, it never swallows the action', async () => {
    const onClick = vi.fn();
    const trigger = renderTip(onClick);
    await tap(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('stays shut after a tap whose click the trigger took in place: the reader has moved on', async () => {
    // A dashboard link followed without a reload (the hub chips) prevents the page load.
    const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const trigger = renderTip(onClick);
    await tap(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not toggle on a mouse click (hover already shows it; Radix closes on click)', async () => {
    const trigger = renderTip();
    await tap(trigger, 'mouse');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
