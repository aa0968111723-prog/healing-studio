# T2 — 安全修復 PR 級實作 Playbook(wave T)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 標記:**實作 playbook wave T**
- 承接:`docs/research/P4-security-fixes.md`(修復卡 1-7,已逐一確認修點 path:line)、`docs/research/K1-security-bugs.md`(K1-1~K1-8)、`docs/research/K3-data-integrity.md`(§1.1/1.2/1.3)、`docs/research/00-summary.md` §6.1(R2-R8)
- 方法:單一代理實讀程式碼(**未 spawn 子代理**),把 P4 的 7 張修復卡重新編排成 **3 個可獨立合併的 PR**。本文件只研究/規劃,未動任何 `server/`、`client/`、`drizzle/` 原始碼。
- 產出物只有本篇研究文件。

---

## 0. 總覽:為何切成 3 個 PR,而不是 7 個小 PR 或 1 個大 PR

| PR | 涵蓋修復卡 | 涵蓋 R 編號 | 核心風險類型 | 工作量 | 是否需真實 DB |
|---|---|---|---|---|---|
| **PR-A** | 修復卡 1、2、3 | R4、R5、R6*(proxy-download) | SSRF(補 `redirect:"error"` + 網域白名單收斂) | S+S+M ≈ 2–3 天 | 否 |
| **PR-B** | 修復卡 4、5、6 | R6*(跨 studio owner check)、R7、R8 | 授權/IDOR/同意書繞過 | S+M+M ≈ 2.5–3.5 天 | 否(建議 staging 手動驗證) |
| **PR-C** | 修復卡 7 | R2、R3 | GDPR 刪帳資料完整性 + 電路斷路器 | L ≈ 2–3 天 | 是(docker-compose 真實 MySQL) |

> **命名提醒(承接自 P4 文件本身的標記不一致)**:`00-summary.md` §6.1 的 R6 只對應「跨 studio 竊取生成資產」(修復卡 4);但 P4 文件的修復卡 3(`proxy-download`/`safeMediaUrl` 萬用尾碼)在文中也標了「R6」。這是原始研究文件的編號重疊,不是本 playbook 新引入的錯誤。為避免混淆,下文一律以「**修復卡 N**」為準,R 編號僅作交叉參照,兩處「R6」用 `R6*(proxy-download)` 與 `R6*(owner check)` 區分。

**切法理由**:
1. **PR-A(SSRF 批次)**:三張卡的修法 pattern 完全同構——「補 `redirect:"error"`」+「同步驗證換成 async DNS-rebinding 版」+「網域白名單從尾碼比對收斂為精確比對」。同一位 reviewer 可一次看完,不必分三次 context-switch。彼此無耦合,合併順序內部不重要。
2. **PR-B(授權/IDOR 批次)**:三張卡都是「後端授權檢查補洞」,且修復卡 4 與修復卡 6 都可以獨立於修復卡 5 提前完成(修復卡 5 需要先查證 `toggleVisibility` 的 `teamId` 賦值邏輯,風險最高、耗時最長)。放在同一 PR 便於一次做「授權模型」的整體 code review,但**允許拆成 3 個 commit 依序 cherry-pick**,見 §4 的分階段合併建議。
3. **PR-C(GDPR 刪帳)獨立成一個 PR**:資料結構重構(`USER_OWNED_TABLES` 從 `string[]` 換成 `{table,column}[]`)牽動的檔案面最廣、需要真實 DB 驗證、且守門測試本身是新基礎設施,審查者需要的心智模型與 PR-A/PR-B(單純輸入驗證/授權判斷)完全不同。混在一起會拖慢前兩者的合併速度,而 PR-A/PR-B 修的是「可被外部觸發利用」的漏洞,合併速度本身就是風險緩解手段之一,不應被 PR-C 的複雜度拖住。

**依賴關係**:三個 PR 彼此無程式碼依賴,可平行開發、平行審查、任意順序合併。**唯一建議的執行順序**(沿用 P4 文件「修復順序建議」,非強制依賴):
```
修復卡4(獨立 micro-fix,可提前於 PR-B 完成前單獨合併)
   → PR-A(R4+R5+R6*proxy-download)
   → PR-C 的 (a) 電路斷路器修法(可從 PR-C 拆出，獨立先合)
   → PR-B 其餘(R8 → R6*owner-check 已提前 → R7 殿後)
   → PR-C 其餘 (b)(c)(USER_OWNED_TABLES 重構 + 守門測試)
```

---

## 1. PR-A — SSRF 批次(修復卡 1、2、3 / R4、R5、R6*proxy-download)

### 目標
統一收斂全站對外部 URL 的 fetch 行為:(1) 所有下游 `fetch` 一律帶 `redirect:"error"`,(2) 所有「網域白名單」檢查換成 DNS-rebinding 安全的 async 版本(`assertSafeExternalUrlAsync`),(3) 多租戶公有雲網域(`amazonaws.com`/`r2.cloudflarestorage.com`/`cloudfront.net`/`supabase.co`/`blob.core.windows.net`/`r2.dev`)不再用 `endsWith` 萬用尾碼比對,改成鎖定本站實際使用的 bucket origin 精確比對。

