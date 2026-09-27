import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The post-deploy smoke job must FAIL when the production deploy for the pushed commit failed.
// Before, it slept 150s and curled three URLs — which the PREVIOUS deploy answers with 200s, so
// a failed Vercel build (the 2026-07-09 silent-deploy outage) reported "smoke OK". The job now
// polls the GitHub Deployment Vercel records for $GITHUB_SHA (verified live: vercel[bot] creates
// Production deployments whose statuses are success / failure — the two 2026-07-09 builds are
// `failure`). These tests run the workflow's own bash with `gh` and `sleep` faked on PATH.

const WORKFLOW = readFileSync(resolve(__dirname, '..', '.github', 'workflows', 'post-deploy-smoke.yml'), 'utf8');

/** The `run: |` body of the step named `name`, dedented. */
function stepScript(name) {
  const lines = WORKFLOW.split('\n');
  const start = lines.findIndex((l) => l.includes(`- name: ${name}`));
  expect(start, `step "${name}"`).toBeGreaterThan(-1);
  const runAt = lines.findIndex((l, i) => i > start && /^\s+run: \|\s*$/.test(l));
  const indent = lines[runAt + 1].match(/^\s*/)[0].length;
  const body = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== '' && line.match(/^\s*/)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

const WAIT_STEP = "Wait for this commit's Vercel production deployment";

let bin;
beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'smoke-fake-bin-'));
  // Fake gh: the deployments list answers with $FAKE_ID (or nothing); each statuses call pops
  // the next state from $FAKE_STATES_FILE, repeating the last one.
  writeFileSync(join(bin, 'gh'), `#!/bin/bash
echo "$*" >> "$FAKE_LOG"
case "$*" in
  *"/statuses"*)
    states=$(cat "$FAKE_STATES_FILE")
    first=\${states%% *}
    rest=\${states#* }
    [ "$rest" != "$states" ] && echo "$rest" > "$FAKE_STATES_FILE"
    echo "$first" ;;
  *"/deployments?"*) [ -n "$FAKE_ID" ] && echo "$FAKE_ID"; exit 0 ;;
esac
`);
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n');
  chmodSync(join(bin, 'gh'), 0o755);
  chmodSync(join(bin, 'sleep'), 0o755);
});
afterAll(() => rmSync(bin, { recursive: true, force: true }));

function runWait({ id = '', states = 'pending' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-run-'));
  try {
    const statesFile = join(dir, 'states');
    const log = join(dir, 'log');
    writeFileSync(statesFile, states);
    writeFileSync(log, '');
    const result = spawnSync('bash', ['-e', '-c', stepScript(WAIT_STEP)], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        SHA: 'abc123',
        REPO: 'jonahberg/the-blue-board',
        FAKE_ID: id,
        FAKE_STATES_FILE: statesFile,
        FAKE_LOG: log,
      },
    });
    return { ...result, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('post-deploy smoke waits for THIS commit to go live', () => {
  it('no longer relies on a fixed sleep before curling', () => {
    expect(WORKFLOW).not.toMatch(/run:\s*sleep \d+/);
    expect(WORKFLOW).toMatch(/deployments:\s*read/);
  });

  it('passes once the deployment for the pushed sha reports success', () => {
    const r = runWait({ id: '42', states: 'pending pending success' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('is live');
    expect(r.calls[0]).toContain('deployments?sha=abc123&environment=Production');
  });

  it('FAILS when the Vercel production build failed (prod still serves the previous build)', () => {
    const r = runWait({ id: '42', states: 'pending failure' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("reported 'failure'");
  });

  it('fails on an error status too', () => {
    expect(runWait({ id: '42', states: 'error' }).status).toBe(1);
  });

  it('fails when no production deployment for the sha ever appears', () => {
    const r = runWait({ id: '' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('never went live');
    expect(r.calls.length).toBe(30);
  });

  it('fails when the deployment never leaves pending', () => {
    expect(runWait({ id: '42', states: 'pending' }).status).toBe(1);
  });

  it('treats inactive (succeeded, then superseded by a newer deploy) as shipped', () => {
    expect(runWait({ id: '42', states: 'inactive' }).status).toBe(0);
  });

  it('still curls the three load-bearing URLs after the deploy is confirmed', () => {
    const smoke = stepScript('Smoke-check production');
    expect(smoke).toContain('https://theblueboard.co/');
    expect(smoke).toContain('/api/starlink-data');
    expect(smoke).toContain('/api/schedule?hub=ORD');
  });
});
