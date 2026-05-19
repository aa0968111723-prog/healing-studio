-- 0060: 世界觀架構器動畫製作擴充 + 分鏡時間軸表
--
-- 兩個目標：
--   A) 為 worldbuilding_frameworks 加入動畫製作必要欄位：
--      - styleProfilesJson：畫面風格設定陣列（色票、燈光、鏡頭、後製、繪風）
--      - musicThemesJson：配樂主題陣列
--      - defaultStyleProfileId：預設使用的風格 profile id
--      - globalNegativePrompt：全域負面提示詞
--      - productionTargetsJson：製作目標（格式、目標時長、受眾、平台）
--      （角色與場景內的三視圖、表情包、穿衣、口氣、語音、腳本定位等子結構
--       存於既有 charactersJson / scenesJson，由 shared/worldbuilding-types.ts
--       維護 schema，無需 ALTER。）
--
--   B) 新增 world_storyboards：動畫分鏡時間軸（一個世界可有多個分鏡）。
--      - scenesJson：每場 sequence、起訖秒數、登場角色 beats、圖楨、音軌
--      - pipelinePlanJson / jobsJson：管線執行計畫與各步驟狀態
--      結構由 shared/worldbuilding-animation.ts 維護。

-- ─── A) worldbuilding_frameworks 擴充欄位 ───────────────────────────────────

ALTER TABLE `worldbuilding_frameworks`
  ADD COLUMN `styleProfilesJson` json AFTER `linkedModelIds`,
  ADD COLUMN `musicThemesJson` json AFTER `styleProfilesJson`,
  ADD COLUMN `defaultStyleProfileId` varchar(64) AFTER `musicThemesJson`,
  ADD COLUMN `globalNegativePrompt` text AFTER `defaultStyleProfileId`,
  ADD COLUMN `productionTargetsJson` json AFTER `globalNegativePrompt`;

-- ─── B) world_storyboards 新表 ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `world_storyboards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `worldId` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `totalDurationSec` int NOT NULL,
  `fps` int NOT NULL DEFAULT 24,
  `aspectRatio` varchar(16) NOT NULL DEFAULT '16:9',
  `scenesJson` json NOT NULL,
  `sourceScriptId` varchar(64),
  `narration` text,
  `productionStatus` varchar(32) NOT NULL DEFAULT 'planning',
  `finalVideoUrl` varchar(2048),
  `estimatedCostUsd` varchar(32),
  `pipelinePlanJson` json,
  `jobsJson` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ws_userId_idx` (`userId`),
  KEY `ws_worldId_idx` (`worldId`),
  KEY `ws_userId_createdAt_idx` (`userId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
