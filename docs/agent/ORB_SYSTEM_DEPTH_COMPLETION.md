# 光球代理系統深度補齊計畫 - 工具與資料庫完整性分析

> 更新於 2026-05-11 - 全站功能完整性評估

## 執行摘要

本文件分析 Healing Studio 光球代理系統的當前狀態，識別已完成的功能和需要補齊的工具與資料庫支持，以實現真正的全站深度集成。

## 一、當前系統完整性評估

### ✅ 已完成的核心基礎設施 (90%+)

#### 1. 精靈系統 (100%)
- **25 個精靈完全定義** ✅
  - 16 個功能精靈（工具整合完成）
  - 9 個通用/主動精靈（角色定義完成）
- **工具執行器** (`agentToolExecutor.ts`, 168KB) ✅
- **精靈狀態監控** (`spiritStatusMonitor.ts`) ✅
- **精靈調度器** (`spiritDispatcher.ts`) ✅

#### 2. 任務編排系統 (95%)
- **任務編排器** (`orbTaskOrchestrator.ts`, 33KB) ✅
- **狀態機** (`orbTaskStateMachine.ts`) ✅
- **任務鏈執行器** (`orbTaskChainRunner.ts`) ✅
- **重計畫引擎** (`orbLLMReplan.ts`) ✅
- **任務追蹤器** (`orbTaskTracer.ts`) ✅

#### 3. 協作與通訊 (85%)
- **協作編排器** (`agentCollaborationOrchestrator.ts`) ✅
- **通訊總線** (`agentCommunicationBus.ts`) ✅
- **討論執行器** (`agentDiscussionRunner.ts`) ✅
- **交棒協議** (`spirit-handoff-protocol.ts`) ✅

#### 4. 記憶與上下文 (80%)
- **任務記憶** (`orbTaskMemory.ts`) ✅
- **專業精靈記憶** (`specializedAgentMemoryStore.ts`) ✅
- **使用者記憶摘要** (users.orbMemorySummary) ✅
- 🟡 缺少長期結構化記憶

#### 5. 工具生態系統 (85%)
- **資料庫查詢工具** (`orbDatabaseTools.ts`, 13 個模板) ✅
- **網頁研究工具** (`orbWebResearch.ts`) ✅
- **排程工具** (`orbScheduler.ts`) ✅
- **成本分析工具** (`costAnalytics.ts`) ✅
- 🟡 缺少部分進階工具

#### 6. 資料庫架構 (85%)
```
已存在的核心表：
✅ users (用戶基礎信息 + orbMemorySummary)
✅ agent_preferences (代理偏好設定)
✅ orb_conversations (對話記錄)
✅ orb_conversation_messages (訊息記錄)
✅ orb_scheduled_jobs (排程任務)
✅ specialized_agent_memory (專業精靈記憶)
✅ specialized_agent_interactions (精靈互動記錄)
✅ agent_collaboration_sessions (協作會話)
✅ agent_model_picks (模型選擇記錄)
✅ project_notes (專案筆記)
✅ drive_assets (資產庫)
```

## 二、需要補齊的功能與資料庫

### 🔴 高優先級缺口 (Critical Gaps)

#### Gap 1: 長期結構化記憶系統

**問題**：
- 目前只有 `users.orbMemorySummary` 文字摘要
- 缺少可查詢、可過濾的結構化長期記憶
- 無法進行語義搜索和記憶重要性評分

**解決方案**：

