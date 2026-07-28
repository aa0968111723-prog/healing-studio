# CC3 — falModels + modelResearcher 服務深挖
- 產生日期:2026-07-03
- 依據 commit:812fdb
- 稽核檔案:server/services/falModels.ts(2434)、server/services/modelResearcher.ts(1712)

範圍聲明:聚焦 falModels.ts 的模型目錄與 dispatch(對照 X3 的 X3(catalog↔dispatcher 不同步)、
B-12(查無模型回退 5pts))、modelResearcher.ts 的外部研究/事實查核流程(對照 Z1 指出的
HF MCP 可強化空間)。falDispatcher.ts / spiritDispatcher.ts / orb-agent-roles.ts /
modelPricing.ts / perplexityThrottle.ts 僅作為必要的呼叫端交叉驗證引用,不重複展開其
獨立缺陷(已有 X3/其他文件涵蓋),proStudio.ts 自身的計費管線**未在本檔案深挖範圍內**。

所有「發現」均先讀對應原始碼行號再下結論;Critical 發現額外用 `tsx` 直接匯入
`falModels.ts`/`spiritDispatcher.ts` 執行實測驗證(非僅靜態推論),執行紀錄列於各發現的
「實測」小節。

---

## 摘要(依嚴重度)

| 嚴重度 | 編號 | 一句話 | Cluster |
|---|---|---|---|
| Critical | C1 | `getFalModelById()` 不帶 category 時「靜默選中宣告順序最早的一筆」,11 個 modelId 橫跨 2–5 個類別共用同一 ID,關鍵呼叫端(`spiritDispatcher.ts`/`falDispatcher.ts`)明知正確 category 卻仍呼叫不帶 category 版本,導致 `spirit.invoke` 對至少 16 種精靈的預設 LLM/JSON 呼叫、以及 video-specialist 的預設語音轉文字呼叫 100% 失敗(已實測) | contract-mismatch |
| High | C2 | 對照 X3 B-12:截至本次稽核,`fal-ai/tripo3d`(image-to-3d + text-to-3d)、`fal-ai/flux/dev/controlnet`(image-to-image)這 2 個現行可派工模型仍完全缺billing 目錄條目,一律落回 5pts 保底計費 — 確認 X3 已知缺口尚未修復,且範圍內排除了其他新缺口 | billing |
| Medium | M1 | `modelPricing.ts` 存在 22 筆對應不到任何現行 dispatch 模型的殘留定價條目(對應已下架/替換的舊模型),證實兩份目錄只有單向(dispatch→billing 補漏)被注意,反向(billing 側清理死條目)從未執行 | deadcode |
| Medium | M2 | `modelResearcher.ts` 呼叫 Perplexity Native / OpenRouter Sonar 的真實外部付費 API,完全沒有寫入任何成本紀錄(`ai_usage_events`/`cost_ledger`/LangSmith 皆無),是繼 X3 C2(`llm.ts` reasoning 呼叫)之後獨立的第二個成本黑洞,但僅 cron/admin 觸發,非使用者可濫用面 | billing |
| Low | L1 | `callPublicDiscovery`(HN/Reddit 免金鑰後備來源)繞過 `discoveryPayloadSchema` 的 Zod 驗證,與 LLM 路徑的資料品質保證不對稱 | contract-mismatch |
| Low | L2 | `modelEnrichmentRedis.ts` 用阻塞式 `redis.keys()` 而非游標式 `SCAN`,每次伺服器啟動暖身都會執行 | persistence |
| Low | L3 | `callFalModel`/`falQueueSubmitModel` 本身不驗證 `modelId` 是否為 `fal-ai/` 前綴,依賴呼叫端已預先檢查(現況不可利用,屬縱深防禦缺口) | other |

---

## Critical

### C1 — `getFalModelById()` 跨類別碰撞,`spirit.invoke` 對多數精靈的預設 LLM/JSON 呼叫 100% 失敗

**發現**

`falModels.ts:2223-2240` 定義 `getFalModelById`,其自身文件註解已明講風險:

