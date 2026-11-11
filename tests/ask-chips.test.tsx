// @vitest-environment jsdom
/**
 * The chip row a view shows while an answer is applied (src/app/features/AskChips.tsx). Pins: it
 * renders only for its own view; the count is the one the view passes (null = loading, never "no
 * match"); zero keeps the chips and says so; each chip removes its filter (and lets the view undo
 * its control first); removing the last chip or the row's clear button empties the answer; the
 * sentence is announced once through the page's one polite announcer.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiValue } from '../src/app/state/ui';
import { AskChips } from '../src/app/features/AskChips';
import { __peekAskStateForTests, __resetAskStateForTests, setAskResult } from '../src/app/state/ask';

const ui = vi.hoisted(() => ({ announce: vi.fn(), tab: 'live' }));
vi.mock('../src/app/state/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/ui')>()),
  useUi: () => ({ announce: ui.announce, tab: ui.tab }) as unknown as UiValue,
}));

beforeEach(() => {
  __resetAskStateForTests();
  ui.announce.mockReset();
});
afterEach(() => cleanup());

const live = () => setAskResult({ view: 'live', filters: { family: '787', starlink: true, region: 'europe' } }, 'rules');

describe('AskChips', () => {
  it('renders only for the view the answer is for', () => {
    live();
    render(<AskChips view="schedule" count={3} singular="arrival" />);
    expect(screen.queryByTestId('ask-chips-schedule')).toBeNull();
  });

  it('shows the real count and one removable chip per filter, and announces once', () => {
    live();
    const { rerender } = render(<AskChips view="live" count={9} singular="flight" where="on the map" />);
    const row = screen.getByTestId('ask-chips-live');
    expect(row.textContent).toContain('Showing 9 flights on the map');
    const chips = screen.getAllByRole('button', { name: /^Remove filter: / });
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Remove filter: 787 family', 'Remove filter: Starlink', 'Remove filter: Atlantic & Europe',
    ]);
    expect(ui.announce).toHaveBeenCalledTimes(1);
    expect(ui.announce).toHaveBeenCalledWith('Showing 9 flights on the map. Filters: 787 family, Starlink, Atlantic & Europe.');
    rerender(<AskChips view="live" count={10} singular="flight" where="on the map" />);
    expect(ui.announce).toHaveBeenCalledTimes(1);
  });

  it('while loading it says so, and does not announce', () => {
    live();
    render(<AskChips view="live" count={null} singular="flight" where="on the map" />);
    expect(screen.getByTestId('ask-chips-live').textContent).toContain('Finding flights on the map…');
    expect(ui.announce).not.toHaveBeenCalled();
  });

  it('no match keeps the chips and says so', () => {
    live();
    render(<AskChips view="live" count={0} singular="flight" where="on the map" />);
    expect(screen.getByTestId('ask-chips-live').textContent).toContain('No flights on the map match these filters');
    expect(screen.getAllByRole('button', { name: /^Remove filter: / })).toHaveLength(3);
  });

  it('a chip removes its filter after the view undoes its control; the last one clears the answer', () => {
    live();
    const onRemove = vi.fn();
    render(<AskChips view="live" count={1} singular="flight" onRemove={onRemove} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Starlink' })); });
    expect(onRemove).toHaveBeenCalledWith('starlink');
    expect(__peekAskStateForTests().result?.filters).toEqual({ family: '787', region: 'europe' });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Remove filter: 787 family' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Atlantic & Europe' })); });
    expect(__peekAskStateForTests().result).toBeNull();
    expect(screen.queryByTestId('ask-chips-live')).toBeNull();
  });

  it('the clear button empties the answer after the view undoes everything', () => {
    live();
    const onClear = vi.fn();
    render(<AskChips view="live" count={1} singular="flight" onClear={onClear} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Clear the filters from your question' })); });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(__peekAskStateForTests().result).toBeNull();
  });
});