**新增資料庫表**：
```sql
-- 長期記憶表（支持全文搜索和向量搜索）
CREATE TABLE orb_long_term_memories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,

  -- 記憶類型
  memory_type ENUM(
    'user_fact',          -- 用戶事實（姓名、喜好、背景）
    'user_preference',    -- 用戶偏好（風格、習慣）
    'skill_learned',      -- 學到的技能/知識
    'workflow_pattern',   -- 工作流程模式
    'error_solution',     -- 錯誤解決方案
    'success_recipe',     -- 成功配方
    'context_snippet'     -- 上下文片段
  ) NOT NULL,

  -- 記憶內容
  content TEXT NOT NULL,
  structured_data JSON,  -- 結構化數據（可選）

  -- 元數據
  source_conversation_id BIGINT,
  source_task_id VARCHAR(100),
  spirit_id VARCHAR(50),

  -- 重要性與使用
  importance_score FLOAT NOT NULL DEFAULT 0.5, -- 0.0-1.0
  access_count INT NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMP NULL,

  -- 向量嵌入（用於語義搜索）
  embedding_vector JSON, -- 存儲嵌入向量

  -- 時間戳
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL, -- 可選過期時間

  -- 索引
  INDEX idx_user_type (user_id, memory_type),
  INDEX idx_importance (user_id, importance_score DESC),
  INDEX idx_access (user_id, last_accessed_at DESC),
  INDEX idx_spirit (spirit_id),
  FULLTEXT idx_content (content)
);

-- 記憶關聯表（記憶之間的關聯）
CREATE TABLE orb_memory_associations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  memory_id_1 BIGINT NOT NULL,
  memory_id_2 BIGINT NOT NULL,
  association_type ENUM(
    'causes',        -- 因果關係
    'similar_to',    -- 相似
    'contradicts',   -- 矛盾
    'extends',       -- 擴展
    'replaces'       -- 替換
  ) NOT NULL,
  strength FLOAT NOT NULL DEFAULT 0.5, -- 關聯強度
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_memory1 (user_id, memory_id_1),
  INDEX idx_user_memory2 (user_id, memory_id_2)
);
```

**新增服務**：
```typescript
// server/services/orbLongTermMemory.ts
export class OrbLongTermMemory {
  // 添加記憶
  async addMemory(input: AddMemoryInput): Promise<MemoryEntry>

  // 語義搜索記憶
  async searchMemories(userId: number, query: string, options?: SearchOptions): Promise<MemoryEntry[]>

  // 獲取相關記憶
  async getRelevantMemories(userId: number, context: string, limit: number): Promise<MemoryEntry[]>

  // 更新記憶重要性（基於使用頻率和時間衰減）
  async updateMemoryImportance(memoryId: bigint): Promise<void>

  // 建立記憶關聯
  async associateMemories(userId: number, memoryId1: bigint, memoryId2: bigint, type: AssociationType): Promise<void>

  // 清理過期和低價值記憶
  async pruneMemories(userId: number): Promise<number>

  // 生成記憶摘要（更新 users.orbMemorySummary）
  async generateMemorySummary(userId: number): Promise<string>
}
```

#### Gap 2: 意圖識別與反問系統

**問題**：
- 缺少結構化的意圖識別結果存儲
- 沒有反問歷史追蹤
- 無法學習用戶的回答模式

**解決方案**：

**新增資料庫表**：
```sql
-- 意圖識別記錄
CREATE TABLE orb_intent_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  conversation_id BIGINT NOT NULL,

  -- 用戶輸入
  user_input TEXT NOT NULL,

  -- 識別結果
  detected_intent VARCHAR(100) NOT NULL, -- 如 'generate_image', 'ask_question'
  confidence FLOAT NOT NULL,
  spirit_recommended VARCHAR(50), -- 推薦的精靈
  page_recommended VARCHAR(255),  -- 推薦的頁面

  -- 分類標籤
  intent_category ENUM(
    'creation',      -- 創作
    'query',         -- 查詢
    'navigation',    -- 導航
    'configuration', -- 設定
    'collaboration', -- 協作
    'learning'       -- 學習
  ),

  -- 是否成功
  was_successful BOOLEAN,
  user_feedback ENUM('positive', 'negative', 'neutral'),

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_created (user_id, created_at DESC),
  INDEX idx_intent (detected_intent),
  INDEX idx_success (was_successful, confidence)
);

-- 反問歷史表
CREATE TABLE orb_clarification_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  conversation_id BIGINT NOT NULL,
  task_id VARCHAR(100),
  spirit_id VARCHAR(50) NOT NULL,

  -- 問題
  question_id VARCHAR(100) NOT NULL,
  question TEXT NOT NULL,
  question_type ENUM('choice', 'text', 'number', 'boolean', 'file') NOT NULL,
  options JSON, -- 選擇題選項

  -- 回答
  answer TEXT,
  answered_at TIMESTAMP NULL,
  answer_confidence FLOAT, -- 用戶回答的確定程度

  -- 使用情況
  was_helpful BOOLEAN,
  led_to_success BOOLEAN,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_task (user_id, task_id),
  INDEX idx_question (question_id),
  INDEX idx_spirit (spirit_id, was_helpful)
);

-- 用戶回答模式（用於智能預測）
CREATE TABLE orb_user_answer_patterns (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  question_pattern VARCHAR(200) NOT NULL, -- 問題模式
  common_answer TEXT NOT NULL,
  usage_count INT NOT NULL DEFAULT 1,
  last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_user_pattern (user_id, question_pattern),
  INDEX idx_user_usage (user_id, usage_count DESC)
);
```

