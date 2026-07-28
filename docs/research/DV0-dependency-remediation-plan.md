# DV0 — 依賴弱點修補優先序(11 critical/high npm 弱點可達性彙整)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:彙整 DV1(drizzle)、DV2(網路 client:ws/axios/undici/form-data)、DV3(langsmith/protobufjs/grpc-js/fast-xml-builder)、DV4(vite/vitest)四份可達性分析,產出跨套件的今日修補優先序。所有判定均基於 Grep/Read 實查(檔案:行號),未臆測。

## 1. 優先序表

reachable-prod 排最前,其餘依 reachable-limited → dev-only → not-reachable 排序;同分類內依 severity 排序。

| # | 套件 / CVE | 嚴重度 | 可達性判定 | prod / dev | 建議動作 | 破壞性風險 |
|---|---|---|---|---|---|---|
| 1 | **ws** 8.20.0(8.0.0–8.20.1) | high | **reachable-prod** | prod | 立即升級 ws 至已修補 8.x 版;`server/_core/index.ts:149,1071,1075-1081` 未鑑權即 `handleUpgrade`,`server/ws/orbVoiceGateway.ts:20-27` token 驗證在連線建立**之後**才做,不可信 client 可對 `/ws/orb-voice` 送裸連線觸發弱點 | 低 — API(`WebSocketServer`/`handleUpgrade`/`on('message')`)不變 |
| 2 | **langsmith** 0.3.87(prototype pollution, GHSA-fw9q-39r9-c252) | high | **reachable-limited** | prod | 升級至 `langsmith>=0.4.6`;目前攻擊者只能控制值(prompt 字串經 `.slice(0,500)`),控制不到鍵名,故未達成觸發條件,但 SDK 在 prod 流量常態啟用(`LANGCHAIN_TRACING_V2` 預設 true,`server/_core/env.validated.ts:523`),須視為隨時可能因程式改動而變成可達 | 低 — 單一使用檔案 `server/services/langsmithTracer.ts:56`,API 穩定 |
| 3 | **drizzle-orm** 0.44.7(<0.45.2, SQL identifier injection) | high | not-reachable | prod(直接依賴) | 升級 `drizzle-orm@^0.45.2` 作防禦性強化;唯一 `sql.raw` 呼叫(`server/db.ts:2041`)插入的是已被 `Math.max(1,Math.min(90,...))` 夾限的數值區間,非識別碼,且呼叫鏈(`server/routers/dashboard.ts:15,52`)不傳遞外部 `days` | 低,但升版後須全面回歸(100+ 檔案 import drizzle-orm),跑 `tsc --noEmit` + migration 測試 |
| 4 | **axios** 1.15.0(<1.15.3) | high | not-reachable | prod(經 axios 直接依賴) | 升級 axios 到已修補版 | 低 — 僅 `axios.create`/靜態 `post`,無 proxy env、無使用者控制 config |
| 5 | **form-data** 4.0.5(<4.0.6) | high | not-reachable | prod(transitive,經 axios/elevenlabs) | 隨 axios 升版自動帶動;考慮移除未使用的 `elevenlabs` 依賴 | 低 — repo 內 `new FormData()` 全是原生實作,與此套件無關 |
| 6 | **undici**(經 jsdom → isomorphic-dompurify) | critical | not-reachable | prod(sanitize 路徑)+ dev(jsdom test) | 用 npm `overrides` 強制 undici 到修補版,或等 jsdom 上游升級 | 低 — `sanitize.ts` API 不受影響,但需回歸 `sanitize.test.ts` |
| 7 | **langsmith SSRF via header injection**(CVE-2026-25528) | high | not-reachable | prod | 隨 #2 一併升級(同套件) | 低 — `fromHeaders`/`RunTree`/`TracingMiddleware` 全 repo未使用 |
| 8 | **protobufjs** 7.5.4(bytes field defaults RCE) | critical | not-reachable | prod(transitive,但唯一呼叫點是死碼) | 等待 `google-gax` 上游放出相容版本後升級;或直接確認 `voiceCompiler.ts` 可整支移除 | 低 — 未被執行 |
| 9 | **@grpc/grpc-js** 1.14.3(malformed request crash) | high | not-reachable | prod(transitive,同一死碼路徑) | 隨 #8 一併處理 | 低 |
| 10 | **fast-xml-builder** 1.1.4(attribute quote bypass) | high | not-reachable | prod(double-transitive,`@google-cloud/storage` 全 repo零 import) | 另案評估移除未使用的 `@google-cloud/storage` 依賴;否則等上游 `fast-xml-parser` 升版 | 低 |
| 11 | **vite** 7.1.7 宣告 / 7.3.2 實際解析(GHSA-4w7w-66w2-5vf9,<=6.4.1) | low | not-reachable | dev-only | 無需動作(已高於受影響範圍);嵌套 `vite-node`/`vitest` 內的 vite@5.4.21 僅供進程內轉譯,無對外 dev server | 無 |
| 12 | **vitest** 2.1.9(<3.2.6, `@vitest/ui` RCE) | low | not-reachable | dev-only | 觸發前提 `@vitest/ui` 從未安裝且 CI 用 `vitest run` 批次模式;可選擇性升級 vitest 到 3.x 做衛生但非急迫 | 中 — vitest 2→3 為 major,需跑全測試套件確認相容 |

