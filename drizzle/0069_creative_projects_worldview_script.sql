ALTER TABLE `creative_projects`
  ADD COLUMN `worldviewId` int NULL,
  ADD COLUMN `scriptId` int NULL;

CREATE INDEX `cp_worldviewId_idx` ON `creative_projects` (`worldviewId`);
CREATE INDEX `cp_scriptId_idx` ON `creative_projects` (`scriptId`);
