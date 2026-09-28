// ═══ SCHEDULE BOARD ROW WINDOW ═══
// F56 (audit Sep 26 2026): a 640-row ORD board rendered every row — ~14.7k nodes in an auto-sized
// table — and each return to the Schedule tab re-ran style + layout for all of it (≈360-400 ms
// long task on an M-series Mac; the Dashboard keeps visited tabs mounted with display:none). The
// board now paints a window of rows around NOW and grows it on request, so the laid-out table is
// bounded no matter how busy the hub is. The stat strip, filters and search still run over the
// whole board (useBoardModel); only painting is windowed. Pure functions; indexes are into the
// full row list.

/** Rows kept above the anchor, so the viewer lands with a little context above NOW. */
export const WINDOW_BEFORE = 30;
/** Rows painted at first, and added per "show more". */
export const WINDOW_SIZE = 150;

/**
 * @param {number} total  rows on the board.
 * @param {number} anchor  index to open at (the first future row), or -1 for the top.
 * @returns {{start: number, end: number}}  half-open [start, end).
 */
export function initialWindow(total, anchor = -1) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (n <= WINDOW_SIZE) return { start: 0, end: n };
  const a = Number.isInteger(anchor) && anchor >= 0 && anchor < n ? anchor : 0;
  const start = Math.max(0, Math.min(a - WINDOW_BEFORE, n - WINDOW_SIZE));
  return { start, end: start + WINDOW_SIZE };
}

/** Clamp a window to a board whose row count changed underneath it. */
export function clampWindow(win, total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const start = Math.min(Math.max(0, win.start), n);
  const end = Math.min(Math.max(start, win.end), n);
  if (end - start === 0 && n > 0) return initialWindow(n, -1);
  return { start, end };
}

/**
 * @param {{start: number, end: number}} win
 * @param {number} total
 * @param {('earlier'|'later'|'all')} direction
 */
export function expandWindow(win, total, direction) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (direction === 'all') return { start: 0, end: n };
  if (direction === 'earlier') return { start: Math.max(0, win.start - WINDOW_SIZE), end: Math.min(win.end, n) };
  return { start: Math.min(win.start, n), end: Math.min(n, win.end + WINDOW_SIZE) };
}

/** The smallest growth of `win` that paints row `index` (with a few rows of context). */
export function windowIncluding(win, total, index) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (!Number.isInteger(index) || index < 0 || index >= n) return win;
  if (index >= win.start && index < win.end) return win;
  return {
    start: Math.max(0, Math.min(win.start, index - 10)),
    end: Math.min(n, Math.max(win.end, index + 11)),
  };
}
