-- 0081_orchestration_priority_scope — AIDV-331
-- (A) orchestration_runs: add priority enum (urgent / normal / background)
SET @stmt_a := IF(
  EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'orchestration_runs'
      AND column_name  = 'priority'),
  'SELECT 1',
  "ALTER TABLE `orchestration_runs` ADD COLUMN `priority` enum('urgent','normal','background') NOT NULL DEFAULT 'normal'"
);
--> statement-breakpoint
PREPARE or_priority_stmt FROM @stmt_a;
--> statement-breakpoint
EXECUTE or_priority_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE or_priority_stmt;
--> statement-breakpoint
-- (B) agent_dynamic_registry: add allowedEndpoints JSON (Agent Scope allowlist)
SET @stmt_b := IF(
  EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dynamic_registry'
      AND column_name  = 'allowedEndpoints'),
  'SELECT 1',
  'ALTER TABLE `agent_dynamic_registry` ADD COLUMN `allowedEndpoints` json'
);
--> statement-breakpoint
PREPARE adr_scope_stmt FROM @stmt_b;
--> statement-breakpoint
EXECUTE adr_scope_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE adr_scope_stmt;
