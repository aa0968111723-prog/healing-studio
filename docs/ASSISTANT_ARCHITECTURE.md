# 光球助手 × AI 代理系統 — 架構總覽

> 本文件是 Phase 1「架構脊椎」整理後的單一參考。涵蓋光球助手(Light Orb
> Assistant,使用者面)與 AI 代理(AI Agent runtime,平台基礎建設)兩
> 個子系統如何接縫運作。
>
> 與根目錄的散落文件(`GLOBAL_ORB_CHAT_INTEGRATION.md`、`orb_optimization_plan.md`、
> `orb_connection_report.md`、`brain-config-gap-audit-2026-04-20.md`、
> `brain-route-scan-2026-04-21.md`)互補:本文件畫架構脊椎、舊文件留歷史
> 細節。Phase 4 會把舊文件正式合併進來。

## 1. 兩個子系統的位置

```
┌─────────────────────────────────────────────────────────────────┐
│  使用者面 — 光球助手 (Light Orb Assistant)                       │
│  • ProactiveOrbWidget(浮動光球)                                │
│  • OrbGuidePanel(引導面板)                                     │
│  • /agent 頁面(全頁聊天)                                       │
│  • Cmd+K 全域呼出                                                │
│  全部共享同一個對話狀態:GlobalOrbChatContext                   │
└────────────────────────┬────────────────────────────────────────┘
                         │ 透過 PageAgentContext 派送結構化動作
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  基礎建設 — AI 代理 (AI Agent runtime)                          │
│  • PageAgent action bus(client)                                │
│  • global-agent-orchestrator(client SPA 工作流)                │
│  • orbTaskOrchestrator(server LLM 工具計畫)                    │
│  • agentPlanner(server schema-first 規劃器)                    │
│  • 25 精靈 + spirit dispatcher                                   │
│  • brain 配置(directorModel / reasoningBrains / generationEngines) │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 對話資料流

```
使用者輸入
    ▼
GlobalOrbChatContext.sendMessage()
    ▼
trpc.ai.chat.mutateAsync()        ← server entry point
    ▼
server/routers.ts (ai.chat)
    ▼
buildOrbSystemPrompt + invokeLLM
    ▼
parseOrbReply → { reply, actions, intent, suggestions }
    ▼
GlobalOrbChatContext 更新 messages
    ▼
pageAgent.dispatch(actions)       ← 結構化動作派送
    ▼
global-agent-orchestrator(client) ← runWorkflow / 多步驟
    ▼
PageAgentContext handlers         ← 各頁面的 useRegisterPageAgent
    ▼
