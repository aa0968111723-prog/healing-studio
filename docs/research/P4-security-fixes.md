# P4 — 安全修復設計:K1/K3 高危漏洞修法決策卡(深度研究 wave P)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 承接:`docs/research/K1-security-bugs.md`(K1-1/K1-2/K1-3/K1-4)、`docs/research/K3-data-integrity.md`(§1.1/1.2/1.3)、`docs/research/K2-generation-bugs.md`(§4)、`docs/research/L4-fields-spine-global.md`(§2.2)、`00-summary.md` §6.1 R2-R8
- 方法:單一代理實讀程式碼(**未 spawn 子代理**),對每個 🔴 高危漏洞逐一確認修點 path:line、設計修法/測試/工作量。**本文件只研究、不改程式碼。**
- 產出物只有本篇研究文件;未動任何 `server/`、`client/`、`drizzle/` 原始碼。

---

## 修復卡 1 — R4:生成入口參考圖 SSRF(K1-1)

**漏洞一句**:`generate.ts` 的 `multimodal`/`submitMultimodalAsync` 對 `firstFrameUrl` 等參考圖欄位完全不做網域白名單,下游 `geminiMedia.ts` 的圖生影 fetch 又缺 `redirect:"error"`,可經 302 跳轉打進內網/雲端 metadata。

**觸發情境**:使用者呼叫 `generate.submitMultimodalAsync`,`firstFrameUrl` 帶攻擊者控制的公開 HTTPS URL(先回 200 通過檢查,或直接 302 到 `169.254.169.254` 等內網位址)。路由到 Gemini/Veo 圖生影分支後,伺服器對此 URL 發出真實 fetch 並自動跟隨跳轉,把內網回應位元組當圖片編碼進 Vertex AI 請求 body。

**修點 path:line**:
- `server/routers/generate.ts:361-367`(`multimodal` input schema,`styleReferenceUrl`/`vibeReferenceUrl`/`firstFrameUrl`/`lastFrameUrl`/`characterRefUrl` 皆 `z.string().nullable().optional()`)
- `server/routers/generate.ts:1571-1577`(`submitMultimodalAsync` 重複的第二份同名 schema,同一問題)
- `server/services/geminiMedia.ts:433-437`(`assertSafeExternalUrl` 之後的 `fetch` 缺 `redirect:"error"`)

**修法**:
1. 兩處 schema(361-367、1571-1577)把上述五個欄位型別從 `z.string().nullable().optional()` 換成 `server/lib/urlValidator.ts` 既有匯出的 `safeMediaUrlOptional`(https-only + 網域白名單);理想上抽成共用 schema fragment 供兩處 import,避免第三次漂移(對照 K1-8 的「雙路由驗證強度不一致」結構性風險)。
2. `geminiMedia.ts:435` 的 `fetch` 補 `redirect: "error"`,比照 `server/services/internalMedia.ts:65-68` 的既有寫法;需捕捉 redirect 被擋的錯誤並轉成可讀訊息(例如「圖片來源重新導向被拒絕」),而非讓底層 TypeError 直接冒出。
3. 建議把 `assertSafeExternalUrl`(同步版,只擋字面私網 IP)換成 `server/_core/ssrfGuard.ts:117` 的 `assertSafeExternalUrlAsync`(DNS-rebinding 版本),因為白名單網域通過後仍可能被 DNS rebinding 繞過同步版本的字面 IP 檢查。

**測試**:
- 單元:傳入 `http://169.254.169.254/...`、私網 IP、非白名單網域 → 斷言 zod 400。
- 整合(mock fetch server 回 302 → 內網位址):驗證 `geminiMedia.generateVideo` 對此拋錯而非把回應內容編碼進 base64。
- 迴歸:白名單網域(`fal.media`/`r2.dev`/…)的正常 `firstFrameUrl` 仍可通過並成功送出。

**工作量**:S(0.5–1 天,含測試)。

**可否與功能並行**:可。純輸入驗證/fetch 選項變更,不影響現有生成流程其他欄位或 UI。

---

## 修復卡 2 — R5:ElevenLabs 三路徑 SSRF(K1-2)

