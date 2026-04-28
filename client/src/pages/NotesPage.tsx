import { useState, useMemo, useCallback, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus,
  FileText,
  Clapperboard,
  Calendar,
  CalendarDays,
  Trash2,
  ChevronDown,
  ChevronRight,
  Tag,
  Clock,
  Download,
  Pencil,
  Check,
  X,
  Search,
  Filter,
  StickyNote,
  Wand2,
  History,
  Loader2,
} from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { motion, AnimatePresence } from "framer-motion";
import LazyStreamdown from "@/components/LazyStreamdown";
import { useAIState } from "@/contexts/AIStateContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { PlanningSubpageGuide } from "@/components/PlanningSubpageGuide";
import { useLocation } from "wouter";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";

const CalendarPage = lazy(() => import("./CalendarPage"));

// ─── Config ──────────────────────────────────────────────────────────────────

const noteTypeInfo: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  note: {
    label: "筆記",
    icon: <FileText className="w-4 h-4" />,
    color: "bg-zen-sage/20",
  },
  script: {
    label: "腳本",
    icon: <Clapperboard className="w-4 h-4" />,
    color: "bg-zen-lavender/20",
  },
  calendar_event: {
    label: "行事曆",
    icon: <Calendar className="w-4 h-4" />,
    color: "bg-zen-sky/20",
  },
};

