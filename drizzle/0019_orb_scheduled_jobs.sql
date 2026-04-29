-- 0019: persistence for the global orb agent's scheduled jobs.
-- Up to now the cron registry was in-memory only, so user-defined
-- schedules disappeared on every server restart. This table is the
-- source of truth; on boot the scheduler rebuilds node-cron from rows.

CREATE TABLE IF NOT EXISTS `orb_scheduled_jobs` (
  `id` varchar(128) NOT NULL,
  `userId` int NOT NULL,
  `cronExpression` varchar(128) NOT NULL,
  `taskDescription` text NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `lastRunAt` timestamp NULL,
  `lastError` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orb_scheduled_jobs_user_id_idx` (`userId`)
);
