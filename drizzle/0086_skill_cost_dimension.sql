-- 0086: cost_ledger skill 維度 — AIDV-130 S-5 Skill 成本歸屬
--
-- 在 AIDV-14（0079_cost_attribution）cost_ledger 基礎上加兩個欄位：
--   skillId      : 執行此分錄的 Skill manifest id（e.g. "storyboard.breakdown"）
--   skillVersion : Skill 版本（semver pin，e.g. "1.0.0"）
-- 再加一條索引 cl_skillId_idx 支援依 skillId 彙總查詢。
--
-- 完成後 cost_ledger 可依 skillId 維度彙總：
--   SELECT skillId, SUM(amount) FROM cost_ledger
--   WHERE entryType='debit' AND status='posted' GROUP BY skillId
-- 並可與 projectId/workflowId 交叉分析（同行有這兩個維度欄）。
--
-- 三鐵則：①禁 CREATE INDEX IF NOT EXISTS；②一 breakpoint 一句；
-- ③ALTER/CREATE INDEX 走 information_schema 守門。可安全重跑。

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'skillId'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `skillId` varchar(128)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'skillVersion'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `skillVersion` varchar(32)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND index_name = 'cl_skillId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `cl_skillId_idx` ON `cost_ledger` (`skillId`)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
