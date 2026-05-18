-- 0057: digital_asset_library 來源追蹤欄位。
-- （此 PR 在 rebase 時與 main 上已有的 migration 撞號，移位到 0057。）
-- 補上 sourceStudio / modelId / backgroundJobId 讓「我的資產」可依工作室
-- 與 AI 模型分類，並反向連回 backgroundJobs 取得原始任務細節（fal
-- request_id、降級紀錄等）。
--
-- 為什麼用 procedure 而不是裸 ALTER TABLE：MySQL 8.0.29 以下對 ALTER
-- TABLE 沒有 IF NOT EXISTS，5.7 / 8.0.28 部署環境會炸；沿用 0034 / 0036
-- / 0045 已驗證的 idempotent procedure 模式。
--
-- 全部欄位 nullable —— 舊資料、手動上傳、未來不走 backgroundJob 的路徑
-- 都可以維持 NULL。新建索引 `dal_userId_sourceStudio_idx` 支援「我的資產」
-- 依 sourceStudio 過濾的 query。

DROP PROCEDURE IF EXISTS `__dal_add_source_tracking_columns`;
--> statement-breakpoint

CREATE PROCEDURE `__dal_add_source_tracking_columns`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'sourceStudio'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `sourceStudio` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'modelId'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `modelId` VARCHAR(128) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'backgroundJobId'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `backgroundJobId` INT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND INDEX_NAME = 'dal_userId_sourceStudio_idx'
  ) THEN
    CREATE INDEX `dal_userId_sourceStudio_idx`
      ON `digital_asset_library` (`userId`, `sourceStudio`);
  END IF;
END;
--> statement-breakpoint

CALL `__dal_add_source_tracking_columns`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__dal_add_source_tracking_columns`;
