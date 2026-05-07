

# AI 助手互聯協作系統 (Agent Interconnection & Collaboration System)

> **版本**: 1.0
> **最後更新**: 2026-05-07
> **狀態**: 已實作

## 概述

AI 助手互聯協作系統將 Healing Studio 的 12 個 AI 助手（6 個角色助手 + 6 個專精助手）串連成一個強大的協作網路，實現真正的多助手智能協作。

### 12 個 AI 助手

**角色助手（Role Agents）**：
1. **導演 (director)** - 多步驟規劃與工作流設計
2. **作曲家 (composer)** - 任務執行與參數設定
3. **評論者 (critic)** - 成果審查與改進建議
4. **研究員 (researcher)** - 資訊搜尋與比較分析
5. **導航 (navigator)** - 頁面導航與功能引導
6. **陪伴 (companion)** - 開放對話與意圖釐清

**專精助手（Specialized Agents）**：
7. **圖像精靈 (image-specialist)** - 圖像生成與編輯
8. **影像精靈 (video-specialist)** - 影片生成與編輯
9. **音樂精靈 (music-specialist)** - 音樂與音訊生成
10. **語音精靈 (voice-specialist)** - 語音克隆與配音
11. **訓練精靈 (training-specialist)** - 模型訓練與 LoRA
12. **學習精靈 (learning-specialist)** - 教學與最佳實踐

## 核心架構

### 1. 助手通訊協議 (Agent Communication Protocol)

定義在 `shared/agent-communication-protocol.ts`

**訊息類型**：
- `request` - 請求另一個助手執行任務
- `response` - 回應請求
- `notification` - 通知其他助手某個事件
- `handoff` - 將控制權轉移給另一個助手
- `broadcast` - 廣播給所有助手
- `query` - 查詢資訊或能力
- `share_context` - 分享執行上下文

**關鍵資料結構**：

```typescript
interface AgentMessage {
  messageId: string;
  fromAgent: AgentRole;
  toAgent: AgentRole | "broadcast" | AgentRole[];
  messageType: AgentMessageType;
  priority: "low" | "normal" | "high" | "urgent";
  content: {
    action?: string;
    data?: Record<string, unknown>;
    context?: AgentSharedContext;
  };
  timestamp: number;
  correlationId?: string;
}

interface AgentSharedContext {
  userId?: number;
  sessionId: string;
  taskId?: string;
  collaborationId?: string;
  currentStep?: number;
  generatedAssets?: Array<{
    type: "image" | "video" | "audio" | "voice";
    url: string;
  }>;
  previousParameters?: Record<string, unknown>;
  constraints?: {
    budget?: number;
    quality?: "draft" | "standard" | "high" | "premium";
  };
}
```

### 2. 助手通訊匯流排 (Agent Communication Bus)

實作在 `server/services/agentCommunicationBus.ts`

**功能**：
- 訊息路由與分發
- 訊息佇列管理
- 廣播機制
- 訊息歷史記錄（最多 1000 則，保留 24 小時）
- 對話串追蹤（by correlationId）

**API**：
```typescript
// 訂閱訊息
AgentCommunicationBus.subscribe(agentId, handler, { messageTypes: ["request"] });

// 發布訊息
await AgentCommunicationBus.publish(message);

// 查詢歷史
const history = AgentCommunicationBus.getHistory({ agentId, limit: 50 });

// 查詢其他助手
const response = await AgentCommunicationBus.query(query, toAgent);
```

### 3. 助手協作編排器 (Agent Collaboration Orchestrator)

實作在 `server/services/agentCollaborationOrchestrator.ts`

**功能**：
- 管理協作會話（collaboration sessions）
- 註冊和發現助手能力
- 智能助手選擇
- 執行助手交接（handoff）
- 追蹤協作進度

**核心方法**：
```typescript
// 開始協作會話
const session = AgentCollaborationOrchestrator.startCollaboration(request);

// 尋找最佳助手
const bestAgent = AgentCollaborationOrchestrator.findBestAgent({
  tools: ["studio.generateImage"],
  domains: ["image generation"],
  specialization: "image"
});

// 執行助手交接
await AgentCollaborationOrchestrator.executeHandoff({
  fromAgent: "image-specialist",
  toAgent: "video-specialist",
  reason: "圖片生成完成，準備轉為影片",
  context: sharedContext
});

// 完成協作
AgentCollaborationOrchestrator.completeCollaboration(collaborationId, result);
```

