# 25 精靈分工與全站連結 — 整合審計

> 審計範圍：`shared/orb-agent-roles.ts` 定義的 25 個 `AgentRole`，
> 從「定義 → 伺服器路由 / 工具 / 編配 → 前端視覺 / 主動事件 / 落地頁」
> 端到端盤點是否可真實運作。
>
> 對應 branch：`claude/audit-spirits-integration-2kt6y`
> 審計時間：2026-05-14（同 commit 補上首輪修補；見 §7）

---

## 0. 修補進度（後續 commit 已套用）

本 PR 第二輪 commit 已套用 §5.3 建議順序的前 6 項（細節見 §7）。
之後重新跑健康表，差異主要是：

- 靈靈 / 體體 從 ❌ → ⚠️（已加入 orchestrator specializedAgents）
- 步步、群群、律律、安安、總總、記記、帶帶的「navigate 後 404」風險解除（移除無實體頁的 PATH_SPIRIT_MAP 條目；步步重綁 `/background-tasks`、總總綁 `/settings/agent`）
- 安安、帶帶 的主動觸發實際開始 publish（`credential_leak_detected` + `user_stuck_detected`）
- 25/25 在 spiritStatusMonitor 都被監控（總總團隊看板可看到完整 team）
- SpiritHandoffIndicator 改用 `SPIRITS_BY_ID` 統一視覺，自動覆蓋全 25 位

剩餘的 ❌：律律 `ip_risk_detected`、群群 `social_post_ready`、總總 `team_status_overview`、記記 `notes_capture_suggested`、細細 `settings_drift_detected`、步步 `multi_step_plan_ready`、巧巧 `low_quality_generation` 仍缺 publisher，需要更多領域邏輯（LLM 介入或業務點偵測），列入後續 PR。

---

## 1. 完整 25 精靈清單

定義來源：`shared/orb-agent-roles.ts:19-44`、`SPIRIT_NICKNAMES:929-955`。

| # | role id | 暱稱 | 家族 | 預設路徑 | 偏好 LLM |
|---|---|---|---|---|---|
| 1 | `director` | 導導 🎯 | role | `/director` | gemini |
| 2 | `composer` | 編編 ✍️ | role | — (當頁) | default_llm |
| 3 | `critic` | 品品 🔎 | role | — | gemini |
| 4 | `researcher` | 查查 🧭 | role | — | gemini |
| 5 | `navigator` | 路路 🧳 | role | — | default_llm |
| 6 | `companion` | 暖暖 🌿 | role | — | default_llm |
| 7 | `accountant` | 財財 💰 | proactive | `/dashboard`、`/credits` | default_llm |
| 8 | `quality-coach` | 巧巧 ✨ | proactive | — | gemini |
| 9 | `inspector` | 守守 🛡️ | proactive | — | gemini |
| 10 | `image-specialist` | 圖圖 🎨 | specialist | `/image-studio` | gemini |
| 11 | `video-specialist` | 影影 🎬 | specialist | `/video-studio` | gemini |
| 12 | `music-specialist` | 音音 🎵 | specialist | `/pro-studio` | gemini |
| 13 | `voice-specialist` | 聲聲 🎙️ | specialist | — (與 music 共用 /pro-studio) | gemini |
| 14 | `training-specialist` | 練練 🧪 | specialist | `/models` | gemini |
| 15 | `learning-specialist` | 學學 📚 | specialist | `/learn`、`/tutorial-overview` | default_llm |
| 16 | `legal-advisor` | 律律 ⚖️ | proactive | `/legal` ❌ | gemini |
| 17 | `security-guard` | 安安 🔒 | proactive | `/security` ❌ | gemini |
| 18 | `community-manager` | 群群 📣 | specialist | `/social`、`/community` ❌ | gemini |
| 19 | `chief-orchestrator` | 總總 🎩 | role | `/team`、`/agents` ❌ | gemini |
| 20 | `onboarding-coach` | 帶帶 🤝 | proactive | — | default_llm |
| 21 | `notes-curator` | 記記 📒 | role | `/notes`、`/assets`、`/calendar` ✅/`/schedule` ❌ | default_llm |
| 22 | `settings-detail` | 細細 ⚙️ | role | `/settings` | default_llm |
| 23 | `plan-executor` | 步步 🧩 | role | `/jobs`、`/tasks` ❌ | gemini |
| 24 | `inspiration-specialist` | 靈靈 💡 | specialist | — | gemini |
| 25 | `anatomy-specialist` | 體體 🫀 | specialist | — | gemini |

