// The brief cron and the Enhanced Radar switch. With ENHANCED_RADAR_ENABLED unset (or anything but
// "1") no code path reaches the radio module or the paid client, even with a ground stop in effect at
// a covered hub. With it on, the radio facts join the brief and the report lands in `collection.radio`.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSupabase } from './fixtures/fake-supabase.js';

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(async () => null),
  collectRadioFacts: vi.fn(async () => ({ facts: [], report: { enabled: true, hubs: [] } })),
  fetchAirportStatus: vi.fn(async () => { throw new Error('the paid client must not be reached'); }),
}));
vi.mock('../api/_schedule-snapshots.js', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));
vi.mock('../api/_radio-status.js', () => ({ collectRadioFacts: mocks.collectRadioFacts }));
vi.mock('../api/_enhanced-radar.js', () => ({ fetchAirportStatus: mocks.fetchAirportStatus, isEnhancedRadarEnabled: () => process.env.ENHANCED_RADAR_ENABLED === '1' }));

import { runBriefCron } from '../api/cron/brief.js';
import { radioFactsFromStatus } from '../src/lib/brief-radio.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/brief/hub-ground-stop.json', import.meta.url), 'utf8'));
const EWR_STATUS = JSON.parse(readFileSync(new URL('./fixtures/enhanced-radar-airport-status-EWR.json', import.meta.url), 'utf8'));
const NOW = Date.parse(FX.nowIso);
const collect = async () => ({ ...FX.sources, errors: {} });
const generate = vi.fn(async () => ({ json: null, failure: 'model_error', detail: null, modelId: 'm', inputTokens: null, outputTokens: null, costUsd: 0, stopReason: null, elapsedMs: 1 }));

let db;
beforeEach(() => {
  db = fakeSupabase();
  mocks.getSupabaseAdmin.mockReset();
  mocks.getSupabaseAdmin.mockResolvedValue(db.client);
  mocks.collectRadioFacts.mockClear();
  mocks.fetchAirportStatus.mockClear();
  process.env.AI_GATEWAY_API_KEY = 'k';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => { throw new Error(`unexpected fetch ${url}`); });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ENHANCED_RADAR_ENABLED;
  delete process.env.AI_GATEWAY_API_KEY;
});

describe('Enhanced Radar switch', () => {
  for (const value of [undefined, '0', 'true', 'on', 'yes', ' 1']) {
    it(`ENHANCED_RADAR_ENABLED=${JSON.stringify(value)}: radio is unreachable, even with a hub ground stop in effect`, async () => {
      if (value !== undefined) process.env.ENHANCED_RADAR_ENABLED = value;
      const summary = await runBriefCron({ nowMs: NOW, collect, generate });
      expect(summary.status).toBe('published');
      expect(mocks.collectRadioFacts).not.toHaveBeenCalled();
      expect(mocks.fetchAirportStatus).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(summary).not.toHaveProperty('radio');
      expect(db.calls.some((c) => c.table === 'radio_airport_status')).toBe(false);
      expect(db.state.ops_briefs[0].facts.some((f) => f.kind === 'radio' || f.kind === 'flow')).toBe(false);
    });
  }

  it('ENHANCED_RADAR_ENABLED=1: radio facts join the brief and the report is stored', async () => {
    process.env.ENHANCED_RADAR_ENABLED = '1';
    const radio = radioFactsFromStatus('EWR', EWR_STATUS, { nowMs: Date.parse('2026-11-10T23:06:28Z') }).map((f) => (f.kind === 'radio' ? { ...f, at: FX.nowIso } : f));
    mocks.collectRadioFacts.mockResolvedValueOnce({ facts: radio, report: { enabled: true, hubs: [{ hub: 'EWR', action: 'reused' }] } });
    const summary = await runBriefCron({ nowMs: NOW, collect, generate });
    expect(mocks.collectRadioFacts).toHaveBeenCalledWith(FX.sources.faa, NOW);
    expect(summary.radio).toEqual({ enabled: true, hubs: [{ hub: 'EWR', action: 'reused' }] });
    const row = db.state.ops_briefs[0];
    expect(row.facts.map((f) => f.id)).toEqual(expect.arrayContaining(['flow.EWR.arrivals', 'radio.EWR.122599']));
    expect(row.collection.radio).toEqual({ enabled: true, hubs: [{ hub: 'EWR', action: 'reused' }] });
  });

  it('a radio failure never fails the brief', async () => {
    process.env.ENHANCED_RADAR_ENABLED = '1';
    mocks.collectRadioFacts.mockRejectedValueOnce(new Error('boom'));
    const summary = await runBriefCron({ nowMs: NOW, collect, generate });
    expect(summary.status).toBe('published');
    expect(db.state.ops_briefs[0].collection.radio).toEqual({ error: 'boom' });
  });
});
