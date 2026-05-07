# 專精 AI 助手系統 (Specialized AI Agents)

> **版本**: 1.0
> **最後更新**: 2026-05-07
> **狀態**: 已實作

## 概述

專精 AI 助手系統為 Healing Studio 的光球 (Orb) 代理系統增加了 6 種專業領域的深度專家。每個專精助手都擁有特定領域的深度知識、專業工具使用能力，以及學習使用者偏好的能力。

## 專精助手類型

### 1. 圖像精靈 (Image Specialist)
**Agent ID**: `image-specialist`

- **專精領域**: 圖像生成與編輯
- **主要工具**:
  - `studio.generateImage` - 圖片生成（T2I / I2I）
  - `studio.generate3D` - 3D 模型生成
- **知識領域**:
  - Text-to-Image 生成
  - Image-to-Image 轉換
  - 圖片編輯與修復
  - 圖片放大增強
  - Inpainting 與 Outpainting
  - LoRA 整合
  - ControlNet 控制
  - 人物姿勢偵測
  - 風格轉換
- **觸發關鍵字**: 圖片、圖像、照片、畫、繪製、修圖、去背、放大圖片、image、picture、photo

### 2. 影像精靈 (Video Specialist)
**Agent ID**: `video-specialist`

- **專精領域**: 影片生成與編輯
- **主要工具**:
  - `studio.generateVideo` - 影片生成（T2V / I2V / V2V）
  - `studio.enhanceVideo` - 影片增強
  - `studio.animateSpeaker` - 虛擬人物對嘴動畫
- **知識領域**:
  - Text-to-Video 生成
  - Image-to-Video 動畫
  - Video-to-Video 風格轉換
  - 影片畫質增強
  - 影片放大與插幀
  - 虛擬化身對嘴
  - 短影片創作技巧
- **觸發關鍵字**: 影片、視頻、影像、動畫、剪輯、影片編輯、i2v、v2v、video

### 3. 音樂精靈 (Music Specialist)
**Agent ID**: `music-specialist`

- **專精領域**: 音樂與音訊生成
- **主要工具**:
  - `studio.generateAudio` - 音樂生成
  - `studio.generateSfx` - 音效生成
  - `studio.separateStems` - 音軌分離
  - `studio.isolateAudio` - 音訊隔離
  - `studio.mergeAudios` - 音訊混音
- **知識領域**:
  - 音樂創作與生成
  - 音效設計
  - 音軌分離技術
  - 音訊混音
  - 背景音樂配置
  - Foley 音效
- **觸發關鍵字**: 音樂、歌曲、配樂、背景音樂、作曲、音效、混音、stems、music、audio

### 4. 語音精靈 (Voice Specialist)
**Agent ID**: `voice-specialist`

- **專精領域**: 語音生成與配音
- **主要工具**:
  - `studio.generateVoice` - 語音合成 (TTS)
  - `studio.cloneVoice` - 語音克隆
  - `studio.designVoice` - 語音設計
  - `studio.changeVoice` - 變聲
  - `studio.transcribe` - 語音轉文字 (STT)
- **知識領域**:
  - Text-to-Speech 合成
  - 語音克隆技術
  - 虛擬聲音設計
  - 變聲處理
  - 語音辨識
  - 多語言配音
  - 情感表達調整
- **觸發關鍵字**: 配音、聲音、語音、旁白、聲音克隆、變聲、TTS、語音生成、voice、dubbing

### 5. 訓練精靈 (Training Specialist)
**Agent ID**: `training-specialist`

- **專精領域**: 模型訓練與 LoRA 微調
- **主要工具**:
  - `studio.trainLora` - LoRA 模型訓練
- **知識領域**:
  - LoRA 訓練流程
  - 模型微調技術
  - 資料集準備
  - 訓練參數調整
  - 風格 LoRA
  - 角色 LoRA
  - 場景 LoRA
  - 影片 LoRA
- **觸發關鍵字**: 訓練、訓練模型、fine-tune、LoRA、模型訓練、客製化模型、train、training

### 6. 學習精靈 (Learning Specialist)
**Agent ID**: `learning-specialist`

- **專精領域**: 平台教學與導引
- **主要工具**:
  - `director.suggestPlan` - 工作流建議
  - `research.deepSearch` - 外部搜尋
  - `inspiration.fetch` - 靈感獲取