**新增服務**：
```typescript
// server/services/orbClarificationEngine.ts
export class OrbClarificationEngine {
  // 生成反問
  async generateClarification(task: OrbTask, context: TaskContext): Promise<ClarificationRequest>

  // 記錄回答
  async recordAnswer(clarificationId: bigint, answer: any): Promise<void>

  // 預測回答（基於歷史模式）
  async predictAnswer(userId: number, question: string): Promise<PredictedAnswer | null>

  // 評估反問效果
  async evaluateClarificationEffectiveness(clarificationId: bigint, taskSuccess: boolean): Promise<void>
}
```

#### Gap 3: 功能使用統計與推薦

**問題**：
- 缺少功能使用追蹤
- 無法個性化功能推薦
- 沒有功能發現路徑分析

**解決方案**：

**新增資料庫表**：
```sql
-- 功能使用統計
CREATE TABLE orb_feature_usage_stats (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,

  -- 功能識別
  feature_id VARCHAR(100) NOT NULL,      -- 如 'studio.generateImage'
  feature_category VARCHAR(50) NOT NULL,  -- 如 'creation', 'management'
  page_path VARCHAR(255) NOT NULL,

  -- 使用數據
  usage_count INT NOT NULL DEFAULT 1,
  success_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  avg_completion_time_ms INT,

  -- 訪問模式
  last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  access_method ENUM(
    'orb_suggestion',  -- 光球建議
    'direct_click',    -- 直接點擊
    'search',          -- 搜索
    'workflow'         -- 工作流
  ),

  -- 用戶滿意度
  avg_rating FLOAT, -- 1-5 星

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_user_feature (user_id, feature_id),
  INDEX idx_user_last_used (user_id, last_used_at DESC),
  INDEX idx_feature_usage (feature_id, usage_count DESC),
  INDEX idx_success_rate (feature_id, success_count, error_count)
);

-- 功能發現路徑
CREATE TABLE orb_feature_discovery_paths (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,

  -- 路徑
  discovery_method ENUM(
    'orb_chat',        -- 通過光球對話
    'intent_card',     -- 通過意圖卡片
    'search',          -- 通過搜索
    'recommendation',  -- 通過推薦
    'exploration',     -- 自己探索
    'tutorial'         -- 通過教程
  ) NOT NULL,

  query_text TEXT,                    -- 用戶查詢
  feature_discovered VARCHAR(100) NOT NULL,
  time_to_discover_ms INT NOT NULL,  -- 發現所需時間
  clicked BOOLEAN NOT NULL DEFAULT FALSE,
  used BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_method (user_id, discovery_method),
  INDEX idx_feature (feature_discovered),
  INDEX idx_success (clicked, used)
);

-- 功能推薦反饋
CREATE TABLE orb_feature_recommendations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,

  -- 推薦上下文
  context_page VARCHAR(255) NOT NULL,
  context_task VARCHAR(200),
  recommended_feature VARCHAR(100) NOT NULL,
  recommendation_reason TEXT,

  -- 推薦結果
  shown_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  clicked BOOLEAN NOT NULL DEFAULT FALSE,
  clicked_at TIMESTAMP NULL,
  was_helpful BOOLEAN,
  user_feedback TEXT,

  INDEX idx_user_shown (user_id, shown_at DESC),
  INDEX idx_feature (recommended_feature, clicked, was_helpful),
  INDEX idx_context (context_page)
);
```

