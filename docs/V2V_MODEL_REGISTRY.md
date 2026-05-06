# V2V 模型識別資料庫（Video-to-Video Model Recognition Database）

## 概述

此資料庫讓全站光球代理（Orb Agent）能夠自動分析與理解使用者提示詞，並推薦對應的影片轉影片（V2V）模型。

## 文件結構

```
shared/
├── v2vModelRegistry.ts      # V2V 模型資料庫（SSOT）
├── v2vModelSelection.ts     # Orb 代理整合輔助函式
└── skeletalModelRegistry.ts # 3D/骨骼模型資料庫（已存在）

tests/unit/shared/
└── v2v-model-registry.test.ts # 單元測試
```

## 核心功能

### 1. 模型資料庫（Model Registry）

`v2vModelRegistry.ts` 包含所有 V2V 模型的完整資訊：

- **模型 ID**：Fal.ai 的標準模型識別符
- **標籤**：人類可讀的模型名稱
- **供應商**：目前為 `fal`
- **等級**：`standard`、`premium`、`ultra`
- **優勢**：模型擅長的場景
- **避免使用時機**：不適合的場景
- **提示詞關鍵字**：用於匹配使用者需求的關鍵詞
- **描述**：模型的詳細說明

### 2. 模型分類

V2V 模型按使用場景分為三大類：

#### 風格轉換類（Style Transfer）
- Kling V2.1/V1.6 V2V - 高品質藝術風格轉換
- WAN V2V - 快速風格遷移
- CogVideoX V2V - 開源靈活方案

#### 畫質優化類（Quality Enhancement）
- ByteDance 影片超解析 - AI 超解析度
- RIFE 補幀 - 幀率提升
- Topaz Video Enhance - 商業級品質

#### 進階控制類（Advanced Control）
- AnimateDiff V2V - ControlNet 逐幀控制（骨架/邊緣/深度）

## 使用方式

### 基礎使用（在任何 TypeScript 文件中）

```typescript
import {
  rankV2VModelsByPrompt,
  pickBestV2VModel,
  getV2VModelsByUseCase,
} from "./shared/v2vModelRegistry";

// 1. 根據提示詞排序模型
const prompt = "需要快速風格遷移測試";
const ranked = rankV2VModelsByPrompt(prompt);
console.log(ranked[0]); // { modelId: "fal-ai/wan/v2.1/video-to-video", score: 3, ... }

// 2. 選擇最佳模型
const best = pickBestV2VModel(prompt);
console.log(best.modelId); // "fal-ai/wan/v2.1/video-to-video"

// 3. 按使用場景篩選
const qualityModels = getV2VModelsByUseCase("quality-enhance");
console.log(qualityModels.length); // 3
```

### Orb 代理整合（推薦）

```typescript
import {
  suggestV2VModelForOrb,
  explainV2VModelChoiceForOrb,
  validateV2VModelChoice,
} from "./shared/v2vModelSelection";

// 1. 取得模型推薦（含信心度）
const suggestion = suggestV2VModelForOrb("需要骨架控制的精準動作");
console.log(suggestion);
// {
//   recommendedModelId: "fal-ai/animatediff-v2v",
//   confidence: "high",
//   alternatives: ["fal-ai/kling-video/v2.1/standard/video-to-video", ...],
//   rationale: "命中關鍵詞: 骨架, 精準控制, 動作"
// }

// 2. 生成可讀說明
const explanation = explainV2VModelChoiceForOrb("需要 Topaz 專業級品質");
console.log(explanation);
// "基於您的需求「需要 Topaz 專業級品質」，強烈推薦使用 fal-ai/topaz/video-enhance。
//  原因：命中關鍵詞: topaz, 專業, 品質
//  其他可選模型：fal-ai/bytedance/upscaler/video, ..."

// 3. 驗證模型選擇
const validation = validateV2VModelChoice(
  "fal-ai/wan/v2.1/video-to-video",
  "快速測試"
);
console.log(validation.isValid); // true
```

## 整合到 agentToolExecutor.ts

在 `server/services/agentToolExecutor.ts` 的 `studio.generateVideo` 中整合：

