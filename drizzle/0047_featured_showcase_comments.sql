-- 0047: 精選作品評論
-- featured_showcase_comments 儲存使用者對精選作品的評論
-- featured_showcase.commentCount 為去正規化的計數欄位（每次新增/刪除評論時同步）

ALTER TABLE `featured_showcase`
  ADD COLUMN `commentCount` int NOT NULL DEFAULT 0;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `featured_showcase_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `showcaseId` int NOT NULL,
  `userId` int NOT NULL,
  `content` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fsc_showcase_created_idx` (`showcaseId`, `createdAt`),
  KEY `fsc_user_idx` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