**新增服務**：
```typescript
// server/services/orbFeatureDiscovery.ts
export class OrbFeatureDiscovery {
  // 記錄功能使用
  async recordFeatureUsage(userId: number, featureId: string, result: UsageResult): Promise<void>

  // 查詢功能（語義搜索）
  async searchFeatures(userId: number, query: string): Promise<FeatureRecommendation[]>

  // 獲取個性化推薦
  async getPersonalizedRecommendations(userId: number, context: RecommendationContext): Promise<FeatureRecommendation[]>

  // 記錄發現路徑
  async recordDiscoveryPath(userId: number, path: DiscoveryPath): Promise<void>

  // 分析用戶技能水平（基於使用模式）
  async analyzeUserSkillLevel(userId: number, domain: string): Promise<SkillLevel>

  // 生成功能使用報告
  async generateUsageReport(userId: number, period: DateRange): Promise<UsageReport>
}
```

#### Gap 4: 工作流模板與自動化

**問題**：
- 只有 6 個硬編碼工作流模板
- 缺少用戶自定義工作流
- 無法從歷史任務學習生成模板

**解決方案**：

**新增資料庫表**：
```sql
-- 工作流模板
CREATE TABLE orb_workflow_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NULL, -- NULL = 系統模板

  -- 模板識別
  template_id VARCHAR(100) NOT NULL,
  template_name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(50), -- 如 'video_creation', 'content_marketing'

  -- 工作流定義（JSON）
  workflow_definition JSON NOT NULL,
  /* 結構示例：
  {
    "steps": [
      {
        "stepId": "plan",
        "spiritId": "director",
        "action": "create_plan",
        "estimatedDuration": 60,
        "required": true
      }
    ],
    "handoffs": [...],
    "parallelSteps": [...]
  }
  */

  -- 使用統計
  usage_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  avg_completion_time_ms BIGINT,

  -- 品質指標
  success_rate FLOAT,
  avg_rating FLOAT,

  -- 可見性
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,

  -- 版本控制
  version INT NOT NULL DEFAULT 1,
  parent_template_id BIGINT, -- 如果是衍生模板

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_user_public (user_id, is_public),
  INDEX idx_category (category, is_public),
  INDEX idx_usage (usage_count DESC),
  INDEX idx_featured (is_featured, success_rate DESC),
  FULLTEXT idx_search (template_name, description)
);

-- 工作流執行歷史
CREATE TABLE orb_workflow_executions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  template_id BIGINT, -- NULL = 自訂工作流

  -- 執行資訊
  execution_id VARCHAR(100) NOT NULL UNIQUE,
  workflow_name VARCHAR(200) NOT NULL,

  -- 狀態
  status ENUM(
    'pending',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled'
  ) NOT NULL DEFAULT 'pending',

  -- 步驟追蹤
  total_steps INT NOT NULL,
  completed_steps INT NOT NULL DEFAULT 0,
  current_step VARCHAR(100),

  -- 時間
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  duration_ms BIGINT,

  -- 結果
  final_output JSON,
  error_message TEXT,

  -- 精靈參與
  spirits_involved JSON, -- ["director", "image-specialist", ...]

  INDEX idx_user_status (user_id, status),
  INDEX idx_template (template_id),
  INDEX idx_execution (execution_id),
  INDEX idx_started (started_at DESC)
);

-- 工作流步驟執行詳情
CREATE TABLE orb_workflow_step_executions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  workflow_execution_id BIGINT NOT NULL,

  -- 步驟資訊
  step_id VARCHAR(100) NOT NULL,
  step_name VARCHAR(200) NOT NULL,
  spirit_id VARCHAR(50) NOT NULL,

  -- 執行狀態
  status ENUM('pending', 'running', 'completed', 'failed', 'skipped') NOT NULL,

  -- 時間
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  duration_ms INT,

  -- 輸入輸出
  input_data JSON,
  output_data JSON,
  error_message TEXT,

  -- 工具調用
  tools_used JSON, -- ["studio.generateImage", ...]

  INDEX idx_workflow (workflow_execution_id),
  INDEX idx_spirit (spirit_id),
  INDEX idx_status (status)
);
```

