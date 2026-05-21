-- 0067: 修復 worldbuilding_frameworks v4 欄位缺漏（冪等補洞）
--
-- 0062 原本曾以單一 ALTER TABLE 直接新增 researchEntriesJson、soundLibraryJson、
-- uploadedAssetsJson。若 production 在 MySQL DDL 自動提交後只完成部分欄位，或
-- migration journal 已被標記但實際欄位缺漏，世界觀 create/list 會因 Drizzle schema
-- 與資料庫不同步而失敗。
--
-- 這支 repair migration 永遠可安全重跑：欄位存在就 SELECT 1，缺漏才 ALTER。

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'researchEntriesJson'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `researchEntriesJson` json AFTER `productionTargetsJson`');
--> statement-breakpoint
PREPARE repair_wf_v4_col FROM @stmt;
--> statement-breakpoint
EXECUTE repair_wf_v4_col;
--> statement-breakpoint
DEALLOCATE PREPARE repair_wf_v4_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'soundLibraryJson'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `soundLibraryJson` json AFTER `researchEntriesJson`');
--> statement-breakpoint
PREPARE repair_wf_v4_col FROM @stmt;
--> statement-breakpoint
EXECUTE repair_wf_v4_col;
--> statement-breakpoint
DEALLOCATE PREPARE repair_wf_v4_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'uploadedAssetsJson'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `uploadedAssetsJson` json AFTER `soundLibraryJson`');
--> statement-breakpoint
PREPARE repair_wf_v4_col FROM @stmt;
--> statement-breakpoint
EXECUTE repair_wf_v4_col;
--> statement-breakpoint
DEALLOCATE PREPARE repair_wf_v4_col;
