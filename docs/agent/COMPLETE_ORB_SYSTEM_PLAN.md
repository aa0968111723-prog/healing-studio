# 完整光球代理25精靈系統 - 實施計畫

> 更新於 2026-05-11 - 完整系統整合規劃

## 系統概覽

本計畫旨在完成全站光球代理系統，整合25個精靈，實現深度用戶協助功能，包括：
1. 多步驟代理執行
2. 智能計畫與重計畫
3. 跨頁跳轉與功能查詢
4. 意圖卡片交互系統
5. 智能反問與澄清系統

## 一、現有基礎設施 (Already Implemented)

### ✅ 已完成模組

#### 1. 精靈系統 (25 Spirits)
- **16 個功能精靈** - 完全整合 ✅
  - 創作生成類：圖圖、影影、聲聲、學學、音音、練練
  - 支援管理類：法法、守守、社社、引引、執執、靈靈、解解
  - 核心系統類：總總、記記、細細

- **9 個通用/主動精靈** - 已存在 ✅
  - 通用角色：導導、編編、品品、查查、路路、暖暖
  - 主動監控：財財、巧巧、守守(inspector)

#### 2. 核心服務 ✅
```
server/services/
├── agentToolExecutor.ts (168KB, 工具執行核心)
├── agentPlanner.ts (52KB, 計畫生成)
├── agentCollaborationOrchestrator.ts (26KB, 多精靈協作)
├── orbTaskOrchestrator.ts (33KB, 任務編排)
├── orbTaskStateMachine.ts (24KB, 狀態機)
├── orbTaskChainRunner.ts (22KB, 鏈式執行)
├── orbLLMReplan.ts (11KB, 重計畫)
├── orbWebResearch.ts (17KB, 網頁研究)
├── orbDatabaseTools.ts (23KB, 資料庫查詢)
├── spiritStatusMonitor.ts (12KB, 精靈狀態監控)
├── spiritDispatcher.ts (5KB, 精靈調度)
└── spiritTools/ (16 個工具模組)
```

#### 3. 前端組件 ✅
```
client/src/components/
├── ProactiveOrbWidget.tsx (175KB, 全站浮窗)
├── OrbGuidePanel.tsx (192KB, 引導面板)
├── IntentCardOptions.tsx (意圖卡片)
├── ChatMessageText.tsx (含意圖卡片解析)
├── orb-agent/ (Orb Agent 專用組件)
│   ├── OrbAgentPresetCards.tsx
│   ├── OrbAgentActivityFeed.tsx
│   └── OrbOnboardingDialog.tsx
└── orb/ (Orb 輔助組件)
    ├── OrbCapabilitiesView.tsx
    ├── OrbActionFlow.tsx
    ├── OrbWorkflowDAG.tsx
    ├── OrbThinkingStepsPanel.tsx
    ├── OrbSearchResultsCard.tsx
    └── OrbMemoryDashboard.tsx
```

#### 4. 共享邏輯 ✅
```
shared/
├── orb-agent-roles.ts (精靈角色定義)
├── agent-skills.ts (技能註冊)
├── orb-specialized-agents.ts (專業精靈能力)
├── spirit-handoff-protocol.ts (交棒協定)
├── cross-modality-workflows.ts (跨模態工作流)
└── orb-search-intent.ts (搜索意圖)
```

## 二、需要完成的功能 (To Be Completed)

### 🟡 高優先級 (Critical Path)

#### 1. 意圖卡片系統深度整合 [70% → 100%]

**現狀**：
- ✅ 基礎解析器 (`intentOptions.ts`)
- ✅ 基礎渲染器 (`IntentCardOptions.tsx`)
- ✅ 在 ProactiveOrbWidget 和 DirectorAI 中使用
- 🟡 但未在所有頁面全站整合

**需要完成**：
- [ ] 在所有 Orb 對話界面統一整合意圖卡片
- [ ] 添加意圖卡片的進階互動（拖放、組合、收藏）
- [ ] 意圖卡片歷史記錄和快速重用
- [ ] 意圖卡片的多語言支持

**檔案**：
- `client/src/components/IntentCardOptions.tsx` (擴充)
- `client/src/hooks/useIntentCardHistory.ts` (新建)
- `client/src/contexts/IntentCardContext.tsx` (新建)

#### 2. 智能反問與澄清系統 [0% → 100%]

