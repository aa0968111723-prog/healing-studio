-- 0049: 世界觀架構器新增時代背景欄位
--
-- 為 worldbuilding_frameworks 新增 era 欄位（時代背景，例如「中世紀」「未來」「架空」）
-- 與 genre（風格/類型）正交：genre 描述敘事基調，era 描述時間軸。
--
-- MySQL 不支援 `ADD COLUMN IF NOT EXISTS`，且 DDL 是自動提交、無法 rollback。
-- 一旦因任何原因（例如手動補欄位、舊版 0048 已含 era）導致這條 ALTER 失敗，
-- drizzle 就不會把本 migration 標記為已完成，後續每次重啟都會撞「Duplicate
-- column name」整批 abort、所有後面的 migration（含 0060 的動畫擴充欄位）
-- 也跟著卡住 → INSERT worldbuilding_frameworks 必然炸。
-- 沿用 0032_agent_preferences_specialist_columns.sql 的防禦模式：
-- 用 information_schema 動態判斷 era 是否已存在，已存在則 no-op。

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'worldbuilding_frameworks' AND column_name = 'era'), 'SELECT 1', 'ALTER TABLE `worldbuilding_frameworks` ADD COLUMN `era` varchar(128) AFTER `genre`');
--> statement-breakpoint
PREPARE add_wf_era FROM @stmt;
--> statement-breakpoint
EXECUTE add_wf_era;
--> statement-breakpoint
DEALLOCATE PREPARE add_wf_era;
