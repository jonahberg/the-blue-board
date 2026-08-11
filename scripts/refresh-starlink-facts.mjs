// Refreshes src/data/starlink-live.json from unitedstarlinktracker.com at the
// start of every build, so the public Starlink figure tracks reality at deploy
// cadence instead of being hand-synced (it sat at "425+" while the live count
// reached 513). Any failure — network, bad shape, implausible count — keeps the
// committed last-good values and NEVER fails the build.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { starlinkLabel, starlinkAsOf, isPlausibleStarlinkCount } from '../src/lib/starlink-facts.js';

const jsonPath = resolve('src/data/starlink-live.json');
const facts = JSON.parse(await readFile(jsonPath, 'utf8'));

try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  // fleet-summary, not /api/data: 2.6KB vs 976KB, pre-normalized, and the only
  // upstream endpoint that is cacheable (max-age=300).
  const resp = await fetch('https://unitedstarlinktracker.com/api/fleet-summary', {
    signal: controller.signal,
    headers: { 'User-Agent': 'BlueBoard-Build/1.0' },
  });
  clearTimeout(timeout);
  if (!resp.ok) throw new Error(`fleet-summary ${resp.status}`);

  const summary = await resp.json();
  const ua = (summary?.airlines ?? []).find((a) => a?.code === 'UA');
  const count = ua?.installed;
  if (!isPlausibleStarlinkCount(count, facts.live.count)) {
    throw new Error(`implausible count ${count} (committed ${facts.live.count})`);
  }

  facts.live = {
    count,
    label: starlinkLabel(count),
    asOf: starlinkAsOf(),
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(jsonPath, JSON.stringify(facts, null, 2) + '\n');
  console.log(`Starlink facts refreshed: ${count} equipped → "${facts.live.label}" (as of ${facts.live.asOf})`);
} catch (err) {
  console.warn(`Starlink facts refresh skipped (${err?.message ?? err}) — keeping committed: ${facts.live.count}`);
}
