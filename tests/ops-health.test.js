import { describe, it, expect } from 'vitest';
import { buildFaaIndex } from '../src/lib/faa-context.js';
import { deriveOpsHealth, extractHubPrograms, hubProgramMarker, networkStatus } from '../src/lib/ops-health.js';
import { iropsScoreCls, iropsScoreLabel } from '../src/lib/irops-score.js';
import { serverFaaResponse } from './fixtures/faa-server-shape.js';

const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];

describe('extractHubPrograms', () => {
  it('detects ground stops via the boolean flag and via delays[].type', () => {
    const faa = {
      EWR: { groundStop: true },
      ORD: { delays: [{ type: 'ground_stop', avgDelay: 45 }] },
      DEN: { delays: [{ type: 'ground_stop' }] },
    };
    const programs = extractHubPrograms(faa, HUBS);
    expect(programs.map((p) => `${p.hub}:${p.kind}`).sort()).toEqual(['DEN:GS', 'EWR:GS', 'ORD:GS']);
  });

  it('detects GDPs from delays[].type and carries avgDelay', () => {
    // No groundDelay boolean here: the snake_case type alone must be enough.
    const faa = { SFO: { delays: [{ type: 'ground_delay', avgDelay: 72 }] } };
    expect(extractHubPrograms(faa, HUBS)).toEqual([{ hub: 'SFO', kind: 'GDP', avgDelay: 72 }]);
  });

  it('reads the real /api/faa response (EWR ground stop, LGA GDP avg 18)', async () => {
    const index = buildFaaIndex(await serverFaaResponse());
    expect(extractHubPrograms(index, ['EWR', 'LGA', 'BOS'])).toEqual([
      { hub: 'EWR', kind: 'GS', avgDelay: null },
      { hub: 'LGA', kind: 'GDP', avgDelay: 18 },
    ]);
  });

  it('ignores non-hub airports and malformed entries', () => {
    const faa = { ATL: { groundStop: true }, ORD: null, DEN: 'nope' };
    expect(extractHubPrograms(faa, HUBS)).toEqual([]);
    expect(extractHubPrograms(undefined, HUBS)).toEqual([]);
  });
});

describe('deriveOpsHealth', () => {
  it('is normal when hubs are healthy, no programs, and IROPS is quiet', () => {
    const h = deriveOpsHealth({ hubOtps: { ORD: 82, DEN: 91 }, faaIndex: {}, hubCodes: HUBS, iropsScore: 3.2 });
    expect(h.level).toBe('normal');
  });

  it('goes amber with the worst hub fact when any hub OTP < 50%', () => {
    const h = deriveOpsHealth({ hubOtps: { ORD: 42, DEN: 88, EWR: 61 }, faaIndex: {}, hubCodes: HUBS, iropsScore: 4 });
    expect(h.level).toBe('advisory');
    expect(h.text).toBe('Disrupted: ORD on-time 42%');
  });

  it('a ground stop at a UA hub always disrupts, even with healthy OTP', () => {
    const h = deriveOpsHealth({
      hubOtps: { ORD: 90 },
      faaIndex: { EWR: { groundStop: true } },
      hubCodes: HUBS,
      iropsScore: 2,
    });
    expect(h.level).toBe('advisory');
    expect(h.text).toBe('Disrupted: EWR ground stop');
  });

  it('a GDP at a UA hub disrupts with the avg delay fact', () => {
    const h = deriveOpsHealth({
      hubOtps: {},
      faaIndex: { SFO: { delays: [{ type: 'ground_delay', avgDelay: 72 }] } },
      hubCodes: HUBS,
      iropsScore: null,
    });
    expect(h.level).toBe('advisory');
    expect(h.text).toBe('Disrupted: SFO ground delay program (avg 72m)');
  });

  it('never reports normal when the IROPS index is red (>= 15)', () => {
    // The live contradiction: ticker green while IROPS showed 56.7 red.
    const h = deriveOpsHealth({ hubOtps: { ORD: 75 }, faaIndex: {}, hubCodes: HUBS, iropsScore: 56.7 });
    expect(h.level).toBe('advisory');
    expect(h.text).toBe('Elevated irregular ops — IROPS 56.7/100');
  });

  it('prefers the ground-stop fact over the OTP fact when both apply', () => {
    const h = deriveOpsHealth({
      hubOtps: { DEN: 38 },
      faaIndex: { ORD: { groundStop: true } },
      hubCodes: HUBS,
      iropsScore: 60,
    });
    expect(h.level).toBe('advisory');
    expect(h.text).toContain('ground stop');
  });

  it('does not say "all systems normal" while the IROPS panel says MINOR DISRUPTION', () => {
    const h = deriveOpsHealth({ hubOtps: { ORD: 88 }, faaIndex: {}, hubCodes: HUBS, iropsScore: 8.4 });
    expect(h.level).toBe('advisory');
    expect(h.text).toBe('Minor irregular ops — IROPS 8.4/100');
  });

  it('does not say "all systems normal" while the network chip says Some Delays', () => {
    const h = deriveOpsHealth({ hubOtps: { ORD: 62, DEN: 66 }, faaIndex: {}, hubCodes: HUBS, iropsScore: 2 });
    expect(h.level).toBe('advisory');
    expect(h.text).toBe('Some delays — hub on-time averaging 64%');
  });

  it('names a closure or departure-delay program the strip chip is flagging', () => {
    expect(deriveOpsHealth({ faaIndex: { SFO: { closure: true } }, hubCodes: HUBS, iropsScore: 30 }).text)
      .toBe('Disrupted: Airport closure at SFO');
    expect(deriveOpsHealth({ faaIndex: { EWR: { departureDelay: true } }, hubCodes: HUBS, iropsScore: 1 }).text)
      .toBe('Departure delays at EWR');
  });

  it('degrades gracefully with no inputs at all (old cached payloads)', () => {
    expect(deriveOpsHealth({}).level).toBe('normal');
    expect(deriveOpsHealth().level).toBe('normal');
  });
});

