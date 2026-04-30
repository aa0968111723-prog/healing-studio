# 人工補齊清單（Railway 環境變數）

**建立日期**：2026-04-30
**分支**：`claude/test-api-pipelines-lgkOn`
**對象**：Railway → 您的專案 → Variables

> 先看「✅ 我已自動修好」這段，可以跳過已被程式碼補住的項目；接著按
> 🔴 必修 → 🟡 建議 → ⚪ 可略 的順序逐一處理。

---

## ✅ 我已自動修好（程式內補丁，您不用動，但建議仍把 Railway 改正）

階段 1 commit `ac8b89e` 加上的 `selfRepairEnv()` 會在系統啟動時自動處理：

| 您的原值 | 自動修復後 | 備註 |
|---------|-----------|------|
| `NTHROPIC_API_KEY=...` | 自動別名為 `ANTHROPIC_API_KEY` | 仍建議您把變數名改正以免日後混淆 |
| `NVIDA_API=...` | 同步映射到 `NVIDIA_API` | 兩種拼法都能讀 |
| `FAL_KEY=...` | 同步映射到 `FAL_API_KEY` | 兩種拼法都能讀 |
| `PINECONE_INDEX_NAME=fQ3B8g\|hZ:2x0F>[B3.CZ` | 重置為 `ai-director-memories` | Pinecone 限定 `[a-z0-9-]` |
| `JWT_ACCESS_TOKEN_EXPIRES_IN=di36v2fgooyicr4yx80ec6po82jw1blj` | 還原為 `31536000` | TTL 必須是純數字（秒） |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON=68tivglhydtud3psfqfapybcg33eu2v2` | 視為未設定（清空） | 不是合法 JSON，避免 Vertex AI 啟動崩潰 |

---

## 🔴 必修（這幾項程式無法替您補）

### 1. Anthropic Claude — 帳戶儲值
- **變數**：`ANTHROPIC_API_KEY`
- **金鑰本身**：✅ 有效（`sk-ant-api03-…`）
- **問題**：帳戶**信用餘額為 0**，呼叫會回 `400 — credit balance is too low`
- **動作**：
  1. 至 https://console.anthropic.com/settings/billing 儲值（建議 $5 起跳）
  2. 順便把 Railway 的變數名 `NTHROPIC_API_KEY` → `ANTHROPIC_API_KEY`（雖然程式有 fallback）
- **影響範圍**：光球 AI 代理人主引擎（Claude tool-use 路徑）。沒處理會自動降級到 Gemini，但失去 Claude 較佳的 tool 規劃能力。

### 2. Pinecone — 真實金鑰
- **變數**：`PINECONE_API_KEY`
- **目前值**：`your-pinecone-api-key`（佔位符）
- **動作**：
  1. 至 https://app.pinecone.io 註冊並建立 free-tier project
  2. Project → API Keys → Create → 複製貼到 Railway
  3. 順便確認 `PINECONE_ENVIRONMENT`（預設 `us-east-1`，依您建立的 index region）
- **影響範圍**：RAG 記憶系統。您把 `ENABLE_RAG_MEMORY=true` 開了，沒處理會在第一次寫入記憶時 throw。
- **若不打算用 RAG**：把 `ENABLE_RAG_MEMORY` 改成 `false`，並把 `PINECONE_API_KEY` 整個刪掉。

### 3. 三個明顯佔位符（建議直接刪除或填入真值）
| 變數 | 您現在填的值 | 動作 |
|------|------------|------|
| `PERPLEXITY_API_KEY` | `your-perplexity-api-key` | 不用 → 刪掉；要用 → 至 https://www.perplexity.ai/settings/api 申請 |
| `OPENPOSE_API_KEY` | `your-openpose-api-key` | 程式碼裡幾乎沒人用，建議直接刪掉 |
| `VITE_POSTHOG_KEY` | `your-posthog-project-key` | 不用 → 刪掉；要用 → 至 https://us.posthog.com/settings/project → Project API Key |

---

## 🟡 建議補上（影響特定子系統，不補則該功能停擺，主流程不受影響）

### 4. LangSmith — 金鑰格式錯誤
- **變數**：`LANGSMITH_API_KEY`
- **目前值**：`id:69a15d7c-5305-425e-8eb0-8e7c8130a023`（看起來像專案 ID 不是 key）
- **正確格式**：`lsv2_pt_…` 或 `lsv2_sk_…`
- **動作**：至 https://smith.langchain.com/settings → API Keys → Create API Key → 複製貼上
- **影響範圍**：LLM trace 上不到 LangSmith 後台；不影響服務運作。
- **若不用 LangSmith**：把 `LANGSMITH_API_KEY`、`LANGCHAIN_TRACING_V2`、`LANGCHAIN_ENDPOINT`、`LANGSMITH_PROJECT` 一起刪掉。

### 5. Vertex AI（如果想要 Gemini 之外的 Google 多一層保險）
- **變數**：
  - `GOOGLE_CLOUD_PROJECT_ID`（您**完全沒設**）
  - `GOOGLE_APPLICATION_CREDENTIALS_JSON`（您填的不是 JSON，已被自動清空）
- **動作**：
  1. 進 https://console.cloud.google.com → 選或建專案 → 複製 Project ID
  2. IAM → Service Accounts → 建立 service account → 授予 `Vertex AI User` 角色 → Keys → Add Key (JSON) → 下載
  3. 把整個 JSON 內容貼到 Railway 的 `GOOGLE_APPLICATION_CREDENTIALS_JSON`（用引號包起來避免換行被吃掉）
  4. 把 Project ID 貼到 `GOOGLE_CLOUD_PROJECT_ID`
- **影響範圍**：當 Gemini AI Studio 流量爆掉時，brain config 會自動 fallback 到 Vertex AI。沒設則只能靠 AI Studio 本身的 quota。
- **若不用 Vertex AI**：刪掉 `GOOGLE_APPLICATION_CREDENTIALS`、`GOOGLE_APPLICATION_CREDENTIALS_JSON`、`GOOGLE_CLOUD_PROJECT_ID` 即可。

### 6. PostHog 後端事件追蹤
- **變數**：`POSTHOG_API_KEY`（您**完全沒設**，只有前端 `VITE_POSTHOG_KEY`）
- **動作**：同 PostHog 後台 → Personal API Keys → Create
- **影響範圍**：管理後台事件追蹤；前端事件靠 `VITE_POSTHOG_KEY` 已能運作。
- **若不用後端追蹤**：保持空白。

### 7. GitHub 自動 Issue 整合
- **變數**：`GITHUB_TOKEN`、`GITHUB_REPO`（兩者都**沒設**）
- **動作**：
  1. https://github.com/settings/personal-access-tokens/new → Fine-grained PAT
  2. Repository access → Only select repositories → 您的 healing-studio repo
  3. Permissions → Issues: Read & write、Pull requests: Read & write
  4. 把 token 貼到 `GITHUB_TOKEN`
  5. 把 `aa0968111723-prog/healing-studio` 貼到 `GITHUB_REPO`
- **影響範圍**：AI 自動修復系統把 critical 提案開成 GitHub Issue。沒設則提案只在記憶體裡，重啟就消失（除非 Pinecone 也接好）。
- **若不用**：保持空白。

---

## ⚪ 可略（既有變數但不影響主功能；除非您打算啟用對應子系統）

| 變數 | 用途 | 不設定的影響 |
|------|------|-----------|
| `DISCORD_WEBHOOK_URL` | API 健康巡檢警報送 Discord | 沒設則靜默跳過 |
| `REDIS_URL` | 分散式快取／光球 task 鎖 | 沒設則用記憶體版（單機部署足夠） |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | Manus Forge 舊整合 | 已遷移至 Google OAuth，可忽略 |
| `OAUTH_SERVER_URL` / `OWNER_OPEN_ID` | 同上 | 同上 |
| `GCS_BUCKET_NAME` | Google Cloud Storage | 您主用 R2 已通，GCS 不需要 |

---

## 🔍 順手檢查 — DATABASE_URL 模板

您填的是：
```
DATABASE_URL="${{MySQL.MYSQL_URL}}"
```
這是 **Railway 變數參考語法**。若 Railway 正確展開應該長得像：
```
mysql://user:pass@host.railway.app:3306/railway
```

**請至 Railway → 專案 → Variables → 點 `DATABASE_URL` 右側的眼睛圖示**確認展開後的值不是空字串、也不是字面 `${{MySQL.MYSQL_URL}}`。如果沒展開：
1. 確認專案中有 MySQL 服務（沒有就新增一個 MySQL plugin）
2. 模板拼字大小寫要完全一致（`MySQL.MYSQL_URL` 是預設名稱）

如果 DATABASE_URL 沒展開，整個 tRPC + 認證會在啟動時 throw。

---

## 📋 一鍵複製到 Railway 的補丁（依優先順序）

```bash
# ─── 優先級 P0（必做） ───────────────────────────────────────
ANTHROPIC_API_KEY=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
# 然後刪掉 NTHROPIC_API_KEY 並至 Anthropic console 儲值

