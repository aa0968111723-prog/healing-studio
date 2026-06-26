-- AIDV-264: IP 維度登入失敗查詢加速索引
-- 供 localAuth.ts IP-only lockout 使用（同一 IP 在 1 分鐘內 20 次失敗即封鎖）。
-- CREATE INDEX 走 information_schema.statistics 守門（PENDING_BLOCK 鐵則）。
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'login_history' AND index_name = 'lh_ip_createdAt_idx'), 'SELECT 1', 'CREATE INDEX `lh_ip_createdAt_idx` ON `login_history` (`ipAddress`, `createdAt`)');
--> statement-breakpoint
PREPARE lh264_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE lh264_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE lh264_stmt;