**功能設計**：
```typescript
// 當精靈需要更多信息時，生成結構化反問
interface ClarificationRequest {
  spiritId: string;
  taskId: string;
  questions: Array<{
    questionId: string;
    question: string;
    type: "choice" | "text" | "number" | "boolean";
    options?: string[]; // for choice type
    default?: any;
    required: boolean;
    hint?: string;
  }>;
  context: string; // 為什麼需要這些信息
  urgency: "blocking" | "optional" | "background";
}
```

**需要實現**：
- [ ] 反問生成邏輯 (`server/services/orbClarificationEngine.ts`)
- [ ] 反問 UI 組件 (`client/src/components/orb/OrbClarificationDialog.tsx`)
- [ ] 反問回答處理和任務續接
- [ ] 反問歷史和智能推薦（基於過往回答）

#### 3. 多步驟代理執行增強 [80% → 100%]

**現狀**：
- ✅ 基礎任務鏈執行 (`orbTaskChainRunner.ts`)
- ✅ 狀態機管理 (`orbTaskStateMachine.ts`)
- ✅ 重計畫機制 (`orbLLMReplan.ts`)
- 🟡 缺少完整的進度可視化和用戶干預

**需要完成**：
- [ ] 實時進度追蹤 UI (`client/src/components/orb/OrbTaskProgressTracker.tsx`)
- [ ] 任務暫停/繼續/取消控制
- [ ] 任務分支和並行執行可視化
- [ ] 執行錯誤的智能恢復建議

#### 4. 跨頁跳轉與功能查詢 [60% → 100%]

**現狀**：
- ✅ 頁面註冊表 (`shared/appRegistry.ts`)
- ✅ 導航精靈 (路路 navigator)
- 🟡 缺少完整的功能發現和推薦

**需要完成**：
- [ ] 功能查詢引擎 (`server/services/orbFeatureDiscovery.ts`)
- [ ] 智能頁面推薦（基於用戶意圖）
- [ ] 跳轉前的上下文保存和恢復
- [ ] 跨頁任務的無縫銜接

```typescript
// 功能查詢 API
interface FeatureQuery {
  query: string; // "如何生成影片"
  context: {
    currentPage: string;
    recentPages: string[];
    userLevel: "beginner" | "intermediate" | "advanced";
  };
}

interface FeatureRecommendation {
  featureId: string;
  featureName: string;
  description: string;
  targetPage: string;
  relevanceScore: number;
  quickAction?: {
    label: string;
    action: "navigate" | "execute" | "guide";
    params: any;
  };
}
```

### 🟢 中優先級 (Important)

#### 5. 精靈協作可視化 [30% → 100%]

**需要完成**：
- [ ] 精靈協作流程圖 (`OrbCollaborationFlowChart.tsx`)
- [ ] 實時顯示當前活躍精靈和交棒狀態
- [ ] 精靈對話歷史（精靈之間的內部通訊）
- [ ] 用戶可調整的精靈協作偏好

#### 6. 深度上下文管理 [50% → 100%]

**現狀**：
- ✅ 基礎記憶系統 (`orbMemory.ts`, `orbTaskMemory.ts`)
- 🟡 缺少長期記憶和跨會話上下文

**需要完成**：
- [ ] 長期記憶存儲和檢索
- [ ] 跨會話上下文恢復
- [ ] 記憶重要性評分和清理策略
- [ ] 用戶可管理的記憶庫 UI

#### 7. 智能工作流模板 [40% → 100%]

**現狀**：
- ✅ 6 個預定義工作流 (`cross-modality-workflows.ts`)
- 🟡 缺少用戶自定義工作流

**需要完成**：
- [ ] 工作流模板編輯器
- [ ] 從歷史任務自動生成工作流模板
- [ ] 工作流分享和導入
- [ ] 工作流執行統計和優化建議

### 🔵 低優先級 (Nice to Have)

#### 8. 語音交互增強
- [ ] 連續對話模式
- [ ] 語音命令快捷鍵
- [ ] 多語言語音支持

#### 9. 移動端優化
- [ ] 觸控優化的意圖卡片
- [ ] 移動端專用的精靈選擇器
- [ ] 離線模式支持

#### 10. 分析和監控
- [ ] 精靈使用統計儀表板
- [ ] 任務成功率分析
- [ ] 性能監控和優化建議

## 三、實施階段 (Implementation Phases)

### Phase 1: 核心功能完善 (1-2 週)
優先級：🔴 Critical

