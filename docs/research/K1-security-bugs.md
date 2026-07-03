# K1 — 對抗式安全 / 認證漏洞獵人報告(深挖 Wave K)

- 產生日期:2026-07-03
- 依據 commit:`4d137bdb907d67e6708ca360a66e89de0a6f2c2e`
- 方法:單一代理實讀程式碼(無子代理),對抗式驗證每一條可疑路徑是否「真的可觸發」,而非重複列舉已知防護件。已先讀 `docs/research/B-infra.md`(安全節)、`00-overview.md`、`02-fullstack.md`;凡與 B-infra 既有風險(E1/E2/S1/S2)重疊者,一律重新從程式碼確認並補上新證據/新變體,不原文照抄。
- 圖例:🔴 高 / 🟡 中 / 🟢 低(PLAUSIBLE 但影響有限)
- 狀態標記:**CONFIRMED**(已讀到觸發路徑與資料流終點)/ **PLAUSIBLE**(邏輯成立,但未跑實際請求驗證)

---

## 高風險(🔴)

### K1-1 🔴 CONFIRMED — SSRF:generate.ts 統一生成入口完全不做媒體 URL 網域白名單,且下游 Gemini 影像抓取無 redirect:"error",可經 302 跳轉打進內網

**問題**:同一組「參考圖 URL」欄位(`styleReferenceUrl`/`vibeReferenceUrl`/`firstFrameUrl`/`lastFrameUrl`/`characterRefUrl`)在 `imageStudio.ts`/`proStudio.ts`/`director.ts` 都套用 `safeMediaUrl`(`server/lib/urlValidator.ts`,https-only + 網域白名單 + 私網 IP 阻擋),但**主要的統一生成入口 `generate.ts`(`submitMultimodalAsync` 系列,Studio 表單實際呼叫的 procedure)完全沒有 import `safeMediaUrl`**,欄位只宣告 `z.string().nullable().optional()`(連 `.url()` 格式都不驗)。

**觸發情境**:使用者呼叫 `generate.submitMultimodalAsync`(或 :1571 附近的第二支同名 schema),`firstFrameUrl` 帶一個攻擊者控制的公開 HTTPS URL(通過任何格式檢查,因為根本沒檢查)。若引擎路由到 Gemini/Veo 圖生影分支(`server/services/geminiMedia.ts:421-448`),伺服器會:
1. `assertSafeExternalUrl(params.imageUrl)`(**同步版**,只擋字面私網 IP/loopback/metadata host,無 DNS-rebinding 檢查)
2. `fetch(params.imageUrl, { signal: AbortSignal.timeout(30_000) })` — **沒有 `redirect: "error"`**

攻擊者的 URL 先回應一個合法的公開 200(通過檢查後),或直接讓該 URL 回 302 導到 `http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>` 或內網服務位址;Node fetch 預設 `redirect: "follow"`,會自動追蹤跳轉,把內部資源的回應位元組當成圖片下載、base64 編碼後送進 Vertex AI 请求 body。

**錯誤結果**:伺服器對攻擊者指定的內網目標發出真實 HTTP 請求(egress from Railway 容器),可用於雲端 metadata 憑證竊取試探、內網服務探測/side-effect 觸發,且與 `ssrfGuard.ts`/`internalMedia.ts`/`webhookDispatcher.ts` 等處刻意寫的「redirect:error 防跳轉繞過」設計矛盾——同一份程式碼庫其他呼叫點都補了這道防線,唯獨這條路徑漏掉。

**證據**:
- `server/routers/generate.ts:361-367,1571-1577`(欄位型別 `z.string().nullable().optional()`,無 safeMediaUrl)
- `server/services/geminiMedia.ts:421-448`(`assertSafeExternalUrl` 之後的 `fetch` 缺 `redirect:"error"`)
- 對照組(有補防線):`server/services/internalMedia.ts:56-65`(`redirect:"error"` + async DNS 版)、`server/services/webhookDispatcher.ts:84,113,159`

---

### K1-2 🔴 CONFIRMED — SSRF:ElevenLabs 語音複製/配音/轉錄三條路徑同樣缺 redirect:"error",且可經教學資料庫(Teaching Archive)音檔/影片上傳由任一登入使用者觸發

