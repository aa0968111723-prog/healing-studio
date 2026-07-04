# FL1 — 安全類旗標 default 稽核
- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 稽核範圍：ENABLE_AGENT_SCOPE_GUARD/DATA_RBAC/RATE_LIMIT/URL_ALLOWLIST/RAG_INJECTION_GUARD/GENERATION_LOCK/REFRESH_TOKEN_ROTATION/SIGNED_URL_UPLOAD/FAIL_CLOSED/TWO_FACTOR_NOT_ENABLED 等，讀 env.validated.ts + .env.production

## 方法論
- Default 值一律從「定義處」讀出：多數旗標在 `server/_core/env.validated.ts` 的 zod schema（`.default(...)`）；少數旗標（`ENABLE_RATE_LIMIT`、`ENABLE_URL_ALLOWLIST`、`ENABLE_REFRESH_TOKEN_ROTATION`）**不在 zod schema 內**，直接以 `process.env.X === "false"/"0"/"true"` 裸讀，default 由該 if 判斷式的「否定條件」推出。
- prod 值：`.env.production`（僅含 build-time `VITE_*` 旗標）、`.env.example`（範本，非實際 prod 值）、`railway.toml`（無 env 區塊）均已讀過。三者都**沒有**覆寫本清單的 server-side 安全旗標，唯一例外是 `MIGRATION_FAIL_CLOSED`：`AGENTS.md:22` 明文記載「`MIGRATION_FAIL_CLOSED=true` 已開」，代表此值是在 Railway 後台變數設定（repo 內不可見），與 schema default `false` 不同——本稽核如實揭露這個「schema default ≠ prod 實際值」的落差。其餘旗標 prod 值 = schema default（repo 內無證據顯示被覆寫，但 Railway 後台變數本身不在 repo 可視範圍，標記「需再查 Railway 才能 100% 排除覆寫」）。

---

## 旗標總表