### 4. 協作任務規劃器 (Collaborative Task Planner)

實作在 `server/services/collaborativeTaskPlanner.ts`

**功能**：
- 自動任務分解
- 識別所需助手
- 建立執行計畫（串行、並行或混合）
- 管理任務依賴關係

**使用範例**：
```typescript
// 分解任務
const decomposition = CollaborativeTaskPlanner.decomposeTask(
  "幫我做一支 30 秒的產品介紹影片，配上動感音樂和專業旁白",
  context
);

// 結果：
// {
//   originalTask: "...",
//   subtasks: [
//     { stepId: "step_1", assignedAgent: "director", description: "規劃整體工作流程" },
//     { stepId: "step_2", assignedAgent: "image-specialist", description: "生成產品圖片" },
//     { stepId: "step_3", assignedAgent: "video-specialist", description: "生成影片", dependsOn: ["step_2"] },
//     { stepId: "step_4", assignedAgent: "music-specialist", description: "生成配樂" },
//     { stepId: "step_5", assignedAgent: "voice-specialist", description: "生成旁白" },
//     { stepId: "step_6", assignedAgent: "music-specialist", description: "合併音訊", dependsOn: ["step_4", "step_5"] },
//     { stepId: "step_7", assignedAgent: "video-specialist", description: "合併影片與音訊", dependsOn: ["step_3", "step_6"] }
//   ],
//   executionPlan: {
//     strategy: "mixed",
//     stages: [...]
//   }
// }
```

## 資料庫架構

### 表格結構

**1. agent_collaboration_sessions**
記錄多助手協作會話

```sql
CREATE TABLE agent_collaboration_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  collaborationId VARCHAR(128) UNIQUE,
  userId INT,
  taskDescription TEXT,
  currentAgent VARCHAR(64),
  participatingAgents JSON,
  sharedContext JSON,
  status ENUM('active', 'completed', 'failed', 'cancelled'),
  completedSteps JSON,
  startedAt TIMESTAMP,
  completedAt TIMESTAMP
);
```

**2. agent_message_history**
記錄所有助手間訊息

```sql
CREATE TABLE agent_message_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  messageId VARCHAR(128) UNIQUE,
  collaborationId VARCHAR(128),
  correlationId VARCHAR(128),
  fromAgent VARCHAR(64),
  toAgent VARCHAR(255),
  messageType ENUM('request', 'response', 'notification', 'handoff', 'broadcast', 'query', 'share_context'),
  contentData JSON,
  timestamp BIGINT
);
```

**3. agent_shared_knowledge**
共享知識庫

```sql
CREATE TABLE agent_shared_knowledge (
  id INT AUTO_INCREMENT PRIMARY KEY,
  knowledgeId VARCHAR(128) UNIQUE,
  contributingAgent VARCHAR(64),
  knowledgeType ENUM('best_practice', 'failure_case', 'parameter_combination', 'workflow_template'),
  domain VARCHAR(128),
  title VARCHAR(255),
  description TEXT,
  knowledgeData JSON,
  confidence DECIMAL(3,2),
  usageCount INT,
  applicableAgents JSON
);
```

**4. agent_handoff_history**
助手交接歷史

```sql
CREATE TABLE agent_handoff_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  handoffId VARCHAR(128) UNIQUE,
  collaborationId VARCHAR(128),
  fromAgent VARCHAR(64),
  toAgent VARCHAR(64),
  reason TEXT,
  contextData JSON,
  handoffAt TIMESTAMP
);
```

**5. agent_performance_metrics**
助手效能指標

```sql
CREATE TABLE agent_performance_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agentId VARCHAR(64),
  metricDate DATE,
  totalTasks INT,
  successfulTasks INT,
  collaborationCount INT,
  handoffReceived INT,
  handoffGiven INT,
  UNIQUE KEY unique_agent_date (agentId, metricDate)
);
```

## 實際協作流程範例

### 範例 1：多模態創作工作流

**使用者請求**：
```
「幫我做一支 30 秒的產品介紹影片，配上動感音樂和專業旁白」
```

**系統協作流程**：