### 逐檔改動

| 檔案 | 行號 | 改動內容 |
|---|---|---|
| `server/routers/generate.ts` | 361-367 | `multimodal` input schema 的 `styleReferenceUrl`/`vibeReferenceUrl`/`firstFrameUrl`/`lastFrameUrl`/`characterRefUrl` 五欄,型別從 `z.string().nullable().optional()` 換成 `server/lib/urlValidator.ts` 的 `safeMediaUrlOptional`(:173,已存在)|
| `server/routers/generate.ts` | 1571-1577 | `submitMultimodalAsync` 的第二份重複 schema,同樣五欄同樣換法。**建議**:抽成共用 schema fragment(例如 `const multimodalRefUrlFields = {...}`)供兩處 import,消除 K1-8 指出的「雙份定義漂移」根因 |
| `server/services/geminiMedia.ts` | 433-437 | `fetch` 補 `redirect: "error"`;比照 `server/services/internalMedia.ts:65-68` 寫法。需 catch redirect 被擋的錯誤並轉成可讀訊息(如「圖片來源重新導向被拒絕」) |
| `server/services/geminiMedia.ts` | 421-448 附近 | `assertSafeExternalUrl`(同步版,`server/_core/ssrfGuard.ts:63`)換成 `assertSafeExternalUrlAsync`(:117,已存在) |
| `server/services/elevenLabsExtended.ts` | 390(`cloneVoice`)、425(`createDubbing`)、479(`transcribe`) | 三處 `fetch` 補 `redirect:"error"` + `signal: AbortSignal.timeout(...)`(目前無 timeout) |
| `server/services/elevenLabsExtended.ts` | 同上三處 | `assertSafeUrl`(同步版,`server/lib/urlValidator.ts:68`)換成 `assertSafeExternalUrlAsync` |
| `server/routers/teachingArchive.ts` | 65-68 | `fileUrl` zod 驗證從裸 `.refine(u => /^https?:\/\//i.test(u))` 換成 `safeMediaUrl`(`urlValidator.ts:165`,已存在),強制網域白名單而非只驗 protocol |
| `server/_core/index.ts` | 325-351 | `PROXY_ALLOWED_HOSTS`/`isProxyAllowed()`:拆成「精確白名單(本站 bucket + 已知供應商固定網域)」與「多租戶公有雲網域」兩組;後者不再用 `endsWith` 尾碼放行,改用 `ssrfGuard.ts:175` 的 `isExactOriginAllowed()` 鎖到 `S3_PUBLIC_URL`/`S3_PUBLIC_DOMAIN`(`server/_core/env.validated.ts:317-318`)實際值 |
| `server/_core/index.ts` | 813 | `fetch` 補 `redirect:"error"` |
| `server/lib/urlValidator.ts` | 26-40 | `STATIC_ALLOWED_HOSTS_RE`/`isAllowedHost()` 比照上一項拆分,供應商固定網域(`fal.media`/`cdn.fal.ai`/`replicate.delivery`/`elevenlabs.io`/`suno.ai`)保留尾碶比對(風險相對低,單一廠商網域);多租戶公有雲網域改精確比對 |

### migration
**無需 schema migration**。本 PR 純屬程式碼層級的輸入驗證與 fetch 選項變更,不動 `drizzle/schema.ts`、不新增表/欄位。

### 測試

**單元測試**:
- `generate.ts`/`teachingArchive.ts` schema:傳入 `http://169.254.169.254/...`、私網 IP(`10.x`/`192.168.x`/`127.0.0.1`)、非白名單網域 → 斷言 zod 400。
- `isProxyAllowed()`/`isAllowedHost()`:攻擊者自建的 `<random>.s3.amazonaws.com` bucket URL → 斷言 false;本站 `S3_PUBLIC_URL` 對應的 bucket URL → 斷言 true。

**SSRF 專項測試(mock fetch server)**:
- mock 一個先回 200、緊接著對第二次請求回 302 到 `169.254.169.254` 的 fetch server,分別餵給 `geminiMedia.generateVideo`、`elevenLabsExtended.cloneVoice/createDubbing/transcribe` → 斷言全部拋出「重新導向被拒絕」錯誤,而非把回應內容當媒體編碼進下游請求。
- `/api/proxy-download` 整合測試:非本站 bucket URL → 403;本站 bucket URL → 200。

**迴歸測試**:
- 白名單網域(`fal.media`/`r2.dev`/本站 bucket)的正常 `firstFrameUrl`/`fileUrl` 仍可通過並成功送出。
- 既有教學檔案(storage 網域)上傳→轉錄流程不受影響。
- 既有 fal/replicate/elevenlabs 供應商媒體 URL 下載流程不受影響。

