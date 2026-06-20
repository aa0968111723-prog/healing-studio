-- Ensure creative_projects exists in environments that missed 0067.
-- 冪等修復版（同 0067）：索引走 information_schema.statistics 守門、
-- 逐句「statement-breakpoint」標記分段、不用 MySQL 不支援的
-- CREATE INDEX IF NOT EXISTS。可安全重跑。

CREATE TABLE IF NOT EXISTS `creative_projects` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `directorSessionId` int,
  `worldFrameworkId` int,
  `worldStoryboardId` int,
  `status` enum('concept','production','review','complete') NOT NULL DEFAULT 'concept',
  `coverImageUrl` varchar(2048),
  `tags` json,
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `creative_projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'creative_projects' AND index_name = 'cp_userId_idx'), 'SELECT 1', 'CREATE INDEX `cp_userId_idx` ON `creative_projects` (`userId`)');
--> statement-breakpoint
PREPARE cp68_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp68_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp68_stmt;
--> statement-breakpoint
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'creative_projects' AND index_name = 'cp_userId_updatedAt_idx'), 'SELECT 1', 'CREATE INDEX `cp_userId_updatedAt_idx` ON `creative_projects` (`userId`,`updatedAt`)');
--> statement-breakpoint
PREPARE cp68_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp68_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp68_stmt;
--> statement-breakpoint
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'creative_projects' AND index_name = 'cp_worldFrameworkId_idx'), 'SELECT 1', 'CREATE INDEX `cp_worldFrameworkId_idx` ON `creative_projects` (`worldFrameworkId`)');
--> statement-breakpoint
PREPARE cp68_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp68_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp68_stmt;
--> statement-breakpoint
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'creative_projects' AND index_name = 'cp_worldStoryboardId_idx'), 'SELECT 1', 'CREATE INDEX `cp_worldStoryboardId_idx` ON `creative_projects` (`worldStoryboardId`)');
--> statement-breakpoint
PREPARE cp68_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp68_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp68_stmt;