```
2224: * 依 modelId 查詢模型設定。
2225: * 可選 category 收窄查詢範圍，避免跨類別 modelId 衝突
2226: * （例如 fal-ai/trellis 同時存在於 image-to-3d 與 text-to-3d）。
2228: export function getFalModelById(
2229:   modelId: string,
2230:   category?: FalCategory
2231: ): FalModelConfig | undefined {
2232:   if (category) {
2233:     return FAL_MODEL_CATALOG[category]?.find(m => m.modelId === modelId);
2234:   }
2235:   for (const models of Object.values(FAL_MODEL_CATALOG)) {
2236:     const found = models.find(m => m.modelId === modelId);
2237:     if (found) return found;
2238:   }
2239:   return undefined;
2240: }
```

不帶 `category` 時,回傳值取決於 `FAL_MODEL_CATALOG` 物件字面量中「類別鍵宣告的先後順序」
(JS 物件字串鍵保序):`audio-to-text`(133)→`image-to-3d`(170)→`image-to-image`(266)→
`image-to-json`(487)→`image-to-video`(543)→`json`(813)→`llm`(859)→`text-to-3d`(915)→
`text-to-audio`(958)→`text-to-image`(1097)→`text-to-json`(1322)→`text-to-speech`(1368)→
`text-to-video`(1558)→`training`(1761)→`video-to-audio`(1852)→`video-to-text`(1903)→
`video-to-video`(1959)。

用腳本逐一比對全部 145 個模型條目後,確認 **11 個 modelId 橫跨 2–5 個不同類別重複出現**
(且不同類別的條目 `inputSchema`/`label` 皆不同,不是單純的別名):

| modelId | 出現類別(依宣告順序,第一個 = 實際會被回傳的) | 行號 |
|---|---|---|
| `fal-ai/any-llm` | image-to-json, json, llm, text-to-json, video-to-text | 489 / 815 / 861 / 1324 / 1925 |
| `fal-ai/whisper` | audio-to-text, video-to-text | 156 / 1905 |
| `fal-ai/wizper` | audio-to-text, video-to-text | 146 / 1915 |
| `fal-ai/trellis` | image-to-3d, text-to-3d | 172 / 917 |
| `fal-ai/tripo3d` | image-to-3d, text-to-3d | 197 / 938 |
| `fal-ai/llava-next` | image-to-json, video-to-text | 499 / 1945 |
| `fal-ai/moondream` | image-to-json, video-to-text | 509 / 1935 |
| `fal-ai/wizardcoder` | json, text-to-json | 835 / 1354 |
| `fal-ai/outlines` | json, text-to-json | 845 / 1334 |
| `fal-ai/meta-llama/llama-3.1-8b-instruct` | llm, text-to-json | 881 / 1344 |
| `fal-ai/stable-audio` | text-to-audio, video-to-audio | 960 / 1869 |

關鍵呼叫端都**已經知道正確 category**,卻仍呼叫不帶 category 的版本:

- `server/services/spiritDispatcher.ts:145` — `const modelConfig = getFalModelById(modelId);`
  緊接著在 166 行用 `modelConfig.category`(此時已可能是錯的)做輸入需求判斷:
  `describeRequiredInputForCategory(modelConfig.category)`,在 186 行用同一個錯誤 category
  做授權檢查 `canSpiritCallFalModel(spirit, modelId)`,並在 205 行把錯誤 category 傳給
  `dispatchFalTask({ ..., category: modelConfig.category, spirit })`。
- `server/services/falDispatcher.ts:338` — `let modelConfig = getFalModelById(targetModelId);`
  同樣不帶 `category`,即使 `input.category`(280-285 行解構出的 `category`)本身就在作用域內。
- `falModels.ts:2331-2338` — `canSpiritCallFalModel` 內部同樣呼叫不帶 category 的
  `getFalModelById(modelId)`(2335 行)。

`shared/orb-agent-roles.ts:1907-1995` 的 `SPIRIT_MODEL_CAPABILITIES` 顯示:
`TEXT_REASONING_CATEGORIES = ["llm","json","text-to-json"]`(1907-1911)被
director/researcher/learning-specialist/accountant/quality-coach/inspector/legal-advisor/
security-guard/chief-orchestrator/onboarding-coach/notes-curator/settings-detail/
inspiration-specialist 共 12 個角色使用;`navigator`/`companion` 僅有 `["llm"]`
(1954-1955)。這些角色的授權清單**都不包含 `image-to-json`**。而
`server/services/falDispatcher.ts:1290-1307` 的 `DEFAULT_FAL_ENGINES` 顯示
`fal-ai/any-llm` 正是 `llm`/`json`/`imageToJson`/`textToJson` 四個類別的**預設引擎**,
`fal-ai/whisper` 是 `videoToText` 的預設引擎。

