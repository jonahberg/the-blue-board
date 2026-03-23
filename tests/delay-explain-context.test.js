import { describe, expect, it } from 'vitest';
import { formatDelayExplainFAAStatus, getScheduleRiskContext } from '../src/lib/delay-explain-context.js';

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
});
