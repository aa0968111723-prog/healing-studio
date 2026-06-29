-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一 breakpoint 一句；
-- ALTER/CREATE INDEX 走 information_schema 守門。可重跑。
CREATE TABLE IF NOT EXISTS `api_keys` (
	`id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`key_prefix` varchar(12) NOT NULL,
	`scopes` json NOT NULL,
	`last_used_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
SET @aidx := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'api_keys'
      AND index_name = 'ak_userId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `ak_userId_idx` ON `api_keys` (`userId`)'
);
--> statement-breakpoint
PREPARE _aidx FROM @aidx;
--> statement-breakpoint
EXECUTE _aidx;
--> statement-breakpoint
DEALLOCATE PREPARE _aidx;
--> statement-breakpoint
SET @aidx2 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'api_keys'
      AND index_name = 'ak_keyHash_idx'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX `ak_keyHash_idx` ON `api_keys` (`key_hash`)'
);
--> statement-breakpoint
PREPARE _aidx2 FROM @aidx2;
--> statement-breakpoint
EXECUTE _aidx2;
--> statement-breakpoint
DEALLOCATE PREPARE _aidx2;
