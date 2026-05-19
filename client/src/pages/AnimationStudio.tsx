/**
 * AnimationStudio — 世界觀 + 動畫分鏡的整合工作室
 *
 * 三大區塊：
 *   1. 世界選擇與摘要 —— 列出使用者的所有世界觀，選一個進行動畫製作
 *   2. 角色動畫設定 —— 對選定世界的每個角色配置三視圖、表情包、穿衣集、
 *      口氣、語音檔、腳本定位
 *   3. 分鏡時間軸 —— 列出 / 新建分鏡、auto-seed 骨架、跑管線 plan、匯出鏡頭表
 *
 * 此頁面是「世界觀架構」與「動畫產線」的單一入口，串接全站功能：
 *   - 模型訓練中心（LoRA）— 角色 / 場景 / 風格 profile
 *   - Image Studio / Video Studio — 圖楨 / 細膩化 / i2v
 *   - Pro Studio — 配樂 / 配音 / 音效
 *   - Director AI — 腳本 ↔ 分鏡雙向同步
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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
} from "lucide-react";
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
            <Input
              value={it.imageUrl ?? ""}
              onChange={e => patch(idx, { imageUrl: e.target.value })}
              placeholder="表情預覽圖 URL（可從 Image Studio 拖入）"
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
            <Input
              value={it.imageUrl ?? ""}
              onChange={e => patch(idx, { imageUrl: e.target.value })}
              placeholder="參考圖 URL"
              className="h-7 text-[11px]"
            />
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
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {[
        { key: "frontImageUrl", label: "正面" },
        { key: "sideImageUrl", label: "側面" },
        { key: "backImageUrl", label: "背面" },
        { key: "threeQuarterImageUrl", label: "3/4 視角" },
      ].map(v => {
        const url = (sheet as Record<string, string | undefined>)[v.key];
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
          </div>
        );
      })}
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
                {PERSONALITY_TRAIT_PRESETS.slice(0, 10).map(p => (
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
                    className="px-1.5 py-0.5 rounded-full text-[9px] border border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60 transition"
                  >
                    + {p}
                  </button>
                ))}
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
    </div>
  );
});

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
            {GENRE_PRESETS.slice(0, 10).map(g => (
              <button
                key={g}
                type="button"
                onClick={() => onPatch({ genre: g })}
                className={`px-1.5 py-0.5 rounded-full text-[9px] border transition ${
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
            {ERA_PRESETS.slice(0, 10).map(e => (
              <button
                key={e}
                type="button"
                onClick={() => onPatch({ era: e })}
                className={`px-1.5 py-0.5 rounded-full text-[9px] border transition ${
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
            {SCENE_LIGHTING_PRESETS.slice(0, 10).map(l => (
              <button
                key={l}
                type="button"
                onClick={() => patch({ lighting: l })}
                className={`px-1.5 py-0.5 rounded-full text-[9px] border transition ${
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
            {SCENE_MOOD_PRESETS.slice(0, 10).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => patch({ mood: m })}
                className={`px-1.5 py-0.5 rounded-full text-[9px] border transition ${
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
          {ENVIRONMENT_CHANGE_PRESETS.slice(0, 8).map(ec => {
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
                className={`px-1.5 py-0.5 rounded-full text-[9px] border transition ${
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
    </div>
  );
});

// ─── 主頁面 ────────────────────────────────────────────────────────────────

export default function AnimationStudio() {
  const params = useParams<{ storyboardId?: string }>();
  const [, navigate] = useLocation();

  const worldsQuery = trpc.worldbuilding.list.useQuery();
  const voicesQuery = trpc.worldbuilding.linkableVoices.useQuery();
  const linkableModelsQuery = trpc.worldbuilding.linkableModels.useQuery();
  const utils = trpc.useUtils();

  const [selectedWorldId, setSelectedWorldId] = useState<number | null>(null);
  const [selectedTab, setSelectedTab] = useState<
    "characters" | "scenes" | "style" | "music" | "storyboards"
  >("characters");

  // 自動選第一個世界
  const worlds = worldsQuery.data ?? [];
  if (selectedWorldId === null && worlds.length > 0) {
    setSelectedWorldId(worlds[0].id);
  }
  const selectedWorld = useMemo(
    () => worlds.find(w => w.id === selectedWorldId) ?? null,
    [worlds, selectedWorldId]
  );

  const storyboardsQuery = trpc.worldStoryboard.listByWorld.useQuery(
    { worldId: selectedWorldId! },
    { enabled: !!selectedWorldId }
  );

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
              tags: latest.tags,
            },
          });
          return latest;
        });
      }, 600);
    },
    [updateWorld]
  );

  // 開分鏡細節（URL 路由）
  const detailStoryboardId = params.storyboardId
    ? Number(params.storyboardId)
    : null;
  const storyboardDetailQuery = trpc.worldStoryboard.get.useQuery(
    { id: detailStoryboardId! },
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

  if (worldsQuery.isLoading) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        載入世界觀中…
      </div>
    );
  }

  if (worlds.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center space-y-4">
        <Film className="w-12 h-12 mx-auto text-muted-foreground/50" />
        <h2 className="text-lg font-semibold">建立第一個世界觀</h2>
        <p className="text-sm text-muted-foreground">
          動畫工作室 = 世界觀 × 分鏡。先在這裡建立世界、配置角色（三視圖、表情、
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
      <div className="p-4 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/animation")}
            className="text-xs"
          >
            ← 返回工作室
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
    );
  }

  if (!selectedWorld) return null;

  // 渲染用 draft（本地、即時反應使用者輸入），未 ready 時 fallback 到 server 資料
  const effectiveWorld = draft ?? selectedWorld;

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Film className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">動畫工作室</h1>
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
      </div>

      {/* 世界觀基本資料（從導演 AI 融合進來，一處編完） */}
      <WorldBasicsEditor
        world={effectiveWorld}
        onPatch={handlePatchWorld}
      />

      {/* Production targets quick edit */}
      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <h3 className="text-sm font-semibold">製作目標</h3>
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
          <TabsTrigger value="storyboards" className="text-xs">
            <Camera className="w-3.5 h-3.5 mr-1" />
            分鏡（{storyboardsQuery.data?.length ?? 0}）
          </TabsTrigger>
        </TabsList>

        <TabsContent value="characters">
          <ScrollArea className="max-h-[70vh] pr-2">
            <div className="space-y-2">
              {effectiveWorld.characters.map(c => (
                <CharacterAnimationCard
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
                <SceneCard
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

        <TabsContent value="storyboards">
          <div className="space-y-3">
            <SeedStoryboardForm
              worldId={selectedWorld.id!}
              defaultDuration={
                effectiveWorld.productionTargets?.targetDurationSec ?? 60
              }
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
                    <button
                      key={sb.id}
                      type="button"
                      onClick={() => navigate(`/animation/${sb.id}`)}
                      className="w-full text-left rounded-lg border border-border/30 bg-card/30 p-3 hover:bg-card/50 transition"
                    >
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium flex-1">{sb.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {sb.productionStatus}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex gap-3">
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
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Seed storyboard form ──────────────────────────────────────────────────

function SeedStoryboardForm({
  worldId,
  defaultDuration,
  isPending,
  onSeed,
}: {
  worldId: number;
  defaultDuration: number;
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
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [fps, setFps] = useState<number>(24);
  const [name, setName] = useState("");
  return (
    <div className="rounded-xl border border-dashed border-border/40 bg-card/20 p-3 space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-1">
        <Wand2 className="w-4 h-4" /> 自動派生分鏡骨架
      </h3>
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
