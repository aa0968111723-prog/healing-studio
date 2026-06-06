// ============================================================================
// shells/video/panels/NotesPanel.tsx — 專案筆記（綁專案，對映 project_notes_calendar）
// ----------------------------------------------------------------------------
// 新增筆記 → useProjectSpine().addNote（樂觀本地 + notes.create 回寫）。
// ============================================================================
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";

export function NotesPanel() {
  const spine = useProjectSpine();
  const p = spine.project!;
  const [note, setNote] = useState("");

  const submit = () => {
    const t = note.trim();
    if (!t) return;
    void spine.addNote(t);
    setNote("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="新增筆記（綁專案）"
          className="h-8 text-xs"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <Button size="icon" className="size-8 shrink-0" onClick={submit} aria-label="新增筆記">
          <Plus className="size-4" />
        </Button>
      </div>
      {p.notes.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">尚無筆記</div>
      ) : (
        p.notes.map((n) => (
          <div key={n.id} className="rounded-xl border p-2.5">
            <div className="text-xs">{n.text}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">{n.ts}{n.shotNo ? ` · ${n.shotNo}` : ""}</div>
          </div>
        ))
      )}
    </div>
  );
}

export default NotesPanel;
