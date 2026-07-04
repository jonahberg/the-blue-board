import { describe, it, expect } from 'vitest';
import { formatDelayMinutes, delayColorVar } from '../src/lib/delay-format.js';

describe('formatDelayMinutes', () => {
  it('formats sub-90-minute delays as +Nm', () => {
    expect(formatDelayMinutes(8)).toBe('+8m');
    expect(formatDelayMinutes(45)).toBe('+45m');
    expect(formatDelayMinutes(89)).toBe('+89m');
  });

  it('formats 90+ minute delays as +XhYYm with zero-padded minutes', () => {
    expect(formatDelayMinutes(90)).toBe('+1h30m');
    expect(formatDelayMinutes(140)).toBe('+2h20m'); // the live +140m case from the audit
    expect(formatDelayMinutes(125)).toBe('+2h05m');
    expect(formatDelayMinutes(180)).toBe('+3h00m');
  });

  it('formats early departures with a minus sign', () => {
    expect(formatDelayMinutes(-12)).toBe('−12m');
    expect(formatDelayMinutes(-95)).toBe('−1h35m');
  });

  it('handles zero and rounding', () => {
    expect(formatDelayMinutes(0)).toBe('+0m');
    expect(formatDelayMinutes(7.6)).toBe('+8m');
  });

  it('returns empty string for garbage input', () => {
    expect(formatDelayMinutes(null)).toBe('');
    expect(formatDelayMinutes(undefined)).toBe('');
    expect(formatDelayMinutes(NaN)).toBe('');
    expect(formatDelayMinutes('soon')).toBe('');
  });
});

describe('delayColorVar', () => {
  it('is green up to 15 minutes (and for early departures)', () => {
    expect(delayColorVar(-20)).toBe('var(--ua-green)');
    expect(delayColorVar(0)).toBe('var(--ua-green)');
    expect(delayColorVar(15)).toBe('var(--ua-green)');
  });

  it('is yellow for moderate delays (16-60m)', () => {
    expect(delayColorVar(16)).toBe('var(--ua-yellow)');
    expect(delayColorVar(60)).toBe('var(--ua-yellow)');
  });

  it('is red past an hour', () => {
    expect(delayColorVar(61)).toBe('var(--ua-red)');
    expect(delayColorVar(140)).toBe('var(--ua-red)');
  });

  it('defaults to green for unknown values (no false alarms)', () => {
    expect(delayColorVar(NaN)).toBe('var(--ua-green)');
  });
});
