-- 0052: users.role enum 新增 "leader"（組長）
--
-- 角色階層：user < leader < admin
--   * leader（組長）：可看「成本金流」報表 / 動自動給點設定，但不能設定他人角色
--   * admin（管理員）：原本權限不變
--   * 既有資料無痛升級（leader 只是 enum 新增值，原本的 user/admin 不動）
--
-- MySQL 對 ENUM 加值是 metadata-only，不需要重寫 rows，所以這個 migration 在大
-- table 也是秒級。

ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('user','leader','admin') NOT NULL DEFAULT 'user';
