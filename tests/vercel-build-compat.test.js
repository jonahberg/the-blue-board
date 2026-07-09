import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

// Regression guard for the silent production-deploy break of 2026-07-09.
//
// Upgrading `typescript` to ^7.0.2 passed every gate — `bun run test`, `tsc --noEmit`, and
// `bun run build` were all green, and the PR's Vercel check reported "pass" because its preview
// build was skipped by the Ignored Build Step. Production then failed to deploy for 11 hours:
//
//     Using TypeScript 7.0.2 (local user-provided)
//     Error: Cannot read properties of undefined (reading 'readFile')
//
// TypeScript 7 is the native port. Its package exports the CLI but not the legacy programmatic
// compiler API: `ts.sys`, `ts.createProgram` and friends are gone. `@vercel/node` compiles the
// api/*.ts functions and reads tsconfig via `ts.sys.readFile`, so it throws before a single
// function is built. Every published @vercel/node (checked through 5.8.22) still calls it.
//
// `tsc --noEmit` cannot catch this: the CLI works fine under TS7. Only the programmatic surface
// is missing. So this test guards the surface @vercel/node actually depends on.
//
// When @vercel/node gains TS7 support, delete this file in the same PR that bumps typescript.

describe('Vercel build compatibility', () => {
  it('the installed typescript exposes the programmatic API @vercel/node compiles with', () => {
    const ts = require('typescript');

    expect(ts.sys, `typescript@${ts.version} does not export ts.sys — @vercel/node calls ts.sys.readFile and the production build will fail`).toBeDefined();
    expect(typeof ts.sys.readFile).toBe('function');
    // The other legacy entry points @vercel/node and ts-node reach for.
    expect(typeof ts.createProgram).toBe('function');
  });

  it('package.json pins typescript to a major that still ships that API', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
    const range = pkg.devDependencies.typescript;
    const major = Number(range.replace(/^[^\d]*/, '').split('.')[0]);
    expect(
      major,
      `typescript ${range} — majors >= 7 drop ts.sys and break the Vercel Node builder`
    ).toBeLessThan(7);
  });
});