**實測**(以 `tsx` 直接匯入正式原始碼執行,非模擬):

```
Unscoped getFalModelById('fal-ai/any-llm').category = image-to-json
canSpiritCallFalModel('navigator', 'fal-ai/any-llm') = false
canSpiritCallFalModel('director', 'fal-ai/any-llm') = false
canSpiritCallFalModel('companion', 'fal-ai/any-llm') = false
canSpiritCallFalModel('image-specialist', 'fal-ai/any-llm') = true
pickDefaultModelForSpirit('navigator') = fal-ai/any-llm

invokeSpiritModel({ spirit: "navigator", modelId: "fal-ai/any-llm", prompt: "where is the video studio page?" })
=> {
  "success": false,
  "modelLabel": "Any LLM Vision→JSON",
  "category": "image-to-json",
  "pointsDeducted": 0,
  "error": "這個任務需要一張參考圖片,請先上傳或附上圖片 URL 後再試。"
}
```

對 `director`/`companion`(未帶 `modelId`,走 `pickDefaultModelForSpirit` 自動選模型)重複測試,
結果完全相同 —— **不是只有「顯式指定 modelId」的邊角案例,連預設路徑都會踩到**。

再對第二個高流量案例 `fal-ai/whisper`(`videoToText` 的 `DEFAULT_FAL_ENGINES`)實測:

```
Unscoped getFalModelById('fal-ai/whisper') => { category: "audio-to-text", inputSchema: { audioUrl: true }, label: "Whisper ASR" }
canSpiritCallFalModel('video-specialist', 'fal-ai/whisper') = false
pickDefaultModelForSpirit('video-specialist', {}) = fal-ai/kling-video/v2.1/pro/text-to-video   // (不同任務時預設不會選到 whisper，但一旦顯式指定就會踩雷)

invokeSpiritModel({ spirit: "video-specialist", modelId: "fal-ai/whisper", videoUrl: "https://example.com/clip.mp4", prompt: "transcribe this clip" })
=> {
  "success": false,
  "modelLabel": "Whisper ASR",
  "category": "audio-to-text",
  "error": "這個任務需要一段音檔(轉寫 / 分析),請先上傳音檔後再試。"
}
```

`video-specialist`(影影)已經正確帶了 `videoUrl`、且本來就對 `video-to-text` 有授權
(`orb-agent-roles.ts:1925-1931`),卻被要求「請先上傳音檔」而遭拒 —— 完全是 falModels.ts
內部類別解析錯誤造成的誤導性錯誤,不是使用者的問題。

**影響**

1. `server/routers/spiritRouter.ts:100-108` 的 `spirit.invoke` 是全站「15 位精靈可直接
   呼叫 fal 模型」機制的唯一入口,標記為 `protectedProcedure`(任何已登入使用者皆可呼叫,
   `modelId` 是自由字串,無白名單限制於 zod schema 層)。對上述 12+2 = 14 個純文字精靈,
   任何走「預設模型」或顯式指定 `fal-ai/any-llm` 的呼叫,都會被錯誤地要求「請先上傳圖片」
   而 100% 失敗,即使 `describeRequiredInputForCategory` 這道檢查通過了,後面的
   `canSpiritCallFalModel` 也一樣會用錯誤的 `image-to-json` 類別誤判授權失敗。
2. `critic`/`community-manager` 的授權清單本身**包含** `image-to-json`(1944-1951,
   1967-1975),所以对它们而言 `canSpiritCallFalModel` 這一關不會擋,但只要該輪對話沒帶
   `imageUrl`(絕大多數純文字/純評論場景都不會有),`describeRequiredInputForCategory` 仍會
   先行擋下 —— 也就是說,這個 bug 對「幾乎所有不巧帶 `imageUrl` 的呼叫」一視同仁地誤判需要
   圖片,`image-specialist` 之所以「恰好正常」只是因為它使用 any-llm 時原本就是做
   image-to-json 任務、剛好帶著 imageUrl。
3. 因為 `modelPricing.ts:3277`(`estimatePoints`)只用 `modelId` 查價、完全不讀
   falModels.ts 回傳的 `category`,這個 bug **不會**造成計費損失或多扣點 —— 是
   fail-closed(拒絕生成)而非 fail-open(多收費),與 X3 C1/C2 描述的「多扣點」機制性質不同。
