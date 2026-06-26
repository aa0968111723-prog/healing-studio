-- 0090: r2_object_catalog — AIDV-66 M3 媒體儲存版本化/快照
--
-- 目標：新建 r2_object_catalog 表，定期捕捉 R2 bucket 中 archived/ 前綴的每個物件
-- 的 key、大小、etag、lastModified，讓媒體不再只靠單一 bucket 物件保證存在。
-- 每日快照結束後，可透過此表偵測遺失物件並觸發回溯。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- ALTER TABLE / CREATE INDEX 走 information_schema 守門；CREATE TABLE 用 IF NOT EXISTS 語意守門。
-- 可安全重跑（表已存在 → SET = SELECT 1，INDEX 已存在 → SELECT 1）。
--
-- 回滾：DROP TABLE IF EXISTS `r2_object_catalog`;

-- ── (A) r2_object_catalog 表 ─────────────────────────────────────────────────

SET @r2oc_create := IF(
  EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'r2_object_catalog'
  ),
  'SELECT 1',
  'CREATE TABLE `r2_object_catalog` (
    `id` int NOT NULL AUTO_INCREMENT,
    `snapshotId` int NOT NULL,
    `objectKey` varchar(1024) NOT NULL,
    `fileSizeBytes` bigint NOT NULL DEFAULT 0,
    `etag` varchar(64),
    `category` varchar(32),
    `lastModified` timestamp NULL,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `r2oc_pk` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE r2oc_create_stmt FROM @r2oc_create;
--> statement-breakpoint
EXECUTE r2oc_create_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE r2oc_create_stmt;
--> statement-breakpoint

-- ── (B) snapshotId INDEX（FK 查詢熱路徑）────────────────────────────────────

SET @r2oc_idx1 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'r2_object_catalog'
      AND index_name = 'r2oc_snapshotId_idx'
  ),
  'SELECT 1',
  'ALTER TABLE `r2_object_catalog` ADD INDEX `r2oc_snapshotId_idx` (`snapshotId`)'
);
--> statement-breakpoint
PREPARE r2oc_idx1_stmt FROM @r2oc_idx1;
--> statement-breakpoint
EXECUTE r2oc_idx1_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE r2oc_idx1_stmt;
--> statement-breakpoint

-- ── (C) objectKey 前綴 INDEX（key 查詢，prefix 255 chars）───────────────────

SET @r2oc_idx2 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'r2_object_catalog'
      AND index_name = 'r2oc_objectKey_idx'
  ),
  'SELECT 1',
  'ALTER TABLE `r2_object_catalog` ADD INDEX `r2oc_objectKey_idx` (`objectKey`(255))'
);
--> statement-breakpoint
PREPARE r2oc_idx2_stmt FROM @r2oc_idx2;
--> statement-breakpoint
EXECUTE r2oc_idx2_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE r2oc_idx2_stmt;
