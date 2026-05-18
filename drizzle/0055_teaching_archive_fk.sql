-- 0054: Foreign-key constraints for teaching archive + teams tables
--
-- 0052/0053 已建好 schema 但沒下 FK。這次把該補的 FK 全部補齊，並照當初
-- migration 註解承諾的 ON DELETE 行為：
--
--   • teams.ownerId            → users.id      (RESTRICT — 先轉移擁有權再刪 user)
--   • team_memberships.teamId  → teams.id      (CASCADE — team 沒了 membership 全清)
--   • team_memberships.userId  → users.id      (CASCADE — user 沒了 membership 全清)
--   • team_memberships.invitedBy → users.id    (SET NULL — 保留邀請紀錄但去 ref)
--   • teaching_materials.userId → users.id     (RESTRICT — 強迫先 reassign 素材)
--   • teaching_materials.teamId → teams.id     (SET NULL — team 沒了素材退回個人池)
--   • teaching_material_access_log.materialId → teaching_materials.id (CASCADE)
--   • teaching_material_access_log.userId     → users.id              (CASCADE)
--
-- 沒掛 FK 的副作用：之前 db.deleteTeam() 在 application 層手動把素材 teamId 設 null
-- 再砍 membership 再砍 team。FK 加上去後可改成只刪 team row，DB 自動處理；
-- 但保留現有 application 順序也沒問題（idempotent），不動。

ALTER TABLE `teams`
  ADD CONSTRAINT `teams_ownerId_fk`
    FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE `team_memberships`
  ADD CONSTRAINT `team_memberships_teamId_fk`
    FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`)
    ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE `team_memberships`
  ADD CONSTRAINT `team_memberships_userId_fk`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE `team_memberships`
  ADD CONSTRAINT `team_memberships_invitedBy_fk`
    FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`)
    ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE `teaching_materials`
  ADD CONSTRAINT `teaching_materials_userId_fk`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE `teaching_materials`
  ADD CONSTRAINT `teaching_materials_teamId_fk`
    FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`)
    ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE `teaching_material_access_log`
  ADD CONSTRAINT `tmal_materialId_fk`
    FOREIGN KEY (`materialId`) REFERENCES `teaching_materials`(`id`)
    ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE `teaching_material_access_log`
  ADD CONSTRAINT `tmal_userId_fk`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE;