| 旗標 | default | prod 值 | gate 什麼 | 安全/計費控制 | 狀態 | 疑慮 |
|---|---|---|---|---|---|---|
| `ENABLE_AGENT_SCOPE_GUARD` | **ON**（`"true"`，`env.validated.ts:585`） | ON（.env.production/.env.example/railway.toml 均未覆寫，= schema default） | `server/services/orbTaskStateMachine.ts:48-72` `checkStepScope`：FSM 每步啟動前依 `ROLE_SCOPES` 檢查 orb 代理人角色是否有權限做該 scope action（15 種 read/write/delete/publish）。**OFF 時退化為 log-only（不阻擋）**，且 task 缺 `agentRole` 時本身就 fail-open 只記 log。 | 是（代理人最小權限 enforcement） | active | fail-open 分兩層：旗標 OFF＝全放行；旗標 ON 但 task 缺 agentRole 也放行只記 log——後者是「ON 時仍可能被繞過」的隱性洞，需列入下一輪滲透測項。 |
| `ENABLE_DATA_RBAC` | **OFF**（`"false"`，`env.validated.ts:603`） | OFF（三處 prod 設定檔皆未覆寫） | `server/services/authz/resourceAccess.ts:158-162` `isDataRbacEnabled()`：OFF 時所有 router **完全不呼叫** `canAccess()`，`resource_shares` 表資料寫入已上線但無人消費；`assets.teamAssets`（`server/db.ts` `getTeamSharedAssetsFiltered`）在 OFF 時**無任何 userId/teamId 範圍限制**，全表回傳所有使用者的 `team_shared` 資源。`rbac.transferOwnership`（`server/routers/rbac.ts:231-254`）OFF 時直接回 FORBIDDEN。 | 是（跨租戶資料隔離） | active（但 enforcement 面几乎未上線） | **已知安全控制預設 OFF＝攻擊面**：`docs/research/K1-security-bugs.md:44` 判定為 CONFIRMED 跨租戶 IDOR——`team_shared` 資產/LoRA 權重外洩「沒有旗標可緩解」（K1 指出即使開 ENABLE_DATA_RBAC，`assets.teamAssets` 這條路徑的過濾邏輯本身也未接 canAccess，是結構性缺口非旗標問題）。命名與行為不符：「team_shared」使用者心智模型 = 限定團隊可見，實際 = 全站可見。 |
| `ENABLE_RATE_LIMIT` | **ON**（未在 zod schema；`server/_core/rateLimiter.ts:162,248,274` 與 `server/_core/trpcRateLimit.ts:124` 皆為 `if (process.env.ENABLE_RATE_LIMIT === "false") return/skip` —— 只有明確設 `"false"` 才關，其餘含未設＝ON） | ON（三處 prod 設定檔皆未見此變數） | express-rate-limit 五層 tier（auth/llm/api/upload/health，`rateLimiter.ts:48-79`）、光球 chat/feedback per-user 限流（`rateLimiter.ts:237-281`）、agent 呼叫每小時配額（`trpcRateLimit.ts:118-162`）。 | 是（防濫用/防暴力破解/防額度耗用） | active，**但覆蓋不完整** | `server/_core/trpcRateLimit.ts` 的通用 tRPC per-procedure 滑動視窗 `checkTrpcRateLimit()`（第 35-59 行）**不讀 `ENABLE_RATE_LIMIT`**，只在 `NODE_ENV==="test"` 時跳過——代表把 `ENABLE_RATE_LIMIT=false` 當「緊急關閉所有限流」使用時，這條路徑仍在擋，行為與旗標文件描述（「local dev 用旗標關閉限流」）不完全一致，屬於「旗標覆蓋範圍比命名暗示的窄」的文件落差，非安全缺口（多擋不是問題，但排查時容易誤判「已關閉」）。 |
| `ENABLE_URL_ALLOWLIST` | **ON**（未在 zod schema；`server/lib/urlValidator.ts:152` `if (process.env.ENABLE_URL_ALLOWLIST === "0") ...` fallback，其餘含未設＝ON 走完整 allowlist） | ON（三處 prod 設定檔皆未見此變數） | `isMediaUrlSafe()`／`assertSafeUrl()`：ON 時檢查 (1) HTTPS-only (2) **網域白名單**（`STATIC_ALLOWED_HOSTS_RE` 固定 fal.ai/fal.run/fal.media/GCS/R2/CloudFront/S3/Supabase/Azure Blob + `ALLOWED_MEDIA_DOMAINS` 環境變數擴充）(3) 私有/迴圈/metadata IP 字面阻擋。OFF（`="0"`）時**只剩 IP-only 阻擋，網域白名單完全跳過**（`isSafeExternalUrl()` fallback，`urlValidator.ts:152-154`）。 | 是（SSRF 防護，`safeMediaUrl`/`safeMediaUrlOptional` zod schema 供 tRPC 輸入使用） | active | **旗標 OFF＝SSRF 面全開的網域維度**（IP 維度仍擋）：任何 https 網域只要不是私有 IP 字面，皆可通過，攻擊者可用可解析為合法網域但代理到內網的服務繞過（DNS rebinding 在 OFF 模式下**沒有**白名單兜底，注解第 12 行明言「DNS rebinding 靠白名單擋」——OFF 時這道防線消失）。需與 `geminiMedia`/`internalMedia` 交叉核對：`internalMedia.ts` 呼叫端有 `redirect:'error'`（防白名單通過後又被重導向繞過），但這是**呼叫端**行為、與本旗標無關，OFF 時是否所有下載端都還有這層 `redirect:'error'` 兜底**需再查**（本輪未逐一走訪所有 fetch 呼叫點）。 |
| `ENABLE_RAG_INJECTION_GUARD` | **OFF**（`process.env.ENABLE_RAG_INJECTION_GUARD`，`ragInjectionGuard.ts:67-72`；未在 zod schema，同 `ENABLE_DIRECTOR_WORLD_CONTEXT` 型樣裸讀 process.env） | OFF（三處 prod 設定檔皆未見此變數）——**已知條目 X8，本輪確認** | `isRagInjectionGuardEnabled()` 為 true 時，四條真實 untrusted 記憶注入點（`routers.ts` buildMemoryContext、`orbLLMReplan.ts`、`orbTaskChainRunner.ts`/`routers.ts` 的 orb memory summary、`spiritPromptEnhancer.ts`）才會對取回內容做 sanitize＋截斷＋邊界標記包裹，防間接 prompt injection。OFF 時「注入內容與現狀位元相同」（`ragInjectionGuard.ts:48-49` 明文）。 | 是（間接 prompt injection 防護） | active（已接線但旗標關，等同尚未生效） | 屬「**安全控制預設 OFF**」清單：教材庫/歷史記憶若曾被污染（例如使用者過去對話中夾帶「忽略先前指令」樣式文字被存入記憶），OFF 時會原封不動回灌 LLM system prompt，無 sanitize/隔離。已有完整測試（`ragInjectionGuard.test.ts`、`ragGuardSidedoorWiring.test.ts`）驗證 ON/OFF 兩分支皆正確，非死代碼，只是尚未打開。 |
| `ENABLE_GENERATION_LOCK` | **ON**（`"true"`，`env.validated.ts:344`） | ON（三處 prod 設定檔皆未覆寫） | `server/_core/generationLock.ts:399-405`：生成請求提交前的「同一使用者重複併發提交」防重鎖（記憶體版，或 `REDIS_URL` 設定時升級 Redis 版）。OFF 時鎖完全跳過，行為等同「永遠放行」。 | **否**（schema 註解明文：「這是便利鎖，不是安全控制」；fail-open：鎖後端不可用/逾時一律放行生成，只記 warning） | active | 非安全類旗標，列入本次稽核僅因命名符合「GENERATION_LOCK」關鍵字；default ON 但語意上是防重複扣款/重複任務的便利機制，不是攻擊面。 |
| `ENABLE_REFRESH_TOKEN_ROTATION` | **OFF**（未在 zod schema；`server/_core/googleAuth.ts:126-128` `process.env.ENABLE_REFRESH_TOKEN_ROTATION === "true"`——只有精確字串 `"true"` 才 ON，其餘含未設＝OFF） | OFF（三處 prod 設定檔皆未見此變數；`docs/research/01-features.md:305`、`02-fullstack.md:184` 亦列為「預設 OFF 整塊功能」） | `server/routes/localAuth.ts:461-468`：`POST /api/auth/refresh` 端點——OFF 時直接回 403「Token rotation is not enabled」；ON 時才會查 `refresh_tokens` 表驗證現有 token → 撤銷 → 發新 token（`drizzle/0080_refresh_tokens.sql`）。`server/middleware/verifyToken.ts:42`、`server/_core/oauth.ts:337,440` 亦依此旗標決定是否走 rotation 分支。 | 是（session 安全：token 輪替降低長期 token 被竊風險） | active（旗標與端點皆已接線，OFF 時端點本身不是死路由，只是回 403，非「忘記接線」） | 屬「安全控制預設 OFF」清單之一：目前 30 天壽命的 JWT（`JWT_ACCESS_TOKEN_EXPIRES_IN` 預設 2592000 秒）**沒有** refresh rotation 兜底，同一 token 洩漏後在有效期內都可被重放，直到自然過期。 |
| `ENABLE_SIGNED_URL_UPLOAD` | **ON**（`"true"`，`env.validated.ts:658`） | ON（三處 prod 設定檔皆未覆寫） | `server/signedUpload.ts:52-56`：ON 時大檔上傳走「presign → 直傳 R2 → finalize 落庫」三段式，位元組不進 Node 記憶體。presign 端點 auth-gated、key 依 userId 命名空間隔離、限 content-type/size、5 分鐘短效期。OFF 或 presign 不可用（無 R2 env/demo/getDb 為 null）時自動回退舊 base64 `/api/upload` 路徑。 | 是（新路徑本身即安全設計：短效期+scope 隔離；但也是可用性/效能優化，非單純安全門） | active | 非「安全控制預設 OFF」類——default 是較安全/高效的新路徑；OFF 時退回的舊 base64 路徑本身仍是既有已上線行為，非新增攻擊面。 |
| `CONTENT_SAFETY_FAIL_CLOSED` | **ON = fail-closed**（`"true"`，`env.validated.ts:404`） | ON（.env.production/.env.example 均未覆寫） | `server/services/security/contentModeration.ts:77-83` `checkSafety()`：逾時/錯誤/無法解析時**擋下**內容（`{safe:false}`）。需明確設 `"false"/"0"/"off"/"no"` 才回退 fail-open。 | 是（內容審核安全門，safety > availability 的刻意取捨） | active | 与一般旗標「default OFF」方向相反——這是**唯一一組刻意 default fail-closed 的安全控制**，需與其餘「default OFF」的安全控制對照著看：內容審核比 RAG injection guard／RBAC enforcement 更早被判定為高風險而預設收緊。 |
| `MIGRATION_FAIL_CLOSED` | **OFF = fail-open**（`"false"`，`env.validated.ts:386`） | **ON**（`AGENTS.md:22`：「`MIGRATION_FAIL_CLOSED=true` 已開」——Railway 後台變數覆寫，repo 內任何 `.env.*`/`railway.toml` 皆看不到這個值，需以 AGENTS.md 記載為準；**schema default 與 prod 實際值不同，是本次稽核發現的唯一一組「代碼看到的 default」≠「文件記載的 prod 實際值」**） | `server/db.ts:215,256,266` + `server/_core/index.ts:459-466`：ON 時 migration 真實 apply 失敗會 throw 到 bootstrap fatal handler，`process.exit(1)` 擋啟動，觸發 Railway healthcheck 失敗→自動重啟/回滾。OFF（schema default）只記錯誤照常開機。 | 是（資料庫一致性 fail-closed 開機門） | active，**且 prod 實際已強化為 fail-closed**（優於 schema default） | 這條是「default OFF 但 prod 已手動調緊」的正面案例，與其他「default OFF 且 prod 也沒調」的安全缺口相反；稽核時仍應核對 Railway 後台實際變數（本輪僅能以 AGENTS.md 文件記載佐證，非直接讀 Railway API，故標「需再查 Railway 控制台核實現行變數」以求 100% 確定）。 |
| `STRIPE_WEBHOOK_FAIL_CLOSED` | **留空 `""` = 依環境分流**（`env.validated.ts:440`） | 留空（.env.production/.env.example 皆為空） | `server/routes/stripeWebhook.ts:48-55`：只管「`STRIPE_WEBHOOK_SECRET` 密鑰留空」這個情境（密鑰有設時簽章不符一律拒絕，與此旗標無關）。留空/未設（預設）→ **只有 `NODE_ENV==="production"` 才 fail-closed（503 拒絕）**，dev/test 放行骨架方便本機開發。明確 `"false"` → 一律 fail-open（連 prod 也放行，緊急回退）；明確 `"true"` → 一律 fail-closed（連 dev 也拒絕）。 | 是（金流 webhook 偽造防護，計費控制） | active | 語意分層需注意：這不是單純 ON/OFF，是「三態」（留空=依 NODE_ENV、true=強制關、false=強制開）；若有人在 prod 誤設 `STRIPE_WEBHOOK_FAIL_CLOSED=false`，會讓「未設 STRIPE_WEBHOOK_SECRET」情境下的 webhook 直接放行未驗證請求——目前 prod 是留空（安全），但這是一個容易誤設的三態旗標，建議稽核時特別留意 Railway 後台是否被人手動改過。 |
| `FAL_WEBHOOK_FAIL_CLOSED` | **ON = fail-closed**（`"true"`，`env.validated.ts:490`） | ON（三處 prod 設定檔皆未覆寫）——**已知條目 W7，本輪確認** | `server/routes/webhookFal.ts:35-39`：**單一旗標同時 gate 兩層**——① per-job capability token 強制驗證（缺/錯 token 一律拒絕，防偽造回呼把別人的 job 標記完成）；② `FAL_WEBHOOK_SECRET` 未設時的簽章驗證行為（fail-closed 拒絕 vs 舊 fail-open 放行）。關閉（明確 `"false"`）會**同時**放寬這兩層，不是各自獨立開關。 | 是（webhook 偽造/篡改防護） | active | 「一旗標控雙層」的耦合設計：若未來只想暫時放寬其中一層（例如放寬 token 驗證但保留簽章 fail-closed），目前的旗標粒度做不到，回退時是「全開或全關」，需注意誤用範圍比預期大。 |

