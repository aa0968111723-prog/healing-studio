# 全站光球代理覆蓋矩陣

權威盤點：光球代理（Global Orb Agent）目前在每個層級的覆蓋狀況，含 Provider
堆疊、頁面 PageAgent 註冊、UI 表面、slash-command 表面、已知缺口與不動產
（intentional / wontfix）。

最後驗證：2026-05-15（branch `claude/organize-global-proxy-coverage-x16m3`）。
本文與 `GLOBAL_ORB_CHAT_INTEGRATION.md`（演進史與 Phase 進度）互補；那份文件
描述「如何整合」，本文描述「目前覆蓋到哪」。

---

## 1. Provider 堆疊（實際）

來源：`client/src/App.tsx:326-376`

```
ErrorBoundary
└─ ThemeProvider
   └─ PersonalSettingsProvider
      └─ PersonalityProvider
         └─ NotesDrawerProvider
            └─ AssetsDrawerProvider
               └─ ShowcaseTransferProvider
                  └─ SiteOnboardingProvider
                     └─ FocusFlowProvider
                        └─ AmbientProvider
                           └─ OrbGuideProvider
                              └─ PageAgentProvider           ← 頁面能力註冊 + 動作派送
                                 └─ OrbStateProvider          ← 光球視覺狀態
                                    └─ GlobalOrbChatProvider  ← 全站聊天狀態
                                       └─ IntentCardProvider
                                          └─ TooltipProvider
                                             └─ <Router />
```

關鍵依賴：

| Context | 必須在誰之內 | 為什麼 |
|---|---|---|
| `GlobalOrbChatProvider` | `PageAgentProvider` | 透過 `usePageAgent().dispatch()` 執行 LLM 回傳的 actions |
| `GlobalOrbChatProvider` | `OrbStateProvider` | 同步開/關面板的視覺狀態 |
| `GlobalOrbChatProvider` | `PersonalityProvider` | 依人格選擇歡迎訊息 |
| `OrbGuideProvider` | `PageAgentProvider`（外側皆可） | 透過 PageAgent 派送導引動作 |

---

## 2. 光球相關 Context 清單

| Context | 檔案 | 行數 | 主要 API |
|---|---|---|---|
| GlobalOrbChatContext | `client/src/contexts/GlobalOrbChatContext.tsx` | 6444 | `useGlobalOrbChat()` |
| PageAgentContext | `client/src/contexts/PageAgentContext.tsx` | 597 | `usePageAgent()`, `useRegisterPageAgent()` |
| OrbGuideContext | `client/src/contexts/OrbGuideContext.tsx` | 1147 | `useOrbGuide()` |
| OrbStateContext | `client/src/contexts/OrbStateContext.tsx` | — | `useOrbState()` |
| PersonalityContext | `client/src/contexts/PersonalityContext.tsx` | — | `usePersonality()` |
| IntentCardContext | `client/src/contexts/IntentCardContext.tsx` | — | `useIntentCard()` |

`GlobalOrbChatContext` 在 6444 行已遠超合理單檔尺寸，列入 future-refactor 候選；
本次「整理」不做拆分（風險與工作量不對等）。

---

## 3. 光球 UI 表面 — 已整合 GlobalOrbChat

| UI 表面 | 檔案 | 用途 | 本地聊天狀態殘留 |
|---|---|---|---|
| ProactiveOrbWidget | `client/src/components/ProactiveOrbWidget.tsx`（4122 行） | 全站浮動光球面板 | 無（已遷至 GlobalOrbChat） |
| OrbGuidePanel | `client/src/components/OrbGuidePanel.tsx`（4941 行） | 意圖→細節→到站引導 | 引導狀態保留（與聊天正交） |
| AgentChat | `client/src/pages/AgentChat.tsx`（2804 行） | `/agent` 專用聊天頁 | 無 |
| AI Models Hub 深度連結 | `client/src/pages/AIModelsHub.tsx` | 模型情報頁，「API 深度連結」走旁路（bypass LLM） | 不適用 |

唯一直接呼叫 `trpc.ai.chat` 的位置是 `GlobalOrbChatContext.tsx`；
所有 UI 表面都從 `useGlobalOrbChat()` 取得發送、訊息、建議、loading 狀態。

