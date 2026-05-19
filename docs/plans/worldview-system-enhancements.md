# 世界觀系統增強計畫

## 概述

本計畫旨在為世界觀系統（Animation Studio）添加三大核心功能：

1. **AI 代理系統融入**：與全站光球代理系統一致，但專門服務世界觀系統
2. **時間軸圖幀上傳與一致性檢查系統**：與腳本分鏡同步
3. **多角色多場景多素材畫面協助系統**：輔助複雜場景構圖

## 1. AI 代理系統融入

### 1.1 目標
- 整合 PageAgentContext 到 AnimationStudio
- 實現專用於世界觀系統的 AI 代理能力
- 支援生成角色、場景、分鏡等功能

### 1.2 技術實現

#### 1.2.1 添加 useRegisterPageAgent 到 AnimationStudio.tsx

```typescript
// 在 AnimationStudio.tsx 中添加
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";

export default function AnimationStudio() {
  // ... 現有代碼 ...

  // 註冊頁面代理能力
  useRegisterPageAgent({
    pageId: "animation-studio",
    capabilities: {
      canSetTab: true,
      canFillPrompt: true,
      canSubmit: true,
      canSetParam: true,
      canOpenDialog: true,
      canSearch: true,
      // 自定義能力
      canGenerateCharacter: true,
      canGenerateScene: true,
      canSeedStoryboard: true,
      canUploadFrame: true,
      canCheckConsistency: true,
    },
    handler: async (action) => {
      // 處理各種 action
      switch (action.type) {
        case "setTab":
          // 切換分頁
          setSelectedTab(action.tabId);
          return { success: true };

        case "generateCharacter":
          // 生成角色
          return await handleGenerateCharacter(action);

        case "generateScene":
          // 生成場景
          return await handleGenerateScene(action);

        case "seedStoryboard":
          // 生成分鏡骨架
          return await handleSeedStoryboard(action);

        default:
          return { success: false, error: "Unknown action" };
      }
    },
    getSnapshot: () => ({
      pageId: "animation-studio",
      path: "/animation",
      selectedWorldId,
      selectedTab,
      characters: effectiveWorld?.characters ?? [],
      scenes: effectiveWorld?.scenes ?? [],
      storyboards: storyboardsQuery.data ?? [],
    }),
  });
}
```

#### 1.2.2 擴展 AgentAction 類型

在 `shared/agent-actions.ts` 中添加新的動作類型：

```typescript
/** 生成角色 */
export interface GenerateCharacterAction {
  type: "generateCharacter";
  /** 角色描述 */
  description: string;
  /** 角色類型 */
  role: "protagonist" | "supporting" | "antagonist" | "npc";
  /** 是否生成三視圖 */
  generateThreeView?: boolean;
  /** 是否生成表情包 */
  generateExpressions?: boolean;
}

/** 生成場景 */
export interface GenerateSceneAction {
  type: "generateScene";
  /** 場景描述 */
  description: string;
  /** 環境類型 */
  environmentType?: string;
  /** 時間 */
  timeOfDay?: string;
  /** 天氣 */
  weather?: string;
}

/** 生成分鏡骨架 */
export interface SeedStoryboardAction {
  type: "seedStoryboard";
  /** 世界觀 ID */
  worldId: number;
  /** 總時長（秒） */
  totalDurationSec: number;
  /** 場景數量 */
  sceneCount: number;
  /** 分鏡名稱 */
  name?: string;
}

/** 上傳時間軸圖幀 */
export interface UploadTimelineFrameAction {
  type: "uploadTimelineFrame";
  /** 分鏡 ID */
  storyboardId: number;
  /** 場景索引 */
  sceneIndex: number;
  /** 圖片 URL 或 base64 */
  imageData: string;
  /** 時間戳（秒） */
  timestamp: number;
}

/** 檢查一致性 */
export interface CheckConsistencyAction {
  type: "checkConsistency";
  /** 檢查類型 */
  checkType: "character" | "scene" | "style" | "all";
  /** 目標 ID（角色或場景） */
  targetId?: string;
}
```

