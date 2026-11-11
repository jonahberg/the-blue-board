// @vitest-environment jsdom
/**
 * The airborne chip on the Live map (Nov 2026). Below 1081 px the airborne count and its 24-hour
 * graph were a 45 px row under the map; they are a map control beside the Key now, so the map
 * gets the row back.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AirborneChip } from '../src/app/views/live/StatsBar';

afterEach(cleanup);

describe('AirborneChip', () => {
  it('names the count and what it opens, and opens the graph', () => {
    let opened = 0;
    render(<AirborneChip airborne={645} history={null} onOpen={() => (opened += 1)} />);
    const chip = screen.getByRole('button', { name: 'United airborne: 645. Open the 24-hour graph' });
    expect(chip.getAttribute('aria-haspopup')).toBe('dialog');
    expect(chip.textContent).toContain('645');
    expect(chip.textContent).toContain('airborne');
    fireEvent.click(chip);
    expect(opened).toBe(1);
  });

  it('is a map control like the Key button: 36 px, a 44 px hit box, opaque', () => {
    render(<AirborneChip airborne={0} history={null} onOpen={() => {}} />);
    const chip = screen.getByRole('button', { name: 'United airborne: open the 24-hour graph' });
    expect(chip.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['relative', 'h-9', 'after:absolute', 'after:-inset-1', 'bg-background', 'dark:bg-background']),
    );
    expect(chip.textContent).toContain('—');
  });
});