**漏洞一句**:`elevenLabsExtended.ts` 的 `cloneVoice`/`createDubbing`/`transcribe` 三方法用同步 `assertSafeUrl` 過白名單後,`fetch` 沒帶 `redirect:"error"`,可被教學資料庫任何登入使用者上傳的音/影檔案 URL 觸發 302 內網探測。

**觸發情境**:使用者呼叫 `teachingArchive.create({mediaType:"audio"|"video", fileUrl})`,`fileUrl` 只需通過 `/^https?:\/\//i` 格式檢查(`teachingArchive.ts:65-68` 無網域白名單)。背景 worker 60 秒後跑 `teachingArchiveIngest.ts` 的 `doExtraction` → `transcribeMedia` → `elevenLabsExtended.transcribe()` → `assertSafeUrl` 通過(URL 本身是公開網域)→ `fetch` 追蹤 302 到內網。

**修點 path:line**:
- `server/services/elevenLabsExtended.ts:390`(`cloneVoice`)、`:425`(`createDubbing`)、`:479`(`transcribe`)— 三處 `fetch` 缺 `redirect`/timeout
- `server/routers/teachingArchive.ts:65-68`(`fileUrl` zod 只驗證 protocol,無網域白名單)
- `server/services/teachingArchiveIngest.ts:106-112`(`doExtraction` 呼叫鏈)

**修法**:
1. 三處 `fetch(params.xxxUrl)` 補 `redirect: "error"` + `signal: AbortSignal.timeout(...)`(目前也無 timeout,長時間掛住的內網連線可佔用 worker)。
2. `assertSafeUrl`(`urlValidator.ts` 同步版)換成 `ssrfGuard.ts` 的 `assertSafeExternalUrlAsync`,統一只維護一套 DNS-rebinding SSRF 邏輯。
3. `teachingArchive.ts:65-68` 的 `fileUrl` 改用 `safeMediaUrl`(`urlValidator.ts` 既有匯出)取代裸 `.refine(u => /^https?:\/\//i.test(u))`,強制網域白名單而非只驗證 protocol,形成入口層縱深防禦。

**測試**:
- `teachingArchive.create` 傳入非白名單網域 `fileUrl` → 斷言 400。
- `transcribeMedia`/`cloneVoice`/`createDubbing` 對 mock 302→內網位址的 fetch,斷言拋出而非 follow。
- 既有教學檔案(storage 網域)上傳→轉錄流程迴歸測試不受影響。

**工作量**:S(0.5 天)。

**可否與功能並行**:可,建議與修復卡 1 同批次處理(共用 SSRF 修法 pattern,可合併 review)。

---

## 修復卡 3 — R6:proxy-download / safeMediaUrl 萬用尾碼白名單(K1-6/K1-7)

**漏洞一句**:`/api/proxy-download` 的 `isProxyAllowed()` 與 `safeMediaUrl` 的 `STATIC_ALLOWED_HOSTS_RE` 都用 `endsWith`/正則尾碼比對多租戶公有雲網域(`amazonaws.com`/`r2.cloudflarestorage.com`/`r2.dev`/`cloudfront.net`/`supabase.co`/`blob.core.windows.net`),任何人開的 bucket 都能通過,伺服器變成匿名中繼代理。

**觸發情境**:登入使用者呼叫 `GET /api/proxy-download?url=https://<攻擊者bucket>.s3.amazonaws.com/<file>`,伺服器用自己出口 IP 代為抓取任意公開 bucket 內容(可用於繞過封鎖名單、隱藏請求來源、輕量檔案外傳跳板)。

**修點 path:line**:
- `server/_core/index.ts:325-351`(`PROXY_ALLOWED_HOSTS`/`isProxyAllowed`)
- `server/_core/index.ts:813`(`fetch` 同樣缺 `redirect:"error"`,順手一併修)
- `server/lib/urlValidator.ts:26-40`(`STATIC_ALLOWED_HOSTS_RE`/`isAllowedHost`)