#### 1.2.3 更新 appRegistry.ts

在 `shared/appRegistry.ts` 中更新 animation-studio 的 supportedActions：

```typescript
{
  id: "animation-studio",
  // ... 其他配置 ...
  supportedActions: [
    "setTab",
    "fillPrompt",
    "setParam",
    "submit",
    "openDialog",
    "search",
    // 新增的世界觀專用動作
    "generateCharacter",
    "generateScene",
    "seedStoryboard",
    "uploadTimelineFrame",
    "checkConsistency",
  ],
}
```

### 1.3 AI 生成能力實現

#### 1.3.1 創建生成服務

創建 `server/services/worldbuildingGeneration.ts`：

```typescript
/**
 * worldbuildingGeneration.ts — 世界觀 AI 生成服務
 *
 * 提供角色、場景、分鏡的 AI 輔助生成功能
 */

import { getLLMCompletion } from "./llm";
import type { WorldCharacter, WorldScene } from "../../shared/worldbuilding-types";

/**
 * 基於描述生成角色結構
 */
export async function generateCharacterFromDescription(
  description: string,
  role: "protagonist" | "supporting" | "antagonist" | "npc"
): Promise<Partial<WorldCharacter>> {
  const prompt = `Based on this description, generate a detailed character profile:
Description: ${description}
Role: ${role}

Please provide:
1. Name (適合的中文或英文名字)
2. Tagline (一句話描述)
3. Appearance (外貌描述：髮型、瞳色、身高、特徵)
4. Personality (個性：性格、行為模式)
5. Backstory (背景故事)
6. Likes (3-5個喜好)
7. Interests (3-5個興趣)
8. Signature Items (3-5個隨身物件)

Return as JSON format.`;

  const response = await getLLMCompletion({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.8,
  });

  // 解析 LLM 回應並轉換為角色結構
  const parsed = JSON.parse(response.content);

  return {
    name: parsed.name,
    role,
    tagline: parsed.tagline,
    appearance: parsed.appearance,
    personality: parsed.personality,
    backstory: parsed.backstory,
    likes: parsed.likes,
    interests: parsed.interests,
    signatureItems: parsed.signatureItems,
  };
}

/**
 * 基於描述生成場景結構
 */
export async function generateSceneFromDescription(
  description: string,
  options?: {
    environmentType?: string;
    timeOfDay?: string;
    weather?: string;
  }
): Promise<Partial<WorldScene>> {
  const prompt = `Based on this description, generate a detailed scene profile:
Description: ${description}
${options?.environmentType ? `Environment Type: ${options.environmentType}` : ""}
${options?.timeOfDay ? `Time of Day: ${options.timeOfDay}` : ""}
${options?.weather ? `Weather: ${options.weather}` : ""}

Please provide:
1. Name (場景名稱)
2. Tagline (一句話氛圍)
3. Environment (環境描述：地點、季節、天氣、時間)
4. Lighting (光線描述)
5. Mood (氛圍)
6. Flora (花草樹木列表)
7. Fauna (動物列表)
8. Props (物件道具列表)
9. Environment Changes (環境變化列表)

Return as JSON format.`;

  const response = await getLLMCompletion({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.8,
  });

  const parsed = JSON.parse(response.content);

  return {
    name: parsed.name,
    tagline: parsed.tagline,
    environment: parsed.environment,
    lighting: parsed.lighting,
    mood: parsed.mood,
    flora: parsed.flora,
    fauna: parsed.fauna,
    props: parsed.props,
    environmentChanges: parsed.environmentChanges,
  };
}
```

#### 1.3.2 添加 TRPC 路由

在 `server/routers/worldbuilding.ts` 中添加生成端點：

