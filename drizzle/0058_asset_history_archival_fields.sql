-- 0058: digital_asset_library / generation_history 歸檔與來源追蹤欄位。
--
-- 兩張表共同新增 5 個欄位：
--   sourceUrl         TEXT          — 原始外部來源 URL（第三方匯入時保留）
--   provider          VARCHAR(32)   — 實際儲存供應商（s3 / r2 / gcs 等）
--   archivedAt        TIMESTAMP     — 冷儲存／歸檔時間，NULL 代表仍熱資料
--   expiresAt         TIMESTAMP     — 保留期到期時間，NULL 代表不過期
--   archivalChecksum  VARCHAR(64)   — 歸檔當下的 sha256 hash，回溯校驗用
--
-- 並於兩張表各建立一個 functional index `(archivedAt IS NULL, createdAt)`
-- 加速「未歸檔資料依建立時間排序」這個列表 query 的熱路徑。
--
-- 全部欄位 nullable —— 既有資料、未走歸檔流程的路徑都可維持 NULL，
-- 不會破壞舊資料或既有寫入。functional index 需要 MySQL 8.0.13+；
-- 部署環境若仍在 8.0.12 以下，請先升級 MySQL 再跑這支 migration。
--
-- 沿用 0034 / 0036 / 0045 / 0057 已驗證的 idempotent procedure 模式，
-- 避免 MySQL 8.0.29 以下對 ALTER TABLE / CREATE INDEX 缺乏 IF NOT
-- EXISTS 時的重跑風險。

DROP PROCEDURE IF EXISTS `__dal_add_archival_columns`;
--> statement-breakpoint

CREATE PROCEDURE `__dal_add_archival_columns`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'sourceUrl'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `sourceUrl` TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'provider'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `provider` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'archivedAt'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `archivedAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'expiresAt'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `expiresAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND COLUMN_NAME = 'archivalChecksum'
  ) THEN
    ALTER TABLE `digital_asset_library`
      ADD COLUMN `archivalChecksum` VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'digital_asset_library'
      AND INDEX_NAME = 'dal_archivedNull_createdAt_idx'
  ) THEN
    CREATE INDEX `dal_archivedNull_createdAt_idx`
      ON `digital_asset_library` ((`archivedAt` IS NULL), `createdAt`);
  END IF;
END;
--> statement-breakpoint

CALL `__dal_add_archival_columns`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__dal_add_archival_columns`;
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__gh_add_archival_columns`;
--> statement-breakpoint

CREATE PROCEDURE `__gh_add_archival_columns`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'generation_history'
      AND COLUMN_NAME = 'sourceUrl'
  ) THEN
    ALTER TABLE `generation_history`
      ADD COLUMN `sourceUrl` TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'generation_history'
      AND COLUMN_NAME = 'provider'
  ) THEN
    ALTER TABLE `generation_history`
      ADD COLUMN `provider` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'generation_history'
      AND COLUMN_NAME = 'archivedAt'
  ) THEN
    ALTER TABLE `generation_history`
      ADD COLUMN `archivedAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'generation_history'
      AND COLUMN_NAME = 'expiresAt'
  ) THEN
    ALTER TABLE `generation_history`
      ADD COLUMN `expiresAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'generation_history'
      AND COLUMN_NAME = 'archivalChecksum'
  ) THEN
    ALTER TABLE `generation_history`
      ADD COLUMN `archivalChecksum` VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'generation_history'
      AND INDEX_NAME = 'gh_archivedNull_createdAt_idx'
  ) THEN
    CREATE INDEX `gh_archivedNull_createdAt_idx`
      ON `generation_history` ((`archivedAt` IS NULL), `createdAt`);
  END IF;
END;
--> statement-breakpoint

CALL `__gh_add_archival_columns`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__gh_add_archival_columns`;