❌ = 路徑列在 `PATH_SPIRIT_MAP`（`orb-agent-roles.ts:2156-2188`），但 `client/src/App.tsx` 沒有對應 `<Route>`。

---

## 2. 伺服器端能力註冊覆蓋度

### 2.1 `agentCollaborationOrchestrator.ts`（路由 / handoff 核心）

| 註冊區塊 | 精靈 | 行數 |
|---|---|---|
| 6 通用 role | director / composer / critic / researcher / navigator / companion | 63-108 |
| 6 specialist（透過 `specializedAgents[]` + `getSpecializedAgentCapability`） | image / video / music / voice / training / learning | 112-133 |
| 3 主動精靈 | accountant / quality-coach / inspector | 138-158 |
| 8 新增精靈 | legal-advisor / security-guard / community-manager / chief-orchestrator / onboarding-coach / notes-curator / settings-detail / plan-executor | 161-264 |

**🚨 缺漏**：`agentCollaborationOrchestrator` 的 `specializedAgents[]` **沒有納入 `inspiration-specialist`（靈靈）與 `anatomy-specialist`（體體）**。雖然這兩位在 `shared/orb-specialized-agents.ts` 已有 `SPECIALIZED_AGENT_CAPABILITIES` 條目（行 242、267），但 orchestrator 不會走那條 forEach。結果：

- `findBestAgentForTask` 永遠選不到靈靈／體體
- 其它精靈在 handoff 時，`SPIRIT_COLLAB_PROTOCOL` 寫的「交給靈靈／體體」實際會被當成不存在的 capability 而落回 fallback
- 「沒想法 → 找靈感」「畫一張解剖圖」這類 prompt 即便被 keyword router 命中，後續鏈會中斷

### 2.2 `spiritStatusMonitor.ts`（idle/busy 追蹤）

`MONITORED_SPIRITS`（行 100-117）只追蹤 **16 位**：6 specialist + 8 新精靈 + 靈靈 + 體體 = 16。

**🚨 缺漏**：6 個 role（director / composer / critic / researcher / navigator / companion）與 3 個 proactive trio（accountant / quality-coach / inspector）**沒有被監控**，所以 dashboard / 總總所看到的「團隊現況」永遠只有 16/25 個會出現 busy 狀態，總總自己也不會出現在團隊看板上。

### 2.3 `spiritDispatcher.ts` / `spiritRouter.ts`（直接呼叫 fal.ai）

- `invokeSpiritModel` 透過 `canSpiritCallFalModel` 檢查 `SPIRIT_MODEL_CAPABILITIES`（`orb-agent-roles.ts:1577`），並從 `getFalModelsForSpirit` 挑模型。✅ 全 25 位都有 capability 條目，邏輯可運作。
- tRPC `spirit.invoke` 端點實際存在（`server/routers.ts:46,3688` 引用）。

### 2.4 `server/services/spiritTools/*.ts`（每位精靈的工具集）

22 個檔案存在；除 `orchestratorTools` 被 `server/routers/orbProxyRouter.ts` import 之外，**其餘 21 個 spiritTools 檔案沒有任何 router/orchestrator import**。等於工具寫好了但沒接到 chat router → LLM 也不會在 system prompt 拿到工具描述 → 沒有實際被叫用的路徑。

額外瑕疵：`anatomySpecialistTools.ts` header 註解寫「(解解)」（暱稱應為「體體」），且只實作 `analyzeParameters`，跟「人體解剖圖／醫學插圖」的角色定位無關，是 templated 占位實作。

