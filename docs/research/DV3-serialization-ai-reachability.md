# DV3 — protobufjs/langsmith/fast-xml-builder/grpc 弱點可達性
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:npm 弱點在本 repo 的可達性分析

負責範圍:`protobufjs`、`langsmith`、`fast-xml-builder`、`@grpc/grpc-js` 四個 npm audit 回報的 critical/high 弱點。逐一查證套件在本 repo 的實際使用點(import/呼叫鏈),判定是否可達。

---

## 1. protobufjs `<=7.6.2`(critical — bytes field defaults 引發程式碼注入/RCE)

**CVE/GHSA**:GHSA-66ff-xgx4-vchm("Code injection through bytes field defaults in generated toObject code",影響 `<=7.5.5` 與 `8.0.0–8.0.1`)。本 repo 安裝版本 `protobufjs@7.5.4`(`npm ls protobufjs --all` 確認),落在受影響區間。

**依賴類型**:transitive。無任何 `package.json` 直接依賴 `protobufjs`;也沒有 `from "protobufjs"` / `require("protobufjs")` / `protobuf.load(...)` 出現在 app 原始碼(已用 Grep 排除 `node_modules`)。

**引入鏈**(已用 `npm ls protobufjs --all` / `npm ls google-gax --all` 逐層確認):
```
healing-studio
├─ @google-cloud/speech@7.3.0 (package.json:42, 直接依賴,但 app 程式碼中零 import)
│   └─ google-gax@5.0.6
│       ├─ @grpc/proto-loader@0.8.0 → protobufjs@7.5.4
│       ├─ proto3-json-serializer@3.0.4 → protobufjs@7.5.4
│       └─ protobufjs@7.5.4
└─ @google-cloud/text-to-speech@6.4.0 (package.json:44, 直接依賴,唯一被 import 的相依套件)
    └─ google-gax@5.0.6 (deduped)
```

**使用點**:全 repo 唯一 import `@google-cloud/text-to-speech`(進而載入 google-gax → protobufjs)的地方是 `server/services/voiceCompiler.ts:20`(`import textToSpeech from "@google-cloud/text-to-speech";`),在 `synthesizeWithGoogleTTS()`(`server/services/voiceCompiler.ts:709-742`)裡建立 `TextToSpeechClient` 並呼叫 `client.synthesizeSpeech(...)`(`voiceCompiler.ts:717-728`)。

**但這條路徑從未被呼叫**:
- `server/routers.ts:115` 明確註記:「voiceCompiler、audioCompiler、videoCompiler are no longer used — all modalities route through falDispatcher」。
- 全 repo 對 `synthesizeSpeech` / `getVoiceCompiler()` 的參照只出現在兩支測試檔(`server/voice-compiler.test.ts`、`server/voice-style-catalog.test.ts`),且進一步查證這兩支測試也**沒有**呼叫 `synthesizeSpeech()` / `synthesizeWithGoogleTTS()`(對其做 grep 無結果)。
- 其他呼叫 `voiceCompiler.ts` 的檔案(`server/routers/proStudio.ts:53-54`、`server/services/agentToolExecutor.ts:2270,4991`)只 import 純函式 `parseVoiceBlockPrompt` / `parseVoiceBlockSettings` / `EmotionProfile` 型別(單純 JSON 解析工具,不含任何 protobuf/gRPC 呼叫)。

**可達性判定:not-reachable**
理由兩層:
1. 即使 `@google-cloud/text-to-speech` 模組因靜態 `import` 而在程序啟動時被載入(google-gax 會用 protobufjs 載入其**自帶、受信任**的 proto 描述檔),GHSA-66ff-xgx4-vchm 需要「應用程式載入攻擊者可控的 schema/descriptor 並對含預設值的 bytes 欄位做 `toObject` 轉換」才會觸發——本 repo 從未動態載入外部/使用者提供的 `.proto` 或 protobuf descriptor,一律是 Google 官方 SDK 內建的固定 schema。
2. 唯一會實際建立 gRPC client 並發送/接收 protobuf 訊息的函式(`synthesizeWithGoogleTTS`)在目前路由下**完全是死碼**——沒有任何 tRPC router / Express route / 排程任務會呼叫到它,連測試都不覆蓋。

