# Trackers — Monthly Maintenance

The `/trackers` pages only work if updating them stays trivial. Target: **≤15 minutes per
tracker per month**. Everything renders from two data files — edit those, and the stats, map,
table, search, and changelog all update at build time. No UI code should ever need touching for
a data update.

```
src/data/trackers/atc.js          ← Modern Skies Tracker data (89 airports)
src/data/trackers/united-hubs.js  ← United Hub Tracker data (hubs + projects)
src/data/trackers/index.js        ← validate() — bad data fails the build on purpose
```

## The ritual (both trackers)

1. Skim the sources below for anything new since `lastUpdated`.
2. Edit the data file: flip statuses, add entries, adjust dates. **Every change needs a source
   URL in the entry's `sources`, and dates only get precision the source supports.**
3. Add a `changelog` entry (top of the array — it's reverse-chronological and validated).
4. Bump `lastUpdated`.
5. `bun run test && bun run typecheck && bun run build` — the validators catch shape mistakes,
   ordering mistakes, and status/date incoherence.
6. If a **headline stat** changed (see "Stats that live outside the data files" below), refresh
   the OG images.

## Modern Skies Tracker (`atc.js`) — sources to check

| Source | What it gives you | Trust |
|---|---|---|
| [modernskies.faa.gov](https://modernskies.faa.gov) (search by airport code) | Per-airport TFDM status | **Pointer only.** Its answers are AI-generated per query, it omits ~10 program airports entirely, lags go-lives by weeks, and can't distinguish scheduled from descoped-restored. Never edit on its word alone. |
| [Leidos newsroom](https://www.leidos.com/insights) + investors.leidos.com | Go-live press releases (the usual first confirmation) | Good for THAT an airport went live; attribute its stats (the "45% faster" class of claim) rather than asserting them. |
| [FedScoop](https://fedscoop.com) (Lindsey Wilkinson's FAA beat) | Go-lives with ordinals + program context | Best recurring trade coverage. |
| FAA newsroom + local TV in the airport's market | Event-dated confirmations (the DCA/AUS pattern) | Use for exact dates. |
| DOT OIG / GAO | Audits — schedule and scope ground truth | The Aug-2023 waterfall (`plannedIoc`) comes from OIG AV2024031 and is FROZEN history; never "update" those dates. |

**When an airport goes live:** status → `"live"`, add `goLiveDate` ONLY if a source states the
date (else omit it — eight live airports legitimately have none), delete its `plannedIoc`, add
the event source URL, write a one-line `note` if the story earns one, changelog, `lastUpdated`.

**What NOT to do:** don't backfill `goLiveDate` from `plannedIoc`; don't sharpen "this summer"
into a month; don't trust a Leidos airport-count (they've contradicted the FAA's own count in
the same press release).

## United Hub Tracker (`united-hubs.js`) — sources to check

| Source | What it gives you |
|---|---|
| [United newsroom](https://united.mediaroom.com) | Openings, official announcements (the only thing that upgrades `rumored` → `announced`) |
| The Points Guy / One Mile at a Time / View From The Wing / Simple Flying | Openings, first looks, teases — and the slip-watch |
| Airport authorities: fly2houston, flydulles (MWAA), flychicago, panynj, flysfo/LAWA, flydenver | The `builder: "airport-authority"` projects — schedules and budgets |

**Status discipline (the page's credibility rests on this):**
- `open` needs an `openedDate`. `rumored` can't have a `targetDate` — the validator enforces both.
- An executive quote is `rumored` until United's newsroom or the airport authority commits.
- Keep `targetDate` in the source's own words ("fall 2026") — never invent precision.
- When a date slips, the slip goes in `details` — that history is the product.
- New project ids are `<hub>-<slug>` (validated) so table anchors and cross-links keep working.

## Stats that live outside the data files (the hand-sync list)

These are the only places headline numbers are hardcoded. When live counts / club math change:

1. `scripts/generate-og.py` — the tracker cards' sub lines ("18 towers off paper, 71 to go" /
   "3 flagship clubs & 36 new gates"). Edit, then regenerate:
   ```sh
   uv run --with pillow python3 scripts/generate-og.py
   # keep ONLY the og files you meant to change (the script re-renders everything):
   git status --porcelain public/og/ | awk '{print $2}' | grep -v <your-files> | xargs git checkout --
   ```
   (Fonts: the script needs a real TTF and now fails loudly if it can't find one — on macOS it
   uses Menlo; the old silent bitmap-font fallback produced illegible cards.)
2. `src/pages/trackers/united-hubs.astro` — `stats` array + the og:description ("3 flagship
   clubs and 36 new gates"). The ATC page's og:description derives from data automatically.
3. `unitedHubsMeta.stats` — the ~119k sq ft / 36 gates / 54k figures and their notes.

## Annual / occasional

- If the FAA changes the program's airport count from 89, update the deliberate pin in
  `tests/tracker-data.test.js` — that test failing is the system working.
- `plannedIoc` dates that pass without a go-live need no edit (the page already frames them as
  the FAA's stale 2023 sequencing), but a `note` on conspicuous ones (the BOS pattern) is good.
- New tracker? Copy the shape: data file + validate rules in `index.js` + page under
  `src/pages/trackers/` composing `src/components/trackers/*` + entries in: sitemap.xml.ts,
  buildMetadata.js (own lastmod paths incl. the data file!), vercel.json cache rule already
  covers `/trackers/*`, speed-insights test, ui-audit PAGES, llms.txt + llms-full.txt,
  generate-og.py, public/index.html navs, feed.xml. Budget a day, most of it data research.