**問題**:`server/services/elevenLabsExtended.ts` 的 `createVoice`(語音複製,:389-391)、`createDubbing`(:424-426)、`transcribe`(:478-480)三個方法都是先呼叫**同步**的 `assertSafeUrl()`(`server/lib/urlValidator.ts`,只擋私網 IP/loopback,並無 async DNS-rebinding 檢查),接著直接 `fetch(url)` **沒有帶 `redirect` 選項**(預設 follow)。

**觸發情境**:`teachingArchive.create`(`protectedProcedure`,任何登入使用者可呼叫)允許 `mediaType: "audio"|"video"` + `fileUrl`,而 `fileUrl` 的 zod 驗證只要求 `/^https?:\/\//`(見 `server/routers/teachingArchive.ts:65-68`,註解自稱「理論上只會是 storage 的 https URL」但**完全沒有網域白名單強制**)。背景 worker(`teachingArchiveIngestionWorker.ts` 每 60 秒)撿到任務後呼叫 `transcribeMedia({ mediaUrl: row.fileUrl })` → `elevenLabsExtended.transcribe()` → `assertSafeUrl` 通過(URL 本身是公開網域)→ `fetch(audioUrl)` 追蹤 302 跳轉到內網目標。

**錯誤結果**:同 K1-1,任何註冊使用者(不需 admin)都能觸發一次內網 GET 探測;回應位元組被包成 `audio.mp3` POST 給 ElevenLabs Speech-to-Text,雖然多數內網回應不是可辨識音訊(限制了「回傳內容能被使用者讀到」的直接外洩價值),但 SSRF 本身(內網連線建立、可用於探測/觸發任意 GET side-effect)已成立,且是本次深挖中發現**唯一沒有網域白名單、僅靠字面 IP 阻擋**的第一躍點入口。

**證據**:`server/services/elevenLabsExtended.ts:389-391,424-426,478-480`;`server/routers/teachingArchive.ts:65-68`;`server/services/teachingArchiveIngest.ts:106-112`;`server/services/mediaTranscriber.ts:21-33`

---

### K1-3 🔴 CONFIRMED — 跨租戶 IDOR:`assets.teamAssets` 在 `ENABLE_DATA_RBAC`(預設 OFF)時回傳全站所有使用者的 `team_shared` 資產,不限本人所屬團隊

**問題**:`server/db.ts:getTeamSharedAssetsFiltered()` 的查詢條件只有 `eq(digitalAssetLibrary.visibility, "team_shared")`(+可選的 assetType/sourceStudio/search 篩選),**完全沒有 userId 或 teamId 過濾**。Router 層(`server/routers/assets.ts:122-161`)只有在 `isDataRbacEnabled()` 為真時才用 `canAccess()` 事後過濾;程式碼註解**明確承認**:「旗標 OFF(預設)= 完全保持現狀:回(SQL 過濾後的)team_shared 資產(既有行為,**含已知 cross-tenant 洩漏**;本 PR 刻意不在 OFF 時改它)」。而 `ENABLE_DATA_RBAC` 的 schema 預設值是 `"false"`(`env.validated.ts:603`),`02-fullstack.md §9.3` 也把它列在「後端 orb/安全 env 旗標」的 **OFF** 清單。

**觸發情境**:使用者 A 把任一資產 `assets.toggleVisibility({ id, visibility: "team_shared" })`(甚至還會拿到 +2 credits 的「首次分享」獎勵,`assets.ts:261` 附近)。與 A 毫無團隊關係的使用者 B 只需呼叫 `assets.teamAssets`,即可看到 A 的資產(fileUrl、prompt、來源工作室等完整欄位)——「團隊共享」在預設環境下等同「全站公開」。

**錯誤結果**:私有創作內容(含可能含隱私/宗教修行素材,teaching archive 相鄰語境)在使用者只想「跟同事分享」的情況下,實際對全站任何登入帳號公開。

**證據**:`server/routers/assets.ts:122-161`(尤其 133-139 行註解);`server/db.ts:getTeamSharedAssetsFiltered`(約 1493-1533 行,無 userId/teamId 條件);`server/_core/env.validated.ts:603`

---

### K1-4 🔴 CONFIRMED — 跨租戶 IDOR:`models.teamModels`/`getById`/`getAnalysis` 無條件(無旗標可關)外洩全站 team_shared 微調模型

