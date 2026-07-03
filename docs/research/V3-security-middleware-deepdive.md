# V3 — 安全中介層與守衛全套逐檔深挖(對抗式繞過獵人,Wave V)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 範圍:`server/middleware/` + `server/services/authz/` + `server/services/security/` + `server/_core` 的
  csrfOriginGuard / inputGuard / xssInputGuard / ssrfGuard / fetchGuard / rateLimiter / secretCrypto /
  webhookTokens / oauthState / trpcRateLimit / apiGuards / agentScopeGuard
- 方法:單一代理逐行實讀(**未 spawn 子代理**),對每個 guard 對抗式驗證「能否繞過」;用 `node -e` 實測
  WHATWG URL 正規化行為(十進位/十六進位/八進位 IP、IPv4-mapped IPv6、全形數字)驗證 SSRF 正則是否被繞過。
- 已讀不重複:`docs/research/K1-security-bugs.md`(SSRF/IDOR/硬編碼 admin)、`docs/research/B-infra.md`
  (CSRF/CSP/oauthState 節,E1-E4)、`docs/research/P4-security-fixes.md`(K1 修復卡設計)。
  另交叉核對 `docs/research/U6-costar-multiagent-deepdive.md`(已對 `ragInjectionGuard.ts` 全讀,
  發現 CO-STAR Step1→Step2 繞過注入 guard——本輪不重複,只在下方背景註記帶過)。
- 圖例:🔴 高 / 🟡 中 / 🟢 低。狀態:**CONFIRMED**(讀到觸發路徑) / **PLAUSIBLE**(邏輯成立未跑真請求)。

---

## 一、新發現(本輪 Wave V 獨有)

### V3-1 🔴 CONFIRMED — `agentScopeGuard`(角色→scope 授權)完全未接線到真正的工具執行引擎,形同虛設

**問題**:`checkAgentScope`/`assertAgentScope`(`server/_core/agentScopeGuard.ts`)在全專案**只有一個呼叫點**——
`server/services/orbTaskStateMachine.ts:62` 內部私有函式 `checkStepScope`(48-71 行,未 `export`)。而真正
負責「跑 orb task 每一步工具」的執行引擎是 `server/services/orbTaskOrchestrator.ts`
(`executeCurrentStepTools`,173 行起,1046 行全檔),它從 `orbTaskStateMachine.ts` 只 import
`appendOrbAgentTaskAuditEvent`/`completeOrbAgentStep`/`failOrbAgentStep`/`getOrbAgentTask`
(orbTaskOrchestrator.ts:35-40)——**完全沒有 import `checkStepScope` 或 `checkAgentScope`**;
對整檔 grep `agentScopeGuard|checkAgentScope|Scope` 零命中。

`executeCurrentStepTools` 正是 `server/routers/ai.ts`、`server/routers/brainPipeline.ts`、
以及**外部可觸發**的 `server/routes/webhooks.ts:85-93`(`POST /api/webhooks/orb`,只需一個共用密鑰
`ORB_WEBHOOK_SECRET` + 任意 `userId` 即可觸發規劃器產生任務並直接執行)所呼叫的路徑。

**觸發情境**:任何走 `executeCurrentStepTools` 的任務(含 webhook 觸發、`ai.ts`/`brainPipeline.ts` 一般
對話流程),無論 `agentRole` 是 `voice-specialist`(scope 應只有 `write:voice`/`write:asset`)還是
`researcher`(應為唯讀),其產出的每一步工具呼叫**完全不經過任何 scope 檢查**——`ROLE_SCOPES` 定義的
「voice-specialist 不可 `delete:project`/`publish:project`」規則只在 `orbTaskStateMachine.ts` 那條沒人走的
路徑上生效。

**附帶發現**:即使日後把 `checkStepScope` 接回主路徑,它本身也是 **fail-open when role missing**——
`orbTaskStateMachine.ts:52-59`:`if (!role) { console.warn(...); return; }`——只要 `task.agentRole` 為
`undefined`(規劃器輸出、或 webhook 端點餵入的 planner 結果沒有明確填這欄),scope 檢查整個跳過,
不是拒絕而是放行(註解自稱「safe during rollout」,但同時是攻擊者最簡單的繞過手段:讓任務沒有 role)。