**修法**:
1. 對本站自有 bucket(`S3_PUBLIC_URL`/`S3_PUBLIC_DOMAIN`,`server/_core/env.validated.ts:317-318`),改用 `ssrfGuard.ts:175-193` 既有的 `isExactOriginAllowed()`(已存在、專做「精確 origin 比對」)鎖到「精確的本站 bucket origin」,而非整個公有雲網域尾碼。
2. 對供應商回傳網域(`fal.media`/`cdn.fal.ai`/`replicate.delivery`/`elevenlabs.io`/`suno.ai` 等)——這些是單一廠商網域,尾碼比對風險相對低,可保留;但要跟「多租戶公有雲網域」(`amazonaws.com`/`r2.cloudflarestorage.com`/`cloudfront.net`/`supabase.co`/`blob.core.windows.net`/`r2.dev`)分開處理——後者一律改成精確比對讀自家 bucket 的 host,不接受任意子網域。
3. `isProxyAllowed()`/`isAllowedHost()` 都改成:先查精確白名單(自家 bucket + 已知供應商固定網域),查無即拒絕,不再對多租戶網域用 `host.endsWith(".${大範圍網域}")` 放行。
4. `fetch` 補 `redirect:"error"`(`server/_core/index.ts:813`)。

**測試**:
- `isProxyAllowed()`/`isAllowedHost()` 單元測試:攻擊者自建的 `<random>.s3.amazonaws.com` bucket URL → 斷言 false;自家 `S3_PUBLIC_URL` 的 bucket URL → 斷言 true。
- `/api/proxy-download` 整合測試:非本站 bucket → 403;本站 bucket → 200。
- 迴歸:既有 fal/replicate/elevenlabs 供應商媒體 URL 下載流程不受影響。

**工作量**:M(1–1.5 天)— 需先盤點本站實際使用哪些 bucket host(R2/S3 是否都設了 `S3_PUBLIC_URL`),否則精確比對會誤擋合法流量。

**可否與功能並行**:可,但建議先在 staging 用真實流量驗證不會誤擋現有 CDN 網域。

---

## 修復卡 4 — R6:跨 studio 竊取生成資產(K2 §4)

**漏洞一句**:`imageStudio.checkImageStatus`/`proStudio.checkAudioStatus` 輪詢端點無 owner 檢查,`videoStudio.checkVideoStatus` 已有(AIDV-244),攻擊者用別人的 `requestId` 竊取生成資產歸屬。

**觸發情境**:取得他人 fal `request_id`(瀏覽器 network log/URL 參數/分享連結)後,攻擊者用自己帳號呼叫 `checkImageStatus`/`checkAudioStatus`,完成即以 `ctx.user.id` 呼叫 `doPostGenComplete`,把該資產寫進攻擊者自己的 `digital_asset_library`/`generation_history`(受害者已付點數,攻擊者免費取得資產)。

**修點 path:line**:
- `server/routers/imageStudio.ts:1419-1480`(`checkImageStatus`,缺檢查)
- `server/routers/proStudio.ts:1688-1730`(`checkAudioStatus`,缺檢查)
- 對照組(已修好的範本):`server/routers/videoStudio.ts:1679-1685`
- `server/db.ts:2246`(`getBackgroundJobByRequestId`,可直接複用)

**修法**:在兩處 query handler 開頭(`falQueueStatus` 呼叫之前)逐字複製 `videoStudio.ts:1679-1685` 的檢查:
```ts
const existingJob = await db.getBackgroundJobByRequestId(input.requestId);
if (existingJob && existingJob.userId !== ctx.user.id) {
  throw new TRPCError({ code: "FORBIDDEN", message: "無此任務存取權限" });
}
```
與 videoStudio 相同的設計取捨:查無 `backgroundJobs` 記錄時放行(某些工作室的 `requestId` 是隨機 UUID,枚舉風險低),維持三處行為一致。

**測試**:
- 單元:模擬 `backgroundJobs` 有 `userId=A` 的記錄,`userId=B` 呼叫 `checkImageStatus`/`checkAudioStatus` 帶同一 `requestId` → 斷言 FORBIDDEN。
- 迴歸:`userId=A` 自己呼叫 → 正常完成流程不受影響。
- 迴歸:`requestId` 查無記錄 → 仍可正常輪詢完成(不誤擋)。

**工作量**:S(0.5 天,含測試)— 純複製既有已驗證過的 pattern,無新設計風險。

**可否與功能並行**:可,且應優先做——本輪修復卡中風險/工作量比最高(已有現成對照實作可抄)。

---

## 修復卡 5 — R7:models.teamModels 無旗標可關洩 LoRA 權重(K1-4)

