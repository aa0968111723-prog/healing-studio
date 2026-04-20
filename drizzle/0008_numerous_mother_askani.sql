CREATE TABLE `orb_feedback_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`pageId` varchar(64),
	`actionType` varchar(32) NOT NULL,
	`status` enum('accepted','edited','cancelled','completed','failed') NOT NULL,
	`note` varchar(512),
	`actionSummary` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orb_feedback_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ofe_userId_createdAt_idx` ON `orb_feedback_events` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `ofe_userId_actionType_idx` ON `orb_feedback_events` (`userId`,`actionType`);