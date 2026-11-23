// Nov 22 2026: "watch" means trouble that is network-wide, not one hub's ordinary bad afternoon.
// Over Nov 19–22 the brief read WATCH for 199 of 219 briefs (91%), 24 under a headline saying
// "normal". One rule (src/lib/ops-health.js networkStatus) now decides the header's "Some Delays"
// and, through the brief's `net.status` fact, the brief's tone; one hub's trouble is named in the
// headline, its item and its own chip, and no longer turns the banner amber.
//
// The owner's acceptance cases (tests/fixtures/watch-breadth-scenarios.js) run here end to end:
// payloads → facts → tone → the template headline, and the same payloads through what the hub
// strip computes (hub-health.js networkInputs → networkLabel), which must agree with the brief so
// the chip steps aside (network-chip.js).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildBriefFacts, computeTone, impairedHubs, materialKey } from '../src/lib/brief-facts.js';
import { buildBriefUserMessage } from '../src/lib/brief-prompt.js';
import { buildTemplateBrief, templateHeadline } from '../src/lib/brief-template.js';
import { impairedHubLeadReason, verifyBrief } from '../src/lib/brief-verify.js';
import { buildFaaIndex } from '../src/lib/faa-context.js';
import { HUB_ORDER, networkInputs, networkLabel } from '../src/lib/hub-health.js';
import { networkChipRepeatsBrief } from '../src/lib/network-chip.js';
import {
  HUB_IMPAIRING_FAA_DELAY_MIN, NETWORK_WATCH_INDEX_WITH_ONE_HUB, deriveOpsHealth, faaItemImpairsHub, hubImpairments,
  networkBreadthLevel, networkStatus,
} from '../src/lib/ops-health.js';
import { buildTickerItems } from '../src/lib/ticker.js';
import { CASES, program, scenario } from './fixtures/watch-breadth-scenarios.js';

const LEVEL_FOR_TONE = { calm: 'normal', watch: 'minor', disrupted: 'significant' };

/** The brief's side: the facts the cron would build from these payloads. */
const factsOf = ({ nowIso, sources }) => buildBriefFacts(sources, { nowMs: Date.parse(nowIso) }).facts;

/**
 * The hub strip's side, from the same payloads, exactly as HubHealthStrip.tsx computes it:
 * networkInputs over the /api/irops hubMetrics (the gated readings, the board days, the
 * cancellation rates), then networkLabel; the ticker reads the same inputs through deriveOpsHealth.
 */
function strip({ nowIso, sources }) {
  const nowMs = Date.parse(nowIso);
  const inputs = networkInputs({ hubMetrics: sources.irops.hubMetrics, faaIndex: buildFaaIndex(sources.faa), iropsScore: sources.irops.score, nowMs, hubCodes: HUB_ORDER });
  return { inputs, chip: networkLabel(inputs.hubOtps, inputs), ops: deriveOpsHealth(inputs), status: networkStatus(inputs) };
}

/** net.status's change key for a level and its impaired hubs (Nov 22 2026, review item 6). */
const statusKey = (level, hubs) => `status:${level}${hubs.length ? `:${[...hubs].sort().join(',')}` : ''}`;

/** The template headline each case produces (what the orchestrator will show the owner). */
const HEADLINES = {
  1: 'Newark is running behind; the other hubs are running normally.',
  2: 'Newark has a ground delay program; the other hubs are running normally.',
  3: 'Ground delay programs are holding flights into Newark and San Francisco.',
  '4a': 'A ground delay program is holding flights into Newark.',
  '4b': 'Newark has a ground delay program; the other hubs are running normally.',
  '5a': 'United is running smoothly right now.',
  '5b': "United's operation is disrupted right now.",
  6: 'United is running smoothly right now.',
  7: 'United is running smoothly right now.',
  8: 'Newark has a ground delay program; the other hubs are running normally.',
  9: 'A ground stop is holding flights into Newark.',
  10: 'Fewer United flights than usual are in the air right now.',
  '11a': "FAA delays are slowing Newark and Chicago O'Hare.",
  '11b': "Delays are building at Newark and Chicago O'Hare.",
};