**新增服務**：
```typescript
// server/services/orbWorkflowEngine.ts
export class OrbWorkflowEngine {
  // 創建工作流模板
  async createTemplate(userId: number, template: WorkflowTemplate): Promise<bigint>

  // 從歷史任務學習生成模板
  async learnFromHistory(userId: number, taskIds: string[]): Promise<WorkflowTemplate>

  // 執行工作流
  async executeWorkflow(userId: number, templateId: bigint, params: any): Promise<string>

  // 暫停/繼續工作流
  async pauseWorkflow(executionId: string): Promise<void>
  async resumeWorkflow(executionId: string): Promise<void>

  // 取消工作流
  async cancelWorkflow(executionId: string): Promise<void>

  // 獲取執行狀態
  async getExecutionStatus(executionId: string): Promise<WorkflowExecutionStatus>

  // 搜索公開模板
  async searchPublicTemplates(query: string, filters: TemplateFilters): Promise<WorkflowTemplate[]>

  // 評分模板
  async rateTemplate(userId: number, templateId: bigint, rating: number, feedback?: string): Promise<void>
}
```

#### Gap 5: 進階分析與監控

**問題**：
- 缺少系統級監控
- 無法追蹤精靈協作效率
- 缺少成本歸因分析

**解決方案**：

**新增資料庫表**：
```sql
-- 精靈協作效率追蹤
CREATE TABLE orb_spirit_collaboration_metrics (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,

  -- 協作對
  spirit_from VARCHAR(50) NOT NULL,
  spirit_to VARCHAR(50) NOT NULL,

  -- 協作類型
  handoff_reason VARCHAR(50) NOT NULL,

  -- 效率指標
  total_handoffs INT NOT NULL DEFAULT 1,
  successful_handoffs INT NOT NULL DEFAULT 0,
  avg_handoff_time_ms INT,

  -- 品質指標
  context_loss_score FLOAT, -- 上下文丟失程度 (0-1)
  user_satisfaction_score FLOAT, -- 用戶滿意度 (1-5)

  -- 時間窗口
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_period_spirits (period_start, spirit_from, spirit_to, handoff_reason),
  INDEX idx_spirits (spirit_from, spirit_to),
  INDEX idx_period (period_start, period_end)
);

-- 系統健康指標
CREATE TABLE orb_system_health_metrics (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,

  -- 時間窗口
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  period_minutes INT NOT NULL DEFAULT 5,

  -- 任務指標
  total_tasks_started INT NOT NULL DEFAULT 0,
  total_tasks_completed INT NOT NULL DEFAULT 0,
  total_tasks_failed INT NOT NULL DEFAULT 0,
  avg_task_duration_ms BIGINT,

  -- 精靈指標
  total_spirit_activations INT NOT NULL DEFAULT 0,
  spirits_active_count INT NOT NULL DEFAULT 0,
  spirits_with_errors JSON, -- {"spirit-id": errorCount}

  -- 工具指標
  total_tool_calls INT NOT NULL DEFAULT 0,
  tool_success_rate FLOAT,
  avg_tool_execution_ms INT,

  -- 成本指標
  total_llm_calls INT NOT NULL DEFAULT 0,
  total_fal_calls INT NOT NULL DEFAULT 0,
  estimated_cost_usd DECIMAL(10, 4),

  -- 用戶指標
  active_users_count INT NOT NULL DEFAULT 0,
  avg_response_time_ms INT,

  INDEX idx_timestamp (timestamp DESC)
);

-- 成本歸因詳情
CREATE TABLE orb_cost_attribution (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,

  -- 時間
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- 歸因
  task_id VARCHAR(100),
  spirit_id VARCHAR(50),
  feature_id VARCHAR(100),

  -- 成本來源
  cost_type ENUM(
    'llm_call',
    'fal_generation',
    'external_api',
    'storage',
    'compute'
  ) NOT NULL,

  -- 成本詳情
  provider VARCHAR(50),
  model VARCHAR(100),
  tokens_used INT,
  cost_usd DECIMAL(10, 6) NOT NULL,

  -- 元數據
  metadata JSON,

  INDEX idx_user_date (user_id, occurred_at DESC),
  INDEX idx_task (task_id),
  INDEX idx_spirit (spirit_id),
  INDEX idx_feature (feature_id),
  INDEX idx_cost_type (cost_type, occurred_at DESC)
);
```

