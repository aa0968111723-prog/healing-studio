# 25 精靈完整系統架構

> 更新於 2026-05-11 - 16 個功能精靈完全整合完成

## 概覽

Healing Studio 的 AI 精靈系統包含 **25 個專業精靈**，分為三大類別：

1. **16 個功能精靈 (Functional Specialists)** - 有專屬工具包的精靈
2. **9 個通用/主動精靈 (Generic/Proactive Spirits)** - 負責通用對話和主動監控

## 完整精靈名單

### 一、功能精靈 (Functional Specialists) - 16 個

#### A. 創作生成類 (6 個) - PR #610

| 暱稱 | ID | 專長領域 | 主要工具數量 | 狀態 |
|-----|-----|---------|-------------|-----|
| 圖圖 🎨 | `imageSpecialist` | 圖像生成/編輯/放大 | 5 tools | ✅ |
| 影影 🎬 | `videoSpecialist` | 影片生成/動畫/對嘴 | 5 tools | ✅ |
| 聲聲 🎙️ | `voiceSpecialist` | 語音合成/克隆/轉錄/規劃 (AI agent) | 12 tools | ✅ |
| 學學 📚 | `learningSpecialist` | 教學/導引/新手幫助 | 3 tools | ✅ |
| 音音 🎵 | `musicSpecialist` | 音樂/音效生成 | 4 tools | ✅ |
| 練練 🧪 | `trainingSpecialist` | LoRA 訓練/模型微調 | 3 tools | ✅ |

#### B. 支援管理類 (7 個) - This PR (2026-05-11)

| 暱稱 | ID | 專長領域 | 主要工具數量 | 狀態 |
|-----|-----|---------|-------------|-----|
| 法法 ⚖️ | `legalAdvisor` | 法律合規/授權檢查 | 3 tools | ✅ |
| 守守 🛡️ | `securityGuard` | 安全監控/健康檢查 | 4 tools | ✅ |
| 群群 📣 | `communityManager` | 社群平台經營 (IG/TikTok/小紅書/YT)：貼文公式 + hashtag + 排程 | 7 tools | ✅ |
| 引引 🌟 | `onboardingCoach` | 新手引導/快速上手 | 3 tools | ✅ |
| 執執 ⚙️ | `planExecutor` | 工作流程執行/計畫管理 | 4 tools | ✅ |
| 靈靈 💡 | `inspirationSpecialist` | 趨勢研究/創意靈感 | 4 tools | ✅ |
| 解解 🔧 | `anatomySpecialist` | 技術分析/故障排查 | 4 tools | ✅ |

#### C. 核心系統類 (3 個) - PR #609

| 暱稱 | ID | 專長領域 | 主要工具數量 | 狀態 |
|-----|-----|---------|-------------|-----|
| 總總 👑 | `chief-orchestrator` | 團隊協調/任務分派 | 6 tools | ✅ |
| 記記 📝 | `notes-curator` | 筆記管理/資產整理 | 5 tools | ✅ |
| 細細 ⚙️ | `settings-detail` | 設定管理/偏好配置 | 5 tools | ✅ |

**小計：16 個功能精靈，60+ 個工具方法**

### 二、通用/主動精靈 (Generic/Proactive Spirits) - 9 個

這些精靈走 `generic skill / proactive trigger` 路徑，沒有專屬的 fal.ai 生成工具：

| 暱稱 | ID | 角色類型 | 主要職責 |
|-----|-----|---------|---------|
| 導導 🎯 | `director` | 通用 | 跨頁工作流規劃 |
| 編編 ✍️ | `composer` | 通用 | 在當頁直接執行 |
| 品品 🔎 | `critic` | 通用 | 品質評估/改進建議 |
| 查查 🧭 | `researcher` | 通用 | 研究比較/資料查詢 |
| 路路 🧳 | `navigator` | 通用 | 頁面導航/路由 |
| 暖暖 🌿 | `companion` | 通用 | 開放對話/情感支持 |
| 財財 💰 | `accountant` | 主動 | 成本控制/配額監控 |
| 巧巧 ✨ | `quality-coach` | 主動 | 提示詞教練/品質指導 |
| 守守(inspector) 🛡️ | `inspector` | 主動 | 全站巡邏/錯誤偵測 |

**注意**：守守有兩個身份 - `securityGuard` (功能精靈) 和 `inspector` (主動精靈)

## 技術架構

### 工具執行流程