**證據**:
- `server/_core/agentScopeGuard.ts`(全檔,42-105 行 `ROLE_SCOPES`)
- `server/services/orbTaskStateMachine.ts:48-71`(`checkStepScope`,唯一呼叫點 :62;fail-open :52-59)
- `server/services/orbTaskOrchestrator.ts:1-52`(import 清單,無 scope guard)、`:173`(`executeCurrentStepTools`)
- `server/routes/webhooks.ts:35-95`(`/api/webhooks/orb`,可外部觸發 `executeCurrentStepTools`)

---

### V3-2 🟡 CONFIRMED — `checkAgentRateLimit` 的「代理呼叫」判定完全靠客戶端自報 `X-Agent-Id` 標頭,拿掉標頭即繞過代理配額

**問題**:`server/_core/trpcRateLimit.ts:118-162` 的 `checkAgentRateLimit`(AIDV-354,20 次/小時 per-user
代理配額)第一件事就是 `if (!req?.headers?.["x-agent-id"]) return;`(:127)——**只要請求不帶這個標頭,
整個代理限流函式直接 no-op**,回退視為「human call」。但這個標頭是請求端自己決定要不要送的字串,伺服器
沒有任何簽章或反向驗證它「真的是代理呼叫」。註解自陳設計初衷是「limits per-user agent-originated
mutations...to prevent a single creator's agents from exhausting shared LLM capacity」,但威脅模型
(自動化腳本模擬代理大量呼叫)恰好就是能自由決定要不要送這個標頭的行為者——只要不送,20/hr 的代理專屬
天花板形同不存在,退回到一般 tRPC/LLM tier 的更寬鬆額度(`rateLimiters.llmPerUser` 30/15min 或
`rateLimiters.api` 300/15min)。

**證據**:`server/_core/trpcRateLimit.ts:118-162`,尤其 :127

---

### V3-3 🟡 CONFIRMED — Express 層級的所有 tiered rate limiter(auth/llm/api/upload/proxyDownload)在實務上永遠是純 IP 鍵,「per-user 防 NAT 共池」的設計意圖從未生效

**問題**:`buildRateLimitKey`(`server/_core/rateLimiter.ts:92-101`)优先讀 `req.user?.id`,理由(:93-94)
是「tRPC context attaches user to req after authentication」。但 `rateLimiters.api`/`.llm`/`.upload`/
`.auth`/`.proxyDownload` 全部是**掛在 Express 中介層**(`server/_core/index.ts:528-555`,例如
`app.use("/api/", rateLimiters.api)` 在 555 行),而 tRPC 的 `createContext`(真正產生 `ctx.user` 的地方)
要到 `createExpressMiddleware({ router: appRouter, createContext })` 掛載時才執行(`index.ts:1004-1010`,
遠晚於 555 行);整條中介層鏈從開頭到 555 行**沒有任何一處把 `req.user` 賦值**(唯一的
`authenticateRequest` 使用點在 :792,是 `/api/proxy-download` 專用、且也晚於 api tier 的全域掛載)。

**後果**:`buildRateLimitKey` 的 `if (userId) return \`user:${userId}\`` 分支對這些全域 tier 而言是死碼,
每個請求一律落到 `ip:${ipKeyGenerator(req.ip)}` 分支。這代表:
1. 文件宣稱的「避免單一登入使用者用完共享 IP 額度(例如公司 NAT 後面)」從未真正生效——同一 NAT 後面的
   多個登入使用者仍共用同一組 IP 額度,互相排擠。
2. 更關鍵:因為鍵完全由 `req.ip` 決定,而 `server/_core/index.ts:502` 設了 `app.set("trust proxy", 1)`,
   若實際部署拓樸不是嚴格的「單一受信任反代」(例如 Railway edge 未清洗/覆寫入站
   `X-Forwarded-For`,而是原樣附加),攻擊者可對每個請求帶不同的偽造 `X-Forwarded-For` 值,讓
   `buildRateLimitKey` 每次都算出不同的 `ip:` 鍵,徹底繞過 auth/llm/api/upload/proxyDownload 全部五層
   tier 限流(**PLAUSIBLE**,實際可利用性取決於 Railway 邊緣代理是否嚴格覆寫/清洗該標頭,本輪未做實際
   網路層驗證)。

