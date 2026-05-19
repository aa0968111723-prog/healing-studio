-- 0063: prompt_collection — 個人提示詞收集（可團隊共享）
--
-- 比照 digital_asset_library 的「private / team_shared」模型，但收集標的
-- 是「站內各處可重用的提示詞」：
--   • 25 位精靈的 system prompt slice（agent role）
--   • 18 條精靈主動觸發 default prompt（proactive trigger）
--   • 模型偏好的 prompt 樣板（model template）
--   • ImageStudio 內建場景模板 (t2i / sd)
--   • 全站系統提示（catalogue 內任何 sourceType=site_prompt 的條目）
--   • 使用者自輸入 (manual)
--
-- 為什麼開新表而不是擴 prompt_library：
-- prompt_library 的語意是「使用者自己整理 / 命名的模板，可選擇 isPublic
-- 放到廣場給陌生人看」。而 collection 的語意是「我從站內看到一段想保留
-- 的 prompt，把它釘起來，並可分享給我所屬團隊」。兩者 visibility 模型
-- 也不同（後者比照 assets 的 team_shared + teamId）。混在一張表容易讓
-- 公開廣場（陌生人）與團隊共享（同事）的權限邊界錯亂。

DROP PROCEDURE IF EXISTS `__create_prompt_collection`;
--> statement-breakpoint

CREATE PROCEDURE `__create_prompt_collection`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'prompt_collection'
  ) THEN
    CREATE TABLE `prompt_collection` (
      `id` int AUTO_INCREMENT NOT NULL,
      `userId` int NOT NULL,
      `title` varchar(256) NOT NULL,
      `content` text NOT NULL,
      `category` varchar(64) NOT NULL DEFAULT 'general',
      `tags` json,
      `notes` text,
      `sourceType` varchar(32) NOT NULL DEFAULT 'manual',
      `sourceRef` varchar(128),
      `sourceLabel` varchar(256),
      `visibility` enum('private','team_shared') NOT NULL DEFAULT 'private',
      `teamId` int,
      `isFavorite` boolean NOT NULL DEFAULT false,
      `useCount` int NOT NULL DEFAULT 0,
      `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT `prompt_collection_id` PRIMARY KEY(`id`)
    );
    CREATE INDEX `pc_userId_idx` ON `prompt_collection` (`userId`);
    CREATE INDEX `pc_userId_visibility_idx` ON `prompt_collection` (`userId`, `visibility`);
    CREATE INDEX `pc_teamId_visibility_idx` ON `prompt_collection` (`teamId`, `visibility`);
    CREATE INDEX `pc_sourceType_idx` ON `prompt_collection` (`sourceType`);
    -- 防止使用者重複從同一個站內來源收集同一段內容 — 同一 userId 對同一
    -- (sourceType, sourceRef) 只允許一筆。手動輸入 sourceRef=NULL，UNIQUE
    -- 在 NULL 上不會衝突所以手動條目可重複。
    CREATE UNIQUE INDEX `pc_user_source_uk` ON `prompt_collection`
      (`userId`, `sourceType`, `sourceRef`);
  END IF;
END;
--> statement-breakpoint

CALL `__create_prompt_collection`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__create_prompt_collection`;
