# RB1 — 可移植資產盤點（該照搬的好器官）
- 產生日期：2026-07-04
- 依據 commit：812f6fdb
- 性質：用此 repo 當基底新建網站的決策研究

> 註：實際檢查時 repo HEAD 為 `7f4417d`（812f6fdb 在本地歷史中查無此 commit，可能是別的分支/尚未 push 的引用）。以下內容以 HEAD 現況為準；若 812f6fdb 另有所指，結論仍成立（本波未動 db.ts/shared/ai-adapters 這幾塊）。

## 0. 判準與讀法

「可移植性」不是「code 好不好」，是「搬到新專案要付多少耦合稅」：
- **高** = 只吃 env var / 純函式 / DI 注入 db，抽出即可用，幾乎零改動。
- **中** = 邏輯值錢，但寄生在 db.ts 巨石或某個 provider 的具體型別裡，要嘛先剝出獨立函式，要嘛換掉底層 SQL/vendor 語法。
- **低** = 目前是「一坨」——多個關注點焊在同一檔/同一次呼叫鏈裡，照搬等於把技術債和未驗證路徑一起搬。低不代表邏輯不值錢，代表**不該照搬檔案**，該當設計參考重寫。

工時是「相對」不是「絕對」——同一份文件內互相比較用，不是拍板交期（時程/人力需 Bruce 提供）。

---

## 1. 計費核心原語：deductUserPoints / refundUserPoints / atomicClaimJobRefund（W5）

- **位置**：`server/db.ts:808-931`（deduct/refund）、`server/db.ts:2160-2202`（atomicClaimJobRefund CAS）、`:2190`（mergeBackgroundJobResultJson）
- **可移植性：中**（演算法高、宿主低）
- **需帶走的相依**：
  - `getDb()` 連線 helper（drizzle + mysql2）
  - `users` 表僅需 `remainingGenerations` 一欄；`background_jobs` 表僅需 `resultJson` 一欄
  - drizzle-orm 的 `sql`/`eq`/`inArray`
- **移植風險**：
  1. `FOR UPDATE` 悲觀鎖 + `JSON_SET`/`JSON_MERGE_PATCH`/`JSON_UNQUOTE`/`JSON_EXTRACT` 全是 **MySQL 專屬語法**。若新站選 Postgres/Supabase（很可能，因為 M0/IA0 都指向這個方向），這些 SQL **不能複製貼上**，要重寫成 Postgres 的 `SELECT ... FOR UPDATE` + `jsonb_set`/`->>` 等價語法。能搬的是「先鎖列→判斷→UPDATE」與「CAS：`WHERE NOT refunded` 搶第一筆」這兩個**設計模式**，不是原始碼本身。
  2. 這兩個函式活在 5701 行的 `db.ts` 裡。若圖方便整檔搬，等於把 DI-01（102 表 0 FK + 命名漂移 userId/user_id/ownerUserId/createdBy + drizzle 快照落後 78 表）**原封不動帶到新站**，新站第一天就繼承「帳號刪除 100% 失敗」的體質。**必須先抽函式，不要整檔搬。**
- **移植時順手升級點**：`server/services/cost/ledger.ts`（AIDV-153，append-only 複式帳本：`postEntry`/`postTransaction`/`computeBalance`/`assertGlobalBalanced`，已用依賴注入 `LedgerDb` 介面、目前靠 `ENABLE_COST_LEDGER` 旗標關著、零 greenfield 成本）**現成可外接**。新站不該重複「`remainingGenerations` 單一可變整數＝唯一真相」的反模式，移植 deductUserPoints 時應同時把這顆帳本接成 source of truth，一併補齊主稽核點名的外圈失效：B-27（自給點數）/B-31（退款吞錯）/B-32（Stripe stub）/B-22（守衛出廠即關）/X3（雙重超收）——這些不是「舊站的技術債」，是「新站不該重蹈」的具體清單。
- **對應稽核卡**：W5、AIDV-577（CAS）、AIDV-153（ledger 基礎版）、B-27、B-31、B-32、B-22、X3
- **預估相對工時**：若新站仍用 MySQL＋沿用現有 db helper：**低**（1 人日抽函式+搬單測）。若需改寫成 Postgres 方言並外接 ledger：**中**（3–5 人日）。