---

## 語意陷阱：`TWO_FACTOR_NOT_ENABLED`

**這不是一個環境變數/功能旗標**，而是一個**使用者狀態錯誤碼**（`Error` message 常數）：

- 定義處：`server/services/auth/AuthFacade.ts:252-258`（`disableTwoFactor()`）——當使用者呼叫「停用 2FA」但該使用者尚未啟用 2FA（`!user?.twoFactorEnabled || !user.twoFactorSecret`）時 `throw new Error("TWO_FACTOR_NOT_ENABLED")`。
- 消費處：`server/routes/localAuth.ts:452-455`（`POST /api/auth/2fa/disable`）捕捉此字串 → 回 400 `"2FA is not enabled"`。
- 全庫唯一相關字面出現在 `AuthFacade.ts:258`、`localAuth.ts:452`、`auth-facade.test.ts:385`（測試斷言）——**沒有任何 `process.env.TWO_FACTOR_NOT_ENABLED` 讀取點**，grep 全庫確認它從未作為環境變數出現。

**陷阱所在**：命名格式（全大寫+底線）與本清單其他 `ENABLE_*`/`*_FAIL_CLOSED` 旗標高度相似，容易被誤判為「某個全域 2FA 開關被設為 OFF」。實際上它是**逐使用者**的執行期狀態判斷（該帳號的 `twoFactorEnabled` 欄位），與任何全站 env 旗標無關；不存在「把 2FA 全站關閉」的 kill-switch，2FA 本身一直可用（`server/repositories/mysql/UserAuthRepository.mysql.ts`、`drizzle/0020_user_two_factor.sql`），只是「這個特定使用者尚未設定」的錯誤回饋。稽核時若只看變數名清單容易誤列為「TWO_FACTOR default OFF」的安全缺口，實際上完全不成立。

