-- 0076: global_audit_log — 全站操作稽核軌跡（AIDV-123）
--
-- Append-only 稽核表：統一記錄全站「關鍵寫入」操作（登入、建立/修改/刪除
-- 專案・資產・提示詞・教材、共享/撤銷、生成、連接器授權、成本操作）。
--
--   actorUserId  → 操作者 user id（系統/匿名可為 null）
--   actorRole    → 操作者角色快照（admin/leader/user…）
--   action       → <domain>.<verb> 動作語意（varchar，新增動作純加法、不動 migration）
--   targetType   → 目標物型別（project/asset/prompt/material/consent/user…）
--   targetId     → 目標物 id（varchar，相容 int/uuid/複合 key）
--   result       → success / failure
--   ipAddress    → 來源 IP（IPv6-safe 長度 45）
--   userAgent    → 來源裝置 / UA
--   metadata     → 附加 context（變更前後值、失敗原因、查詢字串等）
--   createdAt    → 寫入時間
--
-- 索引：gal_actor_createdAt_idx / gal_action_createdAt_idx /
--       gal_target_createdAt_idx / gal_createdAt_idx
--       （對應 admin 查詢：依成員 / 動作 / 目標物 / 時間過濾＋排序）
--
-- 不可竄改：只有 INSERT 端點，無 update/delete service 或 router。
-- Best-effort：寫入失敗絕不阻斷原操作（見 server/services/audit/auditLog.ts）。
--
-- 冪等：同 0075 模式（information_schema 前檢 + PREPARE/EXECUTE），可安全重跑。
--
-- 回滾（rollback）：
--   DROP TABLE IF EXISTS `global_audit_log`;
-- （本表純加法、無 FK、無外部寫入者依賴；移除前確認 admin 稽核頁未啟用即可。）

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'global_audit_log'
  ),
  'SELECT 1',
  'CREATE TABLE `global_audit_log` (
    `id` bigint AUTO_INCREMENT NOT NULL,
    `actorUserId` int,
    `actorRole` varchar(50),
    `action` varchar(100) NOT NULL,
    `targetType` varchar(50),
    `targetId` varchar(100),
    `result` enum(''success'',''failure'') NOT NULL DEFAULT ''success'',
    `ipAddress` varchar(45),
    `userAgent` text,
    `metadata` json,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `global_audit_log_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE gal_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE gal_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE gal_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'global_audit_log' AND index_name = 'gal_actor_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `gal_actor_createdAt_idx` ON `global_audit_log` (`actorUserId`,`createdAt`)');
--> statement-breakpoint
PREPARE gal_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE gal_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE gal_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'global_audit_log' AND index_name = 'gal_action_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `gal_action_createdAt_idx` ON `global_audit_log` (`action`,`createdAt`)');
--> statement-breakpoint
PREPARE gal_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE gal_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE gal_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'global_audit_log' AND index_name = 'gal_target_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `gal_target_createdAt_idx` ON `global_audit_log` (`targetType`,`targetId`,`createdAt`)');
--> statement-breakpoint
PREPARE gal_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE gal_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE gal_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'global_audit_log' AND index_name = 'gal_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `gal_createdAt_idx` ON `global_audit_log` (`createdAt`)');
--> statement-breakpoint
PREPARE gal_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE gal_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE gal_stmt;
