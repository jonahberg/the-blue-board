# The ops brief ("Right now")

**Status:** built, server (v1.24.0) and UI (v1.25.0) · **Date:** 2026-11-10 · **UI:** the row under the header on every tab, open in the Live sidebar at `lg`+, the brief sheet everywhere else (`shell/Ticker.tsx`, `features/BriefPanel.tsx`, `features/BriefSheet.tsx`; reads `GET /api/brief`)

A short written read of United's operation right now, shown to every visitor in the row under the
header (and open in full in the Live sidebar on a wide screen). Every sentence carries the facts it came from, so the UI can show each one as a chip that links
to the hub, row or filter behind it. The model writes the prose; code decides what it may say, checks
what it said, and writes the brief itself whenever the model can't.

```
United is running smoothly this afternoon.
- Every hub is at 85% on time or better.  [otp.floor]
- The FAA says ground stops are possible tonight at Newark until 9:00 PM ET and Boston until 7:30 PM ET. Neither is in effect.  [faa.planned.EWR] [faa.planned.BOS]
- 630 United flights are in the air, 280 of them with Starlink.  [air.starlink]
Written from 21 live facts and checked against them.
```

## Pipeline

| step | where | what |
|---|---|---|
| timer | `api/cron/brief.ts` (`*/10 * * * *`, maxDuration 90) | One generation serves every visitor. Nothing is generated per request. |
| collect | `api/_brief-collect.ts` | The site's own CDN-cached endpoints and one `airborne_samples` read. See [Zero new upstream spend](#zero-new-upstream-spend). |
| facts | `src/lib/brief-facts.js` | Payloads in, facts out. Pure; `nowMs` is passed in. |
| gate | cron | Nothing is published unless **both** `/api/irops` and `/api/faa` answered **and** at least 3 hubs carry an on-time reading (`BRIEF_MIN_HUB_READINGS`). A calm brief written without the FAA picture, or without on-time evidence, would be a lie. |
| skip | cron | sha256 of the jitter-rounded material facts. Same hash as the latest brief **and** that brief is under 60 min old → no new brief; the run stamps `checked_at` and stops. |
| generate | `api/_brief-model.ts` + `src/lib/brief-prompt.js` | Claude Haiku 5.5 through the Vercel AI Gateway, after the brief's own daily spend cap says yes. |
| verify | `src/lib/brief-verify.js` | Every claim checked against the cited facts. Failing items dropped. |
| fallback | `src/lib/brief-template.js` | Invalid JSON, a failed call, the cap, a switch, or no surviving item → the template brief, `source: 'template'`. |
| store | `api/_brief-store.ts` → `ops_briefs` | Brief, all facts, hash, tone, source, model, tokens, cost, verifier report, collection report. |
| serve | `api/brief.ts` | Latest brief plus only the facts it cites. CDN-cached 60 s. |
| retain | cron, once an hour | Briefs older than 90 days, deleted in primary-key batches (300 × 4 max per run). |

## Zero new upstream spend

The cron reads exactly what visitors and the existing crons already cause to be fetched, through the
same CDN cache entries:

