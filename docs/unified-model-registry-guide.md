# 全站光球代理統一模型資訊資料庫

## 概述

本資料庫整合了全站所有 AI 模型的資訊，提供統一的查詢介面，讓光球代理（Orb Agent）能夠根據使用者的提示詞自動分析並選擇最適合的模型。

## 涵蓋的模型領域

目前資料庫包含以下四個領域的模型：

1. **影像畫質優化 (image-upscale)** - 畫質提升、放大、細節修復
2. **文字生成影像 (text-to-image)** - 根據文字描述生成圖片
3. **影像生成 3D 模型 (image-to-3d)** - 將圖片轉換為 3D 物件
4. **影像生成 3D 世界 (image-to-world)** - 生成 3D 場景與環境

## 使用方式

### 1. 智慧推薦模型（最簡單）

最適合 Orb 代理直接使用的 API，會自動推斷領域並返回最佳模型：

```typescript
import { recommendModels } from "@/shared/unifiedModelRegistry";

// 根據使用者提示詞推薦最佳模型（最多返回 3 個）
const recommendations = recommendModels("請將這張照片增強到 4K 畫質");

// 查看推薦結果
recommendations.forEach(match => {
  console.log(`模型: ${match.modelId}`);
  console.log(`領域: ${match.domain}`);
  console.log(`匹配分數: ${match.score}`);
  console.log(`匹配關鍵詞: ${match.matchedKeywords.join(", ")}`);
  console.log(`理由: ${match.rationale}`);
});
```

### 2. 生成推薦說明文字

為使用者生成可讀的模型推薦說明：

```typescript
import { recommendModels, generateModelRecommendationText } from "@/shared/unifiedModelRegistry";

const recommendations = recommendModels("生成一張寫實的產品照片");
const explanationText = generateModelRecommendationText(recommendations);

// 可直接顯示給使用者或注入到 Orb 的回應中
console.log(explanationText);
// 輸出範例：
// 🥇 最推薦: FLUX Pro 1.1 (fal-ai/flux-pro/v1.1)
//    領域: text-to-image
//    優勢: 寫實、高細節、商業視覺、文字排版穩定
//    命中關鍵詞: photoreal, product shot
//    命中關鍵詞: photoreal, product shot
```

### 3. 按領域查詢模型

如果已經知道需要哪個領域的模型：

```typescript
import { pickBestModelForDomain } from "@/shared/unifiedModelRegistry";

// 為特定領域選擇最佳模型
const bestUpscaleModel = pickBestModelForDomain(
  "image-upscale",
  "請提升照片畫質到 4K 解析度"
);

console.log(`最佳模型: ${bestUpscaleModel.modelId}`);
```

### 4. 高級查詢

使用更多選項進行細緻查詢：

```typescript
import { queryModelsByPrompt } from "@/shared/unifiedModelRegistry";

// 只查詢文字生圖和影像放大模型，最少匹配 1 個關鍵詞，最多返回 5 個結果
const results = queryModelsByPrompt("快速生成高品質圖片", {
  domains: ["text-to-image", "image-upscale"],
  minScore: 1,
  limit: 5,
});
```

### 5. 推斷使用者意圖

自動推斷使用者可能需要的模型領域：

```typescript
import { inferDomainFromPrompt } from "@/shared/unifiedModelRegistry";

const domains = inferDomainFromPrompt("將這張圖轉成 3D 模型並提升到 4K");
// 返回: ["image-to-3d", "image-upscale"]
```

### 6. 取得模型詳細資訊

查詢特定模型的完整資訊：

```typescript
import { getModelById, getModelsByDomain } from "@/shared/unifiedModelRegistry";

// 根據 ID 取得模型
const model = getModelById("fal-ai/seedvr/upscale/image");
console.log(model?.strengths); // ["真實照片", "高品質放大", "細節修復", "支援目標解析度"]

// 取得某個領域的所有模型
const allTextToImageModels = getModelsByDomain("text-to-image");
console.log(`文字生圖模型數量: ${allTextToImageModels.length}`);
```

