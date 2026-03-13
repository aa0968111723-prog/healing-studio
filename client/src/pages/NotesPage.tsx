import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, FileText, Clapperboard, Calendar, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { GlassCard, ZenSkeleton, ZenOrb } from "@/components/ZenCoPilot";
import { motion, AnimatePresence } from "framer-motion";
import { Streamdown } from "streamdown";

const noteTypeInfo: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  note: { label: "筆記", icon: <FileText className="w-4 h-4" />, color: "bg-zen-sage/20" },
  script: { label: "腳本", icon: <Clapperboard className="w-4 h-4" />, color: "bg-zen-lavender/20" },
  calendar_event: { label: "行事曆", icon: <Calendar className="w-4 h-4" />, color: "bg-zen-sky/20" },
};

export default function NotesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-zen-smoke" />
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
            return (
              <GlassCard key={note.id} className="overflow-hidden">
                <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : note.id)}>
                  <div className={`w-9 h-9 rounded-lg ${info.color} flex items-center justify-center shrink-0`}>
                    {info.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{note.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">{info.label}</span>
                      <span className="text-[11px] text-muted-foreground">{new Date(note.createdAt).toLocaleDateString("zh-TW")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg text-destructive" onClick={(e) => { e.stopPropagation(); deleteNote.mutate({ id: note.id }); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                      <div className="pt-3 mt-3 border-t border-border/30">
                        <div className="prose prose-sm max-w-none text-foreground">
                          <Streamdown>{note.content || "（無內容）"}</Streamdown>
                        </div>
                        {note.scriptJson != null && (
                          <div className="mt-3 p-3 bg-muted/20 rounded-lg text-xs">
                            <p className="font-medium mb-2 text-muted-foreground">CO-STAR 腳本</p>
                            <pre className="whitespace-pre-wrap text-muted-foreground font-mono text-[11px] leading-relaxed">
                              {String(JSON.stringify(note.scriptJson, null, 2))}
                            </pre>
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
          <ZenOrb size="lg" />
          <h3 className="text-base font-medium mt-6">尚無筆記</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">點擊「新增筆記」開始記錄，或使用導演 AI 自動生成腳本</p>
        </div>
      )}
    </div>
  );
}
