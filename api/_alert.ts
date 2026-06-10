// Lightweight, env-gated operational alerting. (Ported from PR #168, which this supersedes.)
//
// POSTs a compact message to a Discord webhook configured via ALERT_WEBHOOK_URL.
// - No-ops when ALERT_WEBHOOK_URL is unset, so callers can invoke it unconditionally.
// - Best-effort: never throws into the caller, uses a short timeout, and swallows its own errors.
// - Throttled per-instance to avoid spamming on every cron tick. (The throttle is module-level
//   state and therefore per-lambda; on serverless this is "good enough" for an hourly cron that
//   normally runs on a single warm instance — it is a noise guard, not a hard global limit.)
//
// Discord webhooks accept a JSON body with a `content` field; we also include `username` for a
// friendly sender name. (For Slack, swap `content` -> `text`.)
// Audit P1: "No alerting/monitoring on the schedule/credit subsystem."

let lastAlertAt = 0;
const MIN_ALERT_INTERVAL_MS = 5 * 60 * 1000;

export async function sendAlert(title: string, lines: string[] = []): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  const now = Date.now();
  if (now - lastAlertAt < MIN_ALERT_INTERVAL_MS) return;
  lastAlertAt = now;

  // Discord hard-caps message content at 2000 chars; stay well under.
  const content = [`**${title}**`, ...lines].join('\n').slice(0, 1900);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, username: 'Blue Board' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (e: any) {
    // Never let alerting failures affect the caller's control flow.
    console.error('Alert webhook failed:', e?.message || e);
  }
}

/** Test helper: clear the per-instance throttle. Production never calls it. */
export function __resetAlertThrottleForTests(): void {
  lastAlertAt = 0;
}
