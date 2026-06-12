-- 0069: creative_projects 加 worldviewId / scriptId（Phase 1 alias，冪等修復版）
--
-- 原版是裸 ALTER＋裸 CREATE INDEX 且無 statement-breakpoint：重跑會撞
-- Duplicate column / Duplicate key name。改成存在就 SELECT 1，可安全重跑。

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'creative_projects'
      AND column_name = 'worldviewId'
  ),
  'SELECT 1',
  'ALTER TABLE `creative_projects` ADD COLUMN `worldviewId` int NULL'
);
--> statement-breakpoint
PREPARE cp69_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp69_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp69_stmt;
--> statement-breakpoint
SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'creative_projects'
      AND column_name = 'scriptId'
  ),
  'SELECT 1',
  'ALTER TABLE `creative_projects` ADD COLUMN `scriptId` int NULL'
);
--> statement-breakpoint
PREPARE cp69_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp69_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp69_stmt;
--> statement-breakpoint
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'creative_projects' AND index_name = 'cp_worldviewId_idx'), 'SELECT 1', 'CREATE INDEX `cp_worldviewId_idx` ON `creative_projects` (`worldviewId`)');
--> statement-breakpoint
PREPARE cp69_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp69_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp69_stmt;
--> statement-breakpoint
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'creative_projects' AND index_name = 'cp_scriptId_idx'), 'SELECT 1', 'CREATE INDEX `cp_scriptId_idx` ON `creative_projects` (`scriptId`)');
--> statement-breakpoint
PREPARE cp69_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp69_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp69_stmt;