4. `find` 全站搜尋確認 `server/services/spiritDispatcher.ts` 沒有對應的 `.test.ts`,
   `invokeSpiritModel`/`pickDefaultModelForSpirit` 零測試覆蓋;既有的
   `server/falModels.test.ts`(25 tests,已實際執行全數通過)、
   `server/model-researcher.test.ts`(10 tests,已執行通過)完全沒有測到這條路徑 ——
   這不是「測試失敗被忽略」,而是「這條路徑從未被寫過測試」。
5. 目前正式站的 orb-chat UI(`client/src/contexts/GlobalOrbChatContext.tsx:2384-2386,
   2540, 4153`)呼叫 `spiritInvokeMut.mutateAsync` 時只對 `image-specialist` /
   `video-specialist` / `music-specialist` / `voice-specialist` / `training-specialist`
   這 5 個「生成型」精靈觸發(`tool.kind === "fal-generation"`),且都不帶 explicit
   `modelId`,其預設模型也不是這裡列出的碰撞 id ——**這條特定 UI 路徑目前是否已被真實流量踩到,
   未在本檔案完整驗證**。但 `spirit.invoke` 本身是可被任何已登入使用者或未來功能(例如
   `server/services/spiritTools/composerTools.ts:121` 的 `dispatchAsComposer`,要求呼叫端
   顯式傳入 `modelId`)直接觸發的公開 tRPC mutation,一旦任何呼叫端指定
   `fal-ai/any-llm`/`fal-ai/whisper`/`fal-ai/wizper` 等碰撞 id,就會立即重現上述失敗。

**建議**

1. `spiritDispatcher.ts:145`、`falDispatcher.ts:338`(以及同樣不帶 category 呼叫的
   `server/routers/videoStudio.ts:257,446`、`server/services/agentToolExecutor.ts:198`)
   凡是呼叫端已經知道或能推得正確 category 時,一律改用
   `getFalModelById(modelId, category)` 的收窄版本,不要退回「全目錄第一個符合」。
   `invokeSpiritModel` 目前雖然「還不知道」category(這正是要查表的目的),但至少應該在
   查完 category 後,若呼叫端後續有機會提供 category 提示(例如前端 `listModels` 回傳的
   `category` 欄位),應該把它一併傳回收窄查詢。
2. 針對跨類別重複出現、且 `inputSchema` 不同的 modelId(上表 11 個),應在
   `assertNoDuplicateModelIds`(2275-2294)旁邊新增一個「跨類別語意衝突」檢查 —— 至少
   console.warn 列出這些 id,提醒維護者這是已知的地雷,而不是任由呼叫端各自决定要不要收窄。
3. 比照 `server/falModels.test.ts:237-253` 已經對 `fal-ai/trellis` 做的「category
   narrowing」測試,替 `invokeSpiritModel`/`canSpiritCallFalModel` 補上針對
   `fal-ai/any-llm`、`fal-ai/whisper`、`fal-ai/wizper` 的迴歸測試,鎖死這條路徑,避免重複回歸。

---

## High

### C2 — 對照 X3 B-12:`fal-ai/tripo3d`、`fal-ai/flux/dev/controlnet` 仍缺billing 目錄條目

**發現**

以腳本逐一解析 `falModels.ts` 全部 145 個模型條目(其中 8 個標記 `disabled: true`,行號
744/1408/1597/1674/2100/2122/2142/2163)與 `modelPricing.ts` 的 `MODEL_PRICING_CATALOG`
(200 個條目)做全量比對,確認**目前唯二**同時滿足「dispatch 目錄中 active(非
disabled)」且「billing 目錄完全查無」的 modelId:

- `fal-ai/tripo3d` —— `image-to-3d`(falModels.ts:197)與 `text-to-3d`(falModels.ts:938)
  兩個類別各有一筆,均非 disabled,`modelPricing.ts` 全文搜尋 `"fal-ai/tripo3d"` 零命中。
- `fal-ai/flux/dev/controlnet` —— `image-to-image`(falModels.ts:310),非 disabled,
  `modelPricing.ts` 全文搜尋零命中。