**漏洞一句**:`models.teamModels`/`getById`/`getAnalysis` 只憑 `visibility==="team_shared"` 就放行任何登入者讀取,無視是否真的同團隊,且無 `ENABLE_DATA_RBAC` 這種旗標可關,外洩 LoRA 訓練權重 URL/資料集連結。

**觸發情境**:使用者 A 把自訓模型 `toggleVisibility({visibility:"team_shared"})`;與 A 無團隊關係的 B 呼叫 `models.teamModels` 或猜測/掃描 `models.getById({id})`,即可讀到 `trainedLoraUrl`、`configJson` 訓練設定、資料集連結。

**修點 path:line**:
- `server/routers/models.ts:20-22`(`teamModels`)
- `server/routers/models.ts:24-38`(`getById`)、`:41-55`(`getAnalysis`)
- `server/db.ts:1016-1024`(`getTeamSharedModels`,無 userId/teamId 過濾)
- 既有 RBAC 基礎設施參考:`server/services/authz/resourceAccess.ts`(`canAccess`/`isDataRbacEnabled`/`ResourceType`,:37/:146/:161)、既有用法範例:`server/routers/assets.ts:122-161`

**修法**:
1. 擴充 `resourceAccess.ts` 的 `ResourceType`(:37)加入 `"model"`——`fine_tuned_models` 本身就有 `userId`/`visibility`/`teamId` 三欄(`drizzle/schema.ts:415`/`462`/`466`),資料形狀與 `ResourceFacts` 完全吻合,不需新表。
2. `models.teamModels` 比照 `assets.ts:122-161` 的作法:先撈 `team_shared` 全集,再用 `db.listTeamIdsForUser(ctx.user.id)` + `canAccess()` 過濾,只留下 `ctx.user` 真正所屬團隊的模型。
3. **關鍵設計差異(對照 K1-3 的取捨)**:`assets.ts` 的過濾是「旗標 ON 才生效,OFF 保持現狀外洩」;但 R7 沒有 `ENABLE_DATA_RBAC` 這種退路(結構性缺口),且 LoRA 權重比一般資產更敏感——**建議此處過濾預設無條件啟用**,不掛 `isDataRbacEnabled()` 開關,避免重蹈「旗標 OFF 就繼續洩」;若仍想要旗標保護以防回歸風險,應該用**新旗標且預設值為 ON**(例如 `ENABLE_MODEL_TEAM_FILTER`,default `"true"`),而非沿用預設 OFF 的 `ENABLE_DATA_RBAC`。
4. `getById`/`getAnalysis` 除現有的「本人或 team_shared」判斷,補上「若 team_shared 則必須真的同團隊」:
   ```ts
   if (model.userId !== ctx.user.id) {
     if (model.visibility !== "team_shared") throw FORBIDDEN;
     const memberTeamIds = await db.listTeamIdsForUser(ctx.user.id);
     if (model.teamId == null || !memberTeamIds.includes(model.teamId)) {
       throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
     }
   }
   ```
5. **需要先查證**(未在本卡逐行核對,見文末③):`toggleVisibility` mutation 是否在設為 `team_shared` 時同步要求/寫入 `teamId`。若目前只改 `visibility` 不寫 `teamId`,上述過濾條件會讓所有既有 `team_shared` 模型的 `teamId` 恆為 `null`,變成「修完後全部不可見」的功能倒退——必須同時補上「設為 `team_shared` 必須指定 `teamId` 且使用者屬於該團隊」的檢查。

**測試**:
- 單元:A 團隊模型 `team_shared`,B(非 A 團隊成員)呼叫 `teamModels`/`getById`/`getAnalysis` → 斷言看不到/FORBIDDEN。
- 單元:A 團隊成員 C 呼叫 → 斷言可見。
- 迴歸:本人自己的模型(private 或 team_shared)一定可見。
- 若補了 `toggleVisibility` 的 `teamId` 檢查:使用者不在任何團隊卻嘗試設 `team_shared` → 斷言擋下並給清楚錯誤訊息。

**工作量**:M(1–2 天)— 需先查證 `toggleVisibility`/`teamId` 賦值邏輯,以免修完後 team_shared 模型集體不可見;比純 owner-check 系列複雜,因涉及既有 RBAC 模組擴充。

**可否與功能並行**:可,但建議獨立分支開發 + 先跑一次「修復前後,現有 team_shared 模型是否還看得見」的手動驗證。

