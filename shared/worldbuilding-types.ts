/**
 * Worldbuilding Types — 導演 AI 的自訂世界觀架構器
 *
 * 角色與場景的結構是強型別 TypeScript schema，但實際儲存在 MySQL
 * 的 JSON 欄位（charactersJson / scenesJson / objectsJson）。
 *
 * 任何欄位調整只需改這支檔案 + 對應的 zod schema（router 端），
 * 不必再改 SQL migration。
 */

import { z } from "zod";

// ─── Character ──────────────────────────────────────────────────────────────

export type CharacterRole = "protagonist" | "supporting" | "antagonist" | "npc";

export const CHARACTER_ROLE_LABELS: Record<CharacterRole, string> = {
  protagonist: "主角",
  supporting: "配角",
  antagonist: "反派",
  npc: "路人 / NPC",
};

export type WorldCharacter = {
  /** Local UUID-ish id（前端產生即可） */
  id: string;
  name: string;
  role: CharacterRole;
  /** 一句話描述 */
  tagline?: string;
  /** 個性、性格 */
  personality?: string;
  /** 喜好（食物、音樂、活動……） */
  likes?: string[];
  /** 興趣 / 嗜好 */
  interests?: string[];
  /** 穿著風格 / 服裝細節 */
  outfit?: string;
  /** 外貌、樣貌（髮型、瞳色、身高、特徵……） */
  appearance?: string;
  /** 隨身物件（武器、寵物、配飾……） */
  signatureItems?: string[];
  /** 背景故事 */
  backstory?: string;
  /** 對應的 LoRA 模型 id（fine_tuned_models.id），可選 */
  linkedModelId?: number | null;
  /** AI 生成時要插入的 trigger word（與 LoRA 對應） */
  triggerWord?: string;
  /** 額外備註 */
  notes?: string;
};

// ─── Scene ──────────────────────────────────────────────────────────────────

export type WorldScene = {
  id: string;
  name: string;
  /** 一句話氛圍描述 */
  tagline?: string;
  /** 環境描述（地點、季節、天氣） */
  environment?: string;
  /** 植被（花草樹木） */
  flora?: string[];
  /** 動物 / 生物 */
  fauna?: string[];
  /** 場景內物件（家具、道具、招牌……） */
  props?: string[];
  /** 光線 / 配色 */
  lighting?: string;
  /** 氛圍 / 情緒 */
  mood?: string;
  /** 環境變化（晝夜、季節、突發事件……） */
  environmentChanges?: string[];
  /** 對應的場景 LoRA 模型 id */
  linkedModelId?: number | null;
  triggerWord?: string;
  notes?: string;
};

// ─── World Object（全域物件，可被多個場景引用） ─────────────────────────────

export type WorldObject = {
  id: string;
  name: string;
  /** 類型（道具、武器、植物、生物、車輛、建築……） */
  category?: string;
  description?: string;
  /** 視覺特徵 */
  visualTraits?: string;
  /** 連結到場景 id 陣列 */
  appearsInScenes?: string[];
  notes?: string;
};

// ─── Framework（整個世界） ──────────────────────────────────────────────────

export type WorldbuildingFrameworkData = {
  id?: number;
  name: string;
  description?: string;
  genre?: string;
  characters: WorldCharacter[];
  scenes: WorldScene[];
  objects?: WorldObject[];
  linkedModelIds?: number[];
  tags?: string[];
  isActive?: boolean;
};

// ─── Zod schemas（router 用） ───────────────────────────────────────────────

export const characterRoleSchema = z.enum([
  "protagonist",
  "supporting",
  "antagonist",
  "npc",
]);

export const worldCharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  role: characterRoleSchema,
  tagline: z.string().max(255).optional(),
  personality: z.string().max(2000).optional(),
  likes: z.array(z.string().max(128)).max(50).optional(),
  interests: z.array(z.string().max(128)).max(50).optional(),
  outfit: z.string().max(2000).optional(),
  appearance: z.string().max(2000).optional(),
  signatureItems: z.array(z.string().max(128)).max(50).optional(),
  backstory: z.string().max(5000).optional(),
  linkedModelId: z.number().int().positive().nullable().optional(),
  triggerWord: z.string().max(128).optional(),
  notes: z.string().max(2000).optional(),
});

