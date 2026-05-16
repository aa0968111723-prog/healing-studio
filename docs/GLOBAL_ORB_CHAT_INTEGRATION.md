# 全站光球聊天整合方案

## 概述

本文件記錄全站光球聊天（Global Orb Chat）的實作與整合方案，實現光球代理人的深度全站整合，包括前後端連結與持久化聊天功能。

## 已完成功能（Phase 1）

### 1. GlobalOrbChatContext 核心狀態管理

**檔案位置**: `client/src/contexts/GlobalOrbChatContext.tsx`

**核心功能**:
- ✅ 全站統一的光球聊天狀態與歷史記錄
- ✅ localStorage 持久化（7天過期，最多保存100條訊息）
- ✅ 跨頁面導航的聊天連續性
- ✅ 與 PageAgentContext 深度整合以執行結構化動作
- ✅ 與 PersonalityContext 整合（依人格顯示不同歡迎訊息）
- ✅ 頁面上下文感知（每條訊息記錄所在頁面路徑）

**API 介面**:
```typescript
interface GlobalOrbChatContextValue {
  messages: ChatMessage[];          // 聊天訊息歷史
  input: string;                    // 當前輸入的文字
  isSending: boolean;               // 是否正在發送/等待回覆
  suggestions: ChatSuggestion[];    // 當前的建議快速回覆
  isOpen: boolean;                  // 聊天面板是否開啟

  // Actions
  setInput: (text: string) => void;
  sendMessage: (text: string) => Promise<void>;
  open: () => void;
  close: () => void;
  toggle: () => void;
  clearHistory: () => void;
  resetConversation: () => void;
}
```

**訊息結構**:
```typescript
interface ChatMessage {
  role: "user" | "orb";
  text: string;
  at: number;                      // 時間戳
  intent?: string;                 // 光球的意圖摘要
  pagePath?: string;               // 關聯的頁面路徑
  actions?: AgentAction[];         // 結構化動作
}
```

### 2. App.tsx Provider 整合

**檔案位置**: `client/src/App.tsx`

GlobalOrbChatProvider 已加入 Provider 堆疊，位置在（截至 2026-05-15 的實際結構，
詳見 `client/src/App.tsx:326-376`）：

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
                              └─ PageAgentProvider
                                 └─ OrbStateProvider
                                    └─ GlobalOrbChatProvider  ← 全站聊天狀態
                                       └─ IntentCardProvider
                                          └─ TooltipProvider
                                             └─ <Router />
```

**重要性**:
- GlobalOrbChatProvider 必須在 PageAgentProvider 內部，才能存取 `pageAgent.dispatch` 來執行 LLM 回傳的結構化動作。
- 必須在 OrbStateProvider 內部，才能與光球視覺狀態（開/關面板）同步。
- 必須在 PersonalityProvider 內部，才能依人格切換歡迎訊息。

> 完整覆蓋矩陣（每頁 PageAgent 註冊、UI 表面、已知不一致）請見
> `docs/global-orb-coverage-matrix.md`。

### 3. 後端整合

**現有端點**: `server/routers.ts` 中的 `ai.chat`

GlobalOrbChatContext 使用現有的 `trpc.ai.chat` mutation，支援：
- ✅ 結構化頁面 snapshot（pageSnapshot）
- ✅ 最近回饋歷史（recentFeedback）
- ✅ 人格系統（personality）
- ✅ 頁面上下文（context）
- ✅ 結構化動作返回（actions）
- ✅ 意圖摘要（intent）
- ✅ 快速回覆建議（suggestions）

## 待完成功能（Phase 2）

### 1. ProactiveOrbWidget 整合 ✅ 已完成

**目標**: 讓浮動光球使用全站聊天狀態

**已完成**:
- ✅ ProactiveOrbWidget 使用 GlobalOrbChat 狀態
- ✅ 移除本地聊天狀態和 aiChatMutation
- ✅ 聊天訊息、輸入、載入狀態全部連接到全站狀態
- ✅ 快速回覆建議使用全站建議

### 2. OrbGuidePanel 整合 ✅ 已完成

**目標**: OrbGuidePanel 的「自由聊天」模式也使用全站狀態

**已完成**:
- ✅ OrbGuidePanel 聊天模式使用 GlobalOrbChat 狀態
- ✅ 移除本地 chatMessages, chatInput 狀態
- ✅ 切換到聊天模式時自動開啟全站聊天
- ✅ 使用 globalChat.sendMessage 發送訊息

### 3. AgentChat 頁面整合 ✅ 已完成

**目標**: `/agent` 頁面也使用全站狀態，實現真正的「隨處聊天」

**已完成**:
- ✅ AgentChat 頁面使用 GlobalOrbChat 狀態
- ✅ 移除本地 messages, input, isSending 狀態
- ✅ 頁面載入時自動開啟全站聊天
- ✅ 使用 globalChat.sendMessage 發送訊息

### 4. 聊天歷史 UI 增強 ✅ 已完成（工具函數）

**功能需求**:
- ✅ 顯示每條訊息關聯的頁面（可點擊跳轉）
- ✅ 時間戳顯示（相對時間：「2 分鐘前」）
- [ ] 訊息搜尋功能
- [ ] 匯出聊天記錄
- [ ] 按日期分組顯示

**已完成**:
- ✅ 創建 `orbChatHelpers.ts` 工具函數庫
- ✅ `getPageLabelByPath()` - 根據路徑獲取頁面標籤
- ✅ `formatRelativeTime()` - 格式化相對時間（「2 分鐘前」、「剛剛」等）
- ✅ `formatMessageMetadata()` - 組合頁面標籤與時間戳
- ✅ `getPageEmoji()` - 為不同頁面返回對應表情符號
- ✅ GlobalOrbChatContext 導出這些工具函數供外部使用

**UI 示例**:
```
[圖像工作室] 🎨 2 分鐘前
我想生成一張寧靜森林的圖片

