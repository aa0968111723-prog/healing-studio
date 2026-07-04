# PF3 — 記憶體/大 payload
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:檔案上傳/下載、base64、影音緩衝、compose/videoCompiler、大 JSON 欄位、匯出/ZIP、SSE/WS 累積

方法論:先讀碼再判斷，不臆測；不確定處明寫「需負載驗證」。每條標 cluster、規模觸發條件、現在痛/規模大才痛。

---

## 摘要

本輪聚焦外部媒體下載 → 記憶體緩衝路徑（image-to-video 首幀圖、AI 生成結果匯入、AI Provider Proxy）、WebSocket 語音累積、以及使用者資產庫的無界查詢。核心發現：**同一個「下載外部媒體再處理」模式，在這個 codebase 裡至少有三種實作，成熟度落差很大**——`internalMedia.ts` 有明確的 10MB 上限注解但實作有漏洞，`pdfTextExtractor.ts` 做對了（下載前後雙重檢查），`geminiMedia.ts` 則完全沒有上限。這是同類程式碼各自演化、沒有共用 helper 造成的不一致。

---

## 1. 〔CRITICAL〕geminiMedia.ts：使用者可控 URL 的圖轉影下載，零位元組上限

- **檔案:行號**：`server/services/geminiMedia.ts:431-448`（`generateVideo()` 內圖生影下載）
- **鏈路**：`server/routers/generate.ts:365`（`firstFrameUrl: z.string().nullable().optional()` — 無 `.url()` 驗證、無網域限制）→ `generate.ts:1959`（`imageUrl: input.firstFrameUrl || input.characterRefUrl`）→ `gemini.generateVideoSync()` → `geminiMedia.ts` 的 `generateVideo()`。
- **問題**：對使用者提供的外部 HTTP(S) URL，只做 `assertSafeExternalUrl()`（阻擋私網/IMDS）與 30 秒逾時，之後直接 `await imgRes.arrayBuffer()` 把整個回應讀進記憶體、轉 base64（膨脹 1.33 倍）塞進送給 Gemini 的 JSON body。**沒有 Content-Length 前置檢查、沒有下載後位元組數檢查**——同檔案裡完全沒有任何 `maxBytes` 邏輯。
- **規模觸發**：不需要規模——**單一請求**即可觸發。任何已登入使用者送出「圖生影」請求，把 `firstFrameUrl` 指向自己控制、在 30 秒逾時內回應大量位元組（無 Content-Length 或用 chunked transfer）的伺服器，Node process 就會嘗試把整個回應緩衝進記憶體。並發送出多個這種請求會使記憶體壓力疊加更快觸發 OOM（類似題目提到的 DV ws DoS 對照模式，只是攻擊面是 HTTP fetch 而非 WS frame）。
- **現在痛 / 規模大才痛**：**現在就痛**——無需大量資料或大量使用者，一個惡意/誤用請求即可能造成單一 worker OOM。實際能餵多少 bytes 取決於攻擊者伺服器頻寬與 30 秒視窗，**需負載驗證**才能量化實際可達成的資料量與是否會真的讓 Railway container OOM-kill。
- **建議**：比照 `internalMedia.ts` / `pdfTextExtractor.ts` 加上 Content-Length 前置檢查 + 下載後 `buffer.byteLength` 二次檢查（例如 10-12MB 上限，與 `PER_KIND_MAX_BYTES.image` 對齊），逾時建議縮短並改用串流讀取搭配位元組計數提前中止，而非等待 `arrayBuffer()` 完整完成後才知道大小。

---

## 2. 〔HIGH〕internalMedia.ts：`persistExternalMediaUrl` 的 10MB 上限只在有 Content-Length 時生效

