-- 0050: 模型許願池（Model Wishlist）
--
-- 使用者許願希望平台支援的 AI 模型；其他使用者可對許願投票表態。
--   * model_wishes        — 許願主體（名稱 / 廠商 / 模態 / 原因 / 參考連結 / 狀態）
--   * model_wish_votes    — 去重投票，(wishId, userId) 唯一
--   * voteCount 為 model_wishes 的去正規化欄位，列表查詢可直接 ORDER BY 不必 COUNT。

CREATE TABLE IF NOT EXISTS `model_wishes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `modelName` varchar(191) NOT NULL,
  `provider` varchar(128),
  `modality` enum('text','image','video','audio','voice','3d','multimodal','embedding','other') NOT NULL DEFAULT 'other',
  `reason` text,
  `referenceUrl` text,
  `voteCount` int NOT NULL DEFAULT 0,
  `status` enum('pending','under_review','planned','added','rejected') NOT NULL DEFAULT 'pending',
  `adminNote` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `mw_status_idx` (`status`),
  KEY `mw_vote_count_idx` (`voteCount`),
  KEY `mw_user_idx` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `model_wish_votes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `wishId` int NOT NULL,
  `userId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mw_votes_wish_user_uk` (`wishId`, `userId`),
  KEY `mw_votes_user_idx` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
