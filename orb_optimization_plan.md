# 全站光球助手精準優化計劃

## 發現的問題

### 問題 1：appRegistry.supportedActions 與實際頁面能力不一致

以下頁面在前端 `handle()` 中實際支援 `navigate` 動作，但 appRegistry 的 `supportedActions` 未宣告：

| 頁面 | 缺少的 supportedActions |
|------|------------------------|
| admin | navigate, setTab |
| admin-api-usage | navigate, setTab |
| admin-brain-pipeline | navigate |
| agent-chat | navigate, search |
| brain-settings | navigate |
| calendar | navigate |
| credits | navigate |
| dashboard | navigate |
| focus-flow | navigate |
| home | navigate |
| models | navigate |
| my-brain | navigate |
| shared | navigate |
| tutorial-overview | navigate |
| vault | navigate |

**影響**：光球的 static-fallback router 使用 `supportedActions` 來判斷一個頁面是否能處理某個動作。如果 `navigate` 未被宣告，光球可能會認為該頁面無法處理導航請求，導致「no route found」的靜默失敗。

### 問題 2：PAGE_TO_GUIDE_INTENT 覆蓋不完整

目前 `PAGE_TO_GUIDE_INTENT` 只映射了 6 個頁面：
- studio → explore
- image-studio → image
- video-studio → video
- pro-studio → music
- director → script
- lora-trainer → lora

但 `GuideIntent` 還有 `voice` 意圖未被任何頁面映射。此外，其他資訊型頁面（如 learn、notes 等）沒有引導意圖，這是合理的設計（因為它們不是創作頁面）。

### 問題 3：appRegistry quickActions 中的 path 指向不精確

部分 quickActions 的 `path` 指向了不正確或過時的路徑：
- dashboard 的 `view-stats` 沒有 path（合理，因為它就在當前頁）
- credits 的 `view-credits` 沒有 path（合理）

### 問題 4：studio 頁面缺少 PAGE_QUICK_ACTIONS 中的「互動式導覽」(interactive-guide)

雖然全域 QUICK_ACTIONS 有 `interactive-guide`，但 studio 的 PAGE_QUICK_ACTIONS 沒有直接包含它。不過在 `resolvedPageQuickActions` 的動態邏輯中有處理，所以這是正常的。

## 優化方案

### 修正 1：更新 appRegistry.supportedActions
為所有實際支援 `navigate` 的頁面添加 `"navigate"` 到 `supportedActions`。

### 修正 2：為 pro-studio 添加 voice 引導意圖映射
在 `PAGE_TO_GUIDE_INTENT` 中，pro-studio 目前映射到 `music`。由於 pro-studio 同時處理音樂和語音，考慮是否需要根據當前 tab 動態切換。但由於 GuideIntent 是靜態映射，保持 `music` 是合理的（語音是音樂的子集功能）。

### 修正 3：確保所有頁面的光球 greeting 語氣與功能精準對應
檢查是否有 greeting 語氣與頁面功能不匹配的情況。