**證據**:`server/_core/rateLimiter.ts:92-101`(`buildRateLimitKey`)、`server/_core/index.ts:502`
(`trust proxy`)、`:555`(`rateLimiters.api` 全域掛載)、`:1004-1010`(tRPC context 建立時機)、
`:792`(唯一 `authenticateRequest` 呼叫點,晚於 :555)

---

### V3-4 🟡 CONFIRMED — `secretCrypto.ts` 在 `CREDENTIAL_ENCRYPTION_KEY` 未設定時,靜默 fallback 到與 session JWT/webhook token 共用的 `JWT_SECRET`,且無開機期檢查

**問題**:`resolveKeyMaterial()`(`server/_core/secretCrypto.ts:35-51`)對預設金鑰版本 `"k1"` 的解析順序是
`CREDENTIAL_ENCRYPTION_KEY → JWT_SECRET_RAW → JWT_SECRET`(:44-50)。`CREDENTIAL_ENCRYPTION_KEY` 這個變數
**完全不在 `server/_core/env.validated.ts` schema 內**(全專案 grep 只出現在 `secretCrypto.ts` 直讀
`process.env` 與各測試檔/`.env.example`),因此:
1. 沒有任何 zod 驗證或開機期斷言檢查它是否真的被設定(對照 `JWT_SECRET` 自己有
   `assertJwtSecretReady()` 在 `index.ts:376` 開機時 fail-fast)。
2. 若忘記在 Railway 設定這個變數(是完全合理的疏漏——它甚至不會出現在 env schema 驅動的「env key 狀態燈」
   admin 面板,呼應 B-infra E4 的「~68 個不在 schema 的 env 變數」清單),`encryptSecret`/`decryptSecret`
   會靜默改用 `JWT_SECRET` 衍生金鑰,**沒有任何 log/警告**告知 ops 這件事發生了。

**影響**:此時同一把 `JWT_SECRET` 同時是(a) session token 簽章金鑰、(b) `webhookTokens.ts` 的
HMAC capability token 簽章金鑰(`computeToken`,:48-51 直接讀 `serverEnv.JWT_SECRET`)、(c) 經
`scrypt(secret, "healing-studio-cred-v1", 32)` 衍生後的 AES-256-GCM 金鑰,用來加密存放的第三方憑證
(Notion API token 等,`connectionService.ts`/`external.ts` 呼叫點)。單一 `JWT_SECRET` 外流即同時攻破
三個原本應該獨立的信任邊界(偽造登入 session、偽造 webhook 回呼、解密所有已存的第三方憑證),而且沒有
任何監控訊號能提前發現「其實根本沒設 `CREDENTIAL_ENCRYPTION_KEY`」這件事已經在發生。

**證據**:`server/_core/secretCrypto.ts:35-51`(fallback 鏈)、`:64`(`scryptSync` 衍生)、
`server/_core/webhookTokens.ts:42-46`(webhook token 同樣讀 `serverEnv.JWT_SECRET`)、
`server/_core/index.ts:376`(唯一的 JWT_SECRET 開機檢查,無 CREDENTIAL_ENCRYPTION_KEY 對應版本)

---

### V3-5 🟡 CONFIRMED(補強 K1-1/K1-2 根因)— 兩套「同步版」SSRF 檢查對「非 IP 字面量的網域名稱」完全不做 DNS 檢查,不需要任何 302 跳轉就能直接連進私網

**問題**:K1-1/K1-2 把成因寫成「缺 `redirect:"error"`,可被 302 跳轉繞過」,但本輪逐行核對
`server/_core/ssrfGuard.ts` 與 `shared/safe-url.ts` 後發現一個更根本、且不需要任何跳轉技巧的成因:

- `assertSafeExternalUrl`(**同步版**,`ssrfGuard.ts:63-100`)只對 hostname 做正則字面比對(私網 IPv4
  段、IPv6 ULA/link-local、`::ffff:` 映射還原),**完全沒有呼叫 DNS**。只有 `assertSafeExternalUrlAsync`
  (:117-169)才會 `dnsLookup(host)` 並對解析後的每個位址做同款檢查。
- `shared/safe-url.ts` 的 `isSafeExternalUrl`(23-68 行,K1-1/K1-2 提及的 `assertSafeUrl` 之外**另一套**
  更弱的變體,見 V3-6)**永遠不做 DNS 查詢**,連 Async 版都沒有。