- **檔案:行號**：`server/services/internalMedia.ts:53-88`，關鍵缺口在 69-75 行。
- **問題**：函式頂端註解寫著「10 MB cap on downloaded media to bound memory usage」，但實作只檢查回應標頭 `content-length`（`rawLength`），當標頭缺席（chunked transfer-encoding、許多動態產生媒體的 CDN 常見情況）時 `rawLength` 預設為 `0`，檢查恆為 false，**之後直接 `await resp.arrayBuffer()` 且完全沒有下載後的二次位元組檢查**——與同檔案設計意圖矛盾。逾時視窗長達 90 秒（`AbortSignal.timeout(90_000)`），比 geminiMedia 的 30 秒、pdfTextExtractor 的 12 秒都長。
- **規模觸發**：呼叫方涵蓋 `server/routers/generate.ts:897/997/1098/1206`（直接以 provider 回傳的 imageUrl/videoUrl/audioUrl/voiceUrl 呼叫）、`localizeResultUrls`（被 `server/routes/webhookFal.ts:227`、`server/routes/webhookSuno.ts:230`、`server/routers/proStudio.ts`、`videoStudio.ts`、`imageStudio.ts`、`director.ts` 等多處呼叫，對 provider webhook/回應中任意巢狀 URL 遞迴 walk 並下載）。只要任一條路徑上的 URL 來源（provider 回應、webhook payload）能被引導到一個不回 Content-Length 的外部主機，這條路徑就完全不設防。
- **現在痛 / 規模大才痛**：**需負載驗證**——是否「現在就痛」取決於這些 URL 在實務上是否可被攻擊者影響（例如 fal.ai webhook 簽章是否總是先驗證、BYOK/自訂模型是否可能回傳攻擊者可控網域）。但即便只考慮「正常但異常大」的 provider 回應（例如某些 provider 對長影片不回 Content-Length），現有程式碼也完全不會擋下。
- **建議**：改用串流讀取（`response.body` reader）搭配累積位元組計數，超過上限立即 `abort()`；不要等待 `arrayBuffer()` 完整完成再檢查大小。

---

## 3. 〔HIGH〕orbVoiceGateway.ts：單一 WS 語音連線的 `audioChunks` 無總量上限

- **檔案:行號**：`server/ws/orbVoiceGateway.ts:47`（`const audioChunks: Buffer[] = []`）、`123`（每個 binary frame `push`）、`33`（`ORB_VOICE_MAX_SESSION_MS` 預設 600000ms=10 分鐘）。
- **已做對的部分（negative result）**：單一 frame 大小有雙重保護——`server/_core/index.ts:1071` 在 `ws.Server` 建構時就設定 `maxPayload: ORB_MAX_PAYLOAD_BYTES`（64KB），app 層又再檢查一次 `chunk.length > ORB_MAX_PAYLOAD_BYTES`；並有 `MAX_GLOBAL_CONNECTIONS`（預設 100）與 `ORB_VOICE_MAX_CONCURRENT`（預設 3／每 identity）連線數上限、以及 `payload.sub`（而非可偽造的 query 參數）做併發鎖定。這部分設計良好，直接對應題目提到的「DV ws DoS」防護模式。
- **問題**：`audioChunks` 陣列本身**沒有累積位元組上限**，只在收到 `{"type":"stop"}` 文字訊息時才 `splice(0)` 清空並送去做 ASR。若客戶端（惡意或單純沒有正確發送 stop）持續傳送 binary frame 卻永不送出 `stop`，記憶體只受 `ORB_VOICE_MAX_SESSION_MS`（10 分鐘）這個時間上限保護，**沒有位元組總量上限**。10 分鐘內能塞多少資料完全取決於每則 64KB frame 的傳送速率（未見對應的 per-connection rate limit）。
- **規模觸發**：單一連線在 session 逾時前持續傳送 frame；乘上 `ORB_VOICE_MAX_CONCURRENT=3` 及 `MAX_GLOBAL_CONNECTIONS=100`，worst case 是「100 條連線 × 10 分鐘內能傳輸的總 bytes」。**需負載驗證**才能算出實際 frame 傳送速率上限（是否有 WS 層級的 backpressure 或 rate limit 未在此檔案內看到）。
- **現在痛 / 規模大才痛**：規模大才痛——需要惡意/異常客戶端主動維持連線並持續傳送而不送 stop，且要撐到有意義的資料量；但因為完全沒有 per-session 位元組上限這道防線，防禦深度不足，值得補強。
- **建議**：在 `audioChunks.push(chunk)` 前檢查累積長度（例如 `audioChunks.reduce(...) + chunk.length > SESSION_MAX_BYTES`），超過即回 `error` 並強制觸發等同 `stop` 的清空或直接關閉連線，勿只靠 10 分鐘逾時。

---

## 4. 〔MEDIUM〕aiProxy.ts：上游 AI Provider 回應整包緩衝，無位元組上限