**問題**:與 K1-3 同類但**更嚴重,因為連 K1-3 那種「有旗標可修」的退路都沒有**。`models.teamModels` procedure(`server/routers/models.ts:20-22`)直接 `return db.getTeamSharedModels()`,呼叫時**完全忽略 `ctx.user`**;`db.getTeamSharedModels()`(`server/db.ts:1016-1024`)的查詢是 `eq(fineTunedModels.visibility, "team_shared")`,無任何 userId/teamId 篩選,`.select()` 回傳完整欄位(含 `trainedLoraUrl`、`configJson` 訓練設定等)。`getById`/`getAnalysis`(:24-38,41-55)同樣把「`visibility === "team_shared"`」當作「任何登入者皆可讀」的充分條件,不檢查請求者是否真的與模型擁有者同團隊。

**觸發情境**:使用者 A 把自訓 LoRA 模型 `toggleVisibility({ visibility: "team_shared" })`。與 A 無團隊關係的使用者 B 呼叫 `models.teamModels`,或直接猜/掃描 `models.getById({ id })`,即可讀到 A 模型的訓練資料集連結、權重下載 URL、使用統計。

**錯誤結果**:比資產庫更敏感——LoRA 權重與訓練配置一旦外流,等同該使用者的人物/風格模型被任何人下載複用,且此路徑**沒有 ENABLE_DATA_RBAC 這種開關可以緩解**,是結構性缺口而非「旗標忘記開」。

**證據**:`server/routers/models.ts:20-22,24-55`;`server/db.ts:1016-1024`

---

## 中風險(🟡)

### K1-5 🟡 CONFIRMED — 硬編碼超級管理員信箱是「不可撤銷」的後門,且明確擋掉降權操作

**問題**(承接 B-infra E1,補充新證據):`isAdminEmail()` 在兩處各自硬編碼 `"aa0968111723@gmail.com"`(`server/routes/localAuth.ts:89-97` 用於註冊時判定角色;`server/db.ts:145` 附近同名函式)。更關鍵的是 `server/db.ts:updateUserRole()`(2848-2863 行)明文邏輯:**只要目標帳號 email 命中此硬編碼清單,任何降級操作(role !== "admin")一律 `throw new Error("無法變更超級管理員的角色")`**——即便平台擁有者透過 admin UI 想撤銷這個帳號的權限也做不到,必須改程式碼重新部署。

**觸發情境**:此信箱一旦外流(例如被釣魚、或專案轉手交接時忘記聲明),取得者只要用該信箱完成一般註冊流程,`role: isAdminEmail(email) ? "admin" : "user"` 便直接授予 admin,且**任何人(含平台當前 admin)都無法透過產品介面撤銷**。

**證據**:`server/routes/localAuth.ts:89-97,160`;`server/db.ts:2847-2863`(`updateUserRole` 防降級邏輯)

---

### K1-6 🟡 CONFIRMED — `/api/proxy-download` 網域白名單用 `endsWith`,等同放行任意人的 S3/R2 bucket,伺服器變成匿名中繼代理

**問題**(承接 B-infra S2,重新核對觸發細節):`isProxyAllowed()`(`server/_core/index.ts:342-351`)判斷 `u.hostname === h || u.hostname.endsWith("." + h)`,白名單裡的 `"amazonaws.com"`、`"r2.cloudflarestorage.com"` 是**萬用尾碼**,任何客戶(不限本站)在 AWS/Cloudflare 開的 bucket 網域都符合。端點雖有 `authenticateRequest` + 專屬限流(30 次/15min)+ 100MB 上限,但驗證邏輯本身允許任何登入使用者把此端點當一般用途的 HTTP 中繼/匿名代理使用。

**觸發情境**:登入使用者呼叫 `GET /api/proxy-download?url=https://<attacker-bucket>.s3.amazonaws.com/<file>`,伺服器會以自己的出口 IP 幫忙抓取並回傳任意公開 bucket 內容(可用於繞過受害站的 IP 封鎖名單、隱藏真實請求來源、或作為輕量級檔案外傳跳板)。

**證據**:`server/_core/index.ts:325-351,792-810`

---

### K1-7 🟡 CONFIRMED — 同款「萬用尾碼白名單」也存在於 `safeMediaUrl` 的網域清單(`lib/urlValidator.ts`),影響 imageStudio/proStudio/director 的參考圖驗證強度

