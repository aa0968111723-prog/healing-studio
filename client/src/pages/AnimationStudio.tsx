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

import { memo, useCallback, useMemo, useState } from "react";
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
} from "lucide-react";
import {
  ART_STYLE_PRESETS,
  CAMERA_MOVEMENT_PRESETS,
  CHARACTER_ARCHETYPE_PRESETS,
  CHARACTER_ROLE_LABELS,
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
}: {
  character: WorldCharacter;
  voices: Array<{
    modelId: string;
    label: string;
    provider: string;
    category: string | null;
    strengths: string[];
  }>;
  onChange: (next: WorldCharacter) => void;
}) {
  const [openSection, setOpenSection] = useState<string | null>("threeView");
  const patch = (p: Partial<WorldCharacter>) =>
    onChange({ ...character, ...p });

  const sections = [
    { id: "threeView", label: "三視圖", icon: ImageIcon },
    { id: "expressions", label: "表情包", icon: Smile },
    { id: "outfits", label: "穿衣集", icon: Shirt },
    { id: "tone", label: "口氣", icon: MessageCircle },
    { id: "voice", label: "語音檔", icon: Volume2 },
    { id: "scriptRole", label: "腳本定位", icon: Theater },
  ];

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase">
          {CHARACTER_ROLE_LABELS[character.role]}
        </Badge>
        <span className="text-sm font-medium">{character.name || "未命名"}</span>
        {character.triggerWord && (
          <Badge variant="secondary" className="text-[9px] font-mono">
            {character.triggerWord}
          </Badge>
        )}
      </div>

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

// ─── 主頁面 ────────────────────────────────────────────────────────────────

export default function AnimationStudio() {
  const params = useParams<{ storyboardId?: string }>();
  const [, navigate] = useLocation();

  const worldsQuery = trpc.worldbuilding.list.useQuery();
  const voicesQuery = trpc.worldbuilding.linkableVoices.useQuery();
  const utils = trpc.useUtils();

  const [selectedWorldId, setSelectedWorldId] = useState<number | null>(null);
  const [selectedTab, setSelectedTab] = useState<
    "characters" | "style" | "music" | "storyboards"
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

  const updateWorld = trpc.worldbuilding.update.useMutation({
    onSuccess: () => utils.worldbuilding.list.invalidate(),
  });

  const handlePatchWorld = useCallback(
    (patch: Partial<WorldbuildingFrameworkData>) => {
      if (!selectedWorld) return;
      updateWorld.mutate({
        id: selectedWorld.id!,
        patch: {
          ...patch,
        },
      });
    },
    [selectedWorld, updateWorld]
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
        <h2 className="text-lg font-semibold">尚無世界觀</h2>
        <p className="text-sm text-muted-foreground">
          動畫工作室以「世界觀」為起點：先建立角色與場景，再在這裡配置三視圖、表情、
          穿衣、口氣、語音與腳本定位，最後派生分鏡時間軸、編排動畫渲染管線。
        </p>
        <Button onClick={() => navigate("/director")}>
          <Plus className="w-4 h-4 mr-2" />
          到導演 AI 建立世界觀
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
          onClick={() => navigate("/director")}
          className="h-8 text-xs"
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1" />
          編輯世界觀基本資料
        </Button>
      </div>

      {/* Production targets quick edit */}
      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <h3 className="text-sm font-semibold">製作目標</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">格式</Label>
            <Select
              value={selectedWorld.productionTargets?.format ?? ""}
              onValueChange={v =>
                handlePatchWorld({
                  productionTargets: {
                    ...selectedWorld.productionTargets,
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
              value={selectedWorld.productionTargets?.targetDurationSec ?? 0}
              onChange={e =>
                handlePatchWorld({
                  productionTargets: {
                    ...selectedWorld.productionTargets,
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
              value={selectedWorld.productionTargets?.audience ?? ""}
              onChange={e =>
                handlePatchWorld({
                  productionTargets: {
                    ...selectedWorld.productionTargets,
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
              value={selectedWorld.productionTargets?.platform ?? ""}
              onChange={e =>
                handlePatchWorld({
                  productionTargets: {
                    ...selectedWorld.productionTargets,
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
          value={selectedWorld.globalNegativePrompt ?? ""}
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
            角色（{selectedWorld.characters.length}）
          </TabsTrigger>
          <TabsTrigger value="style" className="text-xs">
            <Layers className="w-3.5 h-3.5 mr-1" />
            風格設定（{selectedWorld.styleProfiles?.length ?? 0}）
          </TabsTrigger>
          <TabsTrigger value="music" className="text-xs">
            <Music className="w-3.5 h-3.5 mr-1" />
            配樂主題（{selectedWorld.musicThemes?.length ?? 0}）
          </TabsTrigger>
          <TabsTrigger value="storyboards" className="text-xs">
            <Camera className="w-3.5 h-3.5 mr-1" />
            分鏡（{storyboardsQuery.data?.length ?? 0}）
          </TabsTrigger>
        </TabsList>

        <TabsContent value="characters">
          <ScrollArea className="max-h-[70vh] pr-2">
            <div className="space-y-2">
              {selectedWorld.characters.map(c => (
                <CharacterAnimationCard
                  key={c.id}
                  character={c}
                  voices={voicesQuery.data ?? []}
                  onChange={next =>
                    handlePatchWorld({
                      characters: selectedWorld.characters.map(x =>
                        x.id === c.id ? next : x
                      ),
                    })
                  }
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="style">
          <div className="space-y-2">
            {(selectedWorld.styleProfiles ?? []).map(sp => (
              <StyleProfileCard
                key={sp.id}
                profile={sp}
                isDefault={selectedWorld.defaultStyleProfileId === sp.id}
                onChange={next =>
                  handlePatchWorld({
                    styleProfiles: (selectedWorld.styleProfiles ?? []).map(x =>
                      x.id === sp.id ? next : x
                    ),
                  })
                }
                onSetDefault={() =>
                  handlePatchWorld({
                    defaultStyleProfileId:
                      selectedWorld.defaultStyleProfileId === sp.id
                        ? null
                        : sp.id,
                  })
                }
                onDelete={() =>
                  handlePatchWorld({
                    styleProfiles: (selectedWorld.styleProfiles ?? []).filter(
                      x => x.id !== sp.id
                    ),
                    defaultStyleProfileId:
                      selectedWorld.defaultStyleProfileId === sp.id
                        ? null
                        : selectedWorld.defaultStyleProfileId,
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
                    ...(selectedWorld.styleProfiles ?? []),
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
            {(selectedWorld.musicThemes ?? []).map(mt => (
              <MusicThemeCard
                key={mt.id}
                theme={mt}
                onChange={next =>
                  handlePatchWorld({
                    musicThemes: (selectedWorld.musicThemes ?? []).map(x =>
                      x.id === mt.id ? next : x
                    ),
                  })
                }
                onDelete={() =>
                  handlePatchWorld({
                    musicThemes: (selectedWorld.musicThemes ?? []).filter(
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
                    ...(selectedWorld.musicThemes ?? []),
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
                selectedWorld.productionTargets?.targetDurationSec ?? 60
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
