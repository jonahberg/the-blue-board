// The offline modes of the brief eval harness (scripts/brief-eval.mjs): --requests prints exactly
// the request production would send, one JSON line per fixture and nothing else, and neither it nor
// --check calls the model even with a gateway key in the environment.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildBriefFacts } from '../src/lib/brief-facts.js';
import { BRIEF_SYSTEM_PROMPT, buildBriefUserMessage } from '../src/lib/brief-prompt.js';
import { radioFactsFromStatus } from '../src/lib/brief-radio.js';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'tests', 'fixtures', 'brief');
const FIXTURES = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')));
// A key that would make the default mode call the gateway: the offline modes must ignore it.
const env = { ...process.env, AI_GATEWAY_API_KEY: 'offline-test-key', AI_GATEWAY_BASE_URL: 'http://127.0.0.1:9' };
const run = (...args) => execFileSync(process.execPath, [resolve(ROOT, 'scripts', 'brief-eval.mjs'), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 30_000 });

describe('brief-eval --requests', () => {
  it('prints one {fixture, system, user} line per fixture, exactly as production builds it', () => {
    const lines = run('--requests').trim().split('\n');
    expect(lines).toHaveLength(FIXTURES.length);
    lines.forEach((line, i) => {
      const fx = FIXTURES[i];
      const nowMs = Date.parse(fx.nowIso);
      const radio = Object.entries(fx.radio || {}).flatMap(([hub, s]) => radioFactsFromStatus(hub, s, { nowMs }));
      const { facts } = buildBriefFacts({ ...fx.sources, extraFacts: radio }, { nowMs });
      const req = JSON.parse(line);
      expect(Object.keys(req)).toEqual(['fixture', 'system', 'user']);
      expect(req.fixture).toBe(fx.name);
      expect(req.system).toBe(BRIEF_SYSTEM_PROMPT);
      expect(req.user).toBe(buildBriefUserMessage(facts, nowMs));
    });
  });
});

describe('brief-eval --check', () => {
  it('runs a saved response through the read + verify path and prints the published brief', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'brief-eval-')), 'response.json');
    writeFileSync(file, JSON.stringify({
      headline: 'Low clouds are holding flights into San Francisco.',
      tone: 'disrupted',
      items: [
        { text: 'A ground delay program is holding flights into San Francisco until 12:59 PM PT; delays average 62 minutes.', fact_ids: ['faa.active.SFO.gdp'] },
        { text: "Chicago O'Hare is lowest at 88%.", fact_ids: ['otp.floor'] },
      ],
      traveler_note: { text: 'Flying to San Francisco? Check your flight before you leave.', fact_ids: ['faa.active.SFO.gdp'] },
    }));
    const out = JSON.parse(run('--check', 'sfo-gdp-morning', file, '--json'));
    expect(out.fixture).toBe('sfo-gdp-morning');
    expect(out.final).toEqual(expect.objectContaining({ source: 'model', templateReason: null }));
    expect(out.final.brief.tone).toBe('watch');
    expect(out.report.dropped).toEqual([expect.objectContaining({ index: 1, reasons: ["uncited_airport:Chicago O'Hare", 'number_not_in_facts:88%'] })]);
    expect(out.report.travelerNote.status).toBe('kept');
  });
});
