// Lists public Buy Me a Coffee supporters who are not on the Supporters Wall yet.
//
//   bun scripts/supporters-diff.mjs
//
// Read-only: it prints names, it never edits src/data/supporters.js. Adding a name stays a
// reviewed, manual edit because a BMC display name is free text anyone can type. The wall sat
// frozen from Feb to Oct 2026 because nothing ever prompted the update — run this whenever a
// "became a supporter" email arrives (BMC's emails are not reliable, so also now and then).
//
// Source: BMC's public supporter feed for the `notjbg` page — the same data the public page
// renders. It only includes supporters who left their support public; private ones never appear
// here and must be checked in the BMC dashboard. Anonymous "Someone" entries are skipped.

import { SUPPORTERS } from '../src/data/supporters.js';

const FEED = 'https://app.buymeacoffee.com/api/creators/slug/notjbg/coffees';
const MAX_PAGES = 20;

const onWall = new Set(SUPPORTERS.map((name) => name.trim().toLowerCase()));
const missing = new Map();

for (let page = 1; page <= MAX_PAGES; page += 1) {
  const res = await fetch(`${FEED}?web=1&page=${page}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`BMC feed page ${page}: HTTP ${res.status}`);
  const body = await res.json();
  const rows = Array.isArray(body?.data) ? body.data : [];
  for (const row of rows) {
    const name = String(row?.profile_full_name ?? row?.supporter_name ?? '').trim();
    if (!name || name === 'Someone' || onWall.has(name.toLowerCase()) || missing.has(name)) continue;
    missing.set(name, {
      when: String(row?.support_created_on ?? '').slice(0, 10),
      type: row?.support_type ?? '',
      note: String(row?.support_note ?? '').replace(/\s+/g, ' ').slice(0, 80),
    });
  }
  if (!body?.links?.next || rows.length === 0) break;
}

if (missing.size === 0) {
  console.log(`Supporters Wall is up to date (${SUPPORTERS.length} names).`);
} else {
  console.log(`${missing.size} public supporter(s) not on the wall:\n`);
  for (const [name, { when, type, note }] of missing) {
    console.log(`  ${when}  ${JSON.stringify(name)}  ${type}${note ? `  — "${note}"` : ''}`);
  }
  console.log('\nAdd the ones you want to src/data/supporters.js, verbatim.');
}
