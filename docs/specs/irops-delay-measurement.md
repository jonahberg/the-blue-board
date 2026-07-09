# Spec: the IROPS index measures taxi time, not delay

**Status:** proposed · **Date:** 2026-07-09 · **Owner action required:** decide fix order

## TL;DR

The disruption banner has read `SIGNIFICANT DISRUPTION` on **every single day with real data for the
last 30 days**. Score range 51.2 → 83.9, median ~62. `NORMAL OPERATIONS` (<5) and `MINOR DISRUPTION`
(5–15) are unreachable.

The thresholds are not the root cause. **`time.real.departure` is a runway (wheels-up) timestamp
compared against a scheduled *gate* departure, so every "delay" silently includes taxi-out.**
Recalibrating the thresholds on top of that would bake the error in permanently.

Fix the measurement first. Then re-derive thresholds from the corrected distribution.

## Evidence

### 1. The index never says anything but SIGNIFICANT

Computed from `schedule_snapshots` (departures boards, last write ≈37h after day start, so
near-final), using the shipped formula
`(cancel*3 + d60*2 + (d30-d60) + div*2) / total * 100`:

| day | total | cancelled | d30 | d60 | score | label |
|---|---|---|---|---|---|---|
| 2026-07-08 | 2847 | 142 | 979 | 367 | 62.2 | SIGNIFICANT |
| 2026-07-06 | 2965 | 175 | 1288 | 623 | 82.2 | SIGNIFICANT |
| 2026-07-02 | 3804 | 137 | 1472 | 488 | 62.3 | SIGNIFICANT |
| 2026-06-30 | 3644 | 116 | 1194 | 357 | 52.1 | SIGNIFICANT |
| 2026-06-27 | 3596 | 132 | 1129 | 319 | 51.3 | SIGNIFICANT |
| 2026-06-12 | 3898 | 203 | 1763 | 898 | 83.9 | SIGNIFICANT |

26 of 26 days with real data scored ≥ 51. (Four days — Jun 22–25 — scored 0.0 with zero delays and
zero cancellations; those are data outages, not calm days, and are excluded.)

A label that is always on carries no information.

### 2. The delay distribution is physically impossible

10,518 operated departures across 2026-06-30 → 07-02:

| percentile | delay |
|---|---|
| p10 | +10 min |
| p25 | +16 min |
| median | **+24 min** |
| p75 | +40 min |
| p90 | +66 min |

**Only 393 of 10,518 (3.7%) departed at or before scheduled time.** No airline operates that way.
United's real on-time performance is ~75–80% within 14 minutes of schedule.

### 3. The departure/arrival asymmetry proves it is taxi

Same three days, both directions:

| direction | n | p10 | median | p90 | at/before schedule |
|---|---|---|---|---|---|
| departures | 10,518 | +10 | **+24** | +66 | **3.7%** |
| arrivals | 10,490 | −38 | **−18** | +39 | **73.9%** |

Departures skew **late** by ~24 min; arrivals skew **early** by ~18 min. That is exactly what you
get when runway timestamps are compared to gate schedules:

- wheels-up occurs *after* pushback → departures inflated by taxi-out (~15–25 min at UA hubs)
- wheels-down occurs *before* the gate → arrivals deflated by taxi-in (~10–20 min)

Genuine gate-to-gate data would be roughly symmetric. This asymmetry cannot be explained by
operations; it is a units mismatch.

### 4. The code confirms it

`api/_schedule-aerodatabox.ts:228`

```ts
const realDep = departedLike ? (runwayDep || revisedDep) : null;  // runwayTime = wheels-up
const realArr = arrivedLike ? (runwayArr || revisedArr) : null;   // runwayTime = wheels-down
```

`runwayTime` is preferred over `revisedTime`. It is then compared against
`time.scheduled.departure`, which is the scheduled **gate** departure. DOT on-time performance —
the number every traveller has internalised — is measured at the gate.

## Blast radius

Everything downstream of `time.real.*` inherits the error:

| surface | effect |
|---|---|
| IROPS `score` + banner | permanently SIGNIFICANT |
| IROPS `delayed30` / `delayed60` | ~3× overstated |
| IROPS `worstDelays` | each entry ~20 min too large |
| Hub health OTP | understated (the 30-min grace absorbs some taxi, which is why it reads 49–89% instead of 4%) |
| Schedule board "→ 09:14 (+24m)" | tells a traveller their on-time flight was 24 min late |
| Schedule board arrivals "(−18m)" in green | tells a traveller they landed early when the aircraft has not reached the gate |
| `delay-explain` AI prompts | reasons about fabricated delays |

The Schedule-board rows are the most damaging: they are a specific, checkable claim about a
specific flight, and they are wrong by roughly one taxi.

## Proposed fix, in order

### Phase 1 — measure delay at the gate (do this first)

```ts
// revisedTime is the actual/updated GATE time; runwayTime is wheels-up/down.
// Scheduled times are gate times, so gate-vs-gate is the only coherent comparison.
const realDep = departedLike ? (revisedDep || runwayDep) : null;
const realArr = arrivedLike ? (revisedArr || runwayArr) : null;
```

**Before merging, verify with one raw AeroDataBox response** that `revisedTime` is populated for
departed flights at the account's data tier (`_source.quality` reads `"Basic"` on these rows).
If coverage is poor, the fallback to `runwayTime` must be *flagged* on the row — a taxi-inflated
delay silently mixed into gate-based ones is worse than either alone.

Guard with a test asserting the distribution invariant: on a normal day, ≥ 50% of operated
departures must be within 15 minutes of schedule. That single assertion would have caught this.

### Phase 2 — re-derive thresholds from the corrected data

Only after Phase 1. Recompute the 30-day score distribution and set cutoffs on percentiles rather
than on a hand-picked 5/15:

- `NORMAL` — below the 60th percentile of trailing-90-day scores
- `MINOR` — 60th to 90th
- `SIGNIFICANT` — above the 90th

This makes the label mean *"today is worse than most days"*, which is what a reader assumes it means,
and it self-corrects as United's baseline shifts. `schedule_snapshots` already holds 99 days of
history, so the backfill is a query, not a new pipeline.

### Phase 3 — `canceled_uncertain` weighting

`canceled_uncertain` is AeroDataBox's *"provider suspects a cancellation but has not confirmed it."*
The UI honestly renders it "Likely Canceled". The index then counts it at ×3, identical to a
confirmed cancellation.

Note the mapping changed around 2026-07-03: before, these rows arrived as hard `canceled`
(~3.7% of flights); after, as `canceled_uncertain` (~5–7%). So the ×3 weight is *historically*
consistent, but the rate also rose — worth understanding before changing the weight. Recommend
weighting uncertain cancellations at ×1.5 and surfacing them separately, but only once Phases 1–2
have removed the larger error.

## What not to do

Do not adjust the thresholds alone. The score is ~3× too high because the inputs are wrong; moving
the cutoff to match would enshrine a broken metric and would have to be undone the moment the delay
definition is corrected.

## Provenance

Root cause found 2026-07-09 while specifying a threshold recalibration. The denominator hypothesis
(score ratchets because it divides by the whole day's schedule) was investigated and **refuted**:
a due-flights denominator reads 100.0 at n=3 and goes SIGNIFICANT the previous evening; a 3-hour
rolling window reads 65 mid-evening. Neither fixes the label, because the numerator is inflated.
