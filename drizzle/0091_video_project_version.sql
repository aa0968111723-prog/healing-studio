-- AIDV-241: video_projects 加樂觀鎖 version 欄位
-- 防止協作者同時編輯同一影片專案觸發 last-write-wins 靜默覆蓋。
-- save mutation 帶入預期 version，不符時回傳 409 Conflict。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- ALTER 走 information_schema 守門，可安全重跑。
--
-- 回滾：ALTER TABLE `video_projects` DROP COLUMN `version`;

-- ── (A) video_projects：加樂觀鎖 version 欄位 ─────────────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'video_projects'
      AND column_name = 'version'
  ),
  'SELECT 1',
  'ALTER TABLE `video_projects` ADD COLUMN `version` int NOT NULL DEFAULT 0'
);
--> statement-breakpoint
PREPARE vp_ver_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE vp_ver_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE vp_ver_stmt;