---

## 修復卡 6 — R8:forge 分頁繞過肖像權同意書(L4 §2.2)

**漏洞一句**:`ModelsPage` 隱藏的 `pageTab="forge"` 精靈與 `LoraTrainer` 共用同一顆 `createMutation`,但 forge 路徑的 `handleStartTraining` 送出的 7 個欄位完全不含 `subjectType`/`consentIds`/`modelType`,後端 zod `.default("synthetic")` 讓 `requiresConsent` 恆為 false,真人照片訓練繞過同意書閘門。

**觸發情境**:光球 PageAgent 執行 `{action:"setTab", tabId:"forge"}`(`ModelsPage.tsx:784` 列出的 capability)導使用者到隱藏分頁,使用者填真人照片訓練模型並點「開始訓練」,`handleStartTraining`(`ModelsPage.tsx:710-752`)呼叫 `createMutation.mutate` 但不送 `subjectType`/`consentIds`/`modelType` → `server/routers/models.ts:333-337` 的 `requiresConsent` 判定為 false → 同意書檢查(:339-358)整段被跳過。

**修點 path:line**:
- `client/src/pages/ModelsPage.tsx:710-752`(forge 路徑 `handleStartTraining`,缺 `subjectType`/`consentIds`/`modelType`)
- `client/src/pages/ModelsPage.tsx:784`(PageAgent capability 列出 forge 入口)、`:502-511`(`pageTab` state)
- `server/routers/models.ts:324-337`(後端信任前端自報 `subjectType`,且 `.default("synthetic")` 是 fail-open 設計)

**修法(建議兩者都做,形成縱深防禦)**:
1. **前端**:移除 forge 分頁入口與整段舊實作死碼(`pageTab` state、PageAgent capability、舊 `handleStartTraining` 及其渲染區塊),讓所有訓練請求都走 `LoraTrainer`(§2.1 已有完整 `subjectType`/`consentIds` UI)——是研究報告本身建議的「直接砍掉 forge 分頁死碼」選項,路徑最乾淨。
2. **後端**(即使前端入口砍了也該做,防止未來新增第二條訓練入口重蹈覆轍):`models.ts:326` 的 `subjectType` 拿掉 `.default("synthetic")`,改成必填欄位,強迫任何呼叫端都要明確宣告——省略時直接 zod 400,而非靜默通過視為 synthetic(fail-closed 取代目前的 fail-open)。

**測試**:
- 路徑1(移除 forge):驗證 PageAgent 呼叫 `setTab("forge")` 後應安全 no-op 或退回 trainer,不應該讓前端拋錯崩潰。
- 路徑2(後端 fail-closed):`models.create` 不帶 `subjectType` → 斷言 400。
- 迴歸:`LoraTrainer` 正常流程(帶完整 `subjectType`/`consentIds`)不受影響。

**工作量**:路徑1(移除死碼)S(0.5 天);路徑2(後端 fail-closed)S(0.5 天,需同步檢查是否有其他呼叫端依賴省略 `subjectType`)。兩者合計 M(約 1 天)。

**可否與功能並行**:可。清理成本最低、但合規風險(真人肖像權)最高,建議與修復卡 4 同批次早做。

---

## 修復卡 7 — R2/R3:GDPR 刪除帳號整條路徑必炸 + 電路斷路器複合故障(K3 §1.1/1.2/1.3)

**漏洞一句**:`USER_OWNED_TABLES`(`server/db.ts:5300-5370`)含 10 張無 `userId` 欄的表,刪帳號必觸發 SQL 錯誤致整個交易回滾(連 `users` 列都刪不掉),且此錯誤未經 `isTransientError` 過濾就餵給全域電路斷路器,5 次連續失敗可讓全站任何 `executeTransaction` 呼叫 503;另有至少 10 張真正持有個資的表被漏在清單外,永久孤兒殘留。

**觸發情境**:使用者在 `/account-settings` 打「刪除帳號」→ `profile.deleteAccount` → `db.deleteUserAccount(userId)` → 迴圈跑到陣列第 26 個 `prompt_assets`(無 `userId` 欄)→ MySQL `ER_BAD_FIELD_ERROR` → `executeTransaction` catch 區塊 rollback 並呼叫 `recordFailure(err)`(未判斷是否 transient)→ throw 未被 `profile.ts:29-34` 包 try/catch → tRPC 500。若短時間內多次觸發(使用者重試/QA 測試),5 次後 `CIRCUIT_OPEN_THRESHOLD` 命中,30 秒內全站任何 `executeTransaction`(含其他人的寫入交易)都收到 503 `CIRCUIT_OPEN`。