**攻擊者輸入來源**:無(該程式碼路徑不可達,無從談攻擊輸入)。

**prod/dev**:程式碼技術上屬 server runtime 檔案,但實際上未被任何 prod 流程執行(死碼)。

**修法與破壞性風險**:`npm audit fix` 會將 `protobufjs` 升到 `>=7.5.6`(修 GHSA-66ff-xgx4-vchm)。由於 protobufjs/google-gax 是 transitive(經 `@google-cloud/speech` 與 `@google-cloud/text-to-speech`),需等上游 `google-gax` 發布升級後才能經 `npm audit fix` 或手動 `overrides` 拉高;若用 `package.json` `overrides`/`resolutions` 強制指定 `protobufjs` 版本,風險是 google-gax 內部可能對特定次版本行為有隱性假設,但因為本 repo 完全不觸發相關 API surface(TextToSpeechClient 從未被呼叫),破壞性風險低。建議順手評估是否移除 `@google-cloud/speech`(未使用)與改為動態 `import()` `@google-cloud/text-to-speech`,減少無謂的 attack surface / bundle size。

---

## 2. langsmith `<=0.5.26`(high — SSRF via tracing header injection + prototype pollution)

安裝版本:`langsmith@0.3.87`(`npm ls langsmith` 確認),落在受影響區間。

**依賴類型**:直接依賴(`package.json:` `"langsmith": "^0.3.0"`),另被 `@langchain/core@0.3.80` 以 deduped 形式間接依賴同一份。

**本 repo 有實際整合**(檔案:行號):
- `server/services/langsmithTracer.ts:9`:`const { Client } = await import("langsmith");` 動態建立 `Client`(`langsmithTracer.ts:10-13`)。
- `traceToolRun()`(`langsmithTracer.ts:39-86`)呼叫 `client.createRun({...})`(`langsmithTracer.ts:56`),是本 repo 對 LangSmith SDK 唯一的呼叫入口。
- 被 12 處呼叫,涵蓋 prod 生成管線:`server/routes/aiProxy.ts:634`、`server/services/modelClients.ts:497,519,723,742,898,917`、`server/services/falDispatcher.ts:1188,1215`、`server/services/loraTrainer.ts:172,185`、`server/routers/imageStudio.ts:167,183,212,230,265,289`、`server/routers/videoStudio.ts:132,148,177,193`、`server/routers/proStudio.ts:158,174,204,220,260,284`。

### 2a. SSRF via tracing header injection(CVE-2026-25528 / GHSA-v34v-rq6j-cj6p)

**機制**(已用 WebSearch 查證官方 advisory):此弱點觸發條件是應用程式呼叫 `RunTree.fromHeaders()`(或使用 `TracingMiddleware` 自動傳遞 tracing context),把「外部/使用者可控的 HTTP headers」(例如 `baggage: langsmith-replicas=[{"api_url":"https://attacker.com"}]`)餵給 SDK,SDK 未過濾就把其中的 `api_url` 當作要送 trace 的目的地,造成 SSRF + trace 資料外洩。

**本 repo 使用點查證**:全 repo Grep `fromHeaders|RunTree|baggage|langsmith-trace` 僅命中 `shared/appRegistry.ts:708`(字串常量 `id: "langsmith-traces"`)與 `server/routers/brainPipeline.ts:1670`(字串常量 `id: "service:langsmith-tracer"`)——皆是識別碼字串,與 header 解析無關。`langsmithTracer.ts` 自己建立 `Client` 並直接呼叫 `client.createRun(...)`,**從未**呼叫 `RunTree.fromHeaders()`,也沒有任何 middleware 把 incoming request 的 headers(如 `baggage`)轉交給 langsmith SDK。

