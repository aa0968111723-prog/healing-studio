-- 0107: generation_history 加 backgroundJobId 關聯欄位（AIDV-169）
-- 背景：backgroundJobs 與 generationHistory 兩表沒有關聯欄位，歷史紀錄
-- 無法反查原始任務（fal request_id、降級紀錄、退款狀態）。本 migration：
--   1. 加 nullable `backgroundJobId` int 欄位（information_schema 守門，可重跑）。
--   2. 回填既有資料：postGenActions 一直有把 backgroundJobId 塞進
--      parameterSnapshot JSON，把它抬升到新欄位（僅 INTEGER 型別、僅
--      backgroundJobId IS NULL 的列 → 冪等，重跑不覆寫）。
--   3. 建 gh_backgroundJobId_idx 反查索引（information_schema.statistics 守門）。
-- 刻意不加 DB 級外鍵：background_jobs 之後有 TTL 清理（AIDV-655），
-- 硬外鍵會擋刪除；app 層容忍 dangling id。
-- 可安全重跑：欄位/索引已存在 → IF 走 SELECT 1；回填 UPDATE 冪等。

SET @gh_bjid_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'generation_history'
      AND column_name  = 'backgroundJobId'
  ),
  'SELECT 1',
  'ALTER TABLE `generation_history` ADD COLUMN `backgroundJobId` int NULL'
);
--> statement-breakpoint
PREPARE gh_bjid FROM @gh_bjid_stmt;
--> statement-breakpoint
EXECUTE gh_bjid;
--> statement-breakpoint
DEALLOCATE PREPARE gh_bjid;
--> statement-breakpoint
UPDATE `generation_history`
SET `backgroundJobId` = CAST(
  JSON_UNQUOTE(JSON_EXTRACT(`parameterSnapshot`, '$.backgroundJobId')) AS SIGNED
)
WHERE `backgroundJobId` IS NULL
  AND `parameterSnapshot` IS NOT NULL
  AND JSON_TYPE(JSON_EXTRACT(`parameterSnapshot`, '$.backgroundJobId')) = 'INTEGER';
--> statement-breakpoint
SET @gh_bjid_idx_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'generation_history'
      AND index_name   = 'gh_backgroundJobId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `gh_backgroundJobId_idx` ON `generation_history` (`backgroundJobId`)'
);
--> statement-breakpoint
PREPARE gh_bjid_idx FROM @gh_bjid_idx_stmt;
--> statement-breakpoint
EXECUTE gh_bjid_idx;
--> statement-breakpoint
DEALLOCATE PREPARE gh_bjid_idx;
