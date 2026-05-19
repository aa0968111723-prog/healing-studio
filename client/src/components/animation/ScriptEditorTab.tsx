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
} from "lucide-react";
import { parseDurationToSeconds } from "../../../../shared/orb-script-structure";
import type { ScriptSegment } from "../../../../shared/types";

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

  const createStoryboard = trpc.worldStoryboard.create.useMutation({
    onSuccess: ({ id }) => {
      toast.success("分鏡草稿已建立");
      utils.worldStoryboard.listByWorld.invalidate();
      navigate(`/animation/${id}`);
    },
    onError: e => toast.error(`派生分鏡失敗：${e.message}`),
  });

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
