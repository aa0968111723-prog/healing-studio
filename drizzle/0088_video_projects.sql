-- AIDV-252: video_projects 表 — 儲存影片格式選擇（aspect_ratio）
-- CREATE TABLE IF NOT EXISTS 冪等，不需 information_schema 守門；
-- CREATE INDEX 走 information_schema.statistics 守門（PENDING_BLOCK 鐵則）。
CREATE TABLE IF NOT EXISTS `video_projects` (
	`id` int NOT NULL AUTO_INCREMENT,
	`userId` int NOT NULL,
	`creativeProjectId` int,
	`title` varchar(255) NOT NULL DEFAULT '未命名影片',
	`aspect_ratio` enum('16:9','9:16','1:1') NOT NULL DEFAULT '16:9',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_projects_pk` PRIMARY KEY(`id`)
);
--> statement-breakpoint
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'video_projects' AND index_name = 'vp_userId_idx'), 'SELECT 1', 'CREATE INDEX `vp_userId_idx` ON `video_projects` (`userId`)');
--> statement-breakpoint
PREPARE vp84_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE vp84_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE vp84_stmt;
