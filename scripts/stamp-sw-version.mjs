// Post-build step: replace the __BUILD_SHA__ placeholder in dist/sw.js with
// the actual commit SHA so each deploy gets a unique CACHE_VERSION. Forces
// service-worker invalidation on returning visitors when site code changes.
//
// Why: v1.5.6 changed CSP and moved inline scripts to external files. Returning
// users with cached pre-1.5.6 index.html silently broke (suspected cause of
// the Apr 23-26 visitor decline from ~95/day to ~50/day). Wiring CACHE_VERSION
// to the commit SHA prevents the bug class permanently.
//
// Vercel sets VERCEL_GIT_COMMIT_SHA on every deploy. Local builds without it
// fall through to 'v9-dev' (the helper handles the missing-SHA case).

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeCacheVersion, CACHE_VERSION_PLACEHOLDER } from './computeCacheVersion.mjs';

const distSwPath = resolve('dist/sw.js');

const sha = process.env.VERCEL_GIT_COMMIT_SHA;
const version = computeCacheVersion(sha);

const sw = await readFile(distSwPath, 'utf8');
if (!sw.includes(CACHE_VERSION_PLACEHOLDER)) {
  throw new Error(
    `Expected ${CACHE_VERSION_PLACEHOLDER} placeholder in dist/sw.js — ` +
    `did public/sw.js drift from the v9-__BUILD_SHA__ pattern?`
  );
}

const stamped = sw.replaceAll(CACHE_VERSION_PLACEHOLDER, version.replace('v9-', ''));
await writeFile(distSwPath, stamped);

console.log(`Stamped dist/sw.js with CACHE_VERSION=${version}`);
