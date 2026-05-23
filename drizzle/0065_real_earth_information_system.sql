-- 0065: real earth information system（冪等修復版）
--
-- 為避免在「table 已建立但 migration 中途失敗」的狀態下卡住，
-- 這支 migration 改成可安全重跑：存在就 SELECT 1，不存在才建立。

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'real_earth_entries'
  ),
  'SELECT 1',
  'CREATE TABLE `real_earth_entries` (
    `id` int AUTO_INCREMENT NOT NULL,
    `title` varchar(500) NOT NULL,
    `category` enum(''history'',''culture'',''geography'',''architecture'',''language'',''cuisine'',''clothing'',''art'',''religion'',''society'',''economy'',''politics'',''military'',''technology'',''nature'',''folklore'',''education'',''entertainment'',''transportation'',''people'') NOT NULL,
    `summary` text NOT NULL,
    `content` mediumtext NOT NULL,
    `locationJson` json,
    `historicalPeriod` varchar(200),
    `yearRangeJson` json,
    `imageUrls` json,
    `externalLinksJson` json,
    `citationsJson` json,
    `tags` json,
    `relatedEntryIds` json,
    `qualityJson` json,
    `isTaiwanFocused` boolean NOT NULL DEFAULT false,
    `language` varchar(10) DEFAULT ''zh-TW'',
    `metadata` json,
    `createdBy` int,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `real_earth_entries_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE ree_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ree_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ree_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'real_earth_entries' AND index_name = 'ree_category_idx'), 'SELECT 1', 'CREATE INDEX `ree_category_idx` ON `real_earth_entries` (`category`)');
--> statement-breakpoint
PREPARE ree_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ree_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ree_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'real_earth_entries' AND index_name = 'ree_taiwanFocused_idx'), 'SELECT 1', 'CREATE INDEX `ree_taiwanFocused_idx` ON `real_earth_entries` (`isTaiwanFocused`)');
--> statement-breakpoint
PREPARE ree_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ree_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ree_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'real_earth_entries' AND index_name = 'ree_createdBy_idx'), 'SELECT 1', 'CREATE INDEX `ree_createdBy_idx` ON `real_earth_entries` (`createdBy`)');
--> statement-breakpoint
PREPARE ree_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ree_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ree_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'real_earth_entries' AND index_name = 'ree_historicalPeriod_idx'), 'SELECT 1', 'CREATE INDEX `ree_historicalPeriod_idx` ON `real_earth_entries` (`historicalPeriod`)');
--> statement-breakpoint
PREPARE ree_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ree_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ree_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'real_earth_entries' AND index_name = 'ree_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `ree_createdAt_idx` ON `real_earth_entries` (`createdAt`)');
--> statement-breakpoint
PREPARE ree_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ree_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ree_stmt;
--> statement-breakpoint

-- summary 為 TEXT，不能用一般 BTREE 複合索引；改用 FULLTEXT。
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'real_earth_entries' AND index_name = 'ree_title_summary_fulltext'), 'SELECT 1', 'CREATE FULLTEXT INDEX `ree_title_summary_fulltext` ON `real_earth_entries` (`title`,`summary`)');
--> statement-breakpoint
PREPARE ree_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ree_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ree_stmt;