`modelPricing.ts:3277-3288`(`estimatePoints`)對查無定價的 modelId 一律回退固定
`basePoints: 5`(`breakdown: "未知模型(標準計費 5 pts)"`),與 X3 報告
(`X3-pricing-cost-deepdive.md` H3、`X0-carpet-scan-synthesis.md:46` 引用為 B-12)描述的
機制完全一致。

**影響**

使用者呼叫 TripoSG(圖生3D「TripoSG (Zero123)」/ 文生3D「TripoSG Pro 3D」)或 Flux
ControlNet(圖生圖姿勢/深度/邊緣控制)這三個現行可用模型時,無論 fal.ai 真實成本多高,
系統一律只收 5 pts —— 這是 X3 已知問題(B-12)在 falModels.ts 端的具體呼叫實例,**截至本次
稽核(commit 812fdb)仍未修復**。負向結果:除這 2 個 modelId 之外,腳本比對未發現其他
active、非 disabled 的 dispatch 模型缺對應billing 條目 —— 不是新增的缺口類別,而是對既有
已知缺口的「仍未關閉」確認 + 精確鎖定到 3 筆(2 個 modelId、3 個目錄條目)。

**建議**

與 X3 H3 建議一致:立即為 `fal-ai/tripo3d`、`fal-ai/flux/dev/controlnet` 在
`MODEL_PRICING_CATALOG` 補上依真實 fal.ai 定價換算的條目;長期建議比照
`videoCatalogConsistency.test.ts` 的模式,建一份涵蓋 falModels.ts 全部 17 個類別(不只
影片)的 catalog↔billing SSOT 一致性測試,在 CI 擋下未來的新缺口。

---

## Medium

### M1 — `modelPricing.ts` 存在 22 筆對應不到任何現行 dispatch 模型的殘留定價條目

**發現**

反向比對(billing 目錄有、dispatch 目錄完全查無,不分 active/disabled)找出 22 個
`fal-ai/*` modelId 只存在於 `modelPricing.ts`,在目前的 `FAL_MODEL_CATALOG` 中完全找不到:
`fal-ai/audioldm2`、`fal-ai/controlnet-union`、`fal-ai/dreamgaussian`、
`fal-ai/elevenlabs/dubbing`、`fal-ai/fantasia3d`、`fal-ai/flux-schnell`、
`fal-ai/kling-video/create-voice`、`fal-ai/kling-video/v1.5/pro/image-to-video`、
`fal-ai/kling-video/v1.5/pro/text-to-video`、`fal-ai/longcat-single-avatar/audio-to-video`、
`fal-ai/ltx-2-19b/distilled/audio-to-video/lora`、`fal-ai/meshy-4`、
`fal-ai/minimax/video-01`、`fal-ai/minimax/video-01/image-to-video`、`fal-ai/playai-tts`、
`fal-ai/shap-e`、`fal-ai/sonauto`、`fal-ai/stable-zero123`、`fal-ai/wan-t2v-v2.1`、
`fal-ai/wan-v2v`、`fal-ai/wan/v2.2-14b`、`fal-ai/zero123plus`。

`falModels.ts` 內多處「替代」描述文字證實這些正是已被替換掉的舊模型,例如:

- `falModels.ts:200`(`fal-ai/tripo3d` 描述):「TripoSG 高品質單張圖片3D重建
  (替代 Stable Zero123）」→ 對應死條目 `fal-ai/stable-zero123`。
- `falModels.ts:942`(同 modelId 的 text-to-3d 版描述):「支援風格提示與遊戲級資產
  （替代 Shap-E / Meshy-4)」→ 對應死條目 `fal-ai/shap-e`、`fal-ai/meshy-4`。
- `falModels.ts:916`(`fal-ai/hyper3d/rodin` 描述):「高精度文字到3D資產生成
  （替代 Fantasia3D)」→ 對應死條目 `fal-ai/fantasia3d`。

**影響**

這些殘留條目本身不會造成計費風險(dispatcher 找不到對應 modelId 就不會呼叫到它們),但
證實兩份目錄的同步機制**只有單向被注意**:X3 已記錄的「12 則補: 回填註解」都是「dispatch
有、billing 補上缺漏」的正向修補;billing 側清理「已下架模型的死條目」則從未執行,導致
`MODEL_PRICING_CATALOG` 只會愈滾愈大,稽核時難以快速分辨「這個 key 是死的還是真的漏了 dispatch
條目」,間接推高了 C2/X3-B12 這類缺口反覆發生 12+ 次卻遲遲未被系統性攔下的維護成本。