### 7. 取得統計資訊

了解資料庫的整體狀況：

```typescript
import { getModelRegistryStats, generateModelRegistrySummary } from "@/shared/unifiedModelRegistry";

// 取得統計數據
const stats = getModelRegistryStats();
console.log(`總模型數: ${stats.total}`);
console.log(`影像放大模型: ${stats.byDomain["image-upscale"]} 個`);
console.log(`提供者: ${Object.keys(stats.byProvider).join(", ")}`);

// 生成完整摘要（適合注入到 System Prompt）
const summary = generateModelRegistrySummary();
console.log(summary);
```

## 在 Orb 代理中使用

### System Prompt 注入

在 Orb 的 system prompt 中加入模型資訊：

```typescript
import { generateModelRegistrySummary } from "@/shared/unifiedModelRegistry";

const systemPrompt = `
你是全站光球代理，可以幫助使用者選擇最適合的 AI 模型。

${generateModelRegistrySummary()}

當使用者提出需求時，使用 recommendModels() 函式來查詢最適合的模型，
並使用 generateModelRecommendationText() 來生成說明文字。
`;
```

### 處理使用者請求

```typescript
import { recommendModels, generateModelRecommendationText } from "@/shared/unifiedModelRegistry";

async function handleUserRequest(userPrompt: string) {
  // 1. 推薦模型
  const recommendations = recommendModels(userPrompt, 3);

  // 2. 生成說明
  const explanation = generateModelRecommendationText(recommendations);

  // 3. 選擇最佳模型
  const bestModel = recommendations[0];

  if (bestModel) {
    // 4. 回應使用者
    return {
      modelId: bestModel.modelId,
      explanation,
      // ... 其他資訊
    };
  }
}
```

## 資料結構

### UnifiedModelProfile

統一的模型描述格式：

```typescript
interface UnifiedModelProfile {
  modelId: string;           // 模型唯一識別碼
  label: string;             // 顯示名稱
  provider: string;          // 提供者（如 "fal"）
  domain: ModelDomain;       // 模型領域
  category?: string;         // 類別（可選）
  strengths: string[];       // 模型優勢
  avoidWhen: string[];       // 不適用情境
  promptKeywords: string[];  // 提示詞關鍵字
  tier?: string;             // 層級（可選）
}
```

### UnifiedModelMatch

查詢結果的匹配資訊：

```typescript
interface UnifiedModelMatch {
  modelId: string;              // 模型 ID
  domain: ModelDomain;          // 領域
  score: number;                // 匹配分數（關鍵詞命中數量）
  matchedKeywords: string[];    // 命中的關鍵詞
  rationale: string;            // 推薦理由
}
```

## 擴展資料庫

如需新增更多模型領域，請：

1. 在 `shared/` 目錄下建立新的註冊表檔案（如 `videoModelRegistry.ts`）
2. 在 `unifiedModelRegistry.ts` 中匯入並整合
3. 更新 `ModelDomain` 類型
4. 在 `queryModelsByPrompt()` 中加入新領域的查詢邏輯
5. 更新 `inferDomainFromPrompt()` 以支援新領域的關鍵字推斷

## 測試

執行測試以確保資料庫正常運作：

```bash
npm test tests/unit/shared/unified-model-registry.test.ts
```

## 注意事項

1. **匹配分數**: 分數基於關鍵詞命中數量，分數越高表示匹配度越好
2. **預設模型**: 當沒有關鍵詞命中時，會回退到各領域的預設模型
3. **多領域支援**: 同一個提示詞可能匹配多個領域的模型
4. **效能考量**: 所有查詢都是記憶體內操作，效能極佳

## 相關檔案

- `shared/unifiedModelRegistry.ts` - 統一模型資料庫（主檔案）
- `shared/imageUpscaleModelRegistry.ts` - 影像放大模型註冊表
- `shared/textToImageModelRegistry.ts` - 文字生圖模型註冊表
- `shared/skeletalModelRegistry.ts` - 3D 模型註冊表
- `tests/unit/shared/unified-model-registry.test.ts` - 測試檔案
