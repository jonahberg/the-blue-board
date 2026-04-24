-- Seed a placeholder row in news_notifications so the atomic claim-by-UPDATE in
-- api/news-notify.ts works from the first invocation (previously the first
-- run had no row and the atomic UPDATE affected 0 rows, falling through to an
-- unconditional upsert race).
--
-- The placeholder slug `__unseeded__` is sentinel — it will never match a real
-- article slug, so the first real broadcast's UPDATE will match and claim.
-- Idempotent: ON CONFLICT DO NOTHING lets this migration run multiple times.

INSERT INTO news_notifications (key, slug, sent_at)
VALUES ('last_sent', '__unseeded__', NOW())
ON CONFLICT (key) DO NOTHING;
