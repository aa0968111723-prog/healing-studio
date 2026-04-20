# Admin API Usage & Cost Management

> 統一管理 fal.ai、Google Gemini、ElevenLabs、Suno 四家 AI 供應商的呼叫次數、credit、費用、配額上限與告警。

## 架構總覽

```
┌───────────────────────────────────────────────────────────────────┐
│                    Admin Dashboard (React)                        │
│  /admin/api-usage — 4 tabs: Overview │ Providers │ Rate Limit │ Billing │
└────────────────────────────────┬──────────────────────────────────┘
                                 │ tRPC (apiUsage.*)
┌────────────────────────────────▼──────────────────────────────────┐
│                    Express + tRPC Server                          │
│                                                                   │
│  ┌─────────────┐  ┌────────────────┐  ┌───────────────────────┐  │
│  │ AI Proxy    │  │ Provider       │  │ Alert Job             │  │
│  │ Gateway     │  │ Snapshot Job   │  │ (budget/quota/anomaly)│  │
│  │ /api/ai/:p  │  │ (every 15min)  │  │ (every 15min)         │  │
│  └──────┬──────┘  └───────┬────────┘  └──────────┬────────────┘  │
│         │                 │                       │               │
│         ▼                 ▼                       ▼               │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    MySQL (Drizzle ORM)                       │  │
│  │  ai_usage_events │ provider_snapshots │ cost_aggregations   │  │
│  │  rate_limit_rules │ alert_configs                            │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
         │                 │
         ▼                 ▼
   ┌──────────┐    ┌──────────────┐
   │ PostHog  │    │ Slack/Email  │
   │ (events) │    │ (alerts)     │
   └──────────┘    └──────────────┘
```

## 資料模型

### `ai_usage_events` — AI API 呼叫事件紀錄

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | INT (PK) | 自增主鍵 |
| provider | ENUM | fal_ai / gemini / elevenlabs / suno |
| endpoint | VARCHAR(256) | API 端點路徑 |
| userId | INT | 呼叫者 ID（可選） |
| apiKeyId | VARCHAR(128) | 使用的 API Key ID |
| status | ENUM | success / failed / timeout / rate_limited |
| units | DECIMAL(12,4) | 消耗單位數 |
| unitType | ENUM | token / character / credit / second / image / request |
| costUsd | DECIMAL(12,6) | 預估費用（美元） |
| latencyMs | INT | 回應延遲（毫秒） |
| requestMeta | JSON | 額外中繼資料 |
| errorMessage | TEXT | 錯誤訊息 |
| createdAt | TIMESTAMP | 建立時間 |

### `provider_snapshots` — 供應商狀態快照（每 15 分鐘）

Records: tier, quota, remaining, balanceUsd, nextInvoice, concurrency, extraData.

### `cost_aggregations` — 每日費用聚合

按 provider + endpoint + date 聚合的每日費用摘要。

### `rate_limit_rules` — 速率限制規則

支援 per_user / per_api_key / global 三種規則類型。

### `alert_configs` — 告警設定

支援 budget / quota / anomaly 三種告警類型。

## Proxy Gateway

**路由**: `POST/GET /api/ai/:provider/*`

1. 驗證 provider 合法性
2. 從 `serverEnv` 讀取 API Key（不寫入 code）
3. 檢查 rate limit 規則
4. 轉發到供應商 API
5. 記錄 usage event
6. 雙寫 PostHog 事件 (`ai_api_call`)

### Provider Base URLs

| Provider | Base URL |
|----------|----------|
| fal_ai | `https://fal.run` |
| gemini | `https://generativelanguage.googleapis.com` |
| elevenlabs | `https://api.elevenlabs.io` |
| suno | `https://api.sunoapi.org` |

## 排程任務

### Provider Snapshot Job
- **排程**: 每 15 分鐘
- **功能**: 輪詢供應商 API 取得配額/餘額 + 聚合 usage events

### API Usage Alert Job
- **排程**: 每 15 分鐘
- **三種告警**:
  1. **預算告警**: 累計費用 > 月預算 × (日/月天數) × 1.3
  2. **配額告警**: remaining < 20%（警告）或 < 5%（危急）
  3. **異常告警**: 近 1h 錯誤率 > 5%
- **輸出**: Slack webhook + console log
- **去重**: 同類告警每小時最多觸發一次

## 後台 UI

路由: `/admin/api-usage`

### 四個 Tab

1. **總覽 (Overview)** — 4 KPI 卡 + 堆疊面積圖 + 餘額進度條
2. **供應商 (Providers)** — 每家一張 GlassCard + 日期過濾
3. **速率限制 (Rate Limit)** — CRUD 規則表
4. **帳單 (Billing)** — 彙總表 + CSV 匯出

## 環境變數

| 變數 | 用途 |
|------|------|
| `FAL_API_KEY` | fal.ai Proxy |
| `GEMINI_API_KEY` | Gemini Proxy |
| `ELEVENLABS_API_KEY` | ElevenLabs Proxy |
| `SUNO_API_KEY` | Suno Proxy |
| `ALERT_SLACK_WEBHOOK` | Slack 告警 webhook |
| `ALERT_EMAIL_RECIPIENTS` | Email 告警收件人 |
| `AI_MONTHLY_BUDGET_USD` | 月預算（預設 500） |
| `POSTHOG_API_KEY` | PostHog server-side key |
| `POSTHOG_HOST` | PostHog 主機 URL |

## 擴充

Provider enum (`AI_PROVIDERS`) 定義於 `drizzle/schema.ts`，新增供應商只需：
1. 在 `AI_PROVIDERS` 陣列加入新值
2. 在 `server/routes/aiProxy.ts` 的 `PROVIDER_CONFIG` 加入設定
3. 在 `server/jobs/providerSnapshotJob.ts` 加入輪詢邏輯
4. 在 `config/pricing-table.json` 加入定價
5. 執行 DB migration
