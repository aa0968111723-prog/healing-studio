-- AIDV-131 S-6: Skill Sandbox — manifestChecksum + needsReaudit 供應鏈欄位
-- 三鐵則：①禁 CREATE INDEX IF NOT EXISTS ②一 breakpoint 一句 ③ALTER/CREATE INDEX 走 information_schema 守門

-- ── manifestChecksum ─────────────────────────────────────────────────────────
SET @sr_cksum_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'skill_registry'
      AND column_name  = 'manifestChecksum'
  ),
  'SELECT 1',
  'ALTER TABLE `skill_registry` ADD COLUMN `manifestChecksum` varchar(64)'
);
--> statement-breakpoint
PREPARE sr_cksum_stmt FROM @sr_cksum_stmt;
--> statement-breakpoint
EXECUTE sr_cksum_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE sr_cksum_stmt;
--> statement-breakpoint

-- ── needsReaudit ─────────────────────────────────────────────────────────────
SET @sr_reaudit_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'skill_registry'
      AND column_name  = 'needsReaudit'
  ),
  'SELECT 1',
  'ALTER TABLE `skill_registry` ADD COLUMN `needsReaudit` tinyint(1) NOT NULL DEFAULT 0'
);
--> statement-breakpoint
PREPARE sr_reaudit_stmt FROM @sr_reaudit_stmt;
--> statement-breakpoint
EXECUTE sr_reaudit_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE sr_reaudit_stmt;
--> statement-breakpoint

-- ── INDEX skill_registry_reaudit_idx ─────────────────────────────────────────
SET @sr_reaudit_idx := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'skill_registry'
      AND index_name   = 'skill_registry_reaudit_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `skill_registry_reaudit_idx` ON `skill_registry` (`needsReaudit`)'
);
--> statement-breakpoint
PREPARE sr_reaudit_idx FROM @sr_reaudit_idx;
--> statement-breakpoint
EXECUTE sr_reaudit_idx;
--> statement-breakpoint
DEALLOCATE PREPARE sr_reaudit_idx;
