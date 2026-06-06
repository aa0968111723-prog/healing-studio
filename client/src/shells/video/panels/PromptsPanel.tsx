// ============================================================================
// shells/video/panels/PromptsPanel.tsx — 提示詞庫（對映 prompt_library / block_combos / custom_blocks）
// ----------------------------------------------------------------------------
// 新增提示詞積木 → useProjectSpine().addPromptBlock（樂觀本地 + promptLibrary.create 回寫）。
// ============================================================================
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";

export function PromptsPanel() {
  const spine = useProjectSpine();
  const p = spine.project!;
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");

  const submit = () => {
    if (!label.trim()) return;
    void spine.addPromptBlock(label.trim(), text.trim());
    setLabel("");
    setText("");
  };

  return (
    <div className="space-y-2">
      <div className="rounded-xl border bg-card/60 p-2.5">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          新增提示詞積木 → 寫入 prompt_library
        </div>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="標籤（如：雪山·晨光）" className="mb-2 h-8 text-xs" />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="prompt 內容" className="mb-2 min-h-[56px] text-xs" />
        <Button size="sm" className="w-full" onClick={submit} disabled={!label.trim()}>
          <Plus className="size-4" /> 存入提示詞庫
        </Button>
      </div>

      {p.promptBlocks.map((pb) => (
        <div key={pb.id} className="flex items-center gap-2 rounded-xl border p-2.5">
          <span className="text-base leading-none">{pb.kind === "combo" ? "🧩" : "✎"}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{pb.label}</div>
            <div className="truncate text-[10px] text-muted-foreground">{pb.text}</div>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">×{pb.uses}</span>
        </div>
      ))}
    </div>
  );
}

export default PromptsPanel;