### 驗收標準
1. 三個修復點(generate.ts、elevenLabsExtended.ts、proxy-download/urlValidator.ts)的 `fetch` 呼叫全部帶 `redirect:"error"`,CI 有對應 mock 302 測試把關,防止未來新增 fetch 呼叫點又漏掉(可加一支 grep-based lint 測試:掃描 `server/` 內所有 `fetch(` 呼叫,若同檔案內存在對應的「已知安全」註解白名單以外的呼叫且無 `redirect:` 選項,即失敗——工作量另計,非本 PR 必要項)。
2. 兩處 `multimodal`/`submitMultimodalAsync` schema 的五個 URL 欄位改用同一個共用 fragment,消除雙份定義。
3. staging 環境用真實流量驗證 SSRF 修法不誤擋任何現有 CDN/供應商網域(尤其 proxy-download 的精確比對,需先盤點 `S3_PUBLIC_URL`/`S3_PUBLIC_DOMAIN` 在各環境的實際值)。

### 風險回滾
- **風險本身低**:純屬「收緊驗證」,不改變資料形狀或業務邏輯,幾乎不可能造成資料損毀。唯一風險是**誤擋合法流量**——尤其 proxy-download 從萬用尾碼改精確比對後,若 staging 盤點漏掉某個實際在用的 bucket host,會導致該類型媒體下載 403。
- **回滾方式**:此 PR 每個檔案的改動都是獨立、可逐檔 revert 的(不像 PR-C 有資料結構重構的不可逆性)。若上線後發現某網域被誤擋,可先透過 env 變數(`S3_PUBLIC_URL`/`S3_PUBLIC_DOMAIN`)快速修正而不必回滾整個 PR;若問題出在 `redirect:"error"` 本身誤判正常的合法跳轉(例如供應商 CDN 內部確實會 302 一次到簽章 URL),需要個案排查該供應商是否本來就該用 `redirect:"follow"` 但額外套 `assertSafeExternalUrlAsync` 在最終目標上。
- **建議先在 staging 用真實流量驗證**(P4 文件已提示),尤其修復卡 3 的網域盤點步驟不能省略。

### 工作量
S(0.5-1 天)+ S(0.5 天)+ M(1-1.5 天,含盤點 bucket host)= **合計約 2-3 天**。

### 可否與功能並行
**可,且應該是三個 PR 中最先合併的**。純輸入驗證/fetch 選項變更,不影響任何現有功能的正常使用者路徑,是與功能開發並行風險最低的一批。**P0 立即**:三張卡都是 CONFIRMED 可觸發的內網探測漏洞(K1-1/K1-2/K1-6/K1-7),應優先排上下一個 sprint。

---

## 2. PR-B — 授權/IDOR 批次(修復卡 4、5、6 / R6*owner-check、R7、R8)

### 目標
補齊三類授權缺口:(1) `imageStudio`/`proStudio` 輪詢端點的 owner 檢查,對齊 `videoStudio` 已有的修法;(2) `models.teamModels`/`getById`/`getAnalysis` 的真團隊成員檢查(不再是「visibility=team_shared 即放行任何登入者」);(3) 移除 forge 分頁繞過肖像權同意書的入口,並讓後端 `subjectType` 改為必填(fail-closed)。

### 逐檔改動

#### 2.1 修復卡 4(R6*owner-check,跨 studio 竊取生成資產)—— **建議獨立 micro-PR 提前合併**

| 檔案 | 行號 | 改動內容 |
|---|---|---|
| `server/routers/imageStudio.ts` | 1419-1480(`checkImageStatus`) | 在 `falQueueStatus` 呼叫之前,逐字複製 `videoStudio.ts:1679-1685` 的檢查:`const existingJob = await db.getBackgroundJobByRequestId(input.requestId); if (existingJob && existingJob.userId !== ctx.user.id) throw new TRPCError({code:"FORBIDDEN", ...})` |
| `server/routers/proStudio.ts` | 1688-1730(`checkAudioStatus`) | 同上 |
| 對照組(不改,僅參考) | `server/routers/videoStudio.ts:1679-1685` | 已修好的範本 |
| 對照組(不改,僅參考) | `server/db.ts:2246`(`getBackgroundJobByRequestId`) | 可直接複用,無需新函式 |

**設計取捨**(與 videoStudio 一致):查無 `backgroundJobs` 記錄時放行(某些工作室的 `requestId` 是隨機 UUID,枚舉風險低),維持三處行為一致,不引入新的不一致。

#### 2.2 修復卡 5(R7,models.teamModels RBAC)

| 檔案 | 行號 | 改動內容 |
|---|---|---|
| `server/services/authz/resourceAccess.ts` | 37(`ResourceType`) | 加入 `"model"` 型別 |
| `server/routers/models.ts` | 20-22(`teamModels`) | 比照 `assets.ts:122-161`:先撈 `team_shared` 全集,再用 `db.listTeamIdsForUser(ctx.user.id)` + `canAccess()` 過濾,只留使用者真正所屬團隊的模型 |
| `server/routers/models.ts` | 24-38(`getById`)、41-55(`getAnalysis`) | 補「若 `team_shared` 則必須真的同團隊」判斷(見下方程式碼片段) |
| `server/db.ts` | 1016-1024(`getTeamSharedModels`) | 視 2.2 的過濾實作方式,決定是否需要在 DB 層加 teamId 篩選,或維持全撈交給 router 層 `canAccess()` 過濾(比照 `assets.ts` 模式,後者較不需動 DB 層) |
| **需先查證(合併前必做)** | `models.ts` 的 `toggleVisibility` mutation | 確認設為 `team_shared` 時是否同步要求/寫入 `teamId`。若目前只改 `visibility` 不寫 `teamId`,必須同時補上「設為 `team_shared` 必須指定 `teamId` 且使用者屬於該團隊」的檢查,否則所有既有 `team_shared` 模型的 `teamId` 恆為 `null` |

