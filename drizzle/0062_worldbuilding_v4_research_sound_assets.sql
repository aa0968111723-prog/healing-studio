-- 0061: 世界觀 v4 — 研究資料庫 / 音效庫 / 上傳資產 (全世界共用)
--
-- 三個新欄位都存於 worldbuilding_frameworks，因為它們是「全世界共用」的池子；
-- 角色 / 場景內的 realWorldRefs 與 uploadedAssets 已存在 charactersJson /
-- scenesJson 內，由 shared/worldbuilding-types.ts 維護 schema。

ALTER TABLE `worldbuilding_frameworks`
  ADD COLUMN `researchEntriesJson` json AFTER `productionTargetsJson`,
  ADD COLUMN `soundLibraryJson` json AFTER `researchEntriesJson`,
  ADD COLUMN `uploadedAssetsJson` json AFTER `soundLibraryJson`;