```
User Request
    ↓
Orb Agent (Global Chat Context)
    ↓
agentToolExecutor.ts (Main Switch)
    ↓
    ├─→ dispatchImageSpecialistTool → spiritTools/imageSpecialistTools.ts
    ├─→ dispatchVideoSpecialistTool → spiritTools/videoSpecialistTools.ts
    ├─→ dispatchVoiceSpecialistTool → spiritTools/voiceSpecialistTools.ts
    ├─→ dispatchLearningSpecialistTool → spiritTools/learningSpecialistTools.ts
    ├─→ dispatchMusicSpecialistTool → spiritTools/musicSpecialistTools.ts
    ├─→ dispatchTrainingSpecialistTool → spiritTools/trainingSpecialistTools.ts
    ├─→ dispatchLegalAdvisorTool → spiritTools/legalAdvisorTools.ts
    ├─→ dispatchSecurityGuardTool → spiritTools/securityGuardTools.ts
    ├─→ dispatchCommunityManagerTool → spiritTools/communityManagerTools.ts
    ├─→ dispatchOnboardingCoachTool → spiritTools/onboardingCoachTools.ts
    ├─→ dispatchPlanExecutorTool → spiritTools/planExecutorTools.ts
    ├─→ dispatchInspirationSpecialistTool → spiritTools/inspirationSpecialistTools.ts
    ├─→ dispatchAnatomySpecialistTool → spiritTools/anatomySpecialistTools.ts
    ├─→ dispatchOrchestratorTool → spiritTools/orchestratorTools.ts
    ├─→ dispatchNotesCuratorTool → spiritTools/notesCuratorTools.ts
    └─→ dispatchSettingsDetailTool → spiritTools/settingsDetailTools.ts
```

### 文件組織

```
healing-studio/
├── server/services/
│   ├── agentToolExecutor.ts (2100+ lines, 主調度器)
│   └── spiritTools/
│       ├── imageSpecialistTools.ts
│       ├── videoSpecialistTools.ts
│       ├── voiceSpecialistTools.ts
│       ├── learningSpecialistTools.ts
│       ├── musicSpecialistTools.ts
│       ├── trainingSpecialistTools.ts
│       ├── legalAdvisorTools.ts
│       ├── securityGuardTools.ts
│       ├── communityManagerTools.ts
│       ├── onboardingCoachTools.ts
│       ├── planExecutorTools.ts
│       ├── inspirationSpecialistTools.ts
│       ├── anatomySpecialistTools.ts
│       ├── orchestratorTools.ts
│       ├── notesCuratorTools.ts
│       └── settingsDetailTools.ts
├── shared/
│   ├── orb-agent-roles.ts (精靈角色定義)
│   ├── agent-skills.ts (技能註冊)
│   ├── orb-specialized-agents.ts (專業精靈能力)
│   └── spirit-handoff-protocol.ts (交棒協定)
└── docs/agent/
    └── 25-spirits-complete-system.md (本文件)
```

## 工具能力矩陣

### 創作生成類精靈工具

#### imageSpecialist (圖圖)
- `imageSpecialist.generate` - 文生圖/圖生圖
- `imageSpecialist.edit` - 圖片編輯
- `imageSpecialist.upscale` - 圖片放大
- `imageSpecialist.getModels` - 獲取可用模型
- `imageSpecialist.getTips` - 獲取使用技巧

#### videoSpecialist (影影)
- `videoSpecialist.generate` - 文生影片
- `videoSpecialist.imageToVideo` - 圖轉影片
- `videoSpecialist.lipSync` - 對嘴動畫
- `videoSpecialist.getModels` - 獲取可用模型
- `videoSpecialist.getTips` - 獲取使用技巧

#### voiceSpecialist (聲聲) — 12 tools, true voice agent
- `voiceSpecialist.generateSpeech` - 語音合成（自動依語言挑引擎、真實 voice_id、支援情緒標籤 / voice_settings）
- `voiceSpecialist.transcribe` - 語音轉文字（含 word-level timestamps + speaker diarization）
- `voiceSpecialist.cloneVoice` - 上傳音檔克隆永久聲線（ElevenLabs IVC，缺 key 退回 Qwen zero-shot）
- `voiceSpecialist.designVoice` - 以文字描述設計虛擬聲線
- `voiceSpecialist.changeVoice` - 聲音變換（換音色保留情緒）
- `voiceSpecialist.generateSfx` - 音效生成
- `voiceSpecialist.getVoices` - 過濾聲線目錄（gender / language / mood）
- `voiceSpecialist.pickVoice` - **agentic**：依 scenario + language + mood 推薦首選 + 替代聲線
- `voiceSpecialist.recommendModel` - **agentic**：推薦最適 TTS 引擎（V3 / Multilingual / Turbo / Flash / Qwen）
- `voiceSpecialist.planVoiceover` - **agentic**：長劇本切段 + 情緒標籤 + 停頓 + 時長估算
- `voiceSpecialist.getEmotionTags` - 列出 V3 支援的情緒 / 表演 / 停頓標籤
- `voiceSpecialist.getTips` - 按情境（meditation / narration / advertisement / podcast …）回訣竅