[光球] ✨ 2 分鐘前
好！我幫你選好了療癒水彩風格，帶你去圖像工作室 ✨
→ [ACTION: navigate to /image-studio]
```

### 5. 快捷鍵與全域訪問 ✅ 已完成

**功能需求**:
- ✅ 全域快捷鍵（`Cmd+K` 或 `Ctrl+K`）喚起聊天
- ✅ 在任何頁面都能快速開啟聊天面板
- ✅ ESC 快捷鍵關閉聊天面板
- [ ] 聊天面板固定位置選項（右下角、左下角、全螢幕）

**已完成**:
- ✅ 在 GlobalOrbChatContext 中實作全域快捷鍵監聽
- ✅ Cmd+K / Ctrl+K 切換聊天面板開關
- ✅ ESC 關閉聊天面板
- ✅ 智慧衝突避免：當焦點在 INPUT 或 TEXTAREA 時跳過快捷鍵
- ✅ 阻止瀏覽器預設行為和事件冒泡

### 6. 進階功能

**多輪對話記憶**:
- [ ] 支援多輪對話中的代詞指代（「它」、「那個」）
- [ ] 記住用戶偏好（模型選擇、風格偏好）
- [ ] 從對話中學習並調整建議

**語音輸入**:
- [ ] 整合 Web Speech API
- [ ] 語音轉文字輸入
- [ ] 語音喚醒光球

**多語言支援**:
- [ ] 自動偵測輸入語言
- [ ] 多語言回覆
- [ ] 翻譯功能

## 技術架構

### 狀態管理流程

```
User Input
    ↓
GlobalOrbChatContext.sendMessage()
    ↓
trpc.ai.chat.mutateAsync()
    ↓
server/routers.ts (ai.chat)
    ↓
buildOrbSystemPrompt() + invokeLLM()
    ↓
parseOrbReply()
    ↓
返回 { reply, actions, intent, suggestions }
    ↓
GlobalOrbChatContext 更新 messages
    ↓
pageAgent.dispatch(actions) ← 執行結構化動作
    ↓
localStorage 持久化
```

### 資料流向

```
┌─────────────────────────────────────┐
│   GlobalOrbChatContext              │
│   - messages (array)                │
│   - localStorage persistence        │
│   - 7-day expiry                    │
└──────────────┬──────────────────────┘
               │
               ├─── ProactiveOrbWidget (浮動光球)
               │
               ├─── OrbGuidePanel (引導面板)
               │
               ├─── AgentChat (/agent 頁面)
               │
               └─── 未來更多 UI 元件...
```

### 持久化策略

**localStorage 鍵值**:
- `orb-chat-messages`: 訊息陣列（JSON）
- `orb-chat-timestamp`: 最後更新時間戳

**過期機制**:
- 7 天未使用自動清除
- 保留最近 100 條訊息
- 版本控制（`v1`）以支援未來升級

## 使用範例

### 基本使用

```typescript
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";

