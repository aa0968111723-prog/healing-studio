import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, FileText, Clapperboard, Calendar, Trash2, ChevronDown, ChevronRight, Tag, Clock, Download, Pencil, Check, X } from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { motion, AnimatePresence } from "framer-motion";
import { Streamdown } from "streamdown";
import { useAIState } from "@/contexts/AIStateContext";

const noteTypeInfo: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  note: { label: "筆記", icon: <FileText className="w-4 h-4" />, color: "bg-zen-sage/20" },
  script: { label: "腳本", icon: <Clapperboard className="w-4 h-4" />, color: "bg-zen-lavender/20" },
  calendar_event: { label: "行事曆", icon: <Calendar className="w-4 h-4" />, color: "bg-zen-sky/20" },
};

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

export default function NotesPage() {
  const { personality } = useAIState();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  const notesQuery = trpc.notes.list.useQuery(undefined, { retry: false });

  const createNote = trpc.notes.create.useMutation({
    onSuccess: () => {
      notesQuery.refetch();
      setShowCreate(false);
      setNewTitle("");
      setNewContent("");
      toast.success("筆記已建立");
    },
    onError: (e) => toast.error(e.message),
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
    onError: (e) => toast.error(e.message),
  });

  const startEditing = (note: { id: number; title: string; content?: string | null }) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content || "");
    // Expand the note if not already expanded
    setExpandedId(note.id);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
  };

  const saveEditing = () => {
    if (!editTitle.trim() || editingId === null) return;
    updateNote.mutate({ id: editingId, title: editTitle.trim(), content: editContent.trim() || undefined });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">專案筆記</h1>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="rounded-xl gap-1.5 text-sm">
              <Plus className="w-4 h-4" />
              新增筆記
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新增筆記</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <Input placeholder="標題" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="rounded-xl" />
              <Textarea placeholder="內容..." value={newContent} onChange={(e) => setNewContent(e.target.value)} className="rounded-xl" rows={6} />
              <Button className="w-full rounded-xl" onClick={() => createNote.mutate({ title: newTitle, content: newContent })} disabled={!newTitle.trim() || createNote.isPending}>
                {createNote.isPending ? "建立中..." : "建立筆記"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-xs text-muted-foreground">記錄創作靈感與導演 AI 生成的 CO-STAR 腳本。</p>

      {notesQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={3} /></GlassCard>))}
        </div>
      ) : notesQuery.data && notesQuery.data.length > 0 ? (
        <div className="space-y-3">
          {notesQuery.data.map((note) => {
            const info = noteTypeInfo[note.noteType] || noteTypeInfo.note;
            const isExpanded = expandedId === note.id;
            const isEditing = editingId === note.id;
            const tags = (note.tags as string[] | null) || [];
            return (
              <GlassCard key={note.id} className="overflow-hidden">
                <div
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => !isEditing && setExpandedId(isExpanded ? null : note.id)}
                >
                  <div className={`w-9 h-9 rounded-lg ${info.color} flex items-center justify-center shrink-0`}>
                    {info.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="h-7 text-sm rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEditing(); if (e.key === "Escape") cancelEditing(); }}
                        autoFocus
                      />
                    ) : (
                      <>
                        <p className="text-sm font-medium truncate">{note.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">{info.label}</span>
                          <span className="text-[11px] text-muted-foreground">{new Date(note.createdAt).toLocaleDateString("zh-TW")}</span>
                          {/* Tags inline preview */}
                          {tags.length > 0 && tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-zen-lavender/15 text-zen-lavender font-medium flex items-center gap-0.5">
                              <Tag className="w-2.5 h-2.5" />{tag}
                            </span>
                          ))}
                          {tags.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isEditing ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 rounded-lg text-green-600 hover:text-green-500"
                          onClick={(e) => { e.stopPropagation(); saveEditing(); }}
                          disabled={updateNote.isPending}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 rounded-lg"
                          onClick={(e) => { e.stopPropagation(); cancelEditing(); }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); startEditing(note); }}
                          title="編輯筆記"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg text-destructive" onClick={(e) => { e.stopPropagation(); deleteNote.mutate({ id: note.id }); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </>
                    )}
                  </div>
                </div>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                      <div className="pt-3 mt-3 border-t border-border/30 space-y-3">
                        {/* Content — editable or display */}
                        {isEditing ? (
                          <Textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={6}
                            placeholder="內容..."
                            className="rounded-xl text-sm"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <div className="prose prose-sm max-w-none text-foreground">
                            <Streamdown>{note.content || "（無內容）"}</Streamdown>
                          </div>
                        )}

                        {/* CO-STAR Script JSON */}
                        {!isEditing && note.scriptJson != null && (
                          <div className="p-3 bg-muted/20 rounded-lg text-xs">
                            <p className="font-medium mb-2 text-muted-foreground">CO-STAR 腳本</p>
                            <pre className="whitespace-pre-wrap text-muted-foreground font-mono text-[11px] leading-relaxed">
                              {String(JSON.stringify(note.scriptJson, null, 2))}
                            </pre>
                          </div>
                        )}

                        {/* Tags (full display) */}
                        {!isEditing && tags.length > 0 && (
                          <div>
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-1">
                              <Tag className="w-3 h-3" /> 標籤
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {tags.map((tag) => (
                                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-zen-lavender/15 text-zen-lavender font-medium">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Scheduled Date */}
                        {!isEditing && note.scheduledDate && (
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            <span className="font-medium text-foreground">排程日期：</span>
                            <span>{new Date(note.scheduledDate).toLocaleString("zh-TW")}</span>
                          </div>
                        )}

                        {/* Timestamps */}
                        {!isEditing && (
                          <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              建立：{new Date(note.createdAt).toLocaleString("zh-TW")}
                            </span>
                            {note.updatedAt && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                更新：{new Date(note.updatedAt).toLocaleString("zh-TW")}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Action buttons row */}
                        {!isEditing && (
                          <div className="flex gap-2">
                            {/* Edit button (inline) */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1 rounded-lg"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditing(note);
                              }}
                            >
                              <Pencil className="w-3 h-3" />
                              編輯
                            </Button>

                            {/* Download as text file */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1 rounded-lg"
                              onClick={(e) => {
                                e.stopPropagation();
                                let content = `# ${note.title}\n\n`;
                                content += `類型：${info.label}\n`;
                                content += `建立時間：${new Date(note.createdAt).toLocaleString("zh-TW")}\n`;
                                if (note.scheduledDate) content += `排程日期：${new Date(note.scheduledDate).toLocaleString("zh-TW")}\n`;
                                if (tags.length > 0) content += `標籤：${tags.join(", ")}\n`;
                                content += `\n---\n\n${note.content || ""}`;
                                if (note.scriptJson) content += `\n\n---\n\nCO-STAR 腳本：\n${JSON.stringify(note.scriptJson, null, 2)}`;
                                downloadTextFile(content, `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.md`);
                              }}
                            >
                              <Download className="w-3 h-3" />
                              下載
                            </Button>
                          </div>
                        )}

                        {/* Save / Cancel when editing */}
                        {isEditing && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 text-xs rounded-lg"
                              onClick={(e) => { e.stopPropagation(); saveEditing(); }}
                              disabled={!editTitle.trim() || updateNote.isPending}
                            >
                              {updateNote.isPending ? "儲存中..." : "儲存變更"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs rounded-lg"
                              onClick={(e) => { e.stopPropagation(); cancelEditing(); }}
                            >
                              取消
                            </Button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <VisualSoul size="lg" personality={personality} />
          <h3 className="text-base font-medium mt-6">尚無筆記</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">點擊「新增筆記」開始記錄，或使用導演 AI 自動生成腳本</p>
        </div>
      )}
    </div>
  );
}
