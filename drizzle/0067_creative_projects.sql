-- Creative Projects: Binds Director sessions, Worldbuilding frameworks, and
-- World Storyboards together so the Orb and Studio pages can share context
-- across the whole creative pipeline.
--
-- References (intentionally NOT foreign keys to allow flexible re-binding):
--   directorSessionId  → project_notes_calendar.id (Director sessions are
--                        stored there with noteType = "script" and tag
--                        "director-session")
--   worldFrameworkId   → worldbuilding_frameworks.id
--   worldStoryboardId  → world_storyboards.id

CREATE TABLE `creative_projects` (
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

CREATE INDEX `cp_userId_idx` ON `creative_projects` (`userId`);
CREATE INDEX `cp_userId_updatedAt_idx` ON `creative_projects` (`userId`,`updatedAt`);
CREATE INDEX `cp_worldFrameworkId_idx` ON `creative_projects` (`worldFrameworkId`);
CREATE INDEX `cp_worldStoryboardId_idx` ON `creative_projects` (`worldStoryboardId`);