---

## 4. 頁面 PageAgent 註冊矩陣

實際以 `grep -l useRegisterPageAgent client/src/pages/**/*.tsx` 校驗（2026-05-15）。

### 4.1 已註冊（共 35 頁）

| pageId | pageLabel | pagePath（註冊值） | 實際 Route | 備註 |
|---|---|---|---|---|
| home | 首頁 | `/` | `/` | |
| agent-chat | 全站光球代理 | `/agent` | `/agent` | |
| create | 創作中心 | `/create` | `/create` | |
| playground | 模型樂園 | `/playground` | `/playground` | |
| studio | 創作工作室 | `/studio` | `/studio` | |
| director | 導演 AI | `/director` | `/director` | pageId 修正自舊值 `director-ai` |
| assets | 數位資產庫 | `/assets` | `/assets` | section=assets 時啟用 |
| models | 角色鍛造所 | `/models` | `/models` | pageTab="forge" 時啟用 |
| lora-trainer | AI 模型訓練中心 | `/models` | `/lora-trainer` → 重定向至 `/models` 內部分頁 | 父路由是 `/models`，刻意 |
| vault | 一致性保險庫 | `/vault` | `/vault` | |
| shared | 共享空間 | `/shared` | `/shared` | |
| notes | 專案筆記 | `/notes` | `/notes` | |
| calendar | 創作行事曆 | `/calendar` | `/calendar` | |
| dashboard | 儀表板 | `/dashboard` | `/dashboard` | |
| langsmith | AI 監控中心 | `/dashboard?section=langsmith` | `/langsmith` → 重定向至 `/dashboard?section=langsmith` | 父路由是 `/dashboard`，刻意 |
| feedback | 回饋中心 | `/feedback` | `/feedback` | |
| settings | 個人設定 | `/settings` | `/settings` | |
| brain-settings | AI 大腦設定 | `/settings/ai-brain` | `/settings/ai-brain` | |
| admin | 管理後台 | `/admin` | `/admin` | |
| admin-api-usage | API 用量分析 | `/admin/api-usage` | `/admin/api-usage` | |
| admin-brain-pipeline | 大腦推理鏈視覺化 | `/admin/brain-pipeline` | `/admin/brain-pipeline` | |
| my-brain | 我的大腦 | `/my-brain` | `/my-brain` | |
| pro-studio | 音樂配音創作室 | `/pro-studio` | `/pro-studio` | |
| image-studio | 圖片創作室 | `/image-studio` | `/image-studio` | |
| video-studio | 影片專業工作室 | `/video-studio` | `/video-studio` | |
| learn | 學習文件中心 | `/learn` | `/learn` | |
| ai-models-hub | AI 模型情報專區 | `/ai-models-hub` | `/ai-models-hub` | |
| tutorial-overview | 教學總覽 | `/tutorial-overview` | `/tutorial-overview` | |
| focus-flow | 專注流 | `/focus-flow` | `/focus-flow` | |
| history | 歷史記錄 | `/history` | `/history` | |
| background-tasks | 背景任務中心 | `/background-tasks` | `/background-tasks` | |
| credits | 積分說明 | `/credits` | `/credits` | |
| prompt-library | 提示詞庫 | `/prompt-library` | `/prompt-library` | |
| process-viewer | 流程說明檢視器 | `/process` | `/process` | `enabled` 取決於 `?spec=` |
| account-settings | 帳號設定 | `/account-settings` | `/account-settings` | 公開頁，見 §6.1 |

### 4.2 未註冊（理由皆合理）