**建議**

在 C2 建議的 SSOT 一致性測試中,除了「dispatch 有、billing 缺」的正向檢查,加一個「billing
有、dispatch(active 或 disabled)完全找不到」的反向清單並定期人工複核是否可安全刪除,
避免目錄無上限累積死條目。

### M2 — `modelResearcher.ts` 的 Perplexity/OpenRouter 呼叫完全沒有成本紀錄

**發現**

`server/services/perplexityThrottle.ts`(346 行)是全站集中的 Perplexity 節流器,但只做
in-memory rolling-window 的「呼叫次數」限制(`getLimits`/`recordPerplexityCall`),不記錄
任何金額。對 `server/services/modelResearcher.ts` 與 `server/services/perplexityThrottle.ts`
全文搜尋 `ai_usage_events`/`costLedger`/`cost_ledger`/`LangSmith`/`langsmith`,均為零命中。

實際發起真實外部付費 API 呼叫的四個函式 ——
`callPerplexity`(modelResearcher.ts:1495-1553)、
`callOpenRouterSonar`(1555-1599)、
`callPerplexityDiscovery`(1184-1225)、
`callOpenRouterDiscovery`(1227-1269)—— 都是直接 `fetch()` 打
`https://api.perplexity.ai/chat/completions`(53 行)/
`https://openrouter.ai/api/v1/chat/completions`(54 行),呼叫成功後只呼叫
`recordPerplexityCall({ feature: "web_search", userId })`(408-412、624-627 行)做次數計數,
沒有任何一處把美金花費寫回任何 ledger 或分析表。

**影響**

這條路徑目前只被 `server/jobs/modelCatalogResearchJob.ts` 的每日 03:30 cron
(`DEFAULT_CRON_SCHEDULE`)、啟動 90 秒暖機(`WARMUP_DELAY_MS`),以及
`server/routers/aiModels.ts` 的 `refreshOne`/`refreshAll`/`refreshStale`/`runDiscovery`
(均為 `adminProcedure`,已核實非 `publicProcedure`/`protectedProcedure`)觸發,系統呼叫的
`userId` 皆為 `null` —— **不是使用者可直接觸發的付費濫用面**,這點降低了嚴重度、也是本次
稽核的負向結果之一。但這是繼 X3 C2(`server/_core/llm.ts` 的 reasoning 呼叫直連供應商、完全
不寫 `ai_usage_events`)之後,`costAnalytics.ts` 完全看不到的**第二個獨立成本黑洞**:規模雖小
(一天一輪 + 偶發手動觸發),但只要 Perplexity/OpenRouter 這類研究型 API 費率調整或用量成長,
營運端在財務對帳報表上永遠看不到這塊支出,也無法歸因是哪個功能造成的。

**建議**

比照 X3 C2 建議的「invokeLLM 出口統一寫入 `ai_usage_events`」同一機制,在
`callPerplexity*`/`callOpenRouter*` 呼叫成功後補一筆最小成本估算紀錄(即使只是概略的
per-call 固定成本或以 `max_tokens` 概算),讓所有會花錢的外部 API 呼叫都至少有一條可被
營運端看見的紀錄,不要因為「呼叫端是 cron 而非使用者」就假設可以不記帳。

---

## Low

### L1 — `callPublicDiscovery` 繞過 `discoveryPayloadSchema` 驗證

**發現**

`modelResearcher.ts:993-1107` 的 `callPublicDiscovery`(免 API key 的 HN + Reddit 後備
discovery 來源,對照 Z1 引用的同一段落 945-1034/1139-1147)手動組出
`DiscoveryItem[]`(僅用 `.slice(0,180)`/`.slice(0,280)` 做長度裁切),**從未**呼叫
`discoveryItemSchema`/`discoveryPayloadSchema.safeParse()`。相對地,LLM 來源路徑專用的
`parseDiscoveryPayload`(1271-1298)對每一筆都強制跑
`discoveryPayloadSchema.safeParse`,其中 `url` 欄位要求 `z.string().url()`
(discoveryItemSchema 定義於 321-333 行)。

**影響**