describe('hubProgramMarker (F046/F076: chip severity blends FAA programs)', () => {
  it('returns null when no program is active', () => {
    expect(hubProgramMarker({ EWR: {} }, 'EWR')).toBeNull();
    expect(hubProgramMarker({}, 'EWR')).toBeNull();
    expect(hubProgramMarker(undefined, 'EWR')).toBeNull();
    expect(hubProgramMarker({ EWR: null }, 'EWR')).toBeNull();
  });

  it('flags a ground stop as red with a color-independent marker', () => {
    const m = hubProgramMarker({ EWR: { groundStop: true } }, 'EWR');
    expect(m.severity).toBe('red');
    expect(m.marker).toBe('⛔');
  });

  it('detects a ground stop via programs[].type', () => {
    const m = hubProgramMarker({ EWR: { programs: [{ type: 'ground_stop' }] } }, 'EWR');
    expect(m.severity).toBe('red');
  });

  it('flags a GDP as amber', () => {
    const m = hubProgramMarker({ ORD: { groundDelay: true } }, 'ORD');
    expect(m.severity).toBe('amber');
    expect(m.marker).toBe('⚠');
  });

  it('flags a departure-delay program as amber (previously ignored by the chips)', () => {
    const m = hubProgramMarker({ EWR: { programs: [{ type: 'departure_delay', minDelay: 46, maxDelay: 180 }] } }, 'EWR');
    expect(m.severity).toBe('amber');
  });

  it('a ground stop outranks a co-listed departure delay (red beats amber)', () => {
    const m = hubProgramMarker({
      EWR: { programs: [{ type: 'departure_delay' }, { type: 'ground_stop', endTime: '1049Z' }] },
    }, 'EWR');
    expect(m.severity).toBe('red');
    expect(m.label).toBe('Ground stop');
  });

  it('closure is red', () => {
    expect(hubProgramMarker({ SFO: { closure: true } }, 'SFO').severity).toBe('red');
  });
});

describe('networkStatus — the one definition behind the strip chip, the ticker and the IROPS badge', () => {
  it('is normal only when every signal is quiet', () => {
    expect(networkStatus({ hubOtps: { ORD: 90, DEN: 85 }, hubCodes: HUBS, iropsScore: 2 }).level).toBe('normal');
  });

  it('tracks the IROPS panel band exactly: NORMAL / MINOR / SIGNIFICANT', () => {
    for (const score of [0, 4.9, 5, 14.9, 15, 35.3]) {
      const status = networkStatus({ hubOtps: { ORD: 95 }, hubCodes: HUBS, iropsScore: score });
      const expected = { low: 'normal', med: 'minor', high: 'significant' }[iropsScoreCls(score)];
      expect(status.level, `score ${score} (${iropsScoreLabel(score)})`).toBe(expected);
    }
  });

  it('takes the worst of on-time, FAA programs and IROPS', () => {
    const base = { hubCodes: HUBS, iropsScore: 2 };
    expect(networkStatus({ ...base, hubOtps: { ORD: 90, DEN: 45 } }).level).toBe('significant');
    expect(networkStatus({ ...base, hubOtps: { ORD: 90 }, faaIndex: { EWR: { groundStop: true } } }).level).toBe('significant');
    expect(networkStatus({ ...base, hubOtps: { ORD: 90 }, faaIndex: { SFO: { closure: true } } }).level).toBe('significant');
    expect(networkStatus({ ...base, hubOtps: { ORD: 90 }, faaIndex: { SFO: { groundDelay: true } } }).level).toBe('minor');
    expect(networkStatus({ ...base, hubOtps: { ORD: 65, DEN: 72 } }).level).toBe('minor');
  });

  it('maps each level to one severity, colour and label', () => {
    expect(networkStatus({ hubOtps: { ORD: 90 }, hubCodes: HUBS })).toMatchObject({ severity: 'green', label: 'Smooth Ops' });
    expect(networkStatus({ hubOtps: { ORD: 90 }, hubCodes: HUBS, iropsScore: 9 })).toMatchObject({ severity: 'amber', label: 'Some Delays' });
    expect(networkStatus({ hubOtps: { ORD: 90 }, hubCodes: HUBS, iropsScore: 20 })).toMatchObject({ severity: 'red', label: 'Disrupted' });
  });

  it('reports the network average when any hub has a reading, null otherwise', () => {
    expect(networkStatus({ hubOtps: { ORD: 90, DEN: 81 }, hubCodes: HUBS }).avg).toBe(86);
    expect(networkStatus({ hubCodes: HUBS }).avg).toBeNull();
  });
});
