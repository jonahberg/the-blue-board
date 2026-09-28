import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

// Regression guard for the two production incidents caused by a bare JSON import reachable from
// an api/** function:
//
//   2026-06-01  api/starlink-data.ts imported ../public/data/starlink.json directly
//               → every request FUNCTION_INVOCATION_FAILED (PR #185 → hotfix #187).
//   2026-08-11  PR #242 added `import starlinkLive from './starlink-live.json'` to
//               src/data/facts.js. api/waitlist.ts imports facts.js, so every waitlist POST
//               500'd for a month (0 signups vs 13 the month before) before anyone noticed.
//
// package.json is "type":"module", so Vercel runs api/*.ts as native Node ESM, where
// `import x from './x.json'` throws ERR_IMPORT_ATTRIBUTE_MISSING at module load — before the
// handler runs, so nothing is logged as an application error. Nothing else catches it: vitest
// transforms JSON imports, tsc allows them (resolveJsonModule), and this project has no preview
// deploys (merge to main IS the production deploy).
//
// This test walks the static relative-import graph from every api/** entry point and fails on
// every specifier class that native Node ESM rejects at module load (all of them 500 every
// request before the handler runs, and none is caught by vitest, tsc or Vite):
//
//   - a `.json` import with no `with { type: 'json' }` attribute   → ERR_IMPORT_ATTRIBUTE_MISSING
//   - an extensionless relative import (`./x` for `./x.ts`)        → ERR_MODULE_NOT_FOUND
//   - a directory import (`./dir` for `./dir/index.ts`)             → ERR_UNSUPPORTED_DIR_IMPORT
//   - a `.ts` / `.tsx` specifier (the compiled file is `.js`)       → ERR_MODULE_NOT_FOUND
//   - the Vite/tsconfig `@/` alias (Node has no path mapping)       → ERR_MODULE_NOT_FOUND
//
// Type-only imports (`import type`, `export type`, or every named binding marked `type`) are
// erased by the TypeScript compile and never reach Node, so they are exempt. Third-party
// packages are not followed (they ship their own runtime contract). The lazy `createRequire`
// pattern in api/starlink-data.ts is invisible to this walk by design — that is the sanctioned
// fallback.

const ROOT = resolve(__dirname, '..');
const API_DIR = join(ROOT, 'api');

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:([^'"]*?)\s+from\s+)?['"]([^'"]+)['"]\s*(with\s*\{[^}]*\})?/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{\s*with\s*:\s*\{[^}]*\}\s*\})?\s*\)/g;

function listApiEntries(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listApiEntries(full));
    else if (/\.(ts|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Resolve a relative specifier the way Node ESM + @vercel/node's TS compile do: `./x.js` may be `./x.ts` on disk. */
function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base];
  if (/\.js$/.test(base)) candidates.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.mjs'));
  if (!/\.[a-z]+$/.test(base)) candidates.push(`${base}.ts`, `${base}.js`, `${base}.mjs`, join(base, 'index.ts'), join(base, 'index.js'));
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/** True when TypeScript erases the whole statement: `import type …`, `export type …`, `{ type A, type B }`. */
function isTypeOnly(clause) {
  if (!clause) return false;
  const c = clause.trim();
  if (/^type\s/.test(c)) return true;
  const braces = c.match(/^\{([^}]*)\}$/);
  if (!braces) return false;
  const names = braces[1].split(',').map((n) => n.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

function collectImports(file) {
  return collectImportsFromSource(readFileSync(file, 'utf8'));
}

function collectImportsFromSource(src) {
  const found = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    found.push({ spec: m[2], attributed: Boolean(m[3]), typeOnly: isTypeOnly(m[1]) });
  }
  for (const m of src.matchAll(DYNAMIC_IMPORT_RE)) {
    found.push({ spec: m[1], attributed: m[0].includes('with'), typeOnly: false });
  }
  return found;
}

/** Why Node ESM would reject this specifier at load, or null when it is fine. */
function esmProblem(fromFile, { spec, attributed, typeOnly }) {
  if (typeOnly) return null;
  if (spec.startsWith('@/')) return 'tsconfig/Vite `@/` alias; Node has no path mapping';
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // package specifier
  if (/\.json$/.test(spec)) return attributed ? null : "bare JSON import without with { type: 'json' }";
  if (/\.tsx?$/.test(spec)) return '.ts specifier; the deployed file is .js';
  if (!/\.(m?js|cjs)$/.test(spec)) {
    const base = resolve(dirname(fromFile), spec);
    if (existsSync(base) && statSync(base).isDirectory()) return 'directory import (ERR_UNSUPPORTED_DIR_IMPORT)';
    return 'extensionless relative import (ERR_MODULE_NOT_FOUND)';
  }
  return null;
}

/** Walk the relative import graph from `entry`; return Node-ESM load failures as "importer → specifier (why)". */
function findEsmLoadFailures(entry) {
  const seen = new Set();
  const offenders = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const imp of collectImports(file)) {
      const problem = esmProblem(file, imp);
      if (problem) offenders.push(`${file.replace(ROOT + '/', '')} → ${imp.spec} (${problem})`);
      if (!imp.spec.startsWith('.') || /\.json$/.test(imp.spec)) continue;
      const next = resolveRelative(file, imp.spec);
      if (next && !seen.has(next)) stack.push(next);
    }
  }
  return offenders;
}