---

## 2. secretCrypto（GC3）

- **位置**：`server/_core/secretCrypto.ts`（126 行）
- **可移植性：高** —— 本次盤點唯一「可直接複製貼上」的模組。
- **相依**：零。只吃 `process.env`（`CREDENTIAL_ENCRYPTION_KEY[_<keyId>]` / `JWT_SECRET_RAW` / `JWT_SECRET`），只用 Node 內建 `crypto`（scrypt 導出金鑰 + AES-256-GCM），無 DB、無框架耦合，`v1`/`v2` 雙格式向下相容＋金鑰版本化（`CREDENTIAL_ENCRYPTION_KEY_ACTIVE`）設計本身就是可直接沿用的好範本。
- **移植風險**：低。唯一要注意：若新站需要**遷移舊站既有的加密密文**（如 `data_source_connections.encryptedCredentialRef`），必須帶著同一組 `CREDENTIAL_ENCRYPTION_KEY`/`JWT_SECRET` 過去，否則舊密文在新站解不開。是否要遷移舊資料＝**需 Bruce 提供**。若是全新站、全新使用者資料，這條風險不存在。
- **對應稽核卡**：GC3
- **預估相對工時**：**極低**（0.5 人日，含把 3 支既有測試 `secret-crypto*.test.ts` 一併搬過去）。

---

## 3. 生成派工 + 模型目錄（falDispatcher / modelRegistry / aiModelsCatalog 等）

- **可移植性：低–中**（邏輯值錢，但目前是「一坨」，需拆兩層分開看）
- **量體**：`falDispatcher.ts`（1406 行）+ `falModels.ts`（2434 行）+ `_core/modelRegistry.ts`（856 行）+ `orbModelCatalog.ts`（72 行）+ `shared/aiModelsCatalog.ts`（5386 行）+ `shared/videoModelCatalog.ts`/`engineModelIds.ts` 等 —— 合計上萬行。
- **耦合現況**：`falDispatcher.ts` 直接 import `db.ts`（`getRecentApiEventsForModel`）、`orbCostGuard`（計費扣點）、`specializedAgentMemoryStore`（記憶）、`generationEvents`（websocket 雙發）、`fallbackPolicy`、`engineModelIds`。也就是「派工」「計費扣點」「websocket 推播」「記憶寫入」四件事焊在同一個檔案的同一條呼叫鏈裡，**沒有清楚的介面邊界**。
- **建議拆兩層搬**：
  1. **模型目錄/定價資料層**（`shared/aiModelsCatalog.ts`、`videoModelCatalog.ts`、`engineModelIds.ts`、`server/services/modelPricing.ts`）——本質是純資料（model id / pricing / capability），**可移植性高**，當純資料表直接搬，順手清掉已停用的模型項目。
  2. **派工引擎本體**（`falDispatcher.ts`）——**不建議整檔搬**。1406 行裡混了計費/記憶/推播，照搬會把 B-27/B-31 等外圈失效與 178 不可達工具（Q4）的關聯體質一起帶走。應以 #5 的 `ai-adapters/` 乾淨介面為基礎重新設計，只抽「queue 輪詢＋重試＋fallback 鏈」這段演算法。
- **移植風險**：整包搬＝把計費外圈失效與工具氾濫一起搬；只搬資料層則風險低。
- **對應稽核卡**：A-cost-integrations、H1（model costs）、K2（generation bugs）、Q4（178 不可達工具，提醒不要照抄呼叫氾濫的那部分）
- **預估相對工時**：資料層 **低**（1–2 人日，含清理停用模型）；派工引擎重新設計 **中高**（5–10 人日，不建議照抄原檔）。

---

## 4. ProjectFlowGuide + contextPackets（M2 / 北極星）

- **可移植性：中**，但前後端要分開評估：

