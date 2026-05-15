-- 0045: 記記（notes-curator）AI agent 能力升級。
-- 補上 digital_asset_library 的 tags / category 欄位，讓 tagAssets /
-- searchAssets / getAssetStatistics 可以真的依使用者標籤分類；同步補
-- project_notes_calendar.category 讓筆記也能被分類（生活 / 工作 / 創作
-- 等）。所有變更皆 idempotent，重跑安全。
--
-- 為什麼用 procedure 而不是裸 ALTER TABLE：MySQL 8.0.29 以下對 ALTER
-- TABLE 沒有 IF NOT EXISTS，部署環境如果是 5.7 / 8.0.28 會炸；同
-- 0034 / 0036 既有 idempotent 模式，沿用之。

DROP PROCEDURE IF EXISTS `__dal_add_tags_columns`;
--> statement-breakpoint

CREATE PROCEDURE `__dal_add_tags_columns`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'tags'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `tags` JSON NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'category'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `category` VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND INDEX_NAME = 'dal_userId_category_idx'
  ) THEN
    CREATE INDEX `dal_userId_category_idx`
      ON `digital_asset_library` (`userId`, `category`);
  END IF;
END;
--> statement-breakpoint

CALL `__dal_add_tags_columns`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__dal_add_tags_columns`;
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__pnc_add_category_column`;
--> statement-breakpoint

CREATE PROCEDURE `__pnc_add_category_column`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'project_notes_calendar'
      AND COLUMN_NAME = 'category'
  ) THEN
    ALTER TABLE `project_notes_calendar`
      ADD COLUMN `category` VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'project_notes_calendar'
      AND INDEX_NAME = 'pnc_userId_category_idx'
  ) THEN
    CREATE INDEX `pnc_userId_category_idx`
      ON `project_notes_calendar` (`userId`, `category`);
  END IF;
END;
--> statement-breakpoint

CALL `__pnc_add_category_column`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__pnc_add_category_column`;
