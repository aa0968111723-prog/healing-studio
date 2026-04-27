CREATE TABLE `password_reset_tokens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `tokenHash` varchar(128) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `used` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
  CONSTRAINT `password_reset_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);

CREATE INDEX `prt_userId_idx` ON `password_reset_tokens` (`userId`);
CREATE INDEX `prt_tokenHash_idx` ON `password_reset_tokens` (`tokenHash`);
CREATE INDEX `prt_expiresAt_idx` ON `password_reset_tokens` (`expiresAt`);