**修點 path:line**:
- `server/db.ts:5300-5370`(`USER_OWNED_TABLES` 陣列本體)
- `server/db.ts:5379-5395`(`deleteUserAccount` 迴圈與 try/finally)
- `server/_core/DatabaseManager.ts:366-375`(`executeTransaction` catch 區塊,`recordFailure` 未依 `isTransientError` 過濾;`query`/`execute` 的對等 catch 區塊,:289-299/:334-344,同樣問題)
- `server/_core/DatabaseManager.ts:43-55`(`TRANSIENT_ERROR_CODES`/`isTransientError`,既有工具函式,尚未在 `recordFailure` 呼叫處實際使用)
- `server/routers/profile.ts:29-34`(`deleteAccount` mutation,無 try/catch)

**修法(分三塊,建議依序完成)**:

**(a) 電路斷路器不誤觸**——把 `query()`/`execute()`/`executeTransaction()` 的 catch 區塊改成:只在 `isTransientError(err)` 為真時(連線斷線/逾時/死鎖等「資料庫真的有問題」)才呼叫 `this.recordFailure(err)`;非 transient 的錯誤(`ER_BAD_FIELD_ERROR`、應用層 SQL 語法錯誤等)只 log + rethrow,不影響 `consecutiveFailures` 計數。這樣「一個從未被呼叫過的功能自身的 bug」不會拖累不相關的交易。

**(b) USER_OWNED_TABLES 修正**:
- 移除 10 張無 `userId` 欄的表:`prompt_assets`、`external_service_subscriptions`、`cost_aggregations`、`cost_ledger`、`cost_attribution_outbox`、`alert_configs`、`fine_tuned_model_consents`、`orb_spirit_collaboration_metrics`、`orb_system_alerts`、`real_earth_entries`。其中含「間接」個資者(如 `fine_tuned_model_consents` 應隨 `fine_tuned_models` 被刪連帶清除)需改用外鍵級聯陳述式,而非塞進通用陣列,例如:
  ```sql
  DELETE FROM fine_tuned_model_consents WHERE modelId IN (SELECT id FROM fine_tuned_models WHERE userId=?);
  ```
