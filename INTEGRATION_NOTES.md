# Director AI Deep Integration - Script to Generation Pipeline

## 概述 Overview

本次整合實現了導演 AI 從腳本自動分配到生成式 AI 模型的深度整合功能。

This integration implements deep integration of Director AI from automatic script allocation to generative AI models.

## 實現的功能 Implemented Features

### 1. 服務端 API (Server-side APIs)

**檔案**: `server/routers/director.ts`

新增了兩個關鍵端點:

#### `autoGenerateFromSegments`
- 規劃批次生成任務
- 根據用戶 AI 大腦配置自動選擇模型
- 計算所需積分並驗證用戶餘額
- 支援圖像、影片、音樂、語音四種模態
- 支援依賴關係追蹤（如圖生視頻）

功能:
- 從腳本分段提取視覺描述、對白、音樂風格
- 解析時長參數
- 自動匹配對應的 AI 模型
- 返回任務列表和積分估算

#### `executeGenerationTask`
- 執行單個生成任務
- 扣除積分並創建背景任務
- 調用 fal.ai 模型 (queue 模式)
- 錯誤處理和積分退款機制

### 2. 前端 UI (Frontend UI)

**檔案**: `client/src/pages/DirectorAI.tsx`, `client/src/pages/DirectorAI_batch_dialog.tsx`

新增功能:

#### 狀態管理
- `showBatchGeneration`: 控制批次生成對話框
- `batchGenerationOptions`: 生成選項配置
- `generationTasks`: 追蹤生成任務狀態

#### UI 組件
- 「批次生成」按鈕 in script header toolbar
- `BatchGenerationDialog` 對話框組件
  - 模態選擇（圖像、影片、音樂、語音）
  - 各模態參數設定
  - 生成模式選擇（閃電/深度精準）
  - 任務統計摘要

#### tRPC Hooks
- `autoGenerateMut`: 規劃批次生成
- `executeTaskMut`: 執行生成任務

## 工作流程 Workflow

```
1. 用戶匯入腳本 → 分段分析
2. 點擊「批次生成」按鈕
3. 在對話框中選擇:
   - 要生成的模態類型
   - 各模態的參數
   - 生成模式
4. 點擊「開始批次生成」
5. 系統規劃任務並計算積分
6. 執行任務，創建背景任務
7. 用戶可在背景任務抽屜中追蹤進度
```

## 技術架構 Technical Architecture

### 模型選擇策略
- 基於用戶的 `userAiBrain` 配置
- 使用 `resolveFalEnginesFromRow()` 獲取配置
- 支援模型 ID 正規化 (`normalizeEngineModelId`)

### 時長解析
- 從分鏡板 `duration` 欄位提取
- 支援格式: "X分Y秒", "X秒", "X"
- 默認值: 5 秒

### 依賴處理
- 圖生視頻需要先生成圖像
- `dependsOn` 欄位追蹤依賴關係
- 前端需要按順序執行有依賴的任務

### 積分系統
- 使用 `estimatePoints()` 計算
- 支援時長、字數等參數
- 失敗時自動退款

## 整合待辦 Integration TODO

### 需要在 DirectorAI.tsx 中完成的整合:

1. **匯入 BatchGenerationDialog 組件**
   ```typescript
   // 將 DirectorAI_batch_dialog.tsx 的內容整合到 DirectorAI.tsx
   // 或者 import { BatchGenerationDialog } from './DirectorAI_batch_dialog';
   ```

2. **添加批次生成處理函數**
   ```typescript
   const handleStartBatchGeneration = useCallback(async () => {
     // 1. 呼叫 autoGenerateMut 規劃任務
     const result = await autoGenerateMut.mutateAsync({
       segments: importedSegments,
       generationOptions: batchGenerationOptions,
     });

     // 2. 依序執行任務
     for (const task of result.tasks) {
       // 如果有依賴，等待依賴完成
       if (task.dependsOn) {
         // 查找依賴任務的結果 URL
         const depTask = generationTasks.find(
           t => t.segmentId === task.dependsOn.segmentId &&
                t.modality === task.dependsOn.modality
         );
         // 等待依賴完成並獲取 resultUrl
       }

       await executeTaskMut.mutateAsync({
         segmentId: task.segmentId,
         segmentIndex: task.segmentIndex,
         modality: task.modality,
         modelId: task.modelId,
         prompt: segments[task.segmentIndex].costar?.visualPrompt || '',
         params: {},
         mode: batchGenerationOptions.mode,
         firstFrameUrl: /* 如果是視頻且有依賴 */,
       });
     }

     setShowBatchGeneration(false);
     toast.success('批次生成已開始');
   }, [importedSegments, batchGenerationOptions, autoGenerateMut, executeTaskMut]);
   ```

3. **在組件 render 中添加對話框**
   ```tsx
   {/* 在主組件 return 的最後添加 */}
   <BatchGenerationDialog
     open={showBatchGeneration}
     onClose={() => setShowBatchGeneration(false)}
     segments={importedSegments}
     options={batchGenerationOptions}
     onOptionsChange={setBatchGenerationOptions}
     onStartGeneration={handleStartBatchGeneration}
     isPending={autoGenerateMut.isPending || executeTaskMut.isPending}
   />
   ```

## 測試檢查清單 Testing Checklist

- [ ] 匯入腳本並生成 CO-STAR
- [ ] 點擊「批次生成」按鈕
- [ ] 在對話框中選擇多個模態
- [ ] 調整參數（長寬比、是否純音樂等）
- [ ] 確認任務統計正確
- [ ] 開始生成並檢查積分扣除
- [ ] 在背景任務抽屜中查看進度
- [ ] 確認依賴任務（圖生視頻）正確執行
- [ ] 測試錯誤處理和積分退款

## 檔案清單 File List

### 新增/修改的檔案:
- `server/routers/director.ts` (+408 lines)
- `client/src/pages/DirectorAI.tsx` (修改: 狀態、hooks、按鈕)
- `client/src/pages/DirectorAI_batch_dialog.tsx` (新增: 對話框組件)
- `INTEGRATION_NOTES.md` (本檔案)

## 後續優化 Future Enhancements

1. **進度追蹤增強**
   - 實時顯示各任務進度
   - 整合 `generationBus` SSE 事件
   - 在對話框中顯示實時進度條

2. **批次執行策略**
   - 支援平行執行獨立任務
   - 智能排程依賴任務
   - 失敗重試機制

3. **結果管理**
   - 生成結果自動關聯到對應分鏡
   - 支援預覽和編輯
   - 匯出包含生成結果的完整項目

4. **模型推薦**
   - 根據分鏡內容自動推薦最適合的模型
   - 情緒分析匹配模型風格
   - 成本/品質權衡建議

## 架構決策記錄 Architecture Decision Record

### ADR-001: 使用 tRPC mutations 而非 WebSocket
**決定**: 使用 tRPC mutations + 背景任務輪詢

**原因**:
- 現有架構已使用 tRPC
- 背景任務系統已有輪詢機制
- 降低複雜度
- SSE 事件可用於實時進度（未來增強）

### ADR-002: 批次生成採用兩步驟流程
**決定**: 分為規劃 (plan) 和執行 (execute) 兩個端點

**原因**:
- 允許用戶在執行前確認積分消耗
- 支援更靈活的任務排程策略
- 便於錯誤處理和重試
- 前端可以控制執行節奏

### ADR-003: 依賴關係由前端管理
**決定**: 服務端返回依賴信息，前端負責執行順序

**原因**:
- 服務端無狀態更簡單
- 前端可以實現更複雜的排程邏輯
- 便於實現進度追蹤 UI
- 降低服務端複雜度
