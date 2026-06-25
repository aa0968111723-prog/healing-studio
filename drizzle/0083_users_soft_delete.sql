-- 0080: users 軟刪除欄位（AIDV-63 H9 個資出口）
--
-- 目標：為使用者帳號軟刪除功能新增 deletedAt 欄位，讓刪帳號動作可逆，符合
-- AIDV 硬底線「不可逆 prod 資料損毀走可逆路徑」。
--
-- 此 migration 做一件事：
--   users 表新增 `deletedAt` TIMESTAMP NULL DEFAULT NULL（標記帳號軟刪除時間）。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一「statement-breakpoint」標記；
-- ALTER/CREATE INDEX 走 information_schema 守門、CREATE TABLE 用 IF NOT EXISTS。
-- 可安全重跑（欄位已存在則 SELECT 1）。
--
-- 回滾：ALTER TABLE `users` DROP COLUMN `deletedAt`;

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'deletedAt'
  ),
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `deletedAt` timestamp NULL DEFAULT NULL'
);
--> statement-breakpoint
PREPARE u_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE u_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE u_stmt;