用 `node -e` 實測 WHATWG URL 正規化行為(見附錄)確認:十進位(`2130706433`)、十六進位(`0x7f000001`)、
八進位(`0177.0.0.1`)、縮寫(`127.1`)、IPv4-mapped-IPv6(`::ffff:127.0.0.1`)等常見「IP 字面量偽裝」手法
**全部**會被 `new URL()` 正規化成標準 `a.b.c.d` 形式,所以現有正則其實**已經**擋得住這些花招——這部分程式碼
品質不錯。**但這對純網域名稱(非 IP 字面量)完全無效**:`http://隨便一個攻擊者網域.com/` 這種
hostname 不會被 `assertSafeExternalUrl`/`isSafeExternalUrl` 的任何正則命中(它們只認得 IP 字面量格式),
於是直接通過驗證進到 `fetch()`。真正決定它連去哪裡的是 **fetch 當下的 DNS 解析**——只要攻擊者控制的網域
A 記錄直接指向 `169.254.169.254`(AWS IMDS)或 `10.0.0.x`(內網服務),**不需要任何 302 跳轉、不需要
DNS-rebinding 的 TOCTOU 時間差**,同步版檢查就已經完全失守。K1-1(`geminiMedia.ts:421-448`)、K1-2
(`elevenLabsExtended.ts:389-391/424-426/478-480`)這幾個「只用同步版 `assertSafeUrl`」的呼叫點,其實
連「先讓 URL 通過檢查、之後才 302 跳轉進內網」這一步都不必——攻擊者一開始提供的 URL 本身(一個普通域名)
就能直接命中內網,K1 的「redirect 繞過」只是這個更根本缺口之上的次要放大器。

**證據**:
- `server/_core/ssrfGuard.ts:63-100`(同步版無 DNS)vs `:117-169`(Async 版才做 DNS)
- `shared/safe-url.ts:23-68`(永遠無 DNS,連 Async 版都不存在)
- 附錄實測(`node -e`,見文末)確認 IP 偽裝格式已被 URL 正規化擋下,唯獨純網域名稱這條路完全不受檢查

---

### V3-6 🟡 CONFIRMED(補強 K1-8 結構性風險,發現第三套/最弱的 SSRF guard 家族)— `videoStudio.ts`(~20 個生成 procedure)與 `spiritRouter.ts` 用的是三套 SSRF guard 中最弱的一套,零網域白名單

**問題**:本輪盤點發現專案內其實有**三套平行的 SSRF 防護家族**,強度依序遞減:

1. `server/lib/urlValidator.ts`(`assertSafeUrl`/`safeMediaUrl`)——https-only + **網域白名單**
   (`STATIC_ALLOWED_HOSTS_RE`)+ IP 字面量封鎖。imageStudio/proStudio/director 用這套(K1-7 已指出
   白名單本身用萬用尾碼,但至少「有」白名單)。
2. `server/_core/ssrfGuard.ts`(`assertSafeExternalUrl(Async)`)——**無網域白名單**,只做 IP
   字面量/DNS 解析後 IP 檢查,K1-1/K1-2 的 `generate.ts`/`elevenLabsExtended.ts` 用這套。
3. `shared/safe-url.ts`(`isSafeExternalUrl`,經 `server/utils/validateSafeUrl.ts` 重新匯出成
   `safeExternalUrl`/`safeExternalUrlOptional` zod schema)——**無網域白名單、永不做 DNS
   解析**,是三套裡最弱的一套(理由:它是前後端共用的純函式,瀏覽器端無法做 DNS 查詢,所以先天沒有
   Async 變體)。

`server/routers/videoStudio.ts:25` import 的正是第 3 套(最弱),並套用在幾乎所有生成 procedure 的
`imageUrl`/`videoUrl`/`firstFrameUrl`/`lastFrameUrl`/`tailImageUrl`/`imageUrls` 欄位——粗算 20 處
(:510-511, 892-893, 940-941, 986, 1025, 1071, 1120, 1161, 1199, 1236, 1283, 1322, 1365, 1421, 1507,
1557, 1610 等)。`server/routers/spiritRouter.ts:14,46-57` 同樣用這套。

