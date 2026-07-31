# 全站光球代理尚缺項目（2026-04-29）

依據既有審計文件，主鏈路（全站聊天、OrbGuide、工具橋接、生成管線）已接通；目前剩餘以「治理與驗證層」為主。

## 仍缺 / 建議補齊

1. **管理頁能力覆蓋不足（低優先）**
   - AdminPage / LangSmithPage 尚未加入對應 agent capabilities。

2. **端到端自動化測試缺口（中優先）**
   - 尚缺 Playwright 級別「完整光球聊天 + 確認卡 + 動作執行」流程測試。

3. **聊天體驗功能尚未補齊（低優先）**
   - 訊息搜尋。
   - 依日期分組顯示歷史訊息。
   - 語音輸入（Web Speech API）。

4. **跨頁持續性驗證尚未產品化（中優先）**
   - LocalStorage 跨頁連續性目前仍偏手動驗證，建議轉成可重複的檢查腳本或 E2E case。

## 已非缺口（可視為完成）

- 光球 `studio.generateImage/Video/Audio/Voice` 工具註冊與 server executor 橋接。
- `dispatchFalQueueTask` 與 fallback chain 接通。
- Suno 音樂生成 / Replicate LoRA 訓練路由接通。
- `localizeResultUrls` 同步回傳一致性補齊。

## 來源

- `docs/connection-audit-2026-04-29.md`
- `orb_connection_report.md`