| 檔案 | 類別 | 為什麼合理 |
|---|---|---|
| `client/src/pages/NotFound.tsx` | 404 | 無語意上下文 |
| `client/src/pages/ComponentShowcase.tsx` | UI 元件展示 | 純 dev 工具 |
| `client/src/pages/ForgotPasswordPage.tsx` | 公開認證 | 未登入無代理 |
| `client/src/pages/ResetPasswordPage.tsx` | 公開認證 | 未登入無代理 |
| `client/src/pages/DirectorAI_batch_dialog.tsx` | DirectorAI 的 dialog 子元件 | 由 `DirectorAI.tsx` 統籌（已註冊） |
| `client/src/pages/admin/brain/_components/*.tsx` | Brain dashboard 子元件 | 由父頁面統籌 |
| `client/src/pages/admin/brain/tabs/*.tsx` | Brain dashboard 分頁內容 | 由父頁面統籌 |
| `client/src/pages/settings/AgentPreferencesPage.tsx` | `/settings/agent` 子頁面 | 由 `settings` agent 涵蓋；可選擇單獨註冊（見 §6.2） |

### 4.3 死碼（建議後續清理）

| 檔案 | 行數 | 狀況 |
|---|---|---|
| ~~`client/src/pages/admin/AgentEvalPage.tsx`~~ | — | 已刪除（AIDV-585）：孤兒頁、零 import、手寫 `fetch("/api/trpc/...")` 缺 `x-trpc-source` 標頭會被 CSRF 守門擋 403。 |

---

## 5. UI 顯示路徑 — 哪些路由實際看得到光球？

光球（ProactiveOrbWidget）由 `DashboardLayout` 渲染
（`client/src/components/DashboardLayout.tsx:916`）。
只有用 `DashboardRoute` / `ProtectedDashboardRoute` 包起的路由才會出現浮動光球。

| Route 包裝 | 是否顯示 ProactiveOrbWidget |
|---|---|
| `DashboardRoute` / `ProtectedDashboardRoute` | ✅ |
| 裸 `Suspense`（直接 Route + Suspense） | ❌ |

裸 Route（沒有 DashboardLayout）：

| Route | 元件 | 註冊 PageAgent？ | 看得到光球？ | 處置 |
|---|---|---|---|---|
| `/forgot-password` | ForgotPasswordPage | ❌ | ❌ | 刻意，無需 |
| `/reset-password` | ResetPasswordPage | ❌ | ❌ | 刻意，無需 |
| `/account-settings` | AccountSettingsPage | ✅ | ❌ | **不一致**：見 §6.1 |
| `/process` | ProcessViewerPage | ✅ (有 spec 時) | ❌ | **不一致**：見 §6.1 |
| `/404` | NotFound | ❌ | ❌ | 刻意 |

---

## 6. 已知不一致 / wontfix 清單

### 6.1 PageAgent 已註冊但 Route 不在 DashboardLayout

`/account-settings` 與 `/process` 兩條 Route 都直接掛在 `<Switch>` 下、
沒包 `DashboardRoute`，所以雖然頁面有呼叫 `useRegisterPageAgent`，
但使用者實際看不到 ProactiveOrbWidget，只能透過全域快捷鍵
（Cmd/Ctrl+K）或從別頁跳轉時帶著面板狀態進去。

可能的設計意圖：
- `/account-settings`：偏重表單，刻意保持乾淨。
- `/process`：shareable 連結預覽，刻意極簡。

下一步：請設計確認哪一個是真意圖。若兩頁本就不該有浮動光球，建議在
這兩個 page component 拿掉 `useRegisterPageAgent`，避免空註冊產生
誤導性的 capability snapshot。本 PR 不動。

### 6.2 子頁面是否需要獨立 PageAgent

`client/src/pages/settings/AgentPreferencesPage.tsx`（路由 `/settings/agent`）
目前沒有自己的 `useRegisterPageAgent`，而是依靠 `settings` 這個父代理。
這是可以接受的，但若希望光球能直接 dispatch「修改某個代理偏好」這類精細
動作，未來可考慮給它一份獨立 capabilities。

### 6.3 巨型檔案（不在本次整理範圍）

| 檔案 | 行數 |
|---|---|
| `client/src/contexts/GlobalOrbChatContext.tsx` | 6444 |
| `client/src/components/OrbGuidePanel.tsx` | 4941 |
| `client/src/components/ProactiveOrbWidget.tsx` | 4122 |
| `client/src/pages/AgentChat.tsx` | 2804 |
| `client/src/pages/AIModelsHub.tsx` | 1524 |