**可達性判定:not-reachable**。本 repo 的整合方式(直接 `new Client().createRun()`)完全不經過該 CVE 需要的觸發函式;沒有任何程式碼把外部 HTTP header 值交給 langsmith SDK 做 tracing-context 解析。

**攻擊者輸入來源**:若要重新開放此攻擊面,唯一方式是未來改用 `RunTree.fromHeaders(req.headers)` 之類 API 承接使用者可控 header——目前不存在。

### 2b. Prototype pollution(GHSA-fw9q-39r9-c252,"Incomplete `__proto__` Guard in Internal lodash `set()`")

**機制**:SDK 內部使用 lodash `set()` 依「路徑字串」寫入物件,若路徑字串來自不可信輸入且含 `__proto__`,可污染原型鏈。

**本 repo 使用點查證**:`traceToolRun()` 傳給 `client.createRun()` 的 `inputs`/`outputs` 一律是**固定的 literal 鍵名**組成的物件(如 `provider`、`model`、`route`、`endpoint`、`request_bytes`、`prompt`、`voice_id`、`input_keys` 等),逐一檢視 12 個呼叫點(見上方檔案清單)後確認:
  - 使用者可控的值只以「陣列元素」或「字串值」形式出現,例如 `body_keys: Object.keys(bodyObj)`(`server/routes/aiProxy.ts:644`)、`input_keys: Object.keys(input)`(`server/routers/imageStudio.ts:271,295`、`server/routers/proStudio.ts:266,290`、`server/services/falDispatcher.ts:1195,1222`)——這些是「鍵名陣列」被塞進一個固定名稱的屬性(`body_keys`/`input_keys`)裡,不是把使用者輸入的鍵名直接當成 `inputs` 物件本身的屬性鍵。
  - 唯一把使用者原始字串直接放進 `inputs` 的情形(如 `prompt: params.prompt.slice(0, 500)`,`server/services/modelClients.ts:504,526`;`text_preview: params.text.slice(0, 500)`,`modelClients.ts:731,750`)一律是**值**而非**鍵**,且經 `slice(0,500)` 截斷、又會被 `langsmithTracer.ts:20-37` 的 `summarize()` 再過一次(遞迴但只操作既有鍵,不會依攻擊者字串動態產生新鍵路徑)。
  - 沒有任何呼叫點把整個 `req.body` 或攻擊者可完全控制鍵名結構的巢狀物件,原封不動地傳給 `inputs`/`outputs`。

**可達性判定:reachable-limited**。理由:LangSmith SDK 本身確實在 prod 呼叫鏈上(`traceToolRun` 掛在真實生成 API 上),且套件版本確實含此弱點;但要觸發 lodash `set()` 的 `__proto__` 污染,通常需要攻擊者能操控「物件鍵名/路徑」而非僅操控字串值——本 repo 目前所有呼叫點都只把攻擊者輸入放進固定鍵的字串值裡,沒有讓攻擊者控制鍵名本身進入被傳給 SDK 的物件結構。故標記為 reachable-limited 而非 not-reachable(SDK 內部其他呼叫路徑或未來新增的 traceToolRun 呼叫點若不慎把原始 body 物件整包傳入,即可能重新打開此面),也非 reachable-prod(目前找不到具體、可驗證的攻擊者可控鍵名輸入點)。

**prod/dev**:LangSmith 整合是 prod runtime 的一部分——`LANGCHAIN_TRACING_V2` 預設值為 `"true"`(`server/_core/env.validated.ts:523`),只要維運端設定了合法格式(`lsv2_pt_`/`lsv2_sk_` 開頭)的 `LANGSMITH_API_KEY`(`env.validated.ts:220-231` 有自我修復邏輯,格式不符會被清空,`env.validated.ts:521`),`getLangSmithClient()`(`langsmithTracer.ts:5-18`)就會啟用,`traceToolRun` 掛在 image/video/audio/LoRA 等**真實生產 API** 上。`LANGCHAIN_ENDPOINT`(`env.validated.ts:524-527`,預設 `https://api.smith.langchain.com`)是**伺服器端環境變數**,並非每請求可調參數,不受單一 HTTP request 影響。

