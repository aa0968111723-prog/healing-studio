-- 0022_model_training_consents.sql
-- Adds digital portrait + photo-usage consent records for LoRA / model training.
-- Required when training data includes real persons or third-party copyrighted
-- material. Each consent links to one or more fineTunedModels via the
-- fine_tuned_model_consents join table.
--
-- Statements separated by Drizzle breakpoint markers (multi-statement is off).

CREATE TABLE `model_training_consents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `subjectType` enum('self','real_person','copyrighted') NOT NULL,
  `consentType` enum('portrait','photo_usage','both') NOT NULL DEFAULT 'both',
  `subjectName` varchar(128) NOT NULL,
  `subjectEmail` varchar(320) DEFAULT NULL,
  `subjectIdLast4` varchar(8) DEFAULT NULL,
  `signerName` varchar(128) NOT NULL,
  `signerEmail` varchar(320) NOT NULL,
  `signerRelation` enum('self','guardian','copyright_holder','authorized_representative') NOT NULL,
  `usageScope` enum('training_only','personal_output','public_display','commercial') NOT NULL DEFAULT 'training_only',
  `allowDerivative` tinyint NOT NULL DEFAULT 0,
  `validFrom` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `validUntil` timestamp NULL DEFAULT NULL,
  `termsVersion` varchar(32) NOT NULL,
  `termsSnapshot` text NOT NULL,
  `signatureDataUrl` text NOT NULL,
  `signedIp` varchar(64) DEFAULT NULL,
  `signedUserAgent` text DEFAULT NULL,
  `signedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `proofFileUrl` text DEFAULT NULL,
  `proofFileKey` text DEFAULT NULL,
  `coveredAssets` json DEFAULT NULL,
  `revokedAt` timestamp NULL DEFAULT NULL,
  `revokeReason` text DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `mtc_userId_idx` (`userId`),
  KEY `mtc_userId_subjectName_idx` (`userId`,`subjectName`),
  KEY `mtc_revokedAt_idx` (`revokedAt`)
);
--> statement-breakpoint

CREATE TABLE `fine_tuned_model_consents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `modelId` int NOT NULL,
  `consentId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ftmc_modelId_idx` (`modelId`),
  KEY `ftmc_consentId_idx` (`consentId`)
);