PINECONE_API_KEY=<從 https://app.pinecone.io 取得>
PINECONE_ENVIRONMENT=us-east-1
# 不打算用 RAG → 改設 ENABLE_RAG_MEMORY=false 並把上面兩個刪掉

# 刪除以下三個（值是佔位符）：
PERPLEXITY_API_KEY=
OPENPOSE_API_KEY=
VITE_POSTHOG_KEY=

# ─── 優先級 P1（強烈建議） ──────────────────────────────────
LANGSMITH_API_KEY=lsv2_pt_<您的真實 LangSmith key>
# 不用 → 刪 LANGSMITH_API_KEY、LANGCHAIN_*

GITHUB_TOKEN=<github_pat_…>
GITHUB_REPO=aa0968111723-prog/healing-studio

# ─── 優先級 P2（看需求） ─────────────────────────────────────
GOOGLE_CLOUD_PROJECT_ID=<your-gcp-project-id>
GOOGLE_APPLICATION_CREDENTIALS_JSON=<貼整個 service-account JSON>
POSTHOG_API_KEY=<您的後端 PostHog key>

# ─── 自動修復後可清理（程式不再需要，但留著也不會崩） ────────
NTHROPIC_API_KEY=        # 已 fallback 到 ANTHROPIC_API_KEY
NVIDA_API=               # 已 fallback 到 NVIDIA_API
JWT_ACCESS_TOKEN_EXPIRES_IN=31536000  # 自動修復為這個值
GOOGLE_APPLICATION_CREDENTIALS=        # 看起來像亂碼，未被任何路徑使用
```

---

## 🟢 上線最小可用組合（如果您想 ship 最快路徑）

只需確保以下五項是真實值：

1. `DATABASE_URL` — Railway 模板已展開
2. `JWT_SECRET` — 您已設好 ✅
3. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — 您已設好 ✅
4. `GEMINI_API_KEY` — ✅ 已通過實測
5. `FAL_API_KEY` + `ELEVENLABS_API_KEY` — ✅ 已通過實測

加上：
- `ENABLE_RAG_MEMORY=false`（暫關 Pinecone 依賴）
- `ENABLE_ORB_WEB_RESEARCH=true`（用 Brave 已通的金鑰）

這樣大腦組態 5 推理 + 4 生成槽全部可運作；其他高階功能可日後再啟用。

---

## 📌 請補完後通知我

完成上述變更後告訴我「Railway 已更新」或「我已處理 P0」，我可以：
- 重跑一次 API 管線實測，確認新金鑰生效
- 接著進行階段 2（Provider Inventory 服務）與階段 3（tRPC 暴露給大腦組態頁）