- **檔案:行號**：`server/routes/aiProxy.ts:481`（`const buffer = await upstreamRes.arrayBuffer();`），同檔案 427 行的重試路徑也有一次 `arrayBuffer()`（僅為釋放連線，同樣無界）。
- **問題**：這是「AI Provider Proxy Gateway」，把使用者請求轉發給白名單內的 AI provider adapter 並把回應原樣轉發回去。與本報告其他下載路徑（`download.ts` 50MB 上限＋串流、`internalMedia.ts` 意圖 10MB、`pdfTextExtractor.ts` 12MB）相比，這裡**完全沒有任何大小檢查或串流**，直接把整個上游回應讀進記憶體再 `res.send()`。
- **規模觸發**：若被路由到的 provider 端點回傳大型媒體位元組（例如某些 image/video 生成 API 直接回二進位內容，而非僅回 URL）或大型 batch JSON（含多筆 base64），每個這樣的請求都會在記憶體中短暫持有整個回應；併發請求會疊加放大。
- **現在痛 / 規模大才痛**：**需負載驗證**——取決於目前接的 provider adapter 實際回應型態與大小分布（多數 AI API 回應是小型 JSON，只回 URL 而非位元組時風險低）。若確認現有 adapter 都只回小型 JSON，此為低風險；若有任一 adapter 端點會回傳原始媒體位元組，則屬 at-scale 風險。
- **建議**：至少加上 Content-Length 前置檢查 + 上限（例如 20-50MB），超過則 502 並記錄；長期可考慮對已知會回大型二進位的端點改走串流轉發。

---

## 5. 〔MEDIUM〕db.ts `getDigitalAssetsByUser`：兩處熱路徑呼叫遺漏 limit 參數

- **檔案:行號**：`server/db.ts:1227-1236`（函式定義，`limit` 為 optional）；未帶 limit 的呼叫點：`server/routers/ai.ts:1065`、`server/services/spiritTools/musicSpecialistTools.ts:578`。
- **背景**：`db.ts:1238-1243` 的註解明確記載 AIDV-581 曾為了修「全量載入卡頓」而新增 `getDigitalAssetsByUserFiltered`（SQL 下推過濾＋預設 200 筆上限），代表團隊已經踩過這個坑一次；但舊函式 `getDigitalAssetsByUser` 仍被保留，且**這兩個呼叫點沒有跟著遷移、也沒有傳入 limit**。
- **問題**：
  - `server/routers/ai.ts:1065` 在建構 orb 聊天 prompt 的 extras 時，對每一次呼叫都 `db.getDigitalAssetsByUser(ctx.user.id)`（無 limit）撈出使用者**整張** `digital_asset_library` 表的所有欄位，只為了算 `total` 計數與前 5 筆 `recent`——這是**熱路徑**（推測每次 orb 對話訊息都會執行一次）上的全表掃描。
  - `server/services/spiritTools/musicSpecialistTools.ts:578`（`getRecentAudioAssets`）同樣呼叫無 limit 版本，篩選後只取前 `cap`（≤30）筆，等於先撈全部再在 JS 端捨棄大部分資料。
- **規模觸發**：使用者累積的資產筆數。這是一個「每次生成都會存一筆」的創作平台，活躍使用者在數月使用後資產筆數達到數百到數千筆並不罕見。
- **現在痛 / 規模大才痛**：**規模大才痛，但對重度使用者可能已經有感**——資產庫小的新用戶目前無感；長期活躍使用者每次跟光球對話或使用音音工具，就會在背景全表掃描一次自己的資產庫。因為呼叫發生在對話/工具呼叫的熱路徑上，隨資產數量增長，這個延遲/記憶體成本會疊加在**每一次**互動上，而不是只在瀏覽資產庫頁面時才付出。
- **建議**：這兩處改呼叫 `getDigitalAssetsByUserFiltered({ userId, limit: 5 })`（ai.ts 只需要 total 計數＋前 5 筆，count 可另開一個 `COUNT(*)` 查詢）與 `getDigitalAssetsByUser(userId, 30)`（musicSpecialistTools.ts），或直接讓 `getDigitalAssetsByUser` 的 `limit` 改為必填參數以強制呼叫端明確決策。

---

## 6. 〔LOW〕feedback.ts `all`：admin 全站回饋列表無分頁