---

## 已知條目確認（依任務要求逐一核實）

| 條目 | 核實結果 | 證據 |
|---|---|---|
| `ENABLE_RAG_INJECTION_GUARD` 預設 OFF | ✅ 確認 | `server/services/security/ragInjectionGuard.ts:67-72`，`env.validated.ts` 內**未見**此鍵（裸讀 process.env，同 `ENABLE_DIRECTOR_WORLD_CONTEXT` 型樣） |
| `ENABLE_COST_LEDGER` 預設 OFF | ✅ 確認 | `server/_core/env.validated.ts:679` `z.string().optional().default("false")`；`.env.production` 亦有相同顯式行 `ENABLE_COST_LEDGER=false`（`.env.example:304`） |
| orb quota guard 只管聊天層 | ✅ 確認 | `server/_core/env.validated.ts:572` `ENABLE_ORB_QUOTA_GUARD` default `"false"`；唯一讀取點 `server/routers/ai.ts:996`（`ai.chat` 路由），未見於 `director.chat`/其他生成路由的讀取點 |
| `FAL_WEBHOOK_FAIL_CLOSED` 單旗標控雙層 | ✅ 確認 | `server/routes/webhookFal.ts:35-39`：token 強制驗證 + 簽章 fail-closed 兩件事同一 `raw` 值判斷，見上表 |
| `ENABLE_PROJECT_HUB` prod OFF | ✅ 確認 | `client/src/config/videoFlags.ts:67` `readFlag("VITE_ENABLE_PROJECT_HUB", false)`；`.env.production` 未出現此鍵 → 沿用 default `false` |
| `ENABLE_4SHELL` prod ON | ✅ 確認 | `.env.production:21` 顯式 `VITE_ENABLE_4SHELL=1`（`.env.example:325` 範本值則是 `0`，兩者刻意不同——prod 已切換新介面） |

