ALTER TABLE `users`
  ADD COLUMN `twoFactorSecret` varchar(64),
  ADD COLUMN `twoFactorEnabled` boolean NOT NULL DEFAULT false;
