/**
 * Vitest configuration.
 *
 * The suite ran with no config at all until provider-level React tests arrived. Two things
 * are needed and nothing else:
 *
 *  1. The `@/*` alias, so a `.tsx` under `src/app/` can be imported by a test exactly as the
 *     app imports it (`tsconfig.json` owns the same mapping for `tsc`).
 *  2. An explicit `environment: 'node'`, which is the DEFAULT and must stay that way — the
 *     2418 pre-existing tests are node tests and spinning jsdom up for all of them would cost
 *     seconds per file for nothing. The handful of React tests opt in per file with a
 *     `// @vitest-environment jsdom` docblock instead.
 *
 * `include` / `exclude` are deliberately left at Vitest's defaults, which is what the suite
 * has always run with.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
