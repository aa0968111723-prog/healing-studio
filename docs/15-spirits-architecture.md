# 15 精靈架構與路線圖

> 「精靈」是這個系統面對使用者時的人格化分身。光球是門面 — 背後 15 個分工明確、口氣可愛的同事輪流接手。本文件記錄目前已連通的部份，以及還沒接的下一步。

## 1. 名單

| 家族 | 暱稱 | id (`AgentRole`) | 一句話定位 |
|---|---|---|---|
| 專精 (specialist) | 圖圖 🎨 | `image-specialist` | 出圖 / 修圖 / 放大 / 風格 |
|  | 影影 🎬 | `video-specialist` | 圖轉影 / 文生影 / 對嘴 |
|  | 音音 🎵 | `music-specialist` | BGM / 音效 / 混音 |
|  | 聲聲 🎙️ | `voice-specialist` | 配音 / 克隆 / 變聲 / 聽寫 |
|  | 練練 🧪 | `training-specialist` | 訓 LoRA / 客製模型 |
|  | 學學 📚 | `learning-specialist` | 教程 / 新手導引 |
| 通用 (role) | 導導 🎯 | `director` | 跨頁工作流規劃 |
|  | 編編 ✍️ | `composer` | 在當頁直接執行 |
|  | 品品 🔎 | `critic` | 給 1-3 個改進處 |
|  | 查查 🧭 | `researcher` | 比模型 / 查資料 |
|  | 路路 🧳 | `navigator` | 帶到對的頁面 |
|  | 暖暖 🌿 | `companion` | 開放對話 / 暖身 |
| 主動 (proactive) | 財財 💰 | `accountant` | 全站成本控制 |
|  | 巧巧 ✨ | `quality-coach` | 提示詞 + 品質教練 |
|  | 守守 🛡️ | `inspector` | 全站糾察 / 巡邏 |

別名 (`SPIRIT_NICKNAMES`) 保留舊命名 — `@阿圖`, `@老導`, `@嚴選` 仍會路由到對應 spirit，舊對話 / 儲存的 prompt 不會壞。

## 2. 已連通的模組

```
                                ┌──────────────────────────────┐
            useState({pinned})  │  client/AgentChat.tsx        │
                                │  - SPIRITS visual config      │
            messageSpirits []   │  - 精靈名片簿 (deck)          │
                                │  - 「現在誰在線」status bar    │
            handleCallSpirit    │  - 每則訊息精靈 chip          │
                                │  - 「主動三人組」amber 區塊   │
                                └──────────┬───────────────────┘
                                           │
                                           │ ChatMessage.agentRole
                                           ▼
       ┌──────────────────────────────────────────────────────────────┐
       │  client/contexts/GlobalOrbChatContext.tsx                    │
       │  - ChatMessage 多 agentRole / agentRoleConfidence 欄位        │
       │  - 主回覆路徑掛上 spiritFields (server authoritative)         │
       │  - appendMessages 把 agentRole 寫進 metadata JSON             │
       └──────────┬───────────────────────────────────────────────────┘
                                           │
                  trpc.ai.chat / orbConversations.appendMessages
                                           ▼
       ┌──────────────────────────────────────────────────────────────┐
       │  server/routers.ts (ai.chat mutation)                         │
       │  - 進入時用 selectRoleForIntent 算 spiritSelection             │
       │  - 餵 preferredProviderId 給 selectProvider (multi-LLM)       │
       │  - finalizeIdempotentResponse 把 agentRole / confidence 帶回  │
       └──────────┬───────────────────────────────────────────────────┘
                                           │
                                           ▼
       ┌──────────────────────────────────────────────────────────────┐
       │  shared/orb-agent-roles.ts                                    │
       │  - AgentRole 15 個成員                                         │
       │  - KEYWORD_RULES (15 條) + LEARNING_OVERRIDE                  │
       │  - SPIRIT_NICKNAMES (含舊名別名)                               │
       │  - SPIRIT_PREFERRED_PROVIDER (per-spirit LLM 偏好)            │
       │  - SPIRIT_COLLAB_PROTOCOL (誰交棒給誰)                        │
       │  - SPIRIT_PROACTIVE_TRIGGERS (主動觸發 spec)                  │
       │  - getRoleSystemPromptSlice (15 個朋友語氣 prompt slice)      │
       │  - composeRoleChain (chain 預設順序)                          │
       │  - selectRoleForIntent (含 mutedRoles 跳過支援)               │
       └──────────────────────────────────────────────────────────────┘

       ┌──────────────────────────────────────────────────────────────┐
       │  shared/agent-skills.ts                                       │
       │  - GENERIC_SKILLS 含全 15 (含 accountant / quality-coach /     │
       │    inspector)                                                 │
       │  - selectAgentSkill 路由器透過此清單分派                       │
       └──────────────────────────────────────────────────────────────┘

       ┌──────────────────────────────────────────────────────────────┐
       │  shared/agent-preferences.ts                                  │
       │  - AgentPreferences.mutedSpirits / favoriteSpirits             │
       │  - DEFAULT_AGENT_PREFERENCES 預設空陣列                        │
       └──────────────────────────────────────────────────────────────┘

       ┌──────────────────────────────────────────────────────────────┐
       │  資料庫 (drizzle/schema.ts)                                   │
       │  - orb_conversation_messages.metadata JSON 收 agentRole /      │
       │    agentRoleConfidence (no migration — 用既有欄位)             │
       │  - specialized_agent_interactions (已存在) 用 agent_role 欄位  │
       │  - orb_feedback_events (已存在) 也用 agent_role 欄位            │
       └──────────────────────────────────────────────────────────────┘
```

