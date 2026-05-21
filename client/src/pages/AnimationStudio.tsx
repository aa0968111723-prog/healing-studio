/**
 * AnimationStudio — 世界觀 + 動畫分鏡的整合工作室
 *
 * 三大區塊：
 *   1. 世界選擇與摘要 —— 列出使用者的所有世界觀，選一個進行動畫製作
 *   2. 角色動畫設定 —— 對選定世界的每個角色配置三視圖、表情包、穿衣集、
 *      口氣、語音檔、腳本定位
 *   3. 分鏡時間軸 —— 列出 / 新建分鏡、auto-seed 骨架、跑管線 plan、匯出鏡頭表
 *
 * 此頁面是「世界觀架構」與「動畫產線」的單一入口，串接全站功能，且生成流程統一走站內系統（不直連外部功能）：
 *   - 模型訓練中心（LoRA）— 角色 / 場景 / 風格 profile
 *   - Image Studio / Video Studio — 圖楨 / 細膩化 / i2v
 *   - Pro Studio — 配樂 / 配音 / 音效
 *   - Director AI — 腳本 ↔ 分鏡雙向同步
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type { AgentAction, AgentCapability } from "../../../shared/agent-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Film,
  Users,
  Layers,
  Music,
  Mic,
  Camera,
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  Clock,
  Wand2,
  Download,
  Image as ImageIcon,
  Smile,
  Shirt,
  MessageCircle,
  Volume2,
  Theater,
  ExternalLink,
  MapPin,
  Link2,
  Save,
  Palette,
  Globe,
  Database,
  FileAudio,
  FileText,
  GraduationCap,
  Search,
  X,
  Upload as UploadIcon,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Eye,
  MousePointerClick,
} from "lucide-react";
import { EarthGlobeAnimation } from "@/components/animation/EarthGlobeAnimation";
import { CharacterVisualPreview } from "@/components/animation/CharacterVisualPreview";
import { SceneEnvironmentPreview } from "@/components/animation/SceneEnvironmentPreview";
import {
  AssetUploader,
  inferAssetType,
} from "@/components/animation/AssetUploader";
import { ScriptEditorTab } from "@/components/animation/ScriptEditorTab";
import { SourcePicker } from "@/components/animation/SourcePicker";
import { ProductionPackagePreview } from "@/components/animation/ProductionPackagePreview";
import { VisualInspirationLibraryPanel } from "@/components/animation/VisualInspirationLibraryPanel";
import {
  GenerateImageButton,
  GenerateMusicButton,
  GenerateVoiceButton,
} from "@/components/animation/QuickGenerateButtons";
import { StoryboardTimelineUploader } from "@/components/animation/StoryboardTimelineUploader";
import { ConsistencyCheckPanel } from "@/components/animation/ConsistencyCheckPanel";
import { CompositionAssistant } from "@/components/animation/CompositionAssistant";
import {
  buildCharacterConsistencyPrompt,
  buildSceneConsistencyPrompt,
} from "../../../shared/worldbuilding-types";
import {
  ART_STYLE_PRESETS,
  CAMERA_MOVEMENT_PRESETS,
  CHARACTER_ARCHETYPE_PRESETS,
  CHARACTER_ROLE_LABELS,
  ENVIRONMENT_CHANGE_PRESETS,
  ERA_PRESETS,
  GENRE_PRESETS,
  PERSONALITY_TRAIT_PRESETS,
  SCENE_LIGHTING_PRESETS,
  SCENE_MOOD_PRESETS,
  SCENE_TIME_OF_DAY_PRESETS,
  // v3 專業
  RIG_TYPE_PRESETS,
  LIP_SYNC_SYSTEM_PRESETS,
  PRESTON_BLAIR_PHONEMES,
  WALK_CYCLE_STYLE_PRESETS,
  ANIMATION_SCHOOL_PRESETS,
  COMPOSITING_PASS_PRESETS,
  SHADING_MODEL_PRESETS,
  REVERB_PRESETS,
  PRECIPITATION_PRESETS,
  TRANSITION_STYLE_MUSIC_PRESETS,
  MILESTONE_STAGE_PRESETS,
  PRODUCTION_ROLE_PRESETS,
  COLOR_SPACE_PRESETS,
  MASTER_RESOLUTION_PRESETS,
  MASTER_CODEC_PRESETS,
  LUFS_TARGET_PRESETS,
  // v4 真實參考 / 研究 / 音效庫
  CHARACTER_REF_TYPE_PRESETS,
  SCENE_REF_TYPE_PRESETS,
  RESEARCH_CATEGORY_PRESETS,
  SOUND_LIBRARY_CATEGORY_PRESETS,
  SOUND_LICENSE_PRESETS,
  ASSET_PURPOSE_PRESETS,
  type CharacterRealWorldRef,
  type SceneRealWorldRef,
  type WorldAssetRef,
  type WorldResearchEntry,
  type WorldSoundLibraryItem,
  type WorldScene,
  EXPRESSION_PRESETS,
  MUSIC_INSTRUMENT_PRESETS,
  MUSIC_MOOD_PRESETS,
  OUTFIT_OCCASION_PRESETS,
  PRODUCTION_FORMAT_PRESETS,
  VOICE_ENGINE_PRESETS,
  VOICE_TONE_BASE_PRESETS,
  type CharacterExpression,
  type CharacterOutfit,
  type CharacterRole,
  type WorldCharacter,
  type WorldMusicTheme,
  type WorldStyleProfile,
  type WorldbuildingFrameworkData,
} from "../../../shared/worldbuilding-types";
import {
  STORYBOARD_ASPECT_RATIO_PRESETS,
  STORYBOARD_FPS_PRESETS,
  formatTimecode,
  type WorldStoryboard,
} from "../../../shared/worldbuilding-animation";

import { calculateWorldbuildingProgress } from "../../../shared/worldbuilding-progress";
import { getWorldbuildingActionPlan } from "../../../shared/worldbuilding-actions";
import { calculateWorldbuildingReadiness } from "../../../shared/worldbuilding-readiness";
import { buildAgentWorkflowFromGenerationTasks } from "../../../shared/worldbuilding-agent-workflow";
import { GenerationReadinessChecklist } from "@/components/animation/GenerationReadinessChecklist";

// ─── helpers ───────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 表情卡編輯 ────────────────────────────────────────────────────────────

const ExpressionEditor = memo(function ExpressionEditor({
  items,
  onChange,
}: {
  items: CharacterExpression[];
  onChange: (next: CharacterExpression[]) => void;
}) {
  const add = () =>
    onChange([
      ...items,
      { id: uid(), name: "", description: "", intensity: 0.7 },
    ]);
  const patch = (idx: number, p: Partial<CharacterExpression>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...p } : it)));
  const remove = (idx: number) =>
    onChange(items.filter((_, i) => i !== idx));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {EXPRESSION_PRESETS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => {
              if (items.some(it => it.name === p)) return;
              onChange([
                ...items,
                { id: uid(), name: p, intensity: 0.7 },
              ]);
            }}
            className="px-2 py-0.5 rounded-full text-[10px] border border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60 hover:text-foreground transition"
          >
            + {p}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          尚未新增表情。點上方預設或下方按鈕新增。
        </p>
      ) : (
        items.map((it, idx) => (
          <div
            key={it.id}
            className="rounded-lg border border-border/30 bg-card/30 p-2 space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <Smile className="w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={it.name}
                onChange={e => patch(idx, { name: e.target.value })}
                placeholder="表情名稱（喜悅 / 震驚…）"
                className="h-7 text-xs flex-1"
              />
              <Input
                type="number"
                step={0.1}
                min={0}
                max={1}
                value={it.intensity ?? 0.7}
                onChange={e =>
                  patch(idx, {
                    intensity: Math.max(0, Math.min(1, Number(e.target.value))),
                  })
                }
                placeholder="強度"
                className="h-7 w-16 text-xs"
                aria-label="表情強度 0-1"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(idx)}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                aria-label="刪除表情"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
            <Input
              value={it.description ?? ""}
              onChange={e => patch(idx, { description: e.target.value })}
              placeholder="描述（嘴角上揚、眉毛揪起…）"
              className="h-7 text-[11px]"
            />
            <div className="flex gap-1">
              <Input
                value={it.imageUrl ?? ""}
                onChange={e => patch(idx, { imageUrl: e.target.value })}
                placeholder="表情預覽圖 URL（可從 Image Studio 拖入）"
                className="h-7 text-[11px] flex-1"
              />
              <AssetUploader
                accept="image/*"
                label="上傳"
                onUploaded={r => patch(idx, { imageUrl: r.url })}
              />
              <SourcePicker
                accept="image/*"
                assetKind="image"
                vaultItemType="character"
                onPick={r => patch(idx, { imageUrl: r.url })}
              />
            </div>
          </div>
        ))
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="h-7 text-xs"
      >
        <Plus className="w-3 h-3 mr-1" /> 新增表情
      </Button>
    </div>
  );
});

// ─── 穿衣編輯 ──────────────────────────────────────────────────────────────

const OutfitEditor = memo(function OutfitEditor({
  items,
  onChange,
}: {
  items: CharacterOutfit[];
  onChange: (next: CharacterOutfit[]) => void;
}) {
  const add = () =>
    onChange([
      ...items,
      { id: uid(), name: "", isDefault: items.length === 0 },
    ]);
  const patch = (idx: number, p: Partial<CharacterOutfit>) => {
    let next = items.map((it, i) => (i === idx ? { ...it, ...p } : it));
    if (p.isDefault) {
      next = next.map((it, i) => ({ ...it, isDefault: i === idx }));
    }
    onChange(next);
  };
  const remove = (idx: number) =>
    onChange(items.filter((_, i) => i !== idx));
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          尚無套裝；至少建一套預設穿著。
        </p>
      ) : (
        items.map((it, idx) => (
          <div
            key={it.id}
            className="rounded-lg border border-border/30 bg-card/30 p-2 space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <Shirt className="w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={it.name}
                onChange={e => patch(idx, { name: e.target.value })}
                placeholder="套裝名稱（日常 / 戰鬥…）"
                className="h-7 text-xs flex-1"
              />
              <Select
                value={it.occasion ?? ""}
                onValueChange={v => patch(idx, { occasion: v })}
              >
                <SelectTrigger className="h-7 w-[100px] text-xs">
                  <SelectValue placeholder="場合" />
                </SelectTrigger>
                <SelectContent>
                  {OUTFIT_OCCASION_PRESETS.map(o => (
                    <SelectItem key={o} value={o} className="text-xs">
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={it.isDefault ? "default" : "ghost"}
                size="sm"
                onClick={() => patch(idx, { isDefault: !it.isDefault })}
                className="h-7 px-2 text-[10px]"
              >
                {it.isDefault ? "預設" : "設為預設"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(idx)}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                aria-label="刪除套裝"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
            <Textarea
              value={it.description ?? ""}
              onChange={e => patch(idx, { description: e.target.value })}
              placeholder="細節描述（材質、配色、配件…）"
              className="min-h-[40px] text-[11px]"
            />
            <div className="flex gap-1">
              <Input
                value={it.imageUrl ?? ""}
                onChange={e => patch(idx, { imageUrl: e.target.value })}
                placeholder="參考圖 URL"
                className="h-7 text-[11px] flex-1"
              />
              <AssetUploader
                accept="image/*"
                label="上傳"
                onUploaded={r => patch(idx, { imageUrl: r.url })}
              />
              <SourcePicker
                accept="image/*"
                assetKind="image"
                vaultItemType="character"
                onPick={r => patch(idx, { imageUrl: r.url })}
              />
            </div>
            <Input
              value={it.triggerWord ?? ""}
              onChange={e => patch(idx, { triggerWord: e.target.value })}
              placeholder="LoRA trigger word（若有專屬服裝模型）"
              className="h-7 text-[11px]"
            />
          </div>
        ))
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="h-7 text-xs"
      >
        <Plus className="w-3 h-3 mr-1" /> 新增套裝
      </Button>
    </div>
  );
});

// ─── 三視圖編輯 ────────────────────────────────────────────────────────────

const ThreeViewEditor = memo(function ThreeViewEditor({
  character,
  onChange,
}: {
  character: WorldCharacter;
  onChange: (next: WorldCharacter) => void;
}) {
  const sheet = character.threeViewSheet ?? {};
  const patch = (p: Partial<typeof sheet>) =>
    onChange({
      ...character,
      threeViewSheet: { ...sheet, ...p },
    });
  const basePrompt = buildCharacterConsistencyPrompt(character);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { key: "frontImageUrl", label: "正面", anglePrompt: "正面角度, full body front view" },
          { key: "sideImageUrl", label: "側面", anglePrompt: "側面角度, full body side view" },
          { key: "backImageUrl", label: "背面", anglePrompt: "背面角度, full body back view" },
          {
            key: "threeQuarterImageUrl",
            label: "3/4 視角",
            anglePrompt: "3/4 視角, full body 3/4 view",
          },
        ].map(v => {
          const url = (sheet as Record<string, string | undefined>)[v.key];
          const compiledPrompt = [basePrompt, v.anglePrompt, "character turnaround sheet, white background, A-pose"]
            .filter(Boolean)
            .join(", ");
          return (
            <div key={v.key} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{v.label}</Label>
              <div className="aspect-[3/4] rounded-md border border-dashed border-border/40 bg-card/20 flex items-center justify-center overflow-hidden">
                {url ? (
                  <img
                    src={url}
                    alt={`${character.name} ${v.label}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
                )}
              </div>
              <Input
                value={url ?? ""}
                onChange={e =>
                  patch({ [v.key]: e.target.value || undefined } as Partial<
                    typeof sheet
                  >)
                }
                placeholder={`${v.label} URL`}
                className="h-6 text-[10px]"
              />
              <div className="flex flex-wrap gap-1">
                <GenerateImageButton
                  prompt={compiledPrompt}
                  aspectRatio="3:4"
                  label="Fal.ai 生成"
                  onSuccess={imgUrl =>
                    patch({ [v.key]: imgUrl } as Partial<typeof sheet>)
                  }
                  disabled={!character.name}
                />
                <AssetUploader
                  accept="image/*"
                  label="上傳"
                  onUploaded={r =>
                    patch({ [v.key]: r.url } as Partial<typeof sheet>)
                  }
                />
                <SourcePicker
                  accept="image/*"
                  assetKind="image"
                  vaultItemType="character"
                  onPick={r =>
                    patch({ [v.key]: r.url } as Partial<typeof sheet>)
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─── 角色動畫設定卡（深度編輯） ────────────────────────────────────────────

const CharacterAnimationCard = memo(function CharacterAnimationCard({
  character,
  voices,
  onChange,
  onDelete,
  models,
}: {
  character: WorldCharacter;
  voices: Array<{
    modelId: string;
    label: string;
    provider: string;
    category: string | null;
    strengths: string[];
  }>;
  models: Array<{
    id: number;
    name: string;
    modelType: string;
    triggerWord: string | null;
  }>;
  onChange: (next: WorldCharacter) => void;
  onDelete?: () => void;
}) {
  const [openSection, setOpenSection] = useState<string | null>("basics");
  const patch = (p: Partial<WorldCharacter>) =>
    onChange({ ...character, ...p });

  const sections = [
    { id: "basics", label: "基本", icon: Users },
    { id: "threeView", label: "三視圖", icon: ImageIcon },
    { id: "expressions", label: "表情包", icon: Smile },
    { id: "outfits", label: "穿衣集", icon: Shirt },
    { id: "tone", label: "口氣", icon: MessageCircle },
    { id: "voice", label: "語音檔", icon: Volume2 },
    { id: "scriptRole", label: "腳本定位", icon: Theater },
    { id: "lora", label: "LoRA", icon: Link2 },
    // ─── v3 動畫製作專業 ───────────────────────────────────────────────
    { id: "rig", label: "Rig 規格", icon: Wand2 },
    { id: "lipSync", label: "口型", icon: MessageCircle },
    { id: "acting", label: "演技指導", icon: Theater },
    { id: "ageVariants", label: "年齡變體", icon: Users },
    { id: "sounds", label: "聲音檔", icon: Volume2 },
    { id: "refLib", label: "參考圖庫", icon: ImageIcon },
    // ─── v4 真實參考 / 上傳資產 / 訓練 ─────────────────────────────────
    { id: "realRefs", label: "真實參考", icon: Globe },
    { id: "uploads", label: "上傳資產", icon: UploadIcon },
    { id: "train", label: "訓練 LoRA", icon: GraduationCap },
  ];

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase">
          {CHARACTER_ROLE_LABELS[character.role]}
        </Badge>
        <Input
          value={character.name}
          onChange={e => patch({ name: e.target.value })}
          placeholder="角色名稱"
          className="h-7 text-sm font-medium flex-1"
        />
        <Select
          value={character.role}
          onValueChange={v => patch({ role: v as CharacterRole })}
        >
          <SelectTrigger className="h-7 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.entries(CHARACTER_ROLE_LABELS) as Array<
                [CharacterRole, string]
              >
            ).map(([id, label]) => (
              <SelectItem key={id} value={id} className="text-xs">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {character.triggerWord && (
          <Badge variant="secondary" className="text-[9px] font-mono">
            {character.triggerWord}
          </Badge>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            aria-label="刪除角色"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>
      <Input
        value={character.tagline ?? ""}
        onChange={e => patch({ tagline: e.target.value })}
        placeholder="一句話描述（被遺忘的森林守護者…）"
        className="h-7 text-[11px]"
      />

      {/* 即時視覺預覽 */}
      <CharacterVisualPreview character={character} className="my-2" />

      <div className="flex flex-wrap gap-1">
        {sections.map(s => {
          const Icon = s.icon;
          const isOpen = openSection === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setOpenSection(isOpen ? null : s.id)}
              className={`px-2 py-1 rounded-md text-[11px] flex items-center gap-1 transition ${
                isOpen
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-card/40 text-muted-foreground border border-border/30 hover:bg-card/60"
              }`}
            >
              <Icon className="w-3 h-3" />
              {s.label}
            </button>
          );
        })}
      </div>

      {openSection === "basics" && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">樣貌</Label>
              <Textarea
                value={character.appearance ?? ""}
                onChange={e => patch({ appearance: e.target.value })}
                placeholder="髮型、瞳色、身高、特徵…"
                className="min-h-[50px] text-[11px]"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">個性</Label>
              <Textarea
                value={character.personality ?? ""}
                onChange={e => patch({ personality: e.target.value })}
                placeholder="性格、行為模式…"
                className="min-h-[50px] text-[11px]"
              />
              <div className="flex flex-wrap gap-1 mt-1">
                {PERSONALITY_TRAIT_PRESETS.map(p => {
                  const isActive = (character.personality ?? "").includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        const cur = (character.personality ?? "").trim();
                        patch({
                          personality: cur.includes(p)
                            ? cur
                            : cur
                              ? `${cur}、${p}`
                              : p,
                        });
                      }}
                      className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                        isActive
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                      }`}
                    >
                      {isActive ? "✓ " : "+ "}
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">喜好（逗號分隔）</Label>
              <Input
                value={(character.likes ?? []).join("、")}
                onChange={e =>
                  patch({
                    likes: e.target.value
                      .split(/[、,，]/)
                      .map(s => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="苔球、紅茶、雨後森林"
                className="h-7 text-[11px]"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">興趣</Label>
              <Input
                value={(character.interests ?? []).join("、")}
                onChange={e =>
                  patch({
                    interests: e.target.value
                      .split(/[、,，]/)
                      .map(s => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="採集草藥、彈奏豎琴"
                className="h-7 text-[11px]"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">隨身物件</Label>
              <Input
                value={(character.signatureItems ?? []).join("、")}
                onChange={e =>
                  patch({
                    signatureItems: e.target.value
                      .split(/[、,，]/)
                      .map(s => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="木杖、苔球寵物"
                className="h-7 text-[11px]"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">背景故事</Label>
            <Textarea
              value={character.backstory ?? ""}
              onChange={e => patch({ backstory: e.target.value })}
              placeholder="出身、經歷、動機…"
              className="min-h-[50px] text-[11px]"
            />
          </div>
        </div>
      )}

      {openSection === "threeView" && (
        <div className="pt-1 space-y-2">
          <ThreeViewEditor character={character} onChange={onChange} />
          <Textarea
            value={character.threeViewSheet?.generationPrompt ?? ""}
            onChange={e =>
              patch({
                threeViewSheet: {
                  ...character.threeViewSheet,
                  generationPrompt: e.target.value,
                },
              })
            }
            placeholder="三視圖生成 prompt（送 Image Studio 重生用）"
            className="min-h-[40px] text-[11px]"
          />
        </div>
      )}

      {openSection === "expressions" && (
        <div className="pt-1">
          <ExpressionEditor
            items={character.expressions ?? []}
            onChange={next => patch({ expressions: next })}
          />
        </div>
      )}

      {openSection === "outfits" && (
        <div className="pt-1">
          <OutfitEditor
            items={character.outfits ?? []}
            onChange={next => patch({ outfits: next })}
          />
        </div>
      )}

      {openSection === "tone" && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">基本口氣</Label>
              <Select
                value={character.speechTone?.baseTone ?? ""}
                onValueChange={v =>
                  patch({
                    speechTone: { ...character.speechTone, baseTone: v },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_TONE_BASE_PRESETS.map(t => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">正式度</Label>
              <Select
                value={character.speechTone?.formality ?? ""}
                onValueChange={v =>
                  patch({
                    speechTone: {
                      ...character.speechTone,
                      formality: v as "casual" | "neutral" | "formal" | "archaic" | "slang",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { v: "casual", l: "口語" },
                    { v: "neutral", l: "中性" },
                    { v: "formal", l: "正式" },
                    { v: "archaic", l: "文言" },
                    { v: "slang", l: "俚語" },
                  ].map(o => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">語速</Label>
              <Select
                value={character.speechTone?.pace ?? ""}
                onValueChange={v =>
                  patch({
                    speechTone: {
                      ...character.speechTone,
                      pace: v as "slow" | "normal" | "fast" | "varied",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { v: "slow", l: "慢" },
                    { v: "normal", l: "正常" },
                    { v: "fast", l: "快" },
                    { v: "varied", l: "起伏" },
                  ].map(o => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">自稱</Label>
              <Input
                value={character.speechTone?.selfReferent ?? ""}
                onChange={e =>
                  patch({
                    speechTone: {
                      ...character.speechTone,
                      selfReferent: e.target.value,
                    },
                  })
                }
                placeholder="本王 / 朕 / 在下 / 人家"
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">口頭禪（逗號分隔）</Label>
            <Input
              value={(character.speechTone?.catchphrases ?? []).join("、")}
              onChange={e =>
                patch({
                  speechTone: {
                    ...character.speechTone,
                    catchphrases: e.target.value
                      .split(/[、,，]/)
                      .map(s => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="哼、就是說啊、可不是嘛"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">禁用詞（避免生成）</Label>
            <Input
              value={(character.speechTone?.forbiddenWords ?? []).join("、")}
              onChange={e =>
                patch({
                  speechTone: {
                    ...character.speechTone,
                    forbiddenWords: e.target.value
                      .split(/[、,，]/)
                      .map(s => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="例如不會說粗話"
              className="h-7 text-xs"
            />
          </div>
        </div>
      )}

      {openSection === "voice" && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">語音引擎</Label>
              <Select
                value={character.voiceProfile?.engine ?? ""}
                onValueChange={v =>
                  patch({
                    voiceProfile: {
                      ...character.voiceProfile,
                      engine: v as "elevenlabs" | "gemini" | "fal" | "minimax" | "custom",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_ENGINE_PRESETS.map(e => (
                    <SelectItem key={e.value} value={e.value} className="text-xs">
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">語言</Label>
              <Input
                value={character.voiceProfile?.languageCode ?? ""}
                onChange={e =>
                  patch({
                    voiceProfile: {
                      ...character.voiceProfile,
                      languageCode: e.target.value,
                    },
                  })
                }
                placeholder="zh-TW / ja-JP / en-US"
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Voice ID</Label>
              <Input
                value={character.voiceProfile?.voiceId ?? ""}
                onChange={e =>
                  patch({
                    voiceProfile: {
                      ...character.voiceProfile,
                      voiceId: e.target.value,
                    },
                  })
                }
                placeholder="elevenlabs/xxx 或 voice clone id"
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">情緒</Label>
              <Input
                value={character.voiceProfile?.emotion ?? ""}
                onChange={e =>
                  patch({
                    voiceProfile: {
                      ...character.voiceProfile,
                      emotion: e.target.value,
                    },
                  })
                }
                placeholder="neutral / happy / sad / whisper"
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">
                Pitch (-1 ~ 1)
              </Label>
              <Input
                type="number"
                step={0.1}
                min={-1}
                max={1}
                value={character.voiceProfile?.pitch ?? 0}
                onChange={e =>
                  patch({
                    voiceProfile: {
                      ...character.voiceProfile,
                      pitch: Number(e.target.value),
                    },
                  })
                }
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">
                Speed (0.5 ~ 2)
              </Label>
              <Input
                type="number"
                step={0.1}
                min={0.5}
                max={2}
                value={character.voiceProfile?.speed ?? 1}
                onChange={e =>
                  patch({
                    voiceProfile: {
                      ...character.voiceProfile,
                      speed: Number(e.target.value),
                    },
                  })
                }
                className="h-7 text-xs"
              />
            </div>
          </div>
          <Input
            value={character.voiceProfile?.sampleAudioUrl ?? ""}
            onChange={e =>
              patch({
                voiceProfile: {
                  ...character.voiceProfile,
                  sampleAudioUrl: e.target.value,
                },
              })
            }
            placeholder="試聽 mp3 / wav URL"
            className="h-7 text-xs"
          />
          {/* 一鍵 TTS 試聽（直連 ProStudio elevenLabsTTS） */}
          <div className="flex items-center gap-2">
            <GenerateVoiceButton
              text={
                character.scriptRole?.signatureLines?.[0] ||
                `你好，我是${character.name || "這個角色"}。`
              }
              voiceId={character.voiceProfile?.voiceId}
              label="一鍵試聽（說招牌台詞）"
              onJobStarted={reqId =>
                toast.info(`TTS 任務 ${reqId.slice(0, 8)}… 已送出，請至背景任務查看結果`)
              }
            />
            <AssetUploader
              accept="audio/*"
              label="上傳語音樣本"
              onUploaded={r => {
                patch({
                  voiceProfile: {
                    ...character.voiceProfile,
                    sampleAudioUrl: r.url,
                    useClone: true,
                    cloneSampleUrls: [
                      ...(character.voiceProfile?.cloneSampleUrls ?? []),
                      r.url,
                    ],
                  },
                });
              }}
            />
          </div>
          {voices.length > 0 && (
            <div className="text-[10px] text-muted-foreground">
              <span>建議引擎：</span>
              {voices.slice(0, 3).map(v => (
                <Badge
                  key={v.modelId}
                  variant="outline"
                  className="text-[9px] ml-1 cursor-pointer"
                  onClick={() =>
                    patch({
                      voiceProfile: {
                        ...character.voiceProfile,
                        voiceId: v.modelId,
                        engine: v.provider as "elevenlabs" | "gemini" | "fal",
                      },
                    })
                  }
                >
                  {v.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {openSection === "scriptRole" && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">原型</Label>
              <Select
                value={character.scriptRole?.archetype ?? ""}
                onValueChange={v =>
                  patch({
                    scriptRole: { ...character.scriptRole, archetype: v },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {CHARACTER_ARCHETYPE_PRESETS.map(a => (
                    <SelectItem key={a} value={a} className="text-xs">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">弧線</Label>
              <Select
                value={character.scriptRole?.arcType ?? ""}
                onValueChange={v =>
                  patch({
                    scriptRole: {
                      ...character.scriptRole,
                      arcType: v as "growth" | "fall" | "redemption" | "revenge" | "flat" | "tragic",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { v: "growth", l: "成長" },
                    { v: "fall", l: "墮落" },
                    { v: "redemption", l: "救贖" },
                    { v: "revenge", l: "復仇" },
                    { v: "flat", l: "靜態" },
                    { v: "tragic", l: "悲劇" },
                  ].map(o => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">出場定位</Label>
              <Select
                value={character.scriptRole?.defaultPosition ?? ""}
                onValueChange={v =>
                  patch({
                    scriptRole: {
                      ...character.scriptRole,
                      defaultPosition: v as "main_stage" | "narrator" | "transition" | "cameo" | "rival",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { v: "main_stage", l: "主舞台" },
                    { v: "narrator", l: "旁白" },
                    { v: "transition", l: "過場" },
                    { v: "cameo", l: "客串" },
                    { v: "rival", l: "對手" },
                  ].map(o => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">
                預計戲份占比 (0-1)
              </Label>
              <Input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={character.scriptRole?.avgScreenTimeRatio ?? 0}
                onChange={e =>
                  patch({
                    scriptRole: {
                      ...character.scriptRole,
                      avgScreenTimeRatio: Number(e.target.value),
                    },
                  })
                }
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">招牌台詞（一行一句）</Label>
            <Textarea
              value={(character.scriptRole?.signatureLines ?? []).join("\n")}
              onChange={e =>
                patch({
                  scriptRole: {
                    ...character.scriptRole,
                    signatureLines: e.target.value
                      .split("\n")
                      .map(s => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="例如：「這就是我相信的正義。」"
              className="min-h-[60px] text-[11px]"
            />
          </div>
        </div>
      )}

      {openSection === "lora" && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">連結角色 LoRA</Label>
              <Select
                value={String(character.linkedModelId ?? "__none")}
                onValueChange={v =>
                  patch({
                    linkedModelId: v === "__none" ? null : Number(v),
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="未連結（用通用模型）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-xs">
                    未連結（用通用模型）
                  </SelectItem>
                  {models
                    .filter(
                      m =>
                        m.modelType === "character" ||
                        m.modelType === "style" ||
                        m.modelType === "object"
                    )
                    .map(m => (
                      <SelectItem
                        key={m.id}
                        value={String(m.id)}
                        className="text-xs"
                      >
                        {m.name} ({m.modelType})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {(models?.length ?? 0) === 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  尚無已訓練模型 ——{" "}
                  <a
                    href="/models"
                    className="text-primary hover:underline"
                  >
                    前往模型訓練中心
                  </a>
                </p>
              )}
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">
                Trigger word（生成時自動插入）
              </Label>
              <Input
                value={character.triggerWord ?? ""}
                onChange={e => patch({ triggerWord: e.target.value })}
                placeholder="例如：sks_alice"
                className="h-7 text-xs"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            LoRA + trigger word 會在角色出場的每張圖楨自動注入 prompt，
            保證跨場景一致性。
          </p>
        </div>
      )}

      {/* ─── v3 動畫製作專業 ─────────────────────────────────────────────── */}

      {openSection === "rig" && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Rig 類型</Label>
              <Select
                value={character.rigSpec?.rigType ?? ""}
                onValueChange={v =>
                  patch({
                    rigSpec: {
                      ...character.rigSpec,
                      rigType: v as "live2d" | "spine_2d" | "rigged_3d" | "stop_motion" | "ai_only",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {RIG_TYPE_PRESETS.map(p => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">骨骼數</Label>
              <Input
                type="number"
                value={character.rigSpec?.boneCount ?? 0}
                onChange={e =>
                  patch({
                    rigSpec: {
                      ...character.rigSpec,
                      boneCount: Number(e.target.value),
                    },
                  })
                }
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Blend Shape 數</Label>
              <Input
                type="number"
                value={character.rigSpec?.blendShapeCount ?? 0}
                onChange={e =>
                  patch({
                    rigSpec: {
                      ...character.rigSpec,
                      blendShapeCount: Number(e.target.value),
                    },
                  })
                }
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Rig 製作者</Label>
              <Input
                value={character.rigSpec?.rigger ?? ""}
                onChange={e =>
                  patch({
                    rigSpec: { ...character.rigSpec, rigger: e.target.value },
                  })
                }
                placeholder="個人 / 工作室"
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">IK 鏈（逗號分隔）</Label>
            <Input
              value={(character.rigSpec?.ikChains ?? []).join("、")}
              onChange={e =>
                patch({
                  rigSpec: {
                    ...character.rigSpec,
                    ikChains: e.target.value
                      .split(/[、,，]/)
                      .map(s => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="左手、右手、左腳、右腳、頭部、尾巴"
              className="h-7 text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "hasClothSim", label: "布料模擬" },
              { key: "hasHairPhysics", label: "頭髮物理" },
              { key: "hasEyeTracking", label: "眼球追蹤" },
            ].map(o => {
              const v = (character.rigSpec as Record<string, unknown> | undefined)?.[
                o.key
              ] as boolean | undefined;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() =>
                    patch({
                      rigSpec: {
                        ...character.rigSpec,
                        [o.key]: !v,
                      } as WorldCharacter["rigSpec"],
                    })
                  }
                  className={`px-2 py-1 rounded-md text-[10px] border transition ${
                    v
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                  }`}
                >
                  {v ? "✓ " : "○ "}
                  {o.label}
                </button>
              );
            })}
          </div>
          <Input
            value={character.rigSpec?.rigAssetUrl ?? ""}
            onChange={e =>
              patch({
                rigSpec: { ...character.rigSpec, rigAssetUrl: e.target.value },
              })
            }
            placeholder="Rig 檔 URL（.fbx / .blend / .live2d）"
            className="h-7 text-xs"
          />
          <Textarea
            value={character.rigSpec?.riggerNotes ?? ""}
            onChange={e =>
              patch({
                rigSpec: { ...character.rigSpec, riggerNotes: e.target.value },
              })
            }
            placeholder="動畫師備註（已知限制、特別注意…）"
            className="min-h-[40px] text-[11px]"
          />
        </div>
      )}

      {openSection === "lipSync" && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">音素系統</Label>
              <Select
                value={character.lipSyncSet?.system ?? ""}
                onValueChange={v =>
                  patch({
                    lipSyncSet: {
                      ...character.lipSyncSet,
                      system: v as "preston_blair" | "rhubarb" | "ipa" | "custom",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {LIP_SYNC_SYSTEM_PRESETS.map(p => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">主要語言</Label>
              <Input
                value={character.lipSyncSet?.primaryLanguage ?? ""}
                onChange={e =>
                  patch({
                    lipSyncSet: {
                      ...character.lipSyncSet,
                      primaryLanguage: e.target.value,
                    },
                  })
                }
                placeholder="zh / ja / en"
                className="h-7 text-xs"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              patch({
                lipSyncSet: {
                  ...character.lipSyncSet,
                  enabled: !character.lipSyncSet?.enabled,
                  system: character.lipSyncSet?.system ?? "preston_blair",
                },
              })
            }
            className={`px-2 py-1 rounded-md text-[10px] border transition ${
              character.lipSyncSet?.enabled
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
            }`}
          >
            {character.lipSyncSet?.enabled ? "✓ 已啟用 lip sync" : "○ 啟用 lip sync"}
          </button>
          <div>
            <Label className="text-[10px] text-muted-foreground">
              口型對映（音素 → 嘴型圖 URL）
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-1 mt-1">
              {PRESTON_BLAIR_PHONEMES.map(ph => (
                <div key={ph} className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] w-10 justify-center">
                    {ph}
                  </Badge>
                  <Input
                    value={character.lipSyncSet?.shapes?.[ph] ?? ""}
                    onChange={e =>
                      patch({
                        lipSyncSet: {
                          ...character.lipSyncSet,
                          shapes: {
                            ...(character.lipSyncSet?.shapes ?? {}),
                            [ph]: e.target.value,
                          },
                        },
                      })
                    }
                    placeholder="嘴型 URL"
                    className="h-6 text-[10px] flex-1"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {openSection === "acting" && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">走路風格</Label>
              <Select
                value={character.actingNotes?.walkCycleStyle ?? ""}
                onValueChange={v =>
                  patch({
                    actingNotes: {
                      ...character.actingNotes,
                      walkCycleStyle: v,
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {WALK_CYCLE_STYLE_PRESETS.map(w => (
                    <SelectItem key={w} value={w} className="text-xs">
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">站姿</Label>
              <Input
                value={character.actingNotes?.defaultPosture ?? ""}
                onChange={e =>
                  patch({
                    actingNotes: {
                      ...character.actingNotes,
                      defaultPosture: e.target.value,
                    },
                  })
                }
                placeholder="挺直 / 駝背 / 警戒…"
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">鏡頭偏好</Label>
              <Select
                value={character.actingNotes?.cameraPreference ?? ""}
                onValueChange={v =>
                  patch({
                    actingNotes: {
                      ...character.actingNotes,
                      cameraPreference: v as "front" | "three_quarter" | "side" | "varied",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { v: "front", l: "正面" },
                    { v: "three_quarter", l: "3/4" },
                    { v: "side", l: "側面" },
                    { v: "varied", l: "多變" },
                  ].map(o => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">
                Squash / Stretch (0-1)
              </Label>
              <Input
                type="number"
                step={0.1}
                min={0}
                max={1}
                value={character.actingNotes?.squashStretch ?? 0}
                onChange={e =>
                  patch({
                    actingNotes: {
                      ...character.actingNotes,
                      squashStretch: Number(e.target.value),
                    },
                  })
                }
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">招牌動作（一行一個）</Label>
            <Textarea
              value={(character.actingNotes?.signatureGestures ?? []).join("\n")}
              onChange={e =>
                patch({
                  actingNotes: {
                    ...character.actingNotes,
                    signatureGestures: e.target.value
                      .split("\n")
                      .map(s => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="例如：撥瀏海、單手抱胸"
              className="min-h-[40px] text-[11px]"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">情緒範圍</Label>
            <Input
              value={(character.actingNotes?.emotionalRange ?? []).join("、")}
              onChange={e =>
                patch({
                  actingNotes: {
                    ...character.actingNotes,
                    emotionalRange: e.target.value
                      .split(/[、,，]/)
                      .map(s => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="開朗、克制、不會崩潰…"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">思考時習慣</Label>
            <Input
              value={(character.actingNotes?.thinkingTics ?? []).join("、")}
              onChange={e =>
                patch({
                  actingNotes: {
                    ...character.actingNotes,
                    thinkingTics: e.target.value
                      .split(/[、,，]/)
                      .map(s => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="摸下巴、咬唇、轉筆…"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">配音指導</Label>
            <Textarea
              value={character.actingNotes?.vodirection ?? ""}
              onChange={e =>
                patch({
                  actingNotes: {
                    ...character.actingNotes,
                    vodirection: e.target.value,
                  },
                })
              }
              placeholder="感情變化幅度、靜場喘息頻率、笑點處理…"
              className="min-h-[50px] text-[11px]"
            />
          </div>
        </div>
      )}

      {openSection === "ageVariants" && (
        <div className="pt-1 space-y-2">
          {(character.ageVariants ?? []).map((av, idx) => (
            <div
              key={av.id}
              className="rounded-lg border border-border/30 bg-card/30 p-2 space-y-1"
            >
              <div className="flex items-center gap-2">
                <Input
                  value={av.name}
                  onChange={e =>
                    patch({
                      ageVariants: (character.ageVariants ?? []).map((x, i) =>
                        i === idx ? { ...x, name: e.target.value } : x
                      ),
                    })
                  }
                  placeholder="變體名稱（童年 / 少年 / 老年）"
                  className="h-7 text-xs flex-1"
                />
                <Input
                  value={av.approxAge ?? ""}
                  onChange={e =>
                    patch({
                      ageVariants: (character.ageVariants ?? []).map((x, i) =>
                        i === idx ? { ...x, approxAge: e.target.value } : x
                      ),
                    })
                  }
                  placeholder="年齡"
                  className="h-7 text-xs w-24"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    patch({
                      ageVariants: (character.ageVariants ?? []).filter(
                        (_, i) => i !== idx
                      ),
                    })
                  }
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  aria-label="刪除年齡變體"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <Textarea
                value={av.description ?? ""}
                onChange={e =>
                  patch({
                    ageVariants: (character.ageVariants ?? []).map((x, i) =>
                      i === idx ? { ...x, description: e.target.value } : x
                    ),
                  })
                }
                placeholder="差異描述（髮型、身高、特徵）"
                className="min-h-[40px] text-[11px]"
              />
              <div className="flex gap-1">
                <Input
                  value={(av.imageUrls ?? []).join("\n")}
                  onChange={e =>
                    patch({
                      ageVariants: (character.ageVariants ?? []).map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              imageUrls: e.target.value
                                .split(/\s+/)
                                .filter(Boolean),
                            }
                          : x
                      ),
                    })
                  }
                  placeholder="參考圖 URL（換行分隔）"
                  className="h-7 text-[10px] flex-1"
                />
                <AssetUploader
                  accept="image/*"
                  label="上傳"
                  onUploaded={r =>
                    patch({
                      ageVariants: (character.ageVariants ?? []).map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              imageUrls: [...(x.imageUrls ?? []), r.url],
                            }
                          : x
                      ),
                    })
                  }
                />
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              patch({
                ageVariants: [
                  ...(character.ageVariants ?? []),
                  { id: uid(), name: "" },
                ],
              })
            }
            className="h-7 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" /> 新增年齡變體
          </Button>
        </div>
      )}

      {openSection === "sounds" && (
        <div className="pt-1 space-y-2">
          <p className="text-[10px] text-muted-foreground">
            非語音的聲音樣本（footsteps / 呼吸 / 笑哭怒痛）—— 給音效師混音時用。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[
              { key: "breathSample", label: "呼吸" },
              { key: "laughSample", label: "笑聲" },
              { key: "crySample", label: "哭聲" },
              { key: "shoutSample", label: "怒吼" },
              { key: "hurtSample", label: "受傷" },
              { key: "sighSample", label: "嘆息" },
            ].map(o => {
              const v = (
                character.soundProfile as Record<string, unknown> | undefined
              )?.[o.key] as string | undefined;
              return (
                <div key={o.key}>
                  <Label className="text-[10px] text-muted-foreground">{o.label}</Label>
                  <div className="flex gap-1">
                    <Input
                      value={v ?? ""}
                      onChange={e =>
                        patch({
                          soundProfile: {
                            ...character.soundProfile,
                            [o.key]: e.target.value || undefined,
                          } as WorldCharacter["soundProfile"],
                        })
                      }
                      placeholder="音檔 URL"
                      className="h-7 text-[11px] flex-1"
                    />
                    <AssetUploader
                      accept="audio/*"
                      label="上傳"
                      onUploaded={r =>
                        patch({
                          soundProfile: {
                            ...character.soundProfile,
                            [o.key]: r.url,
                          } as WorldCharacter["soundProfile"],
                        })
                      }
                    />
                    <SourcePicker
                      accept="audio/*"
                      assetKind="audio"
                      onPick={r =>
                        patch({
                          soundProfile: {
                            ...character.soundProfile,
                            [o.key]: r.url,
                          } as WorldCharacter["soundProfile"],
                        })
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">
              腳步聲（地面材質 → URL，一行一個 "材質=URL"）
            </Label>
            <Textarea
              value={Object.entries(
                character.soundProfile?.footsteps ?? {}
              )
                .map(([k, v]) => `${k}=${v}`)
                .join("\n")}
              onChange={e => {
                const next: Record<string, string> = {};
                for (const line of e.target.value.split("\n")) {
                  const [k, v] = line.split("=");
                  if (k?.trim() && v?.trim()) next[k.trim()] = v.trim();
                }
                patch({
                  soundProfile: { ...character.soundProfile, footsteps: next },
                });
              }}
              placeholder={"草地=https://...\n木地板=https://...\n石頭=https://..."}
              className="min-h-[60px] text-[10px] font-mono"
            />
          </div>
        </div>
      )}

      {openSection === "refLib" && (
        <div className="pt-1 space-y-2">
          <p className="text-[10px] text-muted-foreground">
            參考圖庫（姿勢 / 手部 / 面部特寫 / 互動）—— 動畫師作畫前的素材池。
          </p>
          {(character.referenceLibrary ?? []).map((r, idx) => (
            <div
              key={r.id}
              className="flex items-center gap-2 rounded-md border border-border/30 bg-card/30 p-1.5"
            >
              {r.imageUrl ? (
                <img
                  src={r.imageUrl}
                  alt=""
                  className="w-12 h-12 object-cover rounded"
                />
              ) : (
                <div className="w-12 h-12 rounded bg-card/40 flex items-center justify-center">
                  <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
                </div>
              )}
              <div className="flex-1 space-y-1">
                <div className="flex gap-1">
                  <Input
                    value={r.imageUrl ?? ""}
                    onChange={e =>
                      patch({
                        referenceLibrary: (character.referenceLibrary ?? []).map(
                          (x, i) => (i === idx ? { ...x, imageUrl: e.target.value } : x)
                        ),
                      })
                    }
                    placeholder="圖片 URL"
                    className="h-6 text-[10px] flex-1"
                  />
                  <AssetUploader
                    accept="image/*"
                    label="上傳"
                    onUploaded={asset =>
                      patch({
                        referenceLibrary: (character.referenceLibrary ?? []).map(
                          (x, i) => (i === idx ? { ...x, imageUrl: asset.url } : x)
                        ),
                      })
                    }
                  />
                  <SourcePicker
                    accept="image/*"
                    assetKind="image"
                    vaultItemType="character"
                    onPick={asset =>
                      patch({
                        referenceLibrary: (character.referenceLibrary ?? []).map(
                          (x, i) => (i === idx ? { ...x, imageUrl: asset.url } : x)
                        ),
                      })
                    }
                  />
                </div>
                <div className="flex gap-1">
                  <Select
                    value={r.category ?? ""}
                    onValueChange={v =>
                      patch({
                        referenceLibrary: (character.referenceLibrary ?? []).map(
                          (x, i) => (i === idx ? { ...x, category: v } : x)
                        ),
                      })
                    }
                  >
                    <SelectTrigger className="h-6 text-[10px] flex-1">
                      <SelectValue placeholder="類別" />
                    </SelectTrigger>
                    <SelectContent>
                      {["pose", "hands", "face", "dynamic", "interaction", "props"].map(
                        c => (
                          <SelectItem key={c} value={c} className="text-[10px]">
                            {c}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <Input
                    value={(r.tags ?? []).join(",")}
                    onChange={e =>
                      patch({
                        referenceLibrary: (character.referenceLibrary ?? []).map(
                          (x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  tags: e.target.value
                                    .split(/[、,，]/)
                                    .map(s => s.trim())
                                    .filter(Boolean),
                                }
                              : x
                        ),
                      })
                    }
                    placeholder="標籤"
                    className="h-6 text-[10px] flex-1"
                  />
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patch({
                    referenceLibrary: (character.referenceLibrary ?? []).filter(
                      (_, i) => i !== idx
                    ),
                  })
                }
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                aria-label="刪除參考圖"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              patch({
                referenceLibrary: [
                  ...(character.referenceLibrary ?? []),
                  { id: uid(), imageUrl: "" },
                ],
              })
            }
            className="h-7 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" /> 新增參考圖
          </Button>
        </div>
      )}

      {/* ─── v4: 真實參考 ───────────────────────────────────────────────── */}
      {openSection === "realRefs" && (
        <div className="pt-1 space-y-2">
          <p className="text-[10px] text-muted-foreground">
            真實人物 / 原型 / 聲優 / 學術參考 —— 給編劇 / 美術 / AI 代理交叉引用。
          </p>
          {(character.realWorldRefs ?? []).map((r, idx) => (
            <div
              key={r.id}
              className="rounded-lg border border-border/30 bg-card/30 p-2 space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={r.label}
                  onChange={e =>
                    patch({
                      realWorldRefs: (character.realWorldRefs ?? []).map(
                        (x, i) => (i === idx ? { ...x, label: e.target.value } : x)
                      ),
                    })
                  }
                  placeholder="參考標題（例：歷史上的奧黛麗·赫本）"
                  className="h-7 text-xs flex-1"
                />
                <Select
                  value={r.refType ?? ""}
                  onValueChange={v =>
                    patch({
                      realWorldRefs: (character.realWorldRefs ?? []).map(
                        (x, i) =>
                          i === idx
                            ? {
                                ...x,
                                refType: v as CharacterRealWorldRef["refType"],
                              }
                            : x
                      ),
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-[100px] text-xs">
                    <SelectValue placeholder="類型" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHARACTER_REF_TYPE_PRESETS.map(o => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    patch({
                      realWorldRefs: (character.realWorldRefs ?? []).filter(
                        (_, i) => i !== idx
                      ),
                    })
                  }
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <Input
                value={r.personName ?? ""}
                onChange={e =>
                  patch({
                    realWorldRefs: (character.realWorldRefs ?? []).map(
                      (x, i) =>
                        i === idx ? { ...x, personName: e.target.value } : x
                    ),
                  })
                }
                placeholder="真實人物姓名"
                className="h-7 text-[11px]"
              />
              <Input
                value={r.externalUrl ?? ""}
                onChange={e =>
                  patch({
                    realWorldRefs: (character.realWorldRefs ?? []).map(
                      (x, i) =>
                        i === idx ? { ...x, externalUrl: e.target.value } : x
                    ),
                  })
                }
                placeholder="外部連結（Wikipedia / IMDB）"
                className="h-7 text-[11px]"
              />
              <Textarea
                value={r.description ?? ""}
                onChange={e =>
                  patch({
                    realWorldRefs: (character.realWorldRefs ?? []).map(
                      (x, i) =>
                        i === idx ? { ...x, description: e.target.value } : x
                    ),
                  })
                }
                placeholder="參考點（哪裡像、靈感來源說明）"
                className="min-h-[40px] text-[11px]"
              />
              <Input
                value={r.citation ?? ""}
                onChange={e =>
                  patch({
                    realWorldRefs: (character.realWorldRefs ?? []).map(
                      (x, i) =>
                        i === idx ? { ...x, citation: e.target.value } : x
                    ),
                  })
                }
                placeholder="學術引用格式（作者, 年, 來源）"
                className="h-7 text-[10px] font-mono"
              />
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              patch({
                realWorldRefs: [
                  ...(character.realWorldRefs ?? []),
                  { id: uid(), label: "", refType: "historical_figure" },
                ],
              })
            }
            className="h-7 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" /> 新增真實參考
          </Button>
        </div>
      )}

      {/* ─── v4: 上傳資產 ───────────────────────────────────────────────── */}
      {openSection === "uploads" && (
        <div className="pt-1 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              直接上傳檔案到資產庫（圖、音、影、PDF、文件）。
            </p>
            <div className="flex gap-1">
              <AssetUploader
                accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt"
                label="上傳"
                onUploaded={r => {
                  patch({
                    uploadedAssets: [
                      ...(character.uploadedAssets ?? []),
                      {
                        id: uid(),
                        label: r.fileName,
                        assetType: inferAssetType(r.mimeType),
                        url: r.url,
                        fileKey: r.fileKey,
                        mimeType: r.mimeType,
                        sizeBytes: r.sizeBytes,
                        purpose: "reference 參考",
                        uploadedAt: new Date().toISOString(),
                      } as WorldAssetRef,
                    ],
                  });
                  toast.success(`${r.fileName} 已加入資產庫`);
                }}
              />
              <SourcePicker
                label="從來源引用"
                accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt"
                assetKind="any"
                vaultItemType="character"
                onPick={r => {
                  patch({
                    uploadedAssets: [
                      ...(character.uploadedAssets ?? []),
                      {
                        id: uid(),
                        label: r.label ?? "資產",
                        assetType: r.mimeType
                          ? inferAssetType(r.mimeType)
                          : "other",
                        url: r.url,
                        fileKey: r.fileKey,
                        mimeType: r.mimeType,
                        sizeBytes: r.sizeBytes,
                        purpose: "reference 參考",
                        uploadedAt: new Date().toISOString(),
                      } as WorldAssetRef,
                    ],
                  });
                  toast.success(`${r.label ?? "資產"} 已加入資產庫`);
                }}
              />
            </div>
          </div>
          {(character.uploadedAssets ?? []).map((a, idx) => (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-border/30 bg-card/30 p-1.5"
            >
              {a.assetType === "image" ? (
                <img
                  src={a.url}
                  alt={a.label}
                  className="w-10 h-10 object-cover rounded"
                />
              ) : a.assetType === "audio" ? (
                <FileAudio className="w-8 h-8 text-muted-foreground" />
              ) : (
                <Badge variant="outline" className="text-[9px]">
                  {a.assetType}
                </Badge>
              )}
              <div className="flex-1 min-w-0">
                <Input
                  value={a.label}
                  onChange={e =>
                    patch({
                      uploadedAssets: (character.uploadedAssets ?? []).map(
                        (x, i) => (i === idx ? { ...x, label: e.target.value } : x)
                      ),
                    })
                  }
                  className="h-6 text-[10px]"
                />
                <div className="flex items-center gap-1 mt-0.5">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="text-[10px] text-primary hover:underline"
                  >
                    下載
                  </a>
                  <span className="text-[9px] text-muted-foreground">
                    {a.sizeBytes
                      ? `${(a.sizeBytes / 1024).toFixed(1)} KB`
                      : "—"}{" "}
                    · {a.mimeType ?? a.assetType}
                  </span>
                </div>
              </div>
              <Select
                value={a.purpose ?? ""}
                onValueChange={v =>
                  patch({
                    uploadedAssets: (character.uploadedAssets ?? []).map(
                      (x, i) => (i === idx ? { ...x, purpose: v } : x)
                    ),
                  })
                }
              >
                <SelectTrigger className="h-6 w-[80px] text-[10px]">
                  <SelectValue placeholder="用途" />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_PURPOSE_PRESETS.map(p => (
                    <SelectItem key={p} value={p} className="text-[10px]">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patch({
                    uploadedAssets: (character.uploadedAssets ?? []).filter(
                      (_, i) => i !== idx
                    ),
                  })
                }
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ─── v4: 訓練 LoRA 快速連結 ─────────────────────────────────────── */}
      {openSection === "train" && (
        <TrainCharacterLoraSection character={character} />
      )}
    </div>
  );
});

// ─── 訓練 LoRA 子元件（v4） ────────────────────────────────────────────────

function TrainCharacterLoraSection({
  character,
}: {
  character: WorldCharacter;
}) {
  const [, navigate] = useLocation();
  // 蒐集所有可用於訓練的圖像 URL：三視圖 + 表情 + 穿衣 + 參考圖庫
  const seedImages: string[] = [];
  const tv = character.threeViewSheet;
  if (tv?.frontImageUrl) seedImages.push(tv.frontImageUrl);
  if (tv?.sideImageUrl) seedImages.push(tv.sideImageUrl);
  if (tv?.backImageUrl) seedImages.push(tv.backImageUrl);
  if (tv?.threeQuarterImageUrl) seedImages.push(tv.threeQuarterImageUrl);
  for (const e of character.expressions ?? [])
    if (e.imageUrl) seedImages.push(e.imageUrl);
  for (const o of character.outfits ?? [])
    if (o.imageUrl) seedImages.push(o.imageUrl);
  for (const r of character.referenceLibrary ?? [])
    if (r.imageUrl) seedImages.push(r.imageUrl);
  for (const a of character.uploadedAssets ?? [])
    if (a.assetType === "image") seedImages.push(a.url);
  const uniqueSeed = Array.from(new Set(seedImages));

  const handleTrain = () => {
    const params = new URLSearchParams();
    if (character.name) params.set("modelName", `${character.name}_lora`);
    if (character.triggerWord)
      params.set(
        "triggerWord",
        character.triggerWord || `sks_${character.name.toLowerCase()}`
      );
    params.set(
      "description",
      [character.tagline, character.appearance].filter(Boolean).join("，")
    );
    params.set("trainingType", "image_subject");
    if (uniqueSeed.length > 0)
      params.set("seedImages", uniqueSeed.slice(0, 30).join(","));
    navigate(`/lora-trainer?${params.toString()}`);
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        以此角色現有的{" "}
        <span className="font-mono text-primary">{uniqueSeed.length}</span>{" "}
        張圖（三視圖 + 表情 + 穿衣 + 參考圖庫 + 上傳資產）為素材，
        跳轉到模型訓練中心開始訓練專屬 LoRA。完成後角色 ID 會自動連結回來。
      </p>
      <Button
        size="sm"
        onClick={handleTrain}
        disabled={uniqueSeed.length === 0}
        className="h-8 text-xs"
      >
        <GraduationCap className="w-3.5 h-3.5 mr-1" />
        在訓練中心訓練此角色（{uniqueSeed.length} 張素材）
      </Button>
      {uniqueSeed.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic">
          先到「三視圖」「表情包」「參考圖庫」「上傳資產」加圖。
        </p>
      )}
    </div>
  );
}

// ─── 風格 profile 編輯 ─────────────────────────────────────────────────────

const StyleProfileCard = memo(function StyleProfileCard({
  profile,
  isDefault,
  onChange,
  onSetDefault,
  onDelete,
}: {
  profile: WorldStyleProfile;
  isDefault: boolean;
  onChange: (next: WorldStyleProfile) => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const patch = (p: Partial<WorldStyleProfile>) => onChange({ ...profile, ...p });
  return (
    <div className="rounded-lg border border-border/30 bg-card/30 p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <Layers className="w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={profile.name}
          onChange={e => patch({ name: e.target.value })}
          placeholder="風格名稱（如：日常風 / 戰鬥風）"
          className="h-7 text-xs flex-1"
        />
        <Button
          variant={isDefault ? "default" : "ghost"}
          size="sm"
          onClick={onSetDefault}
          className="h-7 px-2 text-[10px]"
        >
          {isDefault ? "預設" : "設為預設"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          aria-label="刪除風格"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={profile.artStyle ?? ""}
          onValueChange={v => patch({ artStyle: v })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="繪風" />
          </SelectTrigger>
          <SelectContent>
            {ART_STYLE_PRESETS.map(s => (
              <SelectItem key={s} value={s} className="text-xs">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={profile.lighting ?? ""}
          onChange={e => patch({ lighting: e.target.value })}
          placeholder="燈光（高調 / 倫勃朗 / 邊緣光）"
          className="h-7 text-xs"
        />
        <Input
          value={profile.lensSpec?.aspectRatio ?? ""}
          onChange={e =>
            patch({
              lensSpec: { ...profile.lensSpec, aspectRatio: e.target.value },
            })
          }
          placeholder="比例 16:9"
          className="h-7 text-xs"
        />
        <Input
          type="number"
          value={profile.fps ?? 24}
          onChange={e => patch({ fps: Number(e.target.value) })}
          placeholder="FPS"
          className="h-7 text-xs"
        />
      </div>
      <Input
        value={profile.triggerWord ?? ""}
        onChange={e => patch({ triggerWord: e.target.value })}
        placeholder="風格 LoRA trigger word"
        className="h-7 text-xs"
      />
      <Input
        value={profile.negativePrompt ?? ""}
        onChange={e => patch({ negativePrompt: e.target.value })}
        placeholder="風格負面詞（避免 watermark / 多餘指頭…）"
        className="h-7 text-xs"
      />
      <Textarea
        value={(profile.palette ?? []).join("、")}
        onChange={e =>
          patch({
            palette: e.target.value
              .split(/[、,，]/)
              .map(s => s.trim())
              .filter(Boolean),
          })
        }
        placeholder="色票（#ffe1a8、深綠絨布）"
        className="min-h-[40px] text-[11px]"
      />

      {/* ─── v3 動畫製作專業技術欄位 ──────────────────────────────────── */}
      <Collapsible>
        <CollapsibleTrigger className="text-[11px] text-primary flex items-center gap-1 hover:underline">
          <ChevronDown className="w-3 h-3" />
          進階：拍格制 / 流派 / 著色 / 合成 / 色彩空間 / 解析度
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Shoot on Ns</Label>
              <Select
                value={String(profile.shootOn ?? "")}
                onValueChange={v =>
                  patch({ shootOn: Number(v) as 1 | 2 | 3 | 4 })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map(n => (
                    <SelectItem key={n} value={String(n)} className="text-xs">
                      Shoot on {n}（{n === 1 ? "全動畫" : `每 ${n} 格一張`}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">流派</Label>
              <Select
                value={profile.schoolReference ?? ""}
                onValueChange={v => patch({ schoolReference: v })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {ANIMATION_SCHOOL_PRESETS.map(s => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">著色模型</Label>
              <Select
                value={profile.shadingModel ?? ""}
                onValueChange={v =>
                  patch({
                    shadingModel: v as "cel" | "painted" | "flat" | "gradient" | "3d_toon" | "watercolor",
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {SHADING_MODEL_PRESETS.map(s => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">色彩空間</Label>
              <Select
                value={profile.colorSpace ?? ""}
                onValueChange={v =>
                  patch({
                    colorSpace: v as "sRGB" | "Rec709" | "DCI_P3" | "Rec2020" | "ACES",
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {COLOR_SPACE_PRESETS.map(s => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Master 解析度</Label>
              <Select
                value={profile.masterResolution ?? ""}
                onValueChange={v =>
                  patch({
                    masterResolution: v as "720p" | "1080p" | "1440p" | "4K" | "8K",
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {MASTER_RESOLUTION_PRESETS.map(s => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Codec</Label>
              <Select
                value={profile.masterCodec ?? ""}
                onValueChange={v =>
                  patch({
                    masterCodec: v as "ProRes" | "DNxHR" | "H264" | "H265" | "VP9" | "AV1",
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {MASTER_CODEC_PRESETS.map(s => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">合成 pass</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {COMPOSITING_PASS_PRESETS.map(p => {
                const active = (profile.compositingPasses ?? []).includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      const cur = profile.compositingPasses ?? [];
                      patch({
                        compositingPasses: active
                          ? cur.filter(x => x !== p)
                          : [...cur, p],
                      });
                    }}
                    className={`px-1.5 py-0.5 rounded-full text-[10px] border transition ${
                      active
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                    }`}
                  >
                    {active ? "✓ " : "+ "}
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">線條風格</Label>
              <Select
                value={profile.lineSpec?.lineStyle ?? ""}
                onValueChange={v =>
                  patch({
                    lineSpec: {
                      ...profile.lineSpec,
                      lineStyle: v as "clean" | "sketchy" | "boil" | "varied",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { v: "clean", l: "Clean 乾淨" },
                    { v: "sketchy", l: "Sketchy 草稿感" },
                    { v: "boil", l: "Boil 線條沸騰" },
                    { v: "varied", l: "Varied 粗細變化" },
                  ].map(o => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">線條粗細 px</Label>
              <Input
                type="number"
                value={profile.lineSpec?.weight ?? 0}
                onChange={e =>
                  patch({
                    lineSpec: {
                      ...profile.lineSpec,
                      weight: Number(e.target.value),
                    },
                  })
                }
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">線條色</Label>
              <Input
                value={profile.lineSpec?.lineColor ?? ""}
                onChange={e =>
                  patch({
                    lineSpec: {
                      ...profile.lineSpec,
                      lineColor: e.target.value,
                    },
                  })
                }
                placeholder="#000000"
                className="h-7 text-xs font-mono"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">外框色</Label>
              <Input
                value={profile.lineSpec?.outlineColor ?? ""}
                onChange={e =>
                  patch({
                    lineSpec: {
                      ...profile.lineSpec,
                      outlineColor: e.target.value,
                    },
                  })
                }
                placeholder="#222222"
                className="h-7 text-xs font-mono"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

// ─── 配樂主題編輯 ──────────────────────────────────────────────────────────

const MusicThemeCard = memo(function MusicThemeCard({
  theme,
  onChange,
  onDelete,
}: {
  theme: WorldMusicTheme;
  onChange: (next: WorldMusicTheme) => void;
  onDelete: () => void;
}) {
  const patch = (p: Partial<WorldMusicTheme>) => onChange({ ...theme, ...p });
  return (
    <div className="rounded-lg border border-border/30 bg-card/30 p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <Music className="w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={theme.name}
          onChange={e => patch({ name: e.target.value })}
          placeholder="主題名稱（主角主題 / 戰鬥主題…）"
          className="h-7 text-xs flex-1"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          aria-label="刪除配樂主題"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Select
          value={theme.mood ?? ""}
          onValueChange={v => patch({ mood: v })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="情緒" />
          </SelectTrigger>
          <SelectContent>
            {MUSIC_MOOD_PRESETS.map(m => (
              <SelectItem key={m} value={m} className="text-xs">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          value={theme.bpm ?? 0}
          onChange={e => patch({ bpm: Number(e.target.value) })}
          placeholder="BPM"
          className="h-7 text-xs"
        />
        <Input
          value={theme.key ?? ""}
          onChange={e => patch({ key: e.target.value })}
          placeholder="調性 / C 大調"
          className="h-7 text-xs"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {MUSIC_INSTRUMENT_PRESETS.map(ins => {
          const active = (theme.instruments ?? []).includes(ins);
          return (
            <button
              key={ins}
              type="button"
              onClick={() => {
                const cur = theme.instruments ?? [];
                patch({
                  instruments: active
                    ? cur.filter(x => x !== ins)
                    : [...cur, ins],
                });
              }}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                active
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
              }`}
            >
              {active ? "✓ " : "+ "}
              {ins}
            </button>
          );
        })}
      </div>
      <Input
        value={theme.sampleAudioUrl ?? ""}
        onChange={e => patch({ sampleAudioUrl: e.target.value })}
        placeholder="試聽 URL"
        className="h-7 text-xs"
      />

      {/* ─── v3 配樂專業欄位 ───────────────────────────────────────────── */}
      <Collapsible>
        <CollapsibleTrigger className="text-[11px] text-primary flex items-center gap-1 hover:underline">
          <ChevronDown className="w-3 h-3" />
          進階：Leitmotif / Cue 變體 / Stems / LUFS / 轉接
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">
              Leitmotif 主題動機（文字描述或音符）
            </Label>
            <Textarea
              value={theme.leitmotif?.description ?? ""}
              onChange={e =>
                patch({
                  leitmotif: {
                    ...theme.leitmotif,
                    description: e.target.value,
                  },
                })
              }
              placeholder="例如：上行小三度 → 下行純五度，象徵成長"
              className="min-h-[40px] text-[11px]"
            />
            <Input
              value={theme.leitmotif?.melodicPhrase ?? ""}
              onChange={e =>
                patch({
                  leitmotif: {
                    ...theme.leitmotif,
                    melodicPhrase: e.target.value,
                  },
                })
              }
              placeholder="旋律（如 C-E-G-A）"
              className="h-7 text-[11px] mt-1 font-mono"
            />
            <Input
              value={theme.leitmotif?.midiUrl ?? ""}
              onChange={e =>
                patch({
                  leitmotif: { ...theme.leitmotif, midiUrl: e.target.value },
                })
              }
              placeholder="MIDI / musicXML URL"
              className="h-7 text-[11px] mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">LUFS 響度目標</Label>
              <Select
                value={String(theme.lufsTarget ?? "")}
                onValueChange={v => patch({ lufsTarget: Number(v) })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {LUFS_TARGET_PRESETS.map(p => (
                    <SelectItem
                      key={p.value}
                      value={String(p.value)}
                      className="text-xs"
                    >
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">轉接風格</Label>
              <Select
                value={theme.transitionStyle ?? ""}
                onValueChange={v =>
                  patch({
                    transitionStyle: v as "crossfade" | "hard_cut" | "sting" | "morphing",
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  {TRANSITION_STYLE_MUSIC_PRESETS.map(p => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-[10px] text-muted-foreground">Stems（分軌 URL）</Label>
            <div className="grid grid-cols-2 gap-1 mt-1">
              {[
                ["drums", "鼓"],
                ["bass", "貝斯"],
                ["melody", "旋律"],
                ["harmony", "和聲"],
                ["pads", "Pad"],
                ["fx", "FX"],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] w-10 justify-center">
                    {label}
                  </Badge>
                  <Input
                    value={
                      (theme.stems as Record<string, string> | undefined)?.[key] ??
                      ""
                    }
                    onChange={e =>
                      patch({
                        stems: {
                          ...theme.stems,
                          [key]: e.target.value || undefined,
                        } as WorldMusicTheme["stems"],
                      })
                    }
                    placeholder="URL"
                    className="h-6 text-[10px] flex-1"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-[10px] text-muted-foreground">
              Cue 長度變體（剪輯快套）
            </Label>
            {(theme.cueVariants ?? []).map((cv, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_60px_1.4fr_auto] gap-1 mt-1 items-center">
                <Input
                  value={cv.label}
                  onChange={e =>
                    patch({
                      cueVariants: (theme.cueVariants ?? []).map((x, i) =>
                        i === idx ? { ...x, label: e.target.value } : x
                      ),
                    })
                  }
                  placeholder="標籤"
                  className="h-7 text-[10px]"
                />
                <Input
                  type="number"
                  value={cv.durationSec}
                  onChange={e =>
                    patch({
                      cueVariants: (theme.cueVariants ?? []).map((x, i) =>
                        i === idx
                          ? { ...x, durationSec: Number(e.target.value) }
                          : x
                      ),
                    })
                  }
                  placeholder="秒"
                  className="h-7 text-[10px]"
                />
                <div className="flex gap-1">
                  <Input
                    value={cv.audioUrl ?? ""}
                    onChange={e =>
                      patch({
                        cueVariants: (theme.cueVariants ?? []).map((x, i) =>
                          i === idx ? { ...x, audioUrl: e.target.value } : x
                        ),
                      })
                    }
                    placeholder="音檔 URL"
                    className="h-7 text-[10px] flex-1"
                  />
                  <AssetUploader
                    accept="audio/*"
                    label="上傳"
                    onUploaded={r =>
                      patch({
                        cueVariants: (theme.cueVariants ?? []).map((x, i) =>
                          i === idx ? { ...x, audioUrl: r.url } : x
                        ),
                      })
                    }
                  />
                  <SourcePicker
                    accept="audio/*"
                    assetKind="audio"
                    onPick={r =>
                      patch({
                        cueVariants: (theme.cueVariants ?? []).map((x, i) =>
                          i === idx ? { ...x, audioUrl: r.url } : x
                        ),
                      })
                    }
                  />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      patch({
                        cueVariants: (theme.cueVariants ?? []).map((x, i) =>
                          i === idx ? { ...x, loopable: !x.loopable } : x
                        ),
                      })
                    }
                    className={`flex-1 px-1 py-0.5 rounded text-[9px] border ${
                      cv.loopable
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/40 bg-card/30 text-muted-foreground"
                    }`}
                  >
                    {cv.loopable ? "✓ Loop" : "Loop"}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      patch({
                        cueVariants: (theme.cueVariants ?? []).filter(
                          (_, i) => i !== idx
                        ),
                      })
                    }
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({
                  cueVariants: [
                    ...(theme.cueVariants ?? []),
                    { label: "", durationSec: 30 },
                  ],
                })
              }
              className="h-7 text-xs mt-1"
            >
              <Plus className="w-3 h-3 mr-1" /> 新增 Cue 變體
            </Button>
          </div>

          <div>
            <Label className="text-[10px] text-muted-foreground">
              Stinger 命中點（秒，逗號分隔；剪輯對齊用）
            </Label>
            <Input
              value={(theme.stingerPoints ?? []).join(", ")}
              onChange={e =>
                patch({
                  stingerPoints: e.target.value
                    .split(/[、,，]/)
                    .map(s => Number(s.trim()))
                    .filter(n => !isNaN(n) && n >= 0),
                })
              }
              placeholder="例如：0.5, 4.2, 8.0"
              className="h-7 text-xs font-mono"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

// ─── 分鏡列表 + 時間軸預覽 ────────────────────────────────────────────────

const StoryboardTimelinePreview = memo(function StoryboardTimelinePreview({
  storyboard,
  framework,
}: {
  storyboard: WorldStoryboard;
  framework: WorldbuildingFrameworkData;
}) {
  const total = storyboard.totalDurationSec;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          總長 {formatTimecode(total)} · {storyboard.fps}fps · {storyboard.aspectRatio}
        </span>
        <span className="text-muted-foreground">
          {storyboard.scenes.length} 場 ·{" "}
          {storyboard.scenes.reduce((a, s) => a + s.frames.length, 0)} 圖楨
        </span>
      </div>

      {/* Timeline ruler */}
      <div className="relative h-6 rounded bg-muted/30 overflow-hidden">
        {storyboard.scenes.map(sc => {
          const left = (sc.startSec / total) * 100;
          const width = ((sc.endSec - sc.startSec) / total) * 100;
          return (
            <div
              key={sc.id}
              className="absolute top-0 bottom-0 border-r border-border/40 bg-primary/15 flex items-center justify-center"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`#${sc.sequenceIndex + 1} ${formatTimecode(sc.startSec)}–${formatTimecode(sc.endSec)}`}
            >
              <span className="text-[10px] font-mono">
                #{sc.sequenceIndex + 1}
              </span>
            </div>
          );
        })}
      </div>

      {/* Per-scene details */}
      <div className="space-y-1">
        {storyboard.scenes.map(sc => {
          const worldScene = framework.scenes.find(s => s.id === sc.worldSceneId);
          const audioMusic = sc.audioClips.find(a => a.kind === "music");
          const audioVo = sc.audioClips.filter(a => a.kind === "voiceover");
          return (
            <div
              key={sc.id}
              className="rounded-md border border-border/30 bg-card/20 p-2 text-[11px] space-y-0.5"
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px]">
                  #{sc.sequenceIndex + 1}
                </Badge>
                <span className="font-mono text-muted-foreground">
                  {formatTimecode(sc.startSec)}–{formatTimecode(sc.endSec)}
                </span>
                <span>· {worldScene?.name ?? "—"}</span>
                <Badge variant="secondary" className="text-[9px]">
                  {sc.status}
                </Badge>
              </div>
              {sc.characterBeats.length > 0 && (
                <div className="text-muted-foreground">
                  角色：
                  {sc.characterBeats
                    .map(
                      b =>
                        framework.characters.find(c => c.id === b.characterId)?.name ??
                        "?"
                    )
                    .join("、")}
                </div>
              )}
              {sc.actionDescription && (
                <div className="text-muted-foreground italic">
                  動作：{sc.actionDescription}
                </div>
              )}
              {audioMusic && (
                <div className="text-muted-foreground">
                  <Music className="w-2.5 h-2.5 inline mr-1" />
                  {framework.musicThemes?.find(m => m.id === audioMusic.musicThemeId)
                    ?.name ?? "—"}
                </div>
              )}
              {audioVo.length > 0 && (
                <div className="text-muted-foreground">
                  <Mic className="w-2.5 h-2.5 inline mr-1" />
                  {audioVo.length} 段配音
                </div>
              )}
              <div className="text-muted-foreground">
                圖楨：{sc.frames.length} 格（
                {
                  sc.frames.filter(f => f.status === "i2v_done").length
                }
                /{sc.frames.length} 已轉影）
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─── 世界觀基本資料編輯器（從導演 AI 融合過來） ───────────────────────────

const WorldBasicsEditor = memo(function WorldBasicsEditor({
  world,
  onPatch,
}: {
  world: WorldbuildingFrameworkData & { id?: number };
  onPatch: (p: Partial<WorldbuildingFrameworkData>) => void;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-1">
        <Sparkles className="w-3.5 h-3.5" /> 世界觀基本資料
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">名稱</Label>
          <Input
            value={world.name ?? ""}
            onChange={e => onPatch({ name: e.target.value })}
            placeholder="例如：苔森紀年"
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">類型 / 風格</Label>
          <Input
            value={world.genre ?? ""}
            onChange={e => onPatch({ genre: e.target.value })}
            placeholder="療癒奇幻、賽博龐克、日常…"
            className="h-7 text-xs"
          />
          <div className="flex flex-wrap gap-1 mt-1">
            {GENRE_PRESETS.map(g => (
              <button
                key={g}
                type="button"
                onClick={() => onPatch({ genre: g })}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                  world.genre === g
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">時代背景</Label>
          <Input
            value={world.era ?? ""}
            onChange={e => onPatch({ era: e.target.value })}
            placeholder="中世紀、近未來、架空…"
            className="h-7 text-xs"
          />
          <div className="flex flex-wrap gap-1 mt-1">
            {ERA_PRESETS.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => onPatch({ era: e })}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                  world.era === e
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">描述（世界規則、基調、設定）</Label>
        <Textarea
          value={world.description ?? ""}
          onChange={e => onPatch({ description: e.target.value })}
          placeholder="這個世界的核心設定、規則、基調…"
          className="min-h-[50px] text-xs"
        />
      </div>
    </div>
  );
});

// ─── 製作管線編輯（v3：里程碑、credits、Master 規格） ─────────────────────

const ProductionManifestEditor = memo(function ProductionManifestEditor({
  world,
  onPatch,
}: {
  world: WorldbuildingFrameworkData & { id?: number };
  onPatch: (p: Partial<WorldbuildingFrameworkData>) => void;
}) {
  const targets = world.productionTargets ?? {};
  const setTargets = (p: Partial<typeof targets>) =>
    onPatch({ productionTargets: { ...targets, ...p } });

  return (
    <div className="space-y-3">
      {/* Master 技術規格 */}
      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <Film className="w-3.5 h-3.5" /> Master 技術規格
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">解析度</Label>
            <Select
              value={targets.masterSpec?.resolution ?? ""}
              onValueChange={v =>
                setTargets({
                  masterSpec: { ...targets.masterSpec, resolution: v },
                })
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="選擇" />
              </SelectTrigger>
              <SelectContent>
                {MASTER_RESOLUTION_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">FPS</Label>
            <Input
              type="number"
              value={targets.masterSpec?.fps ?? 24}
              onChange={e =>
                setTargets({
                  masterSpec: {
                    ...targets.masterSpec,
                    fps: Number(e.target.value),
                  },
                })
              }
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">色彩空間</Label>
            <Select
              value={targets.masterSpec?.colorSpace ?? ""}
              onValueChange={v =>
                setTargets({
                  masterSpec: { ...targets.masterSpec, colorSpace: v },
                })
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="選擇" />
              </SelectTrigger>
              <SelectContent>
                {COLOR_SPACE_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">音訊聲道</Label>
            <Select
              value={targets.masterSpec?.audioChannels ?? ""}
              onValueChange={v =>
                setTargets({
                  masterSpec: {
                    ...targets.masterSpec,
                    audioChannels: v as "mono" | "stereo" | "5.1" | "7.1" | "atmos",
                  },
                })
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="選擇" />
              </SelectTrigger>
              <SelectContent>
                {["mono", "stereo", "5.1", "7.1", "atmos"].map(c => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            setTargets({
              masterSpec: {
                ...targets.masterSpec,
                hdr: !targets.masterSpec?.hdr,
              },
            })
          }
          className={`px-2 py-1 rounded-md text-[10px] border transition ${
            targets.masterSpec?.hdr
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
          }`}
        >
          {targets.masterSpec?.hdr ? "✓ HDR" : "○ HDR"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">分級</Label>
            <Input
              value={targets.rating ?? ""}
              onChange={e => setTargets({ rating: e.target.value })}
              placeholder="G / PG / PG-13 / R"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">預算 USD</Label>
            <Input
              type="number"
              value={targets.budgetUsd ?? 0}
              onChange={e =>
                setTargets({ budgetUsd: Number(e.target.value) })
              }
              className="h-7 text-xs"
            />
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">交付清單</Label>
          <Input
            value={(targets.deliverables ?? []).join("、")}
            onChange={e =>
              setTargets({
                deliverables: e.target.value
                  .split(/[、,，]/)
                  .map(s => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Master ProRes、Proxy H.264、預告 15s、縮圖…"
            className="h-7 text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">字幕語言</Label>
            <Input
              value={(targets.subtitleLanguages ?? []).join("、")}
              onChange={e =>
                setTargets({
                  subtitleLanguages: e.target.value
                    .split(/[、,，]/)
                    .map(s => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="zh-TW、en、ja"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">配音語言</Label>
            <Input
              value={(targets.dubLanguages ?? []).join("、")}
              onChange={e =>
                setTargets({
                  dubLanguages: e.target.value
                    .split(/[、,，]/)
                    .map(s => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="zh-TW、ja"
              className="h-7 text-xs"
            />
          </div>
        </div>
      </div>

      {/* 製作里程碑 */}
      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" /> 製作里程碑
        </h3>
        {(targets.milestones ?? []).map((m, idx) => (
          <div
            key={m.id}
            className="rounded-md border border-border/30 bg-card/30 p-2 space-y-1.5"
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-1">
              <Select
                value={m.stage}
                onValueChange={v =>
                  setTargets({
                    milestones: (targets.milestones ?? []).map((x, i) =>
                      i === idx ? { ...x, stage: v } : x
                    ),
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="階段" />
                </SelectTrigger>
                <SelectContent>
                  {MILESTONE_STAGE_PRESETS.map(s => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={m.title}
                onChange={e =>
                  setTargets({
                    milestones: (targets.milestones ?? []).map((x, i) =>
                      i === idx ? { ...x, title: e.target.value } : x
                    ),
                  })
                }
                placeholder="任務"
                className="h-7 text-xs"
              />
              <Input
                type="date"
                value={m.dueDate ?? ""}
                onChange={e =>
                  setTargets({
                    milestones: (targets.milestones ?? []).map((x, i) =>
                      i === idx ? { ...x, dueDate: e.target.value } : x
                    ),
                  })
                }
                className="h-7 text-xs"
              />
              <Select
                value={m.status ?? "pending"}
                onValueChange={v =>
                  setTargets({
                    milestones: (targets.milestones ?? []).map((x, i) =>
                      i === idx
                        ? {
                            ...x,
                            status: v as "pending" | "in_progress" | "completed" | "blocked",
                          }
                        : x
                    ),
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { v: "pending", l: "待辦" },
                    { v: "in_progress", l: "進行中" },
                    { v: "completed", l: "已完成" },
                    { v: "blocked", l: "卡住" },
                  ].map(o => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={m.owner ?? ""}
                onChange={e =>
                  setTargets({
                    milestones: (targets.milestones ?? []).map((x, i) =>
                      i === idx ? { ...x, owner: e.target.value } : x
                    ),
                  })
                }
                placeholder="負責人"
                className="h-7 text-xs flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setTargets({
                    milestones: (targets.milestones ?? []).filter(
                      (_, i) => i !== idx
                    ),
                  })
                }
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setTargets({
              milestones: [
                ...(targets.milestones ?? []),
                {
                  id: uid(),
                  stage: "Pre-Production 前期",
                  title: "",
                  status: "pending" as const,
                },
              ],
            })
          }
          className="h-7 text-xs"
        >
          <Plus className="w-3 h-3 mr-1" /> 新增里程碑
        </Button>
      </div>

      {/* Credits */}
      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <Users className="w-3.5 h-3.5" /> 工作人員 Credits
        </h3>
        {(targets.credits ?? []).map((c, idx) => (
          <div
            key={c.id}
            className="grid grid-cols-1 md:grid-cols-4 gap-1 items-center"
          >
            <Select
              value={c.role}
              onValueChange={v =>
                setTargets({
                  credits: (targets.credits ?? []).map((x, i) =>
                    i === idx ? { ...x, role: v } : x
                  ),
                })
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="職稱" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTION_ROLE_PRESETS.map(r => (
                  <SelectItem key={r} value={r} className="text-xs">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={c.name}
              onChange={e =>
                setTargets({
                  credits: (targets.credits ?? []).map((x, i) =>
                    i === idx ? { ...x, name: e.target.value } : x
                  ),
                })
              }
              placeholder="姓名"
              className="h-7 text-xs"
            />
            <Input
              value={c.link ?? ""}
              onChange={e =>
                setTargets({
                  credits: (targets.credits ?? []).map((x, i) =>
                    i === idx ? { ...x, link: e.target.value } : x
                  ),
                })
              }
              placeholder="連結（IMDB / 社群）"
              className="h-7 text-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setTargets({
                  credits: (targets.credits ?? []).filter((_, i) => i !== idx),
                })
              }
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setTargets({
              credits: [
                ...(targets.credits ?? []),
                { id: uid(), role: "導演", name: "" },
              ],
            })
          }
          className="h-7 text-xs"
        >
          <Plus className="w-3 h-3 mr-1" /> 新增 Credit
        </Button>
      </div>
    </div>
  );
});

// ─── 場景卡（基本 + 動畫設定融合） ────────────────────────────────────────

const SceneCard = memo(function SceneCard({
  scene,
  styleProfiles,
  musicThemes,
  models,
  onChange,
  onDelete,
}: {
  scene: WorldScene;
  styleProfiles: WorldStyleProfile[];
  musicThemes: WorldMusicTheme[];
  models: Array<{
    id: number;
    name: string;
    modelType: string;
    triggerWord: string | null;
  }>;
  onChange: (next: WorldScene) => void;
  onDelete: () => void;
}) {
  const patch = (p: Partial<WorldScene>) => onChange({ ...scene, ...p });
  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase gap-1">
          <MapPin className="w-3 h-3" /> 場景
        </Badge>
        <Input
          value={scene.name}
          onChange={e => patch({ name: e.target.value })}
          placeholder="場景名稱（例：晨霧中的療癒森林）"
          className="h-7 text-xs flex-1 font-medium"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          aria-label="刪除場景"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      <Input
        value={scene.tagline ?? ""}
        onChange={e => patch({ tagline: e.target.value })}
        placeholder="一句話氛圍（濕潤、靜謐、微光穿過樹葉）"
        className="h-7 text-xs"
      />

      {/* 即時環境視覺預覽 */}
      <SceneEnvironmentPreview scene={scene} className="my-2" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">環境</Label>
          <Textarea
            value={scene.environment ?? ""}
            onChange={e => patch({ environment: e.target.value })}
            placeholder="地點、季節、天氣、時間…"
            className="min-h-[40px] text-[11px]"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">光線</Label>
          <Input
            value={scene.lighting ?? ""}
            onChange={e => patch({ lighting: e.target.value })}
            placeholder="光源方向、色溫、明暗對比"
            className="h-7 text-[11px]"
          />
          <div className="flex flex-wrap gap-1 mt-1">
            {SCENE_LIGHTING_PRESETS.map(l => (
              <button
                key={l}
                type="button"
                onClick={() => patch({ lighting: l })}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                  scene.lighting === l
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">氛圍</Label>
          <Input
            value={scene.mood ?? ""}
            onChange={e => patch({ mood: e.target.value })}
            placeholder="情緒基調"
            className="h-7 text-[11px]"
          />
          <div className="flex flex-wrap gap-1 mt-1">
            {SCENE_MOOD_PRESETS.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => patch({ mood: m })}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                  scene.mood === m
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">預設運鏡</Label>
          <Select
            value={scene.defaultCameraMovement ?? ""}
            onValueChange={v => patch({ defaultCameraMovement: v })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="選擇" />
            </SelectTrigger>
            <SelectContent>
              {CAMERA_MOVEMENT_PRESETS.map(c => (
                <SelectItem key={c} value={c} className="text-xs">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">環境變化（換行分隔）</Label>
        <Textarea
          value={(scene.environmentChanges ?? []).join("\n")}
          onChange={e =>
            patch({
              environmentChanges: e.target.value
                .split("\n")
                .map(s => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="例如：黃昏起霧、夜晚螢火蟲飛舞"
          className="min-h-[40px] text-[11px]"
        />
        <div className="flex flex-wrap gap-1 mt-1">
          {ENVIRONMENT_CHANGE_PRESETS.map(ec => {
            const active = (scene.environmentChanges ?? []).includes(ec);
            return (
              <button
                key={ec}
                type="button"
                onClick={() => {
                  const cur = scene.environmentChanges ?? [];
                  patch({
                    environmentChanges: active
                      ? cur.filter(x => x !== ec)
                      : [...cur, ec],
                  });
                }}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                }`}
              >
                {active ? "✓ " : "+ "}
                {ec}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">花草樹木（逗號分隔）</Label>
          <Input
            value={(scene.flora ?? []).join("、")}
            onChange={e =>
              patch({
                flora: e.target.value
                  .split(/[、,，]/)
                  .map(s => s.trim())
                  .filter(Boolean),
              })
            }
            className="h-7 text-[11px]"
            placeholder="蕨類、苔蘚、銀杏…"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">物件 / 道具</Label>
          <Input
            value={(scene.props ?? []).join("、")}
            onChange={e =>
              patch({
                props: e.target.value
                  .split(/[、,，]/)
                  .map(s => s.trim())
                  .filter(Boolean),
              })
            }
            className="h-7 text-[11px]"
            placeholder="石燈、木椅、信件…"
          />
        </div>
      </div>

      {/* 動畫專屬：establishingShot、時段表、風格鎖、配樂鎖 */}
      <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-2 space-y-1.5">
        <span className="text-[10px] font-medium text-primary/80 flex items-center gap-1">
          <Film className="w-3 h-3" /> 動畫專屬設定
        </span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">建場圖 URL</Label>
            <Input
              value={scene.establishingShotUrl ?? ""}
              onChange={e => patch({ establishingShotUrl: e.target.value })}
              placeholder="場景全景圖 URL"
              className="h-7 text-[11px]"
            />
            <div className="flex gap-1 mt-1">
              <GenerateImageButton
                prompt={[
                  buildSceneConsistencyPrompt(scene),
                  "establishing shot, wide angle, no characters",
                ]
                  .filter(Boolean)
                  .join(", ")}
                aspectRatio={scene.preferredAspectRatio || "16:9"}
                label="Fal.ai 生成"
                onSuccess={url => patch({ establishingShotUrl: url })}
                disabled={!scene.name}
              />
              <AssetUploader
                accept="image/*"
                label="上傳"
                onUploaded={r => patch({ establishingShotUrl: r.url })}
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">偏好構圖比例</Label>
            <Input
              value={scene.preferredAspectRatio ?? ""}
              onChange={e => patch({ preferredAspectRatio: e.target.value })}
              placeholder="16:9 / 9:16 / 1:1"
              className="h-7 text-[11px]"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">鎖定風格 profile</Label>
            <Select
              value={scene.styleProfileId ?? ""}
              onValueChange={v =>
                patch({ styleProfileId: v === "__none" ? null : v })
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="繼承預設" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none" className="text-xs">
                  繼承預設
                </SelectItem>
                {styleProfiles.map(sp => (
                  <SelectItem key={sp.id} value={sp.id} className="text-xs">
                    {sp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">鎖定配樂主題</Label>
            <Select
              value={scene.musicThemeId ?? ""}
              onValueChange={v =>
                patch({ musicThemeId: v === "__none" ? null : v })
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="無" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none" className="text-xs">
                  無
                </SelectItem>
                {musicThemes.map(mt => (
                  <SelectItem key={mt.id} value={mt.id} className="text-xs">
                    {mt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">時段表（黎明 / 黃昏 / 夜晚…）</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {SCENE_TIME_OF_DAY_PRESETS.map(td => {
              const active = (scene.timeOfDay ?? []).some(t => t.label === td);
              return (
                <button
                  key={td}
                  type="button"
                  onClick={() => {
                    const cur = scene.timeOfDay ?? [];
                    patch({
                      timeOfDay: active
                        ? cur.filter(x => x.label !== td)
                        : [...cur, { label: td }],
                    });
                  }}
                  className={`px-1.5 py-0.5 rounded-full text-[9px] border transition ${
                    active
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                  }`}
                >
                  {active ? "✓ " : "+ "}
                  {td}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">連結場景 LoRA</Label>
          <Select
            value={String(scene.linkedModelId ?? "__none")}
            onValueChange={v =>
              patch({ linkedModelId: v === "__none" ? null : Number(v) })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="未連結" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none" className="text-xs">
                未連結
              </SelectItem>
              {models
                .filter(m => m.modelType === "scene" || m.modelType === "style")
                .map(m => (
                  <SelectItem key={m.id} value={String(m.id)} className="text-xs">
                    {m.name} ({m.modelType})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Trigger word</Label>
          <Input
            value={scene.triggerWord ?? ""}
            onChange={e => patch({ triggerWord: e.target.value })}
            placeholder="例如：misty_forest"
            className="h-7 text-xs"
          />
        </div>
      </div>

      {/* ─── v3 場景動畫製作專業欄位 ──────────────────────────────────── */}

      <Collapsible>
        <CollapsibleTrigger className="text-[11px] text-primary flex items-center gap-1 hover:underline">
          <ChevronDown className="w-3 h-3" />
          進階：Layout / Production Design / Atmospherics / Sound Design
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          {/* Layout */}
          <div className="rounded-md border border-border/30 bg-card/30 p-2 space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Layout / Blocking
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={scene.layout?.floorPlanUrl ?? ""}
                onChange={e =>
                  patch({
                    layout: { ...scene.layout, floorPlanUrl: e.target.value },
                  })
                }
                placeholder="平面圖 URL"
                className="h-7 text-[11px]"
              />
              <Input
                value={scene.layout?.blockingDiagramUrl ?? ""}
                onChange={e =>
                  patch({
                    layout: {
                      ...scene.layout,
                      blockingDiagramUrl: e.target.value,
                    },
                  })
                }
                placeholder="Blocking 圖 URL"
                className="h-7 text-[11px]"
              />
              <Input
                value={(scene.layout?.entryPoints ?? []).join("、")}
                onChange={e =>
                  patch({
                    layout: {
                      ...scene.layout,
                      entryPoints: e.target.value
                        .split(/[、,，]/)
                        .map(s => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="入口（左門、後樓梯）"
                className="h-7 text-[11px]"
              />
              <Input
                value={(scene.layout?.exitPoints ?? []).join("、")}
                onChange={e =>
                  patch({
                    layout: {
                      ...scene.layout,
                      exitPoints: e.target.value
                        .split(/[、,，]/)
                        .map(s => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="出口"
                className="h-7 text-[11px]"
              />
              <Input
                value={scene.layout?.heroShotAngle ?? ""}
                onChange={e =>
                  patch({
                    layout: {
                      ...scene.layout,
                      heroShotAngle: e.target.value,
                    },
                  })
                }
                placeholder="Hero shot 角度"
                className="h-7 text-[11px]"
              />
              <div className="grid grid-cols-3 gap-1">
                <Input
                  type="number"
                  value={scene.layout?.approxDimensions?.widthM ?? ""}
                  onChange={e =>
                    patch({
                      layout: {
                        ...scene.layout,
                        approxDimensions: {
                          ...scene.layout?.approxDimensions,
                          widthM: Number(e.target.value) || undefined,
                        },
                      },
                    })
                  }
                  placeholder="寬 m"
                  className="h-7 text-[10px]"
                />
                <Input
                  type="number"
                  value={scene.layout?.approxDimensions?.depthM ?? ""}
                  onChange={e =>
                    patch({
                      layout: {
                        ...scene.layout,
                        approxDimensions: {
                          ...scene.layout?.approxDimensions,
                          depthM: Number(e.target.value) || undefined,
                        },
                      },
                    })
                  }
                  placeholder="深 m"
                  className="h-7 text-[10px]"
                />
                <Input
                  type="number"
                  value={scene.layout?.approxDimensions?.heightM ?? ""}
                  onChange={e =>
                    patch({
                      layout: {
                        ...scene.layout,
                        approxDimensions: {
                          ...scene.layout?.approxDimensions,
                          heightM: Number(e.target.value) || undefined,
                        },
                      },
                    })
                  }
                  placeholder="高 m"
                  className="h-7 text-[10px]"
                />
              </div>
            </div>
          </div>

          {/* Production design */}
          <div className="rounded-md border border-border/30 bg-card/30 p-2 space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
              <Palette className="w-3 h-3" /> Production Design
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={scene.productionDesign?.architecturalStyle ?? ""}
                onChange={e =>
                  patch({
                    productionDesign: {
                      ...scene.productionDesign,
                      architecturalStyle: e.target.value,
                    },
                  })
                }
                placeholder="建築風格（哥德 / 和風 / 未來…）"
                className="h-7 text-[11px]"
              />
              <Input
                value={(scene.productionDesign?.materials ?? []).join("、")}
                onChange={e =>
                  patch({
                    productionDesign: {
                      ...scene.productionDesign,
                      materials: e.target.value
                        .split(/[、,，]/)
                        .map(s => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="主要建材"
                className="h-7 text-[11px]"
              />
              <Input
                value={(scene.productionDesign?.setPieces ?? []).join("、")}
                onChange={e =>
                  patch({
                    productionDesign: {
                      ...scene.productionDesign,
                      setPieces: e.target.value
                        .split(/[、,，]/)
                        .map(s => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="互動道具"
                className="h-7 text-[11px]"
              />
              <Input
                value={scene.productionDesign?.periodDetails ?? ""}
                onChange={e =>
                  patch({
                    productionDesign: {
                      ...scene.productionDesign,
                      periodDetails: e.target.value,
                    },
                  })
                }
                placeholder="年代細節"
                className="h-7 text-[11px]"
              />
            </div>
            <div className="grid grid-cols-3 gap-1">
              <Input
                value={scene.productionDesign?.colorScript?.keyColor ?? ""}
                onChange={e =>
                  patch({
                    productionDesign: {
                      ...scene.productionDesign,
                      colorScript: {
                        ...scene.productionDesign?.colorScript,
                        keyColor: e.target.value,
                      },
                    },
                  })
                }
                placeholder="Key #ffe1a8"
                className="h-7 text-[10px] font-mono"
              />
              <Input
                value={scene.productionDesign?.colorScript?.midColor ?? ""}
                onChange={e =>
                  patch({
                    productionDesign: {
                      ...scene.productionDesign,
                      colorScript: {
                        ...scene.productionDesign?.colorScript,
                        midColor: e.target.value,
                      },
                    },
                  })
                }
                placeholder="Mid #..."
                className="h-7 text-[10px] font-mono"
              />
              <Input
                value={scene.productionDesign?.colorScript?.shadowColor ?? ""}
                onChange={e =>
                  patch({
                    productionDesign: {
                      ...scene.productionDesign,
                      colorScript: {
                        ...scene.productionDesign?.colorScript,
                        shadowColor: e.target.value,
                      },
                    },
                  })
                }
                placeholder="Shadow #..."
                className="h-7 text-[10px] font-mono"
              />
            </div>
          </div>

          {/* Atmospherics */}
          <div className="rounded-md border border-border/30 bg-card/30 p-2 space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> 大氣 / 粒子
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">霧密度 0-1</Label>
                <Input
                  type="number"
                  step={0.1}
                  min={0}
                  max={1}
                  value={scene.atmospherics?.fogDensity ?? 0}
                  onChange={e =>
                    patch({
                      atmospherics: {
                        ...scene.atmospherics,
                        fogDensity: Number(e.target.value),
                      },
                    })
                  }
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">降水</Label>
                <Select
                  value={scene.atmospherics?.precipitation ?? ""}
                  onValueChange={v =>
                    patch({
                      atmospherics: {
                        ...scene.atmospherics,
                        precipitation: v as "none" | "rain" | "snow" | "ash" | "petals" | "leaves",
                      },
                    })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="無" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRECIPITATION_PRESETS.map(p => (
                      <SelectItem key={p.value} value={p.value} className="text-xs">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "dustMotes", label: "塵埃" },
                { key: "lightShafts", label: "光柱" },
                { key: "lightning", label: "雷電" },
              ].map(o => {
                const v = (
                  scene.atmospherics as Record<string, unknown> | undefined
                )?.[o.key] as boolean | undefined;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() =>
                      patch({
                        atmospherics: {
                          ...scene.atmospherics,
                          [o.key]: !v,
                        } as WorldScene["atmospherics"],
                      })
                    }
                    className={`px-2 py-1 rounded-md text-[10px] border transition ${
                      v
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                    }`}
                  >
                    {v ? "✓ " : "○ "}
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sound Design */}
          <div className="rounded-md border border-border/30 bg-card/30 p-2 space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
              <Volume2 className="w-3 h-3" /> Sound Design
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex gap-1">
                <Input
                  value={scene.soundDesign?.ambientBedUrl ?? ""}
                  onChange={e =>
                    patch({
                      soundDesign: {
                        ...scene.soundDesign,
                        ambientBedUrl: e.target.value,
                      },
                    })
                  }
                  placeholder="環境音床 URL"
                  className="h-7 text-[11px] flex-1"
                />
                <AssetUploader
                  accept="audio/*"
                  label="上傳"
                  onUploaded={r =>
                    patch({
                      soundDesign: {
                        ...scene.soundDesign,
                        ambientBedUrl: r.url,
                      },
                    })
                  }
                />
                <SourcePicker
                  accept="audio/*"
                  assetKind="audio"
                  onPick={r =>
                    patch({
                      soundDesign: {
                        ...scene.soundDesign,
                        ambientBedUrl: r.url,
                      },
                    })
                  }
                />
              </div>
              <div className="flex gap-1">
                <Input
                  value={scene.soundDesign?.roomToneUrl ?? ""}
                  onChange={e =>
                    patch({
                      soundDesign: {
                        ...scene.soundDesign,
                        roomToneUrl: e.target.value,
                      },
                    })
                  }
                  placeholder="Room tone URL"
                  className="h-7 text-[11px] flex-1"
                />
                <AssetUploader
                  accept="audio/*"
                  label="上傳"
                  onUploaded={r =>
                    patch({
                      soundDesign: {
                        ...scene.soundDesign,
                        roomToneUrl: r.url,
                      },
                    })
                  }
                />
                <SourcePicker
                  accept="audio/*"
                  assetKind="audio"
                  onPick={r =>
                    patch({
                      soundDesign: {
                        ...scene.soundDesign,
                        roomToneUrl: r.url,
                      },
                    })
                  }
                />
              </div>
              <Select
                value={scene.soundDesign?.reverb ?? ""}
                onValueChange={v =>
                  patch({
                    soundDesign: {
                      ...scene.soundDesign,
                      reverb: v as "dry" | "room" | "hall" | "cathedral" | "outdoor" | "underwater",
                    },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Reverb" />
                </SelectTrigger>
                <SelectContent>
                  {REVERB_PRESETS.map(p => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={(scene.soundDesign?.diegeticSources ?? []).join("、")}
                onChange={e =>
                  patch({
                    soundDesign: {
                      ...scene.soundDesign,
                      diegeticSources: e.target.value
                        .split(/[、,，]/)
                        .map(s => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="方向性音源"
                className="h-7 text-[11px]"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

// ─── v4: 匯出 / 匯入按鈕 ───────────────────────────────────────────────────

function ImportExportButtons({
  worldId,
  worldName,
}: {
  worldId: number;
  worldName: string;
}) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const exportQuery = trpc.worldbuilding.exportFull.useQuery(
    { id: worldId },
    { enabled: false }
  );
  const importMut = trpc.worldbuilding.importFull.useMutation({
    onSuccess: data => {
      toast.success(`已匯入為新世界觀（id=${data.id}）`);
      utils.worldbuilding.list.invalidate();
    },
    onError: e => toast.error(`匯入失敗：${e.message}`),
  });

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (!result.data) {
      toast.error("匯出失敗");
      return;
    }
    const blob = new Blob([JSON.stringify(result.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${worldName.replace(/[^\w一-龥-]/g, "_")}.worldbuilding.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已匯出 JSON");
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const fw =
        parsed.framework ?? parsed; // 容忍直接是 framework 物件
      // 移除 id / 時間戳，避免 schema 驗證錯誤
      delete fw.id;
      delete fw.createdAt;
      delete fw.updatedAt;
      importMut.mutate({ framework: fw });
    } catch (e) {
      toast.error(
        `匯入失敗：${e instanceof Error ? e.message : "無法解析 JSON"}`
      );
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={exportQuery.isFetching}
        className="h-8 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" />
        匯出
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={importMut.isPending}
        className="h-8 text-xs"
      >
        <UploadIcon className="w-3.5 h-3.5 mr-1" />
        匯入
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
        }}
      />
    </>
  );
}

// ─── v4: 研究資料庫編輯器 ──────────────────────────────────────────────────

const ResearchDatabaseEditor = memo(function ResearchDatabaseEditor({
  entries,
  onChange,
}: {
  entries: WorldResearchEntry[];
  onChange: (next: WorldResearchEntry[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = entries.filter(
    e =>
      !filter ||
      e.title.toLowerCase().includes(filter.toLowerCase()) ||
      (e.content ?? "").toLowerCase().includes(filter.toLowerCase()) ||
      (e.tags ?? []).some(t => t.toLowerCase().includes(filter.toLowerCase()))
  );

  const patch = (idx: number, p: Partial<WorldResearchEntry>) =>
    onChange(entries.map((it, i) => (i === idx ? { ...it, ...p } : it)));

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold flex-1">
            研究資料庫（歷史、地理、文化、生物、技術、政治、宗教、語言、經濟）
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([
                ...entries,
                {
                  id: uid(),
                  title: "",
                  category: "history",
                  content: "",
                  isCanon: false,
                },
              ])
            }
            className="h-7 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            新增條目
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="搜尋標題 / 內容 / 標籤"
            className="h-7 text-xs pl-7"
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          光球代理會自動讀取此資料庫做交叉引用。標記為「核心設定」(Canon) 的條目會在生成時優先注入 prompt。
        </p>
      </div>

      <ScrollArea className="max-h-[55vh] pr-2">
        <div className="space-y-2">
          {filtered.map(e => {
            const idx = entries.findIndex(x => x.id === e.id);
            return (
              <div
                key={e.id}
                className="rounded-lg border border-border/30 bg-card/30 p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={e.title}
                    onChange={ev =>
                      patch(idx, { title: ev.target.value })
                    }
                    placeholder="標題（例：苔森紀年中的星象學）"
                    className="h-7 text-sm font-medium flex-1"
                  />
                  <Select
                    value={e.category ?? ""}
                    onValueChange={v => patch(idx, { category: v })}
                  >
                    <SelectTrigger className="h-7 w-[100px] text-xs">
                      <SelectValue placeholder="分類" />
                    </SelectTrigger>
                    <SelectContent>
                      {RESEARCH_CATEGORY_PRESETS.map(c => (
                        <SelectItem key={c.value} value={c.value} className="text-xs">
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => patch(idx, { isCanon: !e.isCanon })}
                    className={`px-2 py-1 rounded-md text-[10px] border transition ${
                      e.isCanon
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/40 bg-card/30 text-muted-foreground"
                    }`}
                    title="標記為核心設定 — AI 生成時優先注入"
                  >
                    {e.isCanon ? "✓ Canon" : "Canon"}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange(entries.filter(x => x.id !== e.id))
                    }
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                <Textarea
                  value={e.content ?? ""}
                  onChange={ev => patch(idx, { content: ev.target.value })}
                  placeholder="主要內容（支援 Markdown）"
                  className="min-h-[100px] text-[11px]"
                />
                <Input
                  value={(e.tags ?? []).join("、")}
                  onChange={ev =>
                    patch(idx, {
                      tags: ev.target.value
                        .split(/[、,，]/)
                        .map(s => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="標籤（逗號分隔）"
                  className="h-7 text-[11px]"
                />
                <Input
                  value={(e.sourceUrls ?? []).join("、")}
                  onChange={ev =>
                    patch(idx, {
                      sourceUrls: ev.target.value
                        .split(/[、,，\s]+/)
                        .map(s => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="來源連結（多個用逗號或空白分隔）"
                  className="h-7 text-[11px]"
                />
                <Input
                  value={e.citation ?? ""}
                  onChange={ev => patch(idx, { citation: ev.target.value })}
                  placeholder="引用格式（作者, 年, 來源, 頁碼）"
                  className="h-7 text-[10px] font-mono"
                />
                <div className="flex items-center justify-between gap-1">
                  <div className="flex gap-1">
                    <AssetUploader
                      accept="image/*,application/pdf,.doc,.docx,.txt"
                      label="加附件"
                      onUploaded={r => {
                        patch(idx, {
                          attachments: [
                            ...(e.attachments ?? []),
                            {
                              id: uid(),
                              label: r.fileName,
                              assetType: inferAssetType(r.mimeType),
                              url: r.url,
                              fileKey: r.fileKey,
                              mimeType: r.mimeType,
                              sizeBytes: r.sizeBytes,
                              uploadedAt: new Date().toISOString(),
                            },
                          ],
                        });
                      }}
                    />
                    <SourcePicker
                      label="從來源引用"
                      accept="image/*,application/pdf,.doc,.docx,.txt"
                      assetKind="any"
                      onPick={r => {
                        patch(idx, {
                          attachments: [
                            ...(e.attachments ?? []),
                            {
                              id: uid(),
                              label: r.label ?? "附件",
                              assetType: r.mimeType
                                ? inferAssetType(r.mimeType)
                                : "other",
                              url: r.url,
                              fileKey: r.fileKey,
                              mimeType: r.mimeType,
                              sizeBytes: r.sizeBytes,
                              uploadedAt: new Date().toISOString(),
                            },
                          ],
                        });
                      }}
                    />
                  </div>
                  {(e.attachments?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(e.attachments ?? []).map((a, ai) => (
                        <a
                          key={a.id}
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline flex items-center gap-1"
                        >
                          {a.label}
                          <button
                            type="button"
                            onClick={ev => {
                              ev.preventDefault();
                              patch(idx, {
                                attachments: (e.attachments ?? []).filter(
                                  (_, i) => i !== ai
                                ),
                              });
                            }}
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && entries.length > 0 && (
            <p className="text-xs text-muted-foreground italic">
              沒有符合「{filter}」的條目。
            </p>
          )}
          {entries.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              尚無研究條目。點上方「新增條目」開始。
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

// ─── v4: 音效 / 環境音庫 ───────────────────────────────────────────────────

const SoundLibraryEditor = memo(function SoundLibraryEditor({
  items,
  onChange,
}: {
  items: WorldSoundLibraryItem[];
  onChange: (next: WorldSoundLibraryItem[]) => void;
}) {
  const ALL_CATEGORY_FILTER = "__all__";
  const [filter, setFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORY_FILTER);
  const filtered = items.filter(
    s =>
      (categoryFilter === ALL_CATEGORY_FILTER || s.category === categoryFilter) &&
      (!filter ||
        s.label.toLowerCase().includes(filter.toLowerCase()) ||
        (s.tags ?? []).some(t =>
          t.toLowerCase().includes(filter.toLowerCase())
        ))
  );

  const patch = (idx: number, p: Partial<WorldSoundLibraryItem>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...p } : it)));

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <FileAudio className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold flex-1">
            音效 / 環境音庫
          </h3>
          <AssetUploader
            accept="audio/*"
            label="上傳音檔"
            onUploaded={r => {
              onChange([
                ...items,
                {
                  id: uid(),
                  label: r.fileName,
                  category: "ambient",
                  audioUrl: r.url,
                  fileKey: r.fileKey,
                  loopable: true,
                  volumeDefault: 0.7,
                },
              ]);
              toast.success(`${r.fileName} 已加入音效庫`);
            }}
          />
          <SourcePicker
            label="從來源引用"
            accept="audio/*"
            assetKind="audio"
            onPick={r => {
              onChange([
                ...items,
                {
                  id: uid(),
                  label: r.label ?? "音效",
                  category: "ambient",
                  audioUrl: r.url,
                  fileKey: r.fileKey,
                  loopable: true,
                  volumeDefault: 0.7,
                },
              ]);
              toast.success(`${r.label ?? "音效"} 已加入音效庫`);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([
                ...items,
                {
                  id: uid(),
                  label: "",
                  category: "ambient",
                  audioUrl: "",
                  loopable: false,
                  volumeDefault: 0.7,
                },
              ])
            }
            className="h-7 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            手動加入
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="搜尋音檔名稱 / 標籤"
              className="h-7 text-xs pl-7"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="全部分類" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORY_FILTER} className="text-xs">
                全部分類
              </SelectItem>
              {SOUND_LIBRARY_CATEGORY_PRESETS.map(c => (
                <SelectItem key={c.value} value={c.value} className="text-xs">
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[10px] text-muted-foreground">
          場景的「Sound Design」可以引用此庫的 id，避免重複上傳。AI 代理也可查詢此庫挑選合適音效。
        </p>
      </div>

      <ScrollArea className="max-h-[55vh] pr-2">
        <div className="space-y-2">
          {filtered.map(s => {
            const idx = items.findIndex(x => x.id === s.id);
            return (
              <div
                key={s.id}
                className="rounded-lg border border-border/30 bg-card/30 p-2 space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <FileAudio className="w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={s.label}
                    onChange={e => patch(idx, { label: e.target.value })}
                    placeholder="名稱"
                    className="h-7 text-xs flex-1"
                  />
                  <Select
                    value={s.category ?? ""}
                    onValueChange={v =>
                      patch(idx, {
                        category: v as WorldSoundLibraryItem["category"],
                      })
                    }
                  >
                    <SelectTrigger className="h-7 w-[120px] text-xs">
                      <SelectValue placeholder="分類" />
                    </SelectTrigger>
                    <SelectContent>
                      {SOUND_LIBRARY_CATEGORY_PRESETS.map(c => (
                        <SelectItem key={c.value} value={c.value} className="text-xs">
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => patch(idx, { loopable: !s.loopable })}
                    className={`px-2 py-1 rounded text-[10px] border ${
                      s.loopable
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/40 bg-card/30 text-muted-foreground"
                    }`}
                  >
                    {s.loopable ? "✓ Loop" : "Loop"}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange(items.filter(x => x.id !== s.id))
                    }
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                <div className="flex gap-1">
                  <Input
                    value={s.audioUrl}
                    onChange={e => patch(idx, { audioUrl: e.target.value })}
                    placeholder="音檔 URL"
                    className="h-7 text-[11px] flex-1"
                  />
                  <AssetUploader
                    accept="audio/*"
                    label="上傳"
                    onUploaded={r =>
                      patch(idx, {
                        audioUrl: r.url,
                        fileKey: r.fileKey,
                        label: s.label || r.fileName,
                      })
                    }
                  />
                  <SourcePicker
                    accept="audio/*"
                    assetKind="audio"
                    onPick={r =>
                      patch(idx, {
                        audioUrl: r.url,
                        fileKey: r.fileKey,
                        label: s.label || r.label || "音效",
                      })
                    }
                  />
                </div>
                {s.audioUrl && (
                  <audio
                    src={s.audioUrl}
                    controls
                    preload="none"
                    className="w-full h-8"
                  />
                )}
                <Input
                  value={(s.tags ?? []).join("、")}
                  onChange={e =>
                    patch(idx, {
                      tags: e.target.value
                        .split(/[、,，]/)
                        .map(t => t.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="標籤（雨、戰鬥、勝利、夜晚…）"
                  className="h-7 text-[11px]"
                />
                <Input
                  value={(s.triggers ?? []).join("、")}
                  onChange={e =>
                    patch(idx, {
                      triggers: e.target.value
                        .split(/[、,，]/)
                        .map(t => t.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="觸發情境（rain_start / battle_begin / victory）"
                  className="h-7 text-[10px] font-mono"
                />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">時長 (秒)</Label>
                    <Input
                      type="number"
                      step={0.1}
                      value={s.durationSec ?? 0}
                      onChange={e =>
                        patch(idx, { durationSec: Number(e.target.value) })
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">預設音量</Label>
                    <Input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      value={s.volumeDefault ?? 0.7}
                      onChange={e =>
                        patch(idx, {
                          volumeDefault: Math.max(
                            0,
                            Math.min(1, Number(e.target.value))
                          ),
                        })
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">授權</Label>
                    <Select
                      value={s.license ?? ""}
                      onValueChange={v => patch(idx, { license: v })}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="選擇" />
                      </SelectTrigger>
                      <SelectContent>
                        {SOUND_LICENSE_PRESETS.map(l => (
                          <SelectItem key={l} value={l} className="text-xs">
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && items.length > 0 && (
            <p className="text-xs text-muted-foreground italic">
              沒有符合條件的音效。
            </p>
          )}
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              尚無音效。上傳音檔或手動加入開始建立音效庫。
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

// ─── 主頁面 ────────────────────────────────────────────────────────────────

export default function AnimationStudio() {
  const params = useParams<{ storyboardId?: string }>();
  const [, navigate] = useLocation();

  // 沉浸式模式狀態
  const [immersiveMode, setImmersiveMode] = useState(false);

  const worldsQuery = trpc.worldbuilding.list.useQuery();
  const voicesQuery = trpc.worldbuilding.linkableVoices.useQuery(undefined, { retry: 1 });
  const linkableModelsQuery = trpc.worldbuilding.linkableModels.useQuery(undefined, { retry: 1 });
  const utils = trpc.useUtils();

  const [selectedWorldId, setSelectedWorldId] = useState<number | null>(null);
  const [selectedTab, setSelectedTab] = useState<
    | "characters"
    | "scenes"
    | "style"
    | "music"
    | "production"
    | "research"
    | "sounds"
    | "script"
    | "storyboards"
    | "timeline"
    | "composition"
  >("characters");

  // 自動選第一個世界（避免在 render 階段 setState）
  const worlds = worldsQuery.data ?? [];

  // 僅以「世界觀主資料」作為頁面可用性的阻斷條件。
  // voices / models 是輔助資料，失敗時不應讓整個世界觀系統無法操作。
  const loadError = worldsQuery.error ?? null;

  useEffect(() => {
    if (worlds.length === 0) {
      return;
    }

    // 初次進入自動選第一個；若目前選取已不存在（被刪除/資料變更）則回退第一個。
    if (selectedWorldId === null || !worlds.some(w => w.id === selectedWorldId)) {
      setSelectedWorldId(worlds[0].id);
    }
  }, [worlds, selectedWorldId]);

  const selectedWorld = useMemo(
    () => worlds.find(w => w.id === selectedWorldId) ?? null,
    [worlds, selectedWorldId]
  );

  const storyboardsQuery = trpc.worldStoryboard.listByWorld.useQuery(
    selectedWorldId ? { worldId: selectedWorldId } : skipToken,
    { enabled: !!selectedWorldId }
  );
  const [selectedStoryboard, setSelectedStoryboard] = useState<WorldStoryboard | null>(null);

  useEffect(() => {
    const list = storyboardsQuery.data ?? [];
    if (list.length === 0) {
      setSelectedStoryboard(null);
      return;
    }
    setSelectedStoryboard(prev => {
      if (prev && list.some(sb => sb.id === prev.id)) return prev;
      return list[0];
    });
  }, [storyboardsQuery.data]);


  const createWorld = trpc.worldbuilding.create.useMutation({
    onSuccess: data => {
      toast.success("世界觀已建立");
      utils.worldbuilding.list.invalidate();
      setSelectedWorldId(data.id);
    },
    onError: e => toast.error(`建立失敗：${e.message}`),
  });
  const deleteWorld = trpc.worldbuilding.delete.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      utils.worldbuilding.list.invalidate();
      setSelectedWorldId(null);
    },
    onError: e => toast.error(`刪除失敗：${e.message}`),
  });
  const updateWorld = trpc.worldbuilding.update.useMutation({
    onSuccess: () => utils.worldbuilding.list.invalidate(),
    onError: e => toast.error(`儲存失敗：${e.message}`),
  });

  // 本地 draft：避免每次打字都打 API 造成卡頓 + input 跳動。
  // 切換世界時從 server 資料覆寫；patch 進來時 merge 到 draft，並用 debounce 寫回後端。
  const [draft, setDraft] = useState<
    (WorldbuildingFrameworkData & { id?: number }) | null
  >(null);
  const lastSyncedIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedWorld) {
      setDraft(null);
      lastSyncedIdRef.current = null;
      return;
    }
    // 只在切換世界或從未同步時用 server 資料覆寫 draft，
    // 否則使用者打字時會被 background refetch 蓋掉。
    if (lastSyncedIdRef.current !== selectedWorld.id) {
      setDraft(selectedWorld);
      lastSyncedIdRef.current = selectedWorld.id!;
    }
  }, [selectedWorld]);

  // Debounced save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePatchWorld = useCallback(
    (patch: Partial<WorldbuildingFrameworkData>) => {
      setDraft(prev => (prev ? { ...prev, ...patch } : prev));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        setDraft(latest => {
          if (!latest?.id) return latest;
          updateWorld.mutate({
            id: latest.id,
            patch: {
              name: latest.name,
              description: latest.description,
              genre: latest.genre,
              era: latest.era,
              characters: latest.characters,
              scenes: latest.scenes,
              objects: latest.objects,
              linkedModelIds: latest.linkedModelIds,
              styleProfiles: latest.styleProfiles,
              musicThemes: latest.musicThemes,
              defaultStyleProfileId: latest.defaultStyleProfileId,
              globalNegativePrompt: latest.globalNegativePrompt,
              productionTargets: latest.productionTargets,
              researchEntries: latest.researchEntries,
              soundLibrary: latest.soundLibrary,
              tags: latest.tags,
            },
          });
          return latest;
        });
      }, 600);
    },
    [updateWorld]
  );

  // AI Generation mutations
  const generateCharacterMutation = trpc.worldbuildingGeneration.generateCharacter.useMutation({
    onSuccess: (data) => {
      toast.success(`角色「${data.character.name}」已生成`);
      utils.worldbuilding.list.invalidate();
    },
    onError: (e) => toast.error(`生成失敗：${e.message}`),
  });

  const generateSceneMutation = trpc.worldbuildingGeneration.generateScene.useMutation({
    onSuccess: (data) => {
      toast.success(`場景「${data.scene.name}」已生成`);
      utils.worldbuilding.list.invalidate();
    },
    onError: (e) => toast.error(`生成失敗：${e.message}`),
  });

  const generateStoryboardMutation = trpc.worldbuildingGeneration.generateStoryboard.useMutation({
    onSuccess: (data) => {
      toast.success("分鏡已生成");
      utils.worldStoryboard.listByWorld.invalidate();
      if (data.storyboardId) {
        navigate(`/animation/${data.storyboardId}`);
      }
    },
    onError: (e) => toast.error(`生成失敗：${e.message}`),
  });

  // ─── AI Agent Integration ───────────────────────────────────────────────
  useRegisterPageAgent({
    pageId: "animation-studio",
    pageLabel: "世界觀系統",
    capabilities: useMemo((): AgentCapability[] => {
      const tabs: AgentCapability["options"] = [
        { id: "characters", label: "角色" },
        { id: "scenes", label: "場景" },
        { id: "style", label: "風格" },
        { id: "music", label: "音樂" },
        { id: "production", label: "製作" },
        { id: "research", label: "研究" },
        { id: "sounds", label: "音效庫" },
        { id: "script", label: "腳本" },
        { id: "storyboards", label: "分鏡" },
      ];

      return [
        {
          action: "setTab",
          label: "分頁",
          options: tabs,
          currentId: selectedTab,
        },
        {
          action: "generateCharacter",
          label: "生成角色",
          hint: "可根據描述生成新角色並加入目前世界觀",
        },
        {
          action: "generateScene",
          label: "生成場景",
          hint: "可根據描述生成新場景並加入目前世界觀",
        },
        {
          action: "generateStoryboard",
          label: "生成分鏡",
          hint: "可根據腳本或描述生成分鏡時間軸",
        },
      ];
    }, [selectedTab]),

    handle: useCallback(async (action: AgentAction) => {
      if (action.type === "setTab") {
        const validTabs = [
          "characters",
          "scenes",
          "style",
          "music",
          "production",
          "research",
          "sounds",
          "script",
          "storyboards",
        ];
        if (validTabs.includes(action.tabId)) {
          setSelectedTab(action.tabId as typeof selectedTab);
          return { ok: true, message: `已切換到「${action.tabId}」分頁` };
        }
        return { ok: false, reason: "無效的分頁 ID" };
      }

      if (action.type === "generateCharacter") {
        if (!selectedWorldId) {
          return { ok: false, reason: "請先選擇一個世界觀" };
        }
        try {
          await generateCharacterMutation.mutateAsync({
            worldId: selectedWorldId,
            description: action.description,
            archetype: action.archetype,
          });
          return { ok: true, message: "角色已生成並加入世界觀" };
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : "生成失敗" };
        }
      }

      if (action.type === "generateScene") {
        if (!selectedWorldId) {
          return { ok: false, reason: "請先選擇一個世界觀" };
        }
        try {
          await generateSceneMutation.mutateAsync({
            worldId: selectedWorldId,
            description: action.description,
            environmentType: action.environmentType,
          });
          return { ok: true, message: "場景已生成並加入世界觀" };
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : "生成失敗" };
        }
      }

      if (action.type === "generateStoryboard") {
        if (!selectedWorldId) {
          return { ok: false, reason: "請先選擇一個世界觀" };
        }
        try {
          const parsedScriptId = action.scriptId ? Number(action.scriptId) : undefined;
          await generateStoryboardMutation.mutateAsync({
            worldId: selectedWorldId,
            scriptId: Number.isFinite(parsedScriptId) ? parsedScriptId : undefined,
            description: action.description,
          });
          return { ok: true, message: "分鏡已生成" };
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : "生成失敗" };
        }
      }
      if (action.type === "execute_worldbuilding_task" || action.type === "execute_worldbuilding_task_batch") {
        const tasks = action.type === "execute_worldbuilding_task" ? [action.task] : action.tasks;
        const blocked = tasks.filter((t: any) => t.status === "blocked");
        if (blocked.length) return { ok: false, reason: `blocked:${blocked.map((b: any) => b.title).join(",")}` };
        if (action.mode === "internal_model") {
          return { ok: false, reason: "內建模型批次執行尚未啟用，請先使用 dry-run 或代理 workflow" };
        }
        if (action.mode === "page_agent") {
          const workflow = buildAgentWorkflowFromGenerationTasks({ tasks: tasks as any, worldName: draft?.name, confirmationMode: action.type === "execute_worldbuilding_task_batch" ? (action.confirmationMode ?? "step-by-step") : "step-by-step" });
          return { ok: true, message: "workflow preview", data: { workflow } };
        }
        return { ok: true, message: "dry_run", data: { tasks, summary: { total: tasks.length, blocked: blocked.length } } };
      }

      return { ok: false, reason: "不支援的動作" };
    }, [selectedWorldId, generateCharacterMutation, generateSceneMutation, generateStoryboardMutation, draft]),

    pagePath: "/animation",
    state: {
      selectedWorldId,
      selectedTab,
      hasWorld: !!draft,
      worldName: draft?.name || "",
      charactersCount: draft?.characters?.length || 0,
      scenesCount: draft?.scenes?.length || 0,
      storyboardsCount: storyboardsQuery.data?.length || 0,
    },
  });

  // 開分鏡細節（URL 路由）
  const detailStoryboardId = params.storyboardId
    ? Number(params.storyboardId)
    : null;
  const storyboardDetailQuery = trpc.worldStoryboard.get.useQuery(
    detailStoryboardId ? { id: detailStoryboardId } : skipToken,
    { enabled: !!detailStoryboardId }
  );

  const seedSkeleton = trpc.worldStoryboard.seedSkeleton.useMutation({
    onSuccess: data => {
      toast.success(`分鏡骨架已生成（${data.storyboard.scenes.length} 場）`);
      utils.worldStoryboard.listByWorld.invalidate();
      if (data.id) navigate(`/animation/${data.id}`);
    },
    onError: e => toast.error(`生成失敗：${e.message}`),
  });
  const planPipeline = trpc.worldStoryboard.planPipeline.useMutation({
    onSuccess: data => {
      toast.success(
        `管線編排完成：${data.steps.length} 步驟、估時 ${formatTimecode(
          data.estimatedWallClockSec
        )}、估價 $${data.estimatedCostUsd ?? 0}`
      );
    },
    onError: e => toast.error(`編排失敗：${e.message}`),
  });
  const deleteStoryboard = trpc.worldStoryboard.delete.useMutation({
    onSuccess: () => {
      toast.success("分鏡草稿已刪除");
      utils.worldStoryboard.listByWorld.invalidate();
    },
    onError: e => toast.error(`刪除失敗：${e.message}`),
  });
  const renameStoryboard = trpc.worldStoryboard.update.useMutation({
    onSuccess: () => {
      utils.worldStoryboard.listByWorld.invalidate();
    },
    onError: e => toast.error(`重新命名失敗：${e.message}`),
  });

  if (worldsQuery.isLoading) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        載入世界觀中…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 max-w-xl mx-auto text-center space-y-3">
        <p className="text-sm text-muted-foreground">世界觀系統載入失敗：{loadError.message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            worldsQuery.refetch();
            voicesQuery.refetch();
            linkableModelsQuery.refetch();
          }}
        >
          重新載入
        </Button>
      </div>
    );
  }

  if (worlds.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center space-y-4">
        <Film className="w-12 h-12 mx-auto text-muted-foreground/50" />
        <h2 className="text-lg font-semibold">建立第一個世界觀</h2>
        <p className="text-sm text-muted-foreground">
          世界觀系統 = 世界觀 × 分鏡，並統一串接全站可用的站內生成系統。先在這裡建立世界、配置角色（三視圖、表情、
          穿衣、口氣、語音、腳本定位）與場景，接著派生分鏡時間軸、編排動畫渲染管線。
        </p>
        <Button
          onClick={() =>
            createWorld.mutate({
              name: "未命名世界",
              characters: [],
              scenes: [],
            })
          }
          disabled={createWorld.isPending}
        >
          <Plus className="w-4 h-4 mr-2" />
          {createWorld.isPending ? "建立中…" : "建立空白世界觀"}
        </Button>
      </div>
    );
  }

  // 分鏡細節視圖
  if (detailStoryboardId && storyboardDetailQuery.data && selectedWorld) {
    const sb = storyboardDetailQuery.data;
    return (
      <>
        {/* 沉浸式模式背景動畫 */}
        {immersiveMode && <EarthGlobeAnimation />}

        <div className={`p-4 page-shell page-shell-default space-y-4 ${immersiveMode ? "relative z-10" : ""}`}>
          <div className={`flex items-center gap-2 ${immersiveMode ? "backdrop-blur-md bg-card/30 border border-border/30 rounded-xl p-3" : ""}`}>
            {/* 沉浸式模式：顯示返回導演 AI 按鈕 */}
            {immersiveMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/director")}
                className="h-8 text-xs"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                返回導演 AI
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/animation")}
              className="text-xs"
            >
              ← 返回世界觀系統
            </Button>

            {/* 沉浸式模式切換按鈕 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setImmersiveMode(!immersiveMode)}
              className="h-8 text-xs"
              title={immersiveMode ? "退出沉浸式模式" : "進入沉浸式模式"}
            >
              {immersiveMode ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 mr-1" />
                  退出沉浸
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 mr-1" />
                  沉浸式
                </>
              )}
            </Button>

            <h1 className="text-lg font-semibold flex-1">{sb.name}</h1>
            <Badge variant="outline">{sb.productionStatus}</Badge>
            <Button
              size="sm"
              onClick={() =>
                planPipeline.mutate({ id: sb.id, persist: true })
              }
              disabled={planPipeline.isPending}
            >
              <Wand2 className="w-3.5 h-3.5 mr-1" />
              編排動畫管線
            </Button>
          </div>

          <StoryboardTimelinePreview storyboard={sb} framework={selectedWorld} />

          {sb.pipelinePlan && (
            <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> 管線執行計畫
              </h3>
              <PipelinePlanView plan={sb.pipelinePlan} />
            </div>
          )}
        </div>
      </>
    );
  }

  // 渲染用 draft（本地、即時反應使用者輸入），未 ready 時 fallback 到 server 資料
  const effectiveWorld = useMemo<
    (WorldbuildingFrameworkData & { id?: number }) | null
  >(() => {
    if (!selectedWorld) return null;
    const base = (draft ?? selectedWorld) as WorldbuildingFrameworkData & {
      id?: number;
    };
    return {
      ...base,
      characters: base.characters ?? [],
      scenes: base.scenes ?? [],
      styleProfiles: base.styleProfiles ?? [],
      musicThemes: base.musicThemes ?? [],
      researchEntries: base.researchEntries ?? [],
      soundLibrary: base.soundLibrary ?? [],
      uploadedAssets: base.uploadedAssets ?? [],
    };
  }, [draft, selectedWorld]);

  const visualAssetGallery = useMemo(() => {
    if (!effectiveWorld) return [];
    const items: Array<{ id: string; title: string; url: string; type: "角色" | "場景" | "資產" }> = [];

    effectiveWorld.characters.forEach(character => {
      character.referenceLibrary?.forEach(ref => {
        if (!ref.imageUrl) return;
        items.push({
          id: `char-${character.id}-${ref.id}`,
          title: `${character.name} · ${ref.category ?? "參考"}`,
          url: ref.imageUrl,
          type: "角色",
        });
      });
      character.ageVariants?.forEach(variant => {
        variant.imageUrls?.forEach((url, idx) => {
          if (!url) return;
          items.push({
            id: `age-${character.id}-${variant.id}-${idx}`,
            title: `${character.name} · ${variant.name}`,
            url,
            type: "角色",
          });
        });
      });
    });

    effectiveWorld.scenes.forEach(scene => {
      scene.realWorldRefs?.forEach(ref => {
        ref.imageUrls?.forEach((url, idx) => {
          if (!url) return;
          items.push({
            id: `scene-${scene.id}-${ref.id}-${idx}`,
            title: `${scene.name} · ${ref.label}`,
            url,
            type: "場景",
          });
        });
      });
    });

    effectiveWorld.uploadedAssets?.forEach(asset => {
      if (asset.assetType !== "image" || !asset.url) return;
      items.push({
        id: `asset-${asset.id}`,
        title: asset.label || "素材",
        url: asset.url,
        type: "資產",
      });
    });

    return items.slice(0, 12);
  }, [effectiveWorld]);

  const worldProgress = useMemo(() => calculateWorldbuildingProgress(effectiveWorld ?? null), [effectiveWorld]);
  const readiness = useMemo(() => calculateWorldbuildingReadiness(effectiveWorld ?? null, { storyboardsCount: storyboardsQuery.data?.length ?? 0 }), [effectiveWorld, storyboardsQuery.data]);
  const actionPlan = useMemo(() => getWorldbuildingActionPlan(effectiveWorld ?? null, { storyboardsCount: storyboardsQuery.data?.length ?? 0, visualAssetsCount: readiness.visualAssetsCount }), [effectiveWorld, storyboardsQuery.data, readiness.visualAssetsCount]);

  const handleWorldbuildingAction = useCallback((action: any) => {
    const tab = action.targetTab ?? "characters";
    setSelectedTab(tab);
    if (action.targetEntityId) {
      setTimeout(() => {
        const el = document.querySelector(`[data-worldbuilding-entity-id="${action.targetEntityId}"]`);
        if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
        else toast("已切換到對應分頁，請補齊缺漏欄位。");
      }, 120);
    }
  }, [setSelectedTab]);

  const completionRatio = useMemo(() => {
    if (!effectiveWorld) return 0;
    return Math.min(
      1,
      [
        effectiveWorld.characters.length > 0,
        effectiveWorld.scenes.length > 0,
        (effectiveWorld.styleProfiles?.length ?? 0) > 0,
        (effectiveWorld.musicThemes?.length ?? 0) > 0,
        (storyboardsQuery.data?.length ?? 0) > 0,
      ].filter(Boolean).length / 5
    );
  }, [effectiveWorld, storyboardsQuery.data]);

  if (!selectedWorld || !effectiveWorld) return null;

  return (
    <>
      {/* 沉浸式模式背景動畫 */}
      {immersiveMode && <EarthGlobeAnimation />}

      <div className={`p-4 page-shell page-shell-default space-y-4 ${immersiveMode ? "relative z-10 text-slate-100" : ""}`}>
        {/* Header */}
        <div className={`flex items-center gap-2 flex-wrap ${immersiveMode ? "backdrop-blur-xl bg-slate-900/55 border border-slate-200/20 rounded-xl p-3 shadow-[0_12px_32px_rgba(2,6,23,0.35)]" : ""}`}>
          {/* 沉浸式模式：顯示返回導演 AI 按鈕 */}
          {immersiveMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/director")}
              className="h-8 text-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              返回導演 AI
            </Button>
          )}

          <Film className="w-5 h-5 text-primary" />
          <h1 className={`text-lg font-semibold ${immersiveMode ? "text-slate-50" : ""}`}>世界觀系統</h1>

          {/* 沉浸式模式切換按鈕 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setImmersiveMode(!immersiveMode)}
            className="h-8 text-xs ml-auto"
            title={immersiveMode ? "退出沉浸式模式" : "進入沉浸式模式"}
          >
            {immersiveMode ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 mr-1" />
                退出沉浸
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 mr-1" />
                沉浸式
              </>
            )}
          </Button>

          <Select
            value={String(selectedWorldId)}
            onValueChange={v => setSelectedWorldId(Number(v))}
          >
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {worlds.map(w => (
                <SelectItem key={w.id} value={String(w.id)} className="text-xs">
                  {w.name} · {w.genre ?? "—"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            createWorld.mutate({
              name: "未命名世界",
              characters: [],
              scenes: [],
            })
          }
          disabled={createWorld.isPending}
          className="h-8 text-xs"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          新增世界
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (confirm(`確定刪除世界觀「${selectedWorld.name}」？`)) {
              deleteWorld.mutate({ id: selectedWorld.id! });
            }
          }}
          className="h-8 text-xs text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
        <ImportExportButtons
          worldId={selectedWorld.id!}
          worldName={selectedWorld.name}
        />
      </div>

      {/* 世界觀基本資料（從導演 AI 融合進來，一處編完） */}
      <WorldBasicsEditor
        world={effectiveWorld}
        onPatch={handlePatchWorld}
      />

      <div className={`rounded-xl p-3 space-y-2 ${immersiveMode ? "border border-slate-200/20 bg-slate-900/50 backdrop-blur-lg" : "border border-primary/30 bg-primary/[0.04]"}`}>
        <h3 className={`text-sm font-semibold flex items-center gap-1.5 ${immersiveMode ? "text-slate-100" : "text-primary"}`}>
          <Sparkles className="w-4 h-4" /> 世界觀製作助理
        </h3>
        <p className="text-[11px] text-muted-foreground">世界觀不是讓你填設定，而是幫你把想法變成可生成的影片專案。</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Badge variant="secondary">準備度 {worldProgress.overall}%</Badge>
          <Badge variant="outline">{actionPlan.generationState === "generation_ready" ? "可以產生製作包" : actionPlan.generationState === "storyboard_ready" ? "可以開始做分鏡" : "還在整理設定"}</Badge>
        </div>
        <div className="text-[11px]">
          <div>角色視覺覆蓋率 Top 3：{readiness.visualCoverage.characterCoverage.slice(0,3).map((c:any)=>`${c.name}：${c.percent}%｜缺${c.missing.slice(0,2).join("、") || "無"}`).join("；") || "無"}</div>
          <div>場景視覺覆蓋率 Top 3：{readiness.visualCoverage.sceneCoverage.slice(0,3).map((c:any)=>`${c.name}：${c.percent}%｜缺${c.missing.slice(0,2).join("、") || "無"}`).join("；") || "無"}</div>
          <span className="font-medium">建議下一步：</span>{actionPlan.primaryAction.label}（{actionPlan.primaryAction.cta}）
        </div>
        {actionPlan.blockers.length > 0 && (
          <ul className="text-[10px] text-amber-700 dark:text-amber-300 list-disc ml-4">
            {actionPlan.blockers.slice(0,3).map(b => <li key={b.id}>{b.reason}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {actionPlan.actions.slice(0,3).map(a => (
            <Button key={a.id} size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleWorldbuildingAction(a)}>{a.cta}</Button>
          ))}
          <ProductionPackagePreview world={effectiveWorld} storyboards={storyboardsQuery.data as any[]} readinessPercent={readiness.generationReadinessPercent} warnings={actionPlan.blockers.map(b => b.reason)} />
          <div className="w-full"><GenerationReadinessChecklist readiness={readiness} actionPlan={actionPlan} onAction={handleWorldbuildingAction} /></div>
          <div className="w-full"><VisualInspirationLibraryPanel world={effectiveWorld} /></div>
        </div>
      </div>

      {/* Production targets quick edit */}
      <div className={`rounded-xl p-3 space-y-2 ${immersiveMode ? "border border-slate-200/20 bg-slate-900/50 backdrop-blur-lg shadow-[0_10px_30px_rgba(2,6,23,0.28)]" : "border border-border/40 bg-card/30"}`}>
        <h3 className={`text-sm font-semibold ${immersiveMode ? "text-slate-100" : ""}`}>製作目標</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">格式</Label>
            <Select
              value={effectiveWorld.productionTargets?.format ?? ""}
              onValueChange={v =>
                handlePatchWorld({
                  productionTargets: {
                    ...effectiveWorld.productionTargets,
                    format: v,
                  },
                })
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="選擇" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTION_FORMAT_PRESETS.map(f => (
                  <SelectItem key={f} value={f} className="text-xs">
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">目標時長（秒）</Label>
            <Input
              type="number"
              value={effectiveWorld.productionTargets?.targetDurationSec ?? 0}
              onChange={e =>
                handlePatchWorld({
                  productionTargets: {
                    ...effectiveWorld.productionTargets,
                    targetDurationSec: Number(e.target.value),
                  },
                })
              }
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">受眾</Label>
            <Input
              value={effectiveWorld.productionTargets?.audience ?? ""}
              onChange={e =>
                handlePatchWorld({
                  productionTargets: {
                    ...effectiveWorld.productionTargets,
                    audience: e.target.value,
                  },
                })
              }
              placeholder="兒童 / 全年齡 / 成人"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">平台</Label>
            <Input
              value={effectiveWorld.productionTargets?.platform ?? ""}
              onChange={e =>
                handlePatchWorld({
                  productionTargets: {
                    ...effectiveWorld.productionTargets,
                    platform: e.target.value,
                  },
                })
              }
              placeholder="YouTube / TikTok / 影展"
              className="h-7 text-xs"
            />
          </div>
        </div>
        <Input
          value={effectiveWorld.globalNegativePrompt ?? ""}
          onChange={e =>
            handlePatchWorld({ globalNegativePrompt: e.target.value })
          }
          placeholder="全域負面詞（如 watermark, blurry, extra fingers）"
          className="h-7 text-xs"
        />
      </div>

      <div className={`rounded-xl p-3 space-y-3 ${immersiveMode ? "border border-slate-200/20 bg-slate-900/50 backdrop-blur-lg" : "border border-border/40 bg-card/30"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[11px]">世界觀完整度：{readiness.worldCompletionPercent}%</Badge>
          <Badge variant="outline" className="text-[11px]">視覺素材完整度：{readiness.visualAssetPercent}%</Badge>
          <Badge variant="outline" className="text-[11px]"><Eye className="w-3 h-3 mr-1" />生成準備度：{readiness.generationReadinessPercent}%</Badge>
          <div className="h-2 w-36 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(completionRatio * 100)}%` }} />
          </div>
          <span className="text-[11px] text-muted-foreground">
            已蒐集 {readiness.visualAssetsCount} 筆可用視覺素材
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            ["characters", "先補角色視覺"],
            ["scenes", "先補場景氛圍"],
            ["storyboards", "進入分鏡規劃"],
          ].map(([tab, label]) => (
            <Button key={tab} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelectedTab(tab as typeof selectedTab)}>
              <MousePointerClick className="w-3 h-3 mr-1" />
              {label}
            </Button>
          ))}
        </div>

        {readiness.visualAssetsCount === 0 && <p className="text-xs text-amber-600">尚未蒐集可用視覺素材，角色與場景生成可能不一致。</p>}
        {visualAssetGallery.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {visualAssetGallery.map(item => (
              <button
                type="button"
                key={item.id}
                className="group text-left rounded-lg overflow-hidden border border-border/40 bg-black/5 hover:border-primary/60 transition"
                onClick={() => {
                  if (item.type === "角色") setSelectedTab("characters");
                  else if (item.type === "場景") setSelectedTab("scenes");
                }}
              >
                <img src={item.url} alt={item.title} className="h-20 w-full object-cover" loading="lazy" />
                <div className="p-1.5">
                  <p className="text-[10px] text-muted-foreground">{item.type}</p>
                  <p className="text-[11px] leading-tight line-clamp-2">{item.title}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            還沒有可預覽的視覺素材。先在角色參考圖、場景真實參考或資產庫上傳圖片，這裡會自動形成素材牆。
          </p>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={v => setSelectedTab(v as typeof selectedTab)}>
        <TabsList>
          <TabsTrigger value="characters" className="text-xs">
            <Users className="w-3.5 h-3.5 mr-1" />
            角色（{effectiveWorld.characters.length}）
          </TabsTrigger>
          <TabsTrigger value="scenes" className="text-xs">
            <MapPin className="w-3.5 h-3.5 mr-1" />
            場景（{effectiveWorld.scenes.length}）
          </TabsTrigger>
          <TabsTrigger value="style" className="text-xs">
            <Layers className="w-3.5 h-3.5 mr-1" />
            風格設定（{effectiveWorld.styleProfiles?.length ?? 0}）
          </TabsTrigger>
          <TabsTrigger value="music" className="text-xs">
            <Music className="w-3.5 h-3.5 mr-1" />
            配樂主題（{effectiveWorld.musicThemes?.length ?? 0}）
          </TabsTrigger>
          <TabsTrigger value="production" className="text-xs">
            <Theater className="w-3.5 h-3.5 mr-1" />
            製作管線
          </TabsTrigger>
          <TabsTrigger value="research" className="text-xs">
            <Database className="w-3.5 h-3.5 mr-1" />
            研究資料庫（{effectiveWorld.researchEntries?.length ?? 0}）
          </TabsTrigger>
          <TabsTrigger value="sounds" className="text-xs">
            <FileAudio className="w-3.5 h-3.5 mr-1" />
            音效庫（{effectiveWorld.soundLibrary?.length ?? 0}）
          </TabsTrigger>
          <TabsTrigger value="script" className="text-xs">
            <FileText className="w-3.5 h-3.5 mr-1" />
            腳本
          </TabsTrigger>
          <TabsTrigger value="storyboards" className="text-xs">
            <Camera className="w-3.5 h-3.5 mr-1" />
            分鏡（{storyboardsQuery.data?.length ?? 0}）
          </TabsTrigger>
          <TabsTrigger value="timeline" className="text-xs">
            <Clock className="w-3.5 h-3.5 mr-1" />
            時間軸上傳
          </TabsTrigger>
          <TabsTrigger value="composition" className="text-xs">
            <Layers className="w-3.5 h-3.5 mr-1" />
            構圖助手
          </TabsTrigger>
        </TabsList>

        <TabsContent value="characters">
          <ScrollArea className="max-h-[70vh] pr-2">
            <div className="space-y-2">
              {effectiveWorld.characters.map(c => (
                <div data-worldbuilding-entity-id={c.id} data-worldbuilding-field="threeView"><CharacterAnimationCard
                  key={c.id}
                  character={c}
                  voices={voicesQuery.data ?? []}
                  models={linkableModelsQuery.data ?? []}
                  onChange={next =>
                    handlePatchWorld({
                      characters: effectiveWorld.characters.map(x =>
                        x.id === c.id ? next : x
                      ),
                    })
                  }
                  onDelete={() =>
                    handlePatchWorld({
                      characters: effectiveWorld.characters.filter(
                        x => x.id !== c.id
                      ),
                    })
                  }
                />
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["protagonist", "+ 主角"],
                    ["supporting", "+ 配角"],
                    ["antagonist", "+ 反派"],
                    ["npc", "+ 路人 / NPC"],
                  ] as Array<[CharacterRole, string]>
                ).map(([role, label]) => (
                  <Button
                    key={role}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handlePatchWorld({
                        characters: [
                          ...effectiveWorld.characters,
                          {
                            id: uid(),
                            name: "",
                            role,
                          },
                        ],
                      })
                    }
                    className="h-7 text-xs"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="scenes">
          <ScrollArea className="max-h-[70vh] pr-2">
            <div className="space-y-2">
              {effectiveWorld.scenes.map(s => (
                <div data-worldbuilding-entity-id={s.id} data-worldbuilding-field="environment"><SceneCard
                  key={s.id}
                  scene={s}
                  styleProfiles={effectiveWorld.styleProfiles ?? []}
                  musicThemes={effectiveWorld.musicThemes ?? []}
                  models={linkableModelsQuery.data ?? []}
                  onChange={next =>
                    handlePatchWorld({
                      scenes: effectiveWorld.scenes.map(x =>
                        x.id === s.id ? next : x
                      ),
                    })
                  }
                  onDelete={() =>
                    handlePatchWorld({
                      scenes: effectiveWorld.scenes.filter(x => x.id !== s.id),
                    })
                  }
                />
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handlePatchWorld({
                    scenes: [
                      ...effectiveWorld.scenes,
                      { id: uid(), name: "" },
                    ],
                  })
                }
                className="h-7 text-xs"
              >
                <Plus className="w-3 h-3 mr-1" /> 新增場景
              </Button>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="style">
          <div className="space-y-2">
            {(effectiveWorld.styleProfiles ?? []).map(sp => (
              <StyleProfileCard
                key={sp.id}
                profile={sp}
                isDefault={effectiveWorld.defaultStyleProfileId === sp.id}
                onChange={next =>
                  handlePatchWorld({
                    styleProfiles: (effectiveWorld.styleProfiles ?? []).map(x =>
                      x.id === sp.id ? next : x
                    ),
                  })
                }
                onSetDefault={() =>
                  handlePatchWorld({
                    defaultStyleProfileId:
                      effectiveWorld.defaultStyleProfileId === sp.id
                        ? null
                        : sp.id,
                  })
                }
                onDelete={() =>
                  handlePatchWorld({
                    styleProfiles: (effectiveWorld.styleProfiles ?? []).filter(
                      x => x.id !== sp.id
                    ),
                    defaultStyleProfileId:
                      effectiveWorld.defaultStyleProfileId === sp.id
                        ? null
                        : effectiveWorld.defaultStyleProfileId,
                  })
                }
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                handlePatchWorld({
                  styleProfiles: [
                    ...(effectiveWorld.styleProfiles ?? []),
                    { id: uid(), name: "" },
                  ],
                })
              }
              className="h-7 text-xs"
            >
              <Plus className="w-3 h-3 mr-1" /> 新增畫面風格 profile
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="music">
          <div className="space-y-2">
            {(effectiveWorld.musicThemes ?? []).map(mt => (
              <MusicThemeCard
                key={mt.id}
                theme={mt}
                onChange={next =>
                  handlePatchWorld({
                    musicThemes: (effectiveWorld.musicThemes ?? []).map(x =>
                      x.id === mt.id ? next : x
                    ),
                  })
                }
                onDelete={() =>
                  handlePatchWorld({
                    musicThemes: (effectiveWorld.musicThemes ?? []).filter(
                      x => x.id !== mt.id
                    ),
                  })
                }
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                handlePatchWorld({
                  musicThemes: [
                    ...(effectiveWorld.musicThemes ?? []),
                    { id: uid(), name: "" },
                  ],
                })
              }
              className="h-7 text-xs"
            >
              <Plus className="w-3 h-3 mr-1" /> 新增配樂主題
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="production">
          <ProductionManifestEditor
            world={effectiveWorld}
            onPatch={handlePatchWorld}
          />
        </TabsContent>

        <TabsContent value="research">
          <ResearchDatabaseEditor
            entries={effectiveWorld.researchEntries ?? []}
            onChange={next =>
              handlePatchWorld({ researchEntries: next })
            }
          />
        </TabsContent>

        <TabsContent value="sounds">
          <SoundLibraryEditor
            items={effectiveWorld.soundLibrary ?? []}
            onChange={next => handlePatchWorld({ soundLibrary: next })}
          />
        </TabsContent>

        <TabsContent value="script">
          <ScriptEditorTab
            worldId={selectedWorld.id!}
            worldName={effectiveWorld.name}
          />
        </TabsContent>

        <TabsContent value="storyboards">
          <div className="space-y-3">
            <SeedStoryboardForm
              worldId={selectedWorld.id!}
              defaultDuration={
                effectiveWorld.productionTargets?.targetDurationSec ?? 60
              }
              defaultFps={
                effectiveWorld.productionTargets?.masterSpec?.fps ?? 24
              }
              defaultAspectRatio={
                effectiveWorld.scenes.find(s => s.preferredAspectRatio)
                  ?.preferredAspectRatio ?? "16:9"
              }
              integrationCounts={{
                characters: effectiveWorld.characters.length,
                scenes: effectiveWorld.scenes.length,
                styles: effectiveWorld.styleProfiles?.length ?? 0,
                music: effectiveWorld.musicThemes?.length ?? 0,
                research: effectiveWorld.researchEntries?.length ?? 0,
                sounds: effectiveWorld.soundLibrary?.length ?? 0,
              }}
              isPending={seedSkeleton.isPending}
              onSeed={args => seedSkeleton.mutate(args)}
            />
            <ScrollArea className="max-h-[60vh] pr-2">
              <div className="space-y-2">
                {(storyboardsQuery.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    尚無分鏡。用上方表單派生第一個分鏡骨架。
                  </p>
                ) : (
                  storyboardsQuery.data!.map(sb => (
                    <div
                      key={sb.id}
                      className="rounded-lg border border-border/30 bg-card/30 p-3 hover:bg-card/50 transition"
                    >
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-muted-foreground shrink-0" />
                        <button
                          type="button"
                          onClick={() => navigate(`/animation/${sb.id}`)}
                          className="text-sm font-medium flex-1 text-left hover:underline truncate"
                        >
                          {sb.name}
                        </button>
                        <Badge variant="outline" className="text-[10px]">
                          {sb.productionStatus}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={e => {
                            e.stopPropagation();
                            const next = window.prompt(
                              "重新命名分鏡草稿",
                              sb.name
                            );
                            if (next && next.trim() && next.trim() !== sb.name) {
                              renameStoryboard.mutate({
                                id: sb.id,
                                patch: { name: next.trim() },
                              });
                            }
                          }}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                          title="重新命名"
                          aria-label="重新命名分鏡"
                        >
                          <Wand2 className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={e => {
                            e.stopPropagation();
                            if (
                              confirm(`確定刪除分鏡草稿「${sb.name}」？此操作無法復原。`)
                            ) {
                              deleteStoryboard.mutate({ id: sb.id });
                            }
                          }}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          title="刪除分鏡草稿"
                          aria-label="刪除分鏡"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate(`/animation/${sb.id}`)}
                        className="text-[11px] text-muted-foreground mt-1 flex gap-3 cursor-pointer w-full text-left"
                      >
                        <span>
                          <Clock className="inline w-2.5 h-2.5 mr-0.5" />
                          {formatTimecode(sb.totalDurationSec)}
                        </span>
                        <span>{sb.fps}fps</span>
                        <span>{sb.aspectRatio}</span>
                        <span>{sb.scenes.length} 場</span>
                        {sb.estimatedCostUsd ? (
                          <span>≈ ${sb.estimatedCostUsd}</span>
                        ) : null}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* Timeline Upload Tab */}
        <TabsContent value="timeline">
          <div className="space-y-4">
            {storyboardsQuery.data && storyboardsQuery.data.length > 0 ? (
              <>
                <div className="text-sm text-muted-foreground">
                  選擇一個分鏡以上傳時間軸圖幀
                </div>
                <Select
                  value={selectedStoryboard?.id ? String(selectedStoryboard.id) : ""}
                  onValueChange={(value) => {
                    const sb = storyboardsQuery.data?.find(s => s.id === Number(value));
                    if (sb) setSelectedStoryboard(sb);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="選擇分鏡..." />
                  </SelectTrigger>
                  <SelectContent>
                    {storyboardsQuery.data.map((sb) => (
                      <SelectItem key={sb.id} value={String(sb.id)}>
                        {sb.name} ({formatTimecode(sb.totalDurationSec)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedStoryboard && (
                  <StoryboardTimelineUploader
                    storyboard={selectedStoryboard}
                    onFrameUploaded={(frame) => {
                      toast.success("圖幀已上傳");
                    }}
                    onFrameDeleted={() => {
                      toast.success("圖幀已刪除");
                    }}
                  />
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                請先創建分鏡，再使用時間軸上傳功能
              </div>
            )}
          </div>
        </TabsContent>

        {/* Composition Assistant Tab */}
        <TabsContent value="composition">
          {effectiveWorld && (
            <CompositionAssistant
              framework={effectiveWorld}
              storyboardId={selectedStoryboard?.id}
              onSave={(composition) => {
                toast.success("構圖已儲存");
              }}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
    </>
  );
}

// ─── Seed storyboard form ──────────────────────────────────────────────────

function SeedStoryboardForm({
  worldId,
  defaultDuration,
  defaultFps,
  defaultAspectRatio,
  integrationCounts,
  isPending,
  onSeed,
}: {
  worldId: number;
  defaultDuration: number;
  defaultFps?: number;
  defaultAspectRatio?: string;
  integrationCounts?: {
    characters: number;
    scenes: number;
    styles: number;
    music: number;
    research: number;
    sounds: number;
  };
  isPending: boolean;
  onSeed: (args: {
    worldId: number;
    totalDurationSec: number;
    sceneCount?: number;
    aspectRatio?: string;
    fps?: number;
    autoSave: boolean;
    name?: string;
  }) => void;
}) {
  const [duration, setDuration] = useState(defaultDuration);
  const [sceneCount, setSceneCount] = useState(6);
  const [aspectRatio, setAspectRatio] = useState(defaultAspectRatio ?? "16:9");
  const [fps, setFps] = useState<number>(defaultFps ?? 24);
  const [name, setName] = useState("");
  // 串連模組狀態 chip
  const integrationChips: Array<{ label: string; count: number; key: string }> =
    integrationCounts
      ? [
          { key: "characters", label: "角色", count: integrationCounts.characters },
          { key: "scenes", label: "場景", count: integrationCounts.scenes },
          { key: "styles", label: "風格", count: integrationCounts.styles },
          { key: "music", label: "配樂", count: integrationCounts.music },
          { key: "research", label: "研究", count: integrationCounts.research },
          { key: "sounds", label: "音效", count: integrationCounts.sounds },
        ]
      : [];
  return (
    <div className="rounded-xl border border-dashed border-border/40 bg-card/20 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <Wand2 className="w-4 h-4" /> 自動派生分鏡骨架
        </h3>
        {integrationChips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {integrationChips.map(chip => (
              <Badge
                key={chip.key}
                variant={chip.count > 0 ? "secondary" : "outline"}
                className={`text-[9px] px-1.5 py-0 h-4 ${
                  chip.count === 0 ? "opacity-40" : ""
                }`}
                title={
                  chip.count > 0
                    ? `${chip.label}模組已串連（${chip.count} 筆資料）`
                    : `${chip.label}模組尚無資料 —— 補上後派生時會自動納入`
                }
              >
                {chip.label} {chip.count}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        派生會把所有模組（角色 outfit/expression/scriptRole、場景 styleProfile/musicTheme/soundDesign、
        研究正史、音效庫、製作目標 fps/比例）串連成分鏡時間軸，按敘事節拍（開場/發展/高潮/結局）分配角色與配樂。
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">名稱（選填）</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="片頭 OP / 第一集"
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">總長（秒）</Label>
          <Input
            type="number"
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">場數</Label>
          <Input
            type="number"
            value={sceneCount}
            onChange={e => setSceneCount(Number(e.target.value))}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">比例</Label>
          <Select value={aspectRatio} onValueChange={setAspectRatio}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STORYBOARD_ASPECT_RATIO_PRESETS.map(p => (
                <SelectItem key={p.value} value={p.value} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">FPS</Label>
          <Select value={String(fps)} onValueChange={v => setFps(Number(v))}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STORYBOARD_FPS_PRESETS.map(f => (
                <SelectItem key={f} value={String(f)} className="text-xs">
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        size="sm"
        onClick={() =>
          onSeed({
            worldId,
            totalDurationSec: duration,
            sceneCount,
            aspectRatio,
            fps,
            autoSave: true,
            name: name || undefined,
          })
        }
        disabled={isPending}
        className="h-8 text-xs"
      >
        {isPending ? "生成中…" : "派生分鏡並儲存"}
      </Button>
    </div>
  );
}

// ─── 管線執行計畫顯示 ─────────────────────────────────────────────────────

function PipelinePlanView({ plan }: { plan: Record<string, unknown> }) {
  const steps = (plan.steps as Array<Record<string, unknown>>) ?? [];
  const byKind: Record<string, number> = {};
  for (const s of steps) {
    const k = String(s.kind ?? "other");
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          總步驟 {steps.length}
        </Badge>
        <Badge variant="outline">
          估時 {formatTimecode(Number(plan.estimatedWallClockSec) || 0)}
        </Badge>
        {plan.estimatedCostUsd != null && (
          <Badge variant="outline">≈ ${String(plan.estimatedCostUsd)}</Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(byKind).map(([k, n]) => (
          <Badge key={k} variant="secondary" className="text-[10px]">
            {k}: {n}
          </Badge>
        ))}
      </div>
      <Collapsible>
        <CollapsibleTrigger className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ChevronDown className="w-3 h-3" />
          展開全部步驟
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-1 mt-2 max-h-[300px] overflow-auto">
            {steps.map((s, i) => (
              <div
                key={String(s.stepId ?? i)}
                className="flex items-center gap-2 py-0.5 border-b border-border/20"
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  {String(s.stepId)}
                </span>
                <Badge variant="outline" className="text-[9px]">
                  {String(s.kind)}
                </Badge>
                <span className="text-muted-foreground">→ {String(s.spirit)}</span>
                {s.estimatedSec != null && (
                  <span className="text-muted-foreground ml-auto">
                    {String(s.estimatedSec)}s
                  </span>
                )}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
