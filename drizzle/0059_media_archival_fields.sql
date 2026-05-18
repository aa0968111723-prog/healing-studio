-- 0059: media 相關表的歸檔與來源追蹤欄位（drive_asset_libraries /
-- teaching_materials / consistency_vault / r2_storage_snapshots）。
--
-- 沿用 0058 對 digital_asset_library / generation_history 的同一組欄位，
-- 把歸檔欄位延伸到剩下會吃 R2 容量的 media 類資料：
--   sourceUrl         TEXT          — 原始外部來源 URL（第三方匯入時保留）
--   provider          VARCHAR(32)   — 實際儲存供應商（s3 / r2 / gcs 等）
--   archivedAt        TIMESTAMP     — 冷儲存／歸檔時間，NULL 代表仍熱資料
--   expiresAt         TIMESTAMP     — 保留期到期時間，NULL 代表不過期
--   archivalChecksum  VARCHAR(64)   — 歸檔當下的 sha256 hash，回溯校驗用
--
-- 每張表各建立一個 functional index `(archivedAt IS NULL, createdAt)`，
-- 加速 GC / 歸檔 worker「找未歸檔且最舊」的 scan，以及前端列「熱資料」
-- 依建立時間排序的列表。functional index 需要 MySQL 8.0.13+，部署環境
-- 若仍在 8.0.12 以下請先升級。
--
-- 全部欄位 nullable —— 舊資料、未走歸檔流程的路徑都可以維持 NULL，
-- 不會破壞既有寫入。每張表用獨立 procedure 包起來、沿用 0034 / 0036 /
-- 0045 / 0057 / 0058 已驗證的 idempotent 模式，避免 MySQL 8.0.29 以下對
-- ALTER TABLE / CREATE INDEX 缺乏 IF NOT EXISTS 時的重跑風險。

-- ───────────────────────────────────────────────────────────────────────
-- drive_asset_libraries
-- ───────────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `__darl_add_archival_columns`;
--> statement-breakpoint

CREATE PROCEDURE `__darl_add_archival_columns`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'drive_asset_libraries'
      AND COLUMN_NAME = 'sourceUrl'
  ) THEN
    ALTER TABLE `drive_asset_libraries`
      ADD COLUMN `sourceUrl` TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'drive_asset_libraries'
      AND COLUMN_NAME = 'provider'
  ) THEN
    ALTER TABLE `drive_asset_libraries`
      ADD COLUMN `provider` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'drive_asset_libraries'
      AND COLUMN_NAME = 'archivedAt'
  ) THEN
    ALTER TABLE `drive_asset_libraries`
      ADD COLUMN `archivedAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'drive_asset_libraries'
      AND COLUMN_NAME = 'expiresAt'
  ) THEN
    ALTER TABLE `drive_asset_libraries`
      ADD COLUMN `expiresAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'drive_asset_libraries'
      AND COLUMN_NAME = 'archivalChecksum'
  ) THEN
    ALTER TABLE `drive_asset_libraries`
      ADD COLUMN `archivalChecksum` VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'drive_asset_libraries'
      AND INDEX_NAME = 'darl_archivedNull_createdAt_idx'
  ) THEN
    CREATE INDEX `darl_archivedNull_createdAt_idx`
      ON `drive_asset_libraries` ((`archivedAt` IS NULL), `createdAt`);
  END IF;
END;
--> statement-breakpoint

