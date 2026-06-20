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
// U-9（AIDV-99）第1片 · 旗標 ON 時補上「重用」半邊：真實提示詞庫瀏覽器（讀 promptLibrary.list）。
import { VaultBrowserPanel } from "./VaultBrowserPanel";
// AIDV-12（其餘可接子系統接真實 procedure）：補旗標關閉（chrome OFF）時 promptBlocks 死空的
// 「積木 combo」支線 → 真實 blockCombos.list（block_combos）；同型樣 trpc.useQuery + 四態回退。
import { trpc } from "@/lib/trpc";
import { ENABLE_SUBSYSTEM_REAL_DATA } from "@/config/videoFlags";
import { PanelError, PanelLoading } from "@/shells/_shared/PanelState";
import type { PromptBlock } from "@/spine/types";

/** block_combos row（blockCombos.list）→ 脊椎 PromptBlock（純展示映射）。 */
function comboToBlock(c: Record<string, unknown>): PromptBlock {
  const ids = Array.isArray(c.blockIds) ? (c.blockIds as unknown[]).map(String) : [];
  return {
    id: String(c.id ?? ""),
    label: String(c.name ?? "未命名 combo"),
    // combo 的「內容」＝其組成積木 id 串（純展示；真實重組於生成流程進行）。
    text: ids.join(" · "),
    kind: "combo",
    uses: 0, // block_combos 不存使用次數欄 → 展示為 0。
  };
}

/**
 * 旗標 ON（且 chrome OFF）：真實積木 combo 庫（blockCombos.list）。載入中／錯誤一律回退既有
 * 脊椎本地 promptBlocks（additive，不刪既有 fallback）；就緒態以真實 combo 列覆蓋。
 */
function RealComboBlocks({ fallback }: { fallback: PromptBlock[] }) {
  const q = trpc.blockCombos.list.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  if (q.isLoading) {
    return fallback.length > 0
      ? <FallbackBlocks blocks={fallback} />
      : <PanelLoading count={3} className="h-14 rounded-xl" label="讀取提示詞積木庫…" />;
  }
  if (q.isError) {
    return fallback.length > 0 ? (
      <FallbackBlocks blocks={fallback} />
    ) : (
      <PanelError message="提示詞積木庫讀取失敗（blockCombos.list）。" onRetry={() => void q.refetch()} />
    );
  }
  const rows = Array.isArray(q.data) ? (q.data as Record<string, unknown>[]).map(comboToBlock) : [];
  // 真實庫為空時，仍回退脊椎本地集合（保留現狀，避免空白）。
  const blocks = rows.length > 0 ? rows : fallback;
  return <FallbackBlocks blocks={blocks} />;
}

/** 既有脊椎本地 promptBlocks 列（OFF 路徑與 ON 回退共用）。 */
function FallbackBlocks({ blocks }: { blocks: PromptBlock[] }) {
  return (
    <>
      {blocks.map((pb) => (
        <PromptBlockRow key={pb.id} kind={pb.kind} label={pb.label} text={pb.text} uses={pb.uses} />
      ))}
    </>
  );
}

export function PromptsPanel() {
  const spine = useProjectSpine();
  const p = spine.project!;
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  // U-9：存庫後遞增 → 讓旗標 ON 的瀏覽器即時重列（「存 → 出現在庫」可見）。
  const [reloadToken, setReloadToken] = useState(0);

  const submit = () => {
    if (!label.trim()) return;
    void spine.addPromptBlock(label.trim(), text.trim());
    setLabel("");
    setText("");
    setReloadToken((n) => n + 1);
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

      {/* 旗標 ON（預設 OFF）：真實提示詞庫瀏覽器（搜尋 + 重用三動作）；OFF＝既有本地積木列＝零變化。 */}
      {ENABLE_AIDV_CHROME ? (
        <VaultBrowserPanel reloadToken={reloadToken} onReuse={(prompt) => setText(prompt)} />
      ) : ENABLE_SUBSYSTEM_REAL_DATA ? (
        // AIDV-12：chrome OFF 但本卡旗標 ON → 補真實積木 combo 庫（blockCombos.list）；
        // 載入中／錯誤回退脊椎本地 promptBlocks。chrome OFF＋本旗標 OFF（預設）＝下方既有列＝零變化。
        <RealComboBlocks fallback={p.promptBlocks} />
      ) : (
        p.promptBlocks.map((pb) => (
          <PromptBlockRow key={pb.id} kind={pb.kind} label={pb.label} text={pb.text} uses={pb.uses} />
        ))
      )}
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