```typescript
// 添加新的 mutation
generateCharacter: protectedProcedure
  .input(z.object({
    description: z.string(),
    role: z.enum(["protagonist", "supporting", "antagonist", "npc"]),
    generateThreeView: z.boolean().optional(),
    generateExpressions: z.boolean().optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    const character = await generateCharacterFromDescription(
      input.description,
      input.role
    );

    // 如果需要，生成三視圖
    if (input.generateThreeView) {
      // 調用圖像生成服務
    }

    return character;
  }),

generateScene: protectedProcedure
  .input(z.object({
    description: z.string(),
    environmentType: z.string().optional(),
    timeOfDay: z.string().optional(),
    weather: z.string().optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    const scene = await generateSceneFromDescription(
      input.description,
      {
        environmentType: input.environmentType,
        timeOfDay: input.timeOfDay,
        weather: input.weather,
      }
    );

    return scene;
  }),
```

## 2. 時間軸圖幀上傳與一致性檢查系統

### 2.1 目標
- 允許用戶上傳圖幀到分鏡時間軸的特定位置
- 自動檢查上傳圖幀與角色/場景設定的一致性
- 提供視覺化的一致性報告

### 2.2 數據結構擴展

在 `shared/worldbuilding-animation.ts` 中添加：

```typescript
/** 時間軸圖幀 */
export interface TimelineFrame {
  id: string;
  /** 分鏡 ID */
  storyboardId: number;
  /** 場景索引 */
  sceneIndex: number;
  /** 時間戳（秒） */
  timestamp: number;
  /** 圖片 URL */
  imageUrl: string;
  /** 圖片 key（用於刪除） */
  imageKey: string;
  /** 上傳時間 */
  uploadedAt: Date;
  /** 一致性檢查結果 */
  consistencyCheck?: ConsistencyCheckResult;
}

/** 一致性檢查結果 */
export interface ConsistencyCheckResult {
  /** 檢查時間 */
  checkedAt: Date;
  /** 整體分數 (0-100) */
  overallScore: number;
  /** 角色一致性 */
  characterConsistency: {
    characterId: string;
    score: number;
    issues: string[];
  }[];
  /** 場景一致性 */
  sceneConsistency: {
    score: number;
    issues: string[];
  };
  /** 風格一致性 */
  styleConsistency: {
    score: number;
    issues: string[];
  };
  /** 建議 */
  recommendations: string[];
}
```

### 2.3 UI 組件

#### 2.3.1 StoryboardTimelineUploader 組件

創建 `client/src/components/animation/StoryboardTimelineUploader.tsx`：

```typescript
/**
 * StoryboardTimelineUploader — 分鏡時間軸圖幀上傳器
 *
 * 功能：
 * - 拖放或點擊上傳圖片到時間軸
 * - 顯示已上傳的圖幀縮圖
 * - 顯示一致性檢查結果
 */

interface StoryboardTimelineUploaderProps {
  storyboard: WorldStoryboard;
  frames: TimelineFrame[];
  onUpload: (sceneIndex: number, timestamp: number, file: File) => Promise<void>;
  onDelete: (frameId: string) => Promise<void>;
  onCheckConsistency: (frameId: string) => Promise<void>;
}

export function StoryboardTimelineUploader({
  storyboard,
  frames,
  onUpload,
  onDelete,
  onCheckConsistency,
}: StoryboardTimelineUploaderProps) {
  // 時間軸視覺化
  // 圖幀上傳區
  // 一致性檢查按鈕
  // 結果顯示

  return (
    <div className="space-y-4">
      {/* 時間軸 */}
      <div className="relative h-32 border rounded-lg bg-card/30">
        {/* 時間刻度 */}
        {/* 場景分隔線 */}
        {/* 已上傳圖幀標記 */}
      </div>

      {/* 上傳區 */}
      <div className="border-2 border-dashed rounded-lg p-6 text-center">
        <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p>拖放圖片或點擊上傳</p>
      </div>

      {/* 圖幀列表 */}
      <div className="grid grid-cols-4 gap-4">
        {frames.map(frame => (
          <FrameCard
            key={frame.id}
            frame={frame}
            onDelete={() => onDelete(frame.id)}
            onCheck={() => onCheckConsistency(frame.id)}
          />
        ))}
      </div>
    </div>
  );
}
```

