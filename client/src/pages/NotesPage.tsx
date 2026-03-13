import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, FileText, Clapperboard, Calendar, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Streamdown } from "streamdown";

const noteTypeInfo: Record<string, { label: string; icon: React.ReactNode }> = {
  note: { label: "筆記", icon: <FileText className="w-4 h-4" /> },
  script: { label: "腳本", icon: <Clapperboard className="w-4 h-4" /> },
  calendar_event: { label: "行事曆", icon: <Calendar className="w-4 h-4" /> },
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">專案筆記</h1>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="rounded-[25px] gap-1">
              <Plus className="w-4 h-4" />
              新增筆記
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-[25px]">
            <DialogHeader>
              <DialogTitle>新增筆記</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <Input
                placeholder="標題"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="rounded-[25px]"
              />
              <Textarea
                placeholder="內容..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="rounded-[20px]"
                rows={6}
              />
              <Button
                className="w-full rounded-[25px]"
                onClick={() => createNote.mutate({ title: newTitle, content: newContent })}
                disabled={!newTitle.trim() || createNote.isPending}
              >
                {createNote.isPending ? "建立中..." : "建立筆記"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {notesQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="healing-card bg-muted/30 h-20 animate-pulse rounded-[25px]" />
          ))}
        </div>
      ) : !notesQuery.data || notesQuery.data.length === 0 ? (
        <div className="healing-card bg-card p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">還沒有筆記，點擊上方按鈕建立，或使用導演 AI 自動生成腳本</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notesQuery.data.map((note) => {
            const info = noteTypeInfo[note.noteType] || noteTypeInfo.note;
            const isExpanded = expandedId === note.id;
            return (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="healing-card bg-card overflow-hidden"
              >
                <div
                  className="p-4 cursor-pointer flex items-center gap-3"
                  onClick={() => setExpandedId(isExpanded ? null : note.id)}
                >
                  <div className="w-8 h-8 rounded-[12px] bg-muted/50 flex items-center justify-center shrink-0">
                    {info.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{note.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-xs rounded-[10px]">
                        {info.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(note.createdAt).toLocaleDateString("zh-TW")}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNote.mutate({ id: note.id });
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    className="px-4 pb-4 border-t"
                  >
                    <div className="pt-3 prose prose-sm max-w-none text-foreground">
                      <Streamdown>{note.content || "（無內容）"}</Streamdown>
                    </div>
                    {note.scriptJson != null && (
                      <div className="mt-3 p-3 bg-muted/30 rounded-[15px] text-xs">
                        <p className="font-medium mb-1">CO-STAR 腳本</p>
                        <pre className="whitespace-pre-wrap text-muted-foreground">
                          {String(JSON.stringify(note.scriptJson, null, 2))}
                        </pre>
                      </div>
                    )}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