- **檔案:行號**：`server/routers/feedback.ts:88-90`（`all: adminProcedure.query(...) → db.getAllFeedbacks()`）；`server/db.ts:1852-1859`（`getAllFeedbacks()` 對 `userFeedbackReports` 做 `select().from().orderBy()`，無 `.limit()`）。
- **問題**：這是跨**所有使用者、所有歷史**的回饋表，沒有任何分頁或時間範圍限制，一次查詢把全表撈進記憶體回給前端。
- **規模觸發**：`userFeedbackReports` 表的總列數；此為 admin-only 低流量端點，但表本身會隨產品使用時間單調成長、無清理機制。
- **現在痛 / 規模大才痛**：**規模大才痛**——單一管理者專案（Bruce 本人）目前反饋量推測不大，短期無感；**需負載驗證**目前實際列數以確認距離有感門檻還有多遠。
- **建議**：加上 `.limit()/.offset()` 或 cursor 分頁，比照 `getRealEarthEntries` 已有的分頁模式。

---

## 7. 〔LOW〕orbToolCallLogStore.ts / orbTaskStore.ts：每次寫入都整包序列化重寫檔案

- **檔案:行號**：`server/services/orbToolCallLogStore.ts:46-53`（`persist()`）+ `55-68`（`append()` 每筆呼叫 `persist()`）；`server/services/orbTaskStore.ts:103-111`（`persistToDisk()`）+ 多處 mutating method（`create`/`approve`/`approveStep`/`reportStep`/…）都在結尾呼叫它。
- **問題**：這兩個 store 都是「記憶體陣列/Map 為主、可選同步鏡射到單一 JSON 檔」的設計。每一次單筆事件寫入（`append`/`reportStep`/…）都會把**目前全部**事件／全部任務 `JSON.stringify` 後 `writeFileSync` 整檔覆寫——即使 `orbToolCallLogStore` 已有 `MAX_EVENTS=5000` 上限、`orbTaskStore` 有 30 分鐘 TTL 清理，單筆寫入的 I/O 成本仍是 O(目前總筆數)，屬於 hot-path-recompute 而非典型記憶體無界成長。
- **規模觸發**：`ORB_TOOL_CALL_LOG_FILE` / `ORB_TASK_STORE_FILE` 環境變數是否有設定（建構子邏輯：`if (!this.persistenceFile) return;`——未設定時這兩個 `persist*()` 完全是 no-op，無 I/O 成本）。**需負載驗證**：目前 Railway 生產環境是否實際設了這兩個環境變數；若未設定，此發現不成立（純記憶體、無檔案 I/O）。
- **現在痛 / 規模大才痛**：規模大才痛，且高度依賴上述環境變數是否啟用——若啟用，工具呼叫/任務事件頻率越高，寫入延遲越明顯（每筆都要重新序列化 5000 筆事件）。
- **建議**：若確定生產環境有掛這兩個持久化檔案，改成 append-only（NDJSON 逐行 append）或降低寫入頻率（debounce/批次 flush），而非每筆事件都整檔重寫。

---

## Negative Results（已正確有界 / 已有分頁 / 已有索引，本輪未發現問題）

