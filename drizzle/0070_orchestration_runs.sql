-- 0070: orchestration_runs（任務總指揮入口紀錄，冪等版）
--
-- M1-B createIntent skeleton。為避免在「table 已建立但 migration 中途失敗」的
-- 狀態下卡住，這支 migration 可安全重跑：存在就 SELECT 1，不存在才建立。

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'orchestration_runs'
  ),
  'SELECT 1',
  'CREATE TABLE `orchestration_runs` (
    `id` int AUTO_INCREMENT NOT NULL,
    `userId` int NOT NULL,
    `projectId` int,
    `teamId` int,
    `mode` enum(''create'',''director'',''video'',''assets'',''database'') NOT NULL,
    `intent` text NOT NULL,
    `status` enum(''pending'',''planned'',''waiting_confirmation'',''running'',''completed'',''failed'',''cancelled'') NOT NULL DEFAULT ''pending'',
    `commander` enum(''fallback'',''perplexity'',''subq'',''orb'',''codex'',''claude''),
    `planJson` json,
    `contextPacketIdsJson` json,
    `toolCallsJson` json,
    `citationsJson` json,
    `searchResultsJson` json,
    `estimatedCostUsd` decimal(10,6),
    `actualCostUsd` decimal(10,6),
    `errorMessage` text,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `orchestration_runs_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE orun_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE orun_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE orun_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orchestration_runs' AND index_name = 'orun_userId_idx'), 'SELECT 1', 'CREATE INDEX `orun_userId_idx` ON `orchestration_runs` (`userId`)');
--> statement-breakpoint
PREPARE orun_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE orun_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE orun_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orchestration_runs' AND index_name = 'orun_projectId_idx'), 'SELECT 1', 'CREATE INDEX `orun_projectId_idx` ON `orchestration_runs` (`projectId`)');
--> statement-breakpoint
PREPARE orun_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE orun_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE orun_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orchestration_runs' AND index_name = 'orun_projectId_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `orun_projectId_createdAt_idx` ON `orchestration_runs` (`projectId`,`createdAt`)');
--> statement-breakpoint
PREPARE orun_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE orun_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE orun_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orchestration_runs' AND index_name = 'orun_userId_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `orun_userId_createdAt_idx` ON `orchestration_runs` (`userId`,`createdAt`)');
--> statement-breakpoint
PREPARE orun_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE orun_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE orun_stmt;
