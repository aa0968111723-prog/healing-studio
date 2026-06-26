CREATE TABLE IF NOT EXISTS `api_keys` (
	`id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`key_prefix` varchar(12) NOT NULL,
	`scopes` json NOT NULL,
	`last_used_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	INDEX `ak_userId_idx`(`userId`),
	UNIQUE INDEX `ak_keyHash_idx`(`key_hash`)
);