#### learningSpecialist (學學)
- `learningSpecialist.getTutorial` - 獲取教程
- `learningSpecialist.listTutorials` - 列出所有教程
- `learningSpecialist.getQuickTips` - 獲取快速提示

#### musicSpecialist (音音)
- `musicSpecialist.generate` - 音樂生成
- `musicSpecialist.generateSoundEffect` - 音效生成
- `musicSpecialist.getOptions` - 獲取音樂選項
- `musicSpecialist.getTips` - 獲取使用技巧

#### trainingSpecialist (練練)
- `trainingSpecialist.train` - 訓練模型
- `trainingSpecialist.getStatus` - 獲取訓練狀態
- `trainingSpecialist.getTips` - 獲取訓練技巧

### 支援管理類精靈工具

#### legalAdvisor (法法)
- `legalAdvisor.checkCompliance` - 內容合規檢查
- `legalAdvisor.checkLicense` - 授權檢查
- `legalAdvisor.getGuidelines` - 獲取法律指南

#### securityGuard (守守)
- `securityGuard.checkHealth` - 系統健康檢查
- `securityGuard.scanSecurity` - 安全掃描
- `securityGuard.getRecommendations` - 獲取安全建議
- `securityGuard.reportIssue` - 報告安全問題

#### communityManager (群群)
- `communityManager.buildPostPlan` - 依平台 / 受眾年齡 / 主題 / 素材輸出完整貼文計畫（鉤子→衝突→揭曉→CTA + 規格 + hashtag + 時段）
- `communityManager.nextClarification` - 缺欄位時主動問下一個（platform / audienceAge / theme / assetType / goal）
- `communityManager.recommendHashtags` - 平台 hashtag budget 內的廣/中/窄組合
- `communityManager.planWeeklySchedule` - 跨平台週節奏排程（台灣 timezone 最佳時段）
- `communityManager.critiqueHook` - 鉤子四維評分（attention / specificity / cta / platformFit）+ 改寫示範
- `communityManager.formatCaption` - 依平台慣例重排 caption（IG 段落 / TikTok 短句 / 小紅書條列 / YT 第一行強 hook）
- `communityManager.listPlatforms` - 列出支援平台與元資料

#### onboardingCoach (引引)
- `onboardingCoach.startOnboarding` - 開始引導流程
- `onboardingCoach.trackProgress` - 追蹤進度
- `onboardingCoach.getQuickStart` - 獲取快速上手指南

#### planExecutor (執執)
- `planExecutor.createPlan` - 創建工作流程計畫
- `planExecutor.executeStep` - 執行工作流程步驟
- `planExecutor.getStatus` - 獲取執行狀態
- `planExecutor.getTemplates` - 獲取工作流程模板

#### inspirationSpecialist (靈靈)
- `inspirationSpecialist.searchTrends` - 搜索趨勢
- `inspirationSpecialist.getSuggestions` - 獲取創意建議
- `inspirationSpecialist.analyzeReference` - 分析參考圖
- `inspirationSpecialist.getStyleMixing` - 獲取風格混搭建議

#### anatomySpecialist (解解)
- `anatomySpecialist.analyzeParameters` - 分析參數
- `anatomySpecialist.debugFailure` - 調試失敗
- `anatomySpecialist.compareModels` - 比較模型
- `anatomySpecialist.getTechnicalDocs` - 獲取技術文件

### 核心系統類精靈工具

#### chief-orchestrator (總總)
- `orchestrator.getTeamStatus` - 獲取團隊狀態
- `orchestrator.getSpiritStatus` - 獲取精靈狀態
- `orchestrator.delegateTask` - 委派任務
- `orchestrator.queryProgress` - 查詢進度
- `orchestrator.escalateIssue` - 升級問題
- `orchestrator.getStatistics` - 獲取統計數據

#### notes-curator (記記)
- `notesCurator.createNote` - 創建筆記
- `notesCurator.searchNotes` - 搜索筆記
- `notesCurator.scheduleTask` - 安排任務
- `notesCurator.tagAssets` - 標記資產
- `notesCurator.getAssetStatistics` - 獲取資產統計

#### settings-detail (細細)
- `settingsDetail.getPreferences` - 獲取偏好設定
- `settingsDetail.updatePreference` - 更新偏好設定
- `settingsDetail.explainSetting` - 解釋設定
- `settingsDetail.getAllSettings` - 獲取所有設定
- `settingsDetail.validatePreference` - 驗證偏好設定

