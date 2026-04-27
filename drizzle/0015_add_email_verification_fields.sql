ALTER TABLE `users`
  ADD COLUMN `emailVerified` boolean NOT NULL DEFAULT false,
  ADD COLUMN `emailVerifiedAt` timestamp NULL;
