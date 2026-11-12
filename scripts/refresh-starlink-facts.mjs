// Refreshes src/data/starlink-live.json at the start of every build, so the public Starlink figure
// tracks reality at deploy cadence instead of being hand-synced (it sat at "425+" while the live
// count reached 513). Any failure — network, bad shape, implausible count — keeps the committed
// last-good values and NEVER fails the build.
//
// Sources, in order (Nov 2026): unitedstarlinktracker.com itself; then the site's own
// /api/starlink-data?fields=roster, our 4-hourly sync's snapshot of the same tracker data, which
// keeps answering while the tracker is down (Nov 11 2026: Cloudflare 521 all day, and /fleet fell
// back to a 44-day-old committed 602); then the committed file. Every figure is dated by its
// source's own time, not the build's. The choice is src/lib/starlink-facts.js chooseStarlinkLive /
// chooseStarlinkRoster, which the tests pin.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chooseStarlinkLive, chooseStarlinkRoster } from '../src/lib/starlink-facts.js';
import { VERIFIED_STARLINK_OVERRIDES } from '../src/lib/starlink-overrides.js';

const jsonPath = resolve('src/data/starlink-live.json');
const facts = JSON.parse(await readFile(jsonPath, 'utf8'));

const TRACKER_SUMMARY_URL = 'https://unitedstarlinktracker.com/api/fleet-summary';
const TRACKER_DATA_URL = 'https://unitedstarlinktracker.com/api/data';
const SERVED_ROSTER_URL = 'https://theblueboard.co/api/starlink-data?fields=roster';

/** GET a JSON body within `timeoutMs`; throws with a short reason. */
async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'BlueBoard-Build/1.0' } });
    if (!resp.ok) throw new Error(`${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** The tracker or the snapshot, or null with the reason recorded. */
async function attempt(label, url, timeoutMs, reasons) {
  try {
    return await fetchJson(url, timeoutMs);
  } catch (err) {
    reasons.push(`${label} ${err?.name === 'AbortError' ? 'timeout' : err?.message ?? err}`);
    return null;
  }
}

// The snapshot is fetched at most once, and only when the tracker did not do.
let servedPromise = null;
const servedReasons = [];
const getServed = () => (servedPromise ??= attempt('snapshot', SERVED_ROSTER_URL, 15000, servedReasons));

const describeLive = (live) => `${live.count} equipped (${live.scope}) → "${live.label}", as of ${live.asOfDate.slice(0, 10)} from ${live.source}`;

// ── The headline count ──
try {
  const reasons = [];
  // fleet-summary, not /api/data: 2.6KB vs 976KB, pre-normalized, and cacheable (max-age=300).
  const summary = await attempt('fleet-summary', TRACKER_SUMMARY_URL, 8000, reasons);
  let live = chooseStarlinkLive({ summary, committedCount: facts.live.count });
  if (!live) {
    if (summary) reasons.push(`fleet-summary implausible (committed ${facts.live.count})`);
    live = chooseStarlinkLive({ served: await getServed(), committedCount: facts.live.count });
    reasons.push(...servedReasons);
  }
  if (live) {
    facts.live = live;
    await writeFile(jsonPath, JSON.stringify(facts, null, 2) + '\n');
    console.log(`Starlink facts refreshed: ${describeLive(live)}${reasons.length ? ` (${reasons.join('; ')})` : ''}`);
  } else {
    console.warn(`Starlink facts refresh skipped (${reasons.join('; ') || 'no plausible source'}) — keeping committed: ${facts.live.count}`);
  }
} catch (err) {
  console.warn(`Starlink facts refresh skipped (${err?.message ?? err}) — keeping committed: ${facts.live.count}`);
}

// ── The mainline roster (tail list) behind the per-type "N of the M" sentences on the fleet guide
// pages — joined to public/data/fleet.json by registration in src/data/starlink-facts.js — plus the
// Express counts the hub pages' "~N% of the combined fleet" divides by. Independently guarded: a
// failed or partial fetch keeps the committed roster and never fails the build. /api/data is the
// only tracker endpoint that lists tails (~1.3MB, build-time only).
try {
  const reasons = [];
  const committedLength = facts.roster?.tails?.length ?? 0;
  const upstream = await attempt('data', TRACKER_DATA_URL, 20000, reasons);
  let roster = chooseStarlinkRoster({ upstream, committedLength, overrides: VERIFIED_STARLINK_OVERRIDES });
  if (!roster) {
    if (upstream) reasons.push(`data implausible (committed ${committedLength} tails)`);
    roster = chooseStarlinkRoster({ served: await getServed(), committedLength, overrides: VERIFIED_STARLINK_OVERRIDES });
    for (const r of servedReasons) if (!reasons.includes(r)) reasons.push(r);
  }
  if (roster) {
    facts.roster = roster;
    await writeFile(jsonPath, JSON.stringify(facts, null, 2) + '\n');
    console.log(
      `Starlink roster refreshed: ${roster.tails.length} mainline tails, Express ${roster.express.installed}/${roster.express.total}, ` +
        `as of ${roster.syncedAt.slice(0, 10)} from ${roster.source}${reasons.length ? ` (${reasons.join('; ')})` : ''}`,
    );
  } else {
    console.warn(`Starlink roster refresh skipped (${reasons.join('; ') || 'no plausible source'}) — keeping committed: ${committedLength} tails`);
  }
} catch (err) {
  console.warn(`Starlink roster refresh skipped (${err?.message ?? err}) — keeping committed: ${facts.roster?.tails?.length ?? 0} tails`);
}
