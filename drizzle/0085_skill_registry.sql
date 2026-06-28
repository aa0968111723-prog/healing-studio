-- 0085: skill_registry — Wave S S-4 Skill 信任分級與安裝清單（AIDV-129）
--
-- 目標：每個已安裝的 Skill 一條記錄，記下：
--   skillId       唯一 skill manifest id（e.g. "storyboard.breakdown"）
--   version       pin 版本（semver）
--   name          顯示名稱
--   trust         信任級別 enum（official / reviewed / community）
--   grantedConnectors  JSON 陣列，Admin 逐項放行的外部連接器
--   grantedMaterials   是否允許讀寫素材（Admin 核准）
--   grantedCrossProject 是否允許跨專案（Admin 核准）
--   status        active / disabled
--   installedBy   安裝者 userId（官方 Skill 為 NULL）
--   source        manifest 來源 URL / path（官方 Skill 為 NULL）
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一 breakpoint 一句；
-- ALTER/CREATE INDEX 走 information_schema 守門。可重跑。

CREATE TABLE IF NOT EXISTS `skill_registry` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `skillId` varchar(128) NOT NULL,
  `version` varchar(32) NOT NULL,
  `name` varchar(255) NOT NULL,
  `trust` enum('official','reviewed','community') NOT NULL DEFAULT 'community',
  `grantedConnectors` json DEFAULT NULL,
  `grantedMaterials` tinyint(1) NOT NULL DEFAULT 0,
  `grantedCrossProject` tinyint(1) NOT NULL DEFAULT 0,
  `status` enum('active','disabled') NOT NULL DEFAULT 'active',
  `installedBy` int DEFAULT NULL,
  `source` varchar(512) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
SET @sidx := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'skill_registry'
      AND index_name = 'skill_registry_skillId_uk'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX `skill_registry_skillId_uk` ON `skill_registry` (`skillId`)'
);
--> statement-breakpoint
PREPARE _sidx FROM @sidx;
--> statement-breakpoint
EXECUTE _sidx;
--> statement-breakpoint
DEALLOCATE PREPARE _sidx;
--> statement-breakpoint
SET @sidx2 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'skill_registry'
      AND index_name = 'skill_registry_trust_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `skill_registry_trust_idx` ON `skill_registry` (`trust`)'
);
--> statement-breakpoint
PREPARE _sidx2 FROM @sidx2;
--> statement-breakpoint
EXECUTE _sidx2;
--> statement-breakpoint
DEALLOCATE PREPARE _sidx2;
--> statement-breakpoint
SET @sidx3 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'skill_registry'
      AND index_name = 'skill_registry_status_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `skill_registry_status_idx` ON `skill_registry` (`status`)'
);
--> statement-breakpoint
PREPARE _sidx3 FROM @sidx3;
--> statement-breakpoint
EXECUTE _sidx3;
--> statement-breakpoint
DEALLOCATE PREPARE _sidx3;
