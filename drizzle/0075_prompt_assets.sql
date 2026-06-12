-- 0075: prompt_assets — prompt ↔ 資產 junction 表（已拍板採 junction，非單一 assetId 欄）
--
-- 生成完成鏈（postGenActions.doPostGenComplete）在 prompt 長度 >= 4 時會自動寫
-- prompt_library、有 resultUrl 時寫 digital_asset_library — 但兩者之間沒有任何
-- 關聯，「這張圖是哪個提示詞生的」只能靠 promptUsed 純文字反查。本表補上這條邊：
--
--   promptId  → prompt_library.id        (FK, ON DELETE CASCADE)
--   assetId   → digital_asset_library.id (FK, ON DELETE CASCADE)
--   relation  : derived(生成鏈自動) / variant(重骰變體) / rewrite(改寫承接) / extended(延長)
--   createdAt : 建邊時間
--
-- 索引：pa_promptId_idx / pa_assetId_idx（雙向查詢）＋
--       pa_prompt_asset_rel_unique (promptId, assetId, relation) 唯一鍵 —
--       生成鏈 webhook+polling 雙路徑重跑與 backfill 重跑的冪等保證。
--
-- 寫入端掛 env 旗標 ENABLE_PROMPT_ASSET_LINKS（預設 OFF）；讀取 procedure 對
-- 空表完全相容（回空陣列），所以本 migration 先行、旗標後開是安全的。
--
-- 冪等：同 0071 模式（information_schema 前檢 + PREPARE/EXECUTE），可安全重跑。
--
-- 回滾（rollback）：
--   ALTER TABLE `prompt_assets` DROP FOREIGN KEY `pa_promptId_fk`;
--   ALTER TABLE `prompt_assets` DROP FOREIGN KEY `pa_assetId_fk`;
--   DROP TABLE IF EXISTS `prompt_assets`;
-- （回滾後：旗標 OFF 時生成鏈完全不碰本表；讀取 procedure 在表缺失時會拋錯，
--   故回滾前請先確認 ENABLE_PROMPT_ASSET_LINKS=0 且前端未啟用關聯 UI。）

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'prompt_assets'
  ),
  'SELECT 1',
  'CREATE TABLE `prompt_assets` (
    `id` int AUTO_INCREMENT NOT NULL,
    `promptId` int NOT NULL,
    `assetId` int NOT NULL,
    `relation` enum(''derived'',''variant'',''rewrite'',''extended'') NOT NULL DEFAULT ''derived'',
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `prompt_assets_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE pa_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pa_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pa_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'prompt_assets' AND index_name = 'pa_promptId_idx'), 'SELECT 1', 'CREATE INDEX `pa_promptId_idx` ON `prompt_assets` (`promptId`)');
--> statement-breakpoint
PREPARE pa_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pa_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pa_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'prompt_assets' AND index_name = 'pa_assetId_idx'), 'SELECT 1', 'CREATE INDEX `pa_assetId_idx` ON `prompt_assets` (`assetId`)');
--> statement-breakpoint
PREPARE pa_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pa_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pa_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'prompt_assets' AND index_name = 'pa_prompt_asset_rel_unique'), 'SELECT 1', 'CREATE UNIQUE INDEX `pa_prompt_asset_rel_unique` ON `prompt_assets` (`promptId`,`assetId`,`relation`)');
--> statement-breakpoint
PREPARE pa_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pa_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pa_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'prompt_assets' AND constraint_name = 'pa_promptId_fk'), 'SELECT 1', 'ALTER TABLE `prompt_assets` ADD CONSTRAINT `pa_promptId_fk` FOREIGN KEY (`promptId`) REFERENCES `prompt_library`(`id`) ON DELETE CASCADE');
--> statement-breakpoint
PREPARE pa_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pa_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pa_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'prompt_assets' AND constraint_name = 'pa_assetId_fk'), 'SELECT 1', 'ALTER TABLE `prompt_assets` ADD CONSTRAINT `pa_assetId_fk` FOREIGN KEY (`assetId`) REFERENCES `digital_asset_library`(`id`) ON DELETE CASCADE');
--> statement-breakpoint
PREPARE pa_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pa_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pa_stmt;
