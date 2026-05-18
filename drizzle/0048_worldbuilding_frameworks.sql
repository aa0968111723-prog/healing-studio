-- 0048: 世界觀架構器（Worldbuilding Frameworks）
--
-- 為導演 AI 的自訂世界觀架構器新增資料表：
--   * 一筆 worldbuilding_frameworks 代表一個完整「世界」
--   * charactersJson / scenesJson / objectsJson 以 JSON 儲存巢狀結構，
--     schema 由 shared/worldbuilding-types.ts 維護
--   * linkedModelIds 為陣列，連結 fine_tuned_models.id（LoRA 訓練中心）

CREATE TABLE IF NOT EXISTS `worldbuilding_frameworks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `genre` varchar(128),
  `charactersJson` json NOT NULL,
  `scenesJson` json NOT NULL,
  `objectsJson` json,
  `linkedModelIds` json,
  `tags` json,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `wf_userId_idx` (`userId`),
  KEY `wf_userId_createdAt_idx` (`userId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
