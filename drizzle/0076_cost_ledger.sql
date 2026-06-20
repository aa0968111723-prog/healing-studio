-- 0076: cost_ledger — AIDV-153 append-only 雙分錄成本帳本（基礎版）
--
-- 現況（待升級的反型樣）：餘額＝users.remainingGenerations 單一可變整數，扣款/退款
-- 都「就地 mutate」（server/db.ts deductUserPoints/refundUserPoints），無不可變交易
-- log；cost_aggregations 由 SUM(ai_usage_events.costUsd) 聚合，某些路徑偶現 $0.00。
--
-- 本表是「基礎版」：append-only（只 INSERT、永不 UPDATE/DELETE 既有列）的雙分錄帳本，
-- 餘額由 log 加總「算出來」、不就地改任何欄位。
--
--   accountKey     : 帳戶鍵（科目維度）"<type>:<id>"，type ∈ project/member/workflow
--   entryType      : debit（借，消耗成本）/ credit（貸，退款沖銷）
--   amount         : DECIMAL(12,6) 正值（方向由 entryType 表達，金額永遠 ≥ 0）
--   status         : pending（hold 預留）→ posted（正式入帳）/ archived（沖銷作廢）
--   idempotencyKey : 唯一鍵 — 同 key 重複入帳被擋＝冪等保證（DB 層，重啟不失）
--   refType/refId  : 來源憑證（ai_usage_event / generation_job 等），供對帳追溯
--
-- 接線端掛 env 旗標 ENABLE_COST_LEDGER（預設 OFF）；OFF＝完全不寫本表、現狀位元相同。
-- 本表並行於 cost_aggregations、不取代、不改既有餘額/聚合寫法。先跑 migration 後開
-- 旗標是安全順序（空表時對帳 job 回 drift=0、讀取無副作用）。
--
-- 冪等：同 0075 模式（information_schema 前檢 + PREPARE/EXECUTE），可安全重跑。
--
-- 回滾（rollback）：
--   DROP TABLE IF EXISTS `cost_ledger`;
-- （回滾前請先確認 ENABLE_COST_LEDGER=0；OFF 時無任何流程寫本表，回滾零風險。）

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
  ),
  'SELECT 1',
  'CREATE TABLE `cost_ledger` (
    `id` int AUTO_INCREMENT NOT NULL,
    `accountKey` varchar(128) NOT NULL,
    `entryType` enum(''debit'',''credit'') NOT NULL,
    `amount` decimal(12,6) NOT NULL DEFAULT ''0'',
    `status` enum(''pending'',''posted'',''archived'') NOT NULL DEFAULT ''posted'',
    `idempotencyKey` varchar(191) NOT NULL,
    `refType` varchar(64),
    `refId` varchar(128),
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `cost_ledger_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'cost_ledger' AND index_name = 'cl_idempotencyKey_unique'), 'SELECT 1', 'CREATE UNIQUE INDEX `cl_idempotencyKey_unique` ON `cost_ledger` (`idempotencyKey`)');
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'cost_ledger' AND index_name = 'cl_accountKey_status_idx'), 'SELECT 1', 'CREATE INDEX `cl_accountKey_status_idx` ON `cost_ledger` (`accountKey`,`status`)');
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'cost_ledger' AND index_name = 'cl_ref_idx'), 'SELECT 1', 'CREATE INDEX `cl_ref_idx` ON `cost_ledger` (`refType`,`refId`)');
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'cost_ledger' AND index_name = 'cl_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `cl_createdAt_idx` ON `cost_ledger` (`createdAt`)');
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
