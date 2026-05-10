-- 0034: extend project_notes_calendar with shoot-location, duration,
-- reminder lead time and an optional meeting URL so a single event row
-- can drive both the in-app calendar UI and an ICS feed that phone
-- alarms / native calendars can subscribe to.
--
-- Also adds users.icsFeedToken, an opaque per-user token used to build
-- the public-but-unguessable ICS subscription URL
-- (`/api/ics/<token>.ics`). Rotating the token revokes existing feeds.

ALTER TABLE `project_notes_calendar`
  ADD COLUMN `location` JSON NULL,
  ADD COLUMN `endDate` TIMESTAMP NULL,
  ADD COLUMN `reminderMinutes` INT NULL,
  ADD COLUMN `meetingUrl` VARCHAR(512) NULL;
--> statement-breakpoint

ALTER TABLE `users`
  ADD COLUMN `icsFeedToken` VARCHAR(64) NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX `users_icsFeedToken_idx` ON `users` (`icsFeedToken`);
