import { describe, it, expect } from 'vitest';
import { displayScheduleStatus, humanizeStatusText, looksRawStatusText } from '../src/lib/status-display.js';

describe('displayScheduleStatus', () => {
  it('renders key unknown as "Scheduled" with an as-of stamp flag', () => {
    const d = displayScheduleStatus({ text: 'Unknown', cls: 'unknown', key: 'unknown' });
    expect(d.text).toBe('Scheduled');
    expect(d.cls).toBe('scheduled');
    expect(d.asOf).toBe(true);
  });

  it('gives canceled_uncertain its proper Likely Canceled label + warn class', () => {
    const d = displayScheduleStatus({ text: 'Likely Canceled', label: 'Likely Canceled', cls: 'warn', key: 'canceled_uncertain' });
    expect(d.text).toBe('Likely Canceled');
    expect(d.cls).toBe('warn');
  });

  it('defends canceled_uncertain when the label/cls fields are missing (old cached payload)', () => {
    const d = displayScheduleStatus({ text: 'canceleduncertain', key: 'canceled_uncertain' });
    expect(d.text).toBe('Likely Canceled');
    expect(d.cls).toBe('warn');
  });

  it('flags presumed departures (from presumed OR legacy inferred)', () => {
    expect(displayScheduleStatus({ text: 'Departed', cls: 'departed', key: 'departed', presumed: true }).presumed).toBe(true);
    expect(displayScheduleStatus({ text: 'Departed', cls: 'departed', key: 'departed', inferred: true }).presumed).toBe(true);
    expect(displayScheduleStatus({ text: 'Departed', cls: 'departed', key: 'departed' }).presumed).toBe(false);
  });

  it('title-cases raw provider strings that leak through', () => {
    const d = displayScheduleStatus({ text: 'gate_hold', cls: 'delayed', key: 'delayed' });
    expect(d.text).toBe('Gate Hold');
  });

  it('leaves normal display text untouched', () => {
    const d = displayScheduleStatus({ text: 'En Route', cls: 'enroute', key: 'enroute' });
    expect(d.text).toBe('En Route');
  });

  it('degrades a null/absent classification to Scheduled + as-of', () => {
    const d = displayScheduleStatus(null);
    expect(d.text).toBe('Scheduled');
    expect(d.asOf).toBe(true);
  });
});

describe('humanizeStatusText', () => {
  it('splits underscores and camelCase and title-cases each word', () => {
    expect(humanizeStatusText('canceled_uncertain')).toBe('Canceled Uncertain');
    expect(humanizeStatusText('enRoute')).toBe('En Route');
    expect(humanizeStatusText('DELAYED')).toBe('Delayed');
  });
});

describe('looksRawStatusText', () => {
  it('flags machine tokens and passes display text', () => {
    expect(looksRawStatusText('canceled_uncertain')).toBe(true);
    expect(looksRawStatusText('gateHold')).toBe(true);
    expect(looksRawStatusText('Likely Canceled')).toBe(false);
    expect(looksRawStatusText('Departed')).toBe(false);
  });
});