`getById`/`getAnalysis` 補的判斷:
```ts
if (model.userId !== ctx.user.id) {
  if (model.visibility !== "team_shared") throw FORBIDDEN;
  const memberTeamIds = await db.listTeamIdsForUser(ctx.user.id);
  if (model.teamId == null || !memberTeamIds.includes(model.teamId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
  }
}
```

**關鍵設計差異(明確不用 `ENABLE_DATA_RBAC`)**:`assets.ts` 的過濾是「旗標 ON 才生效,OFF 保持現狀外洩」,但 R7 沒有這種退路(結構性缺口),且 LoRA 權重比一般資產更敏感——**此處過濾預設無條件啟用,不掛 `isDataRbacEnabled()` 開關**。若仍想要旗標保護以防回歸風險,應該用**新旗標且預設值為 `"true"`**(例如 `ENABLE_MODEL_TEAM_FILTER`,default `"true"`),而非沿用預設 OFF 的 `ENABLE_DATA_RBAC`——沿用會重蹈「旗標 OFF 就繼續洩」的覆轍。

#### 2.3 修復卡 6(R8,forge 分頁繞過同意書)

| 檔案 | 行號 | 改動內容 |
|---|---|---|
| `client/src/pages/ModelsPage.tsx` | 710-752(forge 路徑 `handleStartTraining`) | 移除整段舊實作死碼 |
| `client/src/pages/ModelsPage.tsx` | 784(PageAgent capability)、502-511(`pageTab` state) | 移除 forge 分頁入口與相關 state/capability |
| `server/routers/models.ts` | 324-337(`subjectType` 判斷) | `:326` 的 `subjectType` 拿掉 `.default("synthetic")`,改為必填欄位,省略時 zod 400(fail-closed 取代 fail-open) |

### migration
**無需 schema migration**。修復卡 4、6 純屬程式碼邏輯;修復卡 5 若確認 `toggleVisibility` 需要補寫 `teamId`,那是「應用邏輯補強」而非 schema 變更(`fine_tuned_models.teamId` 欄位本身已存在,`drizzle/schema.ts:466`)。**若查證發現既有 `team_shared` 模型大量 `teamId=null`**,需要一次性資料回填腳本(非 drizzle migration,是一次性 SQL script,例如手動指派給模型擁有者當前所屬的第一個團隊,或標記為「待使用者手動重新分享」)——這屬於**資料清理腳本**,建議寫成獨立的一次性維運腳本(`scripts/` 或臨時 SQL),不進 `drizzle/migrations/`。

### 測試

**RBAC 差集守門(修復卡 5)**:
- 單元:A 團隊模型 `team_shared`,B(非 A 團隊成員)呼叫 `teamModels`/`getById`/`getAnalysis` → 斷言看不到/FORBIDDEN。
- 單元:A 團隊成員 C 呼叫 → 斷言可見。
- 迴歸:本人自己的模型(private 或 team_shared)一定可見。
- 若補了 `toggleVisibility` 的 `teamId` 檢查:使用者不在任何團隊卻嘗試設 `team_shared` → 斷言擋下並給清楚錯誤訊息。
- **上線前手動驗證(不可省略)**:對 staging/prod 資料庫跑一次「修復前 vs 修復後,現有 `team_shared` 模型清單是否有任何一筆從『可見』變成『不可見』」的差集比對查詢,確認沒有預期外的回歸。

**owner check(修復卡 4)**:
- 單元:模擬 `backgroundJobs` 有 `userId=A` 的記錄,`userId=B` 呼叫 `checkImageStatus`/`checkAudioStatus` 帶同一 `requestId` → 斷言 FORBIDDEN。
- 迴歸:`userId=A` 自己呼叫 → 正常完成流程不受影響。
- 迴歸:`requestId` 查無記錄 → 仍可正常輪詢完成(不誤擋)。

**forge 移除(修復卡 6)**:
- 路徑1(移除 forge):驗證 PageAgent 呼叫 `setTab("forge")` 後應安全 no-op 或退回 trainer,不應該讓前端拋錯崩潰。
- 路徑2(後端 fail-closed):`models.create` 不帶 `subjectType` → 斷言 400。
- 迴歸:`LoraTrainer` 正常流程(帶完整 `subjectType`/`consentIds`)不受影響。
- **需同步檢查**是否有其他呼叫端(例如測試 fixture、內部腳本)依賴省略 `subjectType` 的舊行為,若有需一併更新。

### 驗收標準
1. 修復卡 4:三處(image/audio/video)owner check 行為完全一致,且都有對應單元測試。
2. 修復卡 5:B 使用者無法透過任何一個 procedure(`teamModels`/`getById`/`getAnalysis`)讀到非本團隊的 `team_shared` 模型;**且**手動差集比對確認無現有可見模型變成不可見。
3. 修復卡 6:forge 分頁死碼完全移除,PageAgent 呼叫舊 capability 不崩潰;`models.create` 無 `subjectType` 一律 400。

