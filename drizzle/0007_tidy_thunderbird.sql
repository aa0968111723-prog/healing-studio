CREATE TABLE `external_service_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceName` varchar(64) NOT NULL,
	`planName` varchar(128),
	`monthlyCostUsd` decimal(10,2),
	`billingCycle` enum('monthly','annual','pay-as-you-go'),
	`nextRenewalDate` date,
	`apiKeyEnvVar` varchar(64),
	`apiKeyStatus` enum('valid','invalid','unknown') DEFAULT 'unknown',
	`workspaceName` varchar(128),
	`ownerEmail` varchar(320),
	`riskLevel` enum('low','medium','high') DEFAULT 'medium',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `external_service_subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prompt_library` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(256) NOT NULL,
	`content` text NOT NULL,
	`category` varchar(64) NOT NULL DEFAULT 'general',
	`tags` json,
	`isFavorite` boolean NOT NULL DEFAULT false,
	`isPublic` boolean NOT NULL DEFAULT false,
	`useCount` int NOT NULL DEFAULT 0,
	`modelHint` varchar(128),
	`language` varchar(8) NOT NULL DEFAULT 'zh',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prompt_library_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `r2_storage_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotDate` date NOT NULL,
	`totalBytes` bigint DEFAULT 0,
	`totalObjects` int DEFAULT 0,
	`bytesByType` json,
	`objectsByType` json,
	`estimatedMonthlyCostUsd` decimal(10,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `r2_storage_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stripeCustomerId` varchar(64),
	`stripeSubscriptionId` varchar(64),
	`planId` varchar(64) NOT NULL DEFAULT 'free',
	`status` enum('active','past_due','cancelled','trialing') DEFAULT 'active',
	`currentPeriodStart` timestamp,
	`currentPeriodEnd` timestamp,
	`cancelAtPeriodEnd` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_subscriptions_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `fine_tuned_models` MODIFY COLUMN `modelType` enum('image_subject','voice_clone','style_lora','scene_lora','video_lora','portrait_lora') NOT NULL;--> statement-breakpoint
ALTER TABLE `user_ai_brain` MODIFY COLUMN `imageEngine` varchar(128) NOT NULL DEFAULT 'fal-ai/flux-pro/v1.1';--> statement-breakpoint
ALTER TABLE `user_ai_brain` MODIFY COLUMN `videoEngine` varchar(128) NOT NULL DEFAULT 'fal-ai/kling-video/v2.1/pro/text-to-video';--> statement-breakpoint
ALTER TABLE `user_ai_brain` MODIFY COLUMN `audioEngine` varchar(128) NOT NULL DEFAULT 'fal-ai/stable-audio';--> statement-breakpoint
ALTER TABLE `user_ai_brain` MODIFY COLUMN `voiceEngine` varchar(128) NOT NULL DEFAULT 'fal-ai/metavoice-v1';--> statement-breakpoint
ALTER TABLE `fine_tuned_models` ADD `trainedLoraUrl` text;--> statement-breakpoint
ALTER TABLE `fine_tuned_models` ADD `replicatePredictionId` varchar(128);--> statement-breakpoint
ALTER TABLE `fine_tuned_models` ADD `trainingEngine` enum('replicate','fal') DEFAULT 'replicate';--> statement-breakpoint
ALTER TABLE `fine_tuned_models` ADD `usageCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falImageTo3dEngine` varchar(128) DEFAULT 'fal-ai/trellis';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falImageToImageEngine` varchar(128) DEFAULT 'fal-ai/flux/dev/image-to-image';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falImageToJsonEngine` varchar(128) DEFAULT 'fal-ai/any-llm';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falImageToVideoEngine` varchar(128) DEFAULT 'fal-ai/kling-video/v2.1/pro/image-to-video';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falJsonEngine` varchar(128) DEFAULT 'fal-ai/any-llm';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falLlmEngine` varchar(128) DEFAULT 'fal-ai/any-llm';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falTextTo3dEngine` varchar(128) DEFAULT 'fal-ai/hyper3d/rodin';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falTextToAudioEngine` varchar(128) DEFAULT 'fal-ai/stable-audio';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falTextToImageEngine` varchar(128) DEFAULT 'fal-ai/flux-pro/v1.1';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falTextToJsonEngine` varchar(128) DEFAULT 'fal-ai/any-llm';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falTextToSpeechEngine` varchar(128) DEFAULT 'fal-ai/metavoice-v1';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falTextToVideoEngine` varchar(128) DEFAULT 'fal-ai/kling-video/v2.1/pro/text-to-video';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falTrainingEngine` varchar(128) DEFAULT 'fal-ai/flux-lora-fast-training';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falVideoToAudioEngine` varchar(128) DEFAULT 'fal-ai/mmaudio-v2/video-to-audio';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falVideoToTextEngine` varchar(128) DEFAULT 'fal-ai/whisper';--> statement-breakpoint
ALTER TABLE `user_ai_brain` ADD `falVideoToVideoEngine` varchar(128) DEFAULT 'fal-ai/kling-video/v2.1/standard/video-to-video';--> statement-breakpoint
CREATE INDEX `pl_userId_idx` ON `prompt_library` (`userId`);--> statement-breakpoint
CREATE INDEX `pl_category_idx` ON `prompt_library` (`category`);--> statement-breakpoint
CREATE INDEX `aul_userId_createdAt_idx` ON `api_usage_logs` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `aul_userId_provider_idx` ON `api_usage_logs` (`userId`,`apiProvider`);--> statement-breakpoint
CREATE INDEX `userId_status_idx` ON `background_jobs` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `userId_createdAt_idx` ON `background_jobs` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cv_userId_idx` ON `consistency_vault` (`userId`);--> statement-breakpoint
CREATE INDEX `cv_userId_itemType_idx` ON `consistency_vault` (`userId`,`itemType`);--> statement-breakpoint
CREATE INDEX `cb_userId_modality_idx` ON `custom_blocks` (`userId`,`modality`);--> statement-breakpoint
CREATE INDEX `dal_userId_idx` ON `digital_asset_library` (`userId`);--> statement-breakpoint
CREATE INDEX `dal_userId_assetType_idx` ON `digital_asset_library` (`userId`,`assetType`);--> statement-breakpoint
CREATE INDEX `dal_userId_createdAt_idx` ON `digital_asset_library` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `fs_isActive_sort_idx` ON `featured_showcase` (`isActive`,`sortWeight`,`likeCount`);--> statement-breakpoint
CREATE INDEX `fs_modality_idx` ON `featured_showcase` (`modality`);--> statement-breakpoint
CREATE INDEX `fs_curator_idx` ON `featured_showcase` (`curatorUserId`);--> statement-breakpoint
CREATE INDEX `ftm_userId_status_idx` ON `fine_tuned_models` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `ftm_userId_createdAt_idx` ON `fine_tuned_models` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `userId_createdAt_idx` ON `generation_history` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `pnc_userId_idx` ON `project_notes_calendar` (`userId`);--> statement-breakpoint
CREATE INDEX `pnc_userId_noteType_idx` ON `project_notes_calendar` (`userId`,`noteType`);--> statement-breakpoint
CREATE INDEX `pnc_userId_scheduledDate_idx` ON `project_notes_calendar` (`userId`,`scheduledDate`);--> statement-breakpoint
CREATE INDEX `userId_status_idx` ON `user_feedback_reports` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `userId_createdAt_idx` ON `user_feedback_reports` (`userId`,`createdAt`);