```typescript
// 在 case "studio.generateVideo" 中
import { suggestV2VModelForOrb } from "../../shared/v2vModelSelection";

// 原有邏輯
const hasVideo = typeof args.video_url === "string" && args.video_url;
const category = hasVideo ? "video-to-video" : /* ... */;

if (category === "video-to-video") {
  // 使用 V2V 模型推薦
  const prompt = (args.prompt as string) || "";
  const suggestion = suggestV2VModelForOrb(
    prompt,
    "fal-ai/kling-video/v2.1/standard/video-to-video" // fallback
  );

  // 如果使用者未指定模型，使用推薦模型
  const modelId = (args.modelId as string) || suggestion.recommendedModelId;

  // 記錄推薦原因（可選）
  if (!args.modelId && suggestion.confidence === "high") {
    logger.info("V2V model auto-selected", {
      modelId: suggestion.recommendedModelId,
      rationale: suggestion.rationale,
    });
  }
}
```

## 支援的關鍵詞

### 風格轉換
- 中文：風格化、藝術風格、高品質、精細、快速、風格遷移、測試、預覽
- 英文：style transfer, quick, fast, kling, wan, cogvideo

### 畫質優化
- 中文：超解析、放大、畫質提升、增強、補幀、幀率、流暢、慢動作、專業、商業級、最高品質
- 英文：upscale, enhance, 4k, frame interpolation, fps, slow motion, topaz, professional, commercial

### 進階控制
- 中文：骨架、姿態、邊緣、深度、精準控制、動作
- 英文：controlnet, pose, skeleton, edge, depth

## 測試

執行單元測試以驗證功能：

```bash
npm test -- v2v-model-registry.test.ts
```

測試涵蓋：
- 模型資料完整性檢查
- 關鍵詞匹配與排序
- 各類使用場景推薦
- 回退機制
- 中英文混合關鍵詞支援

## 擴展

### 新增模型

在 `v2vModelRegistry.ts` 的 `V2V_MODEL_REGISTRY` 陣列中新增：

```typescript
{
  modelId: "fal-ai/new-model-v2v",
  label: "New Model V2V",
  provider: "fal",
  tier: "premium",
  strengths: ["特性1", "特性2"],
  avoidWhen: ["不適合場景"],
  promptKeywords: ["keyword1", "關鍵詞2"],
  description: "模型描述",
}
```

### 新增關鍵詞

修改現有模型的 `promptKeywords` 陣列即可。

### 調整推薦邏輯

在 `v2vModelSelection.ts` 的 `suggestV2VModelForOrb` 函式中調整信心度門檻。

## 與其他模型資料庫的關係

- **skeletalModelRegistry.ts**：3D/骨骼模型（已存在）
- **v2vModelRegistry.ts**：影片轉影片模型（本次新增）
- **未來可擴展**：
  - `i2vModelRegistry.ts` - 圖片轉影片模型
  - `t2vModelRegistry.ts` - 文字轉影片模型
  - `audioModelRegistry.ts` - 音訊模型

所有模型資料庫遵循相同的設計模式，方便 Orb 代理統一使用。

## 相關檔案

- `server/_core/modelRegistry.ts` - 全站模型註冊中心（含推理、生成、Fal 任務引擎）
- `server/services/falModels.ts` - Fal.ai 模型目錄與 schema
- `shared/videoModelCatalog.ts` - 影片創作室 canonical model id SSOT
- `server/services/orbModelCatalog.ts` - Orb 圖片編輯模型目錄

## 維護

當新增或移除 V2V 模型時，需同步更新：
1. `shared/v2vModelRegistry.ts` - 模型資料庫
2. `server/services/falModels.ts` - 註冊 catalog (schema/timeout)
3. `server/services/modelPricing.ts` - 註冊定價
4. `server/_core/modelRegistry.ts` - GENERATION_ENGINE_CATALOG.videoEngine

一致性會由 `server/services/__tests__/videoCatalogConsistency.test.ts` 守護。

## 授權

此資料庫遵循專案整體授權協議。
