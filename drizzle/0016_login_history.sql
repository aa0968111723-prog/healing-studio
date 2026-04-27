CREATE TABLE `login_history` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `email` varchar(320),
  `success` boolean NOT NULL DEFAULT true,
  `ipAddress` varchar(45),
  `userAgent` text,
  `device` varchar(100),
  `browser` varchar(100),
  `os` varchar(100),
  `country` varchar(100),
  `city` varchar(100),
  `failureReason` varchar(255),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `login_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `lh_userId_idx` ON `login_history` (`userId`);
--> statement-breakpoint
CREATE INDEX `lh_userId_createdAt_idx` ON `login_history` (`userId`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `lh_email_idx` ON `login_history` (`email`);
