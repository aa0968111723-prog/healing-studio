# Slash Command 系統

Claude Code 風格的「/ 指令」入口，把光球 4 種代理模式、25 位精靈、頁面跳轉、
記憶／匯出／分享等動作統一收攏在 chat 輸入框，並與既有 `⌘K` CommandPalette
共存。

## 為什麼存在這個系統？

之前每種代理功能都各自有一個 UI 入口：

- 多步驟 / 計畫 / 跳頁 / 問答 → AgentChat 上一排模式按鈕
- 25 位精靈 → 「@暱稱」前綴 + 卡片牆
- 跨頁搜尋 / 匯出 / 清記憶 / 分享 → `⌘K` palette
- 新對話 / 清空 → 頁眉的下拉

打字快過點按，但要使用者記得「現在這個功能在哪個面板」幾乎不可能。Slash
command 系統讓任何代理行為都能以鍵盤快速喚起：在 chat 輸入框打 `/`，autocomplete
立刻列出所有可用指令並支援鍵盤導覽。

## 架構

```
shared/slash-commands.ts            登記簿 + 解析器（純資料，前後端可共用）
client/src/lib/slashCommandRunner.ts 客戶端執行器（依注入 context 分派）
client/src/hooks/useSlashCommandMenu.ts  選單狀態與鍵盤導覽
client/src/hooks/useSlashCommandContext.ts  把 globalChat/wouter/trpc 包成
                                                runner 需要的 context
client/src/components/SlashCommandMenu.tsx  自動完成浮層
client/src/components/SlashCommandChip.tsx  輸入框內的「已選擇指令」徽章
```

接入點：

- `client/src/pages/AgentChat.tsx`（hero 輸入框 + compact 輸入框）
- `client/src/components/ProactiveOrbWidget.tsx`（mobile + desktop 輸入框）
- `client/src/components/CommandPalette.tsx`（`⌘K` 中也能找到 slash 指令）

## 內建指令

| 分類 | 範例 | 行為 |
|------|------|------|
| 代理模式 | `/auto 做支預告片` | 多步驟代理 — 等同點亮「多步驟」模式 |
|         | `/plan 影片產出` | 計畫模式 — 光球先擬計畫表 |
|         | `/nav 配音工具` | 跳頁 — 帶到對應工具頁 |
|         | `/ask 一致性模型` | 純問答 — 解釋功能不動手 |
| 精靈呼叫 | `/image 賽博龐克貓` | 走 `@圖圖` pipeline → 圖像精靈接手 |
|         | `/video / /music / /voice / /train` 等共 25 個 | 對應 25 位精靈 |
|         | `/圖圖`、`/影影`、`/director` | 中文暱稱、別名都可用 |
| 頁面跳轉 | `/home`、`/agent`、`/settings` | 直接跳路由 |
|         | `/go image-studio` | 用關鍵字解析頁面 |
| 快捷動作 | `/search 上禮拜的森林` | 走全站搜尋 |
|         | `/export` / `/share` | 匯出 PDF / 分享 workflow |
| 記憶 | `/memory` / `/forget` | 看／清光球的偏好記憶 |
| 對話控制 | `/new` / `/clear` | 開新分頁 / 清空目前對話 |
| 幫助 | `/help` / `/spirits` | 列指令 / 列精靈 |

完整清單以 `shared/slash-commands.ts` 為準。

## 鍵盤操作

| 鍵 | 作用 |
|----|------|
| `/` | 觸發 autocomplete |
| ↑ / ↓ | 選擇候選命令 |
| Tab | 補完命令名稱（保留游標） |
| Enter | 命令未補完 → 套用該命令；命令已完整 → 送出 |
| Esc | 關閉選單但保留輸入字串 |
| 點擊命令 | 寫回輸入框 + 關選單 |

## 設計取捨

- **/ 與 @ 並行**：`/` 是「動作指令」、`@` 是「精靈呼叫」（保留原有 mention 機制）。Spirit 命令把使用者輸入翻成 `@暱稱 argument`，再走既有 `sendMessage` pipeline — 這樣後端 `selectRoleForIntent` 與 `spirit.invoke` 行為完全不變。
- **保留模式按鈕**：UI 視覺發現入口（模式選擇器、精靈卡片牆）保留，slash command 是快捷補充。兩邊共用同一份指令登記簿。
- **沒有獨立後端 endpoint**：所有需要後端的指令最終走 `globalChat.sendMessage`，避免增加維護表面積。
- **shared 純度**：`shared/slash-commands.ts` 不依賴 React／DOM／server，純資料 + 純函式，前後端 + vitest 純邏輯測試都能 import。
- **執行錯誤集中處理**：缺參數 / 未知指令 / 執行例外都在 runner 內收斂成 result 物件並 toast，呼叫端只看到「ran / not-a-command / error」三種狀態。

## 加新指令

1. 在 `shared/slash-commands.ts` 的對應 group 陣列加一筆 `SlashCommand`。
2. 如果是新的「動作種類」，在 `SlashCommandKind` 加一個聯集分支並在
   `client/src/lib/slashCommandRunner.ts` 的 switch 處理。
3. 新增 vitest 案例（`server/slash-commands.test.ts` + `server/slash-command-runner.test.ts`）。

不需要改 chat input 元件 — 指令是純資料，UI 會自動列出。

## 測試

```bash
# Slash-only 測試（前後端純邏輯 + 元件互動）
npx vitest run \
  server/slash-commands.test.ts \
  server/slash-command-runner.test.ts \
  tests/unit/client/slash-command-menu.test.tsx \
  tests/unit/client/slash-command-chip.test.tsx
```