**修法與破壞性風險**:`npm audit fix` 會將 `langsmith` 升到 `>=0.4.6`(修 SSRF)並含 prototype-pollution 修補。由於是直接依賴且僅在單一檔案(`langsmithTracer.ts`)使用 `Client`/`createRun` 這組穩定 API,升級風險低;建議連同 `@langchain/core`(deduped 依賴同一份 langsmith)一併確認相容性後,直接升級 `langsmith` 至修補版本。

---

## 3. fast-xml-builder `<=1.1.6`(high — 屬性值未跳脫引號繞過)

**依賴類型**:double-transitive。無 `fast-xml-builder`/`fast-xml-parser` 出現在 `package.json` 直接依賴列表中(僅在 `package-lock.json` 出現)。

**引入鏈**(`npm ls fast-xml-builder` 確認):
```
healing-studio
└─ @google-cloud/storage@7.19.0 (package.json:43,直接依賴)
    └─ fast-xml-parser@5.5.8
        └─ fast-xml-builder@1.1.4
```

**使用點查證**:全 repo(排除 `node_modules`/`package.json`/`package-lock.json`)對 `@google-cloud/storage` 做 Grep,**零** import/require 命中——`@google-cloud/storage` 雖列在 `package.json:43` 為直接依賴,但沒有任何 `.ts`/`.tsx`/`.js` 檔案 import 它(`new Storage(...)` 全 repo 搜尋也無結果)。也沒有任何檔案直接 import `fast-xml-parser` 或 `fast-xml-builder` 產生 XML。

**可達性判定:not-reachable**。`@google-cloud/storage` 是完全未被呼叫的宣告依賴(dead dependency),其內部才會用 `fast-xml-parser`(GCS SDK 用來解析 XML 錯誤回應/multipart),而 `fast-xml-parser` 才會用 `fast-xml-builder` 產生 XML。既然最外層的 `@google-cloud/storage` 從未被 import,整條鏈路都不會被載入或執行,沒有任何程式碼路徑會呼叫到 `fast-xml-builder` 產生 XML,也就沒有攻擊者可控輸入的問題。

**攻擊者輸入來源**:無(鏈路不可達)。

**prod/dev**:不適用(死碼,連 dev 都不會執行到)。

**修法與破壞性風險**:`npm audit fix` 會升級 `fast-xml-parser`(進而升級 `fast-xml-builder`)。由於整條鏈完全未被呼叫,升級零破壞性風險;更值得做的是評估直接移除 `@google-cloud/storage` 這個未使用的直接依賴,減少 supply-chain surface(目前它同時也是本文件外的 `protobufjs`/`grpc` 分析範圍之外、但仍會被 `npm audit` 計入的來源之一)。

---

## 4. @grpc/grpc-js `1.14.0–1.14.3`(high — malformed request 造成 server crash)

安裝版本:`@grpc/grpc-js@1.14.3`(`npm ls @grpc/grpc-js --all` 確認),落在受影響區間。

**依賴類型**:transitive,經 `google-gax`(同第 1 節分析的鏈路):
```
healing-studio
└─ @google-cloud/speech@7.3.0 (直接依賴,但未被 import)
    └─ google-gax@5.0.6
        └─ @grpc/grpc-js@1.14.3
```
`@google-cloud/text-to-speech@6.4.0`(唯一被實際 import 的相關套件,見第 1 節)同樣依賴 `google-gax@5.0.6`,故也共用此 deduped 版本。

**使用點查證**:全 repo Grep `@grpc/grpc-js|grpc\.Server|createServer.*grpc|new grpc\.Server|addService\(|bindAsync\(`,除 `package.json`/`package-lock.json`/研究文件外**無任何命中**。本 repo 完全沒有自行啟動 gRPC server(沒有 `new grpc.Server()`、`addService()`、`bindAsync()`)。唯一使用點與第 1 節相同——`server/services/voiceCompiler.ts:717-728` 透過 `google-gax` 產生的 `TextToSpeechClient` 當 **gRPC client**(向 Google 官方 Text-to-Speech API 發送請求),而該函式如第 1 節所述是死碼、未被任何路由呼叫。

