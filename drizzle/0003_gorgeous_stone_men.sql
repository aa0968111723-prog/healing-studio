CREATE TABLE `block_combos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`modality` enum('image','video','audio','voice') NOT NULL,
	`blockIds` json NOT NULL,
	`customBlockIds` json,
	`vibeCardIds` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `block_combos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `custom_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`modality` enum('image','video','audio','voice') NOT NULL,
	`category` varchar(64) NOT NULL,
	`label` varchar(128) NOT NULL,
	`prompt` varchar(512) NOT NULL,
	`emoji` varchar(8),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `custom_blocks_id` PRIMARY KEY(`id`)
);
