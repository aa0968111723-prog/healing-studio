-- 0030: Persist 創作工作室 saved recipes and version history to MySQL.
-- Studio.tsx kept savedRecipes (RecipeLibraryPanel) and versions
-- (VersionHistoryPanel) only in React state, so every reload erased the
-- "library" / "version history" the UI promises. These tables back the
-- studio.recipes.* and studio.versions.* tRPC routers added in this PR.

CREATE TABLE IF NOT EXISTS `studio_recipes` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `modality` ENUM('image', 'video', 'music', 'voice') NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `sr_userId_idx` (`userId`),
  INDEX `sr_userId_modality_idx` (`userId`, `modality`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `studio_versions` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `modality` ENUM('image', 'video', 'music', 'voice') NOT NULL,
  `versionKey` VARCHAR(64) NOT NULL,
  `pinned` BOOLEAN NOT NULL DEFAULT FALSE,
  `payload` JSON NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `sv_userId_idx` (`userId`),
  INDEX `sv_userId_modality_idx` (`userId`, `modality`),
  INDEX `sv_userId_versionKey_idx` (`userId`, `versionKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