| 項目 | 檔案 | 說明 |
|---|---|---|
| base64 上傳解碼 | `server/uploadRoute.ts:493-617`、`server/_core/index.ts:564-574` | `/api/upload` 掛在 `express.json({ limit: "4mb" })` 之後才進入 route handler，故 `Buffer.from(data, "base64")` 解碼前 body 已被硬性限制在 4MB，實際解碼緩衝區至多約 3MB；大檔案另有 presign/finalize 直傳 R2 流程（見下）完全不經過 Node。 |
| 大檔直傳 | `server/uploadRoute.ts:635-906`、`server/signedUpload.ts` | Signed-URL 兩段式（presign → 前端直傳 R2 → finalize HeadObject 驗證）讓大檔位元組完全不經過 Node process；finalize 的內容嗅探只 Range 讀取前 64 bytes（`CONTENT_SNIFF_BYTES`），不會整檔讀回。 |
| 媒體下載代理 | `server/routes/download.ts` | 用 `upstream.body.getReader()` 逐 chunk `res.write()`，不在記憶體中組完整檔案；Content-Length 有值時預先擋 >50MB；且 `isAllowedOrigin()` 限制只能代理內部 S3/Forge 網域，非任意攻擊者可控 URL（雖然無 Content-Length 時缺乏串流位元組計數，但因來源網域受限，風險低）。 |
| SSE 串流 | `server/sseRoute.ts`、`server/unifiedSseRoute.ts` | 事件直接 `res.write()`，無伺服器端累積佇列；連線有 5-10 分鐘最長生命週期、每使用者併發連線數上限（`SSE_MAX_CONNECTIONS_PER_USER`）、心跳保活；關閉時正確釋放 timer/subscription。 |
| WS 語音單頁框大小 | `server/ws/orbVoiceGateway.ts`、`server/_core/index.ts:1071` | 單一 frame 64KB 上限在 `ws.Server` 建構層（`maxPayload`）與 app 層各檢查一次，雙重防護；全域/單一使用者併發連線數皆有上限。（累積層面的缺口見發現 3。） |
| 教學檔案向量檢索 | `server/services/teachingArchiveRag.ts` | Chunk 切片固定 1200 字元／200 重疊，embedding 以 4 筆為批次並發，`queryTeachingArchiveVectors` 的 `topK` 被硬性夾在 `[1,50]`；無無界累積。 |
| 教學檔案 LIKE fallback | `server/db.ts:4156-4207`（`searchTeachingMaterialsForUser`） | SQL 端有 `.limit(scope.limit)`，`scope.limit` 上游被夾在 `[1,20]`；不是撈全表後 JS 端過濾。 |
| ZIP / 匯出打包 | 全庫 grep `archiver｜jszip｜adm-zip｜yazl` | 無任何命中；`digital_asset_library.assetType` 雖有 `"zip_bundle"` enum 值，但只是使用者自行上傳的既有壓縮檔類型標籤，伺服器端沒有在記憶體中組裝 ZIP 的邏輯。 |
| `videoCompiler.ts` | `server/services/videoCompiler.ts` | 儘管名稱像「影片編譯器」，實際是純文字/提示詞組裝器（情感→動作映射、相機運鏡向量表），完全不涉及檔案或媒體位元組緩衝。 |
| RealEarth 知識庫查詢 | `server/db.ts:4951-5097` | `getRealEarthEntries` / `searchRealEarthEntries` 皆有 `.limit(params.limit).offset(params.offset)`；count 查詢與資料查詢分離，未整表撈進記憶體（靜態 grep 一度誤判為無 limit，人工覆核後確認有分頁）。 |
| R2 內容嗅探 | `server/signedUpload.ts:283-310`（`fetchObjectHeadBytes`） | 用 `Range: bytes=0-63` 只取前 64 bytes 做 magic-byte 判斷，串流 fallback 分支也在達到 `byteCount` 後立即 `break`，不會整檔讀取。 |
| PDF 文字抽取下載 | `server/services/pdfTextExtractor.ts:148-172`（`downloadPdf`） | 雖然是「下載後才做最終大小判斷」，但**確實做了**下載前 Content-Length 檢查與下載後 `buffer.byteLength` 二次檢查（12MB 上限），加上 SSRF 守衛與 12 秒逾時（本報告發現的其他下載函式裡逾時最短、防護最完整的一個），僅存在與發現 1/2 相同的「下載-then-check」時序缺口，風險遠低於前二者，故列為 negative result 附註而非獨立高風險項。 |

---

## 需負載驗證清單（本報告未實測，需之後補測）

1. `geminiMedia.ts` 生成影片下載——實際能在 30 秒逾時內、單一請求從一個受控伺服器下載多少 bytes 到 Railway container，是否足以觸發 OOM-kill。
2. `internalMedia.ts` / `aiProxy.ts` 的下游 provider 端點，是否有任何端點會在缺 Content-Length 情況下回傳大型媒體位元組。
3. `orbVoiceGateway.ts` 的實際 WS 訊息傳輸速率上限（是否有未在此檔案內看到的 backpressure/rate limit），以推算 10 分鐘 session 內 `audioChunks` 實際可能累積的位元組數量級。
4. `orbToolCallLogStore.ts` / `orbTaskStore.ts` 的持久化環境變數（`ORB_TOOL_CALL_LOG_FILE` / `ORB_TASK_STORE_FILE`）在 Railway 生產環境是否實際設定。
5. `userFeedbackReports` 與 `digital_asset_library` 兩表目前實際列數/單一重度使用者資產筆數，以確認發現 5、6 距離「現在有感」的實際距離。