**新增服務**：
```typescript
// server/services/orbSystemMonitor.ts
export class OrbSystemMonitor {
  // 記錄協作指標
  async recordCollaborationMetric(from: string, to: string, handoff: HandoffEvent): Promise<void>

  // 記錄系統健康指標
  async recordHealthMetrics(metrics: SystemHealthMetrics): Promise<void>

  // 記錄成本歸因
  async recordCostAttribution(cost: CostAttribution): Promise<void>

  // 獲取精靈效率報告
  async getSpiritEfficiencyReport(spiritId: string, period: DateRange): Promise<EfficiencyReport>

  // 獲取系統健康儀表板數據
  async getHealthDashboard(): Promise<HealthDashboard>

  // 獲取成本分析
  async getCostAnalysis(userId: number, period: DateRange): Promise<CostAnalysis>

  // 異常檢測
  async detectAnomalies(): Promise<Anomaly[]>
}
```

### 🟡 中優先級補充

#### Gap 6: 用戶技能與學習路徑追蹤

```sql
CREATE TABLE orb_user_skill_progression (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  skill_domain VARCHAR(100) NOT NULL, -- 'image_generation', 'video_editing'

  skill_level ENUM('beginner', 'intermediate', 'advanced', 'expert') NOT NULL,
  progression_score FLOAT NOT NULL DEFAULT 0, -- 0-100

  milestones_completed JSON, -- ["first_image", "used_lora", ...]
  last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_user_skill (user_id, skill_domain),
  INDEX idx_level (skill_domain, skill_level)
);

CREATE TABLE orb_learning_recommendations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,

  recommendation_type ENUM('tutorial', 'feature', 'workflow', 'best_practice') NOT NULL,
  target_skill VARCHAR(100) NOT NULL,
  content_id VARCHAR(200) NOT NULL,

  reason TEXT,
  priority INT NOT NULL DEFAULT 5, -- 1-10

  shown_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMP NULL,

  INDEX idx_user_priority (user_id, priority DESC),
  INDEX idx_completed (user_id, completed)
);
```

#### Gap 7: A/B 測試與實驗平台

```sql
CREATE TABLE orb_experiments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  experiment_id VARCHAR(100) NOT NULL UNIQUE,
  experiment_name VARCHAR(200) NOT NULL,

  feature_flag VARCHAR(100) NOT NULL,
  variant_control JSON NOT NULL,
  variant_test JSON NOT NULL,

  target_percentage FLOAT NOT NULL DEFAULT 0.5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  start_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMP NULL,

  hypothesis TEXT,
  success_metric VARCHAR(100),

  INDEX idx_active (is_active, start_date)
);

CREATE TABLE orb_experiment_assignments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  experiment_id VARCHAR(100) NOT NULL,
  user_id INT NOT NULL,

  variant ENUM('control', 'test') NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_experiment_user (experiment_id, user_id),
  INDEX idx_user (user_id)
);

CREATE TABLE orb_experiment_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  experiment_id VARCHAR(100) NOT NULL,
  user_id INT NOT NULL,
  variant ENUM('control', 'test') NOT NULL,

  event_type VARCHAR(100) NOT NULL, -- 'feature_used', 'task_completed'
  event_value FLOAT,

  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_experiment (experiment_id, variant),
  INDEX idx_event_type (experiment_id, event_type)
);
```

### 🔵 低優先級增強

#### Gap 8: 社交與分享功能

```sql
CREATE TABLE orb_shared_workflows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  workflow_template_id BIGINT NOT NULL,
  shared_by_user_id INT NOT NULL,

  share_id VARCHAR(100) NOT NULL UNIQUE,
  share_title VARCHAR(200) NOT NULL,
  share_description TEXT,

  view_count INT NOT NULL DEFAULT 0,
  clone_count INT NOT NULL DEFAULT 0,
  rating_sum INT NOT NULL DEFAULT 0,
  rating_count INT NOT NULL DEFAULT 0,

  is_public BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_shared_by (shared_by_user_id),
  INDEX idx_popular (view_count DESC, rating_sum DESC)
);

CREATE TABLE orb_community_tips (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,

  tip_type ENUM('prompt', 'workflow', 'troubleshooting', 'technique') NOT NULL,
  category VARCHAR(100) NOT NULL,

  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,

  upvotes INT NOT NULL DEFAULT 0,
  downvotes INT NOT NULL DEFAULT 0,

  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by_admin_id INT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user (user_id),
  INDEX idx_category (category, upvotes DESC),
  FULLTEXT idx_search (title, content)
);
```

