import { describe, it, expect } from 'vitest';

import {
  STARLINK_LOW_DATA_OBSERVATIONS,
  STARLINK_MIN_PERCENT,
  starlinkPredictionBadge,
  starlinkPredictionDate,
} from '../src/lib/starlink-prediction.js';

describe('starlinkPredictionBadge — tail known (check-flight)', () => {
  it('renders the deterministic badge without a forecast caveat', () => {
    const badge = starlinkPredictionBadge(
      { probability: 0.95, n_observations: 1, confidence: 'verified' },
      { forecast: false },
    );
    expect(badge).toMatchObject({
      hidden: false,
      forecast: false,
      lowData: false,
      tone: 'good',
      text: '⚡ Starlink ~95%',
    });
    expect(badge.title).toContain('verified');
    expect(badge.text).not.toContain('low data');
  });

  it('bands at 75 and 40', () => {
    expect(starlinkPredictionBadge({ probability: 0.75 }, { forecast: false }).tone).toBe('good');
    expect(starlinkPredictionBadge({ probability: 0.74 }, { forecast: false }).tone).toBe('warn');
    expect(starlinkPredictionBadge({ probability: 0.4 }, { forecast: false }).tone).toBe('warn');
    expect(starlinkPredictionBadge({ probability: 0.39 }, { forecast: false }).tone).toBe('muted');
  });

  it('takes the forecast treatment anyway when the endpoint says "predicted"', () => {
    // check-flight answers `confidence: 'predicted'` when no tail is assigned yet.
    const badge = starlinkPredictionBadge(
      { probability: 0.8, n_observations: 12, confidence: 'predicted' },
      { forecast: false },
    );
    expect(badge.forecast).toBe(true);
    expect(badge.text).toBe('⚡ Starlink likely ~80%');
  });
});

describe('starlinkPredictionBadge — no tail yet (predict-flight)', () => {
  it('says "likely" so it never reads as a verification', () => {
    const badge = starlinkPredictionBadge(
      { probability: 0.68, n_observations: 12, confidence: 'high' },
      { forecast: true },
    );
    expect(badge).toMatchObject({ hidden: false, lowData: false, tone: 'warn' });
    expect(badge.text).toBe('⚡ Starlink likely ~68%');
    expect(badge.title).toContain('Statistical estimate from 12 past flights');
  });

  it('demotes a thin sample in WORDS, not just colour', () => {
    const badge = starlinkPredictionBadge(
      { probability: 0.9, n_observations: 2, confidence: 'high' },
      { forecast: true },
    );
    expect(badge.lowData).toBe(true);
    expect(badge.tone).toBe('muted');
    expect(badge.text).toBe('⚡ Starlink likely ~90% · low data');
  });

  it('demotes an explicitly low-confidence model however many observations', () => {
    const badge = starlinkPredictionBadge(
      { probability: 0.9, n_observations: 40, confidence: 'low' },
      { forecast: true },
    );
    expect(badge.lowData).toBe(true);
    expect(badge.text).toContain('low data');
  });

  it('uses the documented sample floor', () => {
    expect(STARLINK_LOW_DATA_OBSERVATIONS).toBe(3);
    expect(
      starlinkPredictionBadge({ probability: 0.9, n_observations: 3, confidence: 'high' }, { forecast: true })
        .lowData,
    ).toBe(false);
  });
});

describe('starlinkPredictionBadge — hiding', () => {
  it('hides a near-zero base rate rather than showing "~2%"', () => {
    expect(starlinkPredictionBadge({ probability: 0.02 }, { forecast: true }).hidden).toBe(true);
    expect(starlinkPredictionBadge({ probability: 0.04 }, { forecast: false }).hidden).toBe(true);
    expect(STARLINK_MIN_PERCENT).toBe(5);
  });

  it('shows exactly at the floor', () => {
    expect(starlinkPredictionBadge({ probability: 0.05 }, { forecast: true }).hidden).toBe(false);
  });

  it('hides when the model said nothing at all', () => {
    expect(starlinkPredictionBadge(null).hidden).toBe(true);
    expect(starlinkPredictionBadge({}).hidden).toBe(true);
    expect(starlinkPredictionBadge({ probability: undefined }).hidden).toBe(true);
  });
});

describe('starlinkPredictionDate', () => {
  it('is the LOCAL operational date, not UTC', () => {
    const date = new Date('2026-09-13T23:30:00Z');
    expect(starlinkPredictionDate(date)).toBe(date.toLocaleDateString('en-CA'));
    expect(starlinkPredictionDate(date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
