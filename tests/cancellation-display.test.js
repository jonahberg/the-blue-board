import { describe, expect, it } from 'vitest';

import {
  IROPS_CANCELLATION_TOOLTIP,
  boardCanceledTitle,
  iropsCancellationNote,
  splitCancellations,
  unconfirmedFigure,
} from '../src/lib/cancellation-display.js';

// Nov 10 2026: the Delays tab read "53 CANCELLATIONS incl. 53 likely" beside NORMAL
// OPERATIONS, and ORD's board "14 CANCELED" on a 91%-on-time day. Every one was the provider's
// unconfirmed "Likely Canceled". A figure labelled canceled now means confirmed.

describe('splitCancellations', () => {
  it('headlines confirmed cancellations only (the Nov 10 IROPS payload: 53 of 53 unconfirmed)', () => {
    expect(splitCancellations(53, 53)).toEqual({ confirmed: 0, unconfirmed: 53, split: true });
  });

  it('keeps confirmed and unconfirmed apart when both are present', () => {
    expect(splitCancellations(20, 5)).toEqual({ confirmed: 15, unconfirmed: 5, split: true });
    expect(splitCancellations(3, 0)).toEqual({ confirmed: 3, unconfirmed: 0, split: true });
  });

  it('cannot call anything confirmed on a payload from before v1.12.0 (no unconfirmed count)', () => {
    expect(splitCancellations(12, undefined)).toEqual({ confirmed: 12, unconfirmed: null, split: false });
    expect(splitCancellations(12, null).split).toBe(false);
  });

  it('never goes negative when the parts disagree, and treats junk as missing', () => {
    expect(splitCancellations(2, 5)).toEqual({ confirmed: 0, unconfirmed: 2, split: true });
    expect(splitCancellations(null, 4)).toEqual({ confirmed: null, unconfirmed: 4, split: false });
    expect(splitCancellations('x', 1).confirmed).toBeNull();
    expect(splitCancellations(-3, 0).confirmed).toBeNull();
  });
});

describe('unconfirmedFigure', () => {
  it('is the quiet "+N unconfirmed" line, or nothing when there are none', () => {
    expect(unconfirmedFigure(splitCancellations(53, 53))).toBe('+53 unconfirmed');
    expect(unconfirmedFigure(splitCancellations(4, 0))).toBeNull();
  });

  it('warns instead of splitting when the source cannot split', () => {
    expect(unconfirmedFigure(splitCancellations(12, undefined))).toBe('may include unconfirmed');
  });
});

describe('iropsCancellationNote', () => {
  it('says what unconfirmed means, that the score counts them, and the seen-flying exclusion', () => {
    const note = iropsCancellationNote({ unconfirmed: 53, seenFlying: 15 });
    expect(note).toContain('Unconfirmed: 53 flights');
    // Bridges to the word the rows still use.
    expect(note).toContain('Likely Canceled');
    expect(note).toContain('The severity score counts them; the Canceled figure does not.');
    expect(note).toContain('15 more were listed as Likely Canceled but seen flying');
  });

  it('handles the singular and either half alone', () => {
    expect(iropsCancellationNote({ unconfirmed: 1, seenFlying: 0 })).toContain('Unconfirmed: 1 flight the');
    const seenOnly = iropsCancellationNote({ unconfirmed: 0, seenFlying: 1 });
    expect(seenOnly).toBe('1 more was listed as Likely Canceled but seen flying by the live feed, so it is not counted at all.');
    expect(iropsCancellationNote({ unconfirmed: 0, seenFlying: 0 })).toBeNull();
    expect(iropsCancellationNote({ unconfirmed: null, seenFlying: undefined })).toBeNull();
  });

  it('the tooltip keeps the score honest: confirmed in the figure, unconfirmed in the score', () => {
    expect(IROPS_CANCELLATION_TOOLTIP).toMatch(/Canceled counts confirmed cancellations only/);
    expect(IROPS_CANCELLATION_TOOLTIP).toMatch(/score also counts .*Likely Canceled/);
    expect(IROPS_CANCELLATION_TOOLTIP).toMatch(/except those the live flight feed saw flying/);
  });
});

describe('boardCanceledTitle', () => {
  it('names the confirmed count and bridges "unconfirmed" to the rows’ "Likely Canceled"', () => {
    const title = boardCanceledTitle(splitCancellations(14, 14));
    expect(title).toMatch(/^0 confirmed cancellations\. 14 more are unconfirmed/);
    expect(title).toContain('“Likely Canceled” (the word on their rows)');
  });

  it('stays short when nothing is unconfirmed', () => {
    expect(boardCanceledTitle(splitCancellations(1, 0))).toBe('1 confirmed cancellation.');
  });
});