1. **companion** 接收請求，識別為複雜多模態任務
2. **director** 被召喚，分解任務：
   ```
   → 生成產品圖片
   → 將圖片轉為影片（30秒）
   → 生成動感配樂（30秒）
   → 生成專業旁白
   → 合併音訊
   → 合併影片與音訊
   ```

3. **圖像精靈** 執行：
   ```typescript
   // 接收 handoff
   message = {
     fromAgent: "director",
     toAgent: "image-specialist",
     messageType: "handoff",
     content: {
       action: "generate_image",
       context: {
         originalIntent: "產品介紹影片的關鍵視覺",
         constraints: { quality: "high", aspectRatio: "16:9" }
       }
     }
   }

   // 生成圖片
   const imageUrl = await studio.generateImage({ prompt: "...", aspect_ratio: "16:9" });

   // 通知影像精靈
   await AgentCommunicationBus.publish({
     fromAgent: "image-specialist",
     toAgent: "video-specialist",
     messageType: "handoff",
     content: {
       context: {
         generatedAssets: [{ type: "image", url: imageUrl }],
         nextAction: "convert_to_video"
       }
     }
   });
   ```

4. **影像精靈** 接收圖片，開始生成影片
   同時，**音樂精靈** 和 **語音精靈** 並行工作

5. **音樂精靈** 完成配樂後通知 **語音精靈**
6. **語音精靈** 完成旁白後，兩者合併音訊
7. **影像精靈** 接收合併音訊，與影片結合
8. **critic** 審查最終成果，提供改進建議（可選）

**協作優勢**：
- 圖片生成 → 影片生成：串行（依賴關係）
- 配樂生成 ‖ 旁白生成：並行（獨立任務）
- 總時間：約 2-3 分鐘（比串行快 40%）

### 範例 2：知識共享與學習

**情境**：圖像精靈發現 Flux Pro + LoRA 的某個參數組合效果特別好

```typescript
// 圖像精靈記錄成功案例
await AgentCommunicationBus.publish({
  fromAgent: "image-specialist",
  toAgent: "broadcast",
  messageType: "notification",
  content: {
    action: "share_knowledge",
    data: {
      knowledgeType: "parameter_combination",
      domain: "image",
      title: "Flux Pro + LoRA 最佳參數組合",
      description: "guidance_scale: 3.5, num_inference_steps: 50, lora_scale: 0.8",
      confidence: 0.95,
      successRate: 0.92
    }
  }
});

// 其他助手接收並儲存到共享知識庫
// 當影像精靈需要生成高品質圖片時，可查詢並應用此知識
```

### 範例 3：自動故障轉移

**情境**：影像精靈執行失敗

```typescript
// 影像精靈遇到錯誤
await AgentCommunicationBus.publish({
  fromAgent: "video-specialist",
  toAgent: "director",
  messageType: "notification",
  content: {
    action: "task_failed",
    data: {
      error: "Model timeout",
      attemptedModel: "kling-2.1",
      context: sharedContext
    }
  }
});

// 導演重新規劃
const alternativePlan = await CollaborativeTaskPlanner.decomposeTask(
  originalTask,
  { ...context, constraints: { excludeModels: ["kling-2.1"] } }
);

// 分配給備用助手或使用替代策略
await AgentCollaborationOrchestrator.executeHandoff({
  fromAgent: "director",
  toAgent: "video-specialist",
  reason: "重試使用替代模型 WAN T2V",
  context: { ...sharedContext, preferredModel: "wan-t2v" }
});
```

## API 整合指南

### 在 Orb Router 中使用

```typescript
import { AgentCommunicationBus } from "./services/agentCommunicationBus";
import { AgentCollaborationOrchestrator } from "./services/agentCollaborationOrchestrator";
import { CollaborativeTaskPlanner } from "./services/collaborativeTaskPlanner";

// 處理複雜請求
async function handleComplexRequest(userRequest: string, userId: number) {
  // 1. 分解任務
  const decomposition = CollaborativeTaskPlanner.decomposeTask(userRequest, {
    userId,
    sessionId: generateSessionId(),
    originalIntent: userRequest
  });

  // 2. 開始協作會話
  const session = AgentCollaborationOrchestrator.startCollaboration({
    requestingAgent: "director",
    targetAgents: "auto",
    task: userRequest,
    taskType: "generate",
    context: decomposition.executionPlan.sharedContext
  });

  // 3. 執行任務
  for (const stage of decomposition.executionPlan.stages) {
    if (stage.stageType === "parallel") {
      // 並行執行
      await Promise.all(stage.tasks.map(task => executeSubtask(task, session)));
    } else {
      // 串行執行
      for (const task of stage.tasks) {
        await executeSubtask(task, session);
      }
    }
  }

  // 4. 完成協作
  AgentCollaborationOrchestrator.completeCollaboration(session.collaborationId, {
    success: true,
    completedBy: session.currentAgent,
    durationMs: Date.now() - session.startedAt
  });
}
```