### 2.5 主動事件 publisher

`SPIRIT_PROACTIVE_TRIGGERS`（`orb-agent-roles.ts:1948-2066`）定義 **16 種事件**。實際 publisher：

| event | publisher | 狀態 |
|---|---|---|
| `context_near_full` | `GlobalOrbChatContext.tsx:2596` | ✅ |
| `prompt_too_short` | `GlobalOrbChatContext.tsx:3312` | ✅ |
| `site_error_detected` | `GlobalOrbChatContext.tsx:4541` | ✅ |
| `monthly_spend_threshold` | `DashboardLayout.tsx:633` | ✅ |
| `expensive_op_about_to_run` | — | ❌ 財財阻擋付費永遠不會跳 |
| `low_quality_generation` | — | ❌ 巧巧不會自動冒出 |
| `page_perf_bad` | — | ❌ 守守不會回報慢頁 |
| `feature_not_used` | — | ❌ 守守不會推薦未用功能 |
| `ip_risk_detected` | — | ❌ **律律完全靜默** |
| `credential_leak_detected` | — | ❌ **安安完全靜默（資安風險）** |
| `user_stuck_detected` | — | ❌ 帶帶不會偵測卡關 |
| `team_status_overview` | — | ❌ 總總團隊看板缺資料 |
| `social_post_ready` | — | ❌ 群群不會自動建議排程 |
| `notes_capture_suggested` | — | ❌ 記記不會自動建議筆記 |
| `settings_drift_detected` | — | ❌ 細細不會察覺偏好衝突 |
| `multi_step_plan_ready` | — | ❌ 步步不會主動接管多步驟計畫 |

**🚨 重大缺口**：16 個事件只實作 4 個（25%）。12 位仰賴 proactive 觸發的精靈（巧巧的部份、守守、律律、安安、帶帶、總總、群群、記記、細細、步步、財財一部份）的「主動關懷」身分在 production 等同沒上線。其中 `ip_risk_detected`、`credential_leak_detected` 是 `surface: "blocking"` 的安全等級事件，按設計應該擋下侵權/外洩風險。

---

## 3. 前端覆蓋度

### 3.1 視覺資料（`client/src/lib/spiritsVisual.ts`）

✅ 25 位全有 `SPIRITS[]` 條目（行 40-337），`SPIRITS_BY_ID` 對映完整，被 `AgentChat.tsx` 透過 `SPIRITS`、`SPIRITS_BY_ID` 引用（行 88-91）。

### 3.2 `SpiritHandoffIndicator.tsx`

`SPIRIT_VISUALS`（行 25-41）內嵌 16 位的 gradient/emoji/nickname。

**🚨 問題**：
1. 視覺資料**寫死於該檔**而非 import `spiritsVisual.ts`，與 source-of-truth 已分歧（例：`director` 在 spiritsVisual 是 `from-amber-400 to-orange-500`，在 SpiritHandoffIndicator 寫的是 `from-blue-400`）。
2. **少 9 位**（director / composer / critic / researcher / navigator / companion / accountant / quality-coach / inspector）— 等於 6 role + 3 proactive trio 的 handoff 過渡動畫不會顯示。

### 3.3 主動通知 (`ProactiveNotificationCenter.tsx`)

訂閱模型完整，會依 `SPIRIT_PROACTIVE_TRIGGERS` 與使用者 mute / favorite 配對。**但因 §2.5 publisher 缺漏，實際只會收到 4 種事件**，畫面長期靜默。

### 3.4 路徑可達性（`PATH_SPIRIT_MAP` × `App.tsx`）

