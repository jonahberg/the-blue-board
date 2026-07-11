import { describe, expect, it } from 'vitest';
import { formatDelayExplainFAAStatus, getScheduleRiskContext, describeFaaProgram } from '../src/lib/delay-explain-context.js';

function makeFlight(origin, destination) {
  return {
    airport: {
      origin: { code: { iata: origin } },
      destination: { code: { iata: destination } },
    },
  };
}

describe('getScheduleRiskContext', () => {
  it('keeps arrivals aligned to the true departure airport', () => {
    expect(getScheduleRiskContext(makeFlight('LGA', 'ORD'), 'ORD', 'arrivals')).toEqual({
      origCode: 'LGA',
      destCode: 'ORD',
      depHub: 'LGA',
      arrHub: 'ORD',
    });
  });

  it('keeps departures aligned to the page hub as origin', () => {
    expect(getScheduleRiskContext(makeFlight('ORD', 'LGA'), 'ORD', 'departures')).toEqual({
      origCode: 'ORD',
      destCode: 'LGA',
      depHub: 'ORD',
      arrHub: 'LGA',
    });
  });
});

describe('formatDelayExplainFAAStatus', () => {
  it('preserves weather causes and delay windows for the explainer', () => {
    const faaDelayIndex = {
      LGA: {
        minDelay: '31',
        maxDelay: '45',
        delays: [{ type: 'departure_delay', reason: 'due to weather' }],
      },
      ORD: {
        minDelay: '31',
        maxDelay: '45',
        delays: [{ type: 'departure_delay', reason: 'due to thunderstorms' }],
      },
    };

    expect(formatDelayExplainFAAStatus('LGA', 'ORD', faaDelayIndex)).toBe(
      'LGA Departure delays (31-45m): due to weather · ORD Departure delays (31-45m): due to thunderstorms'
    );
  });

  it('dedupes repeated FAA rows', () => {
    const faaDelayIndex = {
      LGA: {
        minDelay: '31',
        maxDelay: '45',
        delays: [
          { type: 'departure_delay', reason: 'due to weather' },
          { type: 'departure_delay', reason: 'due to weather' },
        ],
      },
    };

    expect(formatDelayExplainFAAStatus('LGA', '', faaDelayIndex)).toBe('LGA Departure delays (31-45m): due to weather');
  });

  it('formats each program type when a hub runs multiple concurrent programs (programs[] path)', () => {
    // F074 regression guard: EWR simultaneously under a ground stop AND a departure-delay
    // program. Both must format properly (the departure window must not be dropped).
    const faaDelayIndex = {
      EWR: {
        programs: [
          { type: 'ground_stop', endTime: '1049Z', probabilityOfExtension: 'high', reason: 'thunderstorms' },
          { type: 'departure_delay', minDelay: 46, maxDelay: 180, trend: 'Increasing', reason: 'thunderstorms' },
        ],
      },
    };
    const out = formatDelayExplainFAAStatus('EWR', '', faaDelayIndex);
    expect(out).toContain('EWR Ground stop: thunderstorms (until 1049Z, ext: high)');
    expect(out).toContain('EWR Departure delays (46-180m): thunderstorms (↑ increasing)');
  });

  it('appends runway-config capacity context for the AI prompt', () => {
    const faaDelayIndex = {
      ORD: { runwayConfig: { arrivalRunways: '28L', departureRunways: '28R', arrivalRate: 20 } },
    };
    expect(formatDelayExplainFAAStatus('ORD', '', faaDelayIndex)).toBe('ORD config: 28L/28R, rate 20/hr');
  });

  it('appends de-icing context so the AI may cite it', () => {
    const faaDelayIndex = { ORD: { deicing: true } };
    expect(formatDelayExplainFAAStatus('ORD', '', faaDelayIndex)).toBe('De-icing active at ORD');
  });

  it('formats a legacy arrival_delay row with its delay window', () => {
    const faaDelayIndex = {
      ORD: { minDelay: '20', maxDelay: '40', delays: [{ type: 'arrival_delay', reason: 'volume' }] },
    };
    expect(formatDelayExplainFAAStatus('ORD', '', faaDelayIndex)).toBe('ORD Arrival delays (20-40m): volume');
  });

  it('formats a legacy closure row', () => {
    const faaDelayIndex = { ORD: { delays: [{ type: 'closure' }] } };
    expect(formatDelayExplainFAAStatus('ORD', '', faaDelayIndex)).toBe('ORD Airport closure');
  });
});

describe('describeFaaProgram (F074: shared program formatter)', () => {
  it('formats a ground stop with end time and extension probability', () => {
    const { label, window, extras } = describeFaaProgram({ type: 'ground_stop', endTime: '1049Z', probabilityOfExtension: 'high' });
    expect(label).toBe('Ground stop');
    expect(window).toBe('');
    expect(extras).toEqual(['until 1049Z', 'ext: high']);
  });

  it('formats a departure-delay program with its minute window and trend', () => {
    const { label, window, extras } = describeFaaProgram({ type: 'departure_delay', minDelay: 46, maxDelay: 180, trend: 'Increasing' });
    expect(label).toBe('Departure delays');
    expect(window).toBe(' (46-180m)');
    expect(extras).toEqual(['↑ increasing']);
  });

  it('formats a GDP with its average delay', () => {
    const { label, window } = describeFaaProgram({ type: 'ground_delay', avgDelay: 72 });
    expect(label).toBe('Ground delay program');
    expect(window).toBe(' (avg 72m)');
  });

  it('falls back to a generic Delay label for unknown types', () => {
    expect(describeFaaProgram({ type: 'mystery' }).label).toBe('Delay');
    expect(describeFaaProgram({}).label).toBe('Delay');
  });
});
