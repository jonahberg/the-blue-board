import { describe, it, expect } from 'vitest';

import {
  FR24_STATUS_COLORS,
  formatFr24Time,
  fr24Attribution,
  fr24FailureMessage,
  fr24LegDisclaimer,
  fr24StatusColor,
  fr24StatusLabel,
  normalizeFr24Query,
} from '../src/lib/fr24-lookup.js';

describe('normalizeFr24Query', () => {
  it('assumes United for bare digits', () => {
    expect(normalizeFr24Query('123')).toBe('UA123');
    expect(normalizeFr24Query('1234')).toBe('UA1234');
  });

  it('folds the ICAO spelling to IATA', () => {
    expect(normalizeFr24Query('UAL123')).toBe('UA123');
    expect(normalizeFr24Query('ual 123')).toBe('UA123');
  });

  it('strips spaces and upper-cases', () => {
    expect(normalizeFr24Query(' ua 328 ')).toBe('UA328');
  });

  it('leaves an already-IATA number alone', () => {
    expect(normalizeFr24Query('UA328')).toBe('UA328');
  });

  it('does not mangle a tail number into a flight', () => {
    expect(normalizeFr24Query('N37502')).toBe('N37502');
  });

  it('handles nothing', () => {
    expect(normalizeFr24Query('')).toBe('');
    expect(normalizeFr24Query(null)).toBe('');
  });
});

describe('fr24 status presentation', () => {
  it('uses the shipped palette', () => {
    expect(fr24StatusColor('en-route')).toBe('#22c55e');
    expect(fr24StatusColor('on-ground')).toBe('#f59e0b');
    expect(fr24StatusColor('landed')).toBe('#3b82f6');
    expect(fr24StatusColor('scheduled')).toBe('#6b7280');
  });

  it('falls back to the unknown swatch', () => {
    expect(fr24StatusColor('something-new')).toBe(FR24_STATUS_COLORS.unknown);
    expect(fr24StatusColor(undefined)).toBe('#6b7280');
  });

  it('always spells the status out, so colour is never the only signal', () => {
    expect(fr24StatusLabel('en-route')).toBe('EN ROUTE');
    expect(fr24StatusLabel('on-ground')).toBe('ON GROUND');
    expect(fr24StatusLabel(undefined)).toBe('UNKNOWN');
  });
});

describe('fr24LegDisclaimer (F048)', () => {
  const fmt = (d) => d.toISOString().slice(0, 10);

  it('fires on the live-leg flag', () => {
    expect(fr24LegDisclaimer('summary', { liveLeg: true }, fmt).show).toBe(true);
  });

  it('fires when the source names the live tier', () => {
    expect(fr24LegDisclaimer('fr24-live', null, fmt).show).toBe(true);
  });

  it('stays quiet for a scheduled-tier answer', () => {
    expect(fr24LegDisclaimer('schedule-cache', { liveLeg: false }, fmt).show).toBe(false);
  });

  it('labels the leg date when there is one', () => {
    expect(fr24LegDisclaimer('live', { liveLeg: true, legDate: '2026-09-13' }, fmt).legDateLabel).toBe(
      '2026-09-13',
    );
  });

  it('omits an unparseable leg date rather than printing junk', () => {
    expect(fr24LegDisclaimer('live', { liveLeg: true, legDate: 'soon' }, fmt).legDateLabel).toBe('');
    expect(fr24LegDisclaimer('live', { liveLeg: true }, fmt).legDateLabel).toBe('');
  });

  it('always carries the multiple-legs sentence', () => {
    expect(fr24LegDisclaimer('live', { liveLeg: true }, fmt).text).toContain(
      'Flight numbers fly multiple legs daily',
    );
  });
});

describe('formatFr24Time', () => {
  it('accepts seconds-since-epoch and ISO alike', () => {
    const iso = formatFr24Time('2026-09-13T18:00:00Z');
    const epoch = formatFr24Time(Date.parse('2026-09-13T18:00:00Z') / 1000);
    expect(iso).toBe(epoch);
    expect(iso).toMatch(/\d{2}:\d{2}/);
  });

  it('shows an em dash for nothing', () => {
    expect(formatFr24Time(null)).toBe('—');
    expect(formatFr24Time(undefined)).toBe('—');
    expect(formatFr24Time('')).toBe('—');
  });

  it('shows the raw value rather than a dash when it cannot be parsed', () => {
    expect(formatFr24Time('sometime')).toBe('sometime');
  });
});

describe('footer and failure copy', () => {
  it('marks a cached answer', () => {
    expect(fr24Attribution(false)).toBe('Powered by Flightradar24 Official API');
    expect(fr24Attribution(true)).toBe('Powered by Flightradar24 Official API • cached');
  });

  it('names the query so repeat failures read as separate events', () => {
    expect(fr24FailureMessage('UA9999', null)).toContain('No data found for UA9999');
    expect(fr24FailureMessage('UA9999', null)).toContain('Check the Schedule tab');
  });

  it('prefers the server’s own message when there is one', () => {
    expect(fr24FailureMessage('UA9999', 'Rate limited')).toMatch(/^Rate limited —/);
  });
});
