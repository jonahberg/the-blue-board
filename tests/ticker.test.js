import { describe, it, expect } from 'vitest';
import { buildTickerItems } from '../src/lib/ticker.js';

const DISCLAIMER = 'Unofficial — not affiliated with United Airlines · Data: AeroDataBox · FR24 · AWC · FAA';
const base = { opsHealth: { level: 'normal', text: '' }, airborne: 0, total: 0, fleetCount: 0, starlinkCount: 0, squawks: [] };

describe('buildTickerItems', () => {
  it('always ends with the attribution disclaimer', () => {
    const items = buildTickerItems(base);
    expect(items[items.length - 1]).toEqual({ text: DISCLAIMER, cls: 'disclaimer' });
  });

  it('leads with an ops-health advisory when the network is not normal', () => {
    const items = buildTickerItems({ ...base, opsHealth: { level: 'disrupted', text: 'Disrupted — ground stop at EWR' }, total: 400, airborne: 380 });
    expect(items[0]).toEqual({ text: '⚠️ Disrupted — ground stop at EWR', cls: 'advisory' });
  });

  it('reports airborne and fleet counts once data has loaded', () => {
    const items = buildTickerItems({ ...base, airborne: 380, total: 412, fleetCount: 1078, starlinkCount: 550 });
    const texts = items.map((i) => i.text);
    expect(texts).toContain('380 United flights airborne');
    expect(texts).toContain('Fleet: 1078 mainline aircraft');
    expect(texts).toContain('550 Starlink-equipped aircraft (incl. United Express)');
  });

  it('hides fleet counts until the fleet database loads — never "0 aircraft"', () => {
    const texts = buildTickerItems({ ...base, airborne: 380, total: 412, fleetCount: 0, starlinkCount: 0 }).map((i) => i.text);
    expect(texts).toContain('380 United flights airborne');
    expect(texts.some((t) => t.startsWith('Fleet:'))).toBe(false);
    expect(texts.some((t) => t.includes('Starlink-equipped'))).toBe(false);
  });

  it('adds one critical item per emergency squawk', () => {
    const items = buildTickerItems({
      ...base, airborne: 5, total: 6,
      squawks: [
        { text: '⚠️ EMERGENCY', callsign: 'UAL328', squawk: '7700' },
        { text: '⚠️ HIJACK', callsign: 'UAL12', squawk: '7500' },
      ],
    });
    const critical = items.filter((i) => i.cls === 'critical');
    expect(critical).toEqual([
      { text: '⚠️ EMERGENCY: UAL328 (7700)', cls: 'critical' },
      { text: '⚠️ HIJACK: UAL12 (7500)', cls: 'critical' },
    ]);
  });

  it('unshifts "all systems normal" only when every item is informational', () => {
    const calm = buildTickerItems({ ...base, airborne: 380, total: 412 });
    expect(calm[0]).toEqual({ text: '✅ All systems normal — tracking 412 United flights', cls: 'info' });

    const disrupted = buildTickerItems({ ...base, opsHealth: { level: 'disrupted', text: 'Disrupted' }, airborne: 380, total: 412 });
    expect(disrupted.some((i) => i.text.startsWith('✅'))).toBe(false);

    const emergency = buildTickerItems({ ...base, airborne: 5, total: 6, squawks: [{ text: '⚠️ EMERGENCY', callsign: 'UAL1', squawk: '7700' }] });
    expect(emergency.some((i) => i.text.startsWith('✅'))).toBe(false);
  });

  it('drops the flight count from the normal line when the feed is empty (edge case)', () => {
    const items = buildTickerItems(base);
    expect(items[0]).toEqual({ text: '✅ All systems normal', cls: 'info' });
    expect(items).toHaveLength(2); // normal line + disclaimer
  });

  it('escapes squawk callsigns before they reach the ticker (edge case)', () => {
    const items = buildTickerItems({ ...base, airborne: 1, total: 1, squawks: [{ text: '⚠️ EMERGENCY', callsign: 'UAL<script>', squawk: '7700' }] });
    expect(items.find((i) => i.cls === 'critical').text).toBe('⚠️ EMERGENCY: UAL&lt;script&gt; (7700)');
  });

  it('keeps the priority order: advisory, counts, squawks, disclaimer', () => {
    const items = buildTickerItems({
      ...base,
      opsHealth: { level: 'minor', text: 'Minor delays' },
      airborne: 380, total: 412, fleetCount: 1078, starlinkCount: 550,
      squawks: [{ text: '⚠️ EMERGENCY', callsign: 'UAL1', squawk: '7700' }],
    });
    expect(items.map((i) => i.cls)).toEqual(['advisory', 'info', 'info', 'info', 'critical', 'disclaimer']);
  });
});
