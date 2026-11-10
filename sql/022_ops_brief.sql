-- 022: the ops brief ("Right now" at the top of the Live tab) and a per-feature metered-spend counter.
--
-- APPLY MANUALLY via the Supabase dashboard SQL editor (this repo keeps migrations in sql/, not
-- supabase/migrations/). Additive only: two new tables, one new function, no change to anything that
-- exists. Idempotent: safe to re-run. Undo is at the bottom of docs/specs/ops-brief.md.
--
-- Posture (sql/017, sql/018): RLS on with NO policies, no anon/authenticated grants. Only the
-- service-role API reads or writes. The code deploys safely before this file is applied: the cron
-- no-ops with a 200 and one loud log line, and GET /api/brief answers "no brief yet".
--
-- Verify after applying:
--   select increment_feature_spend('brief', current_date, 0, 0, 0, 0);   -- returns 0
--   select count(*) from ops_briefs;                                     -- returns 0

-- ── ops_briefs: one row per published brief ──
-- WRITER: api/cron/brief.ts (every 10 minutes; a run whose material facts match the latest brief
-- and that brief is under 60 minutes old writes nothing but `checked_at`).
-- READER: api/brief.ts (service role): the newest row by generated_at.
-- RETENTION: 90 days, deleted in bounded primary-key batches by the cron (api/_brief-store.ts).
create table if not exists public.ops_briefs (
  id               bigint generated always as identity primary key,
  generated_at     timestamptz not null default now(),
  -- Last time a cron run confirmed the facts behind this brief were unchanged. GET /api/brief
  -- reports `stale` from this, not from generated_at (a calm brief is re-confirmed, not rewritten).
  checked_at       timestamptz not null default now(),
  source           text not null check (source in ('model', 'template')),
  -- Why a template was published instead of the model's brief (null for source = 'model').
  template_reason  text check (template_reason is null or length(template_reason) <= 64),
  tone             text not null check (tone in ('calm', 'watch', 'disrupted')),
  headline         text not null check (length(headline) between 1 and 200),
  -- [{ text, fact_ids: [..] }], 1 to 4 entries, every one verified against `facts`.
  items            jsonb not null check (jsonb_typeof(items) = 'array'),
  -- { text, fact_ids } or null.
  traveler_note    jsonb,
  headline_fact_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(headline_fact_ids) = 'array'),
  -- Every fact the brief was written from (src/lib/brief-facts.js), not only the cited ones.
  facts            jsonb not null check (jsonb_typeof(facts) = 'array'),
  facts_hash       text not null check (facts_hash ~ '^[0-9a-f]{64}$'),
  model            text,
  input_tokens     integer check (input_tokens is null or input_tokens >= 0),
  output_tokens    integer check (output_tokens is null or output_tokens >= 0),
  cost_usd         numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  -- What the verifier did: items in, items dropped and why, headline kept or replaced, tone.
  verifier         jsonb not null default '{}'::jsonb,
  -- Which sources answered, which failed, and anything skipped (src/lib/brief-facts.js).
  collection       jsonb not null default '{}'::jsonb
);

create index if not exists ops_briefs_generated_at_idx on public.ops_briefs (generated_at desc);

alter table public.ops_briefs enable row level security;
revoke all on table public.ops_briefs from public, anon, authenticated;

comment on table public.ops_briefs is
  'The ops brief: one row per published brief (api/cron/brief.ts, every 10 min). Read by GET /api/brief. Kept 90 days.';
comment on column public.ops_briefs.checked_at is
  'Last cron run that found the material facts unchanged. GET /api/brief derives `stale` from this.';
comment on column public.ops_briefs.facts_hash is
  'sha256 of the material facts after jitter rounding (src/lib/brief-facts.js materialKey). Equal hash + under 60 min = skip.';

-- ── feature_spend_daily: metered spend per feature per UTC day ──
-- One row per (feature, day). Shared by every metered feature so each can carry its own cap without
-- starving the others (the AI Gateway has ONE $3/day ceiling for the whole project):
--   'brief'           the ops brief's model calls (cap BRIEF_DAILY_USD_CAP, default $0.50)
--   'ask', 'flight-read', ...  later features, each with its own cap
-- Written only through increment_feature_spend (atomic upsert); read by the guards before a call.
create table if not exists public.feature_spend_daily (
  feature       text not null check (feature ~ '^[a-z0-9][a-z0-9_.-]{0,47}$'),
  day           date not null,
  usd           numeric(12, 6) not null default 0 check (usd >= 0),
  calls         integer not null default 0 check (calls >= 0),
  input_tokens  bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  updated_at    timestamptz not null default now(),
  primary key (feature, day)
);

alter table public.feature_spend_daily enable row level security;
revoke all on table public.feature_spend_daily from public, anon, authenticated;

comment on table public.feature_spend_daily is
  'Metered spend per feature per UTC day (USD). Incremented atomically by increment_feature_spend; checked before every metered call.';

-- Atomic increment, the sql/009 shape: concurrent lambdas cannot undercount, and the new daily total
-- comes back so a caller can adopt it. SECURITY DEFINER, so it enforces its own invariants instead of
-- trusting callers: GREATEST(.., 0) on every amount, because a negative value would reopen a budget.
create or replace function public.increment_feature_spend(
  p_feature text,
  p_day date,
  p_usd numeric,
  p_calls integer,
  p_input_tokens bigint,
  p_output_tokens bigint
)
returns numeric
language sql
security definer
set search_path = public
as $$
  insert into feature_spend_daily (feature, day, usd, calls, input_tokens, output_tokens, updated_at)
  values (
    p_feature, p_day,
    greatest(coalesce(p_usd, 0), 0),
    greatest(coalesce(p_calls, 0), 0),
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    now()
  )
  on conflict (feature, day) do update
    set usd           = feature_spend_daily.usd + excluded.usd,
        calls         = feature_spend_daily.calls + excluded.calls,
        input_tokens  = feature_spend_daily.input_tokens + excluded.input_tokens,
        output_tokens = feature_spend_daily.output_tokens + excluded.output_tokens,
        updated_at    = now()
  returning usd;
$$;

-- Only the server may call it. Supabase's default privileges grant EXECUTE on new public functions to
-- anon AND authenticated (sql/009, sql/015), so revoke all three and grant the service role alone.
revoke execute on function public.increment_feature_spend(text, date, numeric, integer, bigint, bigint) from public;
revoke execute on function public.increment_feature_spend(text, date, numeric, integer, bigint, bigint) from anon;
revoke execute on function public.increment_feature_spend(text, date, numeric, integer, bigint, bigint) from authenticated;
grant execute on function public.increment_feature_spend(text, date, numeric, integer, bigint, bigint) to service_role;