**(a) ProjectFlowGuide.tsx（前端展示層，204 行）**
依賴 `useProjectSpine`／`useDirectorConsole`／`spine/gate`／`WorldLinkPicker`——也就是這 204 行元件**單獨搬不動**，要整個 `client/src/spine/` 子系統（`ProjectSpineProvider.tsx` 527 行 + `projectGateway.ts` 528 行 + `gate.ts`/`types.ts`/`contextPacket.ts` 等，共約 1715 行）一起帶走。`spine/` 是「專案＝世界觀→劇本→分鏡→生成→成片 五步」的前端狀態機＋gateway（呼叫後端 tRPC procedure），是全倉庫中**最貼近「一句話→成片」北極星、UI/UX 設計最完整**的一塊，值得整體移植當範本。

**(b) contextPacketService.ts（後端，393 行）**
`import * as db from "../../db"` 直接吃整個 db.ts 巨石（`getCreativeProject`/`getTeamMembership`/`listDataSourceConnectionsForUser`），不是走 repository 介面。只想要 contextPackets 子系統，就必須先把這幾個函式從 db.ts 剝出成獨立 repository，否則等於把整份 5701 行 db.ts 一起搬。**`DataSourceAdapter[]` 可插拔資料來源＋packet TTL 的設計本身值得照抄**（見 `contracts.ts`），但呼叫 db 的方式不該照抄。

- **移植風險**：
  1. 前端 spine 對應的後端 procedure 分散在多個 video router，實際是「半套系統」，不是獨立 SDK，搬過去仍要重新對接新站的後端。
  2. 主稽核結論已指出「北極星分鏡後斷裂 + prod 旗標 OFF」——這條路徑**在生產環境從未被驗證過**。移植時要把它當「設計範本」而非「已驗證可用的資產」，風險不是程式碼品質，是「未經 prod 驗證」。
- **建議**：搬**設計**（五步導引 UI/UX、adapter-based 可插拔資料來源、packet TTL）優先於搬**程式碼**；contextPacketService 對 db.ts 的直接呼叫要重寫成新站的 repository 介面。
- **對應稽核卡**：M2、M4、M0（blueprint）、DI-01（db.ts 巨石）、AIDV-303（project context adapters）
- **預估相對工時**：只搬 UI 範本+adapter 設計 **中**（4–6 人日）；連 spine gateway 整套搬並接新後端 **高**（10+ 人日）。

---

## 5. fal / replicate / suno 整合（`server/services/ai-adapters/*`）

- **可移植性：高** —— 全倉庫耦合最乾淨的一塊。
- **架構**：統一 `AIAdapter` 介面（`proxy(req): Promise<Response>`），`registry.ts` + `bootstrap.ts` 註冊各 provider，每個 provider adapter（`fal`/`suno`/`elevenlabs`/`gemini`.adapter.ts）只有 10–40 行，只依賴 `providerFacade.ts`（156 行，純函式 `resolveProviderBaseUrl`/`providerGatewayHeaders`）+ `process.env.<PROVIDER>_API_KEY`。`replicateClient.ts` 更簡單，直接包官方 `replicate` npm SDK，零內部相依（`import Replicate from "replicate"` 是唯一 import）。
- **需帶走的相依**：`ai-adapters/types.ts` + `registry.ts` + `bootstrap.ts` + `providerFacade.ts`，總共約 600–700 行——本次盤點第二乾淨的資產。
- **移植風險**：低。但要順手檢查 `webhookSuno.ts`/`webhookReplicate.ts`（webhook 接收端）的 HMAC 驗簽是否到位——對照 IA0 業界對齊建議「webhook HMAC」，若舊站這塊還沒做齊，移植時應**直接補上**，不要把「沒有 HMAC」的洞也一起複製過去。
- **對應稽核卡**：A-cost-integrations、IA0（webhook HMAC）
- **預估相對工時**：**低**（2–3 人日，含補齊 webhook HMAC 驗簽）。

---

## 6. RAG（teachingArchiveRag / ragMemory / ragInjectionGuard）