## 3. 多 LLM 協作

`SPIRIT_PREFERRED_PROVIDER` 把 15 位映到 provider id：

- **Gemini**：圖圖 / 影影 / 音音 / 聲聲 / 練練（多模態理解）+ 導導 / 品品 / 查查 / 巧巧 / 守守（推理重）
- **default_llm**：編編 / 路路 / 暖暖 / 學學 / 財財（純對話 / 算數，便宜即可）

`server/routers.ts` 的 ai.chat 在進到 selectProvider 之前先把這個 hint 餵進 `preferredProviderId`，provider 不可用時 `selectProvider` 自己會走 fallback chain，所以不會因為某一家斷線而整個對話掛掉。

## 4. 使用者 ↔ 精靈關係

兩個欄位（`mutedSpirits` / `favoriteSpirits`）已加進 `AgentPreferences`：

- `mutedSpirits` — selectRoleForIntent 路由時整條 KEYWORD_RULE 跳過。`@nickname` 強指定不受 mute 影響（明示優先）。
- `favoriteSpirits` — 純 UI hint，不影響路由。預期接入：deck 的最愛區塊、ProactiveEventBus 通知優先順序。

## 5. 精靈交棒協定 (SPIRIT_COLLAB_PROTOCOL)

每位精靈都有 `handoffs[]` 與 `receivedFrom[]`。例：

```
品品 (critic) ─改寫建議→ 編編 (composer) ─送出後→ 品品 (再看)
財財 (accountant) ─使用者要省→ 查查 (researcher) ─挑好→ 財財 (再算)
                                                    └──→ 編編 (切換模型)
影影 (video) ─做完→ 聲聲 (voice 配旁白) → 音音 (music 配 BGM) → 品品
```

目前是純 data — 給 UI 顯示「他做完會交給誰」用。**runtime handoff** 由 `agentCollaborationOrchestrator` 已存在的多 agent collab 機制執行，下一步是把 SPIRIT_COLLAB_PROTOCOL 餵進 orchestrator 當預設順序。

## 6. 主動觸發 (SPIRIT_PROACTIVE_TRIGGERS)

7 個事件 → 3 位主動精靈：