公共來源條目的 `url` 沒有格式保證 —— HN 分支(998-1039 行)只檢查 `h.url` 非空
(`if (!h.title || !h.url) continue`),未驗證是否為合法絕對網址;Reddit 分支
(1042-1092 行)則有額外處理(`d.url.startsWith("http") ? d.url : reddit.com${permalink}`)。
summary 長度上限(HN/Reddit 手動裁切 280 字)雖比 schema 的 360 字上限更嚴格,但是兩處各自
維護常數,未來任一邊調整長度容易漏改另一邊。這是資料品質/契約一致性的小缺口,不是安全性
問題 —— `discoveries` 端點(`aiModels.ts:188-202`,`publicProcedure`)下游前端如何渲染這些
欄位(是否有跳脫)**未在本檔案驗證**。

**建議**

讓 `callPublicDiscovery` 組出的 `items` 在回傳前也跑一次
`discoveryItemSchema`/`discoveryPayloadSchema.safeParse()` 過濾掉不合格項目,兩條來源路徑
共用同一份契約,而不是各自維護長度裁切邏輯。

### L2 — `modelEnrichmentRedis.ts` 使用阻塞式 `redis.keys()`

**發現**

`server/services/modelEnrichmentRedis.ts:45`(`loadAllEnrichmentsFromRedis`)與
`:73-75`(`clearAllEnrichmentsFromRedis`)都呼叫 `redis.keys(\`${KEY_PREFIX}*\`)`。
`loadAllEnrichmentsFromRedis` 在 `modelResearcher.ts:75`(`void
loadAllEnrichmentsFromRedis().then(...)`)於**每次 module load(即每次伺服器啟動)**執行一次。

**影響**

`KEYS` 是阻塞式指令,即使帶了 pattern,Redis 內部仍是掃過整個 keyspace 才過濾 —— 若正式
環境的 Redis 實例被 session/快取/rate-limit 等其他功能大量共用,每次伺服器冷啟動暖身或
admin reset 都可能造成短暫延遲尖峰。這份 store 對應的 key 數量本身受
`AI_MODELS_CATALOG.length` 限制(cron 註解提及約 64 個模型),量體不大,實際影響有限,
故列為低嚴重度而非中高。

**建議**

改用 `SCAN` 游標式迭代取代 `KEYS`,尤其 `loadAllEnrichmentsFromRedis` 是每次啟動必跑的
路徑,對大型共用 Redis 實例更值得優先修。

### L3 — `callFalModel`/`falQueueSubmitModel` 不驗證 modelId 前綴

**發現**

`falModels.ts:2379-2406`(`callFalModel`)與 `2412-2434`(`falQueueSubmitModel`)都直接把
傳入的 `modelId` 交給 `@fal-ai/client` 的 `client.subscribe`/`client.queue.submit`,不像
`falDispatcher.ts:286-290` 的 `dispatchFalTask` 開頭有
`if (!modelId.startsWith("fal-ai/")) throw new Error(...)` 這道檢查。全站搜尋確認目前只有
三個呼叫端:`falDispatcher.ts` 兩處(461、597 行,呼叫前已經過 `dispatchFalTask` 自身的
前綴檢查與目錄查找)、`server/_core/imageGeneration.ts:84`(`modelId` 為程式內硬編碼常數
`"fal-ai/flux/dev/image-to-image"`/`"fal-ai/flux-pro/v1.1"` 二選一,非外部輸入)。

**影響**

現況**不可利用**(負向結果:三個已知呼叫端均無法被外部輸入直接控制且繞過驗證),但
`callFalModel`/`falQueueSubmitModel` 本身屬於「單一防線依賴呼叫端」而非縱深防禦。若未來
新增呼叫端(例如某個新工具直接匯入 `callFalModel` 卻忘記做前綴/目錄檢查),這裡不會有
第二層防護。

**建議**

在 `callFalModel`/`falQueueSubmitModel` 內部也加上與 `dispatchFalTask` 相同的 `fal-ai/`
前綴檢查,作為縱深防禦,不依賴呼叫端自律。

---

## 負向結果(已查證不成立 / 明確排除的疑慮)

1. **IDOR**:`falModels.ts` 為純靜態模型目錄,無使用者資料;`modelResearcher.ts` 的
   `enrichmentStore`/`discoveryStore` 皆為全站共享的單例記憶體狀態,無 per-user 資源 id,
   兩檔案均未發現可橫向存取他人資料的 IDOR 路徑。
