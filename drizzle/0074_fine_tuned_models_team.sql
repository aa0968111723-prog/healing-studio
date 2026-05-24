-- 0074: fine_tuned_models 加 teamId（團隊專屬模型，冪等版）
--
-- M（訓練 track）：讓「用團隊資料訓練」產出的 LoRA 綁到團隊，team_shared 成員可列出 /
-- 使用。可安全重跑：欄位 / 索引存在就 SELECT 1，不存在才建立。

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'fine_tuned_models'
      AND column_name = 'teamId'
  ),
  'SELECT 1',
  'ALTER TABLE `fine_tuned_models` ADD COLUMN `teamId` int'
);
--> statement-breakpoint
PREPARE ftm_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ftm_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ftm_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'fine_tuned_models'
      AND index_name = 'ftm_teamId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `ftm_teamId_idx` ON `fine_tuned_models` (`teamId`)'
);
--> statement-breakpoint
PREPARE ftm_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ftm_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ftm_stmt;