| 事件 | 觸發者 | UI 形式 |
|---|---|---|
| `monthly_spend_threshold` | 財財 | inline |
| `expensive_op_about_to_run` | 財財 | blocking |
| `low_quality_generation` | 巧巧 | inline |
| `prompt_too_short` | 巧巧 | toast |
| `site_error_detected` | 守守 | toast |
| `page_perf_bad` | 守守 | toast |
| `feature_not_used` | 守守 | toast |

目前是 spec — 還沒有 ProactiveEventBus 在跑這些事件。下一步要做的：

1. 新建 `client/src/contexts/ProactiveEventBus.tsx`，提供 `useProactiveSubscribe(eventName, handler)`。
2. 在現有事件源 (cost telemetry / generation completion / network error boundary) 發 events。
3. ProactiveOrbWidget 訂閱事件，呼叫對應精靈的 system prompt 產生軟提示。

## 7. 全站連結（site-wide AI agent）路線圖

| 模組 | 狀態 |
|---|---|
| `/agent` 頁的 deck / chip / status bar | ✅ 已接 |
| ai.chat 回 agentRole | ✅ 已接 |
| ChatMessage.agentRole 持久化 | ✅ 已接 (metadata JSON) |
| 使用者 mute / 最愛偏好 | ✅ 已接 |
| 對話歷史 hydrate 出 agentRole | ✅ 已接 (`...m.metadata as Partial<ChatMessage>`) |
| `ProactiveOrbWidget` (全站浮窗) 顯示精靈 chip | 🟡 結構備好（ChatMessage 已含欄位），尚未在 widget render 顯示 |
| `ProactiveEventBus` | 🔴 spec 已寫，事件源未接 |
| Runtime handoff (collab orchestrator 吃 SPIRIT_COLLAB_PROTOCOL) | 🔴 protocol 已寫，未塞進 orchestrator |
| 全站精靈使用統計 dashboard | 🔴 schema 支援，UI 未做 |
| Per-page 預設精靈（在 /image-studio 預設選圖圖等） | 🔴 已有 `recommendedPages` 資料，未在 UI 用 |

## 8. 增加 / 修改精靈 checklist

要新增第 16 位精靈時，請依序更新以下檔案（缺一就會 TypeScript exhaustive switch 報錯，這就是設計）：

1. `shared/orb-agent-roles.ts`
   - `AgentRole` union 加新 id
   - `KEYWORD_RULES` 加關鍵字 rule
   - `SPIRIT_NICKNAMES` 加暱稱
   - `getRoleSystemPromptSlice` 加 case
   - `composeRoleChain` 加 case
   - `summarizeRoleChainForPrompt` 加 label
   - `SPIRIT_PREFERRED_PROVIDER` 加 entry
   - `SPIRIT_COLLAB_PROTOCOL` 加 entry
2. `shared/agent-skills.ts` 加 GENERIC_SKILLS entry
3. `client/src/pages/AgentChat.tsx` `SPIRITS` array 加新成員（含 family / gradient / vibe / greeting）

要改名（例如再可愛一點）時：
- 改 `SPIRITS` 的 `nickname` 與 `prompt`
- 在 `SPIRIT_NICKNAMES` 把舊名留在 `nicknames[]` 後面當別名（不要刪 — 既有對話會 break）

## 9. 測試覆蓋

| 測試 | 覆蓋 |
|---|---|
| `tests/unit/shared/orb-agent-roles.test.ts` | 6 個原始 generic role 路由 + composeRoleChain + getRoleSystemPromptSlice |
| 新增 3 個主動精靈的 keyword 路由 | 🔴 待補測試 |
| `selectRoleForIntent` 與 `mutedRoles` | 🔴 待補測試 |
| `@nickname` 路由 (`detectSpiritMention`) | 🔴 待補測試 |
| `SPIRIT_COLLAB_PROTOCOL` 結構 (反向圖一致性) | 🔴 待補測試 |
