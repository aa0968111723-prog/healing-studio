-- AIDV-269: 創作者端 Webhook 訂閱表
-- webhook_subscriptions: 訂閱登錄（URL + 事件選擇 + HMAC 密鑰）
-- webhook_delivery_history: 派發歷史（最近 50 筆，含狀態與回應碼）
-- CREATE TABLE 用 IF NOT EXISTS；索引用 information_schema 守門（PENDING_BLOCK 鐵則）。
CREATE TABLE IF NOT EXISTS `webhook_subscriptions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `url` varchar(2048) NOT NULL,
  `events` json NOT NULL,
  `secret` varchar(64) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `webhook_delivery_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `subscriptionId` int NOT NULL,
  `event` varchar(64) NOT NULL,
  `payload` json NOT NULL,
  `statusCode` int DEFAULT NULL,
  `attempt` int NOT NULL DEFAULT 1,
  `succeeded` tinyint(1) NOT NULL DEFAULT 0,
  `errorMessage` varchar(512) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
)
--> statement-breakpoint
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'webhook_subscriptions' AND index_name = 'ws_userId_idx'), 'SELECT 1', 'CREATE INDEX `ws_userId_idx` ON `webhook_subscriptions` (`userId`, `active`)');
--> statement-breakpoint
PREPARE ws269_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ws269_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ws269_stmt;
--> statement-breakpoint
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'webhook_delivery_history' AND index_name = 'wdh_subId_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `wdh_subId_createdAt_idx` ON `webhook_delivery_history` (`subscriptionId`, `createdAt`)');
--> statement-breakpoint
PREPARE wdh269_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE wdh269_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE wdh269_stmt;
