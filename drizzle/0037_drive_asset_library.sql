-- 0035: Google Drive 素材庫支援。
-- user_google_oauth_tokens 為使用者額外授權的 scope（例如 Drive readonly）
-- 儲存 token，與 OAuth 登入流程分開（登入只要 openid/email/profile）。
-- drive_asset_libraries 記錄使用者「釘選」哪幾個 Drive 資料夾當作素材庫，
-- 以及它的用途（外拍 / 個人 / 其他）和顯示名稱。

CREATE TABLE IF NOT EXISTS `user_google_oauth_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `purpose` varchar(32) NOT NULL DEFAULT 'drive',
  `accessToken` text NOT NULL,
  `refreshToken` text NULL,
  `scope` text NOT NULL,
  `tokenType` varchar(32) NOT NULL DEFAULT 'Bearer',
  `expiresAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_google_oauth_tokens_user_purpose_uk` (`userId`, `purpose`),
  KEY `user_google_oauth_tokens_user_idx` (`userId`)
);

CREATE TABLE IF NOT EXISTS `drive_asset_libraries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `label` varchar(128) NOT NULL,
  `kind` ENUM('shoot', 'personal', 'other') NOT NULL DEFAULT 'shoot',
  `driveFolderId` varchar(128) NOT NULL,
  `driveFolderName` varchar(255) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `drive_asset_libraries_user_idx` (`userId`),
  KEY `drive_asset_libraries_user_kind_idx` (`userId`, `kind`)
);
