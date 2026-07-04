import { describe, it, expect } from 'vitest';
import { deriveOpsHealth, extractHubPrograms } from '../src/lib/ops-health.js';

const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];

describe('extractHubPrograms', () => {
  it('detects ground stops via the boolean flag and via delays[].type', () => {
    const faa = {
      EWR: { groundStop: true },
      ORD: { delays: [{ type: 'Ground Stop', avgDelay: 45 }] },
      DEN: { delays: [{ type: 'ground_stop' }] },
    };
    const programs = extractHubPrograms(faa, HUBS);
    expect(programs.map((p) => `${p.hub}:${p.kind}`).sort()).toEqual(['DEN:GS', 'EWR:GS', 'ORD:GS']);
  });

  it('detects GDPs and carries avgDelay', () => {
    const faa = { SFO: { delays: [{ type: 'Ground Delay Program', avgDelay: 72 }] } };
    expect(extractHubPrograms(faa, HUBS)).toEqual([{ hub: 'SFO', kind: 'GDP', avgDelay: 72 }]);
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
      faaIndex: { SFO: { delays: [{ type: 'Ground Delay Program', avgDelay: 72 }] } },
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

  it('degrades gracefully with no inputs at all (old cached payloads)', () => {
    expect(deriveOpsHealth({}).level).toBe('normal');
    expect(deriveOpsHealth().level).toBe('normal');
  });
});