`App.tsx` 已註冊的路徑：`/`、`/create`、`/playground`、`/studio`、`/director`、`/assets`、`/models`、`/vault`、`/shared`、`/notes`、`/calendar`、`/dashboard`、`/feedback`、`/settings`、`/settings/ai-brain`、`/settings/agent`、`/history`、`/admin`、`/admin/api-usage`、`/admin/brain-pipeline`、`/my-brain`、`/pro-studio`、`/image-studio`、`/video-studio`、`/learn`、`/learn/tutorial-overview`、`/tutorial-overview`、`/lora-trainer`、`/focus-flow`、`/langsmith`、`/background-tasks`、`/credits`、`/prompt-library`、`/agent`、`/forgot-password`、`/reset-password`、`/account-settings`、`/process`。

`PATH_SPIRIT_MAP` 期望但**未存在**的路徑與受影響精靈：

| 路徑 | 期望精靈 | 影響 |
|---|---|---|
| `/schedule` | 記記 | 點到「排程」會 404，記記領航失效（`/notes`、`/calendar` 仍可） |
| `/social`、`/community` | 群群 | 群群無實體頁可帶；arrival follow-up 無處可降落 |
| `/legal` | 律律 | 律律無實體頁；arrival follow-up 永遠落不到 |
| `/security` | 安安 | 安安無實體頁；安全提醒只能停留在對話 |
| `/team`、`/agents` | 總總 | 總總沒有可顯示「團隊現況」的儀表板 |
| `/jobs`、`/tasks` | 步步 | 步步 dispatch 後使用者沒有任務看板可觀察（現有 `/background-tasks` 是相近功能但未被 mapping 指向） |

---

## 4. 25 位逐位健康表

✅ 健全 / ⚠️ 部分可用 / ❌ 接近虛設

| 精靈 | 角色定義 | 伺服器註冊 | spiritTool 接通 | 主動事件 | 落地頁 | 整體 |
|---|---|---|---|---|---|---|
| 1 導導 | ✅ | ✅ | n/a | n/a | ✅ /director | ✅ |
| 2 編編 | ✅ | ✅ | n/a | n/a | n/a (當頁) | ✅ |
| 3 品品 | ✅ | ✅ | n/a | n/a | n/a | ✅ |
| 4 查查 | ✅ | ✅ | n/a | n/a | n/a | ✅ |
| 5 路路 | ✅ | ✅ | n/a | n/a | n/a | ✅ |
| 6 暖暖 | ✅ | ✅ | n/a | ✅ context_near_full | n/a | ✅ |
| 7 財財 | ✅ | ✅ | n/a | ⚠️ 4 事件只接 1 (`monthly_spend_threshold`) | ✅ /dashboard | ⚠️ |
| 8 巧巧 | ✅ | ✅ | n/a | ⚠️ 2 事件只接 1 (`prompt_too_short`) | n/a | ⚠️ |
| 9 守守 | ✅ | ✅ | n/a | ⚠️ 3 事件只接 1 (`site_error_detected`) | n/a | ⚠️ |
| 10 圖圖 | ✅ | ✅ | ⚠️ tool 檔存在但無 router import | n/a | ✅ /image-studio | ⚠️ |
| 11 影影 | ✅ | ✅ | ⚠️ 同上 | n/a | ✅ /video-studio | ⚠️ |
| 12 音音 | ✅ | ✅ | ⚠️ 同上 | n/a | ✅ /pro-studio | ⚠️ |
| 13 聲聲 | ✅ | ✅ | ⚠️ 同上 | n/a | ⚠️ 與 12 共頁 | ⚠️ |
| 14 練練 | ✅ | ✅ | ⚠️ 同上 | n/a | ✅ /models | ⚠️ |
| 15 學學 | ✅ | ✅ | ⚠️ 同上 | n/a | ✅ /learn | ⚠️ |
| 16 律律 | ✅ | ✅ | ⚠️ tool 未接 | ❌ `ip_risk_detected` 零 publisher | ❌ /legal 不存在 | ❌ |
| 17 安安 | ✅ | ✅ | ⚠️ tool 未接 | ❌ `credential_leak_detected` 零 publisher（含資安阻擋） | ❌ /security 不存在 | ❌ |
| 18 群群 | ✅ | ✅ | ⚠️ tool 未接 | ❌ `social_post_ready` 零 publisher | ❌ /social、/community 不存在 | ❌ |
| 19 總總 | ✅ | ✅ | ✅ orchestratorTools 已 wired (`orbProxyRouter`) | ❌ `team_status_overview` 零 publisher | ❌ /team、/agents 不存在 | ⚠️ |
| 20 帶帶 | ✅ | ✅ | ⚠️ tool 未接 | ❌ `user_stuck_detected` 零 publisher | n/a | ❌ |
| 21 記記 | ✅ | ✅ | ⚠️ tool 未接 | ❌ `notes_capture_suggested` 零 publisher | ⚠️ /notes、/assets、/calendar ✅，/schedule ❌ | ⚠️ |
| 22 細細 | ✅ | ✅ | ⚠️ tool 未接 | ❌ `settings_drift_detected` 零 publisher | ✅ /settings | ⚠️ |
| 23 步步 | ✅ | ✅ | ⚠️ tool 未接 | ❌ `multi_step_plan_ready` 零 publisher | ❌ /jobs、/tasks 不存在 | ❌ |
| 24 靈靈 | ✅ | ❌ **未在 orchestrator `specializedAgents[]` 註冊** | ⚠️ tool 未接 | n/a | n/a | ❌ |
| 25 體體 | ✅ | ❌ **未在 orchestrator `specializedAgents[]` 註冊**；spiritTools 檔內容偏離角色 | ⚠️ tool 未接 | n/a | n/a | ❌ |