**問題**:`STATIC_ALLOWED_HOSTS_RE`(`server/lib/urlValidator.ts:26-27`)含 `amazonaws\.com`、`r2\.dev`、`cloudfront\.net`、`supabase\.co`、`blob\.core\.windows\.net` 等**公有雲共用網域**,`isAllowedHost()` 用 `endsWith` 判斷。這些是 imageStudio/proStudio/director 的「有防護」端點所依賴的白名單本體,意味著這些端點雖然比 K1-1 的 generate.ts 嚴謹,但白名單本身仍只是「任一 AWS/Cloudflare/Supabase 客戶的 bucket」而非「我們自己的 bucket」,與 K1-6 是同一類設計問題的另一個實例。

**證據**:`server/lib/urlValidator.ts:26-27,34-40`

---

### K1-8 🟡 PLAUSIBLE — generate.ts 與 imageStudio.ts/proStudio.ts/director.ts 對「同一種輸入欄位」執行不同強度的驗證,形成「改走另一條路由繞過防護」的結構性風險

**問題**:K1-1 已證實 generate.ts 完全不查網域;但即使 imageStudio.ts 等端點有 `safeMediaUrl`,兩組端點在功能上高度重疊(都能提交圖生圖/圖生影任務),使用者能自由選擇呼叫哪一個 procedure。任何「在嚴格端點修補的 SSRF/資料驗證」若沒有同步在 generate.ts 補齊,就永遠有繞道空間——這不是單一 bug,而是雙路由架構本身的系統性弱點,值得後續每次補防護時明確納入 checklist。

**證據**:比較 `server/routers/generate.ts` 與 `server/routers/imageStudio.ts` 對 `image_url`/`firstFrameUrl` 等欄位的 zod 定義差異(如 K1-1 引用行號)

---

## 低風險(🟢,列入記錄但影響有限)

### K1-9 🟢 PLAUSIBLE — Replicate webhook 寫入 `trainedLoraUrl` 未經 SSRF/網域驗證、未走 `localizeResultUrls`,與 fal/Suno webhook 的處理方式不一致

**問題**:`server/routes/webhookReplicate.ts:extractWeightsUrl()` 取出的 URL 直接寫進 `fineTunedModels.trainedLoraUrl`(:135-146),既未呼叫 `assertSafeExternalUrl`,也未經 `localizeResultUrls`(fal/Suno webhook 都有這一步,見 `webhookFal.ts:227-234`、`webhookSuno.ts:230-237`)。因為此端點仍受 per-model HMAC capability token 保護(`verifyWebhookToken("replicate", modelId, token)`,無法偽造),此差異目前不构成可獨立利用的漏洞,但若日後 Replicate 一側被入侵或 token 外洩,攻擊者能把任意 URL(含私網位址,因為完全沒做 SSRF 檢查)寫入資料庫,供後續下載/顯示流程使用。

**證據**:`server/routes/webhookReplicate.ts:50-67,135-146`

### K1-10 🟢 PLAUSIBLE — JWT session 驗證的三段式 fallback(嚴格 aud → 無 aud → JWT_SECRET_RAW)擴大了可被接受的簽章驗證路徑組合

**問題**:`verifySessionToken()`(`server/_core/googleAuth.ts:179-214`)為了做 aud 與金鑰 trim 的雙重「過渡期相容」,依序嘗試三種驗證方式。每一種都仍要求持有正確簽章(不構成偽造漏洞),但屬於刻意的技術債(程式碼註解自陳「數週後待舊 token 自然過期即可移除」),擴大了程式碼要維護正確的驗證路徑數量,增加未來修改時引入邏輯錯誤的風險面。目前未發現可直接繞過簽章驗證的路徑。

**證據**:`server/_core/googleAuth.ts:179-214`

### K1-11 🟢 已知(承接 B-infra E2,無新增)— Suno 第三方 proxy 無官方簽章,完全依賴自製 capability token

`server/services/modelClients.ts:394` 硬編碼 `https://apibox.erweima.ai`,無 HMAC/簽章協定;`webhookSuno.ts` 純靠 `verifyWebhookToken("suno", jobId, token)` 把關,無第二層(不像 fal 有 Ed25519 JWKS 選項)。目前設計已是「已知限制」而非新漏洞,列入供交叉比對。