describe('the owner’s acceptance cases (Nov 22 2026)', () => {
  for (const c of CASES) {
    describe(`case ${c.id}: ${c.about}`, () => {
      const payload = scenario(c.input);
      const facts = factsOf(payload);
      const tone = computeTone(facts);

      it(`is ${c.tone}, with ${c.impaired.length ? c.impaired.join(' and ') : 'no hub'} impaired`, () => {
        expect(tone).toBe(c.tone);
        expect([...impairedHubs(facts)].sort()).toEqual([...c.impaired].sort());
      });

      it('the brief’s network status, the strip’s chip and the brief’s tone agree, so the chip steps aside (case 12)', () => {
        const net = facts.find((f) => f.id === 'net.status');
        const { chip, status } = strip(payload);
        // Far fewer flights in the air (case 10) is the brief's own floor; the header never read it.
        const level = c.id === '10' ? 'normal' : LEVEL_FOR_TONE[tone];
        expect(net.material).toBe(statusKey(level, c.impaired));
        expect(chip.level).toBe(level);
        expect(Object.keys(status.impaired).sort()).toEqual([...c.impaired].sort());
        if (c.id !== '10') expect(networkChipRepeatsBrief({ briefTone: tone, networkLevel: chip.level })).toBe(true);
      });

      it(`the template headline: "${HEADLINES[c.id]}"`, () => {
        const template = buildTemplateBrief(facts);
        expect(template.tone).toBe(c.tone);
        expect(template.headline).toBe(HEADLINES[c.id]);
        // Every word of the template passes the production verifier, the headline included.
        const check = verifyBrief({ headline: template.headline, tone: template.tone, items: template.items, traveler_note: template.traveler_note }, facts);
        expect(check.report.dropped).toEqual([]);
        expect(check.report.headline.status).toBe('kept');
      });
    });
  }

  it('case 2, the one the owner may veto: calm, and the headline and the first item name Newark and its program', () => {
    const facts = factsOf(scenario(CASES.find((c) => c.id === '2').input));
    const template = buildTemplateBrief(facts);
    expect(template.tone).toBe('calm');
    expect(template.headline).toMatch(/Newark/);
    expect(template.headline).toMatch(/ground delay program/);
    expect(template.items[0].fact_ids).toEqual(['faa.active.EWR.gdp']);
    expect(template.items[0].text).toMatch(/delays average 105 minutes/);
    // A program holds flights into Newark: travelers bound there get the note, at any tone.
    expect(template.traveler_note?.text).toBe("If you are flying to Newark, check your flight's status before you leave for the airport.");
    // The model reads Newark's facts first, not "the hubs are fine" (orderFacts).
    const user = buildBriefUserMessage(facts, Date.parse(scenario().nowIso));
    expect(user.indexOf('"faa.active.EWR.gdp"')).toBeLessThan(user.indexOf('"otp.soft"'));
  });
});