統計：✅ **6** ／ ⚠️ **12** ／ ❌ **7**

---

## 5. 結論：能否真實運作？

### 5.1 可以真實運作的範圍

- 「@暱稱」直接指名 → `selectRoleForIntent` 100% 命中 25 位（`orb-agent-roles.ts:1086-1093`）。
- 6 通用 role 與 6 modality specialist 的對話／執行鏈、`spiritRouter.invoke` 直接打 fal.ai、handoff 的資料層（`SPIRIT_COLLAB_PROTOCOL`）。
- `prompt_too_short`、`context_near_full`、`site_error_detected`、`monthly_spend_threshold` 四個主動卡片。

### 5.2 設計存在但不會被叫用的部份（最關鍵的缺口）

1. **靈靈、體體 完全未掛 capability registry** — orchestrator 找不到，handoff 鏈中斷。
2. **6 個落地頁缺失**（`/legal /security /social /community /team /agents /jobs /tasks /schedule`） — 律律、安安、群群、總總、步步、記記 navigate 後會 404，違背 `buildArrivalFollowUpText` 的「跨頁接手」設計。
3. **12 種主動事件零 publisher** — 律律、安安、巧巧（深度）、守守（深度）、財財（深度）、帶帶、總總、群群、記記、細細、步步 的「自動關懷／自動接管」身分形同未啟用。其中律律、安安掛掉等於侵權／外洩風險完全不被攔截。
4. **22 個 spiritTools 檔案中 21 個未被任何 router import** — 工具寫好但 chat router／LLM 不會在 system prompt 看到它們，每位精靈的「可呼叫工具」實際上僅限於目前已掛上 trpc 的舊版 studio.*／research.* 兼容路徑。
5. **`SpiritHandoffIndicator` 視覺資料與 source-of-truth 分歧**且少 9 位 — handoff UI 對 6 role + 3 proactive trio 不可見。
6. **`spiritStatusMonitor.MONITORED_SPIRITS` 只覆蓋 16/25** — 總總的團隊看板天然不完整。

### 5.3 建議修補順序（性價比）

