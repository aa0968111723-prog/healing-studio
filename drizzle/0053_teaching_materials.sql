-- 0053: 資料庫（Teaching Materials）
--
-- Phase 1 of the training-data feature. Stores teacher discourses, lineage
-- materials, group-practice recordings, class slides, photos, etc. The
-- `textContent` + `transcriptionStatus` columns are populated by a later
-- RAG ingestion pipeline (Phase 2: chunking + embeddings); Phase 1 keeps
-- them as nullable / not_applicable so authors can upload immediately.

CREATE TABLE IF NOT EXISTS `teaching_materials` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,

  `mediaType` enum(
    'text',
    'pdf',
    'document',
    'image',
    'video',
    'audio',
    'presentation'
  ) NOT NULL,

  `fileUrl` text DEFAULT NULL,
  `fileKey` text DEFAULT NULL,
  `fileName` varchar(255) DEFAULT NULL,
  `mimeType` varchar(128) DEFAULT NULL,
  `fileSizeBytes` int DEFAULT NULL,
  `thumbnailUrl` text DEFAULT NULL,
  `durationSeconds` int DEFAULT NULL,
  `pageCount` int DEFAULT NULL,

  `textContent` mediumtext DEFAULT NULL,
  `transcriptionStatus` enum(
    'not_applicable',
    'pending',
    'processing',
    'completed',
    'failed'
  ) NOT NULL DEFAULT 'not_applicable',

  `lineage` varchar(128) DEFAULT NULL,
  `sourceType` enum(
    'discourse',
    'group_practice',
    'class',
    'ceremony',
    'publication',
    'interview',
    'other'
  ) NOT NULL DEFAULT 'discourse',
  `sourceDate` date DEFAULT NULL,
  `sourceLocation` varchar(255) DEFAULT NULL,
  `topic` varchar(128) DEFAULT NULL,
  `speaker` varchar(128) DEFAULT NULL,
  `tags` json DEFAULT NULL,

  `visibility` enum('private','team_shared','public_disciples')
    NOT NULL DEFAULT 'private',
  `isFeatured` tinyint NOT NULL DEFAULT 0,
  `sortOrder` int NOT NULL DEFAULT 0,

  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `tm_userId_idx` (`userId`),
  KEY `tm_userId_mediaType_idx` (`userId`,`mediaType`),
  KEY `tm_userId_sourceType_idx` (`userId`,`sourceType`),
  KEY `tm_userId_lineage_idx` (`userId`,`lineage`),
  KEY `tm_userId_topic_idx` (`userId`,`topic`),
  KEY `tm_userId_createdAt_idx` (`userId`,`createdAt`)
);