## 監控與分析

### 查詢協作統計

```typescript
// 助手效能統計
const stats = AgentCollaborationOrchestrator.getStats();
// {
//   activeSessions: 5,
//   totalAgents: 12,
//   availableAgents: 12,
//   sessionsByAgent: {
//     "director": 3,
//     "image-specialist": 5,
//     "video-specialist": 4,
//     ...
//   }
// }

// 通訊匯流排統計
const busStats = AgentCommunicationBus.getStats();
// {
//   totalMessages: 150,
//   messagesByAgent: { "director": 30, ... },
//   messagesByType: { "handoff": 20, "request": 50, ... }
// }
```

### 查詢協作歷史

```sql
-- 查詢某使用者的所有協作會話
SELECT * FROM agent_collaboration_sessions
WHERE userId = ? AND status = 'completed'
ORDER BY startedAt DESC LIMIT 10;

-- 查詢助手間的訊息交換
SELECT * FROM agent_message_history
WHERE collaborationId = ?
ORDER BY timestamp ASC;

-- 查詢某助手的交接統計
SELECT fromAgent, toAgent, COUNT(*) as handoff_count
FROM agent_handoff_history
GROUP BY fromAgent, toAgent
ORDER BY handoff_count DESC;
```

## 最佳實踐

### 1. 助手間通訊

**✅ 好的做法**：
```typescript
// 清楚的訊息意圖
await AgentCommunicationBus.publish({
  fromAgent: "image-specialist",
  toAgent: "video-specialist",
  messageType: "handoff",
  priority: "high",
  content: {
    action: "generate_video_from_image",
    context: {
      generatedAssets: [{ type: "image", url: imageUrl, metadata: { style: "product" } }],
      constraints: { duration: 30, quality: "high" }
    }
  }
});
```

**❌ 避免的做法**：
```typescript
// 模糊的訊息
await AgentCommunicationBus.publish({
  fromAgent: "image-specialist",
  toAgent: "video-specialist",
  messageType: "notification",
  content: { data: { done: true } } // 缺乏上下文
});
```

### 2. 任務分解

**✅ 好的做法**：
- 清楚定義每個子任務的職責
- 正確設定依賴關係
- 估算合理的執行時間

**❌ 避免的做法**：
- 過度細分（造成過多助手切換）
- 忽略依賴關係（導致錯誤順序）
- 將不相關的任務分配給同一助手

### 3. 錯誤處理

```typescript
// 在助手執行中捕獲錯誤並通知
try {
  const result = await executeTask();
} catch (error) {
  await AgentCommunicationBus.publish({
    fromAgent: currentAgent,
    toAgent: "director",
    messageType: "notification",
    priority: "urgent",
    content: {
      action: "task_error",
      data: { error: error.message, taskId, context }
    }
  });

  // 請求重新規劃
  const newPlan = await requestReplan(taskId, error);
}
```

## 未來擴展

### 計畫中的功能

1. **助手學習網路**：助手可以從其他助手的經驗中學習
2. **動態助手註冊**：運行時新增自訂助手
3. **助手市集**：分享和下載社群創建的助手
4. **視覺化協作流程**：實時顯示助手協作狀態
5. **A/B 測試**：比較不同協作策略的效果

## 相關文件

- [專精 AI 助手系統](./specialized-agents-system.md)
- [光球代理系統強化計畫](./light-ball-agent-enhancement-plan.md)
- [Agent Roles 設計](../../shared/orb-agent-roles.ts)
- [通訊協議定義](../../shared/agent-communication-protocol.ts)

## 問題回報

如遇問題請在 GitHub Issues 提出，標籤：`agent-collaboration`

---

**維護者**: Claude Code / Codex Cloud
**版本**: 1.0
**最後更新**: 2026-05-07