CALL `__darl_add_archival_columns`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__darl_add_archival_columns`;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────
-- teaching_materials
-- ───────────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `__tm_add_archival_columns`;
--> statement-breakpoint

CREATE PROCEDURE `__tm_add_archival_columns`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'teaching_materials'
      AND COLUMN_NAME = 'sourceUrl'
  ) THEN
    ALTER TABLE `teaching_materials`
      ADD COLUMN `sourceUrl` TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'teaching_materials'
      AND COLUMN_NAME = 'provider'
  ) THEN
    ALTER TABLE `teaching_materials`
      ADD COLUMN `provider` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'teaching_materials'
      AND COLUMN_NAME = 'archivedAt'
  ) THEN
    ALTER TABLE `teaching_materials`
      ADD COLUMN `archivedAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'teaching_materials'
      AND COLUMN_NAME = 'expiresAt'
  ) THEN
    ALTER TABLE `teaching_materials`
      ADD COLUMN `expiresAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'teaching_materials'
      AND COLUMN_NAME = 'archivalChecksum'
  ) THEN
    ALTER TABLE `teaching_materials`
      ADD COLUMN `archivalChecksum` VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'teaching_materials'
      AND INDEX_NAME = 'tm_archivedNull_createdAt_idx'
  ) THEN
    CREATE INDEX `tm_archivedNull_createdAt_idx`
      ON `teaching_materials` ((`archivedAt` IS NULL), `createdAt`);
  END IF;
END;
--> statement-breakpoint

CALL `__tm_add_archival_columns`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__tm_add_archival_columns`;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────
-- consistency_vault
-- ───────────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `__cv_add_archival_columns`;
--> statement-breakpoint

CREATE PROCEDURE `__cv_add_archival_columns`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'consistency_vault'
      AND COLUMN_NAME = 'sourceUrl'
  ) THEN
    ALTER TABLE `consistency_vault`
      ADD COLUMN `sourceUrl` TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'consistency_vault'
      AND COLUMN_NAME = 'provider'
  ) THEN
    ALTER TABLE `consistency_vault`
      ADD COLUMN `provider` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'consistency_vault'
      AND COLUMN_NAME = 'archivedAt'
  ) THEN
    ALTER TABLE `consistency_vault`
      ADD COLUMN `archivedAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'consistency_vault'
      AND COLUMN_NAME = 'expiresAt'
  ) THEN
    ALTER TABLE `consistency_vault`
      ADD COLUMN `expiresAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'consistency_vault'
      AND COLUMN_NAME = 'archivalChecksum'
  ) THEN
    ALTER TABLE `consistency_vault`
      ADD COLUMN `archivalChecksum` VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'consistency_vault'
      AND INDEX_NAME = 'cv_archivedNull_createdAt_idx'
  ) THEN
    CREATE INDEX `cv_archivedNull_createdAt_idx`
      ON `consistency_vault` ((`archivedAt` IS NULL), `createdAt`);
  END IF;
END;
--> statement-breakpoint

CALL `__cv_add_archival_columns`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__cv_add_archival_columns`;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────
-- r2_storage_snapshots
-- ───────────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `__r2ss_add_archival_columns`;
--> statement-breakpoint

CREATE PROCEDURE `__r2ss_add_archival_columns`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'r2_storage_snapshots'
      AND COLUMN_NAME = 'sourceUrl'
  ) THEN
    ALTER TABLE `r2_storage_snapshots`
      ADD COLUMN `sourceUrl` TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'r2_storage_snapshots'
      AND COLUMN_NAME = 'provider'
  ) THEN
    ALTER TABLE `r2_storage_snapshots`
      ADD COLUMN `provider` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'r2_storage_snapshots'
      AND COLUMN_NAME = 'archivedAt'
  ) THEN
    ALTER TABLE `r2_storage_snapshots`
      ADD COLUMN `archivedAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'r2_storage_snapshots'
      AND COLUMN_NAME = 'expiresAt'
  ) THEN
    ALTER TABLE `r2_storage_snapshots`
      ADD COLUMN `expiresAt` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'r2_storage_snapshots'
      AND COLUMN_NAME = 'archivalChecksum'
  ) THEN
    ALTER TABLE `r2_storage_snapshots`
      ADD COLUMN `archivalChecksum` VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'r2_storage_snapshots'
      AND INDEX_NAME = 'r2ss_archivedNull_createdAt_idx'
  ) THEN
    CREATE INDEX `r2ss_archivedNull_createdAt_idx`
      ON `r2_storage_snapshots` ((`archivedAt` IS NULL), `createdAt`);
  END IF;
END;
--> statement-breakpoint

CALL `__r2ss_add_archival_columns`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__r2ss_add_archival_columns`;
