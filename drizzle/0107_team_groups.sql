-- 0107: team_groups — AIDV-297 T-1 組別模型（Wave T 地基）
--
-- 把「組別型」運作模型落成資料模型，供 T-2 管理台（AIDV-298）、T-4 配額
-- （AIDV-300）、AIDV-622 限流引用。本 migration 做三件事：
--   (A) 新建 `team_groups` 表 — 組別實體（與既有 teams「共享池」正交：
--       group 是 AIDV-121 RBAC 的強制範圍單位，組間預設隔離）。
--   (B) 新建 `team_group_memberships` 表 — member–group 多對多 junction，
--       組內角色 lead（組長：管理組員、掛/摘組資源）/ member（組員）。
--   (C) 四張資源表（creative_projects / digital_asset_library /
--       prompt_library / teaching_materials）各加 nullable `groupId` 欄
--       ＋索引 — project／asset／prompt／教材歸屬到組別。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一「statement-breakpoint」標記；
-- ALTER/CREATE INDEX 走 information_schema 守門、CREATE TABLE 用 PREPARE 守門。
-- 可安全重跑（欄位/索引/表已存在則 SELECT 1）。
--
-- HARD SAFETY：純加表/加欄（groupId 預設 NULL），不改既有資料/語義。讀取端
-- 只有在 ENABLE_GROUP_SCOPE=ON（預設 OFF）時才會看 groupId；先跑 migration
-- 後開旗標安全。絕不對 prod 直接執行 DDL — 本檔僅由 drizzle-kit migrate 套用。
--
-- 回滾（rollback）：
--   ALTER TABLE `creative_projects`      DROP COLUMN `groupId`;
--   ALTER TABLE `digital_asset_library`  DROP COLUMN `groupId`;
--   ALTER TABLE `prompt_library`         DROP COLUMN `groupId`;
--   ALTER TABLE `teaching_materials`     DROP COLUMN `groupId`;
--   DROP TABLE IF EXISTS `team_group_memberships`;
--   DROP TABLE IF EXISTS `team_groups`;
-- （純加法、無 FK、旗標 OFF 時無讀寫者依賴。）

-- ── (A) team_groups — 組別實體 ───────────────────────────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'team_groups'
  ),
  'SELECT 1',
  'CREATE TABLE `team_groups` (
    `id` int AUTO_INCREMENT NOT NULL,
    `name` varchar(128) NOT NULL,
    `description` text,
    `createdByUserId` int NOT NULL,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `team_groups_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE tg_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tg_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tg_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'team_groups' AND index_name = 'tg_createdBy_idx'), 'SELECT 1', 'CREATE INDEX `tg_createdBy_idx` ON `team_groups` (`createdByUserId`)');
--> statement-breakpoint
PREPARE tg_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tg_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tg_stmt;
--> statement-breakpoint

-- ── (B) team_group_memberships — member–group 多對多 ────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'team_group_memberships'
  ),
  'SELECT 1',
  'CREATE TABLE `team_group_memberships` (
    `id` int AUTO_INCREMENT NOT NULL,
    `groupId` int NOT NULL,
    `userId` int NOT NULL,
    `role` enum(''lead'',''member'') NOT NULL DEFAULT ''member'',
    `addedByUserId` int,
    `joinedAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `team_group_memberships_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE tgm_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tgm_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tgm_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'team_group_memberships' AND index_name = 'tgm_groupId_userId_uk'), 'SELECT 1', 'CREATE UNIQUE INDEX `tgm_groupId_userId_uk` ON `team_group_memberships` (`groupId`,`userId`)');
--> statement-breakpoint
PREPARE tgm_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tgm_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tgm_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'team_group_memberships' AND index_name = 'tgm_userId_idx'), 'SELECT 1', 'CREATE INDEX `tgm_userId_idx` ON `team_group_memberships` (`userId`)');
--> statement-breakpoint
PREPARE tgm_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tgm_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tgm_stmt;
--> statement-breakpoint

-- ── (C) 資源表掛組別欄位（nullable、預設 NULL＝未歸組，行為不變）──────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'creative_projects'
      AND column_name = 'groupId'
  ),
  'SELECT 1',
  'ALTER TABLE `creative_projects` ADD COLUMN `groupId` int'
);
--> statement-breakpoint
PREPARE cp_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'creative_projects' AND index_name = 'cp_groupId_idx'), 'SELECT 1', 'CREATE INDEX `cp_groupId_idx` ON `creative_projects` (`groupId`)');
--> statement-breakpoint
PREPARE cp_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'digital_asset_library'
      AND column_name = 'groupId'
  ),
  'SELECT 1',
  'ALTER TABLE `digital_asset_library` ADD COLUMN `groupId` int'
);
--> statement-breakpoint
PREPARE dal_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE dal_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE dal_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'digital_asset_library' AND index_name = 'dal_groupId_idx'), 'SELECT 1', 'CREATE INDEX `dal_groupId_idx` ON `digital_asset_library` (`groupId`)');
--> statement-breakpoint
PREPARE dal_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE dal_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE dal_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'prompt_library'
      AND column_name = 'groupId'
  ),
  'SELECT 1',
  'ALTER TABLE `prompt_library` ADD COLUMN `groupId` int'
);
--> statement-breakpoint
PREPARE pl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pl_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'prompt_library' AND index_name = 'pl_groupId_idx'), 'SELECT 1', 'CREATE INDEX `pl_groupId_idx` ON `prompt_library` (`groupId`)');
--> statement-breakpoint
PREPARE pl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE pl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE pl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'teaching_materials'
      AND column_name = 'groupId'
  ),
  'SELECT 1',
  'ALTER TABLE `teaching_materials` ADD COLUMN `groupId` int'
);
--> statement-breakpoint
PREPARE tmg_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tmg_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tmg_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'teaching_materials' AND index_name = 'tm_groupId_idx'), 'SELECT 1', 'CREATE INDEX `tm_groupId_idx` ON `teaching_materials` (`groupId`)');
--> statement-breakpoint
PREPARE tmg_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tmg_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tmg_stmt;
