-- 0033: Add plan status tracking to collaboration sessions
-- Enables plan-before-navigate enforcement (planStatus / planData + plan_status_idx).
--
-- 孤兒補登記（AIDV-17）：此檔當初寫好後忘了登記 _journal.json，drizzle migrate
-- 從未套用，三項變更（planStatus、planData、plan_status_idx）在生產從未建立。
-- 與已登記的 0033_agent_model_picks 撞號但為不同檔。補登記後會在下次部署套用，
-- 故改寫為「永遠可安全重跑」的冪等形式：欄位/索引存在就 SELECT 1，缺漏才 ALTER
-- （資訊綱要守門 + PREPARE/EXECUTE 動態語句）。

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'agent_collaboration_sessions' AND column_name = 'planStatus'), 'SELECT 1', 'ALTER TABLE `agent_collaboration_sessions` ADD COLUMN `planStatus` ENUM(''no_plan'', ''planning'', ''plan_approved'', ''executing'', ''completed'') DEFAULT ''no_plan''');
--> statement-breakpoint
PREPARE add_plan_status_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE add_plan_status_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE add_plan_status_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'agent_collaboration_sessions' AND column_name = 'planData'), 'SELECT 1', 'ALTER TABLE `agent_collaboration_sessions` ADD COLUMN `planData` JSON DEFAULT NULL');
--> statement-breakpoint
PREPARE add_plan_status_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE add_plan_status_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE add_plan_status_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'agent_collaboration_sessions' AND index_name = 'plan_status_idx'), 'SELECT 1', 'ALTER TABLE `agent_collaboration_sessions` ADD INDEX `plan_status_idx` (`planStatus`)');
--> statement-breakpoint
PREPARE add_plan_status_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE add_plan_status_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE add_plan_status_stmt;
