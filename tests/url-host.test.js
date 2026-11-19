import { describe, it, expect } from 'vitest';

import { hostOf, isHost } from './helpers/url-host.js';

describe('tests/helpers/url-host.js', () => {
  it('compares the parsed host, so a look-alike URL does not match', () => {
    expect(isHost('https://fr24api.flightradar24.com/api/x', 'fr24api.flightradar24.com')).toBe(true);
    expect(isHost('https://evil.example/?fr24api.flightradar24.com', 'fr24api.flightradar24.com')).toBe(false);
    expect(isHost('https://fr24api.flightradar24.com.evil.example/', 'fr24api.flightradar24.com')).toBe(false);
  });

  it('never throws on relative URLs, URL objects, Requests or nothing', () => {
    expect(hostOf('/api/flight-times?flight=UA1')).toBe('');
    expect(hostOf(undefined)).toBe('');
    expect(hostOf(42)).toBe('');
    expect(hostOf(new URL('https://NASSTATUS.faa.gov/api'))).toBe('nasstatus.faa.gov');
    expect(hostOf({ url: 'https://data-cloud.flightradar24.com/x' })).toBe('data-cloud.flightradar24.com');
  });
});
