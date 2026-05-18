-- 0049: 世界觀架構器新增時代背景欄位
--
-- 為 worldbuilding_frameworks 新增 era 欄位（時代背景，例如「中世紀」「未來」「架空」）
-- 與 genre（風格/類型）正交：genre 描述敘事基調，era 描述時間軸

ALTER TABLE `worldbuilding_frameworks`
  ADD COLUMN `era` varchar(128) AFTER `genre`;