/** Only the bare-JSON offenders, for the historical synthetic check below. */
function findBareJsonImports(entry) {
  return findEsmLoadFailures(entry)
    .filter((o) => o.includes('bare JSON'))
    .map((o) => o.replace(/ \(bare JSON.*\)$/, ''));
}

describe('api/** never reaches an import that native Node ESM rejects (Vercel)', () => {
  const entries = listApiEntries(API_DIR);

  it('finds the api entry points', () => {
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.some((f) => f.endsWith('/api/waitlist.ts'))).toBe(true);
  });

  for (const entry of entries) {
    const rel = entry.replace(ROOT + '/', '');
    it(`${rel} has no Node-ESM load failure anywhere in its import graph`, () => {
      const offenders = findEsmLoadFailures(entry);
      expect(
        offenders,
        `Import reachable from ${rel} that native Node ESM rejects at module load — on Vercel this 500s ` +
          `every request. For JSON use createRequire (see api/starlink-data.ts) or move the JSON-backed ` +
          `export out of the shared module (see src/data/starlink-facts.js); for relative imports write the ` +
          `runtime \`.js\` extension.\n  ${offenders.join('\n  ')}`,
      ).toEqual([]);
    });
  }

  it('the walker itself detects the Aug 2026 shape (facts.js → starlink-live.json) when reintroduced', () => {
    // Synthetic check: the walker must flag a bare JSON import two hops away from an api entry.
    const fixtureEntry = join(ROOT, 'src', 'data', 'starlink-facts.js');
    const offenders = findBareJsonImports(fixtureEntry);
    expect(offenders).toEqual(['src/data/starlink-facts.js → ./starlink-live.json']);
  });

  it('the walker flags each other load-failure class and exempts type-only imports', () => {
    const fake = join(API_DIR, 'fake-entry.ts');
    const problems = (source) =>
      collectImportsFromSource(source).map((imp) => esmProblem(fake, imp)).filter(Boolean);

    expect(problems("import { a } from './_cache';")).toEqual(['extensionless relative import (ERR_MODULE_NOT_FOUND)']);
    expect(problems("import { a } from './cron';")).toEqual(['directory import (ERR_UNSUPPORTED_DIR_IMPORT)']);
    expect(problems("import { a } from './_cache.ts';")).toEqual(['.ts specifier; the deployed file is .js']);
    expect(problems("import { a } from '@/lib/x.js';")).toEqual(['tsconfig/Vite `@/` alias; Node has no path mapping']);
    expect(problems("export { a } from '../src/lib/geo';")).toHaveLength(1);
    expect(problems("const m = await import('./_cache');")).toHaveLength(1);

    // No false positives: the runtime extension, packages, node: builtins and erased type imports.
    expect(problems([
      "import { a } from './_cache.js';",
      "import x from '@vercel/functions';",
      "import { readFileSync } from 'node:fs';",
      "import type { VercelRequest } from './types';",
      "import { type A, type B } from './types';",
      "export type { C } from './types';",
      "import data from './x.json' with { type: 'json' };",
    ].join('\n'))).toEqual([]);
  });
});

describe('middleware.ts import graph (defence in depth — it is esbuild-bundled today)', () => {
  it('has no Node-ESM load failure', () => {
    expect(findEsmLoadFailures(join(ROOT, 'middleware.ts'))).toEqual([]);
  });
});
