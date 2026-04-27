// Send the Pro launch announcement to the Resend audience.
// Run on launch day (Tue 5/5):
//   RESEND_API_KEY=... RESEND_AUDIENCE_ID=... bun scripts/send-pro-launch-blast.mjs
//
// Dry-run mode: pass --dry-run to print the email HTML without sending.
//
// Reuses the broadcast pattern from api/news-notify.ts. Subject is short on
// purpose — gmail truncates at ~50 chars on mobile.

import { Resend } from 'resend';

const DRY_RUN = process.argv.includes('--dry-run');
const FROM = 'Jonah @ The Blue Board <hello@theblueboard.co>';
const SUBJECT = '🚀 Blue Board Pro is live — your founding spot is ready';

function buildHtml() {
  const p = 'font-size:16px;line-height:1.7;color:#b0b0b0;margin:0 0 16px';
  const divider = 'border:none;border-top:1px solid #1a2035;margin:32px 0';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background-color:#0a0e1a;color:#e0e0e0;padding:0;margin:0;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#0a0e1a;">
    Pro is live. Personal flight monitoring + push alerts. $5.99/mo founding price.
  </div>
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <p style="font-size:13px;color:#4a90d9;letter-spacing:0.5px;margin:0 0 24px;text-transform:uppercase;">
      THE BLUE BOARD &middot; PRO IS LIVE
    </p>

    <h1 style="color:#e0e0e0;font-size:24px;font-weight:600;margin:0 0 24px;line-height:1.3;">
      Get warned before United does ✈️
    </h1>

    <p style="${p}">
      You signed up for updates after v1.5 because you wanted to know what was next. This is what was next.
    </p>

    <p style="${p}">
      <strong style="color:#e0e0e0;">Blue Board Pro</strong> watches your upcoming flights every 15 minutes — your aircraft's history, the FAA NAS state, hub weather, IROPS — and pings you when delay risk spikes. The kind of heads-up United's app gives you 90 minutes after the gate agent already knows.
    </p>

    <p style="font-size:15px;color:#e0e0e0;font-weight:600;margin:32px 0 12px;">
      What you get:
    </p>

    <table role="presentation" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:24px;font-size:15px;">📋</td>
        <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#b0b0b0;">
          <strong style="color:#e0e0e0;">My Flights dashboard</strong> — track up to 10 flights at a time
        </td>
      </tr>
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:24px;font-size:15px;">🔔</td>
        <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#b0b0b0;">
          <strong style="color:#e0e0e0;">Push notifications</strong> when delay risk crosses the alert threshold
        </td>
      </tr>
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:24px;font-size:15px;">🤖</td>
        <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#b0b0b0;">
          <strong style="color:#e0e0e0;">Unlimited AI delay explanations</strong> (free is capped at 3/day)
        </td>
      </tr>
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:24px;font-size:15px;">📡</td>
        <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#b0b0b0;">
          <strong style="color:#e0e0e0;">Personalized risk monitoring</strong> — your flights, every 15 minutes
        </td>
      </tr>
    </table>

    <p style="${p}">
      <strong style="color:#e0e0e0;">Founding pricing: $5.99/mo for the first 100 subscribers.</strong> Regular price after that is $7.99/mo. You'll keep the founding rate as long as your subscription stays active.
    </p>

    <div style="text-align:center;margin:32px 0;">
      <a href="https://theblueboard.co/pro?utm_source=launch_email&utm_medium=email&utm_campaign=pro_launch" style="background-color:#4a90d9;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:16px;font-weight:600;display:inline-block;">
        Claim your founding spot →
      </a>
    </div>

    <hr style="${divider}">

    <p style="font-size:15px;color:#e0e0e0;font-weight:600;margin:0 0 12px;">
      A note about iPhones:
    </p>
    <p style="${p}">
      Apple only delivers push notifications to installed home-screen apps. After you subscribe, we'll walk you through the two-tap install. If you'd rather skip install, you can opt into email alerts instead — same trigger, slower delivery.
    </p>

    <hr style="${divider}">

    <p style="${p}">
      The free dashboard stays free forever. Pro is what makes the engineering sustainable so I can keep building this for the community.
    </p>

    <p style="font-size:15px;color:#b0b0b0;margin:0 0 4px;">
      — Jonah
    </p>
    <p style="font-size:13px;color:#666;margin:0;">
      Builder of The Blue Board &middot; <a href="https://theblueboard.co" style="color:#4a90d9;text-decoration:none;">theblueboard.co</a>
    </p>

    <p style="font-size:11px;color:#444;margin:40px 0 0;">
      Not affiliated with United Airlines, Inc. You're receiving this because you signed up for updates at theblueboard.co.
    </p>
  </div>
</body>
</html>`;
}

const html = buildHtml();

if (DRY_RUN) {
  console.log('--- DRY RUN: pro launch email HTML ---');
  console.log(html);
  console.log('--- END DRY RUN ---');
  process.exit(0);
}

if (!process.env.RESEND_API_KEY || !process.env.RESEND_AUDIENCE_ID) {
  console.error('Missing RESEND_API_KEY or RESEND_AUDIENCE_ID');
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY);

const created = await resend.broadcasts.create({
  audienceId: process.env.RESEND_AUDIENCE_ID,
  from: FROM,
  subject: SUBJECT,
  html,
  replyTo: 'hello@theblueboard.co',
});

if (created.error || !created.data?.id) {
  console.error('Broadcast create failed:', created.error);
  process.exit(1);
}

console.log('Broadcast created:', created.data.id);
console.log('To send: visit Resend dashboard or call resend.broadcasts.send(' + created.data.id + ')');
console.log('(Sending separately is intentional — gives you a moment to preview in Resend before blasting.)');