const NOTE_TYPES = ["all", "note", "script", "calendar_event"] as const;
type NoteTypeFilter = (typeof NOTE_TYPES)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`已下載 ${filename}`);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotesPage() {
  const { personality } = useAIState();
  usePageTour("notes");
  const [, navigate] = useLocation();

  // 頁面分頁：專案筆記 | 創作排程
  const [pageTab, setPageTab] = useState<"notes" | "calendar">("notes");

  // ── Create dialog state ──
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<"note" | "script" | "calendar_event">(
    "note"
  );
  const [newTags, setNewTags] = useState("");

  // ── View state ──
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<NoteTypeFilter>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // ── Edit state ──
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");

  // ── Data ──
  const notesQuery = trpc.notes.list.useQuery(undefined, { retry: false });

  const createNote = trpc.notes.create.useMutation({
    onSuccess: () => {
      notesQuery.refetch();
      setShowCreate(false);
      setNewTitle("");
      setNewContent("");
      setNewTags("");
      setNewType("note");
      toast.success("筆記已建立");
    },
    onError: e => toast.error(e.message),
  });

  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => {
      notesQuery.refetch();
      toast.success("已刪除");
    },
  });

  const updateNote = trpc.notes.update.useMutation({
    onSuccess: () => {
      notesQuery.refetch();
      setEditingId(null);
      toast.success("筆記已更新");
    },
    onError: e => toast.error(e.message),
  });

  const createGenerationPlanningNote = useCallback(
    (phase: "pre" | "post") => {
      const today = new Date().toLocaleDateString("zh-TW");
      if (phase === "pre") {
        createNote.mutate({
          title: `生成前規劃 - ${today}`,
          content: [
            "## 目標與輸出",
            "- [ ] 目標成品（圖片/影片/音樂/語音）",
            "- [ ] 使用場景（廣告/社群/課程/提案）",
            "",
            "## 模型與素材",
            "- [ ] 已選模型與原因",
            "- [ ] 觸發詞 / LoRA / 參考素材",
            "",
            "## 生成參數起手式",
            "- [ ] Prompt 主軸",
            "- [ ] 風格、鏡頭、長度、情緒",
            "- [ ] 先跑最小可用版本（MVP）",
          ].join("\n"),
          noteType: "script",
          tags: ["生成前", "規劃", "MVP"],
        });
        return;
      }

      createNote.mutate({
        title: `生成後復盤 - ${today}`,
        content: [
          "## 輸出結果",
          "- [ ] 保留版本 / 捨棄版本",
          "- [ ] 成本、耗時、品質評分",
          "",
          "## 成功訊號",
          "- [ ] 最有效提示詞/參數",
          "- [ ] 可複用模板片段",
          "",
          "## 下一輪優化",
          "- [ ] 只改 1 個關鍵參數再重跑",
          "- [ ] 更新到提示詞庫 / 歷史註記",
        ].join("\n"),
        noteType: "note",
        tags: ["生成後", "復盤", "優化"],
      });
    },
    [createNote]
  );

  // ── Computed / filtered ──
  const allNotes = notesQuery.data || [];

  const filtered = useMemo(() => {
    let result = allNotes;
    if (typeFilter !== "all") {
      result = result.filter(n => n.noteType === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        n =>
          n.title.toLowerCase().includes(q) ||
          (n.content || "").toLowerCase().includes(q) ||
          ((n.tags as string[] | null) || []).some(t =>
            t.toLowerCase().includes(q)
          )
      );
    }
    return result;
  }, [allNotes, typeFilter, search]);

  const countByType = useMemo(() => {
    const counts: Record<string, number> = { all: allNotes.length };
    for (const n of allNotes) {
      counts[n.noteType] = (counts[n.noteType] || 0) + 1;
    }
    return counts;
  }, [allNotes]);

  // ─── PageAgent 註冊（Phase 4a：筆記頁接入光球） ────────────────────────
  // 光球可幫使用者：切 type 篩選、下搜尋字串、清空條件。
  const NOTE_TYPE_OPTIONS = useMemo<AgentCapability["options"]>(
    () => [
      { id: "all", label: "全部", meta: { bestFor: "全局盤點", tip: "先看未整理筆記再分群" } },
      { id: "note", label: "筆記", meta: { bestFor: "靈感沉澱", tip: "補齊標籤與摘要更好檢索" } },
      { id: "script", label: "腳本", meta: { bestFor: "敘事規劃", tip: "可連動導演 AI 分鏡流程" } },
      { id: "calendar_event", label: "行事曆", meta: { bestFor: "排程轉換", tip: "把待辦轉成具體時程" } },
    ],
    []
  );
  const agentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "類型篩選",
        currentId: typeFilter,
        options: NOTE_TYPE_OPTIONS,
        hint: "切換只顯示某個 noteType（note/script/calendar_event）或全部",
      },
      {
        action: "search",
        label: "搜尋筆記",
        hint: "搜尋筆記標題、內容或標籤；建議格式：主題 + 任務狀態 + 角色/場景",
      },
      {
        action: "reset",
        label: "清空條件",
        hint: "typeFilter 還原成 all、清掉搜尋字串",
      },
    ],
    [typeFilter, NOTE_TYPE_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "notes",
    pageLabel: "專案筆記",
    pagePath: "/notes",
    capabilities: agentCapabilities,
    state: {
      typeFilter,
      search,
      visibleCount: filtered.length,
      totalCount: allNotes.length,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          const allowed = NOTE_TYPE_OPTIONS?.map(o => o.id) ?? [];
          if (!allowed.includes(action.tabId)) {
            return { ok: false, reason: `unknown note type: ${action.tabId}` };
          }
          setTypeFilter(action.tabId as NoteTypeFilter);
          return { ok: true, message: `切到「${action.tabId}」` };
        }
        case "search": {
          setSearch(action.query);
          return { ok: true, message: "已套用搜尋" };
        }
        case "reset": {
          setTypeFilter("all");
          setSearch("");
          return { ok: true, message: "已清空條件" };
        }
        default:
          return { ok: false, reason: `unsupported on notes: ${action.type}` };
      }
    },
  });

  // ── Handlers ──
  const startEditing = (note: {
    id: number;
    title: string;
    content?: string | null;
    tags?: string[] | null;
  }) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content || "");
    setEditTags(((note.tags as string[] | null) || []).join(", "));
    setExpandedId(note.id);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
    setEditTags("");
  };

  const saveEditing = () => {
    if (!editTitle.trim() || editingId === null) return;
    const tags = editTags.trim()
      ? editTags
          .split(",")
          .map(t => t.trim())
          .filter(Boolean)
      : [];
    updateNote.mutate({
      id: editingId,
      title: editTitle.trim(),
      content: editContent.trim() || undefined,
      tags: tags.length ? tags : undefined,
    });
  };

  const handleCreate = () => {
    if (!newTitle.trim()) {
      toast.error("請輸入標題");
      return;
    }
    const tags = newTags.trim()
      ? newTags
          .split(",")
          .map(t => t.trim())
          .filter(Boolean)
      : undefined;
    createNote.mutate({
      title: newTitle,
      content: newContent || undefined,
      noteType: newType,
      tags,
    });
  };

  return (
    <div className="space-y-6">
      {/* 頁面切換標籤 */}
      <div className="flex items-center gap-1 border-b border-border/50 pb-0">
        <button
          type="button"
          onClick={() => setPageTab("notes")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
            pageTab === "notes"
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <StickyNote className="w-4 h-4" />
          專案筆記
        </button>
        <button
          type="button"
          onClick={() => setPageTab("calendar")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
            pageTab === "calendar"
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          創作排程
        </button>
      </div>

      {pageTab === "calendar" ? (
        <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
          <CalendarPage />
        </Suspense>
      ) : (
        <>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StickyNote className="w-5 h-5 text-muted-foreground" />
          <h1 className="hs-h2 !mb-0">專案筆記</h1>
          <Badge variant="secondary" className="rounded-lg text-xs">
            {allNotes.length} 篇
          </Badge>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="rounded-xl gap-1.5 text-sm">
              <Plus className="w-4 h-4" /> 新增筆記
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="w-4 h-4" /> 新增筆記
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {/* Title */}
              <Input
                placeholder="標題 *"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                className="rounded-xl"
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
              {/* Type selector */}
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground font-medium">
                  類型
                </span>
                <div className="flex gap-2">
                  {(["note", "script", "calendar_event"] as const).map(t => {
                    const info = noteTypeInfo[t];
                    return (
                      <button
                        key={t}
                        onClick={() => setNewType(t)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                          newType === t
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/30 bg-muted/20 text-muted-foreground hover:bg-muted/40"
                        }`}
                      >
                        {info.icon}
                        {info.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Content */}
              <Textarea
                placeholder="內容（選填，支援 Markdown）"
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                className="rounded-xl"
                rows={5}
              />
              {/* Tags */}
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Tag className="w-3 h-3" /> 標籤（逗號分隔）
                </span>
                <Input
                  placeholder="例如：靈感, 腳本A, Q2"
                  value={newTags}
                  onChange={e => setNewTags(e.target.value)}
                  className="rounded-xl text-sm"
                />
              </div>
              <Button
                className="w-full rounded-xl"
                onClick={handleCreate}
                disabled={!newTitle.trim() || createNote.isPending}
              >
                {createNote.isPending ? "建立中..." : "建立筆記"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <p className="hs-small !mb-0 text-muted-foreground">
        記錄創作靈感與導演 AI 生成的 CO-STAR 腳本。支援標籤分類與全文搜尋。
      </p>
      <PlanningSubpageGuide page="notes" />
      <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2">
        <p className="text-xs font-medium text-foreground/80">
          生成式 AI 前後規劃
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => createGenerationPlanningNote("pre")}
          >
            <Wand2 className="w-3.5 h-3.5" />
            建立生成前規劃
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => createGenerationPlanningNote("post")}
          >
            <History className="w-3.5 h-3.5" />
            建立生成後復盤
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => navigate("/studio")}
          >
            前往生成
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => navigate("/history")}
          >
            查看歷史
          </Button>
        </div>
      </div>

      {/* ── Search + Type Filter ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋標題、內容、標籤..."
            className="pl-8 h-8 text-xs rounded-lg"
          />
          {search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setSearch("")}
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
        {/* Type filter pills */}
        <div className="flex gap-1 flex-wrap">
          {NOTE_TYPES.map(t => {
            const count = countByType[t] ?? 0;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1 ${
                  typeFilter === t
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {t === "all" ? (
                  <Filter className="w-3 h-3" />
                ) : (
                  noteTypeInfo[t]?.icon
                )}
                {t === "all"
                  ? `全部 (${count})`
                  : `${noteTypeInfo[t]?.label} (${count})`}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Notes List ── */}
      {notesQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <GlassCard key={i} hover={false}>
              <ZenSkeleton lines={3} />
            </GlassCard>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((note, idx) => {
              const info = noteTypeInfo[note.noteType] || noteTypeInfo.note;
              const isExpanded = expandedId === note.id;
              const isEditing = editingId === note.id;
              const tags = (note.tags as string[] | null) || [];

              return (
                <motion.div
                  key={note.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ delay: idx * 0.03 }}
                >
                  <GlassCard className="overflow-hidden">
                    {/* ── Row header ── */}
                    <div
                      className="flex items-center gap-3 cursor-pointer"
                      onClick={() =>
                        !isEditing && setExpandedId(isExpanded ? null : note.id)
                      }
                    >
                      <div
                        className={`w-9 h-9 rounded-lg ${info.color} flex items-center justify-center shrink-0`}
                      >
                        {info.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <Input
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            className="h-7 text-sm rounded-lg"
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => {
                              if (e.key === "Enter") saveEditing();
                              if (e.key === "Escape") cancelEditing();
                            }}
                            autoFocus
                          />
                        ) : (
                          <>
                            <p className="hs-h3 !mb-0 truncate">{note.title}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">
                                {info.label}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {new Date(note.createdAt).toLocaleDateString(
                                  "zh-TW"
                                )}
                              </span>
                              {tags.slice(0, 3).map(tag => (
                                <span
                                  key={tag}
                                  className="text-[10px] px-1.5 py-0.5 rounded-md bg-zen-lavender/15 text-zen-lavender font-medium flex items-center gap-0.5"
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {tag}
                                </span>
                              ))}
                              {tags.length > 3 && (
                                <span className="text-[10px] text-muted-foreground">
                                  +{tags.length - 3}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        {isEditing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-lg text-green-600"
                              onClick={e => {
                                e.stopPropagation();
                                saveEditing();
                              }}
                              disabled={updateNote.isPending}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-lg"
                              onClick={e => {
                                e.stopPropagation();
                                cancelEditing();
                              }}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-lg text-muted-foreground"
                              onClick={e => {
                                e.stopPropagation();
                                startEditing(note);
                              }}
                              title="編輯"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-lg text-destructive"
                              onClick={e => {
                                e.stopPropagation();
                                deleteNote.mutate({ id: note.id });
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* ── Expanded content ── */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="pt-3 mt-3 border-t border-border/30 space-y-3">
                            {isEditing ? (
                              <>
                                <Textarea
                                  value={editContent}
                                  onChange={e => setEditContent(e.target.value)}
                                  rows={6}
                                  placeholder="內容..."
                                  className="rounded-xl text-sm"
                                  onClick={e => e.stopPropagation()}
                                />
                                <div className="space-y-1">
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Tag className="w-3 h-3" /> 標籤（逗號分隔）
                                  </span>
                                  <Input
                                    value={editTags}
                                    onChange={e => setEditTags(e.target.value)}
                                    placeholder="標籤1, 標籤2..."
                                    className="h-8 text-xs rounded-lg"
                                    onClick={e => e.stopPropagation()}
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="flex-1 text-xs rounded-lg"
                                    onClick={e => {
                                      e.stopPropagation();
                                      saveEditing();
                                    }}
                                    disabled={
                                      !editTitle.trim() || updateNote.isPending
                                    }
                                  >
                                    {updateNote.isPending
                                      ? "儲存中..."
                                      : "儲存變更"}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs rounded-lg"
                                    onClick={e => {
                                      e.stopPropagation();
                                      cancelEditing();
                                    }}
                                  >
                                    取消
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <>
                                {/* Markdown content */}
                                <div className="prose prose-sm max-w-none text-foreground">
                                  <LazyStreamdown>
                                    {note.content || "（無內容）"}
                                  </LazyStreamdown>
                                </div>

                                {/* CO-STAR JSON */}
                                {note.scriptJson != null && (
                                  <div className="p-3 bg-muted/20 rounded-lg text-xs">
                                    <p className="hs-small !mb-0 text-muted-foreground">
                                      CO-STAR 腳本
                                    </p>
                                    <pre className="whitespace-pre-wrap text-muted-foreground font-mono text-[11px] leading-relaxed">
                                      {JSON.stringify(note.scriptJson, null, 2)}
                                    </pre>
                                  </div>
                                )}

                                {/* Tags full */}
                                {tags.length > 0 && (
                                  <div>
                                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-1.5">
                                      <Tag className="w-3 h-3" /> 標籤
                                    </span>
                                    <div className="flex flex-wrap gap-1.5">
                                      {tags.map(tag => (
                                        <span
                                          key={tag}
                                          className="text-[10px] px-2 py-0.5 rounded-full bg-zen-lavender/15 text-zen-lavender font-medium"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Scheduled date */}
                                {note.scheduledDate && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                    <Calendar className="w-3 h-3" />
                                    <span className="font-medium text-foreground">
                                      排程日期：
                                    </span>
                                    <span>
                                      {new Date(
                                        note.scheduledDate
                                      ).toLocaleString("zh-TW")}
                                    </span>
                                  </div>
                                )}

                                {/* Timestamps */}
                                <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    建立：
                                    {new Date(note.createdAt).toLocaleString(
                                      "zh-TW"
                                    )}
                                  </span>
                                  {note.updatedAt && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      更新：
                                      {new Date(note.updatedAt).toLocaleString(
                                        "zh-TW"
                                      )}
                                    </span>
                                  )}
                                </div>

                                {/* Action row */}
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1 rounded-lg"
                                    onClick={e => {
                                      e.stopPropagation();
                                      startEditing(note);
                                    }}
                                  >
                                    <Pencil className="w-3 h-3" /> 編輯
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1 rounded-lg"
                                    onClick={e => {
                                      e.stopPropagation();
                                      let content = `# ${note.title}\n\n`;
                                      content += `類型：${info.label}\n`;
                                      content += `建立時間：${new Date(note.createdAt).toLocaleString("zh-TW")}\n`;
                                      if (note.scheduledDate)
                                        content += `排程日期：${new Date(note.scheduledDate).toLocaleString("zh-TW")}\n`;
                                      if (tags.length > 0)
                                        content += `標籤：${tags.join(", ")}\n`;
                                      content += `\n---\n\n${note.content || ""}`;
                                      if (note.scriptJson)
                                        content += `\n\n---\n\nCO-STAR 腳本：\n${JSON.stringify(note.scriptJson, null, 2)}`;
                                      downloadTextFile(
                                        content,
                                        `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.md`
                                      );
                                    }}
                                  >
                                    <Download className="w-3 h-3" /> 下載
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </GlassCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <VisualSoul size="lg" personality={personality} />
          <h3 className="hs-h3 !mb-0 mt-6">
            {search || typeFilter !== "all" ? "沒有符合條件的筆記" : "尚無筆記"}
          </h3>
          <p className="hs-small !mb-0 text-muted-foreground mt-2 max-w-sm">
            {search || typeFilter !== "all"
              ? "請試試其他搜尋條件"
              : "點擊「新增筆記」開始記錄，或使用導演 AI 自動生成腳本"}
          </p>
        </div>
      )}
        </>
      )}
    </div>
  );
}
