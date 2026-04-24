import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { getSupabase } from './_supabase.js';

// 5 submissions per IP per hour → ~5 per 60 minutes
// Rate limiter works in 60s windows, so allow 5 per 60s window
// For hourly semantics we use a tighter per-minute limit
const isRateLimited = createRateLimiter('waitlist', 5);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Matches the CHECK constraint in sql/006_waitlist_checks.sql. The API coerces
// out-of-whitelist values to 'popup' (attribution degrades, signup doesn't
// break); the DB is the backstop for writers that bypass the API (anon-key
// direct inserts).
//
// Existing callers: 'popup' (main.js waitlist modal), 'tsa-page' (tsa.astro
// gate). If you add a new callsite that passes a different source, add it
// here AND in sql/006_waitlist_checks.sql — both must allow it.
const VALID_SOURCES = new Set([
  'popup',
  'hero',
  'footer',
  'news',
  'hub',
  'fleet',
  'dashboard',
  'tsa-page',
]);

// Window for classifying a signup as "new" rather than a re-submission. After
// the upsert returns, if created_at is within this window of now, the row was
// just inserted (not updated-in-place by conflict). 10s absorbs clock skew
// between Supabase and the serverless instance while still catching
// re-submissions on the order of seconds.
const NEW_SIGNUP_WINDOW_MS = 10_000;

const FROM_ADDRESS = 'Jonah @ The Blue Board <hello@theblueboard.co>';
const REPLY_TO = 'hello@theblueboard.co';

