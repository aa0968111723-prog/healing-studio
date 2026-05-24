-- 0073: data_source_connections（外部資料來源連接，冪等版）
--
-- M4/M5 創作加速層。讓使用者 / 團隊連結外部資料來源（雲端 Drive、筆記 Notion，
-- 未來 MCP）。Drive 走既有 OAuth（encryptedCredentialRef 為 null）；Notion 用
-- 後端加密的 API token 存於 encryptedCredentialRef。第一版只 read-only。
-- credential 一律不進前端 / log / prompt。可安全重跑。

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'data_source_connections'
  ),
  'SELECT 1',
  'CREATE TABLE `data_source_connections` (
    `id` int AUTO_INCREMENT NOT NULL,
    `ownerUserId` int NOT NULL,
    `teamId` int,
    `projectId` int,
    `kind` enum(''cloud'',''notes'',''mcp'',''external_api'') NOT NULL,
    `provider` varchar(64) NOT NULL,
    `authType` enum(''oauth'',''api_key'',''none'') NOT NULL DEFAULT ''api_key'',
    `encryptedCredentialRef` text,
    `configJson` json,
    `status` enum(''pending'',''active'',''disabled'',''error'') NOT NULL DEFAULT ''pending'',
    `lastHealthCheckAt` timestamp NULL,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `data_source_connections_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE dsc_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE dsc_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE dsc_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'data_source_connections' AND index_name = 'dsc_ownerUserId_idx'), 'SELECT 1', 'CREATE INDEX `dsc_ownerUserId_idx` ON `data_source_connections` (`ownerUserId`)');
--> statement-breakpoint
PREPARE dsc_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE dsc_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE dsc_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'data_source_connections' AND index_name = 'dsc_teamId_idx'), 'SELECT 1', 'CREATE INDEX `dsc_teamId_idx` ON `data_source_connections` (`teamId`)');
--> statement-breakpoint
PREPARE dsc_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE dsc_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE dsc_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'data_source_connections' AND index_name = 'dsc_projectId_idx'), 'SELECT 1', 'CREATE INDEX `dsc_projectId_idx` ON `data_source_connections` (`projectId`)');
--> statement-breakpoint
PREPARE dsc_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE dsc_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE dsc_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'data_source_connections' AND index_name = 'dsc_ownerUserId_provider_idx'), 'SELECT 1', 'CREATE INDEX `dsc_ownerUserId_provider_idx` ON `data_source_connections` (`ownerUserId`,`provider`)');
--> statement-breakpoint
PREPARE dsc_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE dsc_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE dsc_stmt;