describe('every fact that held a watch floor before Nov 22 2026 has a stated outcome', () => {
  const one = (input) => factsOf(scenario(input));
  const fact = (facts, id) => facts.find((f) => f.id === id);

  it('a hub delay program, a hub under 70% today and FAA delays from 45 minutes impair the hub and are calm on their own', () => {
    const facts = one({ otp: { EWR: 67 }, faa: { EWR: [program('ground_delay', { avgDelay: 60 })], ORD: [program('departure_delay', { minDelay: 46, maxDelay: 60 })], DEN: [program('arrival_delay', { minDelay: 45, maxDelay: 59 })] } });
    for (const [id, hub] of [['faa.active.EWR.gdp', 'EWR'], ['otp.EWR', 'EWR'], ['faa.active.ORD.dep', 'ORD'], ['faa.active.DEN.arr', 'DEN']]) {
      expect(fact(facts, id), id).toMatchObject({ toneFloor: 'calm', impairs: hub });
    }
    // Three hubs impaired: network-wide.
    expect(computeTone(facts)).toBe('watch');
  });

  it('FAA delays under 45 minutes, or with no lower bound, never impair a hub', () => {
    const facts = one({ faa: { ORD: [program('departure_delay', { minDelay: 31, maxDelay: 45 })], DEN: [program('arrival_delay', { maxDelay: 90 })], IAH: [program('departure_delay', { avgDelay: 75 })] } });
    for (const id of ['faa.active.ORD.dep', 'faa.active.DEN.arr', 'faa.active.IAH.dep']) {
      expect(fact(facts, id).toneFloor, id).toBe('calm');
      expect(fact(facts, id).impairs, id).toBeUndefined();
    }
    expect(computeTone(facts)).toBe('calm');
  });

  it('faa.active.count: watch for delay programs at two hubs, calm for one, disrupted for a stop (unchanged)', () => {
    expect(fact(one({ faa: { EWR: [program('ground_delay')] } }), 'faa.active.count').toneFloor).toBe('calm');
    expect(fact(one({ faa: { EWR: [program('ground_delay')], SFO: [program('ground_delay')] } }), 'faa.active.count').toneFloor).toBe('watch');
    expect(fact(one({ faa: { EWR: [program('ground_stop')], SFO: [program('ground_delay')] } }), 'faa.active.count').toneFloor).toBe('disrupted');
  });

  it('otp.soft: watch only for two or more hubs soft today; a yesterday reading never counts', () => {
    expect(fact(one({ otp: { EWR: 67 } }), 'otp.soft').toneFloor).toBe('calm');
    expect(fact(one({ otp: { EWR: 67, IAD: 66 } }), 'otp.soft').toneFloor).toBe('watch');
    const overnight = one({ nowIso: '2026-11-11T08:00:00Z', otp: { EWR: 62, IAD: 65 } });
    expect(fact(overnight, 'otp.soft').toneFloor).toBe('calm');
    expect(fact(overnight, 'otp.EWR').impairs).toBeUndefined();
  });

  it('net.index: the minor band alone is calm; 40 or more is still disrupted', () => {
    expect(fact(one({ score: 38 }), 'net.index')).toMatchObject({ toneFloor: 'calm', material: 'index:minor', score: 38 });
    expect(fact(one({ score: 40 }), 'net.index')).toMatchObject({ toneFloor: 'disrupted', material: 'index:significant' });
  });

  it('net.status follows the new level', () => {
    expect(fact(one({ score: 25 }), 'net.status')).toMatchObject({ toneFloor: 'calm', material: 'status:normal' });
    expect(fact(one({ score: 31, faa: { EWR: [program('ground_delay')] } }), 'net.status')).toMatchObject({ toneFloor: 'watch', material: 'status:minor:EWR' });
    // The impaired hubs are in the key (review item 6): calm with Newark impaired is not calm with none.
    expect(fact(one({ score: 22, faa: { EWR: [program('ground_delay')] } }), 'net.status')).toMatchObject({ toneFloor: 'calm', material: 'status:normal:EWR' });
  });

  it('cxl.<HUB>: 10% of today’s departures confirmed canceled impairs the hub; calm on its own; yesterday never', () => {
    const facts = one({ cxl: { IAH: { confirmed: 50 } } });
    expect(fact(facts, 'cxl.IAH')).toMatchObject({ toneFloor: 'calm', impairs: 'IAH' });
    expect(computeTone(facts)).toBe('calm');
    expect(computeTone(one({ cxl: { IAH: { confirmed: 50 } }, faa: { EWR: [program('ground_delay')] } }))).toBe('watch');
    expect(fact(one({ cxl: { IAH: { confirmed: 30 } } }), 'cxl.IAH').impairs).toBeUndefined();
    const overnight = one({ nowIso: '2026-11-11T08:00:00Z', cxl: { IAH: { confirmed: 50 } } });
    expect(fact(overnight, 'cxl.IAH').impairs).toBeUndefined();
  });

  it('possible programs and weather are calm; air.normal is unchanged', () => {
    const planned = one(CASES.find((c) => c.id === '6').input);
    expect(fact(planned, 'faa.planned.EWR')).toMatchObject({ toneFloor: 'calm', severity: 22 });
    expect(fact(planned, 'faa.planned.EWR').material).toMatch(/^planned:/);
    expect(fact(one({ airborne: 400 }), 'air.normal').toneFloor).toBe('watch');
    expect(fact(one({ airborne: 330 }), 'air.normal').toneFloor).toBe('disrupted');
  });
});