export const worldSceneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  tagline: z.string().max(255).optional(),
  environment: z.string().max(2000).optional(),
  flora: z.array(z.string().max(128)).max(50).optional(),
  fauna: z.array(z.string().max(128)).max(50).optional(),
  props: z.array(z.string().max(128)).max(50).optional(),
  lighting: z.string().max(500).optional(),
  mood: z.string().max(500).optional(),
  environmentChanges: z.array(z.string().max(255)).max(50).optional(),
  linkedModelId: z.number().int().positive().nullable().optional(),
  triggerWord: z.string().max(128).optional(),
  notes: z.string().max(2000).optional(),
});

export const worldObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  category: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  visualTraits: z.string().max(1000).optional(),
  appearsInScenes: z.array(z.string()).max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export const worldbuildingFrameworkInputSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  genre: z.string().max(128).optional(),
  characters: z.array(worldCharacterSchema).max(100),
  scenes: z.array(worldSceneSchema).max(100),
  objects: z.array(worldObjectSchema).max(200).optional(),
  linkedModelIds: z.array(z.number().int().positive()).max(50).optional(),
  tags: z.array(z.string().max(64)).max(30).optional(),
  isActive: z.boolean().optional(),
});

export type WorldbuildingFrameworkInput = z.infer<
  typeof worldbuildingFrameworkInputSchema
>;

// ─── Prompt helpers ─────────────────────────────────────────────────────────

/**
 * 把一個世界觀架構壓縮成可以塞進 LLM system prompt 的純文字。
 * 導演 AI / Studio 生成時可以呼叫這個函式取得世界觀脈絡。
 */
export function summarizeFrameworkForPrompt(
  framework: WorldbuildingFrameworkData
): string {
  const lines: string[] = [];
  lines.push(`# 世界觀：${framework.name}`);
  if (framework.genre) lines.push(`風格：${framework.genre}`);
  if (framework.description) lines.push(framework.description);

  if (framework.characters.length > 0) {
    lines.push("\n## 角色");
    for (const c of framework.characters) {
      const role = CHARACTER_ROLE_LABELS[c.role] ?? c.role;
      const parts: string[] = [`- [${role}] ${c.name}`];
      if (c.tagline) parts.push(`（${c.tagline}）`);
      lines.push(parts.join(""));
      if (c.appearance) lines.push(`  · 樣貌：${c.appearance}`);
      if (c.outfit) lines.push(`  · 穿著：${c.outfit}`);
      if (c.personality) lines.push(`  · 個性：${c.personality}`);
      if (c.likes?.length) lines.push(`  · 喜好：${c.likes.join("、")}`);
      if (c.interests?.length) lines.push(`  · 興趣：${c.interests.join("、")}`);
      if (c.signatureItems?.length)
        lines.push(`  · 隨身物件：${c.signatureItems.join("、")}`);
      if (c.triggerWord)
        lines.push(`  · LoRA trigger：${c.triggerWord}`);
    }
  }

  if (framework.scenes.length > 0) {
    lines.push("\n## 場景");
    for (const s of framework.scenes) {
      lines.push(`- ${s.name}${s.tagline ? `（${s.tagline}）` : ""}`);
      if (s.environment) lines.push(`  · 環境：${s.environment}`);
      if (s.lighting) lines.push(`  · 光線：${s.lighting}`);
      if (s.mood) lines.push(`  · 氛圍：${s.mood}`);
      if (s.flora?.length) lines.push(`  · 花草樹木：${s.flora.join("、")}`);
      if (s.fauna?.length) lines.push(`  · 生物：${s.fauna.join("、")}`);
      if (s.props?.length) lines.push(`  · 物件：${s.props.join("、")}`);
      if (s.environmentChanges?.length)
        lines.push(`  · 環境變化：${s.environmentChanges.join("；")}`);
      if (s.triggerWord)
        lines.push(`  · LoRA trigger：${s.triggerWord}`);
    }
  }

  if (framework.objects && framework.objects.length > 0) {
    lines.push("\n## 全域物件");
    for (const o of framework.objects) {
      lines.push(`- ${o.name}${o.category ? `（${o.category}）` : ""}`);
      if (o.description) lines.push(`  · ${o.description}`);
    }
  }

  return lines.join("\n");
}
