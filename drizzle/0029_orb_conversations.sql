-- Orb Multi-Session Conversations
-- Adds per-user conversation tabs and a message store for the chat at /agent.
-- The `ai.chat` mutation stays stateless; the client persists each turn here
-- so users can keep several parallel sessions across reloads and devices.

CREATE TABLE IF NOT EXISTS `orb_conversations` (
  `conversation_id` VARCHAR(48) NOT NULL PRIMARY KEY,
  `user_id` INT NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `pinned` BOOLEAN NOT NULL DEFAULT FALSE,
  `archived_at` TIMESTAMP NULL,
  `last_message_at` TIMESTAMP NULL,
  `message_count` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `orbc_user_updated_idx` (`user_id`, `updated_at`),
  INDEX `orbc_user_archived_idx` (`user_id`, `archived_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_conversation_messages` (
  `message_id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `conversation_id` VARCHAR(48) NOT NULL,
  `user_id` INT NOT NULL,
  `role` ENUM('user', 'orb') NOT NULL,
  `text` TEXT NOT NULL,
  `at` BIGINT NOT NULL COMMENT 'Client-side timestamp in ms; orders within a conversation',
  `metadata` JSON NULL COMMENT 'Optional: attachments, intent, actions, webSources',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `orbcm_conv_at_idx` (`conversation_id`, `at`),
  INDEX `orbcm_user_conv_idx` (`user_id`, `conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
