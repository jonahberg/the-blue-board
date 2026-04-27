/**
 * POST /api/news-notify
 *
 * Deploy hook endpoint that checks if there's a new article since the last
 * notification and sends a broadcast to the Resend Audience if so.
 *
 * Auth: requires CRON_SECRET header (same pattern as cron endpoints).
 *
 * Idempotency: atomic claim-by-CAS. A single UPDATE ... WHERE slug != $new
 * RETURNING * serializes concurrent callers on the row lock. If the UPDATE
 * affects 1 row, we claimed it and proceed to send. If it affects 0 rows,
 * another caller already claimed the same slug (or this slug was already
 * sent) and we bail out silently.
 *
 * Requires:
 *   - RESEND_API_KEY env var
 *   - RESEND_AUDIENCE_ID env var (create in Resend dashboard)
 *   - Supabase news_notifications table (sql/004_news_notifications.sql)
 *   - Seeded last_sent row (sql/005_news_notifications_seed.sql) — without
 *     the seed, the first-run UPDATE affects 0 rows and the INSERT fallback
 *     has a cross-request race.
 */

import type { VercelRequest, VercelResponse } from './types.js';
import { getSupabase } from './_supabase.js';
import { isAuthorizedCronRequest } from './_cron-auth.js';
import { escapeHtml, sanitizeHeaderValue } from '../src/lib/escape.js';

const FROM_ADDRESS = 'Jonah @ The Blue Board <hello@theblueboard.co>';
const BASE_URL = 'https://theblueboard.co';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

  if (!RESEND_API_KEY || !AUDIENCE_ID) {
    return res.status(500).json({ error: 'Missing RESEND_API_KEY or RESEND_AUDIENCE_ID' });
  }

  try {
    const supabase = getSupabase();

    // Fetch the latest article from the build-time JSON
    const latestRes = await fetch(`${BASE_URL}/data/news-latest.json`);
    if (!latestRes.ok) {
      return res.status(500).json({ error: 'Failed to fetch news-latest.json' });
    }
    const latest = await latestRes.json();
    if (!Array.isArray(latest) || latest.length === 0) {
      return res.status(200).json({ status: 'no_articles', message: 'No articles published yet' });
    }

    const article = latest[0];
    const { slug, title, category } = article;

    if (!slug || typeof slug !== 'string') {
      return res.status(500).json({ error: 'Latest article has no slug' });
    }

    // ── Atomic claim via conditional UPDATE ─────────────────────────
    //
    // UPDATE news_notifications SET slug = $new ... WHERE key = 'last_sent'
    //   AND slug != $new RETURNING *
    //
    // Postgres takes a row lock on key='last_sent'. Concurrent callers for
    // the SAME new slug serialize on that lock; exactly one sees slug != $new
    // and updates (RETURNING 1 row). The rest see slug == $new post-commit
    // and affect 0 rows → bail out as "already sent."
    //
    // Concurrent callers for DIFFERENT new slugs is a rare case (cron schedules
    // article publication; two articles are not "next" simultaneously). When
    // it happens, both can succeed and both broadcast — acceptable for v1.5.5;
    // tracked in TODOS.md for a broadcast-ID idempotency key if needed.

    const { data: claimed, error: claimErr } = await supabase
      .from('news_notifications')
      .update({ slug, sent_at: new Date().toISOString() })
      .eq('key', 'last_sent')
      .neq('slug', slug)
      .select('slug');

    if (claimErr) {
      console.error('news-notify: claim UPDATE failed:', claimErr.message);
      return res.status(500).json({ error: 'Failed to send notification' });
    }

    if (!claimed || claimed.length === 0) {
      // Either the seed row is missing, or slug was already claimed. Distinguish
      // by reading: if the row exists with slug = our slug, it's already sent.
      // If the row doesn't exist, the seed migration (sql/005) didn't run.
      const { data: existing } = await supabase
        .from('news_notifications')
        .select('slug')
        .eq('key', 'last_sent')
        .maybeSingle();

      if (!existing) {
        console.error('news-notify: last_sent row missing — run sql/005_news_notifications_seed.sql');
        return res.status(500).json({ error: 'Failed to send notification' });
      }

      return res.status(200).json({ status: 'already_sent', slug });
    }

    // ── Send broadcast ──────────────────────────────────────────────

    const articleUrl = `${BASE_URL}/news/${encodeURIComponent(slug)}`;
    const safeTitle = typeof title === 'string' ? title : '';
    const safeCategory = typeof category === 'string' ? category : '';
    const emailHtml = buildDigestEmail(safeTitle, safeCategory, articleUrl);
    // Subject is an email header — escapeHtml would inject HTML entities into
    // the displayed subject. Strip control chars to prevent SMTP injection and
    // cap length defensively.
    const subject = `📰 ${sanitizeHeaderValue(safeTitle).slice(0, 180)} — The Blue Board`;

    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_API_KEY);

    const { data: broadcast, error: createErr } = await resend.broadcasts.create({
      audienceId: AUDIENCE_ID,
      from: FROM_ADDRESS,
      subject,
      html: emailHtml,
      replyTo: 'hello@theblueboard.co',
    });

    if (createErr || !broadcast?.id) {
      // Broadcast create failed. The claim is retained; it points to this slug
      // so a retry for the same slug correctly bails out as already_sent. If
      // the failure is transient and the operator wants to retry, they must
      // manually reset the row. Not rolling back avoids the "overwrite newer
      // successful claim" hazard the prior rollback had.
      console.error(
        'news-notify: broadcast create failed (claim retained, manual reset to retry):',
        createErr?.message || 'no broadcast ID'
      );
      return res.status(500).json({ error: 'Failed to send notification' });
    }

    const { error: sendErr } = await resend.broadcasts.send(broadcast.id);
    if (sendErr) {
      console.error('news-notify: broadcast send failed (claim retained):', sendErr.message);
      return res.status(500).json({ error: 'Failed to send notification' });
    }

    return res.status(200).json({ status: 'sent', slug, title: safeTitle });
  } catch (err: any) {
    // Never surface err.message to the client — can leak schema / audience IDs.
    console.error('news-notify error:', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}

function buildDigestEmail(title: string, category: string, articleUrl: string): string {
  const p = 'font-size:16px;line-height:1.7;color:#b0b0b0;margin:0 0 16px';
  const escTitle = escapeHtml(title);
  const escCategory = escapeHtml(category);
  const escUrl = escapeHtml(articleUrl);

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
    ${escTitle} — read the latest on The Blue Board.
  </div>

  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">

    <p style="font-size:13px;color:#4a90d9;letter-spacing:0.5px;margin:0 0 24px;text-transform:uppercase;">
      THE BLUE BOARD — NEWS
    </p>

    <h1 style="color:#e0e0e0;font-size:22px;font-weight:600;margin:0 0 8px;line-height:1.3;">
      ${escTitle}
    </h1>

    <p style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 24px;">
      ${escCategory}
    </p>

    <p style="${p}">
      We just published a new article on The Blue Board. Click below to read the full story with source links and related fleet and hub info.
    </p>

    <div style="text-align:center;margin:32px 0;">
      <a href="${escUrl}" style="background-color:#4a90d9;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:16px;font-weight:600;display:inline-block;">
        Read the Article →
      </a>
    </div>

    <hr style="border:none;border-top:1px solid #1a2035;margin:32px 0">

    <p style="font-size:13px;color:#6b7280;margin:0;text-align:center;">
      <a href="https://theblueboard.co" style="color:#4a90d9;text-decoration:none;">The Blue Board</a> — Free, ad-free United Airlines ops dashboard
    </p>
  </div>
</body>
</html>`;
}
