# The Blue Board measures delay at the gate, not the runway

**Status:** fixed (Phase 1) · **Date:** 2026-07-09

## What was wrong

`api/_schedule-aerodatabox.ts` reported AeroDataBox's `runwayTime` as the actual departure:

```ts
const realDep = departedLike ? (runwayDep || revisedDep) : null;   // runwayTime = wheels-up
const realArr = arrivedLike ? (runwayArr || revisedArr) : null;    // runwayTime = wheels-down
```

`runwayTime` is the actual **runway** time. It was compared against `scheduledTime`, which is a
scheduled **gate** time. Mixing those units meant every reported delay silently carried taxi-out,
and every arrival was timestamped before the aircraft reached the gate. DOT on-time performance —
the number travellers have internalised — is measured at the gate.

The signature, over 10,518 operated departures and 10,490 arrivals (2026-06-30 → 07-02):

| direction | median | at/before schedule |
|---|---|---|
| departures | +24 min | 3.7% |
| arrivals | −18 min | 73.9% |

Departures late by a taxi, arrivals early by a taxi. Operations cannot produce that asymmetry.

## How it was verified before changing anything

The obvious fix — prefer `revisedTime` — was **not** safe on the evidence available. The vendor
documents `revisedTime` as "the revised departure time, *if any*". If it existed only for flights
whose schedule had been revised, swapping the preference would have left on-time flights
taxi-inflated while delayed ones became gate-based: a mixed distribution, worse than a uniformly
wrong one.

`schedule_snapshots` upserts by `cache_key` and keeps no intermediate states, so coverage could not
be recovered retroactively, and the one raw provider call that would settle it needs a credential
dump. So v1.7.6 shipped **instrumentation only** — `_source.timeSource` and `_source.gate`, with a
test pinning that behaviour did not change — and one hour of production traffic answered it.

## What the instrumentation showed (521 operated legs, live EWR + SFO, 2026-07-09)

| | departures (n=255) | arrivals (n=266) |
|---|---|---|
| gate time missing | **0** | **0** |
| `revisedTime == runwayTime` | **63.9%** | 4.9% |
| runway − gate (p50) | 0 min | −3 min |
| **gate time after runway time** | **0 rows** | — |
| gate vs scheduled (p50) | **+15 min** | −12 min |
| runway vs scheduled (p50) | +24 min | −17 min |
| at/before schedule — gate | **26.3%** | 72.2% |
| at/before schedule — runway | 2.4% | 78.2% |

Three conclusions, two of which corrected the original spec:

1. **`revisedTime` coverage is 100%.** The "if any" concern was unfounded.
2. **The gate time is never after the runway time** — 0 of 255 departures. Preferring it can only
   shrink a reported delay, never grow one. That safety property is what made the fix shippable.
3. **The original spec overstated the effect.** Where the two timestamps differ (92 of 255
   departures, 36%) the median gap is 26 min and p90 is 39 min — that is taxi, as predicted. But for
   **64% of departures the provider sets `revisedTime == runwayTime`**, so the fix corrects only a
   third of flights. Gate-based median departure delay is **+15 min, not ~0**: EWR and SFO at midday
   are genuinely late. The delay layer was not *entirely* taxi.

Measured effect on the sample: `delayed30` **85 → 53** (−38%), `delayed60` 20 → 18.

## The fix (shipped)

```ts
const realDep = departedLike ? (revisedDep || runwayDep) : null;
const realArr = arrivedLike ? (revisedArr || runwayArr) : null;
```

Plus `_source.timeSource.gateDistinctDep` / `gateDistinctArr`, true when the provider gave a gate
time that genuinely differs from the runway time. Those are the rows where `time.real.*` is honestly
gate-based. The other 64% remain taxi-inflated, and we cannot do better with this feed — but now we
can *tell*, instead of assuming.

## Update — 2026-10-03 (v1.12.0): Phases 2 and 3 shipped, on thin data

