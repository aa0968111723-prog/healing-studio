CREATE TABLE IF NOT EXISTS `agent_model_picks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `modality` VARCHAR(32) NOT NULL,
  `modelId` VARCHAR(128) NOT NULL,
  `source` ENUM(
    'director_ai',
    'global_orb',
    'image_studio',
    'video_studio',
    'pro_studio',
    'studio',
    'history',
    'shared_space',
    'other'
  ) NOT NULL DEFAULT 'other',
  `accepted` BOOLEAN NULL,
  `context` JSON NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `amp_user_modality_idx` (`userId`, `modality`),
  INDEX `amp_user_model_idx` (`userId`, `modelId`),
  INDEX `amp_created_at_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
