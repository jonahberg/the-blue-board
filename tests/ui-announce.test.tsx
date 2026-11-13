// @vitest-environment jsdom
/**
 * The page's one polite region (`useUi().announce()`, rendered by shell/IropsAnnouncer.tsx) speaks
 * a sentence equal to the one before it again.
 *
 * A screen reader announces a live region when its text changes. Before Nov 12 2026 a repeat was
 * dropped, so the same link followed twice, or Back to a tab named a moment ago, said nothing the
 * second time. A repeat now toggles a trailing zero-width space: the region's text node changes
 * every time, and the words read aloud are the same.
 *
 * Mounted in the real UiProvider and the real announcer; the IROPS store the announcer also reads
 * is stubbed (the real one polls).
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IropsAnnouncer } from '../src/app/shell/IropsAnnouncer';
import { ANNOUNCEMENT_REPEAT_MARK, UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

vi.mock('../src/app/state/irops', () => ({ useIrops: () => ({ score: null }) }));

let ui: UiValue | null = null;
function Probe() {
  ui = useUi();
  return null;
}

function mount() {
  render(
    <UiProvider>
      <Probe />
      <IropsAnnouncer />
    </UiProvider>,
  );
  return screen.getByRole('status');
}

/** What a screen reader reads: the region's text without the repeat mark. */
const spoken = (region: HTMLElement) => (region.textContent ?? '').replaceAll(ANNOUNCEMENT_REPEAT_MARK, '');

afterEach(() => {
  cleanup();
  ui = null;
});

describe('announce(): a repeated sentence is announced again', () => {
  it('changes the region\'s text node on every repeat, and reads the same words', () => {
    const region = mount();
    const texts: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      act(() => ui!.announce('Schedule, ORD'));
      texts.push(region.textContent ?? '');
      expect(spoken(region)).toBe('Schedule, ORD');
    }
    // Each announcement differs from the one before it, so each is a change the reader hears.
    expect(texts[1]).not.toBe(texts[0]);
    expect(texts[2]).not.toBe(texts[1]);
    expect(texts[0]).toBe('Schedule, ORD');
  });

  it('records a DOM mutation for the repeat (what assistive technology listens for)', async () => {
    const region = mount();
    act(() => ui!.announce('Fleet, A319'));
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    act(() => ui!.announce('Fleet, A319'));
    await Promise.resolve();
    observer.disconnect();

    expect(records.length).toBeGreaterThan(0);
    expect(spoken(region)).toBe('Fleet, A319');
  });

  it('a different sentence is announced as written, with no mark', () => {
    const region = mount();
    act(() => ui!.announce('Schedule, ORD'));
    act(() => ui!.announce('Schedule, ORD'));
    act(() => ui!.announce('Fleet, A319'));
    expect(region.textContent).toBe('Fleet, A319');
    expect(ui!.announcement).toBe('Fleet, A319');
  });

  it('an empty sentence changes nothing', () => {
    const region = mount();
    act(() => ui!.announce('Schedule, ORD'));
    act(() => ui!.announce(''));
    expect(region.textContent).toBe('Schedule, ORD');
  });
});
