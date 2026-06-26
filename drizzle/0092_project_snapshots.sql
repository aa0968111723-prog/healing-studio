-- AIDV-253: project_snapshots 表 — 影片專案版本歷程 + 複製來源
-- 讓使用者可查看最近 N 個快照並一鍵回溯；duplicate mutation 也在此留源頭記錄。
--
-- 三鐵則：
--   ①禁 CREATE INDEX IF NOT EXISTS（information_schema 守門替代）
--   ②一 statement-breakpoint 一語句（mysql2 不開 multipleStatements）
--   ③ALTER / CREATE INDEX 走 information_schema 守門（裸寫重跑必爆）
--
-- 回滾：DROP TABLE IF EXISTS `project_snapshots`;

CREATE TABLE IF NOT EXISTS `project_snapshots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `snapshot` json NOT NULL,
  `source` varchar(20) NOT NULL DEFAULT 'auto',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `project_snapshots_pk` PRIMARY KEY(`id`)
);
--> statement-breakpoint
SET @stmt_ps92 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'project_snapshots'
      AND index_name = 'ps_project_id_created_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `ps_project_id_created_idx` ON `project_snapshots` (`project_id`, `created_at`)'
);
--> statement-breakpoint
PREPARE stmt_ps92 FROM @stmt_ps92;
--> statement-breakpoint
EXECUTE stmt_ps92;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_ps92;