A calm Saturday (every hub 83–96% on-time, no FAA programs, zero confirmed cancellations) read
`SIGNIFICANT DISRUPTION`. Two causes, both fixed:

- **Phase 3, done differently than planned.** Rather than re-weighting `canceled_uncertain`, the
  serve-time sightings overlay (`src/lib/reg-overlay.js`) now rewrites a "Likely Canceled" row to
  departed when `reg_sightings.airborne_at` (`sql/016`; airborne sightings only, never ground)
  shows that flight airborne from that origin between 15 min before and 18 h after its scheduled
  departure. The numbers below used any sighting (`seen_at`), before the column existed. At 22:54Z on Oct 3, 38 of the 45 uncertain departures had been
  seen; at 23:25Z 44 of 55. The unseen remainder still counts ×3 and is reported separately
  (`cancellationsLikely`). The same rule reaches `/api/irops`, `/api/flight-times` (the watch cron)
  and the browser's own live-feed overlay.
- **Phase 2, hand-picked after all.** Bands moved from <5 / <15 to <20 / <40, approved by the owner
  on four days of full-day scores (seen-flying removed): Oct 3 ≈ 18, Sep 30 ≈ 23–27, Oct 2 ≈ 32–35,
  Oct 1 ≈ 34–38, against Jul 3's 56.7. That is not the trailing-90-day percentile derivation this
  spec asked for, and four ordinary days are a thin base. **Recheck after the first real weather
  day**; the percentile approach below is still the right long-term answer.

Known limits: `reg_sightings` keeps only the latest sighting per flight number, so on a past day's
board the override is a lower bound (yesterday's Express flight numbers fly again today and overwrite
their sightings). `airborne_at` has no backfill, so the override only covers flights seen airborne
after v1.12.0 deployed. A row's origin/dest come from its latest sighting, which can be a newer
ground sighting than the airborne time: a through flight whose late inbound leg was airborne inside
the window, and whose cancelled continuation was then seen at the gate, would pass (not observed).

## Still open

**Phase 2 — thresholds.** *(Interim bands shipped in v1.12.0 — see the update above.)* `score >= 15` renders `SIGNIFICANT DISRUPTION`. The index scored ≥ 51 on
26 of 26 days with real data (median ~62); `NORMAL` (<5) and `MINOR` (5–15) were unreachable. Phase 1
cuts the numerator materially but will not, on its own, make the label informative. Re-derive the
cutoffs from percentiles of the corrected trailing-90-day distribution — `schedule_snapshots` holds
99 days, so the backfill is a query, not a pipeline — so that the label means *"today is worse than
most days"* and self-corrects as United's baseline shifts.

Do **not** hand-pick new cutoffs. Wait for a week of gate-based data first.

**Phase 3 — `canceled_uncertain` weighting.** *(Seen-flying rows dropped in v1.12.0 — see above; the
×3 weight on unseen ones is unchanged.)* AeroDataBox's *"suspects a cancellation, has not
confirmed it"*. The UI honestly renders it "Likely Canceled"; the index counts it at ×3, identical to
a confirmed cancellation. The mapping changed around 2026-07-03: before, these arrived as hard
`canceled` (~3.7% of flights); after, as `canceled_uncertain` (~5–7%). Understand the rate change
before touching the weight.

**Consumers that should prefer `gateDistinct` rows.** Hub OTP, `delayed30`/`delayed60`, and
`worstDelays` still mix gate-based and runway-based rows. The project already has this pattern for
`_source.liveFeedFallback` and `_source.scheduleTimeDerivedFromActual`; the same exclusion belongs
here once a week of data shows how much it moves the numbers.

## Refuted along the way

The "ratcheting denominator" hypothesis — that the score climbs because it divides by the whole
day's schedule. A due-flights denominator reads 100.0 at n=3 flights and goes SIGNIFICANT the
previous evening; a 3-hour rolling window reads 65 mid-evening. Neither fixes the label, because the
numerator was inflated. Recorded so nobody re-derives it.
