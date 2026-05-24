-- 0071: context_packets（可重用的創作上下文包，冪等版）
--
-- M4 團隊內部資料接入創作上下文。把 project + 團隊資料 + 外部來源摘成可重用、
-- 有 TTL 的小上下文包，降低重複長上下文成本。可安全重跑：存在就 SELECT 1，
-- 不存在才建立。

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'context_packets'
  ),
  'SELECT 1',
  'CREATE TABLE `context_packets` (
    `id` int AUTO_INCREMENT NOT NULL,
    `projectId` int NOT NULL,
    `teamId` int,
    `userId` int NOT NULL,
    `scope` enum(''project'',''team'',''user'') NOT NULL DEFAULT ''project'',
    `sourceRefsJson` json,
    `summaryMarkdown` mediumtext,
    `tokenEstimate` int,
    `createdByModel` varchar(64),
    `expiresAt` timestamp NULL,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `context_packets_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE cp_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'context_packets' AND index_name = 'cp_projectId_idx'), 'SELECT 1', 'CREATE INDEX `cp_projectId_idx` ON `context_packets` (`projectId`)');
--> statement-breakpoint
PREPARE cp_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'context_packets' AND index_name = 'cp_projectId_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `cp_projectId_createdAt_idx` ON `context_packets` (`projectId`,`createdAt`)');
--> statement-breakpoint
PREPARE cp_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'context_packets' AND index_name = 'cp_userId_idx'), 'SELECT 1', 'CREATE INDEX `cp_userId_idx` ON `context_packets` (`userId`)');
--> statement-breakpoint
PREPARE cp_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'context_packets' AND index_name = 'cp_teamId_idx'), 'SELECT 1', 'CREATE INDEX `cp_teamId_idx` ON `context_packets` (`teamId`)');
--> statement-breakpoint
PREPARE cp_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'context_packets' AND index_name = 'cp_expiresAt_idx'), 'SELECT 1', 'CREATE INDEX `cp_expiresAt_idx` ON `context_packets` (`expiresAt`)');
--> statement-breakpoint
PREPARE cp_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp_stmt;
