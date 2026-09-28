// The fleet database is a hand-maintained snapshot with no refresh job, so no page may call it
// "updated daily" — every description dates it with FLEET_DB_AS_OF instead (audit F86).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FLEET_DB_AS_OF } from '../src/data/facts.js';
import { FLEET_DB_AS_OF as FROM_UTILS } from '../src/lib/fleet-utils.js';
import { FLEET_SUMMARY } from '../src/lib/home-seo.js';

const ROOT = resolve(__dirname, '..');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(astro|tsx|ts|js)$/.test(name)) yield path;
  }
}

describe('fleet database freshness copy (F86)', () => {
  it('no page or component says the fleet data is "updated daily"', () => {
    const offenders = [];
    for (const path of walk(resolve(ROOT, 'src'))) {
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // The rule's own documentation quotes the phrase it forbids.
          if (/updated daily/i.test(line) && !/never "updated daily"/.test(line)) {
            offenders.push(`${relative(ROOT, path)}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('has one as-of date, shared by the dashboard and the SEO copy', () => {
    expect(FROM_UTILS).toBe(FLEET_DB_AS_OF);
    expect(FLEET_SUMMARY.body).toContain(`as of ${FLEET_DB_AS_OF}`);
  });
});