### 風險回滾(重點:修復卡 5 的「修完 team_shared 集體不可見」回歸風險)

這是本 PR 唯一有實質回歸風險的部分,需要特別設計回滾路徑:

1. **上線前**:先用只讀查詢核對現有 `fine_tuned_models` 中 `visibility='team_shared'` 的列,`teamId` 是否為 `null` 的比例。若比例顯著(非 0),代表 `toggleVisibility` 目前確實只改 `visibility` 不寫 `teamId`,修復後這些模型會**集體對所有非本人使用者不可見**(不是資料遺失,是可見性倒退)。
2. **緩解方案 A(建議)**:採用「新旗標且預設值為 ON」的設計(`ENABLE_MODEL_TEAM_FILTER`,default `"true"`)——雖然 P4 文件建議無條件啟用,但從**上線風險控管**角度,帶一個預設 ON 的旗標可以在發現大量誤傷時**用一行 env 變數立即關閉**,不需要 revert 程式碼或重新部署。這比「無條件啟用、無退路」更符合漸進上線原則,且不會重蹈 K1-3 那種「預設 OFF 繼續洩」的錯誤(因為預設是 ON,不是 OFF)。
3. **緩解方案 B**:若查證發現 `teamId` 大量為 `null`,合併此 PR 前先跑一次性回填腳本,把既有 `team_shared` 模型的 `teamId` 補上(依模型擁有者當前所屬的團隊;若擁有者不屬於任何團隊,建議連同這批模型一起改回 `private` 並通知使用者,而非留著孤兒的 `team_shared` 狀態)。
4. **回滾判斷依據**:上線後監控「`teamModels`/`getById` 回傳筆數」相較修復前的下降幅度。若某團隊回報「原本看得到的共享模型突然消失」,先用旗標關閉止血,再回頭排查該模型的 `teamId` 賦值鏈路,不必整個 revert PR-B(其餘兩張卡不受影響)。
5. **修復卡 4、6 的回滾**:風險低,標準 revert 即可——4 是純複製既有已驗證 pattern,6 的前端移除若造成非預期影響,revert 該檔案改動即可(不涉資料)。

### 工作量
S(0.5 天,修復卡 4)+ M(1-2 天,修復卡 5,含查證 `toggleVisibility`)+ M(約 1 天,修復卡 6 兩路徑合計)= **合計約 2.5-3.5 天**。

### 可否與功能並行
- **修復卡 4**:可,且**P0 立即**——已有 videoStudio 現成對照實作可抄,風險/工作量比最高,建議**提前於整個 PR-B 之外單獨開一個 micro-PR 先合併**,不必等修復卡 5 的查證完成。
- **修復卡 6**:可,且**P0 立即**(合規/法遵風險最高,真人肖像權同意書繞過屬於法律風險而非單純技術債)。清理成本最低,建議與修復卡 4 同批次早做。
- **修復卡 5**:可,但**建議獨立分支開發 + 先跑一次「修復前後,現有 `team_shared` 模型是否還看得見」的手動驗證**,不與功能開發搶同一批人力,因為查證 `toggleVisibility` 的時間不可預估(可能牽出更多資料清理需求)。

---

## 3. PR-C — GDPR 刪除帳號修復(修復卡 7 / R2、R3)—— 獨立最複雜 PR

### 目標
三件事同時修復:(a) 電路斷路器不再被非 transient 的 SQL 錯誤誤觸;(b) `USER_OWNED_TABLES` 從「純表名字串陣列 + 假設全部叫 `userId`」重構成 `{table, column}` pair,移除 10 張無 `userId` 欄的表、補上 10 張漏掉的表(含 3 張 `snake_case user_id` 命名);(c) `deleteAccount` 呼叫端補 try/catch。

### 逐檔改動

#### 3.1(a)電路斷路器不誤觸——**建議從 PR-C 拆出獨立先合併**

| 檔案 | 行號 | 改動內容 |
|---|---|---|
| `server/_core/DatabaseManager.ts` | 289-298(`query()` catch) | 只在 `isTransientError(err)` 為真時才呼叫 `this.recordFailure(err)`;非 transient 錯誤(如 `ER_BAD_FIELD_ERROR`)只 log + `handleSqlError` 拋出,不計入 `consecutiveFailures` |
| `server/_core/DatabaseManager.ts` | 334-343(`execute()` catch) | 同上 |
| `server/_core/DatabaseManager.ts` | 366-378(`executeTransaction()` catch) | 同上——注意目前 :371 已經算出 `isTransientError(err)` 只用於 log,:374 的 `recordFailure(err)` 呼叫完全沒用到這個判斷,是本卡最直接的一行修法:`if (isTransientError(err)) this.recordFailure(err);` |
| `server/_core/DatabaseManager.ts` | 43-55(`TRANSIENT_ERROR_CODES`/`isTransientError`) | 既有工具函式,不需新增,只需在三處 catch 實際呼叫 |