**觸發情境與影響範圍(重要澄清)**:核對這些欄位的下游用途後確認,`videoStudio.ts` 本身**不會**在伺服器
端直接 `fetch()` 這些使用者提供的輸入 URL——它們被原樣塞進 payload(如 `image_url: input.imageUrl`)
轉發給 `falQueueRun(modelId, payload, ...)`,即由 **fal.ai 自己的基礎設施**去抓取這個 URL(全檔 grep
`await fetch(`/`assertSafeExternalUrl`/`assertSafeUrl` 在 `videoStudio.ts`/`spiritRouter.ts` 均零命中)。
因此這不是 K1-1 那種「直接打進 healing-studio 自己內網/雲端 metadata」的一級 SSRF,而是**把
healing-studio 當跳板,對第三方(fal.ai)基礎設施做 SSRF**——攻擊者可提供一個 A 記錄指向 fal.ai
內網位址的網域,讓 fal.ai 的伺服器代為發起請求。實際可否成功探測 fal.ai 內網,取決於 fal.ai 自己的
下載器是否有等效防護(本輪未測,PLAUSIBLE),但至少「輸入驗證完全不設防、任意 https 網域皆可通過」
這件事在程式碼層面是 CONFIRMED 的,且與 K1-8 指出的「雙路由驗證強度不一致」屬同一結構性問題的第三個
變體(imageStudio/proStudio 用最強的白名單版、generate.ts 完全不驗證、videoStudio 用「有驗證但形同虛設」
的最弱版)。

**證據**:`server/routers/videoStudio.ts:25`(import)、多處欄位定義(如上列行號)、
`server/routers/spiritRouter.ts:14,46-57`;對照組(有 DNS+白名單雙重防護的正確用法):
`server/lib/urlValidator.ts` 全檔

---

### V3-7 🟢 CONFIRMED — `csrfOriginGuard.test.ts`/`xssInputGuard.test.ts` 是「影子重寫」測試,不 import 真正的生產程式碼,現狀一致但存在未來 drift 盲區

**問題**:`server/_core/csrfOriginGuard.test.ts`(全檔)在 `buildApp()`(18-61 行)裡**手動重新寫了一份**
CSRF origin guard 的邏輯(逐字複製 `CSRF_BYPASS_PREFIXES`/`CSRF_SAFE_METHODS`/Origin 比對),而不是
`import` `server/_core/index.ts` 裡真正掛載的那個中介層(該檔案本身也沒有把這段邏輯抽成獨立可匯入的
函式——它是直接寫在 `registerRoutes` 內的一個 inline `app.use()` callback,:582-612,無法被
`import` 引用)。同樣地,`xssInputGuard.test.ts`(全檔)在檔案內自己定義了一個 `titleSchema`
(13-17 行),並非從任何實際 router 的 zod schema import 而來。

本輪逐字比對確認**目前**兩者與 `index.ts:582-612` 的實際邏輯完全一致(未 drift),所以不構成當下可
利用的漏洞。但這是一個結構性弱點:因為守衛邏輯本身沒有被抽成可 import 的獨立函式,測試只能「重新謄寫
一份」而非「呼叫真正的實作」,意味著:
1. 任何人日後修改 `index.ts:582-612` 的真正邏輯(例如調整 bypass 前綴、放寬 Origin 比對),這兩份
   測試**不會**因此變紅——它們永遠測的是自己手抄的版本,和生產程式碼已經脫鉤都不會被抓到。
2. `xssInputGuard.test.ts` 的 `titleSchema` 是否真的對應到某個實際 router 使用中的欄位定義,本輪
   未逐一比對(見「未查完」);若對應的實際 schema 已經改了 refine 規則,這份測試同樣測不出來。

**建議方向(僅供記錄,未在本研究文件外動程式碼)**:把 `index.ts:582-612` 的 callback 抽成
`server/_core/csrfOriginGuard.ts` 具名匯出函式,測試改成 `import` 真正的實作,消除「影子測試」的
drift 盲區。

**證據**:`server/_core/csrfOriginGuard.test.ts:18-61` vs `server/_core/index.ts:577-612`(逐字比對一致);
`server/_core/xssInputGuard.test.ts:13-17`(inline schema,未定位到對應的真實 router 欄位)

---

### V3-8 🟢 CONFIRMED — `fetchGuard.ts` 的命名具有誤導性:它不做任何 SSRF 防護,只是 URL 協定補全 shim