**目標**：完成最關鍵的用戶交互功能

1. **意圖卡片全站整合**
   - 統一所有對話界面的意圖卡片渲染
   - 添加卡片歷史和快速重用
   - 測試和優化

2. **反問系統實現**
   - 設計反問數據結構和 API
   - 實現反問生成邏輯
   - 創建反問 UI 組件
   - 集成到任務執行流程

3. **多步驟執行可視化**
   - 實時進度追蹤 UI
   - 暫停/繼續/取消控制
   - 錯誤恢復機制

### Phase 2: 增強功能 (2-3 週)
優先級：🟡 High

4. **功能查詢引擎**
   - 實現功能發現算法
   - 智能頁面推薦
   - 跨頁任務銜接

5. **精靈協作可視化**
   - 協作流程圖
   - 實時狀態顯示
   - 協作偏好設置

6. **深度上下文管理**
   - 長期記憶系統
   - 跨會話恢復
   - 記憶管理 UI

### Phase 3: 高級功能 (3-4 週)
優先級：🟢 Medium

7. **工作流模板系統**
   - 模板編輯器
   - 自動生成模板
   - 模板分享

8. **語音和移動優化**
   - 連續對話
   - 移動端優化
   - 離線支持

### Phase 4: 分析和優化 (持續)
優先級：🔵 Low

9. **監控和分析**
   - 統計儀表板
   - 性能監控
   - 優化建議

## 四、技術架構設計

### 新增服務模組

```typescript
// server/services/orbClarificationEngine.ts
export class OrbClarificationEngine {
  async generateClarificationQuestions(
    task: OrbTask,
    context: TaskContext
  ): Promise<ClarificationRequest> {
    // AI 分析任務缺失的信息
    // 生成結構化問題
  }

  async processClarificationAnswers(
    taskId: string,
    answers: Record<string, any>
  ): Promise<void> {
    // 將回答整合回任務上下文
    // 續接任務執行
  }
}

// server/services/orbFeatureDiscovery.ts
export class OrbFeatureDiscovery {
  async queryFeatures(
    query: FeatureQuery
  ): Promise<FeatureRecommendation[]> {
    // 語義搜索功能
    // 基於上下文排序
    // 生成快速操作
  }

  async recordFeatureUsage(
    featureId: string,
    userId: number
  ): Promise<void> {
    // 記錄使用統計
    // 用於個性化推薦
  }
}

// server/services/orbContextManager.ts
export class OrbContextManager {
  async saveLongTermMemory(
    userId: number,
    memory: MemoryEntry
  ): Promise<void> {
    // 存儲長期記憶
  }

  async retrieveRelevantMemories(
    userId: number,
    query: string,
    limit: number
  ): Promise<MemoryEntry[]> {
    // 語義搜索相關記憶
  }

  async scoreMemoryImportance(
    memory: MemoryEntry
  ): Promise<number> {
    // AI 評分記憶重要性
  }
}
```

### 新增前端組件

```typescript
// client/src/components/orb/OrbClarificationDialog.tsx
export function OrbClarificationDialog({
  request: ClarificationRequest,
  onSubmit: (answers: Record<string, any>) => void,
  onSkip: () => void
}) {
  // 渲染結構化問題表單
  // 支持多種問題類型
  // 智能預填建議
}

// client/src/components/orb/OrbTaskProgressTracker.tsx
export function OrbTaskProgressTracker({
  taskId: string,
  onPause: () => void,
  onResume: () => void,
  onCancel: () => void
}) {
  // 實時顯示執行進度
  // 可視化步驟依賴
  // 顯示當前活躍精靈
}

// client/src/components/orb/OrbCollaborationFlowChart.tsx
export function OrbCollaborationFlowChart({
  activeSpirits: string[],
  handoffs: HandoffHistory[]
}) {
  // 可視化精靈協作流程
  // 實時更新狀態
  // 可點擊查看詳情
}

// client/src/components/orb/OrbFeatureSearchPanel.tsx
export function OrbFeatureSearchPanel({
  query: string,
  onFeatureSelect: (feature: FeatureRecommendation) => void
}) {
  // 功能搜索界面
  // 智能推薦顯示
  // 快速操作按鈕
}
```

### 新增數據庫表