function MyComponent() {
  const chat = useGlobalOrbChat();

  return (
    <div>
      <button onClick={chat.open}>開啟聊天</button>

      {chat.isOpen && (
        <div>
          {chat.messages.map((msg, i) => (
            <div key={i}>
              {msg.role === "user" ? "你" : "光球"}: {msg.text}
            </div>
          ))}

          <input
            value={chat.input}
            onChange={e => chat.setInput(e.target.value)}
          />

          <button
            onClick={() => chat.sendMessage(chat.input)}
            disabled={chat.isSending}
          >
            發送
          </button>
        </div>
      )}
    </div>
  );
}
```

### 進階使用（含建議）

```typescript
function ChatPanel() {
  const chat = useGlobalOrbChat();

  return (
    <div>
      {/* 訊息列表 */}
      {chat.messages.map((msg, i) => (
        <Message
          key={i}
          message={msg}
          // 顯示頁面標籤
          pageLabel={msg.pagePath ? getPageLabel(msg.pagePath) : undefined}
        />
      ))}

      {/* 快速回覆建議 */}
      {chat.suggestions.length > 0 && (
        <div>
          {chat.suggestions.map(suggestion => (
            <button
              key={suggestion.text}
              onClick={() => chat.sendMessage(suggestion.text)}
            >
              {suggestion.text}
            </button>
          ))}
        </div>
      )}

      {/* 輸入框 */}
      <input
        value={chat.input}
        onChange={e => chat.setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            chat.sendMessage(chat.input);
          }
        }}
      />
    </div>
  );
}
```

## 測試計畫

### 單元測試
- [ ] localStorage 讀寫功能
- [ ] 訊息過期清除機制
- [ ] 最大訊息數量限制

### 整合測試
- [ ] 跨頁面導航聊天連續性
- [ ] PageAgentContext 動作派送
- [ ] tRPC 端點整合

### E2E 測試
- [ ] 完整對話流程
- [ ] 快速回覆功能
- [ ] 清除歷史功能
- [ ] 重置對話功能

## 效能考量

### 優化策略
1. **訊息分頁載入**: 當訊息過多時（>50條），使用虛擬滾動
2. **防抖輸入**: 輸入事件使用 debounce 減少重渲染
3. **記憶化**: 使用 useMemo 快取計算結果
4. **懶加載**: 聊天面板按需載入，不影響首屏速度

### 記憶體管理
- localStorage 自動清理過期資料
- 限制最大訊息數（100條）
- 定期清理超過 7 天的資料

## 安全性

### 資料保護
- 訊息僅存儲在用戶本地 localStorage
- 不包含敏感資訊（API keys, tokens）
- 支援清除所有歷史記錄

### XSS 防護
- 所有用戶輸入經過 sanitization
- 使用 React 內建的 XSS 防護
- Markdown 渲染使用安全的 LazyStreamdown 元件

## 部署檢查清單

- [x] GlobalOrbChatContext 實作完成
- [x] App.tsx Provider 整合
- [x] localStorage 持久化
- [x] ProactiveOrbWidget 整合
- [x] OrbGuidePanel 整合
- [x] AgentChat 頁面整合
- [x] 建置測試通過（817 個測試全部通過）
- [ ] E2E 測試
- [ ] 效能測試
- [ ] 跨頁面聊天連續性手動測試
- [x] 文件更新（2026-05-15：新增 `docs/global-orb-coverage-matrix.md` 並修正 Provider 堆疊圖）

## 下一步

**Phase 3 全站細節連結已完成** ✅

剩餘優化項目：

1. **UI 增強** (Phase 3+)
   - 實作訊息搜尋功能
   - 實作匯出聊天記錄
   - 按日期分組顯示訊息
   - 聊天面板固定位置選項

2. **測試與優化** (Phase 3+)
   - E2E 測試
   - 效能優化
   - 跨頁面聊天連續性測試

## 相關檔案

### 新增檔案
- `client/src/contexts/GlobalOrbChatContext.tsx` - 全站聊天狀態管理
- `client/src/lib/orbChatHelpers.ts` - 聊天輔助工具函數（頁面標籤、時間格式化、表情符號）
- `client/src/hooks/useGlobalChatShortcut.ts` - 全域快捷鍵 Hook（已整合至 Context）

### 修改檔案
- `client/src/App.tsx` - Provider 堆疊整合

### 相關現有檔案
- `client/src/components/ProactiveOrbWidget.tsx` - 浮動光球
- `client/src/components/OrbGuidePanel.tsx` - 引導面板
- `client/src/pages/AgentChat.tsx` - 聊天頁面
- `client/src/contexts/PageAgentContext.tsx` - 頁面代理上下文
- `server/routers.ts` - AI 聊天端點
- `server/services/siteKnowledge.ts` - 光球系統提示詞
- `server/services/orbReplyParser.ts` - 光球回覆解析器

## 貢獻者

- 初始實作: Claude Sonnet 4.5
- 整合設計: 基於現有 Orb Agent 架構

---

最後更新: 2026-05-15
版本: Phase 3 Complete (Site-wide Detail Integration Finished)

> 目前全站覆蓋盤點與不一致清單請查閱 `docs/global-orb-coverage-matrix.md`。

## 實作完成摘要

**Phase 1 (已完成)**:
- ✅ GlobalOrbChatContext 核心狀態管理
- ✅ App.tsx Provider 整合
- ✅ localStorage 持久化

**Phase 2 (已完成)**:
- ✅ ProactiveOrbWidget 完整整合
- ✅ OrbGuidePanel 聊天模式整合
- ✅ AgentChat 頁面整合
- ✅ 所有建置測試通過（817/817 測試）

**Phase 3 (已完成)**:
- ✅ 創建聊天輔助工具函數（orbChatHelpers.ts）
- ✅ 頁面標籤與表情符號顯示支援
- ✅ 相對時間格式化（「2 分鐘前」、「剛剛」等）
- ✅ 全域快捷鍵實作（Cmd+K / Ctrl+K 和 ESC）
- ✅ 智慧快捷鍵衝突避免
- ✅ 建置測試通過

**效果**:
- 用戶現在可以在任何頁面與光球對話
- 聊天歷史跨頁面持續存在
- 所有聊天 UI 共享同一個狀態
- localStorage 自動持久化（7天過期）
- Cmd+K / Ctrl+K 快速喚起聊天
- 訊息顯示包含頁面上下文和時間資訊