拆分這些檔案需獨立 PR + 完整測試。`GlobalOrbChatContext` 是首要候選，建議
切成 storage / mutation / progress / suggestions / shortcut 五個 sub-module。

---

## 7. Slash-Command 系統覆蓋

來源：`shared/slash-commands.ts`、`client/src/lib/slashCommandRunner.ts`、
`docs/slash-command-system.md`。

### 7.1 已接入 / 指令的 UI 表面

| 表面 | 檔案 | 狀態 |
|---|---|---|
| ProactiveOrbWidget 輸入框 | `client/src/components/ProactiveOrbWidget.tsx` | ✅ |
| AgentChat 英雄輸入框 + 緊湊輸入框 | `client/src/pages/AgentChat.tsx` | ✅ |
| CommandPalette（⌘K） | `client/src/components/CommandPalette.tsx` | ✅ |
| SlashCommandMenu（自動完成浮層） | `client/src/components/SlashCommandMenu.tsx` | ✅ |
| SlashCommandChip（已選擇徽章） | `client/src/components/SlashCommandChip.tsx` | ✅ |

### 7.2 指令類別

| group | 指令數 | 用途 |
|---|---|---|
| `mode` | /auto /plan /nav /ask | 切代理模式 |
| `spirit` | 25 條（圖圖/影影/音音/⋯⋯） | 召喚 25 精靈 |
| `navigate` | /home /agent /settings 等 | 直接跳路由 |
| `memory` | /memory /forget | 記憶控制 |
| `action` | /export /share /clear | 一次性動作 |
| `session` | /new /reset /history | 對話控制 |
| `help` | /help /? | 資訊面板 |

詳見 `shared/slash-commands.ts` 與 `docs/slash-command-system.md`。

---

## 8. 後端端點 — 對應前端 UI 的索引

| 後端 endpoint（`server/routers.ts`） | 前端呼叫處 | 用途 |
|---|---|---|
| `ai.chat` | `GlobalOrbChatContext` | 主聊天 mutation |
| `ai.chatProgress` | `GlobalOrbChatContext` | 進度輪詢 |
| `ai.startTask` / `ai.task` / `ai.taskTimeline` / `ai.toolCallLogs` | `PageAgentContext`、ProactiveOrbWidget 任務面板 | 任務管理 |
| `ai.approveTask` / `ai.approveTaskStep` / `ai.reportTaskStep` | `PageAgentContext.dispatch()` | 動作審批 |
| `orbConversations.*` | OrbGuidePanel + ProactiveOrbWidget | 多工作階段 |
| `orbCapabilities.register` | 各頁面 `useRegisterPageAgent()` | 能力登記 |
| `orbProxy.*` | 全站代理工具呼叫 | 工具調用 |
| `agentCollaboration.*` | 多代理協作流程 | 精靈協作 |
| `agentPreferences.*` | `/settings/agent` | 使用者偏好 |

---

## 9. 相關文件索引

| 文件 | 角色 |
|---|---|
| `GLOBAL_ORB_CHAT_INTEGRATION.md` | 整合方案演進史與 Phase 進度 |
| `docs/global-orb-coverage-matrix.md` | 本檔；目前覆蓋狀況的權威矩陣 |
| `docs/slash-command-system.md` | / 指令架構 |
| `docs/agent/COMPLETE_ORB_SYSTEM_PLAN.md` | 光球系統完整設計 |
| `docs/agent/ARCHITECTURE_DEEP_DIVE.md` | 架構深度剖析 |
| `docs/25-spirits-integration-audit.md` | 25 精靈整合審計 |
| `docs/global-orb-capability-registry.md` | 能力登記簿 |
| `docs/global-orb-executor.md` | GlobalOrbExecutor |
| `docs/global-orb-task-state-machine.md` | 任務狀態機 |
| `docs/global-orb-memory-rag.md` | 記憶 / RAG |
| `docs/global-orb-provider-cost-quota.md` | 提供商成本配額 |
| `shared/appRegistry.ts` | 頁面/快捷動作登記簿 |
| `shared/slash-commands.ts` | / 指令登記簿 |
| `shared/agent-actions.ts` | AgentAction / Capability 型別 |
