-- 0084: orb_workflow_step_executions Skill 欄位（AIDV-126 S-1 manifest）
--
-- 目標：讓 workflow step 可承載 Skill 實例（哪個 skill、版本、輸入快照、
-- 權限快照）。4 個 NULL 欄位，向下相容——非 Skill-backed 步驟留 NULL。
--
-- 新增欄位：
--   skillId           VARCHAR(128) NULL  — skill manifest 的 id（例 "storyboard.breakdown"）
--   skillVersion      VARCHAR(32)  NULL  — pin 版本（semver）
--   inputSnapshot     JSON         NULL  — 執行時的輸入快照（稽核用）
--   permissionSnapshot JSON         NULL  — 本次授予的權限快照
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一 breakpoint 一句；ALTER/CREATE INDEX
-- 走 information_schema 守門。可安全重跑（欄位已存在則 SELECT 1）。
--
-- 回滾：
--   ALTER TABLE `orb_workflow_step_executions` DROP COLUMN `skillId`;
--   ALTER TABLE `orb_workflow_step_executions` DROP COLUMN `skillVersion`;
--   ALTER TABLE `orb_workflow_step_executions` DROP COLUMN `inputSnapshot`;
--   ALTER TABLE `orb_workflow_step_executions` DROP COLUMN `permissionSnapshot`;

SET @s1 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orb_workflow_step_executions'
      AND column_name = 'skillId'
  ),
  'SELECT 1',
  'ALTER TABLE `orb_workflow_step_executions` ADD COLUMN `skillId` varchar(128) NULL'
);
--> statement-breakpoint
PREPARE _s1 FROM @s1;
--> statement-breakpoint
EXECUTE _s1;
--> statement-breakpoint
DEALLOCATE PREPARE _s1;
--> statement-breakpoint
SET @s2 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orb_workflow_step_executions'
      AND column_name = 'skillVersion'
  ),
  'SELECT 1',
  'ALTER TABLE `orb_workflow_step_executions` ADD COLUMN `skillVersion` varchar(32) NULL'
);
--> statement-breakpoint
PREPARE _s2 FROM @s2;
--> statement-breakpoint
EXECUTE _s2;
--> statement-breakpoint
DEALLOCATE PREPARE _s2;
--> statement-breakpoint
SET @s3 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orb_workflow_step_executions'
      AND column_name = 'inputSnapshot'
  ),
  'SELECT 1',
  'ALTER TABLE `orb_workflow_step_executions` ADD COLUMN `inputSnapshot` json NULL'
);
--> statement-breakpoint
PREPARE _s3 FROM @s3;
--> statement-breakpoint
EXECUTE _s3;
--> statement-breakpoint
DEALLOCATE PREPARE _s3;
--> statement-breakpoint
SET @s4 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orb_workflow_step_executions'
      AND column_name = 'permissionSnapshot'
  ),
  'SELECT 1',
  'ALTER TABLE `orb_workflow_step_executions` ADD COLUMN `permissionSnapshot` json NULL'
);
--> statement-breakpoint
PREPARE _s4 FROM @s4;
--> statement-breakpoint
EXECUTE _s4;
--> statement-breakpoint
DEALLOCATE PREPARE _s4;
--> statement-breakpoint
SET @sidx := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'orb_workflow_step_executions'
      AND index_name = 'orb_workflow_step_skill_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `orb_workflow_step_skill_idx` ON `orb_workflow_step_executions` (`skillId`)'
);
--> statement-breakpoint
PREPARE _sidx FROM @sidx;
--> statement-breakpoint
EXECUTE _sidx;
--> statement-breakpoint
DEALLOCATE PREPARE _sidx;