2. **Injection / eval**:對兩檔案全文搜尋 `eval(`/`new Function(`/`child_process`/`exec(`/
   `vm.` 均為零命中;所有外部 API 回應都先經 `JSON.parse` + Zod schema
   (`researchPayloadSchema`/`discoveryPayloadSchema`)驗證才寫入 store,無字串拼接執行風險。
3. **Prompt injection**:`buildResearchPrompt`(1453-1493)/`buildDiscoveryPrompt`
   (945-986)插入的 `base.name`/`base.provider`/`base.tagline`/`base.researchKeywords` 均
   來自 `shared/aiModelsCatalog.ts`(5386 行)的靜態硬編碼陣列(`AI_MODELS_CATALOG`,
   751 行起),非 DB/使用者可編輯,非外部輸入,無由使用者觸發的 prompt injection 面。
4. **Admin 端點權限**:`server/routers/aiModels.ts` 的 `list`/`getById`/`researchStats`/
   `discoveries` 為 `publicProcedure`(設計如此,唯讀),`refreshOne`/`refreshAll`/
   `refreshStale`/`runDiscovery`/`setSchedule` 皆正確標記 `adminProcedure`,無權限降級。
5. **Disabled→replacement 替換鏈完整性**:`falModels.ts` 目前 8 個 `disabled: true` 模型
   (744/1408/1597/1674/2100/2122/2142/2163)的 `replacement` 皆指向確實存在且非 disabled
   的 modelId(逐一核對 `fal-ai/kling-video/v2.1/pro/image-to-video`、
   `fal-ai/elevenlabs/tts/turbo-v2.5`、`fal-ai/kling-video/v2.1/pro/text-to-video`、
   `fal-ai/veo3`、`fal-ai/wan/v2.1/video-to-video` ×3、`fal-ai/animatediff-v2v`),無斷鏈
   或替換到另一個 disabled 模型的情形。
6. **現有測試基線**:`server/falModels.test.ts`(25 tests)、
   `server/model-researcher.test.ts`(10 tests)、`server/ai-models-router.test.ts`
   (9 tests)於本次稽核時逐一實際執行(`vitest run`),全數通過。C1 發現的 bug
   不在既有測試覆蓋範圍內 —— 並非既有測試 failing 而被忽略,而是這條路徑
   (`spiritDispatcher.ts`)從未被寫過任何測試(全站搜尋 `*.test.ts` 引用
   `invokeSpiritModel`/`pickDefaultModelForSpirit` 為零命中)。
7. **測試專用 export 未外洩**:`__resetEnrichmentStore`/`__seedDiscovery`/
   `__seedEnrichment`/`__ingestPayloadForTest`(modelResearcher.ts:1646-1703)全站搜尋確認
   只被 `server/model-researcher.test.ts`、`server/ai-models-router.test.ts` 引用,未被任何
   路由/tRPC 端點暴露,無被外部觸發風險。
8. **類別列舉一致性**:`FAL_CATEGORY_LABELS`(falModels.ts:2341-2359)、`FalCategory` type
   (33-50 行)、`SpiritModelCategory` type(`orb-agent-roles.ts:1868-1885`)三處各自列舉的
   17 個類別字串完全一致,無殘留或遺漏類別 —— C1 的根因是「跨類別 modelId 重複使用」,
   不是「類別本身列舉不一致」。

---

## 附錄:實測腳本說明

C1 的實測透過 `node_modules/.bin/tsx` 直接匯入
`server/services/falModels.ts`/`server/services/spiritDispatcher.ts` 的正式匯出函式執行
(未修改任何原始碼,腳本存放於稽核用暫存目錄,不在 repo 內),於本機環境(無
`FAL_API_KEY`)執行 —— 由於 bug 發生在 `invokeSpiritModel` 打真實 fal.ai API **之前**的
輸入檢查/授權檢查階段,因此不需要真實 API key 即可重現;若金鑰存在,行為不變(仍會在同一步
提前失敗、不會發出網路請求)。C2/M1 的目錄比對透過 `node -e` 腳本解析
`FAL_MODEL_CATALOG`/`MODEL_PRICING_CATALOG` 原始碼文字做逐條 key 集合運算,計算結果均可用
文中列出的 `grep`/行號回頭在原始碼中逐一核對。
