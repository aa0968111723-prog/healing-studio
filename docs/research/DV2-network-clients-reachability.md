# DV2 — axios/undici/form-data/ws 網路客戶端弱點可達性
- 產生日期:2026-07-03
- 依據 commit:7f4417daaacbf24510dc20d88dba9aae71b2883c
- 性質:npm 弱點在本 repo 的可達性分析

範圍:本文只涵蓋指派的四個套件 — axios、undici、form-data、ws。判定方法:先用 Grep/Read 找出套件在 repo 的實際 import/呼叫點,再逐一追蹤該呼叫點的輸入來源與是否命中弱點函式路徑,最後才下 reachable-prod / reachable-limited / dev-only / not-reachable 判定。

---

## 1. axios 1.0.0-1.15.2 — auth bypass via prototype pollution in `validateStatus` merge + NO_PROXY loopback bypass

**依賴型態**:直接依賴。`package.json` `"axios": "^1.12.0"`,lockfile 實際解析版本 `1.15.0`(`package-lock.json:7857-7867`),落在弱點範圍 1.0.0-1.15.2 內,且是本 repo 唯一的頂層 axios 節點(無其他套件另外拉自己的 axios 版本)。

**使用點(唯一一處)**:`server/_core/sdk.ts`
- `import axios, { type AxiosInstance } from "axios";`(第 3 行)
- `axios.create({ baseURL: ENV.oAuthServerUrl, timeout: AXIOS_TIMEOUT_MS })`(第 80-84 行,`createOAuthHttpClient`)
- 僅有兩個呼叫點使用這個 client:`this.client.post(EXCHANGE_TOKEN_PATH, payload)`(第 58-61 行)與 `this.client.post(GET_USER_INFO_WITH_JWT_PATH, payload)`(第 246-249 行),都是固定路徑的 JSON POST。

全 repo 只有這一個檔案 import axios(已用 Grep 對 `.ts/.tsx/.js/.mjs` 全庫掃描確認,且 package-lock 中沒有任何其他套件依賴 axios,見下方查證)。

**可達性判定:not-reachable**

理由:
1. **NO_PROXY loopback bypass** 需要 (a) 部署環境設有 `HTTP_PROXY`/`NO_PROXY` 之類環境變數,且 (b) 攻擊者能控制請求目的地(URL)為迴圈位址以繞過代理判斷。本 repo 全庫搜尋 `HTTP_PROXY|HTTPS_PROXY|NO_PROXY` 無任何使用(應用程式碼完全不讀取/操作這些變數),且 `baseURL` 固定為 `ENV.oAuthServerUrl`(`server/_core/env.ts:63`,讀自伺服器端環境變數 `OAUTH_SERVER_URL`),沒有任何 request 層級可由攻擊者輸入改寫目的地或走 axios 的代理解析路徑。
2. **`validateStatus` merge 的 prototype pollution / auth bypass** 需要攻擊者能把物件(尤其帶 `__proto__`/`constructor.prototype` 鍵的物件)合併進 axios 的 request config。本 repo 兩個呼叫點的 config 都是寫死的(`baseURL`+`timeout`),POST payload 只作為 `data`(第二參數),從未把使用者輸入物件展開合併進第三個 config 參數,也沒有自訂 `validateStatus`。因此攻擊者無法把可控物件注入 axios 的 config 合併路徑。
3. 唯一的攻擊者可控輸入是 `code`/`state`(OAuth 回呼)與 `jwtToken`(cookie),兩者都只作為 JSON body 的欄位值,不會進入 config 合併或 URL 组裝。

**prod/dev**:prod runtime(此模組是使用者登入/OAuth 交換流程的一部分,每次登入都會執行)。

**修法與破壞性風險**:升級到 axios ^1.15.3+(或 audit 建議的修補版)。`axios.create`/`.post` API 不變,風險低;建議連動確認 `follow-redirects`(axios 的 redirect 依賴)版本相容即可,預期無破壞性變更。

---

## 2. undici 7.0.0-7.27.2 — TLS 憑證驗證繞過(SOCKS5 ProxyAgent)+ Set-Cookie header injection

**依賴型態**:純 transitive,且路徑單一。全庫 Grep `undici` 在 `.ts/.tsx/.js/.mjs/.json`(排除 package-lock.json)無任何直接 import/require——本 repo程式碼從未直接使用 npm 的 `undici` 套件(Node 內建 `fetch`/`FormData` 用的是 Node 核心內嵌的 undici,並非 `node_modules/undici` 這個獨立套件實例)。