- 補上 10 張漏掉、且真的有 `userId`/`user_id` 的表,**但欄位名稱不可一律假設是 `userId`**——現有迴圈寫死 `WHERE userId = ?`,經逐表核對 `drizzle/schema.ts`,以下實際 DB 欄位是 snake_case `user_id`(非 camelCase `userId`):`orb_conversation_messages`(:2744)、`timeline_frames`(:3602)、`scene_compositions`(:3643)、`agent_dlq`(:2666)、`video_analytics`(:4743,可為 null,GDPR opt-out 設計,無需特殊處理)。以下三張才是 camelCase `userId`:`consistency_vault`(:723)、`studio_versions`(:2810)、`orb_workflow_template_ratings`(:3283)。**這是本卡新發現**:現有「單一迴圈套同一個 `WHERE userId = ?`」的假設不成立,必須把陣列從純表名字串改成 `{table, column}` pair:
  ```ts
  const USER_OWNED_TABLES: Array<{ table: string; column: string }> = [
    { table: "login_history", column: "userId" },
    // …既有項目補齊 column …
    { table: "orb_conversation_messages", column: "user_id" },
    { table: "timeline_frames", column: "user_id" },
    { table: "scene_compositions", column: "user_id" },
    { table: "agent_dlq", column: "user_id" },
    { table: "video_analytics", column: "user_id" },
    { table: "consistency_vault", column: "userId" },
    { table: "studio_versions", column: "userId" },
    { table: "orb_workflow_template_ratings", column: "userId" },
  ];
  // 迴圈: await conn.execute(`DELETE FROM \`${t.table}\` WHERE \`${t.column}\` = ?`, [userId]);
  ```
- `resource_shares`(K3 §1.5)無法套用同一模式——它同時有 `sharedByUserId` 與 `sharedWithId`(可能是 user 或 team),需要獨立陳述式,寫成 `deleteUserAccount` 內顯式的額外 SQL,不硬塞進通用陣列:
  ```sql
  DELETE FROM resource_shares WHERE sharedByUserId = ?;
  DELETE FROM resource_shares WHERE sharedWithType = 'user' AND sharedWithId = ?;
  ```
- 加一支守門測試(比照既有 `orphan-migrations-journal.test.ts` 的精神,K3 根因分析明確指出目前缺這一層):掃描 `drizzle/schema.ts` 逐表比對含 `userId`/`user_id` 欄位的表,與 `USER_OWNED_TABLES` + 明確排除的「全域表」清單做差集,CI 跑,防止未來新增表又忘記登記。建議對稱地套用到 `exportUserData()`(`server/db.ts:5403+`)——K3 缺讀聲明 #2 指出很可能有同樣的漏欄位問題,尚未查證。

**(c) 呼叫端錯誤處理**:即使 (a)(b) 修完,仍建議 `profile.ts:29-34` 的 `deleteAccount` 包 try/catch,把資料庫錯誤轉成使用者看得懂的訊息(而非裸 tRPC 500),並記錄到監控,讓「刪帳號失敗」這種合規相關錯誤能被主動發現。

**測試**:
- 單元:對新版 `USER_OWNED_TABLES` 跑 (b) 的守門測試,斷言與 `schema.ts` 實際欄位盤點一致。
- 整合(需 `dev-environment/docker-compose.yml` 真實 MySQL):建測試使用者,在 10 張新增表各塞一筆資料,呼叫 `deleteUserAccount`,斷言:① 不拋錯 ② `users` 該列消失 ③ 10 張新增表 + `resource_shares` 相關列全部消失 ④ 10 張移除的表完全不受影響。
- 電路斷路器單元測試:模擬 `recordFailure` 收到 `ER_BAD_FIELD_ERROR`(非 transient)→ 斷言 `consecutiveFailures` 不遞增;收到 `ECONNRESET`(transient)→ 斷言遞增,達 5 次後 `isCircuitOpen()=true`。
- 迴歸:既有呼叫 `executeTransaction` 的 happy-path 測試(如 `deleteTeam`)不受影響。

**工作量**:L(2–3 天)— 本輪最重的一張:需重新設計 `USER_OWNED_TABLES` 資料結構、逐表核對真實欄位名稱、寫級聯陳述式、建守門測試,且理想上需真實 DB(docker-compose)驗證而非只讀碼推論(K3 缺讀聲明 #1 建議)。

**可否與功能並行**:可獨立分支進行,但**(a) 電路斷路器修法應最先合併**——低風險、無副作用的體質強化,做完可讓後續 (b)/(c) 的整合測試更安全地反覆執行,不必擔心測試本身觸發全站 503。

---

## 修復順序建議

1. **修復卡 4**(R6 cross-studio owner check,imageStudio/proStudio)——已有 videoStudio 現成對照實作可抄,風險/工作量比最高,第一個合併。
2. **修復卡 1 + 2**(R4+R5 SSRF,generate.ts + elevenLabsExtended.ts)——同批次處理,修法都是「補 redirect:error / 換 safeMediaUrl」,可共用 review。
3. **修復卡 7-(a)**(GDPR 電路斷路器 `isTransientError` 過濾)——低風險體質強化,越早做越能保護後續所有交易類修復的測試安全。
4. **修復卡 6**(R8 forge 分頁繞過同意書)——移除死碼 + 後端 fail-closed,合規風險高但改動面小。
5. **修復卡 3**(R6 proxy-download/safeMediaUrl 精確網域比對)——需先盤點本站實際 bucket host,別急著上線以免誤擋現有 CDN。
6. **修復卡 5**(R7 models.teamModels RBAC)——需先查證 `toggleVisibility` 的 `teamId` 賦值邏輯,風險是「修完模型集體不可見」,排在較後面留查證時間。
7. **修復卡 7-(b)(c)**(GDPR USER_OWNED_TABLES 修正)——本輪工作量最大、需真實 DB 驗證,排最後執行不代表不緊急(GDPR 合規風險本身最高等級),只是需要 (a) 先墊底、且涉及大量新測試建置,執行時間最長。