#### 2.3.2 ConsistencyCheckPanel 組件

創建 `client/src/components/animation/ConsistencyCheckPanel.tsx`：

```typescript
/**
 * ConsistencyCheckPanel — 一致性檢查面板
 *
 * 顯示圖幀的一致性檢查結果
 */

interface ConsistencyCheckPanelProps {
  result: ConsistencyCheckResult;
}

export function ConsistencyCheckPanel({ result }: ConsistencyCheckPanelProps) {
  return (
    <div className="space-y-4">
      {/* 整體分數 */}
      <div className="flex items-center gap-4">
        <div className="text-3xl font-bold">{result.overallScore}</div>
        <div>
          <div className="font-medium">整體一致性</div>
          <div className="text-sm text-muted-foreground">
            {result.overallScore >= 80 ? "優秀" :
             result.overallScore >= 60 ? "良好" :
             result.overallScore >= 40 ? "需改進" : "不一致"}
          </div>
        </div>
      </div>

      {/* 角色一致性 */}
      <div>
        <h4 className="font-medium mb-2">角色一致性</h4>
        {result.characterConsistency.map(cc => (
          <div key={cc.characterId} className="mb-2">
            <div className="flex items-center justify-between">
              <span>{cc.characterId}</span>
              <span>{cc.score}/100</span>
            </div>
            {cc.issues.length > 0 && (
              <ul className="text-sm text-muted-foreground mt-1">
                {cc.issues.map((issue, i) => (
                  <li key={i}>• {issue}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* 場景一致性 */}
      {/* 風格一致性 */}
      {/* 建議 */}
    </div>
  );
}
```

### 2.4 一致性檢查算法

創建 `server/services/consistencyChecker.ts`：

```typescript
/**
 * consistencyChecker.ts — 一致性檢查服務
 *
 * 使用 Vision API 檢查上傳圖幀與世界觀設定的一致性
 */

import { analyzeImage } from "./visionAPI";
import type { WorldCharacter, WorldScene } from "../../shared/worldbuilding-types";
import type { ConsistencyCheckResult } from "../../shared/worldbuilding-animation";

/**
 * 檢查圖幀一致性
 */
export async function checkFrameConsistency(
  imageUrl: string,
  characters: WorldCharacter[],
  scene: WorldScene,
  styleProfile?: WorldStyleProfile
): Promise<ConsistencyCheckResult> {
  // 使用 Vision API 分析圖片
  const analysis = await analyzeImage(imageUrl);

  // 檢查角色一致性
  const characterConsistency = characters.map(char => {
    const issues: string[] = [];
    let score = 100;

    // 檢查外貌特徵
    if (char.appearance && !matchesAppearance(analysis, char.appearance)) {
      issues.push("外貌特徵不符");
      score -= 20;
    }

    // 檢查服裝
    if (char.outfit && !matchesOutfit(analysis, char.outfit)) {
      issues.push("服裝不一致");
      score -= 15;
    }

    return {
      characterId: char.id,
      score: Math.max(0, score),
      issues,
    };
  });

  // 檢查場景一致性
  const sceneIssues: string[] = [];
  let sceneScore = 100;

  if (scene.environment && !matchesEnvironment(analysis, scene.environment)) {
    sceneIssues.push("環境設定不符");
    sceneScore -= 20;
  }

  if (scene.lighting && !matchesLighting(analysis, scene.lighting)) {
    sceneIssues.push("光線不一致");
    sceneScore -= 15;
  }

  // 檢查風格一致性
  let styleScore = 100;
  const styleIssues: string[] = [];
  // ... 風格檢查邏輯 ...

  // 計算整體分數
  const overallScore = Math.round(
    (characterConsistency.reduce((sum, c) => sum + c.score, 0) / characters.length +
     sceneScore +
     styleScore) / 3
  );

  return {
    checkedAt: new Date(),
    overallScore,
    characterConsistency,
    sceneConsistency: {
      score: sceneScore,
      issues: sceneIssues,
    },
    styleConsistency: {
      score: styleScore,
      issues: styleIssues,
    },
    recommendations: generateRecommendations(overallScore, characterConsistency, sceneIssues),
  };
}
```

