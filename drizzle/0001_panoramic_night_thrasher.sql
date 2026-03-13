CREATE TABLE `api_usage_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`requestType` enum('image_generation','video_generation','audio_generation','voice_dubbing','prompt_expansion','safety_check','director_ai') NOT NULL,
	`apiProvider` varchar(64) NOT NULL,
	`tokensUsed` int DEFAULT 0,
	`videoSeconds` int DEFAULT 0,
	`audioCharacters` int DEFAULT 0,
	`sunoCredits` int DEFAULT 0,
	`estimatedCostUsd` decimal(10,6) DEFAULT '0',
	`requestPayload` json,
	`responseStatus` enum('success','failed','timeout','blocked') NOT NULL DEFAULT 'success',
	`errorMessage` text,
	`generationsDeducted` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_usage_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `background_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`jobType` enum('image','video','audio','voice','zip_export','multimodal') NOT NULL,
	`status` enum('queued','processing','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`progress` int NOT NULL DEFAULT 0,
	`progressMessage` text,
	`resultJson` json,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `background_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `digital_asset_library` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`assetType` enum('image','video','audio','voice','script','zip_bundle') NOT NULL,
	`fileUrl` text,
	`fileKey` text,
	`thumbnailUrl` text,
	`mimeType` varchar(128),
	`fileSizeBytes` int,
	`promptUsed` text,
	`isPublicRecycled` boolean NOT NULL DEFAULT false,
	`visibility` enum('private','team_shared') NOT NULL DEFAULT 'private',
	`rewardCredits` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `digital_asset_library_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fine_tuned_models` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`modelType` enum('image_subject','voice_clone','style_lora') NOT NULL,
	`status` enum('pending','training','ready','failed') NOT NULL DEFAULT 'pending',
	`fileUrl` text,
	`fileKey` text,
	`configJson` json,
	`visibility` enum('private','team_shared') NOT NULL DEFAULT 'private',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fine_tuned_models_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_notes_calendar` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text,
	`scriptJson` json,
	`noteType` enum('note','script','calendar_event') NOT NULL DEFAULT 'note',
	`scheduledDate` timestamp,
	`tags` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_notes_calendar_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_feedback_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`category` enum('bug','feature_request','quality_issue','general') NOT NULL DEFAULT 'general',
	`title` varchar(255) NOT NULL,
	`description` text,
	`status` enum('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
	`priority` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_feedback_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `remainingGenerations` int DEFAULT 50 NOT NULL;