// ============================================================================
// PromptVaultPanel / SaveToVaultControl — 把 design-kit 純元件接上 usePromptVault
// ----------------------------------------------------------------------------
// 殼（/video、/social）以 ENABLE_PROMPT_VAULT 旗標掛載這兩個容器即得「存庫→重用」
// 閉環，且全部接真實 promptLibrary.* tRPC。容器本身無業務邏輯，僅綁定 hook ↔ 元件。
// ============================================================================
import * as React from "react";
import { SaveToVault, VaultBrowser } from "@/components/design-kit/PromptVault";
import type { VaultEntry } from "@/components/design-kit/PromptVault";
import type { PromptVaultAdapter } from "@/adapters/types";
import { usePromptVault, type SavePayload, type SourceWorkflow } from "./usePromptVault";

/** 重用 UX：素材步驟的提示詞庫瀏覽器（接 promptLibrary.list；四態 empty/loading/error/ready）。 */
export function PromptVaultPanel({
  sourceWorkflow,
  adapter,
  onApply,
}: {
  sourceWorkflow: SourceWorkflow;
  adapter?: PromptVaultAdapter;
  /** 重用回呼：再生成／插入素材／fork（殼自行決定如何把 prompt 餵回生成流程）。 */
  onApply?: (entry: VaultEntry) => void;
}) {
  const vault = usePromptVault({ sourceWorkflow, adapter, onApply });
  return (
    <VaultBrowser
      state={vault.browseState}
      entries={vault.entries}
      query={vault.query}
      onQuery={vault.setQuery}
      onRegen={vault.applyEntry}
      onInsert={vault.applyEntry}
      onFork={vault.applyEntry}
      onRetry={vault.refresh}
    />
  );
}

/** 存庫 UX：生成結果旁的「＋ 存入提示詞庫」（接 promptLibrary.create；五態含 duplicate）。 */
export function SaveToVaultControl({
  sourceWorkflow,
  adapter,
  payload,
}: {
  sourceWorkflow: SourceWorkflow;
  adapter?: PromptVaultAdapter;
  /** 目前生成結果要存的 prompt；null 時按鈕無可存內容（onSave no-op）。 */
  payload: SavePayload | null;
}) {
  const vault = usePromptVault({ sourceWorkflow, adapter, autoLoad: false });
  const doSave = () => {
    if (payload) void vault.save(payload);
  };
  return (
    <SaveToVault
      state={vault.saveState}
      autoDraft={vault.autoDraft}
      onToggleAuto={vault.toggleAutoDraft}
      onSave={doSave}
      onRetry={doSave}
    />
  );
}
