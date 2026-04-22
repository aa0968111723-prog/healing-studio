ALTER TABLE `users`
  ADD COLUMN `autoCreditEnabled` boolean NOT NULL DEFAULT false,
  ADD COLUMN `autoCreditAmount` int NOT NULL DEFAULT 0,
  ADD COLUMN `autoCreditIntervalDays` int NOT NULL DEFAULT 7,
  ADD COLUMN `autoCreditNextAt` timestamp NULL,
  ADD COLUMN `autoCreditLastAt` timestamp NULL;

CREATE INDEX `users_auto_credit_due_idx`
  ON `users` (`autoCreditEnabled`, `autoCreditNextAt`);