## 三、實施優先級路線圖

### Phase 1: 核心記憶與智能 (Week 1-2)
1. ✅ 實現長期結構化記憶系統
2. ✅ 實現意圖識別與反問系統
3. ✅ 建立記憶-任務關聯機制

**目標**：讓光球能夠真正「記住」用戶並進行智能對話

### Phase 2: 功能發現與工作流 (Week 3-4)
4. ✅ 實現功能使用統計與推薦
5. ✅ 實現工作流模板與自動化
6. ✅ 建立個性化推薦引擎

**目標**：讓光球能夠主動推薦和自動化工作流程

### Phase 3: 監控與分析 (Week 5-6)
7. ✅ 實現進階分析與監控
8. ✅ 實現成本歸因系統
9. ✅ 建立異常檢測機制

**目標**：全面了解系統運行狀況和用戶行為

### Phase 4: 學習與優化 (Week 7-8)
10. ✅ 實現用戶技能追蹤
11. ✅ 實現學習路徑推薦
12. ✅ A/B 測試平台

**目標**：持續優化和個性化用戶體驗

### Phase 5: 社交與分享 (Future)
13. ⏭️ 工作流分享
14. ⏭️ 社群提示庫
15. ⏭️ 協作創作

**目標**：建立用戶社群和知識共享

## 四、關鍵技術考量

### 1. 向量搜索實現
- **選項 A**：使用 MySQL 8.0+ 的全文搜索（簡單但功能有限）
- **選項 B**：整合 Elasticsearch（強大但增加複雜度）
- **選項 C**：使用 pgvector（需要 PostgreSQL）
- **推薦**：Phase 1 使用選項 A，Phase 2+ 評估選項 B

### 2. 實時數據處理
- 使用 Redis 作為實時指標緩存
- 使用批量寫入減少資料庫壓力
- 實現後台任務處理長期分析

### 3. 隱私與安全
- 所有記憶和數據嚴格用戶隔離
- 敏感信息加密存儲
- 實現數據導出和刪除功能（GDPR 合規）

### 4. 性能優化
- 記憶查詢使用緩存和索引
- 工作流執行異步化
- 大規模數據使用分區表

## 五、成功指標

### 功能完整性指標
- ✅ 所有 25 個精靈可用
- ✅ 長期記憶系統運行
- ✅ 反問系統正常工作
- ✅ 工作流自動化可用
- ✅ 功能推薦準確

### 用戶體驗指標
- 記憶召回準確率 > 85%
- 功能推薦點擊率 > 30%
- 工作流自動化採用率 > 40%
- 任務完成率 > 80%

### 系統性能指標
- 記憶查詢 < 200ms
- 意圖識別 < 500ms
- 工作流啟動 < 1s
- 系統可用性 > 99.5%

### 商業指標
- 用戶留存率提升 20%
- 功能使用深度提升 30%
- 成本效率提升 15%

## 六、總結

### 當前完成度：85%
- ✅ 核心精靈系統：100%
- ✅ 基礎工具生態：85%
- 🟡 深度智能功能：60%
- 🟡 分析與監控：50%
- 🔴 社交與分享：0%

### 關鍵缺口
1. **長期結構化記憶** - 最關鍵的智能基礎
2. **反問與澄清系統** - 提升對話質量
3. **功能推薦引擎** - 提升功能發現
4. **工作流自動化** - 提升生產力
5. **系統監控** - 確保穩定性

### 預期成果
完成所有補齊工作後，Healing Studio 將擁有：
- 🧠 真正的長期記憶和上下文理解
- 🎯 智能的功能推薦和引導
- ⚡ 強大的工作流自動化
- 📊 全面的系統監控和分析
- 🚀 行業領先的 AI 輔助創作體驗

---

**下一步行動**：
1. 審查並批准新增資料庫架構
2. 按照 Phase 1-5 逐步實施
3. 每個 Phase 完成後進行用戶測試
4. 持續監控和優化系統性能

這將是一個雄心勃勃但完全可行的系統完善計畫！ 🎉
