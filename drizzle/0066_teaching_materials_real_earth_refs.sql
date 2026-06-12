-- 0066: teaching_materials 加 realEarthRefs（冪等修復版）
--
-- 原版是裸 `ALTER TABLE ... ADD`：生產首次部署時欄位已加成功、但同批的
-- 0067 失敗導致記帳回滾 → 之後每次開機重跑本檔都撞 Duplicate column，
-- migration runner 從此卡死，0067 之後（creative_projects/orchestration_runs/
-- prompt_assets…）全部沒套用。改成存在就 SELECT 1，可安全重跑。

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'teaching_materials'
      AND column_name = 'realEarthRefs'
  ),
  'SELECT 1',
  'ALTER TABLE `teaching_materials` ADD `realEarthRefs` json'
);
--> statement-breakpoint
PREPARE tm_rer_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tm_rer_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tm_rer_stmt;