## 3. 多角色多場景多素材畫面協助系統

### 3.1 目標
- 提供拖放式場景構圖工具
- 支援多個角色同時出現在一個場景中
- 自動生成角色位置建議
- 支援素材庫集成

### 3.2 UI 組件

#### 3.2.1 CompositionAssistant 組件

創建 `client/src/components/animation/CompositionAssistant.tsx`：

```typescript
/**
 * CompositionAssistant — 畫面構圖協助工具
 *
 * 功能：
 * - 拖放角色到場景中
 * - 調整角色位置、大小、層級
 * - 添加素材（道具、特效）
 * - 生成構圖建議
 */

interface CompositionAssistantProps {
  scene: WorldScene;
  characters: WorldCharacter[];
  assets: Asset[];
  onSave: (composition: SceneComposition) => void;
}

export function CompositionAssistant({
  scene,
  characters,
  assets,
  onSave,
}: CompositionAssistantProps) {
  const [composition, setComposition] = useState<SceneComposition>({
    sceneId: scene.id,
    elements: [],
  });

  return (
    <div className="grid grid-cols-[1fr,300px] gap-4 h-[600px]">
      {/* 左側：畫布 */}
      <div className="border rounded-lg relative bg-card/30 overflow-hidden">
        <Canvas
          scene={scene}
          composition={composition}
          onUpdate={setComposition}
        />
      </div>

      {/* 右側：工具面板 */}
      <div className="space-y-4">
        {/* 角色列表 */}
        <div>
          <h4 className="font-medium mb-2">角色</h4>
          <div className="space-y-2">
            {characters.map(char => (
              <CharacterDragItem
                key={char.id}
                character={char}
                onDragStart={() => {}}
              />
            ))}
          </div>
        </div>

        {/* 素材列表 */}
        <div>
          <h4 className="font-medium mb-2">素材</h4>
          <div className="grid grid-cols-2 gap-2">
            {assets.map(asset => (
              <AssetDragItem
                key={asset.id}
                asset={asset}
                onDragStart={() => {}}
              />
            ))}
          </div>
        </div>

        {/* 構圖建議 */}
        <Button
          onClick={() => generateCompositionSuggestion()}
          variant="outline"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          AI 構圖建議
        </Button>

        {/* 儲存 */}
        <Button onClick={() => onSave(composition)}>
          儲存構圖
        </Button>
      </div>
    </div>
  );
}
```

#### 3.2.2 Canvas 組件

```typescript
/**
 * Canvas — 可互動的構圖畫布
 */

interface CanvasProps {
  scene: WorldScene;
  composition: SceneComposition;
  onUpdate: (composition: SceneComposition) => void;
}

function Canvas({ scene, composition, onUpdate }: CanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  // 拖放處理
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData("application/json"));

    // 計算相對位置
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // 添加元素到構圖
    const newElement: CompositionElement = {
      id: `element-${Date.now()}`,
      type: data.type,
      targetId: data.id,
      position: { x, y },
      size: { width: 0.2, height: 0.3 },
      zIndex: composition.elements.length,
    };

    onUpdate({
      ...composition,
      elements: [...composition.elements, newElement],
    });
  };

  return (
    <div
      ref={canvasRef}
      className="w-full h-full relative"
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
    >
      {/* 場景背景 */}
      {scene.linkedModelId && (
        <div className="absolute inset-0 opacity-30">
          {/* 顯示場景參考圖 */}
        </div>
      )}

      {/* 構圖元素 */}
      {composition.elements.map(element => (
        <CompositionElement
          key={element.id}
          element={element}
          onUpdate={updated => {
            onUpdate({
              ...composition,
              elements: composition.elements.map(e =>
                e.id === element.id ? updated : e
              ),
            });
          }}
          onDelete={() => {
            onUpdate({
              ...composition,
              elements: composition.elements.filter(e => e.id !== element.id),
            });
          }}
        />
      ))}
    </div>
  );
}
```