依 `package-lock.json` 反查,唯一把 `undici` 列為依賴的節點是:
```
package-lock.json:11823   "undici": "^7.25.0",   # 屬於 node_modules/jsdom 的 dependencies
```
`jsdom` 又是這樣被拉進 repo 的:
- `package.json` **devDependencies** `"jsdom": "^29.1.1"`(僅測試用,vitest jsdom 環境)。
- **prod dependencies** 中的 `isomorphic-dompurify@3.18.0`(`package-lock.json` node 條目 `dependencies: { dompurify: ^3.4.11, jsdom: ^29.1.1 }`)——這個是會在正式環境載入的路徑。

`isomorphic-dompurify` 在 prod 的實際使用點:`server/utils/sanitize.ts:1` `import DOMPurify from "isomorphic-dompurify";`,並由 `sanitizeRichText`/`sanitizePlainText`(第 10-20 行)在多處路由/服務中對使用者輸入的富文本做消毒(呼叫方包含 `server/routers/learnHub.ts`、`server/routers/ai.ts`、`server/routers/director.ts`、`server/signedUpload.ts` 等,已用 Grep 確認 import)。

**可達性判定:not-reachable**

理由:
1. `undici` 套件在 `jsdom` 內只在「資源載入」相關程式碼路徑被 require:`node_modules/jsdom/lib/jsdom/browser/resources/request-interceptor.js`、`decompress-interceptor.js`、`jsdom-dispatcher.js`、`stream-handler.js`,以及 `living/websockets/WebSocket-impl.js`、`living/fetch/header-list.js`(已用 Grep 對 `node_modules/jsdom/lib` 逐一確認)。這些程式碼只在 jsdom 視窗真的去「抓外部資源」(例如設定 `resources: "usable"`、頁面內的 `<script src>`/`fetch()`/`WebSocket` 呼叫)時才會執行到 undici 的網路層(含弱點所在的 `ProxyAgent`/`Set-Cookie` 處理)。
2. `isomorphic-dompurify` 的用法(`DOMPurify.sanitize(input, {...})`)純粹是拿 jsdom 建立一個「沒有掛網路」的 DOM 視窗做字串消毒,不啟用資源載入、不呼叫 fetch/WebSocket,所以永遠不會觸發 undici 的 `ProxyAgent`/TLS/Set-Cookie 這段有弱點的程式碼。
3 undici 因此只是被「載入進記憶體」的 transitive 模組,其弱點函式路徑在本 repo 沒有任何呼叫鏈能觸達。

**prod/dev**:模組本身在 prod runtime 存在(經 isomorphic-dompurify),但弱點程式碼路徑不會被執行;純測試用的 jsdom(devDependencies)則是 dev/test-only。

**修法與破壞性風險**:升級路徑是連動 `jsdom`(拉新版 undici)。`isomorphic-dompurify@^3.18.0` 目前鎖定 `jsdom: ^29.1.1`,若上游未發新版對應更新的 undici,可考慮 `npm overrides` 強制 `undici` 到修補版;風險低(sanitize.ts 呼叫介面不變),但需確認 override 後 jsdom 仍能正常建構(建議跑一次 `npm run test` 涵蓋 `sanitize.test.ts`)。

---

## 3. form-data <4.0.6 — CRLF injection via unescaped multipart field names/filenames

**依賴型態**:純 transitive,兩條路徑都與本 repo 程式碼「無呼叫關係」。`package-lock.json` 中 `node_modules/form-data` 實際解析版本為 **4.0.5**(< 4.0.6,落在弱點範圍),來源:
```
package-lock.json:7857-7867   node_modules/axios  → "form-data": "^4.0.5"
package-lock.json:9810-9827   node_modules/elevenlabs → "form-data": "^4.0.0"
```
(另有 `@types/request` 的 `form-data@2.5.5` 巢狀版本,型別套件不影響 runtime。)

本 repo **程式碼裡沒有任何檔案 `import`/`require` npm 的 `form-data` 套件**(全庫 Grep `require(['"]form-data['"])`/`from ['"]form-data['"]` 為 0 筆),也沒有任何地方把 `global.FormData`/`globalThis.FormData` 指向這個 npm 套件。repo 內所有 `new FormData()` 呼叫點(`server/services/elevenLabsExtended.ts:378,410,468`、`server/services/orbVoiceProcessor.ts:30`、`server/storage.ts:392`、`server/_core/voiceTranscription.ts:132`、`client/src/components/animation/StoryboardTimelineUploader.tsx:84`)用的都是 **Node/瀏覽器內建的全域 `FormData`**(Node ≥18 內建,`engines.node` 要求 `>=20.0.0`,`package-lock.json:177-180`),其 multipart 編碼實作與 npm `form-data` 套件的程式碼完全不同,不受此 CVE 影響。

