# API Key 申請與設定教學（Healing Studio）

本文提供全站 AI API 的快速檢查與申請流程，適用於本機開發與 Railway 部署。

## 1) 先檢查目前缺哪些金鑰

### 後台檢查（推薦）
- 進入 `/admin/api-usage`。
- 呼叫 `apiUsage.providerReadiness` 可看到每個 provider：
  - `configured`：是否已設定
  - `envVar`：對應環境變數名稱
  - `applyGuideUrl`：官方申請連結

### 啟動時檢查
- 後端啟動時會在 console 顯示 API key 狀態摘要。
- 若未設定，會顯示 OARS 提示（觀察 / 影響 / 建議 / 提示）。

## 2) 各服務申請入口

- **Gemini**：`https://aistudio.google.com/apikey`
- **fal.ai**：`https://fal.ai/dashboard/keys`
- **ElevenLabs**：`https://elevenlabs.io/app/settings/api-keys`
- **Suno**：`https://suno.com/`（依官方開發者方案申請）

## 3) 設定到環境變數

將金鑰填入 `.env`（本機）或 Railway Variables（雲端）：

```bash
GEMINI_API_KEY=...
FAL_API_KEY=...
ELEVENLABS_API_KEY=...
SUNO_API_KEY=...
```

> 完成後請重啟 server，讓新環境變數生效。

## 4) 驗證是否成功

- 呼叫 `/api/ai/:provider/*` 時，若金鑰缺失會回傳 `503`，並附上：
  - `missingEnvVar`
  - `applyGuideUrl`
  - `action`
- `apiUsage.providerReadiness` 會顯示 `configured: true`。

## 5) 常見問題

- **有設 key 但還是 503？**
  - 檢查是不是設到錯誤環境（local / staging / production）。
  - 檢查變數名稱是否完全一致（例如 `FAL_API_KEY` 不是 `FAL_KEY`）。
  - 重新部署或重啟服務。

- **有 key 但請求還是失敗？**
  - 檢查供應商額度、帳號權限、地區限制。
  - 到 `/admin/api-usage` 看錯誤率與 usage event log。
