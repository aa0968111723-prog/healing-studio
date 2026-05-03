-- 0024: persist what each orb scheduled run actually produced.
--
-- Until now, only `lastRunAt` and `lastError` were stored. When the planner
-- could not turn a task description into an executable plan it surfaced
-- "planner-status:invalid" in the UI and the user got nothing useful back.
-- These columns let the scheduler always persist a real result (either the
-- orchestrator's outcome summary or a direct-LLM fallback report), and let
-- the panel show a one-line status badge ("已產出報告" / "需澄清" / etc.).
--
-- Both columns are nullable so old rows continue to work; the runtime in
-- services/orbScheduler.ts is also defensive and tolerates this migration
-- not having been applied yet.

ALTER TABLE `orb_scheduled_jobs`
  ADD COLUMN `lastResult` text NULL,
  ADD COLUMN `lastRunStatus` varchar(32) NULL;