#### 3.2(b)USER_OWNED_TABLES 重構(核心)

| 檔案 | 行號 | 改動內容 |
|---|---|---|
| `server/db.ts` | 5300-5370(`USER_OWNED_TABLES` 陣列本體,目前 70 個純字串) | 改型別為 `Array<{ table: string; column: string }>`,見下方完整重構規格 |
| `server/db.ts` | 5386-5388(刪除迴圈) | `for (const table of USER_OWNED_TABLES) { await conn.execute(\`DELETE FROM \\\`${table}\\\` WHERE userId = ?\`, [userId]); }` 改成 `for (const t of USER_OWNED_TABLES) { await conn.execute(\`DELETE FROM \\\`${t.table}\\\` WHERE \\\`${t.column}\\\` = ?\`, [userId]); }` |
| `server/db.ts` | 5379-5395(`deleteUserAccount` 函式) | 在通用迴圈之外,額外顯式加入 `resource_shares`(見下)與 `fine_tuned_model_consents` 的級聯刪除陳述式 |
| `server/db.ts` | 5403+(`exportUserData`) | **對稱修復**:K3 §缺讀聲明 #2 指出這裡很可能有同樣的漏欄位問題,尚未查證——本 PR 應同步核對 `exportUserData` 讀取的表清單是否也漏了同樣 10+10 張表,若有一併補齊 |

**移除(10 張無 `userId` 欄的表)**:`prompt_assets`、`external_service_subscriptions`、`cost_aggregations`、`cost_ledger`、`cost_attribution_outbox`、`alert_configs`、`fine_tuned_model_consents`、`orb_spirit_collaboration_metrics`、`orb_system_alerts`、`real_earth_entries`。

其中 `fine_tuned_model_consents` 屬於「間接個資」——應隨 `fine_tuned_models` 被刪連帶清除,改用外鍵級聯陳述式而非塞進通用陣列:
```sql
DELETE FROM fine_tuned_model_consents WHERE modelId IN (SELECT id FROM fine_tuned_models WHERE userId=?);
```
其餘 9 張純屬全域/非使用者資料,直接從陣列移除、不需替代邏輯。

**補上(10 張漏掉、且真的有 `userId`/`user_id` 欄的表)**——注意欄位命名不可一律假設 `userId`:

snake_case `user_id`(4 張,不含 `video_analytics`):
- `orb_conversation_messages`(schema.ts:2744)
- `timeline_frames`(schema.ts:3602)
- `scene_compositions`(schema.ts:3643)
- `agent_dlq`(schema.ts:2666)

`video_analytics`(schema.ts:4743,`user_id` 可為 null,GDPR opt-out 設計)——刪除語句需處理 `NULL` 情況,但 `WHERE user_id = ?` 本身在 `userId` 已知時行為正確,無需特殊處理(null 列本就不會被這個 `userId` 值匹配到,是設計預期)。

camelCase `userId`(3 張):
- `consistency_vault`(schema.ts:723)
- `studio_versions`(schema.ts:2810)
- `orb_workflow_template_ratings`(schema.ts:3283)

重構後的完整陣列結構(示意,實際需含既有 60 個表項目補齊 column):
```ts
const USER_OWNED_TABLES: Array<{ table: string; column: string }> = [
  { table: "login_history", column: "userId" },
  // …既有 60 個項目逐一補齊 column（絕大多數是 userId，需逐表核對非假設）…
  { table: "orb_conversation_messages", column: "user_id" },
  { table: "timeline_frames", column: "user_id" },
  { table: "scene_compositions", column: "user_id" },
  { table: "agent_dlq", column: "user_id" },
  { table: "video_analytics", column: "user_id" },
  { table: "consistency_vault", column: "userId" },
  { table: "studio_versions", column: "userId" },
  { table: "orb_workflow_template_ratings", column: "userId" },
];
```

**`resource_shares` 獨立處理**(K3 §1.5,無法套用同一 pattern——同時有 `sharedByUserId` 與 `sharedWithId`,後者可能指向 user 或 team):
```sql
DELETE FROM resource_shares WHERE sharedByUserId = ?;
DELETE FROM resource_shares WHERE sharedWithType = 'user' AND sharedWithId = ?;
```
寫成 `deleteUserAccount` 內顯式的額外 SQL,不硬塞進通用陣列/迴圈。

#### 3.3 差集守門測試(CI 必跑,新基礎設施)

比照既有 `server/orphan-migrations-journal.test.ts` 的精神,新增一支測試:
1. 掃描 `drizzle/schema.ts`,用正則或 AST 找出所有欄位名為 `userId` 或 `user_id` 的表定義。
2. 對照明確排除清單(全域表,如 `cost_aggregations`、`alert_configs` 等 9 張純全域資料表 + 已用級聯陳述式單獨處理的 `fine_tuned_model_consents`/`resource_shares`)。
3. 兩者做差集:`(schema.ts 含 userId 欄的表) − (USER_OWNED_TABLES 的 table 清單) − (明確排除清單)` 必須為空集合,否則測試失敗並列出遺漏的表名。
4. 建議同一支測試也順便驗證 `USER_OWNED_TABLES` 裡每個 `column` 值確實對應 `schema.ts` 該表的實際欄位名(防止未來重構欄位名卻忘記同步更新這裡)。