### 3.3 AI 構圖建議

創建 `server/services/compositionSuggestion.ts`：

```typescript
/**
 * compositionSuggestion.ts — AI 構圖建議服務
 *
 * 基於場景、角色、劇情提供構圖建議
 */

export async function generateCompositionSuggestion(
  scene: WorldScene,
  characters: WorldCharacter[],
  context?: {
    sceneIndex: number;
    previousScenes?: WorldScene[];
    storyContext?: string;
  }
): Promise<SceneComposition> {
  const prompt = `Given this scene and characters, suggest a composition:

Scene: ${scene.name}
Environment: ${scene.environment}
Mood: ${scene.mood}

Characters:
${characters.map(c => `- ${c.name}: ${c.appearance}`).join("\n")}

${context?.storyContext ? `Story Context: ${context.storyContext}` : ""}

Please suggest:
1. Character positions (relative x, y coordinates 0-1)
2. Character sizes (relative scale)
3. Z-order (which character is in front)
4. Camera angle recommendations
5. Composition principles applied (rule of thirds, golden ratio, etc.)

Return as JSON with this structure:
{
  elements: [{ type: "character", targetId: "char-id", position: {x, y}, size: {width, height}, zIndex: 0 }],
  cameraAngle: "...",
  principles: ["..."]
}`;

  const response = await getLLMCompletion({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
  });

  return JSON.parse(response.content);
}
```

## 4. 數據庫遷移

需要添加新表來存儲時間軸圖幀和構圖：

```sql
-- 時間軸圖幀表
CREATE TABLE timeline_frames (
  id INT AUTO_INCREMENT PRIMARY KEY,
  storyboard_id INT NOT NULL,
  scene_index INT NOT NULL,
  timestamp DECIMAL(10, 2) NOT NULL,
  image_url VARCHAR(2048) NOT NULL,
  image_key VARCHAR(512) NOT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  consistency_check JSON,
  FOREIGN KEY (storyboard_id) REFERENCES world_storyboards(id) ON DELETE CASCADE,
  INDEX idx_storyboard_scene (storyboard_id, scene_index)
);

-- 場景構圖表
CREATE TABLE scene_compositions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scene_id VARCHAR(255) NOT NULL,
  storyboard_id INT,
  composition_data JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (storyboard_id) REFERENCES world_storyboards(id) ON DELETE CASCADE
);
```

## 5. 實施順序

建議的實施順序：

1. **階段一**：AI 代理系統融入（1-2 週）
   - 添加 useRegisterPageAgent
   - 實現基本的生成能力
   - 測試與光球的集成

2. **階段二**：時間軸圖幀上傳（1-2 週）
   - 實現上傳功能
   - 創建時間軸 UI
   - 基本的圖幀管理

3. **階段三**：一致性檢查系統（2-3 週）
   - 實現 Vision API 集成
   - 開發檢查算法
   - UI 展示結果

4. **階段四**：多角色構圖協助（2-3 週）
   - 實現拖放畫布
   - AI 構圖建議
   - 素材庫集成

總計：6-10 週的開發時間

## 6. 測試策略

- 單元測試：各個服務函數
- 集成測試：TRPC 路由
- E2E 測試：完整的用戶流程
- 性能測試：大量圖幀和元素的處理

## 7. 文檔

需要更新的文檔：
- API 文檔
- 用戶指南
- 開發者指南
- 架構文檔