describe('the change key captures every tone change the rule makes (no material string changed)', () => {
  const key = (input) => {
    const facts = factsOf(scenario(input));
    return { tone: computeTone(facts), entries: JSON.parse(materialKey(facts)) };
  };
  /** The ids whose material differs between two keys. */
  const differing = (a, b) => {
    const am = new Map(a.entries);
    const bm = new Map(b.entries);
    return [...new Set([...am.keys(), ...bm.keys()])].filter((id) => am.get(id) !== bm.get(id)).sort();
  };
  const gdp = { EWR: [program('ground_delay', { avgDelay: 62 })] };

  it(`the index crossing ${NETWORK_WATCH_INDEX_WITH_ONE_HUB} beside one impaired hub: only net.status moves`, () => {
    const before = key({ score: 29, faa: gdp });
    const after = key({ score: 31, faa: gdp });
    expect([before.tone, after.tone]).toEqual(['calm', 'watch']);
    expect(differing(before, after)).toEqual(['net.status']);
  });

  it(`a second hub's FAA delays reaching ${HUB_IMPAIRING_FAA_DELAY_MIN} minutes: only net.status moves`, () => {
    const before = key({ faa: { ...gdp, IAH: [program('departure_delay', { minDelay: 44, maxDelay: 59 })] } });
    const after = key({ faa: { ...gdp, IAH: [program('departure_delay', { minDelay: 45, maxDelay: 59 })] } });
    expect([before.tone, after.tone]).toEqual(['calm', 'watch']);
    expect(differing(before, after)).toEqual(['net.status']);
  });

  it('a second hub’s cancellations crossing 10%: only net.status moves', () => {
    const before = key({ faa: gdp, cxl: { IAH: { confirmed: 44, total: 447 } } });
    const after = key({ faa: gdp, cxl: { IAH: { confirmed: 44, total: 430 } } });
    expect([before.tone, after.tone]).toEqual(['calm', 'watch']);
    expect(differing(before, after)).toEqual(['net.status']);
  });

  it('the index wandering inside its minor band with no hub impaired changes nothing', () => {
    expect(differing(key({ score: 21 }), key({ score: 38 }))).toEqual([]);
  });
});

describe('networkStatus: the shared rule', () => {
  const HUBS = HUB_ORDER;

  it('counts a hub once, whatever impairs it (a program and a soft reading at Newark are one hub)', () => {
    const status = networkStatus({ hubOtps: { EWR: 67, ORD: 90 }, faaIndex: { EWR: { programs: [{ type: 'ground_delay' }] } }, hubCodes: HUBS, iropsScore: 22 });
    expect(status.impaired).toEqual({ EWR: ['gdp', 'otp'] });
    expect(status.level).toBe('normal');
  });

  it('two impaired hubs, or one with the index at 30, is "Some Delays"; the average at 70% still is', () => {
    expect(networkStatus({ hubOtps: { EWR: 67, IAH: 68, ORD: 90, DEN: 92 }, hubCodes: HUBS, iropsScore: 5 }).level).toBe('minor');
    expect(networkStatus({ hubOtps: { EWR: 67, ORD: 90 }, hubCodes: HUBS, iropsScore: 30 }).level).toBe('minor');
    expect(networkStatus({ hubOtps: { EWR: 67, ORD: 90 }, hubCodes: HUBS, iropsScore: 29.9 }).level).toBe('normal');
    expect(networkStatus({ hubOtps: { EWR: 70, ORD: 70 }, hubCodes: HUBS, iropsScore: 5 }).level).toBe('minor');
  });

  it('never counts an airport that is not a United hub, a yesterday reading, or a short FAA delay', () => {
    const faaIndex = { LAS: { groundDelay: true }, SAN: { groundDelay: true }, ORD: { programs: [{ type: 'departure_delay', minDelay: 30, maxDelay: 44 }] } };
    const status = networkStatus({ hubOtps: { EWR: 60, IAD: 62, ORD: 90, DEN: 95 }, hubDayOffsets: { EWR: -1, IAD: -1 }, faaIndex, hubCodes: HUBS, iropsScore: 35 });
    expect(status.impaired).toEqual({});
    expect(status.level).toBe('normal');
  });

  it('the breadth rule on its own', () => {
    expect(networkBreadthLevel({ impairedHubs: 2 })).toBe('minor');
    expect(networkBreadthLevel({ impairedHubs: 1, iropsScore: 30 })).toBe('minor');
    expect(networkBreadthLevel({ impairedHubs: 1, iropsScore: 29.9 })).toBe('normal');
    expect(networkBreadthLevel({ impairedHubs: 0, iropsScore: 39 })).toBe('normal');
    expect(networkBreadthLevel({ impairedHubs: 0, avgOtp: 70 })).toBe('minor');
  });

  it('faaItemImpairsHub reads the reported lower bound', () => {
    expect(faaItemImpairsHub({ type: 'ground_delay' })).toBe(true);
    expect(faaItemImpairsHub({ type: 'departure_delay', minDelay: 45 })).toBe(true);
    expect(faaItemImpairsHub({ type: 'arrival_delay', minDelay: '46' })).toBe(true);
    expect(faaItemImpairsHub({ type: 'departure_delay', minDelay: 44, maxDelay: 90 })).toBe(false);
    expect(faaItemImpairsHub({ type: 'departure_delay', avgDelay: 90 })).toBe(false);
    expect(faaItemImpairsHub({ type: 'ground_stop' })).toBe(false);
    expect(hubImpairments({ faaIndex: { EWR: { groundDelay: true } }, hubCodes: ['EWR'] })).toEqual({ EWR: ['gdp'] });
  });
});

