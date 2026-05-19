-- 0061: 修復 worldbuilding_frameworks 缺漏欄位（冪等補洞）
--
-- 背景：
--   * 0049 加 `era`、0060 加動畫擴充欄位（styleProfilesJson、musicThemesJson、
--     defaultStyleProfileId、globalNegativePrompt、productionTargetsJson）。
--   * 這兩支 migration 用 plain `ALTER TABLE ... ADD COLUMN`，MySQL DDL 自動
--     提交，且不支援 `ADD COLUMN IF NOT EXISTS`。若 0060 在第一次嘗試時
--     某個 ADD COLUMN 中途出錯，前面成功的會留下、後面的不會加；接著
--     drizzle 不會把 0060 標記為已完成，下次啟動再跑就因「Duplicate column
--     name」整批 abort，從此再也補不齊 → INSERT 會撞到 "Unknown column"。
--   * 同樣的故障形態在 production 已經觀察到：用戶按「建立空白世界觀」
--     收到 `Failed query: insert into worldbuilding_frameworks (..., era,
--     ..., styleProfilesJson, ...)`。
--
-- 修法沿用本專案在 0032_agent_preferences_specialist_columns.sql 已建立的
-- 模式：用 information_schema 判斷欄位存在與否，動態 PREPARE 出 `SELECT 1`
-- 或真正的 `ALTER TABLE`。已存在則 no-op，缺漏則補上。

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'era'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `era` varchar(128) AFTER `genre`');
--> statement-breakpoint
PREPARE add_wf_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'styleProfilesJson'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `styleProfilesJson` json AFTER `linkedModelIds`');
--> statement-breakpoint
PREPARE add_wf_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'musicThemesJson'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `musicThemesJson` json AFTER `styleProfilesJson`');
--> statement-breakpoint
PREPARE add_wf_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'defaultStyleProfileId'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `defaultStyleProfileId` varchar(64) AFTER `musicThemesJson`');
--> statement-breakpoint
PREPARE add_wf_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'globalNegativePrompt'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `globalNegativePrompt` text AFTER `defaultStyleProfileId`');
--> statement-breakpoint
PREPARE add_wf_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'productionTargetsJson'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `productionTargetsJson` json AFTER `globalNegativePrompt`');
--> statement-breakpoint
PREPARE add_wf_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_col;
