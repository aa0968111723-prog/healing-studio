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
// U-5（AIDV-95）逐殼採用 · /video：旗標 ON 時筆記列改用 design-kit 亮色暖光 Card；
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）OFF（預設）＝既有版＝零變化。
// 純展示列（文字＋時間/鏡號 meta，無功能控制項）＝可 1:1 忠實對映、零資訊損失。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, Card as DkCard } from "@/components/design-kit";

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
          <NoteRow key={n.id} text={n.text} ts={n.ts} shotNo={n.shotNo} />
        ))
      )}
    </div>
  );
}

/** 單筆筆記列（純展示）。旗標 ON＝design-kit 亮色暖光 Card；OFF（預設）＝既有版＝零變化。 */
export function NoteRow({ text, ts, shotNo }: { text: string; ts: string; shotNo?: string }) {
  const meta = `${ts}${shotNo ? ` · ${shotNo}` : ""}`;
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkCard pad className="!p-2.5">
          <div className="text-xs text-[var(--text)]">{text}</div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">{meta}</div>
        </DkCard>
      </AidvKit>
    );
  }
  return (
    <div className="rounded-xl border p-2.5">
      <div className="text-xs">{text}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{meta}</div>
    </div>
  );
}

export default NotesPanel;