function buildWelcomeEmail(): string {
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
  <!-- Preheader (inbox preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#0a0e1a;">
    You just joined 25,000+ United flyers. Here's what's live right now.
  </div>

  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">

    <!-- Header -->
    <p style="font-size:13px;color:#4a90d9;letter-spacing:0.5px;margin:0 0 24px;text-transform:uppercase;">
      THE BLUE BOARD
    </p>

    <!-- Welcome -->
    <h1 style="color:#e0e0e0;font-size:24px;font-weight:600;margin:0 0 24px;line-height:1.3;">
      Welcome aboard ✈️
    </h1>

    <p style="${p}">
      You just joined 25,000+ United flyers who are tired of checking three different apps to figure out what's happening with their flight.
    </p>

    <p style="${p}">
      I built The Blue Board because I wanted to see United the way an ops center would — live flight positions, delay predictions, fleet data, hub weather, all in one dark, data-dense dashboard. No ads. No paywalls. Just one United nerd who hates bad flight trackers.
    </p>

    <!-- Features -->
    <p style="font-size:15px;color:#e0e0e0;font-weight:600;margin:24px 0 16px;">
      Here's what's live right now:
    </p>

    <table role="presentation" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:24px;font-size:15px;">&#x1F4E1;</td>
        <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#b0b0b0;">
          <strong style="color:#e0e0e0;">600+ flights tracked live</strong> — updated every 30 seconds on a dark ops map
        </td>
      </tr>
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:24px;font-size:15px;">&#x26A0;&#xFE0F;</td>
        <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#b0b0b0;">
          <strong style="color:#e0e0e0;">AI delay predictions</strong> — 8-signal risk scoring with plain-English explanations
        </td>
      </tr>
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:24px;font-size:15px;">&#x2708;&#xFE0F;</td>
        <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#b0b0b0;">
          <strong style="color:#e0e0e0;">Starlink WiFi tracker</strong> — check if your plane has it before you board
        </td>
      </tr>
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:24px;font-size:15px;">&#x1F4C5;</td>
        <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#b0b0b0;">
          <strong style="color:#e0e0e0;">Departure boards for all 9 hubs</strong> — with equipment swap alerts
        </td>
      </tr>
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:24px;font-size:15px;">&#x1F50D;</td>
        <td style="padding:8px 0;font-size:15px;line-height:1.5;color:#b0b0b0;">
          <strong style="color:#e0e0e0;">"Where's My Plane?"</strong> — see your aircraft operating its previous flight
        </td>
      </tr>
    </table>

    <!-- Primary CTA -->
    <div style="text-align:center;margin:32px 0;">
      <a href="https://theblueboard.co" style="background-color:#4a90d9;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:16px;font-weight:600;display:inline-block;">
        Open The Blue Board
      </a>
    </div>

    <hr style="${divider}">

    <!-- Community / Feedback -->
    <p style="font-size:15px;color:#e0e0e0;font-weight:600;margin:0 0 12px;">
      You can shape what gets built next.
    </p>

    <p style="${p}">
      Some of the best features came from flyers like you — suggestions from Reddit, FlyerTalk, and reply emails like this one. If you find a bug, have an idea, or just want to say something — <strong style="color:#e0e0e0;">hit reply. It goes straight to me.</strong>
    </p>

    <p style="margin:16px 0 0;">
      <a href="https://github.com/notjbg/the-blue-board/issues" style="color:#4a90d9;text-decoration:none;font-size:14px;">Suggest a Feature on GitHub &rarr;</a>
      &nbsp;&nbsp;&middot;&nbsp;&nbsp;
      <a href="https://x.com/theblueboard" style="color:#4a90d9;text-decoration:none;font-size:14px;">Follow @theblueboard &rarr;</a>
    </p>

    <hr style="${divider}">

    <!-- Donation -->
    <p style="font-size:15px;color:#e0e0e0;font-weight:600;margin:0 0 12px;">
      Keep The Blue Board in the air.
    </p>

    <p style="${p}">
      This is free, ad-free, and open source. It costs real money to keep running — API calls, Vercel hosting, and the time to build and maintain it.
    </p>

    <p style="${p}">
      <strong style="color:#e0e0e0;">A $5 donation covers a full day of live flights, API calls, and everything that keeps this running.</strong>
    </p>

    <div style="text-align:center;margin:24px 0;">
      <a href="https://buymeacoffee.com/notjbg" style="background-color:transparent;color:#4a90d9;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600;display:inline-block;border:1.5px solid #4a90d9;">
        Donate
      </a>
    </div>

    <hr style="${divider}">

    <!-- Sign-off -->
    <p style="font-size:16px;color:#e0e0e0;margin:0 0 20px;font-style:italic;">
      Thank you for flying with us ✈️
    </p>

    <p style="font-size:15px;color:#b0b0b0;margin:0 0 4px;">
      — Jonah
    </p>
    <p style="font-size:13px;color:#666;margin:0;">
      Builder of The Blue Board &middot; <a href="https://theblueboard.co" style="color:#4a90d9;text-decoration:none;">theblueboard.co</a>
    </p>

    <!-- Footer -->
    <p style="font-size:11px;color:#444;margin:40px 0 0;">
      Not affiliated with United Airlines, Inc. You're receiving this because you signed up at theblueboard.co.
    </p>
  </div>
</body>
</html>`;
}

async function sendWelcomeEmail(email: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      replyTo: REPLY_TO,
      to: email,
      subject: 'Welcome aboard ✈️',
      html: buildWelcomeEmail(),
    });

    if (error) {
      console.error('Welcome email failed:', error);
    }
  } catch (e) {
    // Don't let email failures block the signup
    console.error('Welcome email error:', e);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || 'https://theblueboard.co');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Too many submissions — try again later' });
  }

  const { email, source, featureRequest } = req.body || {};

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Invalid or missing email address' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const safeSource = typeof source === 'string' && VALID_SOURCES.has(source) ? source : 'popup';
  const safeFeatureRequest =
    typeof featureRequest === 'string' ? featureRequest.slice(0, 500) : null;

  try {
    // Atomic classification: use the upsert's returned created_at to decide if
    // this was a fresh insert or a conflict-triggered update. The previous
    // SELECT-before-upsert pattern had two failure modes:
    //   1. With anon key + no SELECT policy, SELECT returned [] and every
    //      resubmission sent a welcome email (ultrareview bug #1).
    //   2. Two concurrent first-time submissions both saw existing=[], both
    //      upserted, both sent email.
    // Reading created_at from the upsert's returning-row closes both.
    const { data, error } = await getSupabase()
      .from('waitlist')
      .upsert(
        {
          email: normalizedEmail,
          source: safeSource,
          feature_request: safeFeatureRequest,
        },
        { onConflict: 'email' }
      )
      .select('created_at')
      .single();

    if (error) {
      console.error('Waitlist upsert error:', error.message);
      return res.status(500).json({ error: 'Something went wrong — please try again' });
    }

    const createdAtMs = data?.created_at ? new Date(data.created_at).getTime() : 0;
    const isNewSignup = createdAtMs > 0 && Date.now() - createdAtMs < NEW_SIGNUP_WINDOW_MS;

    // Await the send in serverless runtimes so the function does not exit
    // before Resend receives the outbound request.
    if (isNewSignup) {
      await sendWelcomeEmail(normalizedEmail);
    }

    return res.status(200).json({ success: true });
  } catch (e: any) {
    console.error('Waitlist error:', e);
    return res.status(500).json({ error: 'Something went wrong — please try again' });
  }
}