describe('the fallback ticker follows the same level', () => {
  it('one hub’s program: no advisory, and a plain line names it instead of "All systems normal"', () => {
    const { ops } = strip(scenario(CASES.find((c) => c.id === '2').input));
    expect(ops).toEqual({ level: 'normal', text: '', note: 'Ground delay program for flights into EWR (avg 105 min)' });
    const items = buildTickerItems({ opsHealth: ops, airborne: 600, total: 900, fleetCount: 0, starlinkCount: 0, squawks: [] });
    expect(items[0]).toEqual({ text: 'Ground delay program for flights into EWR (avg 105 min); other hubs normal — tracking 900 United flights', cls: 'info' });
    expect(items.some((i) => /All systems normal/.test(i.text))).toBe(false);
  });

  it('two hubs’ programs: the advisory, worded as before', () => {
    const { ops } = strip(scenario(CASES.find((c) => c.id === '3').input));
    expect(ops).toEqual({ level: 'advisory', text: 'Some delays: ground delay program for flights into EWR (avg 62 min)' });
  });

  it('two hubs’ long FAA delays, or one hub beside the index at 30, say which hubs', () => {
    expect(strip(scenario(CASES.find((c) => c.id === '11b').input)).ops.text).toBe('Some delays at ORD and EWR');
    expect(strip(scenario({ score: 31, otp: { EWR: 67 } })).ops.text).toBe('Some delays: EWR on-time 67% — IROPS 31/100');
  });
});

describe('the calm headline names the one impaired hub (brief-verify.js)', () => {
  const facts = factsOf(scenario(CASES.find((c) => c.id === '2').input));

  it('a calm headline that leaves Newark out, or calls the day smooth first, is replaced', () => {
    expect(impairedHubLeadReason('United is running smoothly right now.', 'calm', facts)).toBe('headline:misses_impaired_hub');
    expect(impairedHubLeadReason("United's hubs are running normally except Newark.", 'calm', facts)).toBe('headline:calm_before_impaired_hub');
    expect(impairedHubLeadReason('Newark is lagging under low clouds; the other hubs are running normally.', 'calm', facts)).toBeNull();
    expect(impairedHubLeadReason('A ground delay program is holding flights into Newark.', 'calm', facts)).toBeNull();
    const statement = facts.find((f) => f.id === 'faa.active.EWR.gdp').statement;
    const out = verifyBrief({ headline: 'United is running smoothly right now.', tone: 'calm', items: [{ text: statement, fact_ids: ['faa.active.EWR.gdp'] }], traveler_note: null }, facts);
    expect(out.report.headline).toMatchObject({ status: 'replaced', reasons: ['headline:misses_impaired_hub'] });
    expect(out.brief.headline).toBe(templateHeadline(facts).headline);
  });

  it('a calm brief with no impaired hub is untouched by the rule', () => {
    const quiet = factsOf(scenario());
    expect(impairedHubLeadReason('United is running smoothly right now.', 'calm', quiet)).toBeNull();
  });
});

describe('every brief fixture: the brief and the network status agree', () => {
  const DIR = new URL('./fixtures/brief/', import.meta.url);
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
    const fx = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'));
    it(`${fx.name}: net.status, the strip and the tone agree; a calm brief has at most one impaired hub`, () => {
      const facts = buildBriefFacts(fx.sources, { nowMs: Date.parse(fx.nowIso) }).facts;
      const tone = computeTone(facts);
      const net = facts.find((f) => f.id === 'net.status');
      const shortfall = facts.find((f) => f.id === 'air.normal' && f.toneFloor !== 'calm');
      // Far fewer flights in the air is the brief's own floor (the header never read it).
      if (!shortfall) expect(net.material).toBe(statusKey(LEVEL_FOR_TONE[tone], impairedHubs(facts)));
      if (tone === 'calm') expect(impairedHubs(facts).length).toBeLessThanOrEqual(1);
      // One set of gated readings on both sides (review item 1): the strip's level and impaired hubs
      // are the brief's, always.
      const { status } = strip(fx);
      expect(status.level).toBe(net.material.split(':')[1]);
      expect(Object.keys(status.impaired).sort()).toEqual([...impairedHubs(facts)].sort());
    });
  }
});
