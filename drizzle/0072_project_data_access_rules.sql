-- 0072: project_data_access_rules（哪個 team / project 可用哪些內部或外部資料來源，冪等版）
--
-- M4 團隊內部資料接入創作上下文。控制 accessLevel 與可用 mode，避免只靠單一
-- visibility 欄位判斷。materialId 為單筆 teaching_materials；connectionId 為
-- 未來外部連接（MCP / cloud / notes）。不加 UNIQUE（多個 NULL 在 MySQL 視為相異，
-- 無法真正約束），改在 service 層做 upsert。可安全重跑。

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'project_data_access_rules'
  ),
  'SELECT 1',
  'CREATE TABLE `project_data_access_rules` (
    `id` int AUTO_INCREMENT NOT NULL,
    `teamId` int NOT NULL,
    `projectId` int,
    `materialId` int,
    `connectionId` int,
    `collectionId` int,
    `accessLevel` enum(''none'',''summary_only'',''chunk_access'',''full_reference'') NOT NULL DEFAULT ''summary_only'',
    `allowedModesJson` json,
    `createdBy` int NOT NULL,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `project_data_access_rules_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE pdar_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pdar_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pdar_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'project_data_access_rules' AND index_name = 'pdar_teamId_idx'), 'SELECT 1', 'CREATE INDEX `pdar_teamId_idx` ON `project_data_access_rules` (`teamId`)');
--> statement-breakpoint
PREPARE pdar_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pdar_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pdar_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'project_data_access_rules' AND index_name = 'pdar_projectId_idx'), 'SELECT 1', 'CREATE INDEX `pdar_projectId_idx` ON `project_data_access_rules` (`projectId`)');
--> statement-breakpoint
PREPARE pdar_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pdar_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pdar_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'project_data_access_rules' AND index_name = 'pdar_materialId_idx'), 'SELECT 1', 'CREATE INDEX `pdar_materialId_idx` ON `project_data_access_rules` (`materialId`)');
--> statement-breakpoint
PREPARE pdar_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pdar_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pdar_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'project_data_access_rules' AND index_name = 'pdar_teamId_projectId_idx'), 'SELECT 1', 'CREATE INDEX `pdar_teamId_projectId_idx` ON `project_data_access_rules` (`teamId`,`projectId`)');
--> statement-breakpoint
PREPARE pdar_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pdar_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pdar_stmt;
