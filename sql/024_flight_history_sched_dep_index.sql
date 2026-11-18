-- 024: a partial index on flight_history.sched_dep for the ops brief's schedule counts.
--
-- ╔══════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ NOT APPLIED. The owner decides whether to apply it. Nothing in the code needs it today.  ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════╝
--
-- APPLY MANUALLY via the Supabase dashboard SQL editor (this repo keeps migrations in sql/, not
-- supabase/migrations/), as a statement of its own: CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block. Additive only: one index, no table or row changes. Idempotent: safe to re-run.
--
-- WHY: api/_brief-collect.ts loadScheduleCounts counts hub departures scheduled in a four-hour
-- window, today and at the same clock time on each of the previous seven days (v1.31.3). It runs
-- only when far fewer flights are in the air than usual (25% or more fewer), eight count-only
-- requests in parallel under a 4 s limit. Each count today is a lossy BRIN scan of three or four
-- service days: about 0.55 to 0.6 s and ~41k rows read (EXPLAIN ANALYZE, Nov 18 2026, ~70k rows in
-- the table). The table grows about 2,800 departure rows a day, and the BRIN ranges are loose
-- (rows for a day are written a day ahead and updated in place), so each count will slow as it
-- grows. With this index a count reads only the ~700 rows in its window. A count that runs past the
-- limit is "unavailable" and the brief reads exactly as it did before v1.31.3, so a slow count is
-- safe, only less useful.
--
-- COST: about 30 to 40 bytes per departure row (int4 key + tuple overhead), ~2,800 rows a day ≈
-- 30 to 40 MB a year, against the table's own size budget in docs/specs/flight-history.md (Size).
-- It also adds a little work to every insert of a departure row by the warm cron's writer.
--
-- Verify after applying (the plan should name flight_history_dep_sched_dep_idx):
--   explain analyze select count(*) from flight_history
--   where on_dep_board and service_date between current_date - 1 and current_date + 1
--     and sched_dep >= (extract(epoch from now()) / 60)::int - 240
--     and sched_dep < (extract(epoch from now()) / 60)::int;
--
-- UNDO: drop index concurrently if exists public.flight_history_dep_sched_dep_idx;

create index concurrently if not exists flight_history_dep_sched_dep_idx
  on public.flight_history (sched_dep)
  where on_dep_board;
