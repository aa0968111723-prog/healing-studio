# 跨系統實測（步驟 12 · 上線後系統測試門）

> 目的：合 PR＋Railway 部署後，**在真站**驗三件事都活著——生成、儲存、工作流。PR 綠 ≠ 線上會動；這道門才算數。
> 前置：步驟 11 已合併、Railway 部署完成、`/api/health` 綠。

## 三大支柱（任一紅→回步驟 13 修）

### 1) 生成（provider 門面實打到模型）
- [ ] LLM：經統一供應商門面（`server/_core/providerFacade.ts`／`llmRouter.ts`）實際回應；`LLM_ENGINE=auto` 降級鏈可用。
- [ ] 圖/影/聲：對應 provider（fal/Replicate/Gemini/ElevenLabs/Suno）若金鑰已貼 Railway → 實際產出；未貼 → 確認是「OARS 友善警告」而非崩潰。
- [ ] 成本：該次生成在 `cost_aggregations` **有落帳、非 $0.00**（呼應 AIDV-14；估→扣→落帳/失敗全退）。

### 2) 儲存（媒體存得進、取得回）
- [ ] 產出媒體落到儲存（R2/GCS）並能用連結取回；大檔走 signed URL，**非 base64 過 tRPC**（AIDV-15）。
- [ ] 血統：prompt↔asset junction 有寫入（AIDV-6/9）；可從資產回查 prompt。
- [ ] 清理：暫存/孤兒檔有 expiresAt 或清理 job 兜底（AIDV-67）。

### 3) 工作流（六步 logline→成片走得通）
- [ ] Creative Project 為主入口（AIDV-84）開得了、存得住、接得上這張卡的步。
- [ ] 任務不因單次重啟全失（注意：耐久佇列 AIDV-13 未上前，長任務仍有 5 分鐘 timeout 風險→列為已知限制）。
- [ ] 該卡所屬步驟在真站從上一步接得進、交得到下一步。

## migration / 部署健康
- [ ] 無 pending migration block（守門測試 `server/migration-prod-pending-block.test.ts`）。
- [ ] 三鐵則未違反：① 禁 `CREATE INDEX IF NOT EXISTS`；② 一 breakpoint 一句；③ ALTER/CREATE INDEX 走 `information_schema` 守門。
- [ ] 旗標兩條退路（env／runtime）在線上真的能秒關。

## 通過後
三柱全綠 → 步驟 13/14 收尾（清退路殘留、補測、補文件）→ 步驟 15 `/aidv-plan pr-update` 標完成、`/aidv-board calendar` 記行事曆 → 回報下一張 Wave U 卡。
任一紅 → 步驟 13 最終修復 → 重跑本門。
