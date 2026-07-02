-- 0107: stripe_webhook_events — AIDV-167 Stripe webhook 事件冪等 + 重放安全 + 人審軌跡
-- 每顆接手事件處理前先 claim 一列；eventId UNIQUE＝事件級冪等鍵（重送只落地一次）。
-- status：processing → processed（已落地）/ held（從嚴轉人審）/ skipped（亂序安全略過）
--         / failed（回 5xx 讓 Stripe 重試，重試可 re-claim）。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- CREATE TABLE 走 information_schema 守門。可安全重跑：表已存在 → IF 走 SELECT 1。
--
-- 回滾：DROP TABLE IF EXISTS `stripe_webhook_events`;

SET @swe_tbl := IF(
  EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name   = 'stripe_webhook_events'
  ),
  'SELECT 1',
  'CREATE TABLE `stripe_webhook_events` (
    `id`             INT NOT NULL AUTO_INCREMENT,
    `eventId`        VARCHAR(191) NOT NULL,
    `eventType`      VARCHAR(64) NOT NULL,
    `objectId`       VARCHAR(191) NULL,
    `subscriptionId` VARCHAR(64) NULL,
    `eventCreated`   TIMESTAMP NULL,
    `status`         ENUM(''processing'',''processed'',''held'',''skipped'',''failed'') NOT NULL DEFAULT ''processing'',
    `holdReason`     TEXT NULL,
    `error`          TEXT NULL,
    `attempts`       INT NOT NULL DEFAULT 1,
    `payload`        JSON NULL,
    `createdAt`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `swe_eventId_unique` (`eventId`),
    KEY `swe_subscription_idx` (`subscriptionId`,`status`),
    KEY `swe_status_idx` (`status`),
    KEY `swe_createdAt_idx` (`createdAt`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
--> statement-breakpoint
PREPARE swe_tbl FROM @swe_tbl;
--> statement-breakpoint
EXECUTE swe_tbl;
--> statement-breakpoint
DEALLOCATE PREPARE swe_tbl;
