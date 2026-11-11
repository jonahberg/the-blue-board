-- 023: supporter_payments — donations Stripe reports, for "cover a day" ($17 keeps the site running
-- for a day; src/lib/cover-a-day.js).
--
-- APPLY MANUALLY via the Supabase dashboard SQL editor (this repo keeps migrations in sql/, not
-- supabase/migrations/). Additive only: one new table, nothing that exists changes. Idempotent: safe
-- to re-run. The code deploys safely before this file is applied: GET /api/support-status answers
-- {configured:false} (the dashboard then shows the plain ask with no coverage claims), and the
-- webhook answers 500 so Stripe keeps retrying the delivery (for up to three days) until it is.
--
-- WRITER: api/stripe-webhook.ts (service role), on Stripe's signed events:
--   checkout.session.completed / checkout.session.async_payment_succeeded with payment_status
--   'paid' and a payment_link → one row, deduplicated on session_id (a redelivered or second event
--   for the same session inserts nothing);
--   charge.refunded → raises amount_refunded_cents (never lowers it) and sets `refunded` once the
--   charge is fully refunded, matched on payment_intent_id.
-- READER: api/support-status.ts (service role), one Central-time month of rows by paid_at.
--
-- WHAT IS NOT HERE, ON PURPOSE: no email address, no card or billing details, no customer id and no
-- raw event payload. Stripe keeps those. The only thing a supporter typed that is stored is the
-- display name from the Payment Link's custom field, and it is shown only after the strict check in
-- src/lib/supporter-name.js, never while `hidden` is true, and never while SUPPORTER_NAMES=off.
--
-- HIDING A NAME (owner, by hand):
--   update public.supporter_payments set hidden = true where display_name ilike '%text%';
--   update public.supporter_payments set hidden = true where session_id = 'cs_live_…';
-- The day stays covered and reads "a supporter". The site's CDN copy refreshes within ~2 minutes.
--
-- RETENTION: keep everything (a few rows a day at most).
--
-- Posture (sql/017, sql/018, sql/022): RLS on with NO policies, no anon/authenticated grants. Only the
-- service-role API reads or writes.
--
-- Verify after applying:
--   select count(*) from public.supporter_payments;   -- returns 0
--
-- UNDO (drops every stored payment; Stripe still has them all and can resend events):
--   drop table if exists public.supporter_payments;

create table if not exists public.supporter_payments (
  id                    bigint generated always as identity primary key,
  -- The first Stripe event that recorded this payment (evt_…).
  event_id              text not null unique check (event_id ~ '^evt_[A-Za-z0-9_]+$'),
  -- The Checkout Session (cs_live_… / cs_test_…). One row per session.
  session_id            text not null unique check (session_id ~ '^cs_[A-Za-z0-9_]+$'),
  -- How charge.refunded finds the row. Null for subscription-mode sessions.
  payment_intent_id     text unique check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  -- The Payment Link the session came from (plink_…); GET /api/support-status counts only the links
  -- named in STRIPE_PAYMENT_LINK_IDS when that is set.
  payment_link_id       text check (payment_link_id is null or payment_link_id ~ '^plink_[A-Za-z0-9_]+$'),
  amount_cents          integer not null check (amount_cents >= 0),
  -- Lowercase ISO code. Only 'usd' counts toward a day.
  currency              text not null check (currency ~ '^[a-z]{3}$'),
  -- When Stripe reported the payment (the event's `created`). Decides the month and the order.
  paid_at               timestamptz not null,
  livemode              boolean not null,
  -- The placement label (the `data-support` label of the link that was followed), carried as the
  -- session's client_reference_id by supportUrl() in src/lib/support-link.js. Null for a link
  -- opened without one.
  placement             text check (placement is null or placement ~ '^[A-Za-z0-9_-]{1,40}$'),
  -- The session was a subscription (mode = 'subscription').
  recurring             boolean not null default false,
  refunded              boolean not null default false,
  amount_refunded_cents integer not null default 0 check (amount_refunded_cents >= 0),
  -- What the supporter typed in the name field, whitespace-collapsed and cut to 100 characters.
  -- NOT shown as-is: see the header.
  display_name          text check (display_name is null or length(display_name) <= 100),
  -- Owner's switch: true shows this payment as "a supporter" whatever its name.
  hidden                boolean not null default false,
  received_at           timestamptz not null default now()
);

create index if not exists supporter_payments_paid_at_idx on public.supporter_payments (paid_at);

alter table public.supporter_payments enable row level security;

-- Supabase's default privileges grant new public tables to anon/authenticated; RLS without a policy
-- already denies them every row, and this takes the grant away too (belt and braces).
revoke all on table public.supporter_payments from public, anon, authenticated;

comment on table public.supporter_payments is
  'Donations Stripe reported (api/stripe-webhook.ts). No email, card or customer data. Read by GET /api/support-status for "cover a day". Set hidden = true to stop a name showing.';
comment on column public.supporter_payments.display_name is
  'Free text from the Payment Link name field. Shown only if it passes src/lib/supporter-name.js, hidden is false and SUPPORTER_NAMES is not off.';
comment on column public.supporter_payments.hidden is
  'Owner switch: true = this payment reads "a supporter" on the site.';
comment on column public.supporter_payments.paid_at is
  'Stripe event time. The US Central month of this decides which month''s days the payment covers.';
