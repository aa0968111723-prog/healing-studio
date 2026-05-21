/**
 * ScriptEditorTab — 世界觀系統內嵌的腳本編輯與整合
 *
 * 三段式流程，整段都待在 /animation 不跳出：
 *   1. 匯入腳本：貼上原文 / 上傳檔案 / 選來源格式
 *   2. AI 分析：呼叫 trpc.director.importScript 拆成 segments
 *   3. 派生分鏡草稿：把 segments 轉成 world_storyboard 並寫入後端
 *
 * 草稿存在 localStorage（key 帶 worldId），避免 reload 丟失。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Upload,
  Sparkles,
  Wand2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Camera,
  Users,
  MapPin,
  AlertTriangle,
  Plus,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { parseDurationToSeconds } from "../../../../shared/orb-script-structure";
import { detectScriptEntities } from "../../../../shared/script-entity-detection";
import { calculateWorldbuildingProgress } from "../../../../shared/worldbuilding-progress";
import { detectScriptAssetNeeds } from "../../../../shared/script-asset-needs";
import type { ScriptSegment } from "../../../../shared/types";
import type {
  WorldbuildingFrameworkData,
  WorldCharacter,
  WorldScene,
} from "../../../../shared/worldbuilding-types";
import { SourcePicker } from "./SourcePicker";

const FORMAT_OPTIONS = [
  { value: "plaintext", label: "純文字" },
  { value: "screenplay", label: "劇本" },
  { value: "fdx", label: "Final Draft" },
  { value: "fountain", label: "Fountain" },
  { value: "srt", label: "字幕 SRT" },
  { value: "markdown", label: "Markdown" },
] as const;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseSegmentDurationSec(d: string | undefined): number {
  if (!d) return 6;
  const parsed = parseDurationToSeconds(d);
  if (parsed && parsed > 0) return parsed;
  // 退路：純數字當秒
  const n = Number(String(d).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 6;
}

type DraftState = {
  title: string;
  content: string;
  format: string;
  segments: ScriptSegment[];
  scriptId: string | null;
};

const EMPTY_DRAFT: DraftState = {
  title: "",
  content: "",
  format: "plaintext",
  segments: [],
  scriptId: null,
};

function draftKey(worldId: number) {
  return `hs.animation.scriptDraft.v1.${worldId}`;
}

export const ScriptEditorTab = memo(function ScriptEditorTab({
  worldId,
  worldName,
}: {
  worldId: number;
  worldName: string;
}) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [draft, setDraft] = useState<DraftState>(() => {
    if (typeof window === "undefined") return EMPTY_DRAFT;
    try {
      const raw = localStorage.getItem(draftKey(worldId));
      if (raw) {
        const parsed = JSON.parse(raw) as DraftState;
        if (
          parsed &&
          typeof parsed.content === "string" &&
          Array.isArray(parsed.segments)
        )
          return parsed;
      }
    } catch {
      // ignore
    }
    return EMPTY_DRAFT;
  });
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(
    new Set()
  );

  // Persist draft per world.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(draftKey(worldId), JSON.stringify(draft));
    } catch {
      // ignore quota
    }
  }, [draft, worldId]);

  // Reset when switching worlds.
  const lastWorldRef = useRef<number>(worldId);
  useEffect(() => {
    if (lastWorldRef.current !== worldId) {
      lastWorldRef.current = worldId;
      try {
        const raw = localStorage.getItem(draftKey(worldId));
        setDraft(raw ? (JSON.parse(raw) as DraftState) : EMPTY_DRAFT);
      } catch {
        setDraft(EMPTY_DRAFT);
      }
    }
  }, [worldId]);

  const importScript = trpc.director.importScript.useMutation({
    onSuccess: data => {
      setDraft(d => ({
        ...d,
        title: data.title,
        segments: data.segments,
        scriptId: data.id,
      }));
      toast.success(`AI 已拆出 ${data.segments.length} 段分鏡`);
    },
    onError: e => toast.error(`分析失敗：${e.message}`),
  });

  // 取得當前世界資料，用於與腳本中偵測到的角色/場景比對
  const worldQuery = trpc.worldbuilding.get.useQuery(
    { id: worldId },
    { retry: false, staleTime: 30_000 }
  );
  const worldData = worldQuery.data as
    | (WorldbuildingFrameworkData & { id: number })
    | undefined;

  const worldUpdate = trpc.worldbuilding.update.useMutation({
    onSuccess: () => {
      utils.worldbuilding.get.invalidate({ id: worldId });
      utils.worldbuilding.list.invalidate();
    },
    onError: e => toast.error(`更新世界觀失敗：${e.message}`),
  });

  const createStoryboard = trpc.worldStoryboard.create.useMutation({
    onSuccess: ({ id }) => {
      toast.success("分鏡草稿已建立");
      utils.worldStoryboard.listByWorld.invalidate();
      navigate(`/animation/${id}`);
    },
    onError: e => toast.error(`派生分鏡失敗：${e.message}`),
  });

  // ─── 腳本實體偵測 ───────────────────────────────────────────────────────
  // 從原文 + AI 拆出的段落合併分析，再與既有世界觀對齊出 unknown 清單。
  const scriptAnalysis = useMemo(() => {
    const segmentDialogues = draft.segments
      .map(s => {
        const head = s.storyboard.sceneHeading
          ? `場景：${s.storyboard.sceneHeading}`
          : "";
        const dialogue = s.storyboard.dialogue ?? "";
        return [head, dialogue].filter(Boolean).join("\n");
      })
      .join("\n\n");
    const combined = [draft.content, segmentDialogues]
      .filter(t => t && t.trim().length > 0)
      .join("\n\n");
    return detectScriptEntities(combined, worldData ?? null);
  }, [draft.content, draft.segments, worldData]);


  const worldProgress = useMemo(
    () => calculateWorldbuildingProgress(worldData ?? null),
    [worldData]
  );

  // 引導步驟完成狀態（純衍生，不需要持久化）
  const guideSteps = useMemo(() => {
    const hasAnalysis = draft.segments.length > 0;
    const allCharsKnown =
      hasAnalysis &&
      scriptAnalysis.unknownCharacters.length === 0 &&
      scriptAnalysis.characters.length > 0;
    const allScenesKnown =
      hasAnalysis &&
      scriptAnalysis.unknownScenes.length === 0 &&
      scriptAnalysis.scenes.length > 0;
    const charactersComplete =
      worldProgress.categories.characters.percent >= 60;
    const scenesComplete = worldProgress.categories.scenes.percent >= 60;
    const styleMusicVoiceReady =
      worldProgress.categories.style.percent > 0 &&
      worldProgress.categories.music.percent > 0 &&
      worldProgress.categories.voice.percent > 0;
    return [
      {
        key: "analyze",
        label: "確認 AI 拆出的分鏡段落",
        done: hasAnalysis,
        action: hasAnalysis ? null : "scroll-to-analysis",
      },
      {
        key: "addEntities",
        label: "將腳本中的角色 / 場景加入世界觀",
        done: hasAnalysis && allCharsKnown && allScenesKnown,
        action: "scroll-to-entities",
      },
      {
        key: "fillCharSceneDetails",
        label: "補齊角色與場景的詳細設定（外觀、氛圍）",
        done: charactersComplete && scenesComplete,
        action: "open-world",
      },
      {
        key: "fillStyleMusicVoice",
        label: "補足風格 / 配樂 / 配音",
        done: styleMusicVoiceReady,
        action: "open-world",
      },
      {
        key: "deriveStoryboard",
        label: "進入分鏡規劃",
        done: false, // 此步在按鈕點下後完成
        action: "derive-storyboard",
      },
    ];
  }, [draft.segments.length, scriptAnalysis, worldProgress]);

  const addCharactersToWorld = useCallback(
    async (names: string[]) => {
      if (!worldData || names.length === 0) return;
      const existing = worldData.characters ?? [];
      const newChars: WorldCharacter[] = names.map(name => ({
        id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        role: "supporting" as const,
        tagline: "從腳本偵測建立，請補外觀與聲音以保持生成一致性。",
        appearance: "",
        personality: "",
      }));
      await worldUpdate.mutateAsync({
        id: worldId,
        patch: { characters: [...existing, ...newChars] },
      });
      toast.success("已建立角色草稿，請補外觀以保持生成一致性。");
    },
    [worldData, worldId, worldUpdate]
  );

  const addScenesToWorld = useCallback(
    async (names: string[]) => {
      if (!worldData || names.length === 0) return;
      const existing = worldData.scenes ?? [];
      const newScenes: WorldScene[] = names.map(name => ({
        id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        tagline: "從腳本偵測建立，請補場景氛圍與參考圖。",
        environment: "",
        mood: "",
        lighting: "",
      }));
      await worldUpdate.mutateAsync({
        id: worldId,
        patch: { scenes: [...existing, ...newScenes] },
      });
      toast.success("已建立場景草稿，請補氛圍與參考圖以保持畫面一致性。");
    },
    [worldData, worldId, worldUpdate]
  );

  const totalDurationSec = useMemo(() => {
    return draft.segments.reduce(
      (sum, s) => sum + parseSegmentDurationSec(s.storyboard.duration),
      0
    );
  }, [draft.segments]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const text = String(ev.target?.result ?? "");
        setDraft(d => ({
          ...d,
          content: text,
          title: d.title || file.name.replace(/\.[^.]+$/, ""),
        }));
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    []
  );

  const handleAnalyze = useCallback(() => {
    if (!draft.content.trim()) {
      toast.error("請輸入或上傳腳本內容");
      return;
    }
    if (!draft.title.trim()) {
      toast.error("請輸入腳本標題");
      return;
    }
    importScript.mutate({
      rawContent: draft.content,
      title: draft.title,
      sourceFormat: draft.format,
      personality: "creative",
    });
  }, [draft.content, draft.title, draft.format, importScript]);

  const patchSegment = useCallback(
    (id: string, patch: Partial<ScriptSegment["storyboard"]>) => {
      setDraft(d => ({
        ...d,
        segments: d.segments.map(s =>
          s.id === id
            ? { ...s, storyboard: { ...s.storyboard, ...patch } }
            : s
        ),
      }));
    },
    []
  );

  const removeSegment = useCallback((id: string) => {
    setDraft(d => ({
      ...d,
      segments: d.segments
        .filter(s => s.id !== id)
        .map((s, idx) => ({ ...s, index: idx })),
    }));
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedSegments(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeriveStoryboard = useCallback(() => {
    if (draft.segments.length === 0) {
      toast.error("請先分析腳本以產生分鏡段落");
      return;
    }
    let cursor = 0;
    const scenes = draft.segments.map(seg => {
      const dur = parseSegmentDurationSec(seg.storyboard.duration);
      const startSec = cursor;
      const endSec = cursor + dur;
      cursor = endSec;
      const notesParts: string[] = [];
      if (seg.storyboard.dialogue)
        notesParts.push(`對白：${seg.storyboard.dialogue}`);
      if (seg.storyboard.soundDesign)
        notesParts.push(`音效：${seg.storyboard.soundDesign}`);
      if (seg.storyboard.mood) notesParts.push(`氛圍：${seg.storyboard.mood}`);
      return {
        id: uid(),
        sequenceIndex: seg.index,
        startSec,
        endSec,
        title:
          seg.storyboard.sceneHeading ||
          `第 ${seg.index + 1} 場`,
        characterBeats: [],
        actionDescription: seg.storyboard.visualDescription || seg.rawText,
        cameraDirection: seg.storyboard.cameraDirection || undefined,
        frames: [],
        audioClips: [],
        status: "draft" as const,
        notes: notesParts.join("\n") || undefined,
      };
    });

    createStoryboard.mutate({
      worldId,
      name: `${draft.title || worldName} 分鏡草稿`,
      totalDurationSec: Math.max(cursor, 1),
      fps: 24,
      aspectRatio: "16:9",
      scenes,
      sourceScriptId: draft.scriptId ?? undefined,
      productionStatus: "planning",
    });
  }, [draft, worldId, worldName, createStoryboard]);

  const handleClearDraft = useCallback(() => {
    if (!confirm("確定清除目前的腳本草稿？")) return;
    setDraft(EMPTY_DRAFT);
    try {
      localStorage.removeItem(draftKey(worldId));
    } catch {
      // ignore
    }
    toast.success("腳本草稿已清除");
  }, [worldId]);

  return (
    <div className="space-y-3">
      {/* Import header */}
      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <FileText className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold flex-1">腳本匯入 & 整合</h3>
          <span className="text-[10px] text-muted-foreground">
            支援純文字、劇本、Fountain、SRT 等
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">腳本標題</Label>
            <Input
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="例：第一集 OP"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">來源格式</Label>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {FORMAT_OPTIONS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() =>
                    setDraft(d => ({ ...d, format: f.value }))
                  }
                  className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                    draft.format === f.value
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] text-muted-foreground">腳本內容</Label>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {draft.content.length.toLocaleString()} 字
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.srt,.fdx,.fountain,.md,.csv,.json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-6 px-2 text-[10px] gap-1"
              >
                <Upload className="w-3 h-3" />
                上傳檔案
              </Button>
              <SourcePicker
                label="從來源引用"
                accept=".txt,.srt,.fdx,.fountain,.md,.csv,.json,text/*"
                assetKind="any"
                onPick={async r => {
                  // Fetch remote script text and pipe into the textarea.
                  try {
                    const resp = await fetch(r.url);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const text = await resp.text();
                    setDraft(d => ({
                      ...d,
                      content: text,
                      title: d.title || r.label || "匯入腳本",
                    }));
                    toast.success(`已引用「${r.label ?? "腳本"}」`);
                  } catch (e) {
                    toast.error(
                      `讀取失敗：${e instanceof Error ? e.message : "未知錯誤"}（請改用直接貼上或本機上傳）`
                    );
                  }
                }}
              />
            </div>
          </div>
          <Textarea
            value={draft.content}
            onChange={e =>
              setDraft(d => ({ ...d, content: e.target.value }))
            }
            placeholder="貼上腳本內容…（純文字、劇本、字幕、Fountain 等任何格式）"
            className="min-h-[140px] text-xs leading-relaxed"
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          {(draft.content || draft.segments.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearDraft}
              className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              清除草稿
            </Button>
          )}
          <Button
            onClick={handleAnalyze}
            disabled={
              importScript.isPending ||
              !draft.content.trim() ||
              !draft.title.trim()
            }
            size="sm"
            className="h-8 text-xs gap-1"
          >
            {importScript.isPending ? (
              <>
                <Wand2 className="w-3.5 h-3.5 animate-spin" />
                分析中…
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                AI 分析腳本
              </>
            )}
          </Button>
        </div>
      </div>

      {/* AI 分析洞察 + 引導流程 */}
      {draft.segments.length > 0 && (
        <ScriptAnalysisInsights
          analysis={scriptAnalysis}
          worldProgress={worldProgress}
          worldDataReady={!!worldData}
          onAddCharacters={addCharactersToWorld}
          onAddScenes={addScenesToWorld}
          onOpenWorld={() => navigate(`/animation?worldId=${worldId}`)}
          isUpdating={worldUpdate.isPending}
          onDraftAssist={async analysis => {
            const unknownChars = analysis.unknownCharacters.map(c => c.name);
            const unknownScenes = analysis.unknownScenes.map(c => c.name);
            if (unknownChars.length) await addCharactersToWorld(unknownChars);
            if (unknownScenes.length) await addScenesToWorld(unknownScenes);
            if (unknownChars.length) toast.success("已建立角色草稿，請補外觀以保持生成一致性。");
            if (!unknownChars.length && !unknownScenes.length) toast.info("目前沒有可補的未知角色或場景");
          }}
          scriptText={[draft.content, draft.segments.map(s => [s.storyboard.sceneHeading, s.storyboard.dialogue, s.storyboard.visualDescription].filter(Boolean).join("\n")).join("\n")].join("\n")}
        />
      )}
      {draft.segments.length > 0 && (
        <GuidedFlow
          steps={guideSteps}
          onAction={action => {
            if (action === "open-world") {
              navigate(`/animation?worldId=${worldId}`);
            } else if (action === "derive-storyboard") {
              handleDeriveStoryboard();
            } else if (action === "scroll-to-entities") {
              document
                .getElementById("script-entities-section")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }}
        />
      )}

      {/* Segment list */}
      {draft.segments.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold flex-1">
              分鏡段落（{draft.segments.length}）
            </h3>
            <Badge variant="outline" className="text-[10px]">
              總時長 ≈ {totalDurationSec}s
            </Badge>
            <Button
              onClick={handleDeriveStoryboard}
              disabled={createStoryboard.isPending}
              size="sm"
              className="h-8 text-xs gap-1"
            >
              <Camera className="w-3.5 h-3.5" />
              {createStoryboard.isPending
                ? "建立中…"
                : "派生為分鏡草稿並儲存"}
            </Button>
          </div>

          <ScrollArea className="max-h-[55vh] pr-2">
            <div className="space-y-1.5">
              {draft.segments.map(seg => {
                const isOpen = expandedSegments.has(seg.id);
                const dur = parseSegmentDurationSec(seg.storyboard.duration);
                return (
                  <div
                    key={seg.id}
                    className="rounded-lg border border-border/30 bg-card/30 overflow-hidden"
                  >
                    <div className="flex items-center gap-2 p-2 hover:bg-card/50 transition">
                      <button
                        type="button"
                        onClick={() => toggleExpand(seg.id)}
                        className="flex items-center gap-2 flex-1 text-left min-w-0"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          #{seg.index + 1}
                        </Badge>
                        <span className="text-xs font-medium flex-1 truncate">
                          {seg.storyboard.sceneHeading ||
                            seg.rawText.slice(0, 40) ||
                            "(無標題)"}
                        </span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {dur}s
                        </Badge>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSegment(seg.id)}
                        className="text-muted-foreground hover:text-destructive p-0.5 shrink-0"
                        title="刪除段落"
                        aria-label="刪除段落"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {isOpen && (
                      <div className="px-3 py-2 space-y-1.5 border-t border-border/20 bg-card/20">
                        <div>
                          <Label className="text-[10px] text-muted-foreground">
                            場景標題
                          </Label>
                          <Input
                            value={seg.storyboard.sceneHeading}
                            onChange={e =>
                              patchSegment(seg.id, {
                                sceneHeading: e.target.value,
                              })
                            }
                            placeholder="EXT. 森林 — 黃昏"
                            className="h-7 text-[11px]"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">
                            畫面描述
                          </Label>
                          <Textarea
                            value={seg.storyboard.visualDescription}
                            onChange={e =>
                              patchSegment(seg.id, {
                                visualDescription: e.target.value,
                              })
                            }
                            placeholder="角色動作、場景元素、構圖…"
                            className="min-h-[60px] text-[11px]"
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px] text-muted-foreground">
                              對白
                            </Label>
                            <Textarea
                              value={seg.storyboard.dialogue}
                              onChange={e =>
                                patchSegment(seg.id, {
                                  dialogue: e.target.value,
                                })
                              }
                              placeholder="角色台詞 / VO…"
                              className="min-h-[40px] text-[11px]"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground">
                              音效 / 配樂
                            </Label>
                            <Textarea
                              value={seg.storyboard.soundDesign}
                              onChange={e =>
                                patchSegment(seg.id, {
                                  soundDesign: e.target.value,
                                })
                              }
                              placeholder="風聲、配樂進場…"
                              className="min-h-[40px] text-[11px]"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground">
                              鏡頭運動
                            </Label>
                            <Input
                              value={seg.storyboard.cameraDirection}
                              onChange={e =>
                                patchSegment(seg.id, {
                                  cameraDirection: e.target.value,
                                })
                              }
                              placeholder="推軌、特寫、空拍…"
                              className="h-7 text-[11px]"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground">
                              氛圍
                            </Label>
                            <Input
                              value={seg.storyboard.mood}
                              onChange={e =>
                                patchSegment(seg.id, { mood: e.target.value })
                              }
                              placeholder="療癒、緊張、懸疑…"
                              className="h-7 text-[11px]"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground">
                              時長
                            </Label>
                            <Input
                              value={seg.storyboard.duration}
                              onChange={e =>
                                patchSegment(seg.id, {
                                  duration: e.target.value,
                                })
                              }
                              placeholder="例如：6 秒 / 30s / 1 分"
                              className="h-7 text-[11px]"
                            />
                          </div>
                        </div>
                        {seg.rawText && (
                          <details className="text-[10px] text-muted-foreground">
                            <summary className="cursor-pointer hover:text-foreground">
                              原文片段
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] bg-card/30 rounded p-2 max-h-32 overflow-auto">
                              {seg.rawText}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <p className="text-[10px] text-muted-foreground">
            派生分鏡會把每段轉成一個 scene；之後在「分鏡」分頁打開可進一步配置
            character beats、frames、audio clips、運鏡與管線。
          </p>
        </div>
      )}

      {draft.segments.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">
          尚未分析腳本。在上方貼上內容或上傳檔案後點「AI 分析腳本」開始拆分鏡。
        </p>
      )}
    </div>
  );
});

// ─── 子組件：腳本分析洞察 ────────────────────────────────────────────────────
// 顯示 AI 偵測到的角色與場景，並提供「添加至世界觀」按鈕。
// 同時把缺漏資訊（影響生成品質）的提醒呈現給使用者。

type ScriptAnalysisInsightsProps = {
  analysis: ReturnType<typeof detectScriptEntities>;
  worldProgress: ReturnType<typeof calculateWorldbuildingProgress>;
  worldDataReady: boolean;
  onAddCharacters: (names: string[]) => Promise<void>;
  onAddScenes: (names: string[]) => Promise<void>;
  onOpenWorld: () => void;
  isUpdating: boolean;
  onDraftAssist: (analysis: ReturnType<typeof detectScriptEntities>) => Promise<void>;
  scriptText: string;
};

function ScriptAnalysisInsights({
  analysis,
  worldProgress,
  worldDataReady,
  onAddCharacters,
  onAddScenes,
  onOpenWorld,
  isUpdating,
  onDraftAssist,
  scriptText,
}: ScriptAnalysisInsightsProps) {
  const hasCharacters = analysis.characters.length > 0;
  const hasScenes = analysis.scenes.length > 0;
  const unknownChars = analysis.unknownCharacters;
  const unknownScenes = analysis.unknownScenes;

  // 額外的智能缺漏提醒：腳本提到的角色尚未填外觀
  const charsWithoutAppearance = useMemo(() => {
    if (!worldDataReady) return [];
    return analysis.characters
      .filter(c => c.matchedExistingId)
      .filter(c => {
        // 找出對應世界觀角色的進度子項目
        const charProgress = worldProgress.categories.characters;
        const apprItem = charProgress.subItems.find(i => i.key === "appearance");
        return apprItem && !apprItem.done;
      });
  }, [analysis.characters, worldDataReady, worldProgress]);


  const assetNeeds = useMemo(() => detectScriptAssetNeeds(scriptText, analysis), [scriptText, analysis]);
  return (
    <div
      id="script-entities-section"
      className="rounded-xl border border-primary/30 bg-primary/[0.04] p-3 space-y-3"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">AI 偵測到的角色與場景</h3>
      </div>

      {/* 角色 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] font-medium flex items-center gap-1.5">
            <Users className="w-3 h-3 text-muted-foreground" />
            角色（{analysis.characters.length}）
          </Label>
          {unknownChars.length > 0 && worldDataReady && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onAddCharacters(unknownChars.map(c => c.name))
              }
              disabled={isUpdating}
              className="h-6 text-[10px] gap-1"
            >
              <Plus className="w-3 h-3" />
              一鍵加入 {unknownChars.length} 個未知角色
            </Button>
          )}
        </div>
        {hasCharacters ? (
          <div className="flex flex-wrap gap-1">
            {analysis.characters.slice(0, 20).map(c => {
              const isUnknown = !c.matchedExistingId;
              return (
                <Badge
                  key={c.name}
                  variant={isUnknown ? "outline" : "secondary"}
                  className={`text-[10px] h-5 px-1.5 gap-1 ${
                    isUnknown ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : ""
                  }`}
                  title={
                    isUnknown
                      ? `未在世界觀中（出現 ${c.occurrences} 次）`
                      : `已在世界觀中（出現 ${c.occurrences} 次）`
                  }
                >
                  {isUnknown && <AlertTriangle className="w-2.5 h-2.5" />}
                  {c.name}
                  <span className="opacity-60 font-mono">×{c.occurrences}</span>
                </Badge>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">
            未偵測到角色（可在腳本中以「角色名：對白」格式標示）
          </p>
        )}
      </div>

      {/* 場景 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] font-medium flex items-center gap-1.5">
            <MapPin className="w-3 h-3 text-muted-foreground" />
            場景（{analysis.scenes.length}）
          </Label>
          {unknownScenes.length > 0 && worldDataReady && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAddScenes(unknownScenes.map(s => s.name))}
              disabled={isUpdating}
              className="h-6 text-[10px] gap-1"
            >
              <Plus className="w-3 h-3" />
              一鍵加入 {unknownScenes.length} 個未知場景
            </Button>
          )}
        </div>
        {hasScenes ? (
          <div className="flex flex-wrap gap-1">
            {analysis.scenes.slice(0, 20).map(s => {
              const isUnknown = !s.matchedExistingId;
              return (
                <Badge
                  key={s.name}
                  variant={isUnknown ? "outline" : "secondary"}
                  className={`text-[10px] h-5 px-1.5 gap-1 ${
                    isUnknown ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : ""
                  }`}
                >
                  {isUnknown && <AlertTriangle className="w-2.5 h-2.5" />}
                  {s.name}
                </Badge>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">
            未偵測到場景（可加入「場景 1：__」或「INT. ___ — DAY」標題）
          </p>
        )}
      </div>

      {/* 情緒 */}
      {analysis.emotions.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-[11px] font-medium text-muted-foreground">
            情緒命中
          </Label>
          <div className="flex flex-wrap gap-1">
            {analysis.emotions.slice(0, 12).map(e => (
              <Badge
                key={e.name}
                variant="outline"
                className="text-[10px] h-5 px-1.5"
              >
                {e.name}
              </Badge>
            ))}
          </div>
        </div>
      )}


      {/* 這段腳本需要的素材 */}
      <div className="rounded border border-border/30 bg-card/20 px-2 py-2 space-y-1">
        <div className="text-[10px] font-medium">這段腳本需要的素材</div>
        <div className="text-[10px] text-muted-foreground">角色：{analysis.characters.map(c => c.name).join("、") || "（未偵測）"}</div>
        <div className="text-[10px] text-muted-foreground">場景：{analysis.scenes.map(s => s.name).join("、") || "（未偵測）"}</div>
        <div className="text-[10px] text-muted-foreground">音效提示：{assetNeeds.audioCues.join("、") || "（待補）"}</div>
        <div className="text-[10px] text-muted-foreground">配樂情緒：{assetNeeds.musicMoodCues.join("、") || "（待補）"}</div>
        <div className="text-[10px] text-muted-foreground">鏡頭提示：{assetNeeds.cameraCues.join("、") || "（待補）"}</div>
      </div>

      {/* 生成前風險提醒 */}
      <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-2 space-y-1">
        <div className="text-[10px] font-medium text-amber-700 dark:text-amber-300">生成前風險提醒</div>
        <ul className="text-[10px] text-muted-foreground list-disc ml-4">
          {analysis.characters.length > 0 && worldProgress.categories.characters.percent < 40 && <li>腳本有角色，但角色外觀資料偏少</li>}
          {analysis.scenes.length > 0 && worldProgress.categories.scenes.percent < 40 && <li>腳本有場景，但場景 environment / mood 仍不足</li>}
          {analysis.dialogues.length > 0 && worldProgress.categories.voice.percent === 0 && <li>腳本有 dialogue，但角色缺少配音方向</li>}
          {analysis.dialogues.length > 0 && worldProgress.categories.music.percent === 0 && <li>腳本含聲音節奏需求，但世界觀缺少配樂或音效庫</li>}
          {analysis.emotions.length > 0 && worldProgress.categories.style.percent === 0 && <li>腳本有視覺情緒描述，但沒有 styleProfiles</li>}
        </ul>
        <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={isUpdating} onClick={() => onDraftAssist(analysis)}>
          <Plus className="w-3 h-3 mr-1" /> 一鍵補草稿
        </Button>
      </div>

      {/* 智能缺漏提醒 */}
      {(unknownChars.length > 0 ||
        unknownScenes.length > 0 ||
        charsWithoutAppearance.length > 0) && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 space-y-1">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
              建議補設定
            </span>
          </div>
          <ul className="text-[10px] text-muted-foreground space-y-0.5 ml-4 list-disc">
            {unknownChars.length > 0 && (
              <li>
                腳本中出現「{unknownChars.slice(0, 3).map(c => c.name).join("、")}
                {unknownChars.length > 3 ? "…" : ""}」尚未在世界觀中建立
              </li>
            )}
            {unknownScenes.length > 0 && (
              <li>
                腳本中出現的場景「{unknownScenes.slice(0, 3).map(s => s.name).join("、")}
                {unknownScenes.length > 3 ? "…" : ""}」尚未建立
              </li>
            )}
            {charsWithoutAppearance.length > 0 && (
              <li>
                角色尚缺外觀設定，可能導致生成錯誤（請前往世界觀補齊）
              </li>
            )}
          </ul>
          {worldDataReady && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenWorld}
              className="h-6 text-[10px] gap-1 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
            >
              前往世界觀補設定
              <ChevronRight className="w-3 h-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 子組件：引導流程 ──────────────────────────────────────────────────────

type GuideStep = {
  key: string;
  label: string;
  done: boolean;
  action: string | null;
};

function GuidedFlow({
  steps,
  onAction,
}: {
  steps: GuideStep[];
  onAction: (action: string) => void;
}) {
  const doneCount = steps.filter(s => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5 text-primary" />
          引導流程
        </h3>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {doneCount}/{steps.length}（{pct}%）
        </span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="space-y-1 mt-1">
        {steps.map((step, idx) => (
          <li
            key={step.key}
            className="flex items-center gap-2 text-[11px]"
          >
            {step.done ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
            )}
            <span
              className={`flex-1 ${
                step.done ? "text-muted-foreground line-through" : "text-foreground"
              }`}
            >
              <span className="font-mono text-muted-foreground mr-1">
                {idx + 1}.
              </span>
              {step.label}
            </span>
            {step.action && !step.done && (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 text-[10px] gap-0.5"
                onClick={() => onAction(step.action!)}
              >
                前往
                <ChevronRight className="w-3 h-3" />
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
