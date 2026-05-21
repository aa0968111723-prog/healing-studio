-- Ensure creative_projects exists in environments that missed 0067.
CREATE TABLE IF NOT EXISTS `creative_projects` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `directorSessionId` int,
  `worldFrameworkId` int,
  `worldStoryboardId` int,
  `status` enum('concept','production','review','complete') NOT NULL DEFAULT 'concept',
  `coverImageUrl` varchar(2048),
  `tags` json,
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `creative_projects_id` PRIMARY KEY(`id`)
);
CREATE INDEX IF NOT EXISTS `cp_userId_idx` ON `creative_projects` (`userId`);
CREATE INDEX IF NOT EXISTS `cp_userId_updatedAt_idx` ON `creative_projects` (`userId`,`updatedAt`);
CREATE INDEX IF NOT EXISTS `cp_worldFrameworkId_idx` ON `creative_projects` (`worldFrameworkId`);
CREATE INDEX IF NOT EXISTS `cp_worldStoryboardId_idx` ON `creative_projects` (`worldStoryboardId`);