| 序 | 動作 | 影響 |
|---|---|---|
| 1 | 把 `inspiration-specialist`、`anatomy-specialist` 加入 `agentCollaborationOrchestrator` 的 `specializedAgents[]` | 兩位角色立刻可被路由與 handoff，零風險 |
| 2 | 補齊 `spiritStatusMonitor.MONITORED_SPIRITS` 至 25 位 | 總總團隊看板可即時反映全員狀態 |
| 3 | 移除 `PATH_SPIRIT_MAP` 中無實體頁的條目，或新增 `/legal /security /social /community /team /jobs /schedule` 對應 page stub | 避免 navigate→404，律律/安安/群群/總總/步步/記記 arrival follow-up 生效 |
| 4 | 在對應業務點補主動事件 publisher（優先：`credential_leak_detected` ＝ 安安、`ip_risk_detected` ＝ 律律、`user_stuck_detected` ＝ 帶帶、`team_status_overview` ＝ 總總、`multi_step_plan_ready` ＝ 步步） | 風險／體驗價值最高 |
| 5 | 將 21 個 spiritTools 透過 `orbProxyRouter` 或新 router 暴露給 chat tool registry，並在 `getRoleSystemPromptSlice` 引用對應工具名 | 25 位精靈的「可呼叫工具」描述變成真實可執行 |
| 6 | 讓 `SpiritHandoffIndicator` 改 import `spiritsVisual.ts`，刪除內嵌字典 | handoff 動畫覆蓋全 25 位且未來只需單點維護 |
| 7 | 重寫 `anatomySpecialistTools.ts` 讓內容對齊體體（解剖學提示詞模板 / batch 視角生成），或將其與 `imageSpecialistTools` 合併 | 體體真正能做解剖圖；避免錯把 system diagnostics 當成「解解」 |

---

## 6. 附錄：定位每個結論的關鍵檔案行號

- 25 精靈清單：`shared/orb-agent-roles.ts:19-44`
- 暱稱：`shared/orb-agent-roles.ts:929-955`
- Family：`shared/orb-agent-roles.ts:1023-1055`
- System prompt slices：`shared/orb-agent-roles.ts:1204-1459`
- 偏好 LLM：`shared/orb-agent-roles.ts:1472-1510`
- 可呼叫模型類別：`shared/orb-agent-roles.ts:1577-1659`
- Handoff 協定：`shared/orb-agent-roles.ts:1707-1911`
- 主動觸發 spec：`shared/orb-agent-roles.ts:1948-2066`
- 落地頁映射：`shared/orb-agent-roles.ts:2156-2188`
- Arrival 接手文案：`shared/orb-agent-roles.ts:2230-2289`
- Orchestrator 能力註冊：`server/services/agentCollaborationOrchestrator.ts:60-264`
- StatusMonitor 監控清單：`server/services/spiritStatusMonitor.ts:100-117`
- spiritDispatcher 真實 fal.ai 入口：`server/services/spiritDispatcher.ts:80-147`
- spiritRouter tRPC 端點：`server/routers/spiritRouter.ts:61-93`
- 前端視覺：`client/src/lib/spiritsVisual.ts:37-348`
- 主動事件 schema：`client/src/lib/proactiveEventBus.ts:28-104`
- 主動通知中心：`client/src/lib/ProactiveNotificationCenter.tsx`
- 真實 publisher：`GlobalOrbChatContext.tsx:2596/3312/4541`、`DashboardLayout.tsx:633`
- 路由註冊：`client/src/App.tsx:196-316`

---

## 7. 本 PR 已套用的修補