localStorage 持久化(7 天過期)
```

## 3. Catalog / 模型 ID 真相來源

| 層 | 檔案 | 用途 |
|---|---|---|
| 規範來源 | `server/_core/modelRegistry.ts` | 5 推理大腦 / 4 生成引擎 / 16 Fal 任務目錄;`isCanonicalOrKnownModel()`、`getKnownModelIds()`、`REASONING_MODEL_ALLOWLIST`、`FAL_FIELD_ALLOWLISTS` |
| 正規化 | `shared/engineModelIds.ts` | `normalizeEngineModelId(id)`,把 `fal/x` 與 `fal-ai/x/v1` 等別名收斂成 canonical |
| Fallback 鏈 | `server/_core/fallbackPolicy.ts` | `PER_MODEL_FALLBACK` / `PER_CATEGORY_FALLBACK` / `resolveFallbackChain()`;`brainContext.ts` 與 `falDispatcher.ts` 都從這裡讀 |
| 寫入閘門 | `server/routers/brain.ts` upsert | Zod schema 對每個 *Engine / *Model 欄位 `.transform(normalizeEngineModelId).refine(...allowlist.has(v))` |
| AI Models Hub 展示用 | `shared/aiModelsCatalog.ts` | 給 `/ai-models` 頁面顯示用的人工策展目錄 + 自動研究 enrichment(Perplexity 週期更新)。**不同層,不要混用** |
| 圖像編輯領域邏輯 | `server/services/orbModelCatalog.ts` | 圖像編輯意圖 → 模型建議的小工具,**不是 catalog 來源** |

### 不變式(由測試守住)

`server/_core/fallbackPolicy.sync.test.ts`:

- `PER_MODEL_FALLBACK` 的 key 與所有降級目標都在 `getKnownModelIds()`
- `PER_CATEGORY_FALLBACK` 的所有候選都在 `getKnownModelIds()`
- `resolveFallbackChain(key)` 永遠非空
- 同個 chain 不會把自己當降級對象、不會重複

## 4. Orchestrator 兩半 — client 與 server

兩個 orchestrator 看起來像是「同名重複」其實是不同職責:

| | `shared/global-agent-orchestrator.ts` | `server/services/orbTaskOrchestrator.ts` |
|---|---|---|
| 跑在 | **client(SPA)** | **server** |
| 操作對象 | DOM / page 動作:navigate、fillPrompt、setModel、setModality、submit、runWorkflow | LLM tool plan:tRPC 工具呼叫、結果驗證、retry / replan |
| 主要相依 | PageAgentContext、wouter、globalAgentRegistry | agentToolExecutor、orbTaskStateMachine、orbTaskStore |
| 派送機制 | `ctx.dispatch(action)` → `useRegisterPageAgent` handler | `executeOrbToolCalls(tools)` → tRPC 路由 |
| 怎麼共用? | **不共用**。兩邊各自維護 step / retry / audit 結構,只透過上層 type(`AgentAction`、`OrbTask`)銜接 |

### 不變式(由測試守住)

`tests/unit/shared/orchestrator-boundary.test.ts`:

- `shared/global-agent-orchestrator.ts` 不可 import `server/*`
- `server/services/orbTaskOrchestrator.ts` 不可 import `client/*`
- `server/services/orbTaskOrchestrator.ts` 不可 import `shared/global-agent-orchestrator`

兩個 orchestrator 的 retry / replan 邏輯目前各自實作。**統一**留到 Phase 3,
因為合併要動 ~700 行,涉及 plan-schema、tool-result 驗證、與
state-machine 三個面向,本 phase 範圍外。

## 5. PageAgent ↔ AppPageRegistry 同步

兩個 registry 描述同一件事但不同時機:

- `shared/appRegistry.ts:APP_PAGE_REGISTRY`(static):每頁的 id / path /
  label / aliases / supportsPageAgent / supportedActions / quickActions
  — 編譯時就決定,給 static-fallback 路由用
- `shared/global-agent-registry.ts` 內部(dynamic):各頁面在 mount 時
  透過 `useRegisterPageAgent` 註冊的 `PageAgentSnapshot` — runtime 才有,
  含當下 capabilities

`global-agent-registry.ts:register()` 會偵測 drift:
- pageId 不在 APP_PAGE_REGISTRY → warn(pageId-not-in-registry)
- pagePath 與 APP_PAGE_REGISTRY 條目不一致 → warn(pagePath-mismatch)
- supportsPageAgent=false 卻嘗試註冊 → warn(pageAgent-disabled-in-registry)

dev 模式 console.warn,prod 沉默。`detectSnapshotDrift()` 純函式可在測試
中嚴格斷言。守住兩個 registry 不在重構中漂移。

### 不變式(由測試守住)

`tests/unit/shared/global-agent-registry-drift.test.ts`:

- APP_PAGE_REGISTRY 每個 supportsPageAgent=true 的條目都產生 zero-drift snapshot
- 三種 drift case 都能被 detectSnapshotDrift 抓到
- register() 寫入仍然成功(warning 不阻擋)

## 6. Memory 三層

| Tier | 模組(façade 別名) | 儲存 | 用途 |
|---|---|---|---|
| A — Ephemeral | `orbTaskMemory`(TaskScratch) | in-RAM + 選擇性 DB persist | 單一 task 內穿針引線 |
| B — Conversation | `orbMemory`(ConversationMemory) | in-RAM + RAG index | 「光球觀察到的瑣事」偏好 / 觀察 / 安全事件 |
| B — Conversation | `orbUserMemory`(UserSummary) | `users.orbMemorySummary` 欄位 | 「這位使用者的長期偏好」一句話摘要 |
| C — Long-term | `orbLongTermMemory`(LongTermMemory) | `orb_long_term_memories` + `orb_memory_associations` | 結構化長期記憶 + 關聯圖 |
| C — Long-term | `spiritMemoryManager`(SpiritMemory) | `spirit_memories` 表 | 25 精靈各自對使用者的學習 |
| C — Long-term | `specializedAgentMemoryStore`(SpecialistEvents) | `specialized_agent_interactions` | 工具使用稽核事件流 |

新代碼一律從 `server/services/memory` façade 統一 import。詳見
`server/services/memory/MEMORY_TIERS.md`。

各層儲存後端不同,**不合併**(會牽動 DB schema 遷移,本次重整範圍外)。
未來若要合併,要從 `agent_memories` 統一表 + tier/scope 欄位開始評估。

## 7. 25 精靈 (Spirits) 與 Slash Commands

- 角色定義:`shared/orb-agent-roles.ts`(Phase 3 將改名為 `shared/spirit-roles.ts`)
- 路由 dispatch:`server/services/spiritDispatcher.ts`(`@nickname` 觸發)
- 提示詞模板:`server/services/spiritPromptEnhancer.ts`
- 記憶:`server/services/spiritMemoryManager.ts`(memory Tier C)
- Slash 命令:`shared/slash-commands.ts`(client `slashCommandRunner` 解析)
- 對應 docs:`docs/15-spirits-architecture.md`、`docs/25-spirits-integration-audit.md`、`docs/slash-command-system.md`

## 8. 「Agent」一詞的三種意義(尚未消解,Phase 3 處理)

| 出現位置 | 指涉 | 建議改名(Phase 3) |
|---|---|---|
| `agent-actions.ts`、`PageAgentContext`、`page agent snapshot` | 頁面 action bus,把 LLM 動作分發給 React handlers | PageActionBridge |
| `orb-agent-roles.ts`(25 精靈) | 角色 / 人格 / 專長 | Spirit |
| `agentPlanner.ts`、`agentToolExecutor.ts`、agent collaboration | LLM-powered 推理 / 規劃器 | Reasoner |

Phase 3 會做整批 rename + 一個 release 的 re-export shim。

## 9. 持久化邊界

| 層 | 儲存 | 是否在本次重整動到? |
|---|---|---|
| GlobalOrbChat localStorage(`orb-chat-*` keys) | 瀏覽器 localStorage | **不動**。LEGACY_STORAGE_KEY_* migration block 保留 |
| user_ai_brain 表 | MySQL | **不動**。validation 已就位 |
| orb_long_term_memories / orb_memory_associations | MySQL | **不動** |
| spirit_memories / specialized_agent_interactions | MySQL | **不動** |
| ragMemory 向量索引 | 外部(Pinecone-like) | **不動** |
| tRPC procedure 名稱 | wire format | **不動**。Phase 3 改名時會附 migration shim |

## 10. 推薦閱讀順序(新加入維護者)

1. 本文件 → 全景觀
2. `docs/AI_BRAIN_OVERVIEW.md` → brain 配置實作細節
3. `docs/global-orb-task-state-machine.md` → orb task 生命週期
4. `docs/global-orb-capability-registry.md` → PageAgent capability 怎麼宣告
5. `docs/slash-command-system.md` → `/` 命令 dispatcher
6. `docs/15-spirits-architecture.md` + `docs/25-spirits-integration-audit.md` → 精靈系統
7. `server/services/memory/MEMORY_TIERS.md` → 記憶分層細節

## 11. Phase 進度

- **Phase 1(本 PR)— 架構脊椎** ✅
  - Fallback chain sync test
  - Orchestrator client/server boundary doc + import-isolation test
  - PageAgentSnapshot ↔ AppPageRegistry drift detection
  - Memory tier façade + tier labels + MEMORY_TIERS.md
  - 本架構文件
- **Phase 2 — 死代碼修剪**(未開始)
- **Phase 3 — 命名與目錄整頓**(未開始)
- **Phase 4 — 文件統整**(未開始;本文件是引子)

詳細計畫見 plan 檔。
