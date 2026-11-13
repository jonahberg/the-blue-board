// @vitest-environment jsdom
/**
 * A brief chip is a link only when its address switches tab (src/app/features/BriefPanel.tsx,
 * `BriefChip`): the part 1 test gap "BriefChip's null-tab branch".
 *
 * `resolveDeepLink` gives an overlay address (`/?aircraft=N78501`) an intent with `tab: null`: it
 * opens a dialog over whichever tab is showing. A chip always moves the reader to where its fact
 * is shown, so a chip whose address resolves without a tab renders as plain text, as one with no
 * target does. No fact kind builds such an address today (`chipTarget`), so the chips here are
 * given straight to the panel by stubbing `itemChips`; a chip that does switch tab sits beside it
 * as the control.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider; the brief store is stubbed
 * to the one thing the body asks of it (closing the sheet), and the Schedule store's watch-list
 * collaborators as in tests/dash-link.test.tsx.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefBody } from '../src/app/features/BriefPanel';
import type { BriefReady } from '../src/app/state/brief';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));
vi.mock('../src/app/state/brief', () => ({ useBrief: () => ({ setSheetOpen: () => {} }) }));
vi.mock('../src/lib/brief-chips.js', () => ({
  itemChips: () => [
    { id: 'overlay', label: 'N78501 aircraft', tone: 'plain', title: 'An aircraft', target: { href: '/?aircraft=N78501', tab: 'live' } },
    { id: 'board', label: 'ORD 81%', tone: 'plain', title: 'ORD on time', target: { href: '/?tab=schedule&hub=ORD', tab: 'schedule' } },
  ],
}));

let ui: UiValue | null = null;
function Probe() {
  ui = useUi();
  return null;
}

const VIEW: BriefReady = {
  status: 'ready',
  headline: 'Operations are normal.',
  tone: 'calm',
  source: 'template',
  items: [{ text: 'Two facts.', factIds: ['overlay', 'board'] }],
  travelerNote: null,
  facts: [],
  factsById: new Map(),
  factCount: 2,
  generatedAtMs: Date.parse('2026-11-12T18:00:00Z'),
  checkedAtMs: Date.parse('2026-11-12T18:00:00Z'),
  nextUpdateAtMs: null,
  hasRadio: false,
};

function mount() {
  render(
    <UiProvider>
      <ScheduleProvider defaultHub="DEN">
        <FollowProvider>
          <BriefBody view={VIEW} variant="sidebar" renderHeadline={(text) => <h2>{text}</h2>} />
          <Probe />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  ui = null;
});

describe('a brief chip whose address switches no tab', () => {
  it('renders as plain text, not a link; a clicked tag opens nothing', () => {
    mount();
    expect(screen.queryByRole('link', { name: 'N78501 aircraft' })).toBeNull();
    const tag = screen.getByText('N78501 aircraft');
    expect(tag.tagName).toBe('SPAN');
    expect(tag.getAttribute('data-chip')).toBe('text');

    fireEvent.click(tag);
    expect(ui!.aircraftReg).toBeNull();
    expect(ui!.tab).toBe('live');
  });

  it('a chip beside it that switches tab is still a link (the control)', () => {
    mount();
    const link = screen.getByRole('link', { name: 'ORD 81%' });
    expect(link.getAttribute('data-chip')).toBe('link');
    fireEvent.click(link);
    expect(ui!.tab).toBe('schedule');
  });
});
