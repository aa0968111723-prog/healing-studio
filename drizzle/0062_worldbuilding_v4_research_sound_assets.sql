-- 0062: 世界觀 v4 — 研究資料庫 / 音效庫 / 上傳資產 (全世界共用)
--
-- 三個新欄位都存於 worldbuilding_frameworks，因為它們是「全世界共用」的池子；
-- 角色 / 場景內的 realWorldRefs 與 uploadedAssets 已存在 charactersJson /
-- scenesJson 內，由 shared/worldbuilding-types.ts 維護 schema。
--
-- 重要：production 可能已經處於「部分欄位已加、但 migration 未記錄完成」的狀態。
-- 若這裡直接 ALTER TABLE ADD COLUMN，重啟時會因 Duplicate column name 讓整批
-- Drizzle migration 卡住，世界觀 create/list 也會因 schema 與資料庫不同步失敗。
-- 因此每個欄位都用 information_schema 檢查後再動態 ALTER，做到可重跑、可補洞。

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'researchEntriesJson'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `researchEntriesJson` json AFTER `productionTargetsJson`');
--> statement-breakpoint
PREPARE add_wf_v4_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_v4_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_v4_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'soundLibraryJson'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `soundLibraryJson` json AFTER `researchEntriesJson`');
--> statement-breakpoint
PREPARE add_wf_v4_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_v4_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_v4_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'uploadedAssetsJson'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `uploadedAssetsJson` json AFTER `soundLibraryJson`');
--> statement-breakpoint
PREPARE add_wf_v4_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_v4_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_v4_col;
