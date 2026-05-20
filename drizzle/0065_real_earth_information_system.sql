CREATE TABLE `real_earth_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(500) NOT NULL,
	`category` enum('history','culture','geography','architecture','language','cuisine','clothing','art','religion','society','economy','politics','military','technology','nature','folklore','education','entertainment','transportation','people') NOT NULL,
	`summary` text NOT NULL,
	`content` mediumtext NOT NULL,
	`locationJson` json,
	`historicalPeriod` varchar(200),
	`yearRangeJson` json,
	`imageUrls` json,
	`externalLinksJson` json,
	`citationsJson` json,
	`tags` json,
	`relatedEntryIds` json,
	`qualityJson` json,
	`isTaiwanFocused` boolean NOT NULL DEFAULT false,
	`language` varchar(10) DEFAULT 'zh-TW',
	`metadata` json,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `real_earth_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ree_category_idx` ON `real_earth_entries` (`category`);--> statement-breakpoint
CREATE INDEX `ree_taiwanFocused_idx` ON `real_earth_entries` (`isTaiwanFocused`);--> statement-breakpoint
CREATE INDEX `ree_createdBy_idx` ON `real_earth_entries` (`createdBy`);--> statement-breakpoint
CREATE INDEX `ree_historicalPeriod_idx` ON `real_earth_entries` (`historicalPeriod`);--> statement-breakpoint
CREATE INDEX `ree_createdAt_idx` ON `real_earth_entries` (`createdAt`);--> statement-breakpoint
CREATE INDEX `ree_title_summary_fulltext` ON `real_earth_entries` (`title`,`summary`);