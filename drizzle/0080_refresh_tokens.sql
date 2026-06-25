-- 0080: refresh_tokens — AIDV-230 JWT refresh token rotation + server-side revocation
--
-- 新建 refresh_tokens 表，追蹤已發放的 session JWT（以 SHA-256 hash 儲存，不存明文）。
-- 配合 ENABLE_REFRESH_TOKEN_ROTATION=true 環境變數啟用：
--   - 登入時寫入 token hash
--   - 登出時標記 revoked
--   - 每次請求驗證 hash 是否已 revoked（fail-closed）
--   - POST /api/auth/refresh：舊 token 立即作廢，換發新 token（旋轉）
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一「statement-breakpoint」標記；
-- ALTER/CREATE INDEX 走 information_schema 守門、CREATE TABLE 用 IF NOT EXISTS。
-- 可安全重跑（表/索引已存在則 SELECT 1）。
--
-- 回滾（rollback）：DROP TABLE IF EXISTS `refresh_tokens`;

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'refresh_tokens'
  ),
  'SELECT 1',
  'CREATE TABLE `refresh_tokens` (
    `id` int AUTO_INCREMENT NOT NULL,
    `tokenHash` varchar(64) NOT NULL,
    `userId` int NOT NULL,
    `status` enum(''active'',''revoked'') NOT NULL DEFAULT ''active'',
    `expiresAt` timestamp NOT NULL,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE rt_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE rt_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rt_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'refresh_tokens'
      AND index_name = 'rt_tokenHash_unique'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX `rt_tokenHash_unique` ON `refresh_tokens` (`tokenHash`)'
);
--> statement-breakpoint
PREPARE rt_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE rt_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rt_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'refresh_tokens'
      AND index_name = 'rt_userId_status_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `rt_userId_status_idx` ON `refresh_tokens` (`userId`,`status`)'
);
--> statement-breakpoint
PREPARE rt_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE rt_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rt_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'refresh_tokens'
      AND index_name = 'rt_expiresAt_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `rt_expiresAt_idx` ON `refresh_tokens` (`expiresAt`)'
);
--> statement-breakpoint
PREPARE rt_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE rt_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rt_stmt;
