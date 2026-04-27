# Pro v1 — Environment Variable Reference

Required for Pro to work end-to-end. Set these in Vercel project env (Production +
Preview as appropriate). Run `vercel env pull` locally to sync.

## Required

| Variable | Purpose | Where set |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Production + Preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (used client-side for auth) | Production + Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only — webhook + cron writes | Production + Preview |
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_live_*` in prod) | Production only — use `sk_test_*` in Preview |
| `STRIPE_WEBHOOK_SECRET` | `whsec_*` from your Stripe webhook endpoint config | Production only |
| `STRIPE_PRICE_ID_FOUNDING` | Stripe price ID for $5.99/mo founding plan | Production + Preview |
| `STRIPE_PRICE_ID_REGULAR` | Stripe price ID for $7.99/mo regular plan | Production + Preview |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key (exposed to clients) | Production + Preview |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key (server-only) | Production + Preview |
| `VAPID_SUBJECT` | `mailto:hello@theblueboard.co` (or your contact) | Production + Preview |
| `RESEND_API_KEY` | Email sending (already required for waitlist) | Production + Preview |
| `RESEND_AUDIENCE_ID` | Audience for the launch blast | Production only |
| `CRON_SECRET` | Bearer secret for cron endpoints (already required) | Production + Preview |
| `ANTHROPIC_API_KEY` | AI delay explanations (already required) | Production + Preview |

## Optional kill-switches

All default to enabled. Set to literal string `"false"` to disable.

| Variable | What it disables |
|---|---|
| `PRO_ENABLED` | Master kill — disables checkout, push subscribe, risk-monitor cron |
| `PRO_FEATURE_CHECKOUT_ENABLED` | Stripe checkout endpoint only |
| `PRO_FEATURE_PUSH_ENABLED` | Push subscribe endpoint only |
| `PRO_FEATURE_RISK_MONITOR_ENABLED` | Risk-monitor cron only |

Use these to triage incidents without rolling back a deploy. Flip the env var
in the Vercel dashboard, redeploys aren't needed for env-only changes.

## Setup checklist (one-time before launch)

1. Apply SQL migrations in order:
   - `sql/008_pro_v1.sql`
   - `sql/009_pro_rls.sql`
2. Generate VAPID keypair: `bun scripts/generate-vapid-keys.mjs` and add to env
3. In Stripe dashboard:
   - Create the founding-price product ($5.99/mo, recurring monthly), copy price ID into `STRIPE_PRICE_ID_FOUNDING`
   - Create the regular-price product ($7.99/mo, recurring monthly), copy ID into `STRIPE_PRICE_ID_REGULAR`
   - Create webhook endpoint pointed at `https://theblueboard.co/api/stripe/webhook`, subscribe to: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
   - Copy webhook signing secret into `STRIPE_WEBHOOK_SECRET`
4. In Supabase dashboard:
   - Enable email magic-link auth
   - Configure email templates (or accept defaults — Pro user only sees this once)
   - Add `https://theblueboard.co/auth/callback` and your preview/dev URLs to allowed redirect URIs
5. Run RLS integration tests against your Supabase project to verify policies:
   ```bash
   TEST_SUPABASE_URL=... \
   TEST_SUPABASE_ANON_KEY=... \
   TEST_SUPABASE_SERVICE_KEY=... \
   bun run test tests/pro-rls.integration.test.js
   ```
6. Deploy to preview, smoke-test checkout flow with a Stripe test card (4242…)
7. Promote to production
8. Send the launch blast: `bun scripts/send-pro-launch-blast.mjs --dry-run` first, then without the flag

## Local development

For local dev, you can omit Stripe keys and the Pro endpoints will return clear
errors instead of crashing. Auth and the dashboard work without Stripe — it only
matters at the checkout step.