- **可移植性：中高**（邏輯乾淨，但 vendor lock 在 Pinecone + Gemini embedding）
- **檔案**：
  - `ragMemory.ts`（323 行）：Pinecone 底層（`getEmbedding`/`getPineconeHeaders`/`getIndexHost`），只依賴 `serverEnv.PINECONE_*`/`GEMINI_API_KEY`。
  - `teachingArchiveRag.ts`：chunk 策略（1200 字元＋200 overlap、句界優先、deterministic 切法方便重新 upsert），依賴 `ragMemory` 匯出函式，**失敗 silent-return** 設計良好（embedding/Pinecone 掛掉就讓 LIKE fallback 接手，RAG 是錦上添花不是必需）。
  - `ragInjectionGuard.ts`（447 行）：`sanitizeContextPacketField`，防 prompt injection，與 vendor 無關，純字串處理。
- **移植風險**：
  1. 寫死 Pinecone index 名稱、`dimension=3072`、`gemini-embedding-001`——換 embedding provider 或 vector store（如新站想用 pgvector/Qdrant）需要重寫 `getEmbedding`/`getIndexHost`，不是抽換設定值就能搞定。
  2. 移植前建議先確認 `teachingArchiveRag.ts` 在目前 prod 路徑是否真的被呼叫（K4 死碼盤點有提過類似疑慮），避免把死碼當活資產搬。
- **建議**：chunk 策略＋fail-silent 設計哲學＋`ragInjectionGuard.ts` 可直接搬；vector store 串接依新站選型重寫。
- **對應稽核卡**：IA0、K4（deadcode，搬前先核實非死碼）
- **預估相對工時**：chunk 策略+guard 直接搬 **低**（1–2 人日）；換 vector store 需重寫底層 **中**（3–5 人日）。

---

## 7. shared 契約/型別

- **可移植性：低–中**（發現一個關鍵耦合點，見下）
- **關鍵發現**：`shared/types.ts` 第 5 行：
  ```ts
  export type * from "../drizzle/schema";
  ```
  這個檔案號稱「統一型別匯出」，實際上把整份 **4758 行 drizzle schema**（102 表 0 FK + 命名漂移，即 DI-01 本體）原封不動 re-export。換句話說，「shared 契約/型別」**不是一層乾淨的 contract**，而是與 schema 巨石焊死的——拿 `shared/types.ts` 就等於拿了整個 schema 及其債務，無法只拿型別不拿債。
- **真正乾淨、可獨立搬的檔案**（零 DB 相依、純工具/型別）：`shared/_core/errors.ts`（19 行）、`shared/currency.ts`（87 行）、`shared/genId.ts`（13 行）、`shared/csv-safe.ts`、`shared/safe-url.ts`、`shared/engineModelIds.ts` 等——這些**可移植性高**，可直接搬。
- **不建議照抄的部分**：`shared/` 下約 50 個 `orb-*.ts`（`orb-agent-*`、`orb-dag-scheduler`、`orb-task-state-machine`……）正是主稽核點名「8087 行 agentToolExecutor + 178 不可達工具」的關聯區。整包 `shared/`（127 個檔）搬過去等於把用不到的複雜度和技術債一起搬，**不建議整包搬，需逐檔白名單挑選**。
- **建議篩選方法**：對 127 個檔跑兩軸判斷——(1) 是否被 `drizzle/schema.ts` re-export/依賴；(2) 是否屬於 `orb-*` 系列。零 schema 依賴＋零 orb 依賴的檔案（errors/currency/genId/csv-safe/safe-url/engineModelIds/各 modelRegistry 純資料檔）可直接搬；其餘要等新站 schema 設計定案後重新產生型別，不要整包搬。
- **對應稽核卡**：DI-01（102 表 0 FK）、SD（drizzle 快照落後）、K4（deadcode contracts）、Q4（178 不可達工具）
- **預估相對工時**：逐檔盤點+篩選 **中**（3–4 人日盤點 + 2 人日搬移乾淨型別）；若連 schema 一起帶走再瘦身，屬於新 DB 設計範疇，非純移植工作，**高**（另計）。

---

## 總表

