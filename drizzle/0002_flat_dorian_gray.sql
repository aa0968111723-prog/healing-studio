CREATE TABLE `ai_director_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`personality` enum('calm','creative','technical') NOT NULL DEFAULT 'creative',
	`preferredFormat` enum('co-star','sslcm','selcm','free') NOT NULL DEFAULT 'co-star',
	`customSystemPrompt` text,
	`preferencesJson` json,
	`onboardingSteps` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_director_preferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consistency_vault` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(256) NOT NULL,
	`itemType` enum('character','scene') NOT NULL,
	`imageUrl` text NOT NULL,
	`fileKey` text,
	`tags` json,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `consistency_vault_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `generation_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`requestId` int,
	`modality` enum('image','video','audio','voice') NOT NULL,
	`prompt` text,
	`compiledPrompt` text,
	`parameterSnapshot` json,
	`resultUrl` text,
	`thumbnailUrl` text,
	`userRating` int,
	`isBookmarked` boolean NOT NULL DEFAULT false,
	`costCredits` int NOT NULL DEFAULT 1,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `generation_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`tier` enum('free','starter','pro','enterprise') NOT NULL DEFAULT 'free',
	`priceMonthly` int NOT NULL DEFAULT 0,
	`quotaAllocation` json NOT NULL,
	`features` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscription_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `background_jobs` MODIFY COLUMN `jobType` enum('image','video','audio','voice','zip_export','multimodal','model_training') NOT NULL;--> statement-breakpoint
ALTER TABLE `api_usage_logs` ADD `model` varchar(128);--> statement-breakpoint
ALTER TABLE `api_usage_logs` ADD `inputTokens` int;--> statement-breakpoint
ALTER TABLE `api_usage_logs` ADD `outputTokens` int;--> statement-breakpoint
ALTER TABLE `api_usage_logs` ADD `modalityParams` json;--> statement-breakpoint
ALTER TABLE `api_usage_logs` ADD `costCredits` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `api_usage_logs` ADD `durationMs` int;--> statement-breakpoint
ALTER TABLE `api_usage_logs` ADD `success` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `quotaJson` json;--> statement-breakpoint
ALTER TABLE `users` ADD `onboardingDone` boolean DEFAULT false NOT NULL;