弱點套件 `form-data@4.0.5` 唯二的「潛在」呼叫路徑:
1. **axios** — 只有在 axios 的 request body 是 multipart(例如傳 Node stream/`form-data` 實例給 axios 當 body)時,axios 才會走到自帶的 `form-data` 依賴做編碼。但本 repo 唯一的 axios 使用點(`server/_core/sdk.ts`)全部是 JSON POST(`payload` 物件直接當 `data`),從未傳 multipart body,因此不會用到 `form-data`。
2. **elevenlabs SDK**(`package.json` dependencies `"elevenlabs": "^1.59.0"`)——全庫 Grep `from ["']elevenlabs["']`/`require(["']elevenlabs["'])` 為 0 筆,repo 中沒有任何檔案 import 這個 SDK 的 class/client(命名相似的 `elevenLabsExtended.ts`、`orbVoiceProcessor.ts` 是自行寫的 fetch 封裝,不是這個 SDK)。也就是說 `elevenlabs` 套件目前是**完全未被使用的殘留依賴**,其內部的 `form-data` 用法自然也不會被執行。

**可達性判定:not-reachable**

**攻擊者輸入來源**:無——沒有任何程式路徑會把攻擊者可控的欄位名/檔名餵進這個弱點套件的 multipart 編碼器。(注意:`server/storage.ts:393` 的 `form.append("file", blob, key.split("/").pop() ?? key)` 雖然 `key` 部分可能源自使用者上傳的檔名,但走的是 Node 內建 `FormData`,不是本弱點的套件,故不計入此弱點的可達性。)

**prod/dev**:套件本身會被安裝進 `node_modules`(因為是 axios/elevenlabs 的宣告依賴),但無任何 prod 呼叫鏈觸達其編碼函式。

**修法與破壞性風險**:等 axios 升級後其 `form-data` 依賴版本自然會提升;`elevenlabs` 套件建議直接評估是否移除(未使用的依賴,減少攻擊面且不影響行為)。若保留,`npm audit fix` 或 `overrides` 升級 `form-data` 到 ≥4.0.6 風險極低(無 repo 程式碼直接依賴其 API)。

---

## 4. ws 8.0.0-8.20.1 — uninitialized memory disclosure + memory exhaustion DoS from tiny fragments

**依賴型態**:直接依賴。`package.json` `"ws": "^8.18.0"`,lockfile 解析版本 `8.20.0`(`package-lock.json:2869` 一致),落在弱點範圍 8.0.0-8.20.1 內。

**使用點**:
- `server/_core/index.ts:149` `import { WebSocketServer } from "ws";`
- `server/_core/index.ts:1071` `const orbVoiceWss = new WebSocketServer({ noServer: true, maxPayload: ORB_MAX_PAYLOAD_BYTES });`(`ORB_MAX_PAYLOAD_BYTES = 64 * 1024`,定義於 `server/ws/orbVoiceGateway.ts:18`)
- `server/_core/index.ts:1075-1081`:HTTP `upgrade` 事件處理——**只檢查路徑是否為 `/ws/orb-voice`,沒有任何驗證/驗權/rate-limit 檢查就呼叫 `handleUpgrade`**:
  ```
  server.on("upgrade", (req, socket, head) => {
    const pathname = (req.url ?? "").split("?")[0];
    if (pathname !== "/ws/orb-voice") return;
    orbVoiceWss.handleUpgrade(req, socket, head, (ws) => {
      orbVoiceWss.emit("connection", ws, req);
    });
  });
  ```
- `server/ws/orbVoiceGateway.ts:20-45`(`handleOrbVoiceConnection`):WebSocket 連線**建立之後**才在應用層檢查 `verifySessionToken(token)`(第 22-27 行),沒有 token 就 `ws.close(1008, "unauthorized")`。也就是說 **ws 底層的 frame receiver / parser 在 TCP+WS handshake 完成的那一刻就已經掛上,早於應用層的 token 驗證**——這正是弱點所在的 `ws` frame 解析程式碼路徑(fragmented frame reassembly)。

**可達性判定:reachable-prod**

**攻擊者輸入來源**:任何能連到伺服器的網路使用者(不需登入、不需有效 session token)都可以對 `/ws/orb-voice` 發起 WebSocket handshake——upgrade handler 只驗證 path,不驗證任何憑證。Handshake 完成後,攻擊者可在 `verifySessionToken` 解析完成、甚至在收到 `ws.close(1008,...)` 之前,搶先送出精心構造的大量微小分片(tiny fragmented frames)給該連線,直接命中 ws 套件本身的 frame reassembly/記憶體配置弱點(未初始化記憶體洩漏 + 記憶體耗盡 DoS),因為這段程式碼在 `WebSocket` 物件建立時就已經接上 socket 的 data 事件,不受應用層 `ws.on("message", ...)` 邏輯或 token 檢查先後順序保護。

