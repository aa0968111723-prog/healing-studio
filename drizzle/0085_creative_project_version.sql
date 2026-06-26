-- 0085: creative_project_version — AIDV-316 多代理並行編輯樂觀鎖
--
-- 目標：creative_projects 加 `version` int 欄位，讓 creativeProject.update
-- mutation 可攜帶 expectedVersion，後端做 WHERE id=? AND version=? 的原子更新；
-- version 不符時回傳 409 Conflict，代理退讓並重試，徹底消除後寫覆蓋先寫問題。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- ALTER 走 information_schema 守門，可安全重跑。
--
-- 回滾：ALTER TABLE `creative_projects` DROP COLUMN `version`;

-- ── (A) creative_projects：加樂觀鎖 version 欄位 ─────────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'creative_projects'
      AND column_name = 'version'
  ),
  'SELECT 1',
  'ALTER TABLE `creative_projects` ADD COLUMN `version` int NOT NULL DEFAULT 0'
);
--> statement-breakpoint
PREPARE cp_ver_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cp_ver_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cp_ver_stmt;
