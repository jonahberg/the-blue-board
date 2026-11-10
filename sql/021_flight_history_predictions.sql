-- 021 (predictions): flight_delay_predictions — the board's delay-risk score, written down ~2 h before
-- each hub departure, so a public scorecard can later grade it against flight_history.
-- Spec: docs/specs/flight-history.md ("Prediction logging"). Rules: src/lib/delay-prediction.js.
-- Requires sql/021_flight_history.sql (the writer reads the legs from it).
--
-- WRITER: api/cron/warm-schedules.ts → api/_flight-history.ts → api/_delay-predictions.ts, the last
-- step of each run: one prediction per leg, the first cron pass that sees its scheduled departure
-- within 155 min (normally 125–155 min out; down to 90 when a run was missed — lead_min says which).
-- `on conflict do nothing`: a logged prediction is never rewritten.
-- Kill switch: DELAY_PREDICTIONS_ENABLED=0.
-- READER: none yet (the risk-model scorecard joins this to flight_history on the leg key).
--
-- TIMES are int4 minutes since the Unix epoch, UTC, like flight_history.
-- The primary key leads with service_date: rows arrive in day order (compact index), and every
-- reader asks for a range of days.
--
-- RLS on, NO policies, no anon/authenticated grants (sql/017 posture). Idempotent: safe to re-run.
-- UNDO: drop table if exists public.flight_delay_predictions;

create table if not exists public.flight_delay_predictions (
  service_date          date     not null,
  predicted_at          integer  not null,
  lead_min              smallint not null,
  row_age_min           smallint not null,
  score                 smallint not null check (score between 0 and 100),
  same_inputs_as_board  boolean  not null,
  flight_no             text     not null check (flight_no ~ '^[A-Z0-9]{2,8}$'),
  origin                text     not null check (origin ~ '^[A-Z0-9]{3}$'),
  dest                  text     not null check (dest ~ '^[A-Z0-9]{3}$'),
  band                  text     not null check (band in ('LOW', 'MOD', 'HIGH', 'V.HIGH')),
  factors               text     not null default '',
  inputs_missing        text,
  model_version         text     not null,
  constraint flight_delay_predictions_pkey primary key (service_date, flight_no, origin, dest)
);

alter table public.flight_delay_predictions enable row level security;
revoke all on table public.flight_delay_predictions from anon, authenticated;

comment on table public.flight_delay_predictions is
  'The board''s delay-risk score for each hub departure, logged once ~2 h before it (warm cron). Same leg key as flight_history. Times: int4 epoch minutes (UTC).';
comment on column public.flight_delay_predictions.predicted_at is 'When the prediction was made, epoch minutes UTC.';
comment on column public.flight_delay_predictions.lead_min is 'Scheduled departure minus predicted_at, in minutes (normally 125–155).';
comment on column public.flight_delay_predictions.row_age_min is
  'How old the leg''s schedule row was (predicted_at - flight_history.last_seen): the estimate the model read is as of then.';
comment on column public.flight_delay_predictions.score is 'computeDelayRiskModel() score 0–100 (src/lib/delay-risk.js). The board shows no badge at 0.';
comment on column public.flight_delay_predictions.band is 'RISK_BANDS label for the score: LOW < 25 ≤ MOD < 50 ≤ HIGH < 75 ≤ V.HIGH.';
comment on column public.flight_delay_predictions.factors is 'Top scoring component ids, highest first, comma-separated (≤ 3), e.g. origin-faa-gdp,time-of-day,hub-profile.';
comment on column public.flight_delay_predictions.inputs_missing is
  'Model inputs this prediction did not have, comma-separated (faa, nas, irops, origin_weather, dest_weather); null = none. dest_weather is missing for every non-hub destination: only the nine hub METARs are cached server-side.';
comment on column public.flight_delay_predictions.same_inputs_as_board is
  'No input missing and the row no older than the board''s 1 h CDN copy. Even then the browser may use a fresher client-board OTP than /api/irops (arbitrateHubHealth).';
comment on column public.flight_delay_predictions.model_version is
  '<git hash of the last delay-risk.js change>.<server input set>, e.g. b5fd1bd.s1 (src/lib/delay-prediction.js).';
