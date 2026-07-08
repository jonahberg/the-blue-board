# Owner setup: background push alerts

Background flight-watch alerts let The Blue Board notify a user about a watched flight's status,
gate, or equipment change **even after they close the tab**. This rides on the Web Push standard
(VAPID + `web-push`), a Supabase table of subscriptions, and a 5-minute diff cron.

Until the three env vars and the table below exist, the feature **degrades gracefully**: the
dashboard keeps doing today's in-tab notifications and shows the honest copy *"Background alerts:
not yet enabled on this deployment."* Nothing errors. These are one-time owner actions.

## Checklist

1. **Generate a VAPID key pair** (local, one-time):

   ```sh
   bunx web-push generate-vapid-keys
   ```

   It prints a `Public Key` and a `Private Key`.

2. **Set three env vars in Vercel** (Project → Settings → Environment Variables, Production):

   | Variable | Value |
   |----------|-------|
   | `WEB_PUSH_VAPID_PUBLIC_KEY` | the generated Public Key |
   | `WEB_PUSH_VAPID_PRIVATE_KEY` | the generated Private Key |
   | `WEB_PUSH_CONTACT` | a contact URL the push services can reach you at, e.g. `mailto:hello@theblueboard.co` |

   (Supabase must also already be configured — `NEXT_PUBLIC_SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY` — which it is for the schedule/waitlist features.)

3. **Run the migration** `sql/014_watch_subscriptions.sql` in the Supabase SQL editor (or via the
   Supabase MCP). It creates the `watch_subscriptions` table with RLS enabled and a single
   service-role policy — no anon access. The file's trailing comment has the verification queries.

4. **Confirm the cron is wired** — `vercel.json` already contains:

   ```json
   { "path": "/api/cron/watch-alerts", "schedule": "*/5 * * * *" }
   ```

   (Added with this feature; no action needed beyond confirming it survived the deploy.)

5. **Redeploy.** On the next deploy the dashboard's `GET /api/push-subscribe` starts returning
   `configured: true` with the public key, the client begins registering push subscriptions when
   users watch flights with notifications granted, and the cron begins delivering alerts.

## Privacy note

The `watch_subscriptions` table stores only the browser's push endpoint, the two client encryption
keys the push service requires, and the watched flight numbers. No emails, no user identifiers.
A subscription is deleted on unsubscribe or after 3 consecutive push-delivery failures (dead
endpoint). Alerts are and stay **free** — there is no paywall on this path.
