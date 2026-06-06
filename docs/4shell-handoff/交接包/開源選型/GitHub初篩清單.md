# GitHub 初篩清單 — AI-Director 開源候選（Claude 種子輪）

> **這是什麼**：Claude 親自做的**第一輪 GitHub 真實初篩**，按類別種好候選短名單，給 **Codex／Antigravity 接著擴充**（規則見 `開源選型協議.md`）。
> **撰寫日 / 基準**：2026-06-06。活躍度以此日為基準。`main` HEAD `2888a36`。
> **資料來源**：`api.github.com/repos/*`（標「✓API」者為當下實查精確值）＋ Web 搜尋／官網 LICENSE（標「≈」為近似、「待複驗」為未取得精確值）。**未杜撰**；不確定一律標註，請代理複驗後再定稿。
> **紅線提醒**：每個候選都已對 `開源選型協議.md §1`（L1–L15）檢核。**牴觸鎖定決策者集中在 §99「⚠️ 偏離計畫」分區，預設不採用**。授權/供應鏈雙審見協議 §9。**本清單不安裝任何東西。**

**徽章**：✅推薦 ｜ ◑條件式(有但書) ｜ ⚠️偏離計畫 ｜ 🔶授權需審 ｜ 🧪健康度旗標 ｜ 🔌接縫(#1–#5/spine/ui)

> ### 🔁 複驗快照（2026-06-07，`api.github.com` 實查，整合進各代理交接 §11）
> **已確認**：graphile/worker **2,288★·push 2026-06-05·MIT**｜cockatiel **1,789★·2026-05-26·MIT**｜ffmpeg.wasm **17,547★·push 2026-02-01(🧪近4月)·MIT(wrapper)**｜huggingface.js **2,430★·2026-06-06·MIT**｜postiz-app **30,767★·2026-05-24·AGPL-3.0**🔶｜tldraw **47,546★·2026-06-01·NOASSERTION(自訂)**🔶｜langfuse **28,219★·2026-05-30·Other/NOASSERTION（MIT core＋EE 商用子目錄）**🔶｜openllmetry **7,153★·2026-05-29·Apache-2.0**｜openfga **5,203★·2026-05-28·Apache-2.0**。
> **仍待複驗**（API 當下未回）：pg-boss、konva/react-konva、models.dev、tus、remotion 精確星數、fabric.js、excalidraw、react-photo-album、TanStack Table/Virtual、vercel/ai、twick/react-timeline-editor/openreel、canva-apps-sdk-starter-kit → 由 Codex（A–E 類）/Antigravity（F–L 類）依 `代理分工_開源選型.md` 補齊。

---

## 1. RAG／向量（Seam #4 · P3 · `ragMemory`/`contextPacket`）

缺口：Pinecone→pgvector（halfvec(3072)+HNSW）、hybrid 檢索。鎖定決策 L4＝向量留在同一個 Supabase Postgres。

### ✅ pgvector/pgvector — 🔌#4
- **Repo**: https://github.com/pgvector/pgvector ｜ **★** ≈21.5k（搜尋值 2026-06；API 當下回空，待精確）｜ **活躍** 2026（持續）｜ **授權** PostgreSQL License ✅ ｜ **語言** C
- **對位/缺口**：P3 向量主體；**就是鎖定決策本身**（L4）。支援 `halfvec`（2-byte，可索引至 4,000 維 → 覆蓋 3072）、HNSW/IVFFlat。
- **用在哪**：`server/services/ragMemory.ts` Pinecone→pgvector；`contextPacket.compileProject` 的檢索層。
- **相容**：L4 ✅、L3(Drizzle 原生支援 pgvector 欄位) ✅、L5 ✅。**整合工作量** M（隨 P3 遷移；re-embed 全量）。**風險**：低（PG 官方生態）。**結論**：✅推薦（核心）。

### ✅ timescale/pgvectorscale — 🔌#4
- **Repo**: https://github.com/timescale/pgvectorscale ｜ **★ 3,036 ✓API** ｜ **活躍** 2026-04-30 ✓API ｜ **授權** PostgreSQL License ✅ ｜ **語言** Rust
- **對位/缺口**：pgvector 的**規模/效能補強**（StreamingDiskANN、SBQ 壓縮），同在 Postgres，不換方向。
- **用在哪**：資料量大時的 ANN 索引；與 pgvector 並存。**相容** L4 ✅。**工作量** M（Rust 擴充需在 PG/Supabase 可裝；Supabase 是否允許自訂擴充需確認）。**風險**：◑ 需確認 Supabase 託管能裝此擴充。**結論**：✅推薦（規模化時）。

### ◑ paradedb/paradedb（pg_search）— 🔌#4 🔶
- **Repo**: https://github.com/paradedb/paradedb ｜ **★** ≈9–12k（待複驗）｜ **活躍** 2026（活躍）｜ **授權** **AGPL-3.0** 🔶（pg_sparse 為 PostgreSQL License）｜ **語言** Rust(Tantivy/pgrx)
- **對位/缺口**：Postgres 內 **BM25 全文 + hybrid search**（補關鍵字檢索，配 pgvector 做混合）。
- **但書**：① **AGPL** → 只可當**外部 PG 擴充/服務**，不 vendor 進專有碼，需 Bruce 確認商業合規；② 官方標示 vector/hybrid「coming soon」→ **成熟度待觀察**；③ Supabase 託管能否裝待確認。**相容** L4（同 PG）✅ 但授權需審。**結論**：◑條件式（hybrid 需求成立且授權過關才採）。

> ⚠️ 偏離者（外部向量庫，牴觸 L4）見 §99：Qdrant / Weaviate / Milvus / tensorchord-pgvecto.rs（取代 pgvector）。

---

## 2. 工作佇列／可靠性（spine · P0→P4 · `background_jobs`/video jobs）

缺口：**線上任務 50% 失敗**（`/admin` 背景任務 139／失敗 70）；M3 video session/segment 編排；可靠性三件套（DLQ＋退避＋reaper）。偏好 **Postgres-native**（貼合 Supabase，免新基礎設施）。

### ✅ graphile/worker — 🔌spine
- **Repo**: https://github.com/graphile/worker ｜ **★ 2,288 ✓API** ｜ **活躍** 2026-06-05 ✓API（極活躍）｜ **授權** MIT ✅ ｜ **語言** TypeScript
- **對位/缺口**：高效能 **Node + Postgres 任務佇列**（SKIP LOCKED），內建重試/排程/退避 → 直接補可靠性三件套與 video job 編排。
- **用在哪**：包/取代 `background_jobs` 輪詢；承接 `video_segment_jobs`→生成 adapter 的 enqueue/poll/reaper。**相容** L4/L5（純 PG，零新基礎設施）✅、L12（可 flag）✅。**工作量** M。**風險**：低（MIT、TS、活躍）。**結論**：✅推薦（佇列首選 A）。

### ✅ timgit/pg-boss — 🔌spine
- **Repo**: https://github.com/timgit/pg-boss ｜ **★** ≈3.1k（待複驗）｜ **活躍** 2026（活躍，v8.x）｜ **授權** MIT ✅ ｜ **語言** JavaScript/TS types
- **對位/缺口**：Node+Postgres 佇列（SKIP LOCKED、exactly-once、pub/sub、`@pg-boss/dashboard` 監控）。
- **用在哪**：同 graphile/worker 的替代；dashboard 對「線上 50% 失敗」可觀測有加分。**相容** L4/L5 ✅。**工作量** M。**結論**：✅推薦（佇列首選 B；與 graphile/worker 二選一，看 API 偏好）。

### ✅ connor4312/cockatiel — 🔌spine
- **Repo**: https://github.com/connor4312/cockatiel ｜ **★ 1,789 ✓API** ｜ **活躍** 2026-05-26 ✓API ｜ **授權** MIT ✅ ｜ **語言** TypeScript
- **對位/缺口**：**退避重試 + 熔斷 + 逾時 + bulkhead + fallback** 的 in-process 韌性庫 → 正中可靠性三件套的「退避/逾時 vs 格式異常分流」，**零新基礎設施**。
- **用在哪**：包 `generate.*`/fal 呼叫、HF Jobs 輪詢；接 `orb_system_alerts`/`alert_configs`。**相容** 全部（純庫）✅。**工作量** S。**結論**：✅推薦（韌性核心）。

### ◑ sindresorhus/p-retry（＋p-queue）— 🔌spine
- **Repo**: https://github.com/sindresorhus/p-retry ｜ **★** ≈2k（待複驗）｜ **活躍** 2026 ｜ **授權** MIT ✅ ｜ **語言** TypeScript
- **對位**：最輕量的重試（配 `p-queue` 控併發）。**結論**：◑（只需重試時的輕量替代 cockatiel；功能較少）。

### ◑ BullMQ（taskforcesh/bullmq）— 🔌spine
- **Repo**: https://github.com/taskforcesh/bullmq ｜ **★** ≈9k（待複驗）｜ **活躍** 2026 ｜ **授權** MIT ✅（注意 `bullmq-pro` 為商用）｜ **語言** TypeScript
- **但書**：**需 Redis 基礎設施**（Railway 可加，但比 Postgres-native 多一個元件）。**相容** L5 ✅、但與「少新基礎設施」偏好相左。**結論**：◑條件式（已有 Redis 或需高吞吐才選；否則用 graphile/worker / pg-boss）。

> 其他可由代理複驗的 durable 編排（多為自帶服務，◑/待評）：`hatchet-dev/hatchet`、`inngest/inngest`、`triggerdotdev/trigger.dev`。

---

## 3. 多模態生成閘道／模型路由（Seam #2 · P4 · `generate.*`/`GenerationProvider`）

缺口：HF/Gemini provider、fal/replicate 回退鏈與血統（`asset_generation_events`）。鎖定 L6（LLM 仍 OpenRouter）、L7（生成 B 案）。

### ✅ huggingface/huggingface.js — 🔌#2
- **Repo**: https://github.com/huggingface/huggingface.js ｜ **★ 2,430 ✓API(2026-06-07 複驗)** ｜ **活躍** 2026-06-06 ✓ ｜ **授權** MIT ✅ ｜ **語言** TypeScript
- **對位/缺口**：官方 JS（`@huggingface/inference` 生成、`@huggingface/hub` `listModels/modelInfo`）→ `HfGenerationAdapter` 與模型資料源。
- **用在哪**：`server/services/generation/HfGenerationAdapter.ts`（Codex）；/learn 模型資料。**相容** L7 ✅。**工作量** S–M。**結論**：✅推薦（HF 官方）。

### ◑ vercel/ai（AI SDK）— 🔌#2
- **Repo**: https://github.com/vercel/ai ｜ **★** ≈15k+（待複驗）｜ **活躍** 2026（AI SDK 6）｜ **授權** Apache-2.0 ✅ ｜ **語言** TypeScript
- **對位**：`generateImage` 跨 provider 抽象（Replicate/Vertex/OpenAI…）可作 `GenerationProvider` 的**媒體抽象實作參考**。
- **但書**：**只可用於生成/媒體抽象（Seam #2）；不可用其 LLM 路由取代 OpenRouter（L6）**。**結論**：◑條件式（限生成層；嚴禁碰 LLM 閘道）。

### ✅ 已在棧內（沿用、非新引入）
- `@fal-ai/client`、`replicate`、`elevenlabs`、`@google/genai`：已是現況生成棧，直接做各自 adapter（`Fal/Gemini` 等）。**結論**：✅沿用。

> ⚠️ 偏離者見 §99：`BerriAI/litellm`（LLM proxy，牴觸 L6）。

---

## 4. 瀏覽器內影片時間軸／初剪（ui · /video cockpit）

缺口：`/video` 初剪/時間軸視圖（分鏡 `S0X` → 粗排）。注意授權。

### ✅ ffmpegwasm/ffmpeg.wasm — 🔌ui
- **Repo**: https://github.com/ffmpegwasm/ffmpeg.wasm ｜ **★ 17,547 ✓API** ｜ **活躍** push 2026-02-01 ✓API（🧪 近 4 月未 push，複驗時確認維護）｜ **授權** MIT（包裝層）✅ ｜ **語言** C/WASM
- **對位/缺口**：瀏覽器端轉碼/裁切/拼接 → 初剪不必上傳即可預覽合成。**但書**：FFmpeg 本體授權（LGPL/GPL 依 build）與包裝層 MIT 不同，用 `--enable-gpl` build 需審。**相容** L1/L11 ✅。**工作量** M。**結論**：✅推薦（瀏覽器初剪處理）。

### ◑ ncounterspecialist/twick — 🔌ui
- **Repo**: https://github.com/ncounterspecialist/twick ｜ **★** 待複驗 ｜ **活躍** 2026 ｜ **授權** 待複驗（疑 MIT/Apache）｜ **語言** TypeScript/React
- **對位**：React 時間軸視訊編輯 SDK（`@twick/timeline`＋`@twick/video-editor`、MP4 匯出）。**但書**：較新、健康度/授權**待複驗**。**結論**：◑條件式（最貼 /video 初剪，須先驗授權與維護）。

### ◑ xzdarcy/react-timeline-editor — 🔌ui
- **Repo**: https://github.com/xzdarcy/react-timeline-editor ｜ **★** 待複驗 ｜ **活躍** 待複驗 🧪 ｜ **授權** MIT（待複驗）｜ **語言** TypeScript/React
- **對位**：純時間軸 UI 元件（拖拉/軌道）。**但書**：可能維護緩慢，需查活躍度。**結論**：◑（只要時間軸 widget 時的輕量選項）。

### ◑ Augani/openreel-video — 🔌ui
- **Repo**: https://github.com/Augani/openreel-video ｜ **★** 待複驗 ｜ **授權** 待複驗 ｜ **語言** TS（WebCodecs/WebGPU）
- **對位**：瀏覽器多軌編輯（無浮水印/無雲端）。**結論**：◑（功能強，須驗授權/健康度/瀏覽器相容）。

### 🔶 remotion-dev/remotion ＆ designcombo/react-video-editor — 🔌ui
- **Repo**: https://github.com/remotion-dev/remotion ｜ **授權** **Remotion License** 🔶（個人/≤3 員工免費；for-profit 較大組織需**商用授權，$100/月起、4 席**；Editor Starter $600 一次性）｜ **語言** TS/React
- **但書**：**授權成本** → 對營利平台預設不採用，待 Bruce 確認商業條款。`designcombo/react-video-editor`（Capcut/Canva clone）**依賴 Remotion**，**繼承同一授權風險**。**結論**：◑/🔶（功能最完整但授權需付費；列為 Bruce 決策項，非預設推薦）。

---

## 5. 影像圖層拼接／canvas 編輯器（ui · /social 圖層拼接）

缺口：`/social` 圖層/品牌拼接（文字、比例、品牌鎖定視覺）。

### ✅ konvajs/konva（+ react-konva）— 🔌ui
- **Repo**: https://github.com/konvajs/konva ｜ **★** ≈12k（konva，待複驗）；react-konva **6.3k（待複驗，搜尋值）** ｜ **活躍** react-konva v19.2.4 @ 2026-05-08 ｜ **授權** MIT ✅ ｜ **語言** TypeScript
- **對位/缺口**：React 宣告式 2D canvas（Rect/Text/Image/Transformer）→ 海報圖層拼接、品牌套版。**相容** L1（React19）✅、L11 ✅。**工作量** M。**結論**：✅推薦（/social 圖層編輯首選，React 原生）。

### ✅ fabricjs/fabric.js — 🔌ui
- **Repo**: https://github.com/fabricjs/fabric.js ｜ **★** ≈30k（待複驗）｜ **活躍** 2026 ｜ **授權** MIT ✅ ｜ **語言** JavaScript/TS
- **對位**：成熟 canvas 物件模型（序列化、濾鏡、文字）。**但書**：非 React 原生（需薄包裝）。**結論**：✅推薦（功能深的替代/補充 konva）。

### ◑ excalidraw/excalidraw — 🔌ui
- **Repo**: https://github.com/excalidraw/excalidraw ｜ **★** ≈80k+（待複驗）｜ **活躍** 2026 ｜ **授權** MIT ✅ ｜ **語言** TypeScript/React
- **對位**：白板/手繪風版面。**但書**：偏白板，非海報級精準排版。**結論**：◑（版面草圖/協作標註，非主力拼接）。

### 🔶 tldraw/tldraw — 🔌ui
- **Repo**: https://github.com/tldraw/tldraw ｜ **★ 47,546 ✓API** ｜ **活躍** 2026-06-01 ✓API ｜ **授權** **自訂 tldraw license** 🔶（NOASSERTION；SDK 預設浮水印，移除需付費授權）｜ **語言** TypeScript/React
- **但書**：**授權需審**（商用/浮水印條款）。**結論**：◑/🔶（無限畫布 SDK 強，但授權成本 → Bruce 決策項，非預設）。

> polotno（設計編輯器 SDK）為商用 🔶，如需「Canva 式」整版編輯再由 Antigravity 複驗條款。

---

## 6. 模型登錄／瀏覽 UI（ui/data · /learn · 115 模型 `aiModels`）

缺口：模型目錄資料源 + 大列表瀏覽 UI（115 模型、5 腦指派）。

### ✅ sst/models.dev — 🔌data
- **Repo**: https://github.com/sst/models.dev ｜ **★** 待複驗 ｜ **活躍** 2026 ｜ **授權** 待複驗（疑 MIT；資料另有授權，須查）｜ **語言** TS + TOML 資料
- **對位/缺口**：開源 **AI 模型規格/定價/能力資料庫**（TOML→JSON endpoints）→ 餵 `/learn` 115 模型瀏覽器與 `aiModels.*`、成本估算。**相容** L6/L7（純資料）✅。**工作量** S。**結論**：✅推薦（模型資料源；資料授權待複驗）。

### ✅ TanStack Table + TanStack Virtual — 🔌ui
- **Repo**: https://github.com/TanStack/table ｜ https://github.com/TanStack/virtual ｜ **★** 待複驗（皆大）｜ **授權** MIT ✅ ｜ **語言** TypeScript
- **對位**：115 模型/82-表 admin 的虛擬化大列表、排序/篩選。**相容** L1 + **已用 @tanstack/react-query（同家族）** ✅。**工作量** S。**結論**：✅推薦（大列表 UI；同生態零摩擦）。

### ✅ huggingface.js（`@huggingface/hub`）
- 見 §3：`listModels/modelInfo` 可即時補 HF 模型清單。**結論**：✅（資料源之一）。

---

## 7. 提示詞庫／素材管理／gallery 展示牆（ui · spine · `featured_showcase`/提示詞庫）

缺口：範本牆（`showcase.templates` 確認待建）、Flow 電視展示牆、gallery。

### ✅ igordanchenko/react-photo-album — 🔌ui
- **Repo**: https://github.com/igordanchenko/react-photo-album ｜ **★** ≈2.6k（待複驗）｜ **活躍** 2026 ｜ **授權** MIT ✅ ｜ **語言** TypeScript/React
- **對位/缺口**：響應式相簿（rows/columns/**masonry**/justified、SSR、TS）→ Flow 展示牆 + showcase gallery。**相容** L1 ✅。**工作量** S。**結論**：✅推薦（展示牆/精選牆）。

### ◑ igordanchenko/yet-another-react-lightbox — 🔌ui
- **Repo**: https://github.com/igordanchenko/yet-another-react-lightbox ｜ **授權** MIT ✅ ｜ **語言** TS/React ｜ **★** 待複驗
- **對位**：gallery 點開大圖/輪播。**結論**：◑（配 react-photo-album 的細節檢視）。

> 提示詞庫 CRUD 本身已存在（`promptLibrary.*`/`customBlocks.*`/`blockCombos.*`，5 表），**OSS 不需取代**；只在「展示/瀏覽 UI」補件。

---

## 8. 社群發佈（PostingProvider · 類 Seam #2 · P5 · 社群唯一全新接縫）

缺口：`/social/publish`→多平台排程發佈（程式碼校正：`PostingProvider` **現況 0 實作**）。

### ◑ gitroomhq/postiz-app — 🔌#2-like 🔶
- **Repo**: https://github.com/gitroomhq/postiz-app ｜ **★ 30,767 ✓API** ｜ **活躍** 2026-05-24 ✓API ｜ **授權** **AGPL-3.0** 🔶 ｜ **語言** TypeScript（Next.js+Redis）
- **對位/缺口**：28+ 平台社群排程發佈 → `PostingProvider` 的真實後端。**環境已備 Postiz 連接器/skill**。
- **但書**：**AGPL** → **不可 vendor 原始碼**進專有平台；**只能當外部服務/連接器/MCP 呼叫**（用其 API 或 hosted），需 Bruce 確認商業合規。**相容** L5/L12（當服務、掛 flag）✅。**工作量** M（接 API/連接器）。**結論**：◑條件式（PostingProvider 首選，但限「服務/連接器」用法）。

---

## 9. 設計工具整合（Canva／Adobe · ui/外部 · /social）

缺口：對外設計/出圖整合。**多為專有 SaaS SDK，非 GitHub 核心 OSS**——以官方 SDK/連接器接入。

### ◑ Canva Connect API（＋ `canva/canva-apps-sdk-starter-kit`）
- **Repo**（starter，OSS）: https://github.com/canva/canva-apps-sdk-starter-kit ｜ **授權** 待複驗 ｜ **語言** TypeScript
- **對位**：Canva 設計建立/匯出整合；**環境已備 Canva 連接器（MCP）**。**結論**：◑（用 Connect API/連接器，不 vendor；SDK starter 僅參考）。

### ◑ Adobe Firefly Services / Express Embed SDK / Photoshop API
- **性質**：Adobe 專有 SaaS（非 OSS）；**環境已備 Adobe 連接器（MCP）**。**結論**：◑（用官方 API/連接器；計費與條款由 Bruce 確認）。

> 此類**不是「裝 npm 套件」**而是「接外部服務/連接器」；遵協議 §9（不 vendor、Bruce 拍板）。

---

## 10. Auth／RBAC（spine/settings · P3/P6 · `project_data_access_rules`/teams）

缺口：**授權層（RBAC/ABAC）**補強。鎖定 **L13＝登入維持自建 JWT**（jose+Google OAuth+TOTP）。**「授權」可補強；「登入/簽發」不可換。**

### ✅ stalniy/casl — 🔌spine/settings
- **Repo**: https://github.com/stalniy/casl ｜ **★ 6,949 ✓API** ｜ **活躍** 2026-05-26 ✓API ｜ **授權** MIT ✅ ｜ **語言** TypeScript
- **對位/缺口**：同構（前後端）授權庫（定義 ability、條件式權限）→ 落地 `project_data_access_rules`/teams ACL，前端按權限隱藏 UI。**不碰登入**（相容 L13）✅。**工作量** S–M。**結論**：✅推薦（RBAC 授權層首選，in-process）。

### ◑ openfga/openfga — 🔌spine 🔶(基礎設施)
- **Repo**: https://github.com/openfga/openfga ｜ **★ 5,203 ✓API(2026-06-07 複驗)** ｜ **活躍** 2026-05-28 ✓（CNCF Incubating）｜ **授權** Apache-2.0 ✅ ｜ **語言** Go
- **對位**：Zanzibar 式 ReBAC/ABAC 授權引擎。**但書**：**獨立服務**（多一個部署元件）→ 多租戶很複雜時才值得。**結論**：◑條件式（重型替代 casl；先用 casl，規模化再評）。

> 其他：`casbin/node-casbin`（RBAC 庫，◑ 替代 casl）。
> ⚠️ 偏離者見 §99：Supabase Auth / Lucia / Auth.js / Better-Auth（**牴觸 L13 自建 JWT**）。

---

## 11. 可觀測性（spine/settings · M6 · `apiUsage`/`langsmith`/admin）

缺口：**`/admin/api-usage` 費用顯示 $0**（成本沒在記）、trace、成本帳本。現況已用 LangSmith。

### ✅ traceloop/openllmetry（+ openllmetry-js）— 🔌spine
- **Repo**: https://github.com/traceloop/openllmetry ｜ **★ 7,153 ✓API(2026-06-07 複驗)** ｜ **活躍** 2026-05-29 ✓ ｜ **授權** Apache-2.0 ✅ ｜ **語言** Python/**TS(openllmetry-js)**
- **對位/缺口**：**OpenTelemetry 標準**的 LLM/向量庫 instrumentation（OpenAI/Anthropic/Pinecone…）→ vendor-neutral trace/成本，**可匯出到既有觀測**、不鎖定。**相容** L6（不改 LLM 閘道，只觀測）✅。**工作量** M。**結論**：✅推薦（標準化觀測補強，與 LangSmith 並存）。

### ◑ langfuse/langfuse — 🔌spine 🔶(基礎設施/授權邊界)
- **Repo**: https://github.com/langfuse/langfuse ｜ **★ 28,219 ✓API(2026-06-07 複驗)** ｜ **活躍** 2026-05-30 ✓ ｜ **授權** **repo 層 Other/NOASSERTION**（MIT core＋`ee/` 商用子目錄；2026-01 ClickHouse 收購後承諾 core 續 MIT）🔶 ｜ **語言** TypeScript
- **對位**：LLM 觀測 + 成本 + prompt 管理 + evals，可自架。**但書**：**自架需 Postgres + ClickHouse**（多一個 OLAP 元件）；**MIT core 與 EE 邊界需逐目錄審**；現況已有 LangSmith → 視為**自架替代/補強**。**結論**：◑條件式（要自主掌控觀測資料才採；否則先 openllmetry + 現有 LangSmith）。

---

## 12. 儲存（Seam #5 · P4 · `IAssetStorage`）

缺口：影片大檔上傳/續傳可靠性。鎖定 L4（可選 Supabase Storage）+ 既有 R2/S3/GCS。

### ✅ tus/tus-js-client（+ tus/tusd）— 🔌#5
- **Repo**: https://github.com/tus/tus-js-client ｜ https://github.com/tus/tusd ｜ **★** 待複驗 ｜ **活躍** 2026 ｜ **授權** MIT ✅ ｜ **語言** JS(client)/Go(tusd)
- **對位/缺口**：**可續傳上傳協定**（瀏覽器/Node）→ 大型影片上傳中斷可續，掛 `IAssetStorage` 後對接 R2/S3 或 tusd。**相容** L5（tusd 可在 Railway/Docker）✅。**工作量** M。**結論**：✅推薦（大檔上傳可靠性）。

> Supabase Storage 屬鎖定方向內（S5 選項），非新引入。

---

## 13. tRPC／Drizzle／React 生態輔助（Seam #1/全 · P1+ · adapters/fixtures）

缺口：mock fixtures（P1 MockDataStore）、zod schema、大列表、開發體驗。**優先沿用已在棧內者**。

### ✅ drizzle-team/drizzle-zod — 🔌#1
- **Repo**: https://github.com/drizzle-team/drizzle-orm（drizzle-zod 套件）｜ **授權** Apache-2.0 ✅ ｜ **語言** TypeScript ｜ **★** 待複驗（隨 drizzle-orm）
- **對位**：由 Drizzle schema 生成 zod（配 zod 4）→ adapter 邊界驗證、型別單一真相。**相容** L2/L3 ✅。**工作量** S。**結論**：✅推薦（生態內，零摩擦）。

### ✅ drizzle-team/drizzle-seed — 🔌#1
- **Repo**: https://github.com/drizzle-team/drizzle-orm（drizzle-seed 套件）｜ **授權** Apache-2.0 ✅ ｜ **語言** TypeScript ｜ **★** 待複驗
- **對位**：決定式假資料 → **P1 MockDataStore fixtures**（淡大第七幕、3 角色、6 個 `S0X`）。**結論**：✅推薦（mock 種子）。

### ✅ faker-js/faker — 🔌#1
- **Repo**: https://github.com/faker-js/faker ｜ **★ 15,353（搜尋值，待精確）** ｜ **活躍** 2026 ｜ **授權** MIT ✅ ｜ **語言** TypeScript
- **對位**：mock fixtures 補充（名稱/文案/圖 meta）。**結論**：✅推薦（P1 fixtures）。

### ◑ trpc-panel / trpc-ui — 🔌spine(dev)
- **Repo**: https://github.com/iway1/trpc-panel ｜ **授權** 待複驗 ｜ **活躍** 待複驗 🧪（可能停更）｜ **語言** TS
- **對位**：tRPC API explorer（開發/除錯）。**但書**：維護狀態待驗。**結論**：◑（開發體驗加分，非必需）。

> **已在棧內、優先沿用（非新引入）**：`zod`(4)、`xstate`(確認門狀態機)、`@xyflow/react`+`dagre`(DAG/管線)、`@tanstack/react-query`、`framer-motion`、`three/fiber/drei`、`cmdk`(命令面板)、`react-hook-form`。**新候選若與這些重疊，一律沿用既有、不另引。**

---

## 99. ⚠️ 偏離計畫分區（牴觸鎖定決策；僅供 Bruce 參考、預設不採用）

> 以下**並非推薦**。列出是為了透明（這些是熱門但會「改變方向」的選項），**預設不採用**，除非 Bruce 明確要改對應鎖定決策。

| 類別 | 候選（例） | 牴觸 | 為何偏離 |
|---|---|---|---|
| LLM 路由/代理 | `BerriAI/litellm`、各家直連 SDK 取代閘道 | **L6** | LLM 閘道鎖定 OpenRouter；LiteLLM 會換掉閘道層 |
| 外部向量庫 | Qdrant、Weaviate、Milvus、`tensorchord/pgvecto.rs`(取代) | **L4** | 向量鎖定「同一個 Supabase pgvector」；外部庫=換方向 |
| ORM | Prisma、Kysely、TypeORM | **L3** | ORM 鎖定 Drizzle |
| API 層 | GraphQL（Apollo/urql）、ts-rest、OpenAPI codegen 取代 | **L2** | 端到端型別鎖定 tRPC |
| 前端框架/路由 | Next.js、React-Router、TanStack Router 取代 Wouter | **L1** | 框架/路由鎖定 React19+Vite7+Wouter |
| **認證** | **Supabase Auth、Lucia、Auth.js(NextAuth)、Better-Auth、Clerk** | **L13** | 登入/簽發鎖定**自建 JWT**；只可補「授權(RBAC)」不可換「認證」 |
| 全 agent 框架(取代 commander) | `mastra-ai/mastra`(≈22k★,Apache?待複驗)、`langchain-ai/langgraphjs`、CrewAI、AutoGen | **L8/L10** | 6-agent/commander 契約為準；**最多**作 `CommanderAdapter` 內部 executor 參考，**不可取代** commander/SubQ 主線 → 預設 ⚠️ |
| 觀測(取代 LangSmith 方向) | 任何要求拔掉 langsmith/改全套觀測棧者 | L12 | 只能並存補強，不可大爆炸換棧 |

> **agent 框架特別說明**：使用者把「多代理/agent 編排框架」列為要研究的類別 —— 可以研究、可以借鑑其 workflow/狀態管理寫法，但因 L8/L10，**任何「用框架取代既有 commander/6-agent」一律 ⚠️**。若要納入，必須證明「**只活在某個 `CommanderAdapter` 實作內部、不改 commander 契約、可 flag OFF 回退**」，由 Claude 評估後才可能從 ⚠️ 升 ◑。

---

## 100. 推薦短名單（本輪種子，按缺口優先序）

| 優先 | 缺口 | 主候選 | 備選 | 接縫/里程碑 | 授權 |
|---|---|---|---|---|---|
| 🔴 高 | 線上 50% 任務失敗 + video 編排 | **graphile/worker** | pg-boss / (BullMQ需Redis) | spine · P0→P4 | MIT |
| 🔴 高 | 退避/熔斷/逾時分流 | **cockatiel** | p-retry | spine · P0→P2 | MIT |
| 🔴 高 | Pinecone→pgvector | **pgvector** | + pgvectorscale（規模） | #4 · P3 | PostgreSQL |
| 🔴 高 | PostingProvider（社群發佈 0 實作） | **postiz-app（當服務/連接器）** | — | P5 | AGPL🔶 |
| 🟠 中 | HF 生成 provider + 模型資料 | **huggingface.js** | vercel/ai(限生成) | #2 · P4 | MIT |
| 🟠 中 | /social 圖層拼接 | **konva/react-konva** | fabric.js | ui · P5 | MIT |
| 🟠 中 | RBAC 授權層 | **casl** | openfga(重) | spine · P3/P6 | MIT |
| 🟠 中 | 成本/trace 觀測（api-usage $0） | **openllmetry** | langfuse(自架) | spine · M6 | Apache/MIT |
| 🟠 中 | 115 模型瀏覽資料/UI | **models.dev + TanStack Table/Virtual** | huggingface.js | ui/data · /learn | MIT |
| 🟢 低 | 展示牆/精選牆 | **react-photo-album** | yet-another-react-lightbox | ui · spine | MIT |
| 🟢 低 | 大檔續傳 | **tus(-js-client/tusd)** | — | #5 · P4 | MIT |
| 🟢 低 | mock fixtures（P1） | **drizzle-seed + faker** | — | #1 · P1 | Apache/MIT |
| 🟡 待Bruce | /video 初剪(功能完整) | twick / ffmpeg.wasm | remotion🔶(付費) / openreel | ui · /video | 混合，需審 |

---

*數據查核：✓API＝2026-06-06 實查 `api.github.com`（graphile/worker 2288、pgvectorscale 3036、cockatiel 1789、casl 6949、postiz 30767、tldraw 47546、ffmpeg.wasm 17547）；2026-06-07 複驗快照見文首（新增 huggingface.js 2430、langfuse 28219、openllmetry 7153、openfga 5203 等實查值）。其餘為 Web 搜尋/官網近似值，標「≈/待複驗」。Codex/Antigravity 擴充時請對每個候選複驗 stars/活躍/授權並補齊「待複驗」欄。延伸自 `開源選型協議.md`；待辦見 `代理分工_開源選型.md`。*
