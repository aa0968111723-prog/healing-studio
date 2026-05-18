-- 0053: Teams + memberships + access audit log for teaching-archive
--
-- Phase 2 of the training-data feature. The Phase 1 schema (0052) stores
-- teaching materials per individual user; this migration adds:
--   • `teams` + `team_memberships` so a workspace can have isolated teams,
--     each with owner/admin/member roles
--   • `teaching_materials.teamId` (nullable) — materials marked `team_shared`
--     point at the team whose members can read/write them
--   • `teaching_material_access_log` — append-only audit trail of who
--     viewed / downloaded / searched / re-ingested which material; used by
--     admins to spot abuse on sensitive lineage texts
--   • extra indexes on `(teamId, visibility)` and `visibility` to keep the
--     read-path queries fast as the team pool grows.
--
-- FK constraints 留到 0054 一次處理（避免 ALTER TABLE ADD FK 在同一個
-- migration 內 reference 還沒被 INSERT 過的列；CI 跑 fresh migrate 順序
-- 比較好顧）。0054 會補上 ownerId / userId / teamId / materialId 的 FK
-- 與 ON DELETE 行為（CASCADE / RESTRICT / SET NULL）。

CREATE TABLE IF NOT EXISTS `teams` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `description` text DEFAULT NULL,
  `ownerId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `teams_ownerId_idx` (`ownerId`)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `team_memberships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teamId` int NOT NULL,
  `userId` int NOT NULL,
  `role` enum('owner','admin','member') NOT NULL DEFAULT 'member',
  `invitedBy` int DEFAULT NULL,
  `joinedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  -- 一個使用者在同一個 team 只能有一筆會員紀錄
  UNIQUE KEY `tm_teamId_userId_uk` (`teamId`,`userId`),
  KEY `tm_userId_idx` (`userId`),
  KEY `tm_teamId_idx` (`teamId`)
);
--> statement-breakpoint

ALTER TABLE `teaching_materials`
  ADD COLUMN `teamId` int DEFAULT NULL AFTER `userId`,
  ADD KEY `tm_teamId_visibility_idx` (`teamId`,`visibility`),
  ADD KEY `tm_visibility_idx` (`visibility`),
  ADD KEY `tm_teamId_createdAt_idx` (`teamId`,`createdAt`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `teaching_material_access_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `materialId` int NOT NULL,
  `userId` int NOT NULL,
  `action` enum(
    'view',
    'download',
    'search_hit',
    'reingest',
    'update',
    'delete'
  ) NOT NULL,
  `metadata` json DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `tmal_materialId_createdAt_idx` (`materialId`,`createdAt`),
  KEY `tmal_userId_createdAt_idx` (`userId`,`createdAt`),
  KEY `tmal_action_createdAt_idx` (`action`,`createdAt`)
);
