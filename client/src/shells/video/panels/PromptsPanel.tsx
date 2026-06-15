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
// U-5（AIDV-95）逐殼採用 · /video：旗標 ON 時提示詞積木列改用 design-kit 亮色暖光 PromptBlock；
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）OFF（預設）＝既有版＝零變化。
// 純展示列（label＋text＋uses 三欄全保留，無插入/fork 等控制項）＝可 1:1 忠實對映、零資訊損失。
// 設計門依 ui-ux-pro-max「no-emoji-icons」：ON 版改由 design-kit 以文字 Tag 呈現使用次數、不帶 emoji。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, PromptBlock as DkPromptBlock } from "@/components/design-kit";

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
        <PromptBlockRow key={pb.id} kind={pb.kind} label={pb.label} text={pb.text} uses={pb.uses} />
      ))}
    </div>
  );
}

/** 單筆提示詞積木列（純展示）。旗標 ON＝design-kit 亮色暖光 PromptBlock；OFF（預設）＝既有版＝零變化。 */
export function PromptBlockRow({
  kind, label, text, uses,
}: { kind: string; label: string; text: string; uses: number }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkPromptBlock label={label} text={text} uses={uses} />
      </AidvKit>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border p-2.5">
      <span className="text-base leading-none">{kind === "combo" ? "🧩" : "✎"}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{label}</div>
        <div className="truncate text-[10px] text-muted-foreground">{text}</div>
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">×{uses}</span>
    </div>
  );
}

export default PromptsPanel;