## 2. 立即升版清單(可直接 `npm install` 到 fixed 版,風險低)

這些套件的升級動作本身低風險、無需先改程式碼,建議本週排入:

- `ws` → 已修補 8.x 版(**最優先**,唯一 reachable-prod)
- `langsmith` → `>=0.4.6`(同時解決 prototype pollution 與 SSRF header 兩顆 CVE)
- `axios` → `>=1.15.3` 或最新 patch(連帶讓 `form-data` transitive 版本一併升級)
- `drizzle-orm` → `^0.45.2`(防禦性強化,目前 not-reachable 但屬直接依賴、升級成本低)

以上四項升級後建議跑:`tsc --noEmit`、`vitest run`(全量)、以及 migration 相關測試(`server/orphan-migrations-journal.test.ts`、`server/migration-prod-pending-block.test.ts`)。

## 3. 需程式改動的項目

- **`ws` 鑑權時序**(非 CVE 修法本身,但屬同一問題根因的加固):`server/ws/orbVoiceGateway.ts:20-27` 的 `verifySessionToken` 應移到 `server/_core/index.ts:1075-1081` 的 `handleUpgrade` 之前或之中,避免未鑑權連線先取得 socket 才驗證。這是**獨立於 npm 版本號的架構修正**,升級 ws 套件版本並不會自動修好這個鑑權時序問題,建議另開工單處理。
- **drizzle-orm 未來防護**:目前 `sql.raw`/識別碼組裝零使用 `.$dynamic()`,是好現象;若未來新增排序/篩選功能,需在 code review checklist 中明確禁止把使用者字串直接餵進 `sql.raw`/`sql.identifier`,而非只依賴套件版本號。
- 其餘(protobufjs / grpc-js / fast-xml-builder)**不需要**程式改動 — 依賴鏈本身是死碼或未使用依賴,升級或移除依賴即可,無需改動呼叫邏輯。

## 4. 降級為 dev 衛生的項目

以下確認 prod runtime 不可達,可歸類為「dev 衛生維護」而非安全事件,排入常規依賴維護排程即可,不需要佔用今天的安全修補時間:

- **vite**(頂層已是 7.3.2,遠高於受影響範圍;`server/_core/index.ts:1012` 確認 dev server 僅在 `NODE_ENV=development` 啟動,`npm start` 強制走 `serveStatic`)
- **vitest**(`@vitest/ui` 從未安裝,CI/`package.json:29` 全用批次模式 `vitest run`;若要衛生升級到 3.x 需注意是 major bump,配套跑一次全量測試)

## 5. 給 Bruce:今天真正該處理的 2-3 個

1. **`ws` 升級 + 鑑權時序修正**——這是本輪唯一 `reachable-prod`:未鑑權的網路 client 現在就能對 `/ws/orb-voice` 建立連線並送出畸形分片幀,`verifySessionToken` 目前是連線建立**之後**才擋,套件升級只堵住 CVE 本身，鑑權時序這個架構問題還是要另外處理,兩件事建議一起排今天。
2. **`langsmith` 升級**——唯一 `reachable-limited`:目前因為攻擊者只能控制值、控制不到鍵名而暫時擋住,但這條件很脆弱(一旦哪天有人把 `req.body` 整包物件塞進 `metadata` 而非逐欄取值,就從 limited 變 reachable),且該 SDK 在 prod 常態開著(`LANGCHAIN_TRACING_V2` 預設 true)。升級只涉及一個檔案、API 穩定,成本極低、收益是把這條「暫時安全」的路徑徹底堵死,值得今天一起做掉。
3.(可選,順手做)**`axios` + `drizzle-orm` 升級**——兩者都是 not-reachable、但都是**直接依賴**且升級風險低,跟 #1、#2 一起跑一次 `tsc --noEmit`/測試套件的成本幾乎是零增量,能一次把清單裡僅存的兩個「直接依賴且仍在弱點區間內」的套件也清掉,不需要再開一輪回歸驗證。

其餘 7 項(undici、form-data、langsmith-SSRF、protobufjs、grpc-js、fast-xml-builder、vite/vitest)全部 not-reachable 或 dev-only,建議併入下個 sprint 的常規依賴維護,不需要今天動。
