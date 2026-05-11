-- 0040: Orb 意圖識別與澄清系統
-- orb_intent_logs 記錄每次使用者輸入的意圖識別結果
-- orb_clarification_history 儲存澄清對話的歷史記錄
-- orb_user_answer_patterns 學習使用者回答問題的模式，提高未來預測準確度

CREATE TABLE IF NOT EXISTS `orb_intent_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `conversationId` varchar(128) NOT NULL,
  `userInput` text NOT NULL,
  `detectedIntents` json NOT NULL COMMENT 'Array of {intent, confidence, category}',
  `primaryIntent` varchar(128) NULL,
  `intentConfidence` float NULL COMMENT '0.0-1.0',
  `ambiguityScore` float NULL COMMENT '0.0-1.0, higher = more ambiguous',
  `needsClarification` boolean NOT NULL DEFAULT false,
  `context` json NULL COMMENT 'Session context at time of input',
  `spiritAssigned` varchar(64) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orb_intent_user_idx` (`userId`),
  KEY `orb_intent_conv_idx` (`conversationId`),
  KEY `orb_intent_primary_idx` (`primaryIntent`),
  KEY `orb_intent_needs_clarification_idx` (`needsClarification`),
  KEY `orb_intent_created_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_clarification_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `intentLogId` bigint NOT NULL,
  `userId` int NOT NULL,
  `conversationId` varchar(128) NOT NULL,
  `clarificationQuestion` text NOT NULL,
  `questionType` ENUM(
    'choice',
    'confirm',
    'parameter',
    'constraint',
    'preference',
    'context'
  ) NOT NULL,
  `options` json NULL COMMENT 'For choice questions',
  `userAnswer` text NULL,
  `answeredAt` timestamp NULL,
  `resolvedIntent` varchar(128) NULL,
  `resolutionConfidence` float NULL,
  `spiritAsked` varchar(64) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orb_clarif_intent_idx` (`intentLogId`),
  KEY `orb_clarif_user_idx` (`userId`),
  KEY `orb_clarif_conv_idx` (`conversationId`),
  KEY `orb_clarif_type_idx` (`questionType`),
  KEY `orb_clarif_answered_idx` (`answeredAt`),
  CONSTRAINT `orb_clarif_intent_fk` FOREIGN KEY (`intentLogId`)
    REFERENCES `orb_intent_logs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_user_answer_patterns` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `questionType` varchar(64) NOT NULL,
  `contextPattern` text NULL COMMENT 'Pattern of similar contexts',
  `commonAnswers` json NOT NULL COMMENT 'Array of {answer, frequency, lastUsed}',
  `defaultPreference` text NULL,
  `confidenceScore` float NOT NULL DEFAULT 0.5,
  `sampleCount` int NOT NULL DEFAULT 0,
  `lastUpdatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orb_answer_pattern_uk` (`userId`, `questionType`, `contextPattern`(255)),
  KEY `orb_answer_user_idx` (`userId`),
  KEY `orb_answer_confidence_idx` (`userId`, `confidenceScore` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
