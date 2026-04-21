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

GlobalOrbChatProvider 已加入 Provider 堆疊，位置在：
```
ThemeProvider
  └─ PersonalityProvider
      └─ NotesDrawerProvider
          └─ ShowcaseTransferProvider
              └─ SiteOnboardingProvider
                  └─ FocusFlowProvider
                      └─ AmbientProvider
                          └─ OrbGuideProvider
                              └─ PageAgentProvider
                                  └─ GlobalOrbChatProvider  ← 新增
                                      └─ TooltipProvider
```

**重要性**: GlobalOrbChatProvider 必須在 PageAgentProvider 內部才能存取 pageAgent.dispatch 來執行動作。

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

### 1. ProactiveOrbWidget 整合

**目標**: 讓浮動光球使用全站聊天狀態

**整合方案**:
```typescript
// 在 ProactiveOrbWidget 中
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";

// 可選：使用全站狀態或保持本地狀態
const globalChat = useGlobalOrbChat();
const useGlobalState = true; // 可配置

// 根據配置選擇狀態源
const messages = useGlobalState ? globalChat.messages : chatMessages;
const input = useGlobalState ? globalChat.input : chatInput;
const setInput = useGlobalState ? globalChat.setInput : setChatInput;
// ...等等
```

**優點**:
- 保持向後相容（現有本地狀態繼續運作）
- 可平滑過渡到全站狀態
- 用戶在不同頁面看到連續的對話

### 2. OrbGuidePanel 聊天模式整合

**目標**: OrbGuidePanel 的「自由聊天」模式也使用全站狀態

**當前狀況**: OrbGuidePanel 有自己的 chatMessages 本地狀態（lines 156-202）

**整合方案**:
```typescript
// 在 OrbGuidePanel 中
const globalChat = useGlobalOrbChat();

// 聊天模式使用全站狀態
if (panelMode === "chat") {
  // 使用 globalChat.messages, globalChat.sendMessage 等
}
```

### 3. AgentChat 頁面整合

**目標**: `/agent` 頁面也使用全站狀態，實現真正的「隨處聊天」

**當前狀況**: AgentChat 有自己獨立的 messages 狀態

**整合方案**:
```typescript
// 在 AgentChat.tsx 中
const globalChat = useGlobalOrbChat();

// 直接使用全站狀態
const { messages, sendMessage, input, setInput, isSending } = globalChat;
```

### 4. 聊天歷史 UI 增強

**功能需求**:
- [ ] 顯示每條訊息關聯的頁面（可點擊跳轉）
- [ ] 時間戳顯示（相對時間：「2 分鐘前」）
- [ ] 訊息搜尋功能
- [ ] 匯出聊天記錄
- [ ] 按日期分組顯示

**UI 示例**:
```
[圖像工作室] 🎨 2 分鐘前
我想生成一張寧靜森林的圖片

[光球] ✨ 2 分鐘前
好！我幫你選好了療癒水彩風格，帶你去圖像工作室 ✨
→ [ACTION: navigate to /image-studio]
```

### 5. 快捷鍵與全域訪問

**功能需求**:
- [ ] 全域快捷鍵（例如 `Cmd+K` 或 `Ctrl+K`）喚起聊天
- [ ] 在任何頁面都能快速開啟聊天面板
- [ ] 聊天面板固定位置選項（右下角、左下角、全螢幕）

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
- [ ] ProactiveOrbWidget 整合
- [ ] OrbGuidePanel 整合
- [ ] AgentChat 頁面整合
- [ ] 單元測試
- [ ] E2E 測試
- [ ] 效能測試
- [ ] 文件更新

## 下一步

1. **完成 ProactiveOrbWidget 整合** (Phase 2.1)
   - 讓浮動光球使用全站聊天狀態
   - 保持向後相容性

2. **完成 OrbGuidePanel 整合** (Phase 2.2)
   - 聊天模式使用全站狀態
   - 統一使用體驗

3. **完成 AgentChat 頁面整合** (Phase 2.3)
   - `/agent` 頁面直接使用全站狀態
   - 移除重複代碼

4. **UI 增強** (Phase 2.4)
   - 實作訊息搜尋
   - 頁面標籤顯示
   - 時間戳美化

5. **測試與優化** (Phase 2.5)
   - 完整測試覆蓋
   - 效能優化
   - 文件完善

## 相關檔案

### 新增檔案
- `client/src/contexts/GlobalOrbChatContext.tsx` - 全站聊天狀態管理

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

最後更新: 2026-04-21
版本: Phase 1 Complete
