// ============================================================================
// usePromptVault — U-9 共用 PromptVault「生成→存庫→重用」接線 hook
// ----------------------------------------------------------------------------
// 把 design-kit 的純展示元件（SaveToVault / VaultBrowser / PromptCard，#883）接到
// 真實後端 adapter（adapters/promptVault.trpc.ts → promptLibrary.*）。所有業務狀態
// （存庫五態、瀏覽四態、重用計數）收在這支 hook，元件維持無狀態、可測。
//
// 設計：
//   · adapter 以 DI 注入（預設真實 tRPC；測試可塞 fake），故 hook 不綁 tRPC、可單測。
//   · PromptVaultItem（後端列）→ VaultEntry（design-kit 展示型別）以 toVaultEntry 映射。
//   · 客端去重：存庫時若同 content 已存在 → 標 "duplicate" 並 +1 使用次數
//     （對映元件「已存在 · 已更新使用次數」態），不重複建立。
// ============================================================================
import * as React from "react";
import { makePromptVaultTrpc } from "@/adapters/promptVault.trpc";
import type { AdapterDeps, PromptVaultAdapter, PromptVaultItem } from "@/adapters/types";
import type { SaveState, VaultEntry } from "@/components/design-kit/PromptVault";
import type { ProviderId } from "@/components/design-kit/tokens";

export type BrowseState = "empty" | "loading" | "error" | "ready";
export type SourceWorkflow = "video" | "social";

/** adapter 不使用 deps（內部走 getTrpcClient lazy singleton）；給合法佔位即可。 */
const DEPS_STUB: AdapterDeps = {
  getProvider: () => "gemini",
  getFaults: () => ({}),
};

const PROVIDER_IDS: ProviderId[] = ["hf", "gemini", "fal", "mock"];

/** PromptVaultItem（後端列）→ VaultEntry（design-kit 展示型別）。 */
export function toVaultEntry(item: PromptVaultItem, sourceWorkflow: SourceWorkflow): VaultEntry {
  const provider: ProviderId = PROVIDER_IDS.includes(item.modelHint as ProviderId)
    ? (item.modelHint as ProviderId)
    : "gemini";
  return {
    id: String(item.id),
    prompt: item.content,
    params: { model: item.modelHint ?? "—", provider },
    tags: item.tags,
    sourceWorkflow,
    uses: item.useCount,
    status: item.isFavorite ? "saved" : "draft",
  };
}

export interface SavePayload {
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  modelHint?: string;
}

export interface UsePromptVault {
  // 瀏覽（重用 UX）
  browseState: BrowseState;
  entries: VaultEntry[];
  query: string;
  setQuery: (q: string) => void;
  refresh: () => Promise<void>;
  // 存庫 UX
  saveState: SaveState;
  autoDraft: boolean;
  toggleAutoDraft: () => void;
  save: (payload: SavePayload) => Promise<void>;
  resetSave: () => void;
  // 重用（再生成／插入素材／fork）
  applyEntry: (entry: VaultEntry) => Promise<void>;
}

export function usePromptVault(opts: {
  sourceWorkflow: SourceWorkflow;
  /** DI：預設真實 tRPC adapter；測試可注入 fake。 */
  adapter?: PromptVaultAdapter;
  /** 重用回呼：再生成／插入素材／fork 編輯。 */
  onApply?: (entry: VaultEntry) => void;
  /** 掛載時自動載入清單（預設 true；存庫控制等只寫不讀的場景設 false）。 */
  autoLoad?: boolean;
}): UsePromptVault {
  const { sourceWorkflow, adapter: injected, onApply, autoLoad = true } = opts;

  const adapter = React.useMemo<PromptVaultAdapter>(
    () => injected ?? makePromptVaultTrpc(DEPS_STUB),
    [injected],
  );

  const [browseState, setBrowseState] = React.useState<BrowseState>(autoLoad ? "loading" : "empty");
  const [entries, setEntries] = React.useState<VaultEntry[]>([]);
  const [query, setQueryState] = React.useState("");
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [autoDraft, setAutoDraft] = React.useState(false);

  const load = React.useCallback(async (q: string) => {
    setBrowseState("loading");
    try {
      const page = await adapter.listPrompts(q ? { search: q } : undefined);
      const mapped = page.items.map((it) => toVaultEntry(it, sourceWorkflow));
      setEntries(mapped);
      setBrowseState(mapped.length === 0 ? "empty" : "ready");
    } catch {
      setBrowseState("error");
    }
  }, [adapter, sourceWorkflow]);

  React.useEffect(() => {
    if (!autoLoad) return;
    void load("");
  }, [autoLoad, load]);

  const setQuery = React.useCallback((q: string) => {
    setQueryState(q);
    void load(q);
  }, [load]);

  const refresh = React.useCallback(() => load(query), [load, query]);

  const save = React.useCallback(async (payload: SavePayload) => {
    setSaveState("saving");
    try {
      const dup = entries.find((e) => e.prompt.trim() === payload.content.trim());
      if (dup) {
        await adapter.incrementUseCount(Number(dup.id));
        setSaveState("duplicate");
        await load(query);
        return;
      }
      await adapter.createPrompt({
        title: payload.title,
        content: payload.content,
        category: payload.category,
        tags: payload.tags,
        modelHint: payload.modelHint,
      });
      setSaveState("saved");
      await load(query);
    } catch {
      setSaveState("error");
    }
  }, [adapter, entries, load, query]);

  const applyEntry = React.useCallback(async (entry: VaultEntry) => {
    try {
      await adapter.incrementUseCount(Number(entry.id));
    } catch {
      /* 重用計數失敗不阻斷套用 */
    }
    onApply?.(entry);
    void load(query);
  }, [adapter, onApply, load, query]);

  return {
    browseState,
    entries,
    query,
    setQuery,
    refresh,
    saveState,
    autoDraft,
    toggleAutoDraft: React.useCallback(() => setAutoDraft((v) => !v), []),
    save,
    resetSave: React.useCallback(() => setSaveState("idle"), []),
    applyEntry,
  };
}