## 實施進度

### ✅ 已完成 (Gap 1, 2, 3)

#### PR #609 - 核心基礎設施 (2026-05-11)
- ✅ Spirit Status Monitor (16 精靈狀態追蹤)
- ✅ Orchestrator Tools (總總協調工具 6 個)
- ✅ Handoff Protocol (標準化交棒協定)
- ✅ Cross-Modality Workflows (6 個跨模態工作流模板)
- ✅ Notes-Curator Tools (記記工具 5 個)
- ✅ Settings-Detail Tools (細細工具 5 個)

#### PR #610 - 創作生成精靈 (2026-05-11)
- ✅ Image Specialist Tools (圖圖 5 個)
- ✅ Video Specialist Tools (影影 5 個)
- ✅ Voice Specialist Tools (聲聲 4 個)
- ✅ Learning Specialist Tools (學學 3 個)
- ✅ Music Specialist Tools (音音 4 個)
- ✅ Training Specialist Tools (練練 3 個)

#### This PR - 支援管理精靈 (2026-05-11)
- ✅ Legal Advisor Tools (法法 3 個)
- ✅ Security Guard Tools (守守 4 個)
- ✅ Community Manager Tools (群群 7 個 — 2026-05-15 重寫對齊角色)
- ✅ Onboarding Coach Tools (引引 3 個)
- ✅ Plan Executor Tools (執執 4 個)
- ✅ Inspiration Specialist Tools (靈靈 4 個)
- ✅ Anatomy Specialist Tools (解解 4 個)

**總計：16/16 功能精靈 100% 完成**

### 🟡 待完成項目

1. **前端 UI 整合**
   - 精靈互動面板
   - 工具執行狀態顯示
   - 精靈切換 UI

2. **Agent Skills 註冊**
   - 更新 agent-skills.ts
   - 添加精靈系統提示詞
   - 工具權限配置

3. **測試套件**
   - 單元測試 (60+ 工具方法)
   - 整合測試 (dispatcher 流程)
   - E2E 測試 (用戶場景)

4. **用戶文件**
   - 精靈使用指南
   - 工具能力說明
   - 最佳實踐文檔

## 設計原則

### 1. 一致性模式
所有 dispatcher 函數遵循相同模式：
```typescript
async function dispatchXxxTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { tool1, tool2 } = await import("./spiritTools/xxxTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "xxx.tool1": {
        // 參數驗證
        // 調用工具函數
        // 返回結果
      }
      default:
        return { name: call.name, ok: false, error: `unknown tool` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: String(err) };
  }
}
```

### 2. 錯誤處理
- 完整的 try-catch 包裹
- 類型安全的錯誤訊息
- 使用者友好的錯誤回饋

### 3. 日誌記錄
- 使用結構化 logger
- 記錄關鍵操作
- 用戶 ID 隔離

### 4. 安全性
- 所有查詢用戶範圍
- 參數驗證
- 權限檢查

## 常見問題

### Q: 為什麼有些精靈沒有在 orb-specialized-agents.ts？
A: 只有需要專業生成工具（image/video/audio）的精靈才註冊在該文件。支援類精靈（法法/守守等）走 generic skill 路徑，不需要專業模態工具。

### Q: 如何新增第 17 個精靈？
A: 參考 `docs/15-spirits-architecture.md` 第 8 節的 checklist，需要更新 5-6 個文件。

### Q: 精靈之間如何協作？
A: 通過 `SPIRIT_COLLAB_PROTOCOL` 定義交棒關係，由 `agentCollaborationOrchestrator` 執行。

### Q: 工具調用如何計費？
A: 只有 `GENERATION_SLOT_TOOLS` 集合中的工具消耗每日配額，查詢類工具不計費。

## 參考資料

- [15 精靈架構](./15-spirits-architecture.md) - 原始 15 精靈系統文件
- [Agent 架構深度剖析](./ARCHITECTURE_DEEP_DIVE.md) - 整體架構說明
- [實施狀態](./IMPLEMENTATION_STATUS.md) - 各模組實施進度
- [運營缺口分析](./OPERATIONAL_GAP_ANALYSIS.md) - Gap 1/2/3 分析

## 維護者

- PR #609: anthropic-code-agent[bot] (2026-05-11)
- PR #610: anthropic-code-agent[bot] (2026-05-11)
- This PR: anthropic-code-agent[bot] (2026-05-11)

## 版本歷史

- v3.0 (2026-05-11): 16 功能精靈全部整合完成 ✅
- v2.0 (2026-05-11): 9 個功能精靈 + 3 個核心精靈
- v1.0 (2026-04-xx): 原始 15 精靈系統