- **知識領域**:
  - 平台功能教學
  - 工作流程引導
  - 最佳實踐分享
  - 問題排除協助
  - 功能探索
  - 新手入門指導
  - 進階技巧
- **觸發關鍵字**: 教學、學習、教程、怎麼用、如何使用、教我、指導、新手、入門、tutorial、learn

## 技術架構

### 角色選擇與路由

專精助手透過 `shared/orb-agent-roles.ts` 中的 `selectRoleForIntent()` 函數自動選擇：

```typescript
export function selectRoleForIntent(input: RoleSelectionInput): RoleSelection {
  const text = lowerOnce(input.text);

  // 1. 檢查是否匹配專精助手的關鍵字
  for (const rule of KEYWORD_RULES) {
    if (matchesAny(text, rule.keywords)) {
      return { role: rule.role, confidence: 0.85, rationale: rule.rationale };
    }
  }

  // 2. 根據當前頁面推薦專精助手
  // 3. 預設返回 companion 模式
}
```

### 系統提示詞整合

每個專精助手都有專屬的系統提示詞片段，透過 `getRoleSystemPromptSlice()` 注入到光球的回覆中：

```typescript
export function getRoleSystemPromptSlice(role: AgentRole): string {
  switch (role) {
    case "image-specialist":
      return "【本回合扮演：圖像精靈 (image specialist)】\\n你是圖像生成與編輯專家...";
    // ... 其他專精助手
  }
}
```

### 記憶與學習系統

#### 資料庫結構

**specialized_agent_memory** 表格：
```sql
CREATE TABLE specialized_agent_memory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  agentId VARCHAR(64) NOT NULL,
  memoryType ENUM('preference', 'pattern', 'context', 'feedback'),
  memoryKey VARCHAR(128) NOT NULL,
  memoryValue JSON NOT NULL,
  confidence DECIMAL(3,2) DEFAULT 0.50,
  usageCount INT DEFAULT 1,
  lastUsedAt TIMESTAMP,
  ...
);
```

**記憶類型**:
- `preference`: 使用者偏好（例如：喜歡的模型、常用長寬比）
- `pattern`: 使用模式（例如：經常使用的參數組合）
- `context`: 上下文資訊（例如：最近的專案類型）
- `feedback`: 使用者反饋（例如：對結果的滿意度）

#### 互動追蹤

**specialized_agent_interactions** 表格記錄所有使用者與專精助手的互動：

```sql
CREATE TABLE specialized_agent_interactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  agentId VARCHAR(64) NOT NULL,
  sessionId VARCHAR(128),
  interactionType ENUM('activated', 'tool_used', 'suggestion_accepted', 'suggestion_rejected', 'error'),
  toolName VARCHAR(128),
  contextData JSON,
  userSatisfaction ENUM('positive', 'neutral', 'negative'),
  durationMs INT,
  ...
);
```

### 使用者偏好設定

在 `agent_preferences` 表格中新增的欄位：

- `preferredSpecialistAgent`: 使用者偏好的預設專精助手
- `specialistAutoActivate`: 是否自動啟用專精助手（預設：true）
- `specialistProactiveMode`: 是否允許專精助手主動建議（預設：true）
- `specialistLearningEnabled`: 是否允許專精助手學習偏好（預設：true）
- `disabledSpecialistAgents`: 停用的專精助手清單

## 使用流程

### 自動啟用流程

1. **使用者輸入** → 「幫我生成一張貓咪的圖片」
2. **關鍵字匹配** → 偵測到「生成」「圖片」關鍵字
3. **角色選擇** → 選擇 `image-specialist` (信心度: 0.85)
4. **系統提示詞注入** → 加入圖像精靈的專業提示詞
5. **專業回應** → 光球以圖像專家身份回覆，提供專業的模型建議和參數設定

### 跨領域任務流程

1. **使用者輸入** → 「做一支有配樂的短影片」
2. **任務拆解** → 識別為跨領域任務
3. **階段性切換**:
   - 階段 1: `video-specialist` - 生成影片
   - 階段 2: `music-specialist` - 生成配樂
   - 階段 3: `video-specialist` - 合併音訊與影片
4. **完成交付** → 提供完整的短影片成品

### 學習與優化流程

1. **工具使用記錄** → 記錄到 `specialized_agent_interactions`
2. **偏好提取** → 分析使用者的選擇模式
3. **記憶儲存** → 儲存到 `specialized_agent_memory`
4. **信心度調整** → 根據使用頻率調整 `confidence`
5. **個人化建議** → 在未來互動中應用學習到的偏好

