-- 0078: resource_shares — 跨表「顯式共享」SSOT（AIDV-121 RBAC 基礎版）
--
-- 統一記錄「某資源被顯式共享給哪個成員 / 團隊、以什麼角色」。不在各資源表
-- 硬塞欄位，改用一張泛型 junction 表表達「擁有權之外的授權」。
--
--   resourceType    → project / asset / prompt / material
--   resourceId      → 對應資源 int 主鍵
--   sharedWithType  → user（分享給單一成員）/ team（分享給整個團隊）
--   sharedWithId    → user id 或 team id
--   role            → viewer（唯讀）/ editor（可讀寫）
--   sharedByUserId  → 建立共享者（通常是 owner）
--
-- 索引：
--   rs_resource_target_uk → 同一對象對同一資源唯一（重複 share = upsert role）
--   rs_resource_idx       → 列出某資源分享給誰
--   rs_target_idx         → 列出某對象能看到哪些資源（canAccess / 清單過濾）
--
-- 純加法：本表存在 ≠ 行為改變。canAccess() 只有在 ENABLE_DATA_RBAC=ON 時
-- 才查它；旗標 OFF（預設）時所有 router 完全不碰，行為與現狀位元相同。
--
-- 冪等：同 0076 模式（information_schema 前檢 + PREPARE/EXECUTE），可安全重跑。
--
-- 回滾（rollback）：
--   DROP TABLE IF EXISTS `resource_shares`;
-- （純加法、無 FK、旗標 OFF 時無讀寫者依賴。）

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'resource_shares'
  ),
  'SELECT 1',
  'CREATE TABLE `resource_shares` (
    `id` int AUTO_INCREMENT NOT NULL,
    `resourceType` enum(''project'',''asset'',''prompt'',''material'') NOT NULL,
    `resourceId` int NOT NULL,
    `sharedWithType` enum(''user'',''team'') NOT NULL,
    `sharedWithId` int NOT NULL,
    `role` enum(''viewer'',''editor'') NOT NULL DEFAULT ''viewer'',
    `sharedByUserId` int NOT NULL,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `resource_shares_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE rs_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE rs_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rs_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'resource_shares' AND index_name = 'rs_resource_target_uk'), 'SELECT 1', 'CREATE UNIQUE INDEX `rs_resource_target_uk` ON `resource_shares` (`resourceType`,`resourceId`,`sharedWithType`,`sharedWithId`)');
--> statement-breakpoint
PREPARE rs_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE rs_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rs_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'resource_shares' AND index_name = 'rs_resource_idx'), 'SELECT 1', 'CREATE INDEX `rs_resource_idx` ON `resource_shares` (`resourceType`,`resourceId`)');
--> statement-breakpoint
PREPARE rs_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE rs_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rs_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'resource_shares' AND index_name = 'rs_target_idx'), 'SELECT 1', 'CREATE INDEX `rs_target_idx` ON `resource_shares` (`sharedWithType`,`sharedWithId`)');
--> statement-breakpoint
PREPARE rs_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE rs_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rs_stmt;
