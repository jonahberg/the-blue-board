import { describe, it, expect } from 'vitest';

import {
  WINDOW_BEFORE,
  WINDOW_SIZE,
  clampWindow,
  expandWindow,
  initialWindow,
  windowIncluding,
} from '../src/lib/schedule-window.js';

describe('schedule row window (F56)', () => {
  it('paints a small board in full', () => {
    expect(initialWindow(90, 40)).toEqual({ start: 0, end: 90 });
    expect(initialWindow(0, -1)).toEqual({ start: 0, end: 0 });
  });

  it('opens a 640-row board around NOW with context above it', () => {
    const win = initialWindow(640, 300);
    expect(win).toEqual({ start: 300 - WINDOW_BEFORE, end: 300 - WINDOW_BEFORE + WINDOW_SIZE });
  });

  it('opens at the top without an anchor and stays inside the board near the end', () => {
    expect(initialWindow(640, -1)).toEqual({ start: 0, end: WINDOW_SIZE });
    expect(initialWindow(640, 639)).toEqual({ start: 640 - WINDOW_SIZE, end: 640 });
  });

  it('grows earlier, later, and to everything', () => {
    const win = { start: 270, end: 420 };
    expect(expandWindow(win, 640, 'earlier')).toEqual({ start: 120, end: 420 });
    expect(expandWindow(win, 640, 'later')).toEqual({ start: 270, end: 570 });
    expect(expandWindow({ start: 0, end: 600 }, 640, 'later')).toEqual({ start: 0, end: 640 });
    expect(expandWindow(win, 640, 'all')).toEqual({ start: 0, end: 640 });
  });

  it('grows just enough to reveal a searched-for row', () => {
    const win = { start: 270, end: 420 };
    expect(windowIncluding(win, 640, 300)).toBe(win);
    expect(windowIncluding(win, 640, 12)).toEqual({ start: 2, end: 420 });
    expect(windowIncluding(win, 640, 600)).toEqual({ start: 270, end: 611 });
    expect(windowIncluding(win, 640, 999)).toBe(win);
  });

  it('clamps when the board shrinks under the window (a filter, a refresh)', () => {
    expect(clampWindow({ start: 270, end: 420 }, 300)).toEqual({ start: 270, end: 300 });
    expect(clampWindow({ start: 500, end: 650 }, 300)).toEqual({ start: 0, end: 150 });
  });
});