| # | 動作 | 檔案 | 影響 |
|---|---|---|---|
| 1 | 把 `inspiration-specialist`、`anatomy-specialist` 加入 orchestrator `specializedAgents[]`，同步擴充 `AgentCapabilityDeclaration.specializations` 與 `mapToSpecializations` | `server/services/agentCollaborationOrchestrator.ts`、`shared/agent-communication-protocol.ts` | 靈靈 / 體體 從 ❌ 變 ⚠️；`findBestAgentForTask` 真的會找到他們 |
| 2 | `spiritStatusMonitor.MONITORED_SPIRITS` 從 16 擴到 25 | `server/services/spiritStatusMonitor.ts` | 總總團隊看板可見全員 busy/idle |
| 3 | `SpiritHandoffIndicator` 改 import `SPIRITS_BY_ID`（移除內嵌字典） | `client/src/components/SpiritHandoffIndicator.tsx` | handoff UI 覆蓋全 25 位且未來同步維護單點 |
| 4 | 移除 `PATH_SPIRIT_MAP` 中 9 條無實體頁的條目，新增 `/background-tasks` (步步)、`/settings/agent` (總總) | `shared/orb-agent-roles.ts` | navigate 後不再 404；步步 / 總總 有真實落地頁 |
| 5 | 在 `sendMessage` 內加 `credential_leak_detected` + `user_stuck_detected` publisher | `client/src/contexts/GlobalOrbChatContext.tsx` | 安安偵測 API key/token/JWT/PEM 外洩、帶帶偵測重複提問 |
| 6 | 重寫 `anatomySpecialistTools.ts` 對齊體體：`buildAnatomyPrompt` / `nextClarificationQuestion` / `getLabelChecklistForPart` | `server/services/spiritTools/anatomySpecialistTools.ts` | 體體實際能組對解剖學提示詞、推薦模型、給標註 checklist |

第二輪 commit 補完的部份：

| # | 動作 | 檔案 |
|---|---|---|
| 7 | 修正第一輪打到 `agentToolExecutor.dispatchAnatomySpecialistTool` 的 anatomy 工具名稱（`buildPrompt` / `nextClarification` / `labelChecklist`）與 header 暱稱（「解解」→「體體」） | `server/services/agentToolExecutor.ts` |
| 8 | `team_status_overview` publisher：BackgroundTasksContext 觀察活躍任務的 `studioType`，當 ≥3 位不同精靈同時跑時發給 ProactiveEventBus | `client/src/contexts/BackgroundTasksContext.tsx` |
| 9 | `expensive_op_about_to_run` publisher：submitTask 在送出前比對 EXPENSIVE_MODEL_HINTS（Kling Pro / Runway / FLUX Pro / LoRA 訓練 / Suno）+ 讀 `credits.myBalance` 算 `pctOfRemaining` | `client/src/contexts/BackgroundTasksContext.tsx` |
| 10 | `ip_risk_detected` publisher：新 `client/src/lib/ipRiskDetect.ts` 內建迪士尼 / 寶可夢 / Marvel / Star Wars / 吉卜力 / 哆啦 A 夢 / One Piece / 鬼滅、Coca-Cola / Nike / Apple、Taylor Swift / 周杰倫 / BTS / 政治人物等字典 + 「需有生成意圖」guard；GlobalOrbChatContext.sendMessage 命中即 publish | `client/src/lib/ipRiskDetect.ts`、`client/src/contexts/GlobalOrbChatContext.tsx` |
| 11 | `notes_capture_suggested` publisher：sendMessage 偵測「下次想記得 / 明天再做 / 備忘 / 記一下 / 幫我記 / 提醒我」等意圖 → 主動建議建檔 | `client/src/contexts/GlobalOrbChatContext.tsx` |
| 12 | `multi_step_plan_ready` publisher：當 `buildWorkflowExecutionState` 產生 ≥3 步的 workflow，步步主動接管並回報 stepCount / firstStepLabel | `client/src/contexts/GlobalOrbChatContext.tsx` |

完成後 `ProactiveTriggerEvent` 16 種有 publisher 的進度：
- ✅ context_near_full、prompt_too_short、site_error_detected、monthly_spend_threshold（第一版即存在）
- ✅ credential_leak_detected、user_stuck_detected（PR commit 1）
- ✅ ip_risk_detected、team_status_overview、expensive_op_about_to_run、notes_capture_suggested、multi_step_plan_ready（PR commit 2）

剩餘無 publisher 的 5 種（追蹤）：
- `low_quality_generation`（巧巧）：需 LLM 看圖判斷
- `page_perf_bad`（守守）：需 Performance Observer 接入
- `feature_not_used`（守守）：需使用行為長期紀錄
- `settings_drift_detected`（細細）：需偏好 vs 行為對比
- `social_post_ready`（群群）：需偵測「剛完成的素材 + 最近提過社群平台」
