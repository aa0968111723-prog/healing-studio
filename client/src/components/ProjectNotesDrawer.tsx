import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/useMobile";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  StickyNote,
  X,
  Plus,
  Trash2,
  Image as ImageIcon,
  Sparkles,
  Clock,
  Tag,
  Save,
  ExternalLink,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  useNotesDrawer,
  type NotePayload,
} from "@/contexts/NotesDrawerContext";
import { cn } from "@/lib/utils";

// ─── Note Card ──────────────────────────────────────────────────────────────

function NoteCard({
  note,
  onToggleStatus,
  onDelete,
}: {
  note: {
    id: number;
    title: string;
    content?: string | null;
    noteType: string;
    status?: "todo" | "in_progress" | "done" | null;
    tags?: string[] | null;
    scheduledDate?: Date | string | null;
    createdAt: Date | string;
  };
  onToggleStatus: (
    id: number,
    next: "todo" | "in_progress" | "done"
  ) => void;
  onDelete: (id: number) => void;
}) {
  const isMobile = useIsMobile();
  const typeColor =
    note.noteType === "script"
      ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
      : note.noteType === "calendar_event"
        ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
        : "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
  const status = (note.status ?? "todo") as "todo" | "in_progress" | "done";
  const isDone = status === "done";
  const cycleStatus = () => {
    const next =
      status === "todo"
        ? ("in_progress" as const)
        : status === "in_progress"
          ? ("done" as const)
          : ("todo" as const);
    onToggleStatus(note.id, next);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 50 }}
      className={cn(
        "group relative rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-3 hover:bg-white/8 transition-all",
        isDone && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={cycleStatus}
              title={`狀態：${status === "todo" ? "待辦" : status === "in_progress" ? "進行中" : "已完成"}（點擊推進）`}
              className={cn(
                "shrink-0 w-5 h-5 rounded-full border flex items-center justify-center hover:scale-110 transition-transform",
                status === "done"
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                  : status === "in_progress"
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-400"
                    : "border-white/30 text-white/60"
              )}
            >
              {status === "done" ? "✓" : status === "in_progress" ? "·" : ""}
            </button>
            <Badge
              variant="outline"
              className={cn("text-[10px] px-1.5 py-0", typeColor)}
            >
              {note.noteType === "script"
                ? "腳本"
                : note.noteType === "calendar_event"
                  ? "排程"
                  : "筆記"}
            </Badge>
            <h4
              className={cn(
                "text-sm font-medium text-foreground/90 truncate",
                isDone && "line-through text-muted-foreground"
              )}
            >
              {note.title}
            </h4>
          </div>
          {note.content && (
            <p className="text-xs text-muted-foreground/70 line-clamp-2 mt-1">
              {note.content}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {note.tags?.map(tag => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-muted-foreground/60"
              >
                <Tag className="w-2.5 h-2.5 inline mr-0.5" />
                {tag}
              </span>
            ))}
            <span className="text-[10px] text-muted-foreground/40 ml-auto">
              <Clock className="w-2.5 h-2.5 inline mr-0.5" />
              {new Date(note.createdAt).toLocaleDateString("zh-TW")}
            </span>
          </div>
        </div>
        <button
          onClick={() => onDelete(note.id)}
          className={`transition-opacity p-1 rounded hover:bg-red-500/20 text-muted-foreground/40 hover:text-red-400 ${isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Quick Save Form ────────────────────────────────────────────────────────

function QuickSaveForm({
  payload,
  onSaved,
}: {
  payload: NotePayload;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(payload.title || "");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>(payload.tags || []);
  const [tagInput, setTagInput] = useState("");

  const utils = trpc.useUtils();
  const createNote = trpc.notes.create.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate();
      onSaved();
    },
  });

  useEffect(() => {
    // Auto-compose content from payload
    const parts: string[] = [];
    if (payload.prompt) parts.push(`**提示詞：** ${payload.prompt}`);
    if (payload.seed) parts.push(`**Seed：** ${payload.seed}`);
    if (payload.mode) parts.push(`**模式：** ${payload.mode}`);
    if (payload.resultUrl) parts.push(`**生成結果：** ${payload.resultUrl}`);
    if (payload.content) parts.push(payload.content);
    setContent(parts.join("\n\n"));

    if (payload.tags) setTags(payload.tags);
    if (payload.title) setTitle(payload.title);
  }, [payload]);

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 backdrop-blur-sm p-4 space-y-3"
    >
      <div className="flex items-center gap-2 text-cyan-400 text-sm font-medium">
        <Sparkles className="w-4 h-4" />
        <span>快速釘選至筆記</span>
        {payload.sourceType && (
          <Badge
            variant="outline"
            className="text-[10px] ml-auto border-cyan-500/30 text-cyan-400/70"
          >
            來自{" "}
            {payload.sourceType === "studio"
              ? "工作室"
              : payload.sourceType === "thought-chain"
                ? "思維鏈"
                : payload.sourceType === "orb"
                  ? "光球"
                  : "手動"}
          </Badge>
        )}
      </div>

      {payload.resultUrl && (
        <div className="rounded-lg overflow-hidden border border-white/10 bg-black/20">
          <img
            src={payload.resultUrl}
            alt="preview"
            className="w-full h-24 object-cover"
            loading="lazy"
          />
        </div>
      )}

      <Input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="筆記標題"
        className="bg-white/5 border-white/10 text-sm"
      />

      <Textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="筆記內容..."
        rows={4}
        className="bg-white/5 border-white/10 text-xs resize-none"
      />

      <div className="flex items-center gap-2">
        <Input
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())}
          placeholder="新增標籤..."
          className="bg-white/5 border-white/10 text-xs flex-1"
        />
        <Button size="sm" variant="ghost" onClick={addTag} className="text-xs">
          <Plus className="w-3 h-3" />
        </Button>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(tag => (
            <Badge
              key={tag}
              variant="secondary"
              className="text-[10px] gap-1 cursor-pointer"
              onClick={() => setTags(tags.filter(t => t !== tag))}
            >
              {tag} <X className="w-2.5 h-2.5" />
            </Badge>
          ))}
        </div>
      )}

      <Button
        size="sm"
        onClick={() => {
          createNote.mutate({
            title: title || "未命名筆記",
            content,
            noteType: "note",
          });
        }}
        disabled={createNote.isPending}
        className="w-full bg-cyan-600 hover:bg-cyan-500 text-white"
      >
        <Save className="w-3.5 h-3.5 mr-1.5" />
        {createNote.isPending ? "儲存中..." : "釘選到筆記"}
      </Button>
    </motion.div>
  );
}

// ─── Main Drawer ────────────────────────────────────────────────────────────

export default function ProjectNotesDrawer() {
  const [, navigate] = useLocation();
  const { isOpen, closeDrawer, pendingPayload } = useNotesDrawer();
  const [showForm, setShowForm] = useState(false);

  const notesQuery = trpc.notes.list.useQuery(undefined, { enabled: isOpen });
  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => notesQuery.refetch(),
  });
  const updateNote = trpc.notes.update.useMutation({
    onSuccess: () => notesQuery.refetch(),
  });

  useEffect(() => {
    if (pendingPayload) setShowForm(true);
  }, [pendingPayload]);

  return (
    <Sheet
      open={isOpen}
      onOpenChange={open => {
        if (!open) closeDrawer();
      }}
    >
      <SheetContent
        side="right"
        className="w-[380px] sm:w-[420px] bg-background/80 backdrop-blur-2xl border-l border-white/10 p-0 overflow-hidden"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <StickyNote className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <SheetTitle className="text-base">專案筆記</SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground/60">
                    釘選靈感、提示詞與生成結果
                  </SheetDescription>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowForm(!showForm)}
                className="text-xs gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                新增
              </Button>
            </div>
          </SheetHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <AnimatePresence mode="popLayout">
              {/* Quick save form */}
              {showForm && pendingPayload && (
                <QuickSaveForm
                  key="quick-save"
                  payload={pendingPayload}
                  onSaved={() => setShowForm(false)}
                />
              )}

              {/* Manual new note form */}
              {showForm && !pendingPayload && (
                <QuickSaveForm
                  key="manual-save"
                  payload={{ title: "", sourceType: "manual" }}
                  onSaved={() => setShowForm(false)}
                />
              )}
            </AnimatePresence>

            {/* Notes list */}
            {notesQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div
                    key={i}
                    className="h-20 rounded-xl bg-white/5 animate-pulse"
                  />
                ))}
              </div>
            ) : notesQuery.data?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40">
                <StickyNote className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">還沒有筆記</p>
                <p className="text-xs mt-1">
                  從工作室釘選靈感，或拖曳元素到光球
                </p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {notesQuery.data?.map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onToggleStatus={(id, status) =>
                      updateNote.mutate({ id, status })
                    }
                    onDelete={id => deleteNote.mutate({ id })}
                  />
                ))}
              </AnimatePresence>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-white/10 bg-white/3">
            <div className="flex items-center justify-between text-xs text-muted-foreground/40">
              <span>{notesQuery.data?.length ?? 0} 則筆記</span>
              <button
                onClick={() => navigate("/notes")}
                className="flex items-center gap-1 hover:text-foreground/70 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                完整筆記頁
              </button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
