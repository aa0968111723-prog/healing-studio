# 卡型路由 profile（步驟 0：判型 → 決定 3–4 出什麼、8 測什麼）

> 進站先讀卡的 Wave／label／描述判卡型，套對應 profile。15 步骨架不變，**只換「步驟 3–4 產出」與「步驟 8 測試」的內容**。一張卡可跨型（取聯集），但**範圍仍鎖一句話**（反跑偏）。

## 判型速查（看 label/Wave）
- `uiux`/`wave-u` → 視覺；Wave 1 接線 → 後端；`wave2`/`wave3`＋migration/Redis/Supabase → 基建；`wave-h`/安全字樣 → 安全維運；RAG/教材庫/pgvector → 資料；Wave 4/orb/planner/BYOMCP → AI 代理。

---

## 1) 視覺/UIUX（Wave U）
- **3–4 出**：Claude Design 出 UI 草案（掛 design-kit token）→ Adobe 精修 hero/icon/插畫/背景。詳 `visual-asset-pipeline.md`。
- **8 測**：四態（載入/空/錯誤/正常）＋a11y（對比≥4.5:1、aria-label、色彩非唯一資訊）＋RWD（桌機三欄/手機單欄）＋persona 走查。
- **設計門**：零後端＋design-kit 一致＋旗標可回滾＝自動通過。
- 重用：`/aidv-workflow`、`_shared/PanelState`、`@/components/design-kit`。

## 2) 後端/接線（Wave 1）
- **3–4 出**：procedure 契約（輸入/輸出 zod schema、錯誤碼）＋資料表/欄位；**零新後端優先＝先找既有 procedure 接**。
- **8 測**：`vitest` 單元（procedure 行為）＋`check:routes`（router/registry 對齊）＋`check:navigation`。
- **設計門**：碰新後端/schema＝**需 Bruce 拍板**；純接既有 procedure＝自動通過。
- 重用：`server/routers/*`、`server/_core/providerFacade.ts`。

## 3) 基建/耐久/migration（Wave 2/3 · 如 AIDV-13/17/19）
- **3–4 出**：設計文件——佇列拓撲（BullMQ queue/worker/DLQ/重試）／遷移計畫（expand-and-contract、ledger 回填）／鎖策略。**migration 必遵三鐵則**。
- **8 測**：耐久性（殺行程後任務存活、SSE 重連）＋`server/migration-prod-pending-block.test.ts`＋`orphan-migrations-journal.test.ts`＋**回滾演練**。
- **設計門**：碰 DB/部署順序/金鑰＝**一律 Bruce 拍板**（破壞性）。缺 Redis/Supabase 金鑰＝`needs-key` 停下。
- 重用：`drizzle/`、`server/db.ts`；參考 `system-test-checklist.md`。

## 4) 安全/維運（Wave H · 如 AIDV-57/64/90）
- **3–4 出**：威脅模型（資產→威脅→緩解）＋fail-closed 設計（預設拒絕）。
- **8 測**：上傳 magic-byte/移除 SVG＋審核 fail-closed＋限流＋金鑰只貼 Railway 驗證（不外洩）。
- **設計門**：安全卡幾乎都碰 prod／金鑰＝**Bruce 拍板**；AIDV-90 撤 token 類＝最高優先即刻。
- 重用：`security` plugin、`routes/aiProxy.ts`（H5 模式）。

## 5) 資料/RAG（如 AIDV-69/82）
- **3–4 出**：管線設計（chunk/embedding/index）＋檢索策略（halfvec/HNSW 參數、ef_search sweep）。
- **8 測**：固定查詢集 recall-vs-ef_search＋注入側門安檢（教材庫不被當指令）。
- 重用：`teachingArchive.ts`、`learnHub.ts`；向量參數見 benchmark 報告主題 3。

## 6) AI 代理/planner（Wave 4 · 如 AIDV-23/24/25）
- **3–4 出**：規劃器/編排設計＋沙箱（WASM 能力式、deny-by-default、egress 白名單、版本 pin）。
- **8 測**：`npm run eval`（規劃器回歸，改 prompt/schema 前必跑）＋沙箱逃逸/權限越界＋工具呼叫稽核。
- **設計門**：BYOMCP/外部工具碰權限＝Bruce 拍板。
- 重用：`server/eval/`、`spiritRouter.ts`、`orb*Router.ts`。

---

## 共通（所有卡型）
- 旗標：前端 `client/src/config/*Flags.ts`（ENABLE_4SHELL 階層）；後端 `env.validated.ts`。預設 ON＋兩條退路（線上開啟政策）。
- 步驟 5 交接提示詞模板對所有卡型通用（`handoff-prompt-template.md`），只是「視覺資產」欄非視覺卡留空、改填「契約/設計連結」。
- 步驟 12 真實腳本實測對所有卡型適用：用「真實使用者旅程中會觸發這張卡功能的情境」去真站跑。