**問題**:`server/_core/fetchGuard.ts`(全檔,41 行)的 `installFetchGuard()` monkey-patches
`globalThis.fetch`,但它做的事僅僅是「輸入字串沒有 `http(s)://` 前綴時自動補上」(`ensureAbsoluteUrl`,
10-22 行)——完全沒有 import 或呼叫 `ssrfGuard.ts`/`urlValidator.ts` 任何一個函式,也沒有做任何
私網/metadata 位址檢查。這個檔名(`fetchGuard`)與同目錄的 `ssrfGuard.ts`/其他真正的安全檢查模組並列
時,容易讓後續開發者誤以為「呼叫 `installFetchGuard()` 之後全域 `fetch` 就自動有 SSRF 防護」,從而在
新增外部 fetch 呼叫點時略過應該補的 `assertSafeExternalUrl`/`safeMediaUrl` 檢查——形成一種「因為看到
`fetchGuard` 這個名字就以為已經被保護」的誤導風險(本輪未追蹤 `installFetchGuard()` 實際安裝點與是否
有任何呼叫端因此省略真正的 SSRF 檢查,屬於命名/認知風險而非直接可利用漏洞)。

**證據**:`server/_core/fetchGuard.ts`(全檔,尤其 30-40 行 `installFetchGuard` 本體)

---

### V3-9 🟢 CONFIRMED — CSRF bypass 前綴表對「單數/複數」路徑寫死,`/api/webhooks/orb`(複數,orb webhook)不在豁免清單內

**問題**:`server/_core/index.ts:580` 的 `CSRF_BYPASS_PREFIXES = ["/api/trpc", "/api/webhook/"]`
只豁免**單數**且**帶尾斜線**的 `/api/webhook/`(對應 fal/suno/replicate/stripe 的簽章/token 驗證
webhook,:665-668),但 `server/routes/webhooks.ts` 的 `webhooksRouter` 卻掛載在**複數**的
`/api/webhooks`(`index.ts:962`)——不符合任何 bypass 前綴,因此 `POST /api/webhooks/orb` 在生產環境
(`VITE_SITE_URL` 非 localhost 且 `CSRF_PROTECTION` 未關閉)下**必須**帶一個等於 `VITE_SITE_URL` 的
Origin/Referer 標頭才能通過全域 CSRF guard——但這個端點的呼叫者(`webhooks.ts:19-24` 的
`isValidSecret`/`ORB_WEBHOOK_SECRET` 設計)明顯是給**外部伺服器對伺服器**呼叫用的(共用密鑰驗證,不是
瀏覽器 cookie session),外部呼叫端通常不會帶任何 Origin 標頭,將被 CSRF guard 直接 403「缺少 Origin
header」擋下。結果是:此端點在正常生產設定下,對其原本設計的呼叫方式**是斷的**(除非剛好處在
`CSRF_PROTECTION=0`/測試模式/`VITE_SITE_URL` 未設等豁免情境)。從安全角度這不是「可被攻擊者利用的洞」,
反而是「防護過嚴導致功能可能形同停用」,但因為它牽涉到 guard 前綴比對邏輯本身(單複數不一致),仍記錄
為本輪 middleware 順序/涵蓋範圍稽核的具體發現。

**證據**:`server/_core/index.ts:580`(bypass 前綴)、`:962`(`/api/webhooks` 複數掛載)、
`server/routes/webhooks.ts:12-48`(共用密鑰驗證,無 Origin/session 概念)

---

## 二、已知項目的重新確認(非新發現,列入供交叉比對)

- **`ENABLE_RAG_INJECTION_GUARD` 預設 OFF**:`server/services/security/ragInjectionGuard.ts:54-72`
  自身文件與程式碼確認預設關閉,與 B-infra E4、K1 既有清單一致,非新發現。
- **`ragInjectionGuard` 的實際接線範圍與 CO-STAR Step1→Step2 繞過**:已由
  `docs/research/U6-costar-multiagent-deepdive.md` 全讀 `ragInjectionGuard.ts` 並發現「Step1 即時網路
  研究結果未過 guard」,本輪不重複驗證,僅確認 V3-1(agentScopeGuard 未接線)是完全不同的檔案/機制,
  兩者並存但互不重疊。
- **x-trpc-source CSRF 設計**(`index.ts:984-1001`):核對後判定設計正確——跨站簡單表單/`sendBeacon`
  無法夾帶自訂標頭,瀏覽器會因 CORS 而擋下真正夾帶標頭的跨站請求;唯一的「繞過」只是這個標頭**不檢查值
  只檢查存在**(`if (!req.headers["x-trpc-source"])`,:996),但因為瀏覽器同源政策已經是第一道防線,
  值本身不需要保密——此為既有正確設計,非漏洞,列入記錄。
