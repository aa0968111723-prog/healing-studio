# 深度修復清單

## 嚴重問題（Critical）

### 1. DashboardPage 無效路徑 — 導致導航靜默失敗
- 檔案：`client/src/pages/DashboardPage.tsx`
- `/image` → 應為 `/image-studio`
- `/video` → 應為 `/video-studio`
- `/director-ai` → 應為 `/director`
- 影響：NAV_ALLOWLIST 和 capabilities options 都需修正

## 中等問題（Medium）

### 2. 多個頁面缺少 state 暴露
- `admin` — 缺少 state（應暴露 activeTab）
- `admin-api-usage` — 缺少 state（應暴露 activeTab）
- `admin-brain-pipeline` — 缺少 state（純展示頁，可暴露 nodeCount）
- `agent-chat` — 缺少 state（應暴露 messageCount）
- `my-brain` — 缺少 state（應暴露 statusFilter, autoRefresh）
- `vault` — 缺少 state（應暴露 activeTab）

### 3. NAV_ALLOWLIST 過窄 — 限制光球跨頁工作流
- `brain-settings`: 缺少 `/my-brain`, `/admin/brain-pipeline`
- `calendar`: 缺少 `/studio`, `/image-studio`
- `credits`: 缺少 `/settings`, `/studio`
- `focus-flow`: 缺少 `/studio`, `/settings`
- `settings`: 缺少 `/studio`, `/image-studio`
- `shared`: 缺少 `/settings`, `/notes`

### 4. AdminPage setTab options 與實際 ADMIN_TAB_IDS 不一致
- capabilities 中 setTab options: overview, users, feedback, system, brain
- 實際 ADMIN_TAB_IDS: overview, users, activity, api, costs, generations, jobs, feedback, brain, ai-research
- 缺少: activity, api, costs, generations, jobs, ai-research
- 多了: system（不在 ADMIN_TAB_IDS 中）

## 低優先級（Low）

### 5. agent-chat 缺少 default handler 的明確錯誤訊息
- 已有 fallback return，但不是 switch default 格式（審計腳本誤報）
- 實際已正確處理，不需修復