---

## 本次已排除的懷疑點(查證後判定無明顯漏洞)

- `history.ts`/`notes.ts`/`vault.ts`/`promptLibrary.ts`/`creativeProject.ts`/`videoProject.ts`/`showcase.ts`/`videoAnalyticsRouter.ts`:逐一核對 get/update/delete,皆在 DB 查詢層同時過濾 `id` + `userId`(或已修過 IDOR,如 showcase.getById AIDV-609、videoAnalytics AIDV-862),未發現可跨人存取的漏洞。
- `webhookFal.ts`/`webhookSuno.ts`/`webhookReplicate.ts`/`stripeWebhook.ts` 的簽章/token 驗證邏輯:HMAC + `timingSafeEqual`,無 secret 時僅 dev fail-open、prod fail-closed,設計正確;Stripe handler 雖全是 TODO 但不構成可利用漏洞(業務空轉而非授權缺口)。
- `server/services/webhookDispatcher.ts`(使用者自訂 webhook 訂閱的實際送達路徑):建立時與**每次送達時**都重新做 async DNS-rebinding 檢查 + `redirect:"error"`,是本次深挖中做得最完整的一個範例,與 K1-1/K1-2 形成對比。
- `getUserDailyTrend`/`getUserDailyTrendRange` 的 `sql.raw(String(days))`:`days` 在進入 `sql.raw` 前已 `Math.trunc`+`Math.min/Math.max` 限制在 1–90 的整數,非使用者可控字串,不構成 SQL Injection。
- 前端 `dangerouslySetInnerHTML`(4 處:LoginCosmicScene.tsx、chart.tsx、composeLayout.ts、LearnHub.tsx)快速掃描未見直接注入未過濄的使用者輸入,但**未逐行深究資料來源**,見下方未查完清單。

---

## 未查完部分(逾出本輪深挖範圍)

1. **前端 XSS 全面性**:只快速掃了 `dangerouslySetInnerHTML` 的 4 個檔案位置,未逐一追蹤每處注入內容的資料來源是否含使用者可控字串(尤其 LearnHub.tsx 若渲染 AI 生成或使用者留言內容)。自製 `renderMarkdown`(若存在)未定位到並審查。
2. **orb tool registry 的 SSRF/工具執行邊界**:`orbWebResearch`/`braveLearnFetcher`/`perplexityDeepSearch` 等對外爬網服務,只確認其 fetch 呼叫存在但未逐一核對是否每個出口都掛 `ssrfGuard`;`agentToolExecutor.ts`(orb 工具執行器,可能是攻擊面最大的「LLM 決定要 fetch 什麼」路徑)僅列在「未用 ssrfGuard 的檔案」清單中,未深入讀取其工具白名單與參數驗證邏輯。
3. **secret 外洩/log 印密鑰**:僅做了關鍵字快速 grep(`console.log.*token/secret/apiKey`),未系統性檢查 55 處 `ELEVENLABS_API_KEY`、42 處 `FAL_API_KEY` 直讀點是否有任何一處意外印出完整值;Sentry beforeSend 的標頭剝除清單也未逐一核對是否涵蓋所有可能夾帶密鑰的自訂標頭。
4. **`.env.production`/`.env.example` 逐行核對是否有殘留測試用真實金鑰**(B-infra 已初步判定 `.env.production` 只有 7 個 VITE_* 旗標無密鑰,本輪未重新驗證)。
5. **Replicate/fal webhook token 的實際 timing side-channel**:`verifyWebhookToken` 在 `token.length !== expected.length` 提前 return false,屬於長度比較而非逐位元 timing-safe,理論上洩漏「長度是否正確」但因 HMAC-SHA256 hex 輸出長度固定(64 字元),實務上不構成有效攻擊面,未做形式化分析。
6. **Supabase 側(agent_tasks/video_projects/creator_job_throttle 等)RLS policy 逐條 SQL 稽核**:僅引用 B-infra 既有掃描結論,未重新對抗式核對 policy 條件字串是否有邏輯漏洞(例如 `TO authenticated` 是否配合正確的 `USING`/`WITH CHECK` 述詞)。
7. **JWT alg-confusion / 「none」演算法攻擊面**的形式化驗證:僅目測 jose 呼叫方式合理,未寫 PoC 實際嘗試偽造 token。