**緩解因子(降低但不能排除可達性)**:
- `maxPayload: 64 * 1024`(`ORB_MAX_PAYLOAD_BYTES`)限制單一「重組後訊息」大小上限,但弱點描述是「來自微小分片的記憶體耗盡」——即攻擊模式常見於分片重組階段的低效記憶體配置(每個分片各自配置/複製),`maxPayload` 只在訊息組完之後或超過門檻時才擋下,不必然阻止分片階段的放大攻擊。
- `perMessageDeflate` 未在 `new WebSocketServer({...})` 中設定,而 `ws` 套件本身 `WebSocketServer` 的預設值是 `perMessageDeflate: false`(已讀 `node_modules/ws/lib/websocket-server.js:70` 確認),所以 permessage-deflate 擴充功能是關閉的——若該 CVE 的攻擊路徑仰賴 deflate 擴充,則此設定可降低可達性;若純粹是 frame reassembly 層級(不需要 deflate),則不受此設定影響。**需再查**:npm audit 條目未附精確 GHSA ID/PoC,無法百分之百確認此弱點是否必須依賴 permessage-deflate 才能觸發,建議進一步查證官方 GHSA 說明以確認缺陷是否與 deflate 擴充綁定。
- 全域連線數上限(`MAX_GLOBAL_CONNECTIONS=100`)、per-user 併發上限(`ORB_VOICE_MAX_CONCURRENT=3`)、以及 30 秒逾時等限制可以壓低攻擊規模上限,但這些門檻是在應用層(token 驗證之後)才生效,無法阻止未過 token 驗證前、單一連線內對 frame parser 的攻擊。

**prod/dev**:prod runtime——此 WebSocket 伺服器是對外服務(監聽 `0.0.0.0`,`server.listen(port, "0.0.0.0", ...)`,`server/_core/index.ts:1030`),為 OrbVoice 語音助手功能的一部分,只要伺服器啟動即持續存在。

**修法與破壞性風險**:升級 `ws` 到 ^8.20.2+(或 audit 建議的修補版)。`ws` 的公開 API(`WebSocketServer`/`handleUpgrade`/`ws.on("message",...)`)在修補版中未變動,屬於低風險修補;建議升級後跑一次涉及 `server/ws/orbVoiceGateway.test.ts` 的測試套件確認行為未變。同時建議把 upgrade handler 的驗證提前(在 `handleUpgrade` 之前或立即之後、註冊任何 `message` 監聽器之前先驗證 token,必要時直接在 socket 層 reject),可縮小未驗證連線可觸達弱點程式碼的視窗,但這是額外強化建議,非本次可達性判定的必要修法。

---

## 小結對照表

| 套件 | 依賴型態 | 弱點函式路徑是否被呼叫 | 攻擊者輸入來源 | prod/dev | 判定 |
|---|---|---|---|---|---|
| axios | 直接依賴 | 否(config 皆寫死,無 attacker-controlled 合併/代理目的地) | 無(OAuth code/state/jwtToken 只進 JSON body) | prod | **not-reachable** |
| undici | transitive(經 jsdom ← isomorphic-dompurify(prod)/devDeps(test)) | 否(sanitize 用法不觸發 jsdom 的資源載入/fetch/WebSocket 路徑) | 無 | prod 存在但路徑不可達;測試用途 dev-only | **not-reachable** |
| form-data | transitive(經 axios、未被使用的 elevenlabs SDK) | 否(repo 皆用 Node 內建全域 FormData,非此套件;axios 只送 JSON;elevenlabs SDK 未被 import) | 無 | 套件安裝但無呼叫鏈 | **not-reachable** |
| ws | 直接依賴 | 是(`/ws/orb-voice` WebSocketServer,handshake 無需驗證即可送 frame) | 未認證的任意網路使用者,透過 WebSocket 分片攻擊 | prod(對外監聽) | **reachable-prod** |

---

## 查證方法紀錄(供覆核)

- 全庫 Grep(排除 `node_modules`)確認各套件的 import/require 位置與次數。
- `package-lock.json` 以 Python `json` 解析 `packages` 節點,反查每個弱點套件被哪些父套件依賴、解析到的實際版本號,確認是否落在 npm audit 給出的弱點版本範圍內。
- 對 `undici`/`ws` 額外讀取 `node_modules/jsdom/lib` 與 `node_modules/ws/lib/websocket-server.js` 原始碼,確認弱點函式的觸發條件(資源載入路徑 / `perMessageDeflate` 預設值)。
- 對每個「疑似可達」的呼叫點,回溯輸入來源到 HTTP request(query/body/cookie/上傳檔名)或內部固定設定,判斷是否為攻擊者可控。