---

## 總結：預設 OFF 的安全/計費控制（攻擊面清單）

1. **`ENABLE_DATA_RBAC`**（OFF）— 跨租戶資料隔離未 enforce，`assets.teamAssets` 已被判定 CONFIRMED IDOR。
2. **`ENABLE_RAG_INJECTION_GUARD`**（OFF）— 四條真實 untrusted 記憶注入點無 sanitize，間接 prompt injection 防線未啟用（已知條目，本轮确认）。
3. **`ENABLE_REFRESH_TOKEN_ROTATION`**（OFF）— 30 天 JWT 無 rotation 兜底，token 洩漏可被重放至自然過期。
4. **`ENABLE_ORB_QUOTA_GUARD`**（OFF，已知條目 GC2）— 且 ON 時也只管 `ai.chat` 一層，其餘生成路由不受影響。

相對地，`ENABLE_AGENT_SCOPE_GUARD`、`ENABLE_GENERATION_LOCK`、`ENABLE_SIGNED_URL_UPLOAD`、`CONTENT_SAFETY_FAIL_CLOSED`、`FAL_WEBHOOK_FAIL_CLOSED` 皆預設 ON/fail-closed；`MIGRATION_FAIL_CLOSED` 雖 schema default OFF，但 prod 已由 Railway 後台手動調為 ON（`AGENTS.md` 記載，非 repo 內可見）。`ENABLE_URL_ALLOWLIST`／`ENABLE_RATE_LIMIT` 两者虽预设 ON 且 prod 未见覆寫，但前者 OFF 時網域白名單維度會全開（IP 維度仍擋）、後者 OFF 時仍有一條 `checkTrpcRateLimit()` 路徑不受旗標控制——兩者都是「旗標覆蓋範圍比命名暗示窄」的落差，需在文件/告警訊息中更精確描述，避免维运人员誤判「已完全关闭」。
