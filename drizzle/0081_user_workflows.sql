CREATE TABLE IF NOT EXISTS `user_workflows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stepsJson` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_workflows_pk` PRIMARY KEY(`id`),
	CONSTRAINT `uw_userId_unique` UNIQUE(`userId`)
);