#### 3.4(c)呼叫端錯誤處理

| 檔案 | 行號 | 改動內容 |
|---|---|---|
| `server/routers/profile.ts` | 29-34(`deleteAccount`) | 包 try/catch,把資料庫錯誤轉成使用者看得懂的訊息(而非裸 tRPC 500),並記錄到監控(log/告警),讓「刪帳號失敗」這種合規相關錯誤能被主動發現 |

### migration
**無 `drizzle/schema.ts` schema 變更**(不改表結構、不新增欄位)。但這是一次**資料結構重構**:
- `USER_OWNED_TABLES` 的 TypeScript 型別從 `readonly string[]` 換成 `Array<{table:string; column:string}>`,是純程式碼層改動,不需要 drizzle migration 檔案。
- 若 3.3 的守門測試通過後發現目前生產環境已有孤兒資料(修復前已被刪帳號但漏刪的舊使用者資料——**理論上不太可能發生,因為 K3 §1.1 指出目前刪帳號整條路徑必炸,連 `users` 列都刪不掉**,故不太可能有「使用者已刪除但個資殘留」的既存孤兒資料;但仍建議合併後跑一次全表掃描確認 `users` 表已刪除的 userId 是否在任何一張新增的 10 張表中仍有殘留列,若有需一次性清理腳本)。

### 測試

- **單元**:對新版 `USER_OWNED_TABLES` 跑差集守門測試(3.3),斷言與 `schema.ts` 實際欄位盤點一致。
- **整合(需 `dev-environment/docker-compose.yml` 真實 MySQL)**:建測試使用者,在 10 張新增表各塞一筆資料,呼叫 `deleteUserAccount`,斷言:① 不拋錯 ② `users` 該列消失 ③ 10 張新增表 + `resource_shares` 相關列全部消失 ④ 10 張移除的表完全不受影響(資料仍在,因為這些表本就不該被刪)。
- **電路斷路器單元測試**:模擬 `recordFailure` 收到 `ER_BAD_FIELD_ERROR`(非 transient)→ 斷言 `consecutiveFailures` 不遞增;收到 `ECONNRESET`(transient)→ 斷言遞增,達 5 次後 `isCircuitOpen()=true`。
- **迴歸**:既有呼叫 `executeTransaction` 的 happy-path 測試(如 `deleteTeam`)不受影響。
- **exportUserData 對稱測試**(若 3.2 的對稱修復也做了):驗證匯出的資料涵蓋所有 10 張新增表且不含已移除的 10 張表相關欄位。

### 驗收標準
1. 差集守門測試(3.3)在 CI 綠燈,且能證明:未來若有人新增一張帶 `userId`/`user_id` 欄的表卻忘記登記進 `USER_OWNED_TABLES`,CI 會失敗擋下(可用「臨時加一張假表驗證測試真的會抓到」的方式驗證測試本身有效)。
2. 真實 DB 整合測試通過,`deleteUserAccount` 全流程不拋錯,10 張新增表 + `resource_shares` 完全清空,10 張移除表資料完整保留。
3. 電路斷路器單元測試證明非 transient 錯誤不再污染 `consecutiveFailures`。
4. `profile.deleteAccount` 呼叫失敗時回傳使用者可讀訊息,並有監控告警可觀察到失敗次數(非靜默失敗)。

### 風險回滾
- **(a)電路斷路器修法**:低風險,可獨立先合併,幾乎不可能引入新問題(只是收緊「什麼算失敗」的判斷),回滾只需 revert 這一個檔案的三處 catch 區塊。
- **(b)USER_OWNED_TABLES 重構**:**高風險改動,一旦合併後才發現遺漏,可能導致刪帳號要嘛失敗(漏欄位)要嘛漏刪個資(漏表)**。回滾策略:
  1. 這是**資料刪除邏輯**,一旦某使用者實際觸發刪帳並且清單有誤,已刪除的資料無法復原(除非從 MySQL 備份還原個別列,操作複雜且風險高)。因此**合併前的差集守門測試必須先在 CI 跑綠燈**,且**建議先在 staging 用真實測試帳號跑過一次完整刪帳流程**,再合併到 main。
  2. 若上線後才發現遺漏(例如守門測試本身遺漏了某張表,因為排除清單寫錯),**立即 revert 整個 PR-C 的 (b) 部分**(建議 (a)/(b)/(c) 拆成 3 個獨立 commit,方便單獨 revert 而不影響其他兩部分)。
  3. 中期:考慮把 `profile.deleteAccount` 加一層「軟刪除 + 24-48 小時延遲硬刪除」的緩衝(不在本卡範圍內,但值得記錄為後續強化方向——目前是同步硬刪除,一旦清單有誤沒有挽回空間)。
- **(c)呼叫端錯誤處理**:低風險,標準 try/catch,回滾只需 revert `profile.ts` 一個檔案。