| request | cache | upstream on a miss | metered? |
|---|---|---|---|
| `/api/irops` | `s-maxage=900` | `/api/schedule` ×9 with `officialFallback=0&providerFallback=0&scraperFallback=0` (the warm cron's own key) | **no**: `providerFallback=0` keeps AeroDataBox off (`api/schedule.ts` `allowProviderFallback`), `officialFallback=0` keeps the paid FR24 API off |
| `/api/faa`, `/api/nas` | `s-maxage=300` | `nasstatus.faa.gov` (free) | no |
| `/api/metar?ids=KEWR,KIAH,KORD,KDEN,KSFO,KLAX,KIAD,RJAA,PGUM` | `s-maxage=300`, warmed every 5 min by `refresh-metar` with this exact query | `aviationweather.gov` (free) | no |
| `/api/fr24-feed?airline=UAL` | `s-maxage=15` (the Live tab polls it every 30 s) | the free public FR24 feed | no |
| `/api/starlink-data?fields=roster` | the dashboard's boot fetch; kept 1 h per warm instance | Supabase snapshot / `unitedstarlinktracker.com` (free) | no |
| `/data/fleet.json` | static asset; kept 6 h per warm instance | none | no |
| Supabase `airborne_samples` | — | 7 primary-key range scans of ±10 min, ~2 rows each | no |

Every request sends `Accept: application/json`: every response varies on `Accept` (`vercel.json`), so
a different header is a different cache entry. No code path in the brief imports
`api/_schedule-aerodatabox.ts`, `api/_official-fr24.ts` or the scraper transport. The only new spend
is the model call itself, behind its own cap.

## Fact catalogue

Each fact is `{ id, kind, hub?, statement, values, at, link }` publicly, plus `severity` (0–100,
ordering), `toneFloor` and `material` (the hash input) internally. `values` lists every surface form a
sentence may use: numbers as printed (`"85%"`, `"630"`), clock times on the airport's own clock with a
zone (`"9:00 PM ET"`), airport codes and every name that stands for them (`"ORD"`, `"Chicago O'Hare"`,
`"O'Hare"`, `"Chicago"`), and cause words (`"thunderstorms"`, `"low clouds"`).

| id | kind | from | statement (example) | tone floor |
|---|---|---|---|---|
| `otp.<HUB>` | otp | `/api/irops` `hubMetrics`, `serverOtpFromMetrics()` (the hub strip's number) | Chicago O'Hare (ORD): 91% of departures so far today left within 30 minutes of schedule (410 departed). | <50% disrupted, <70% watch |
| `otp.min` | otp | same, only when the lowest hub is under 80% (`BRIEF_HEALTHY_HUB_OTP`): which healthy hub is lowest is not news | Of the 7 hubs with an on-time reading, Los Angeles (LAX) is lowest at 75%. | calm |
| `otp.floor` | otp | same, when no hub is under 70%; names the lowest hub only when it is under 80% (its `link` is that hub's board either way) | All 7 hubs with an on-time reading are at 85% or better. / … at 75% or better; Los Angeles is the lowest. | calm |
| `otp.soft` | otp | same, when some are | 2 of the 7 hubs with an on-time reading are under 70%: Houston (62%) and Newark (55%). | watch |
| `net.index` | network | `/api/irops` `score`, `IROPS_MINOR_AT`/`IROPS_SIGNIFICANT_AT` | The Blue Board's disruption index … is 17.3, in the normal range (under 20). | minor → watch, significant → disrupted |
| `net.status` | network | `networkStatus()` (`src/lib/ops-health.js`, the strip's chip) | … reads "Smooth Ops". | minor → watch, significant → disrupted |
| `cxl.confirmed` | cancellations | `cancellations − cancellationsLikely` | 6 departures on United's current hub boards are confirmed canceled. | calm |
| `cxl.unconfirmed` | cancellations | `cancellationsLikely`, `likelyCanceledSeenFlying` | The schedule provider marks 162 more hub departures as "likely canceled" without confirming them. That label is often wrong: 131 … were seen flying. | calm, severity 2 |
| `cxl.<HUB>` | cancellations | per hub, when ≥ 3 confirmed | Houston (IAH) has 12 confirmed cancellations among 447 departures on its current board. | ≥10% watch |
| `faa.active.<CODE>.gs` / `.gdp` | faa | `/api/faa` programs: hubs, plus other airports we can name and put on a clock (`AIRPORT_TZ`) | The FAA has a ground stop in effect for flights heading to Newark (EWR) until 8:30 PM ET, because of thunderstorms. Those flights are held at their departure airport. … (a stop or delay program holds flights **bound for** the airport, at the airports they leave from; that airport's own departures are not what it holds) | ground stop at a hub: disrupted; ground delay program at a hub: watch; elsewhere: watch |
| `faa.active.<HUB>.closure` | faa | hubs only, and only a whole-airport closure: nightly curfews (`DLY`, `HHMM-HHMM`), PPR/transient-GA restrictions and runway/taxiway-only NOTAMs are screened out (`isWholeAirportClosure`), also from the FAA index `networkStatus()` reads | The FAA lists Newark (EWR) as closed. | disrupted |
| `faa.active.<HUB>.dep` / `.arr` | faa | hubs only | The FAA reports departure delays of 31 to 45 minutes at Houston (IAH), because of thunderstorms. | watch |
| `faa.active.count` | faa | hub GS/GDP/closures | No FAA ground stop or ground delay program is in effect at any United hub. / 1 FAA program affects a United hub: a ground stop for flights into Newark. | a ground stop or closure at a hub, or ground delay programs at two or more hubs at once: disrupted; one hub's ground delay program: watch |
| `faa.active.other` | faa | non-hub GS/GDP | The FAA also has 1 program in effect at other airports: a ground stop for flights into Boston. | calm |
| `faa.planned.<CODE>` | faa_planned | `/api/nas` operations plan (`UNTIL`/`AFTER`/`HHMM-HHMM` Zulu, resolved to the nearest occurrence) | The FAA's operations plan says a ground stop or ground delay program is possible for flights into Newark (EWR) until 9:00 PM ET. It is not in effect. | hub: watch |
| `faa.planned.count` | faa_planned | same | The FAA's operations plan lists 2 possible or planned programs for later. None of them is in effect now. | calm |

A planned program at an airport that is **not** a United hub (and the count, when every planned program is one) has severity 0: it is the last fact the model reads and the template never picks it. Prompt rule 4 has the model put them last, in one item, or leave them out.
| `wx.<HUB>` | weather | `/api/metar`, `computeOpsImpact()`; only hubs whose impact is not normal and that have a condition to name (a caution from low cloud over mist or haze alone has none, and is skipped) | Newark (EWR) weather: low visibility, thunderstorms, heavy rain and wind gusting to 34 knots, enough to slow arrivals and departures. (caution: "which can cause minor delays"; severe: "enough to slow arrivals and departures significantly") | warning/severe → watch |
| `wx.summary` | weather | same | Weather is not affecting operations at any of the 9 United hubs with a current report. | calm |
| `air.total` | airborne | live feed, `isOnGround()` complement (the Live stat bar) | 630 United flights, including United Express, are in the air right now. | calm |
| `air.starlink` | airborne | live feed × Starlink roster × fleet match (`makeIsStarlinkFlight`'s rule) | 280 of the 630 United flights in the air have Starlink Wi-Fi. | calm |
| `air.normal` | airborne | `airborne_samples`, median of the same clock time on the previous 7 days (≥ 3 days needed) | The 702 United flights in the air are 11% fewer than usual for this time of day: … the median at this hour was 790. | calm |
| `flow.<HUB>.arrivals` / `.departures` | flow | Enhanced Radar `operations.flow` (from FAA data); [radio](#air-traffic-control-radio-enhanced-radar), off by default | Enhanced Radar, from FAA data, reports Newark (EWR) arrivals: a planned rate of 36 an hour, 26 landed in the last hour and 39 scheduled in the next hour, more than the planned rate allows. | calm |
| `flow.<HUB>.runways` | flow | Enhanced Radar `operations.runways` | Enhanced Radar reports Newark (EWR) landing on runway 22L and taking off from runway 22R. | calm |
| `radio.<HUB>.<id>` | radio | each Enhanced Radar `critical` / `notable` observation under 2 h old (max 3 per hub): time, the API's tags and runways as values; the **sanitized** title as `quote` only | Heard on Newark (EWR) air traffic control frequencies at 5:29 PM ET, in Enhanced Radar's model-written summary, which can contain mistakes: "GLS approach out of service". | calm (never sets the tone) |

**Floors and freshness.** A hub needs ≥ 25 operated departures (`BRIEF_MIN_OPERATED`, the client's
own floor) for any on-time fact, and its board must be under 3 h old; live boards run 1–2 h old, so the
strip's 60-min stale constant would drop most of them. Each fact's `at` carries the reading's own time.
Before 6 AM local a hub's board is still yesterday's, and its statement says "yesterday". METARs older
than 3 h are dropped. `collection.skipped` in the stored row lists every fact left out and why.

**Reconciliation.** A planned program at an airport that already has one in effect is dropped (the
active fact says it; a "possible" beside it would contradict it). The FAA's free text (NOTAMs,
closure reasons with phone numbers) never reaches a statement or a value: causes go through an
allowlist (`faaCausePhrase`), and anything not on it is left out.

## Verification

`verifyBrief(candidate, facts)`, deterministic, in `src/lib/brief-verify.js`, with the claim extractor
in `src/lib/brief-claims.js`. The same extractor reads both the sentence and the cited facts' `values`,
so "what a fact allows" and "what a sentence claims" are measured with one ruler.

1. **Shape.** Exactly `{ headline, tone, items, traveler_note }`, types checked, no extra keys. Fail →
   template (`invalid_shape`).
2. **Citations.** Every item cites at least one fact; every id exists (`unknown_fact_id:x`).
3. **Claims.** Every claim in the item must be allowed by the values of the facts **that item** cites:
   - clock times (`9:00 PM ET`, `9 p.m.`, `noon`, `0030Z`, `21:00`): same minute of day; a zone in
     the text must match the value's zone (`time_wrong_zone`); a time with no zone may match;
   - percentages (`85%`, `85 percent`) must match a percentage value; a bare number may repeat a
     percentage's figure, but a percentage is never built from a plain count;
   - numbers, digits or words (`630`, `1,204`, `17.3`, `seven`; "one" excluded as a pronoun);
     `hundreds` / `dozens` are ungroundable (`vague_quantity`);
   - flight numbers (`UA2809`, `United 2809`), runways (`22L`), fractions;
   - airports: any all-caps three-letter token not on a short acronym list (FAA, ATC, GDP, …), and every
     airport/city name in `src/lib/airports.js` plus hub synonyms; shared names (`Chicago`,
     `Washington`, `New York`, `Houston`, `Tokyo`) in the text pass when any airport they can mean is
     cited, but a shared name in a fact's values allows only that name (an EWR fact listing "New York"
     does not vouch for `LGA`);
   - causes (`thunderstorms`, `storms`, `wind`/`gusts`, `low clouds`, `fog`/`visibility`, `snow`, `ice`,
     `de-icing`, `rain`, `construction`, `heavy traffic`, `staffing`, `equipment`, `emergency`);
     `weather` passes when any weather cause is cited.
4. **Voice.** "we", "our", "us" → dropped (`first_person`). An item citing a `faa_planned` fact must
   hedge ("possible", "could", "not in effect", …) or it is dropped (`planned_not_hedged`). An item
   citing a `radio` fact must attribute it to what was heard ("tower", "controllers", "heard",
   "frequency", "crews", …) or it is dropped (`radio_not_attributed`): prompt rule 7, made checkable.
   A radio observation's own words may appear only as an **exact** double-quoted copy of the fact's
   sanitized `quote`, preceded in the same clause by a radio attribution ("tower", "approach",
   "ATC", "heard", "frequency"); only such a quote is exempt from the claim check. An altered or
   partial quote (`radio_quote_mismatch`), an unattributed one (`radio_quote_unattributed`) or an
   unbalanced quote mark drops the item. Markup or a URL drops any item (`markup_or_url`).
5. **Limits.** At most 4 items; the rest are dropped (`over_item_limit`).
6. **Headline.** Checked against the union of the **surviving** items' facts. Fails, or runs past 14
   words → replaced by the template headline (the report keeps the original). Over 12 words is a warning.
7. **Traveler note.** Checked like an item; kept only when an FAA ground stop or ground delay
   program is in effect at a United hub, or the final tone is `disrupted` (`travelerNoteAllowed` in
   `brief-facts.js`; the dashboard applies the same rule to the facts the brief cites, in
   `brief-view.js`). Otherwise dropped as `tone_is_<tone>`.
8. **Tone.** Computed from the facts: the most alarming `toneFloor`. It overrides the model's tone, and
   the report says so (`tone.overridden`). FAA programs at United hubs (since v1.25.1): a ground
   delay program at one hub is `watch`, matching the header's network chip ("Some Delays"); a ground
   stop or closure at a hub, or ground delay programs at two or more hubs at once, is `disrupted`, as
   is the network status at its worst level ("Disrupted"). A soft hub, a minor index, hub weather at
   warning or worse and a program away from the hubs stay `watch`.
9. **Style warnings** (not drops): jargon (`GDP`, `IFR`, …), exclamation marks, emoji.

If no item survives → template (`no_items_survived`). The report (items in, items dropped with
reasons, headline kept/replaced, traveler note, tone, warnings) is stored with every brief.

Text it rejects, from `tests/brief-verify.test.js`:

| item | cites | result |
|---|---|---|
| "Los Angeles is the low mark at 84%." | `otp.LAX` (85%) | dropped: `number_not_in_facts:84%` |
| "Los Angeles is at 85% and Denver is fine." | `otp.LAX` | dropped: `uncited_airport:Denver` |
| "A ground stop is possible at Newark until 10:00 PM ET." | `faa.planned.EWR` (9:00 PM ET) | dropped: `time_not_in_facts:10:00 PM ET` |
| "Houston is at 85%." | `otp.IAH` (85% belongs to another fact) | dropped: `number_not_in_facts:85%` |
| "Newark has a ground stop until 9:00 PM ET." | `faa.planned.EWR` | dropped: `planned_not_hedged` |
| headline "630 flights up, 85% on time." | items cite only `air.starlink` | headline replaced: `number_not_in_facts:85%` |

## The template brief

`buildTemplateBrief(facts)`: the tone from `computeTone`, then up to 3 items (calm) or 4: every
specific problem (severity ≥ 20, not an aggregate), then the fact that sets the tone when nothing
specific does (the disruption index on a day of unconfirmed cancellations, with the cancellation
split), then background (on-time spread, the FAA picture or a planned program, Starlink, weather).
Items are fact statements verbatim; headlines are fixed per tone and lead fact ("A ground stop is
holding flights into Newark.", "Running normally, with FAA action possible at Newark.", "United is
running smoothly right now."), never over 12 words. A template adds a traveler note whenever one is allowed (rule 7)
addressed by direction: "flying to" an airport under a stop or delay program, "to or from" a closed
one, "out of" a hub with a heavy on-time problem. Every fixture's template passes the
verifier (`tests/brief-template.test.js`); the cron re-checks the template it publishes and logs an
error if it ever fails.

## Change detection and staleness

`material` per fact is the story, not the reading (v1.25.1). A fact with `material: null` is left
out of the key entirely, id included, so it appearing or disappearing is not a change either:

| fact | material |
|---|---|
| `air.total`, `air.starlink` | none (`null`): the count moves all day |
| `air.normal` | usual / above / below (±10% of the 7-day median) |
| `net.index` | its band (normal / minor / significant), not the score |
| `otp.<HUB>` | none while at or above 80% (`BRIEF_HEALTHY_HUB_OTP`), so a healthy hub's reading moving, appearing or aging out is not a change; below 80%, rounded to 5 points |
| `otp.floor` | none while every hub is healthy; otherwise the floor rounded to 5. The hub count is never material |
| `otp.min` | the lowest hub and its reading rounded to 5 (built only below 80%) |
| `wx.<HUB>` | the level plus thunderstorms, snow, freezing precipitation and a wind band (30+, 40+ knots); which of low clouds, low visibility and fog a METAR names is not |
| everything else | unchanged: FAA programs by type, end time to 15 min, cause and average delay to 15 min; planned programs by window; cancellation bands (unconfirmed to 25, confirmed exact under 10 then 5/10); soft hubs; network status; radio and flow facts |

`tests/brief-facts.test.js` replays every difference that rewrote the ten briefs of the morning of
Nov 11 2026 (airborne 700 → 600, Starlink 300 → 250, the index 4 → 11, a healthy hub 100% → 95%, a
hub appearing at 100%, another aging out, the SFO fog wording) against that scenario
(`sfo-gdp-morning`) and pins the key unchanged; a new ground stop, a hub under 80%, a weather level
or hazard change and a band crossing still change it.

A run whose hash equals the latest brief's, with that brief under 60 minutes old, writes nothing but
`checked_at`. Exception: when the latest is a template caused by a transient model failure
(`model_error`, `model_timeout`, `model_rate_limited`), the next run retries.

Measured before v1.25.1 on the real Nov 9–10 2026 `airborne_samples` day (144 ten-minute runs, 151
to 726 in the air): the airborne count alone would have started 35 new briefs a day at 100-flight
buckets, against the 24 a day the hourly refresh guarantees anyway. With the count and healthy hubs
no longer material, a quiet day should run close to that hourly floor, plus one brief per real change.

**`stale` comes from `checked_at`, not `generated_at`** (a deviation from the original design, which
said "older than 30 minutes"): with a 60-minute reuse window, a calm brief that the cron re-confirms
every 10 minutes would otherwise read stale half the time. `stale` = no run has confirmed it for 30
minutes, which is the failure the flag exists to show (cron down, sources down, table broken).

## GET /api/brief

```
200 {
  brief: { headline, tone, items: [{ text, fact_ids }], traveler_note, source } | null,
  facts: [{ id, kind, hub?, statement, values, at, link }],   // only the facts the brief cites
  factCount, generatedAt, checkedAt, nextUpdateAt, stale,
  verified: { itemsIn, itemsKept } | null,                    // null for a template
  note?                                                       // "No brief yet." / "The brief is unavailable right now."
}
```

`Cache-Control: public, s-maxage=60, stale-while-revalidate=300` (30 s for the no-brief shape), a
30-second in-memory memo, `createRateLimiter('brief', 60)`, the same origin rule as the other public
endpoints, 405 for non-GET. It never 5xxes. `nextUpdateAt` is the next 10-minute cron boundary.

## Spend guard

`feature_spend_daily (feature, day, usd, calls, input_tokens, output_tokens)`, incremented atomically
by `increment_feature_spend()` (the `sql/009` shape), one row per feature per UTC day, so "ask" and
"flight-read" can each carry their own cap later. Before every call the cron reads today's `brief` row
and refuses when `spent + this call's worst case > BRIEF_DAILY_USD_CAP` (default $0.50). After the
call it books the actual cost from `usage`, or the worst case when a call timed out or the connection
dropped after it may have been billed; 4xx refusals book nothing. An unreadable counter fails closed
(template, `spend_unreadable`). SDK retries are off (`maxRetries: 0`): the next cron run is the retry.

## Costs

Claude Haiku 5.5 on the gateway: $0.10 / $0.50 per million input / output tokens (prompts ≤ 100K).
A request is ~1.7–3.2K input tokens (the fixtures: 19–34 facts); `max_tokens` is 2,000 at `effort:
low`. Worst case per call ≈ $0.0013; a typical call (~2.5K in, ~400 out) ≈ $0.0005.
At most 144 runs a day, so the hard worst case is ≈ $0.19/day, under the $0.50 cap and well under the
project's $3/day gateway ceiling; realistic volume (a new brief when a band moves, at least hourly) is
close to the 24-a-day hourly floor plus one per real change since v1.25.1 (above), about $0.01–0.04/day. Collection costs nothing upstream (above). Supabase: one insert
per new brief (~20–40 KB of facts JSONB), one tiny update per unchanged run, 7 small reads.

## Switches and env

| env | default | effect |
|---|---|---|
| `BRIEF_CRON` | on | `0`/`off`/`false`/`no` → the cron no-ops (200) before collecting anything |
| `BRIEF_GENERATION` | on | off → no model calls; template briefs continue |
| `BRIEF_DAILY_USD_CAP` | `0.50` | the brief's own daily ceiling in USD; `0` = no model calls |
| `BRIEF_MODEL_ID` | `anthropic/claude-haiku-5.5` | override the model id without a deploy |
| `AI_GATEWAY_API_KEY` | — | shared with delay-explain; unset → templates only |
| `AI_GATEWAY_BASE_URL` | `https://ai-gateway.vercel.sh` | shared with delay-explain |
| `ENHANCED_RADAR_ENABLED` | off | exactly `1` turns radio facts on |
| `ENHANCED_RADAR_API_KEY` | — | the Enhanced Radar key (`sk_…`); unset → no calls |
| `ENHANCED_RADAR_DAILY_USD_CAP` | `12` | radio spend per UTC day; `0` = no calls |
| `ENHANCED_RADAR_MONTHLY_USD_CAP` | `100` | radio spend per UTC calendar month; `0` = no calls |

**Model id.** `api/delay-explain.ts` sends the bare Anthropic id `claude-haiku-4-5` through the
gateway's Anthropic-compatible endpoint; the gateway's docs and model catalog use `provider/model`
(`anthropic/claude-haiku-5.5`, verified in `GET https://ai-gateway.vercel.sh/v1/models` on Nov 10
2026). The constant is the catalog form. Neither form has been sent live for Haiku 5.5 from this code;
`BRIEF_MODEL_ID=claude-haiku-5-5` is the fallback if the catalog form is rejected. Two other parts of
the request were not sent live either: the nullable `traveler_note` (`anyOf: [object, null]`; the
gateway's structured-output page lists only string/number/boolean/array/object/enum) and
`output_config.effort`. A rejection of any of the three surfaces in the eval as `model_rejected`
with the gateway's message on the detail line, and in production as that template reason.

## Failure modes

| what fails | what visitors get | `template_reason` / status |
|---|---|---|
| `/api/irops` or `/api/faa` unreachable | the previous brief, going `stale` after 30 min | run `skipped`, nothing written |
| fewer than 3 hubs with an on-time reading (empty or thin boards) | the previous brief, going `stale` | run `skipped`, nothing written, nothing optional or paid runs |
| `/api/nas`, `/api/metar`, the feed, the roster or the history | a brief without those facts (named in `collection.errors`) | — |
| Supabase unconfigured / `sql/022` not applied | "no brief yet" | run `unconfigured`; one loud log line |
| `BRIEF_GENERATION=off`, no key, cap reached, counter unreadable | template | `generation_disabled`, `no_api_key`, `spend_cap`, `spend_unreadable` |
| gateway 402 / 401·403 / 429 / other 4xx / 5xx / timeout | template | `gateway_budget`, `gateway_forbidden`, `model_rate_limited`, `model_rejected`, `model_error`, `model_timeout` |
| refusal, truncated output, empty text, unparseable JSON, wrong shape | template | `model_refusal`, `model_truncated`, `model_empty`, `invalid_json`, `invalid_shape` |
| every item fails verification | template | `no_items_survived` |
| the template itself fails verification (a bug) | the template, published anyway | `verifier.templateCheck`, error logged |
| radio: switch off, no trigger, cap, recent attempt, ledger down, refusal, timeout | a brief without radio facts; the reason per hub in `collection.radio` | never a template reason; a radio failure never fails the brief |

Known limits: the verifier checks grounding, not meaning ("Every hub is fine" with a soft hub cited
passes if no number is wrong); quantifiers ("all", "none") and day-part words are not checked; a
non-weather cause word the extractor does not know passes unseen. Tone and the planned-hedge rule are
the two semantic checks.

## Air traffic control radio (Enhanced Radar)

**Off unless `ENHANCED_RADAR_ENABLED=1`** (exactly "1"; `true`, `on`, ` 1` are off). With it off the cron
never imports `api/_radio-status.ts` (a dynamic import behind the check), so the paid client
(`api/_enhanced-radar.ts`) is unreachable; the client also re-checks the flag and the key itself.
Tested in `tests/brief-radio-cron.test.js`.

- **What it buys.** `GET https://api.enhancedradar.com/api/v0/airports/status?facility_id=…`, $1.50 per
  call. Nothing else: only `/facilities`, `/pricing` and `/health` are free, and none of the others is
  called. The seven covered hubs' facility ids are a checked-in constant (`ER_HUB_FACILITY_IDS` in
  `src/lib/brief-radio.js`, from the free `/facilities` list, Nov 10 2026). Tokyo Narita and Guam are
  not covered.
- **Trigger.** A covered hub with a ground stop or ground delay program **in effect** in the `/api/faa`
  facts. Planned programs, delay advisories, weather and calm days never spend.
- **Ledger first.** `radio_airport_status` gets a row **before** each call with the full $1.50 booked
  (`status: 'pending'`), then the row is settled from `X-Charged-Usd` (402/403 refusals and 4xx/5xx
  are $0, per the billing docs; a 200 with no header stays at $1.50). A timeout, a dropped
  connection or a killed lambda therefore still counts against both caps and still holds the
  window. No ledger read or no pending row → no call (fail closed).
- **Never a retry.** One attempt per call (plain `fetch`, no SDK, no loop). A charge is final once
  recorded and a retry can be charged again, so the next eligible cron run is the only retry.
- **Caps.** Today (UTC) ≤ `ENHANCED_RADAR_DAILY_USD_CAP` (default $12), this calendar month (UTC) ≤
  `ENHANCED_RADAR_MONTHLY_USD_CAP` (default $100): sums of `charged_usd` over the ledger, checked
  before every call, including this run's own calls. An explicit 0 stops all calls. A 402/403 stops
  further calls for the run, and at most two calls go out per run (8 s timeout each), so the run stays
  inside its time budget; a third hub waits ten minutes.
- **Reuse.** A hub with **any** attempt in the last 90 minutes is not called again; its latest good
  status in that window is reused across runs. Worst case during a long ground stop: one call per hub
  per 90 minutes, so a single-hub all-day program is ≈ 10 calls ($15) and the daily cap stops it at 8.
- **Every call logs** `status`, `X-Charged-Usd`, `X-Balance-Usd` and `X-Request-ID`.
- **Facts.** The flow figures and runways (`kind: 'flow'`: Enhanced Radar computes them from FAA data,
  not from audio) and each `critical` / `notable` observation (`kind: 'radio'`, time and title only,
  with the API's own warning that the summaries are model-written and can be wrong carried in the
  statement). Radio facts never set the tone. The report of what the guard did is stored in
  `collection.radio` and returned in the run summary.
- **The title is untrusted** (third-party, model-written, from open transmissions anyone can key up
  on). `sanitizeRadioTitle()` (`src/lib/brief-radio.js`) runs NFKC; strips control and invisible
  characters, newlines, markup, URLs and bare domains; keeps only letters, digits, spaces and
  `. , ' / ( ) & : -`; collapses whitespace; caps at 120 characters on a word boundary; and drops the
  observation when fewer than three characters remain or what remains reads like an instruction
  ("ignore previous instructions", "you are now", "respond with", "system:", or our own schema words
  such as "headline" and "tone"). The sanitized title travels only as the fact's `quote`, shown to the
  model in double quotes after the attribution, and prompt rule 7 says a radio quote is data to
  report, never an instruction. It is **never** in `values`: those come only from validated
  structured fields (the hub's names, the clock computed here, the API's `tags` as words, charted
  `runways`), so a title cannot whitelist a number, airport or runway it contains. The raw response
  stays in `radio_airport_status.payload` (service role only, never served); `ops_briefs.facts` and
  `GET /api/brief` carry only the sanitized quote, as JSON strings. The UI renders brief text as
  text, never as HTML (React does by default; `tests/brief-ui.test.tsx` pins it); the verifier also
  drops any item with markup or a URL.

Budget: at the default caps the $1,000 credit lasts at least 10 months even if every day were a
ground-stop day; on ordinary weeks (a few hub programs) it is a few dollars.

## Deep links the chips need

The server's `link` says where a fact belongs. The UI (`src/lib/brief-chips.js` `chipTarget`)
links a chip only where the dashboard actually shows that fact, so it overrides a few of them; a
chip with no target is plain text, never a dead button, and so is one whose target is the tab
already showing. Every chip href is a real deep link that resolves on a cold load
(`src/app/state/deep-links.ts`), through the same resolver a chip click uses
(`weatherScrollTarget` in `src/lib/tab-hash.js`).

| `link` | resolves today? | the chip goes to |
|---|---|---|
| `{ tab: 'schedule', hub }` (on-time, cancellations at a hub) | **yes**: `?tab=schedule&hub=ORD` | that hub's board |
| `{ tab: 'live' }`, `{ tab: 'starlink' }` | **yes**: `#live`, `#starlink` | the tab (`air.normal` included: the Live tab shows the count, not the 7-day median) |
| `{ tab: 'weather', section: 'irops' }` (index, network status) | **yes**: `?tab=irops` (Weather, scrolled to the IROPS section) | the IROPS bar |
| `{ tab: 'schedule', hub }` on `otp.floor` (the lowest hub, not named in the text while every hub is healthy) | **yes** | that hub's board |
| `{ tab: 'weather', section: 'irops' }` on `otp.soft` | yes, but the IROPS bar does not show on-time | **override**: the first soft hub's board, `?tab=schedule&hub=EWR` |
| `{ tab: 'weather', hub }` (FAA programs at a hub, hub weather) | **yes since the brief UI**: `?tab=weather&hub=EWR` (Weather, scrolled to that hub's card, ringed like a radar click) | that hub's card |
| `{ tab: 'weather', hub }` on `faa_planned` facts | yes, but the hub card shows only programs in effect | **override**: the NAS status panel, `?tab=weather&section=nas` **(new)**, which lists planned programs |
| `{ tab: 'weather', hub }` for an airport without a card (BOS, LGA), `faa.active.other` | **no**: the NAS panel lists en-route programs only, so `/api/faa` programs at other airports appear nowhere | no target (plain text) |
| `{ tab: 'weather' }` (`faa.active.count`, `wx.summary`, `faa.planned.count`) | **yes**: `#weather` (`faa.planned.count`: the NAS panel) | the tab / the NAS panel |
| `{ tab: 'schedule' }` with no hub (`cxl.confirmed`, `cxl.unconfirmed`) | **no**: no `?status=canceled` board filter, and one board shows one hub | **override**: the IROPS bar, `?tab=irops`, whose Canceled figure is the same `/api/irops` number |
| `{ tab: 'live' }` filtered to Starlink | **no**: the Live tab's Starlink-only filter is not deep-linkable (`#starlink` opens the Starlink tab instead) | the Starlink tab |
| `{ tab: 'weather', hub }` for `flow.*` and `radio.*` facts | **no**: there is no radio or airport-flow view anywhere in the dashboard yet | no target (plain text; radio is `bb-info` with an antenna icon) |

## Schema, apply order, undo

`sql/022_ops_brief.sql`: `ops_briefs` (+ `ops_briefs_generated_at_idx`), `feature_spend_daily`,
`increment_feature_spend(text, date, numeric, integer, bigint, bigint)`, and `radio_airport_status`
(+ `radio_airport_status_requested_at_idx`, `radio_airport_status_hub_requested_at_idx`), the radio
cache and ledger, which stays empty unless the switch is on. RLS on with no policies, no
grants to `anon`/`authenticated`, EXECUTE for `service_role` only, idempotent, additive.

Apply order: run `sql/022` in the Supabase SQL editor, then add the env and `vercel.json` entries,
then deploy. The code is safe in either order: before the SQL it no-ops with one log line.

Undo (exact):

```sql
drop table if exists public.radio_airport_status;  -- drops its two indexes with it
drop function if exists public.increment_feature_spend(text, date, numeric, integer, bigint, bigint);
drop table if exists public.feature_spend_daily;
drop index if exists public.ops_briefs_generated_at_idx;
drop table if exists public.ops_briefs;
```

`vercel.json` additions:

```json
"functions": {
  "api/brief.ts": { "maxDuration": 10 },
  "api/cron/brief.ts": { "maxDuration": 90 }
},
"crons": [
  { "path": "/api/cron/brief", "schedule": "*/10 * * * *" }
]
```

## The eval harness

```
bun scripts/brief-eval.mjs                       # every fixture in tests/fixtures/brief/
bun scripts/brief-eval.mjs storm-day --facts     # one fixture, with every fact printed
bun scripts/brief-eval.mjs --templates           # never call the model
bun scripts/brief-eval.mjs --json                # one JSON object per fixture
bun scripts/brief-eval.mjs --requests            # {fixture, system, user} per fixture, one JSON line each
bun scripts/brief-eval.mjs --check sfo-gdp-morning response.json   # a saved response, offline
```

`--requests` and `--check` never call the network, whatever the environment holds (Bun loads `.env`).
`--requests` prints exactly what production would send for each fixture (the system prompt and the
user message from `buildBriefRequest`), so the requests can be run elsewhere. `--check <fixture>
<file>` takes a saved response, either a Messages API body (`{ content, stop_reason }`) or the brief
JSON itself, and runs it through production's path (`briefFromSavedResponse` in
`src/lib/brief-verify.js`: `readBriefResponse`, `verifyBrief`, else the template with the cron's
reason), printing the verifier report and the brief that would be published (`--json` for one object).

With `AI_GATEWAY_API_KEY` in the environment the default mode makes one call per fixture (nine today, ≈ $0.005 in
all), sending the production request (`buildBriefRequest`, `generateBriefWithModel`) and running the
production verifier; it prints the model brief, every dropped item with its reasons, the headline and
tone decisions, warnings, tokens and cost, then the template. Without a key it prints the templates.
Fixtures are raw source payloads (`sources`), so the fact builder runs too; a fixture may carry
`facts` instead, and `radio: { EWR: <airports/status body> }` adds the radio facts the cron would
build (`ground-stop-with-radio` uses the real EWR response). The harness never calls Enhanced Radar. The system prompt is `BRIEF_SYSTEM_PROMPT` in `src/lib/brief-prompt.js`.