| # | 資產 | 可移植性 | 相對工時 | 帶走時的主要相依 | 最大風險 | 對應稽核卡 |
|---|------|:---:|:---:|------|------|------|
| 1 | 計費原語 deduct/refund/atomicClaimJobRefund | 中 | 低–中 | getDb、users/background_jobs 兩表欄位、drizzle sql | MySQL 專屬 SQL 語法；活在 db.ts 巨石裡 | W5, B-27, B-31, B-32, B-22, X3 |
| 2 | secretCrypto | **高** | **極低** | 無（僅 env var + Node crypto） | 舊密文遷移需同金鑰（需 Bruce 提供） | GC3 |
| 3a | 模型目錄/定價資料層 | 高 | 低 | 純資料，無邏輯相依 | 過期/停用模型隨著搬過去 | H1, A-cost-integrations |
| 3b | falDispatcher 派工引擎 | 低 | 中高 | db.ts、orbCostGuard、websocket、記憶 | 計費外圈失效+工具氾濫一起搬 | K2, Q4 |
| 4a | ProjectFlowGuide + spine（前端） | 中 | 中–高 | 整個 client/src/spine/（1715 行）+ 對應 router | 是設計範本，非已驗證資產（prod 旗標 OFF） | M2, M0 |
| 4b | contextPacketService（後端） | 中 | 中 | 需先剝出 db.ts 裡 3–4 個函式 | 直接吃 `import * as db` 巨石 | M4, DI-01 |
| 5 | fal/replicate/suno adapters | **高** | **低** | ai-adapters/types+registry+bootstrap+providerFacade（~600行） | webhook HMAC 是否已補齊需檢查 | IA0 |
| 6 | RAG（chunk+guard） | 中高 | 低（vendor 綁定部分中） | serverEnv、Pinecone/Gemini API | vendor lock：換 vector store 需重寫底層 | IA0, K4 |
| 7 | shared 契約/型別 | 低–中 | 中 | 需逐檔篩選，不能整包 import | shared/types.ts 與 4758 行 schema 焊死 | DI-01, SD, K4, Q4 |

---

## 決策建議（綜合）

**可幾乎照抄、新站第一週就能用的「真便宜貨」**：secretCrypto（#2）、fal/replicate/suno adapters（#5）、RAG 的 chunk 策略 + ragInjectionGuard（#6 局部）、模型目錄純資料層（#3a）。這幾塊耦合最乾淨，工時最低，且不帶技術債。

**邏輯值錢但要「重新包裝」、不要照搬檔案的**：計費原語（#1）——借演算法（FOR UPDATE + CAS）不借 db.ts 宿主，且移植時應順手外接既有的 `ledger.ts` 補齊複式帳本；falDispatcher 派工引擎（#3b）——借「queue 輪詢+fallback 鏈」概念，用 `ai-adapters/` 的乾淨介面重新蓋，不要照抄 1406 行。

**邏輯值錢但目前「半套/未驗證」、應視為設計參考而非可執行資產的**：ProjectFlowGuide + spine + contextPackets（#4）——UI/UX 與 adapter 設計是這個 repo 最貼近北極星的資產，但後端串接斷裂、prod 旗標 OFF，代表這條路徑從未在生產環境跑通過；移植價值在「設計圖」，不在「這份程式碼已經驗證能動」。

**高風險、需整包重新評估、不建議照抄的**：`shared/types.ts` 與 4758 行 schema 的焊死關係（#7）；`db.ts` 本體（所有計費/context 函式的宿主，102 表 0 FK + 命名漂移）；`shared/` 下 orb-* 系列（8087 行 agentToolExecutor 關聯區）。

**通用交叉相依（跨越以上多項資產）**：`server/_core/env.validated.ts`（939 行）、`server/_core/featureFlags.ts`（339 行）幾乎每個模組都 import。移植任何一塊都要先決定「帶原檔瘦身」還是「新站重寫一份對應子集的 env 驗證」，不能整檔案照搬——否則會逼新站在啟動時滿足一堆與被搬模組完全不相干的子系統 env 需求（zod 驗證失敗會擋啟動）。

**需 Bruce 提供才能定案的輸入**：
- 是否要把舊站既有加密憑證（`data_source_connections.encryptedCredentialRef`）遷移到新站（決定 secretCrypto 金鑰是否需沿用）
- 新站 DB 選型（繼續 MySQL，還是換 Postgres/Supabase——直接決定計費原語 SQL 要不要重寫）
- 是否保留 Pinecone 合約，或換 vector store（決定 RAG 底層要不要重寫）
- 團隊人力與時程（本文件工時僅為相對比較，非交期承諾）