```sql
-- 長期記憶表
CREATE TABLE orb_long_term_memories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  memory_type ENUM('fact', 'preference', 'skill', 'workflow') NOT NULL,
  content TEXT NOT NULL,
  importance_score FLOAT NOT NULL DEFAULT 0.5,
  access_count INT NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_type (user_id, memory_type),
  INDEX idx_importance (user_id, importance_score DESC),
  FULLTEXT idx_content (content)
);

-- 功能使用統計
CREATE TABLE orb_feature_usage_stats (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  feature_id VARCHAR(100) NOT NULL,
  page_path VARCHAR(255) NOT NULL,
  usage_count INT NOT NULL DEFAULT 1,
  last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_feature (user_id, feature_id),
  INDEX idx_user_last_used (user_id, last_used_at DESC)
);

-- 反問歷史
CREATE TABLE orb_clarification_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  task_id VARCHAR(100) NOT NULL,
  spirit_id VARCHAR(50) NOT NULL,
  question_id VARCHAR(100) NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  answered_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_task (user_id, task_id),
  INDEX idx_question (question_id)
);

-- 工作流模板
CREATE TABLE orb_workflow_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NULL, -- NULL for system templates
  template_name VARCHAR(200) NOT NULL,
  description TEXT,
  workflow_definition JSON NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  usage_count INT NOT NULL DEFAULT 0,
  success_rate FLOAT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_public (user_id, is_public),
  INDEX idx_usage (usage_count DESC)
);
```

## 五、測試策略

### 單元測試
- [ ] 意圖卡片解析器測試
- [ ] 反問生成邏輯測試
- [ ] 功能查詢算法測試
- [ ] 記憶評分算法測試

### 整合測試
- [ ] 多步驟任務執行流程
- [ ] 精靈協作和交棒
- [ ] 跨頁任務銜接
- [ ] 反問-回答-續接流程

### E2E 測試
- [ ] 完整用戶場景測試
- [ ] 多精靈協作場景
- [ ] 錯誤恢復場景
- [ ] 性能和並發測試

## 六、成功指標

### 功能完整性
- ✅ 25 個精靈全部可用
- ✅ 意圖卡片在所有界面統一
- ✅ 反問系統正常運作
- ✅ 多步驟任務可視化
- ✅ 功能查詢和推薦準確

### 用戶體驗
- 任務完成率 > 85%
- 反問回答率 > 70%
- 功能發現時間 < 30 秒
- 跨頁任務成功率 > 80%

### 性能指標
- 意圖卡片渲染 < 100ms
- 反問生成 < 2s
- 功能查詢 < 500ms
- 多步驟任務啟動 < 1s

## 七、風險與挑戰

### 技術風險
1. **複雜度管理**：25 個精靈的協作可能產生意外行為
   - 緩解：完善的日誌和追蹤系統

2. **性能問題**：大量 AI 調用可能影響響應速度
   - 緩解：智能緩存和並行執行

3. **狀態一致性**：跨頁和多步驟任務的狀態管理
   - 緩解：完善的狀態機和事務管理

### 產品風險
1. **用戶學習曲線**：25 個精靈可能讓新用戶困惑
   - 緩解：完善的引導系統和預設模式

2. **過度依賴**：用戶可能過度依賴 AI
   - 緩解：保持手動控制選項，鼓勵學習

## 八、下一步行動

### 立即開始 (本週)
1. ✅ 完成 25 精靈工具整合（已完成）
2. ✅ 創建完整系統文檔（本文件）
3. [ ] 設計反問系統 API 和數據結構
4. [ ] 實現意圖卡片全站整合

### 短期目標 (2 週內)
5. [ ] 完成反問系統核心邏輯
6. [ ] 實現多步驟執行可視化
7. [ ] 完成功能查詢引擎基礎版

### 中期目標 (1 個月內)
8. [ ] 完成精靈協作可視化
9. [ ] 實現長期記憶系統
10. [ ] 完成工作流模板系統

### 長期願景 (3 個月內)
11. [ ] 全面的分析和監控系統
12. [ ] 移動端完整優化
13. [ ] 多語言全面支持

---

## 總結

Healing Studio 的光球代理系統已經有了堅實的基礎，25 個精靈的工具整合已經完成。接下來的重點是：

1. **完善用戶交互**：意圖卡片、反問系統、可視化
2. **增強智能性**：功能發現、上下文管理、工作流優化
3. **提升體驗**：流暢的跨頁任務、清晰的進度顯示、智能推薦

這是一個雄心勃勃但可行的計畫，將打造業界領先的 AI 輔助創作平台！ 🚀