### 工作量
**L(2-3 天)——本輪最重的一張**:需重新設計 `USER_OWNED_TABLES` 資料結構、逐表核對真實欄位名稱(20 張表)、寫級聯陳述式、建守門測試,且理想上需真實 DB(docker-compose)驗證而非只讀碼推論。若同步做 `exportUserData` 對稱修復,工作量上修至 L 區間高端(接近 3 天)。

### 可否與功能並行
可獨立分支進行,但 **(a) 電路斷路器修法應最先合併**——低風險、無副作用的體質強化,做完可讓後續 (b)/(c) 的整合測試更安全地反覆執行,不必擔心測試本身觸發全站 503。**(b)(c) 建議排在 PR-A/PR-B 之後執行**,不代表不緊急(GDPR 合規風險本身是最高等級),只是需要真實 DB 驗證且工作量最大,執行時間最長,不應該讓它拖住風險/工作量比更高的 PR-A/PR-B 的合併速度。

---

## 4. P0 立即 vs 可與功能開發並行 —— 跨 PR 總表

| 修復項目 | 所屬 PR | P0 立即? | 可與功能並行? | 理由 |
|---|---|---|---|---|
| 修復卡 4(R6*owner-check) | PR-B(建議先拆出獨立 micro-PR) | **是** | 是 | 已有現成對照實作可抄,風險/工作量比全批最高,S 級工作量,零新設計風險 |
| 修復卡 6(R8 forge 同意書) | PR-B | **是** | 是 | 真人肖像權合規風險,法律曝險高於純技術漏洞;清理成本低(移除死碼) |
| 修復卡 1、2(R4/R5 SSRF) | PR-A | 是 | 是 | CONFIRMED 可觸發的內網探測,S 級工作量,同批次處理 |
| PR-C(a)電路斷路器 | PR-C(建議拆出獨立先合) | 是 | 是 | 低風險體質強化,越早做越能保護後續交易類修復的測試安全 |
| 修復卡 3(R6*proxy-download) | PR-A | 否(需先盤點) | 是,但先 staging 驗證 | 需先盤點本站實際 bucket host,避免誤擋既有 CDN 流量 |
| 修復卡 5(R7 teamModels RBAC) | PR-B | 否(需先查證) | 可,但建議獨立分支 | 需先查證 `toggleVisibility` 的 `teamId` 賦值邏輯,風險是「修完後 team_shared 集體不可見」 |
| PR-C(b)(c) USER_OWNED_TABLES + 守門測試 | PR-C | 否(GDPR 合規急迫,但技術上需要時間) | 可獨立分支,但工作量最大 | 需真實 DB 驗證、逐表核對欄位命名、新建守門測試基礎設施,是本輪工作量最大的一項,即使合規風險最高也需要足夠時間做對(一旦刪錯資料不可逆) |

**排序摘要**:如果人力有限只能先做一批,建議優先序為
`修復卡4 → 修復卡1+2 → PR-C(a) → 修復卡6 → 修復卡3 → 修復卡5 → PR-C(b)(c)`
(與 P4 文件原始「修復順序建議」一致,本 playbook 未更動優先序,只是把它們重新打包成 3 個可獨立合併的 PR 交付單位)。

---

## 5. 未涵蓋範圍(明確排除,供後續追蹤)

1. **R1(generate.multimodal 雙重退款 / `deductUserPoints` 相關的冪等性問題)**:不在本輪 P4 七張修復卡之內(P4 只涵蓋 R2-R8),屬於 K2-generation-bugs.md 的獨立問題,建議另開追蹤卡,不塞進本 playbook 的任一 PR。
2. **K1-5(硬編碼超級管理員信箱後門)、K1-8(雙路由驗證強度不一致的結構性風險本身)、K1-9~K1-11(🟢 低風險項目)**:P4 文件本身未對這些開修復卡,本 playbook 沿用同樣範圍,未涵蓋。
3. **K3 §1.4(團隊/專案刪除的孤兒列,`deleteTeam()` 只清 3 張表)**、**§1.5 的 `resource_shares` 在 `ENABLE_DATA_RBAC` 開啟後的消費端行為**、**§2.2(MySQL/Supabase 雙 DB IDOR,`handoffTraceRoute.ts`)**:K3 已記錄但不在 P4 的 7 張修復卡範圍內,建議另開卡,不在本輪 3 個 PR 內處理。
4. **`exportUserData()` 的對稱修復**:本 playbook 已在 PR-C 的 3.2 標記為「建議同步做」,但**不是強制項**——若時間不夠,可拆成 PR-C 之後的獨立小 PR,不應阻塞 PR-C 主體(刪除路徑)的合併。
5. **K1-2 未查完清單(前端 XSS 全面性、orb tool registry 的 SSRF 邊界、secret 外洩 log 稽核、Supabase RLS policy 逐條稽核、JWT alg-confusion 形式化驗證)**:K1 文件本身列為「未查完部分」,不在本輪 playbook 範圍。
6. **PR-A 的「grep-based lint 測試防止未來新增 fetch 呼叫點遺漏 `redirect:error`」**:本 playbook 於 §1 驗收標準內提及為「非本 PR 必要項」,建議另開衛生任務。
