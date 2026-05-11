-- Add plan status tracking to collaboration sessions
-- This enables plan-before-navigate enforcement

ALTER TABLE `agent_collaboration_sessions`
ADD COLUMN `planStatus` ENUM('no_plan', 'planning', 'plan_approved', 'executing', 'completed')
DEFAULT 'no_plan';
--> statement-breakpoint

ALTER TABLE `agent_collaboration_sessions`
ADD COLUMN `planData` JSON DEFAULT NULL;
--> statement-breakpoint

ALTER TABLE `agent_collaboration_sessions`
ADD INDEX `plan_status_idx` (`planStatus`);
