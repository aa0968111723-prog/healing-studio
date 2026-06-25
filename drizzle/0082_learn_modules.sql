-- 0082_learn_modules — AIDV-214 learnHub 管理員建立文件持久化
--
-- 目標：新建 learn_modules 表，使管理員後台新增的學習文件在重啟後不遺失。
-- 種子文件（SEED_DOCS）仍維持程式碼靜態資料；此表只儲存管理員 create/import 的文件。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 breakpoint；
-- CREATE TABLE 用 information_schema 守門（等同 IF NOT EXISTS，可安全重跑）。
-- 回滾：DROP TABLE IF EXISTS `learn_modules`;

-- ── (A) learn_modules 表 ─────────────────────────────────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'learn_modules'
  ),
  'SELECT 1',
  'CREATE TABLE `learn_modules` (
    `id` varchar(128) NOT NULL,
    `category` varchar(32) NOT NULL,
    `title` varchar(200) NOT NULL,
    `summary` varchar(500) NOT NULL,
    `content` mediumtext NOT NULL,
    `tags` json NOT NULL,
    `difficulty` enum(''beginner'',''intermediate'',''advanced'') NOT NULL DEFAULT ''beginner'',
    `readingMinutes` int NOT NULL DEFAULT 5,
    `featured` tinyint(1) NOT NULL DEFAULT 0,
    `authorName` varchar(100),
    `externalUrl` varchar(500),
    `attachments` json NOT NULL,
    `publishedAt` timestamp NOT NULL DEFAULT (now()),
    `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `lm_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE lm_create_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE lm_create_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE lm_create_stmt;
--> statement-breakpoint

-- ── (B) featured index（快速撈 featured=1 的文件） ────────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'learn_modules'
      AND index_name = 'lm_featured_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `lm_featured_idx` ON `learn_modules` (`featured`)'
);
--> statement-breakpoint
PREPARE lm_idx_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE lm_idx_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE lm_idx_stmt;
