// ============================================================================
// shells/video/panels/VaultBrowserPanel.tsx — U-9（AIDV-99）共用 PromptVault 採用 · 第1片
// ----------------------------------------------------------------------------
// 把 design-kit `VaultBrowser` 接到「真實」提示詞庫（promptVault 接縫 → promptLibrary.list），
// 補上「存 → 重用」閉環的**重用**半邊：瀏覽真實詞庫 + 搜尋 + 重用三動作（插入 / 複製 / 再生成）。
//
// 旗標：與 chrome 同一個 ENABLE_AIDV_CHROME 開關（見呼叫端 PromptsPanel）。本面板只在旗標 ON 時
//   掛載＝OFF（預設）完全不渲染、不發任何 tRPC 請求＝線上零變化、可秒回滾。
//
// 鐵則對齊：
//   · 面板只透過接縫（useSpine().adapters.promptVault）呼叫，不直呼 procedure。
//   · 四態鐵律：empty / loading / error / ready 由真實 list 結果驅動。
//   · 成本鐵律：本片的「再生成」**不直接觸發生成**（不呼叫 generate）—— 只把 prompt 帶回編輯框，
//     真正的「先估成本 → 確認 → 扣退」於畫布生成流程進行（下一片接 estimateCost→submitStudioJob）。
//     故本片零成本路徑、零後端寫入風險；incrementUseCount 為加法式使用計數，安全。
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { Tv } from "lucide-react";
import { toast } from "sonner";
import { useSpine } from "@/providers/SpineProvider";
import { AidvKit, VaultBrowser } from "@/components/design-kit";
import type { VaultEntry } from "@/components/design-kit";
import type { PromptVaultItem } from "@/adapters/types";
// U-14 Phase 2（AIDV-146）：Flow TV 放映入口（/video）。旗標 OFF＝零渲染、零請求。
import { FLOW_TV_ENABLED, FlowTvOverlay } from "@/components/flow-tv";
import type { FlowTvItem } from "@/components/flow-tv";

type BrowseState = "empty" | "loading" | "error" | "ready";

/** 真實 prompt_library row（PromptVaultItem）→ 設計套件 VaultBrowser 視圖（VaultEntry）。
 *  provider 為純展示欄（prompt_library 不存 provider），預設標生成預設 provider「hf」。 */
function toEntry(it: PromptVaultItem): VaultEntry {
  return {
    id: String(it.id),
    prompt: it.content,
    params: { model: it.modelHint ?? "—", provider: "hf" },
    tags: it.tags,
    sourceWorkflow: "video",
    uses: it.useCount,
    status: "saved",
  };
}

const PAGE_SIZE = 24;

/**
 * /video 提示詞庫瀏覽器（旗標 ON 才掛載）。
 * @param onReuse 把選定 prompt 帶回呼叫端的編輯框（插入 / 複製 / 再生成共用此出口）。
 * @param reloadToken 呼叫端存庫後遞增 → 觸發重新列出（讓「存 → 出現在庫」即時可見）。
 */
export function VaultBrowserPanel({
  onReuse,
  reloadToken = 0,
}: {
  onReuse?: (prompt: string) => void;
  reloadToken?: number;
}) {
  const spine = useSpine();
  const vault = spine.adapters.promptVault;

  const [state, setState] = useState<BrowseState>("loading");
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [query, setQuery] = useState("");
  const [flowTvOpen, setFlowTvOpen] = useState(false);

  // 每次載入帶序號，避免慢回應覆蓋新回應（race）。
  const loadSeq = useRef(0);

  const load = useCallback(async (search: string) => {
    const my = ++loadSeq.current;
    setState("loading");
    try {
      const page = await vault.listPrompts({
        ...(search.trim() ? { search: search.trim() } : {}),
        page: 1,
        pageSize: PAGE_SIZE,
      });
      if (my !== loadSeq.current) return; // 已被更新的載入取代
      const mapped = page.items.map(toEntry);
      setEntries(mapped);
      setState(mapped.length === 0 ? "empty" : "ready");
    } catch {
      if (my !== loadSeq.current) return;
      setState("error");
    }
  }, [vault]);

  // 搜尋 debounce（300ms）；reloadToken 變動立即重載。
  useEffect(() => {
    const t = setTimeout(() => { void load(query); }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, reloadToken, load]);

  // 套用提示詞 → 使用次數 +1（加法式、最佳努力；失敗不擋重用）。
  const bumpUse = useCallback((entry: VaultEntry) => {
    const id = Number(entry.id);
    if (!Number.isFinite(id) || id <= 0) return;
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, uses: e.uses + 1 } : e)));
    void vault.incrementUseCount(id).catch(() => { /* 計數失敗不影響重用 */ });
  }, [vault]);

  const onInsert = useCallback((entry: VaultEntry) => {
    onReuse?.(entry.prompt);
    bumpUse(entry);
    toast.success("已插入提示詞", { description: "已帶入編輯框 · 使用次數 +1" });
  }, [onReuse, bumpUse]);

  const onFork = useCallback((entry: VaultEntry) => {
    onReuse?.(entry.prompt);
    toast("已複製到編輯框", { description: "改寫後按「存入提示詞庫」會建立新的一筆" });
  }, [onReuse]);

  const onRegen = useCallback((entry: VaultEntry) => {
    onReuse?.(entry.prompt);
    bumpUse(entry);
    toast("已帶入提示詞 · 於畫布生成", { description: "生成會先估成本再確認後扣點" });
  }, [onReuse, bumpUse]);

  const flowTvItems: FlowTvItem[] = entries.map((e) => ({
    id: e.id,
    prompt: e.prompt,
    source: "video" as const,
    tags: e.tags,
    model: e.params?.model && e.params.model !== "—" ? e.params.model : undefined,
  }));

  return (
    <>
      {FLOW_TV_ENABLED && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setFlowTvOpen(true)}
            aria-label="開啟 Flow TV 放映"
          >
            <Tv className="size-3.5" aria-hidden /> Flow TV 放映
          </button>
        </div>
      )}
      <AidvKit>
        <VaultBrowser
          state={state}
          entries={entries}
          query={query}
          onQuery={setQuery}
          onInsert={onInsert}
          onFork={onFork}
          onRegen={onRegen}
          onRetry={() => { void load(query); }}
        />
      </AidvKit>
      {FLOW_TV_ENABLED && (
        <FlowTvOverlay
          items={flowTvItems}
          open={flowTvOpen}
          onClose={() => setFlowTvOpen(false)}
        />
      )}
    </>
  );
}

export default VaultBrowserPanel;