## API 與工具函數

### 專精助手能力查詢

```typescript
import { getSpecializedAgentCapability, isSpecializedAgent } from 'shared/orb-specialized-agents';

// 取得專精助手能力
const capability = getSpecializedAgentCapability('image-specialist');
console.log(capability.displayName); // "圖像精靈"
console.log(capability.primaryTools); // ["studio.generateImage", "studio.generate3D"]

// 檢查是否為專精助手
if (isSpecializedAgent('image-specialist')) {
  // 處理專精助手邏輯
}
```

### 工具查詢

```typescript
import { findAgentForTool, getAgentTools } from 'shared/orb-specialized-agents';

// 找出負責某個工具的專精助手
const agent = findAgentForTool('studio.generateImage'); // "image-specialist"

// 取得專精助手的所有工具
const tools = getAgentTools('image-specialist');
// ["studio.generateImage", "studio.generate3D"]
```

### 智能推薦

```typescript
import { recommendAgent } from 'shared/orb-specialized-agents';

// 根據上下文推薦專精助手
const recommended = recommendAgent({
  currentPage: '/image-studio',
  userIntent: '我想生成一張圖片',
  recentTools: ['studio.generateImage']
});
console.log(recommended); // "image-specialist"
```

## 最佳實踐

### 1. 專精助手切換時機

**✅ 好的切換時機**:
- 使用者明確提到特定領域的關鍵字
- 使用者正在使用該領域的頁面
- 使用者最近使用了該領域的工具

**❌ 避免的切換時機**:
- 使用者的需求模糊不清
- 使用者只是在閒聊
- 強制推銷專精助手的能力

### 2. 保持人格一致性

專精助手不改變光球的溫柔、療癒人格，只是在特定領域展現更深的專業度：

```
❌ 錯誤: 「我是圖像生成專家，現在給你專業建議...」（語氣變得生硬）
✅ 正確: 「讓我幫你找到最適合的圖片模型 🌿 我建議使用 Flux Pro...」（保持溫柔）
```

### 3. 漸進式學習

不要一次儲存太多記憶，而是透過多次互動逐步建立使用者偏好：

```typescript
// ❌ 錯誤: 第一次互動就存很多偏好
storeMemory({ agentId: 'image-specialist', memoryKey: 'all_preferences', ... });

// ✅ 正確: 逐步記錄具體偏好
storeMemory({ agentId: 'image-specialist', memoryKey: 'preferred_aspect_ratio', value: '16:9' });
storeMemory({ agentId: 'image-specialist', memoryKey: 'preferred_model', value: 'flux-pro' });
```

## 測試與驗證

### 單元測試

測試檔案位於 `server/services/__tests__/specializedAgents.test.ts`（待實作）

### E2E 測試情境

1. **專精助手自動啟用測試**: 輸入領域關鍵字，驗證是否正確切換到對應專精助手
2. **跨領域任務測試**: 輸入跨領域需求，驗證是否能正確拆解並依序切換專精助手
3. **記憶學習測試**: 重複使用特定參數，驗證系統是否能學習並在未來主動建議
4. **偏好設定測試**: 停用特定專精助手，驗證系統是否尊重使用者設定

## 未來擴展

### 計畫中的功能

1. **專精助手協作**: 多個專精助手協同完成複雜任務
2. **自訂專精助手**: 讓使用者建立自己的專精助手
3. **專精助手市集**: 分享和下載社群創建的專精助手
4. **進階學習能力**: 從失敗經驗中學習，避免重複錯誤
5. **情境感知**: 根據時間、裝置、使用場景自動調整建議

## 相關文件

- [光球代理系統強化計畫](./light-ball-agent-enhancement-plan.md)
- [Agent Roles 設計文件](../../shared/orb-agent-roles.ts)
- [Global Agent Tools](../../shared/global-agent-tools.ts)
- [Site Knowledge 系統](../../server/services/siteKnowledge.ts)

## 變更歷史

- **2026-05-07**: 初始版本，實作 6 種專精助手
- **2026-05-07**: 新增資料庫 schema 和記憶系統
- **2026-05-07**: 整合到光球系統提示詞

---

**維護者**: Claude Code / Codex Cloud
**問題回報**: 請在 GitHub Issues 提出