**可達性判定:not-reachable**。理由兩層:
1. 此弱點的攻擊面是「gRPC **server** 收到惡意/畸形請求而崩潰」——本 repo 從未以 `@grpc/grpc-js` 建立任何 server,只可能透過 google-gax 生成的 client 呼叫出站,角色互換使該 CVE 的觸發條件(服務端接收攻擊者請求)不存在。
2. 即使把它當 client 端 library 使用來考慮(例如 client 處理來自「惡意伺服器」的回應而崩潰),本 repo 連這個 client 呼叫路徑(`synthesizeWithGoogleTTS`)本身都未被任何 prod 流程執行(死碼,見第 1 節)。

**攻擊者輸入來源**:無(不是 server,且 client 路徑不可達)。

**prod/dev**:不適用。

**修法與破壞性風險**:`npm audit fix` 升級路徑同第 1 節,依賴 `google-gax` 上游放出相容的 `@grpc/grpc-js` 版本;因完全未被執行,升級破壞性風險低。

---

## 綜合結論與建議

| 套件 | 依賴類型 | 可達性判定 | 關鍵理由 |
|---|---|---|---|
| protobufjs | transitive(經 @google-cloud/speech / text-to-speech → google-gax) | **not-reachable** | 只用 Google 官方內建 schema;唯一呼叫點 `voiceCompiler.ts` 的 `synthesizeSpeech` 是死碼(`routers.ts:115` 明文停用) |
| langsmith — SSRF(header injection) | 直接依賴 | **not-reachable** | 本 repo 從未呼叫 `RunTree.fromHeaders()`,只用 `Client.createRun()` |
| langsmith — prototype pollution | 直接依賴 | **reachable-limited** | SDK 在 prod 呼叫鏈上,但目前所有呼叫點只把攻擊者輸入當「值」放進固定鍵,不放進鍵名結構 |
| fast-xml-builder | double-transitive(經 @google-cloud/storage → fast-xml-parser) | **not-reachable** | `@google-cloud/storage` 本身零 import,整條鏈是死依賴 |
| @grpc/grpc-js | transitive(經 google-gax) | **not-reachable** | 本 repo 不建立 gRPC server;唯一 client 呼叫點是死碼 |

**共通建議**:
1. 四個弱點的 `fixAvailable=true` 修法(`npm audit fix` / 升級 `google-gax`、`langsmith`)皆可放心套用——就算某些鏈路目前不可達,升級也不會破壞現有功能(因為相關程式碼路徑本來就沒被執行或只是純字串傳遞)。
2. `langsmith` 建議優先升級到 `>=0.4.6`,因為它是唯一在 prod 生產流量上「確實執行中」的套件(其餘三個都落在死碼/未使用依賴上),即使目前找不到 reachable-prod 的具體攻擊路徑,盡快把 SDK 本身的已知漏洞面收斂仍是必要的縱深防禦。
3. 建議另案評估移除兩個宣告了卻完全未使用的直接依賴:`@google-cloud/speech`(package.json:42)與 `@google-cloud/storage`(package.json:43)——移除後可同時消滅 protobufjs/@grpc-js(經 speech)以及 fast-xml-builder(經 storage)這幾條 supply-chain 弱點鏈路的來源之一(text-to-speech 仍會留下 google-gax→protobufjs/@grpc-js 的鏈,故 protobufjs/@grpc-js 兩項無法只靠移除 speech 就完全消除,仍建議升級 google-gax)。
4. 若未來要重新啟用 `voiceCompiler.ts` 的 Google TTS fallback(`synthesizeWithGoogleTTS`),應在啟用前重新評估 protobufjs/@grpc-js 當時的版本狀態,因為屆時该死碼會變成 reachable-prod。