- **`assertSafeExternalUrl` 對 IP 字面量偽裝格式(十進位/十六進位/八進位/IPv4-mapped-IPv6)的抵抗力**:
  本輪用 `node -e` 實測證實 WHATWG URL 正規化會先把這些格式統一成標準點分十進位,現有正則能正確攔截,
  **不是**繞過點(修正了本次深挖前的假設)。

---

## 附錄:node -e 實測(URL 正規化行為,支撐 V3-5)

```
http://2130706433/              -> 127.0.0.1        (十進位,被 /^127\./ 攔下)
http://0x7f000001/               -> 127.0.0.1        (十六進位,同上)
http://0177.0.0.1/               -> 127.0.0.1        (八進位首段,同上)
http://127.1/                    -> 127.0.0.1        (縮寫,同上)
http://0/                        -> 0.0.0.0          (被 /^0\./ 攔下)
http://[::ffff:127.0.0.1]/       -> [::ffff:7f00:1]  (ipv4MappedIpv6ToIpv4 正確還原並攔下)
http://０127.0.0.1/ (全形零)      -> 87.0.0.1         (Unicode NFKC 正規化後八進位運算,巧合落在公網段,非繞過)
http://localhost.attacker.com/   -> localhost.attacker.com（純網域,不觸發任何 IP 正則 — 見 V3-5）
http://169.254.169.254.attacker.com/ -> 同上（純網域,同見 V3-5）
```

---

## 三、未查完部分(逾出本輪範圍,留給下一輪)

1. **Railway/實際反代拓樸下 `X-Forwarded-For` 是否真的可被客戶端偽造**(V3-3 的關鍵前提)——本輪只讀
   `app.set("trust proxy", 1)` 設定值,未取得 Railway 邊緣代理的實際轉發/覆寫行為證據,標記 PLAUSIBLE。
2. **fal.ai 自己對 `image_url`/`video_url` 輸入是否有下載期 SSRF 防護**(V3-6 的下游影響邊界)——本輪
   只確認 healing-studio 側零防護,未查證第三方服務側的實際防護水位。
3. **`xssInputGuard.test.ts` 的 `titleSchema` 對應到哪個真實 router 欄位**——只快速比對邏輯一致,未逐一
   找到其對應的正式定義位置(如果存在的話)並確認雙方是否真的同步。
4. **`oauthState.ts`/`googleAuth.ts` 的 AIDV-580 nonce 機制**——快速讀過判定設計完整(state nonce +
   `oauth_state` cookie + `timingSafeEqual`),但未像 V3-1/V3-2 那樣做逐行對抗式繞過嘗試(例如 cookie
   `SameSite`/`Secure`/`httpOnly` 屬性、nonce 有效期、多分頁併發 race),留待下一輪。
5. **`server/services/authz/resourceAccess.ts`/`resourceAccessResolver.ts`**(RBAC 核心)——本輪完全未讀,
   只在 P4 修復卡 5 的既有引用中間接提及;`canAccess`/`isDataRbacEnabled`/`ResourceType` 的實際邏輯與
   K1-3/K1-4 的旗標關聯需要獨立一輪深挖。
6. **`server/middleware/brainContext.ts`**(30916 bytes,本輪完全未讀,超出時間預算)、
   `server/middleware/verifyToken.ts`(3027 bytes,亦未讀)——目錄清單內僅有這兩個非測試檔,均未深入。
7. **`webhookTokens.ts` 的 nonce/token 是否有 replay 窗口**——`signFalWebhookNonce` 產生的 `(nonce, token)`
   對是否有 TTL/一次性使用強制(例如攻擊者截獲一組合法 nonce+token 後能否無限次重放到同一 webhook
   端點造成同一任務被反覆標記完成)——本輪只讀了簽章正確性,未追蹤接收端是否有 nonce 去重/一次性消費。
8. **`isProxyAllowed`/`STATIC_ALLOWED_HOSTS_RE` 萬用尾碼白名單**——K1-6/K1-7/P4 修復卡 3 已完整涵蓋,
   本輪未重新核對,直接沿用既有結論。
