CREATE TABLE `email_verification_tokens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `newEmail` varchar(320) NOT NULL,
  `tokenHash` varchar(128) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `used` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `email_verification_tokens_id` PRIMARY KEY(`id`),
  CONSTRAINT `email_verification_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `evt_userId_idx` ON `email_verification_tokens` (`userId`);
--> statement-breakpoint
CREATE INDEX `evt_tokenHash_idx` ON `email_verification_tokens` (`tokenHash`);
--> statement-breakpoint
CREATE INDEX `evt_expiresAt_idx` ON `email_verification_tokens` (`expiresAt`);
