// ============================================================================
// PromptVaultAdoption — U-9 共用「生成 → 存庫 → 重用」單一可重用閉環元件
// ----------------------------------------------------------------------------
// 一句話範圍：把一段提示詞「存進庫」與「從庫重用」的閉環，做成跨 /video /social
// 可重用的單一元件——存庫控制（SaveToVault，五態）＋ 詞庫瀏覽器（VaultBrowser，
// 四態）並列，接既有 usePromptVault 資料層，包在 <AidvKit> 內以設計套件視覺呈現。
//
// 為何是「一個」元件（而非沿用 PromptVaultPanel 的兩個容器）：
//   · U-9 要的是可被任一殼「一次掛載即得閉環」的採用單元，殼端零業務邏輯。
//   · 本元件僅編排既有純元件＋既有 hook，自身無新業務狀態，維持可測、可回滾。
//
// 隔離：本元件不引用、不編輯任何 /video /social 殼；殼端 wiring 列為 Phase 2
//       （以 ENABLE_PROMPT_VAULT × PROMPT_VAULT_ADOPTION 兩層旗標掛載本元件）。
//
// 設計鐵則：
//   · 視覺一律走 design-kit 純元件＋ .aidv-kit scope 的 CSS 變數，零硬編 hex。
//   · a11y：區塊 <section> + aria-labelledby、icon-only 控制有 aria-label、
//     焦點環沿用 primitives、reduced-motion 由 design-kit.css 動效尊重。
//   · 四態（empty/loading/error/ready）＋存庫五態（idle/saving/saved/duplicate/error）
//     全部由 usePromptVault 推導，元件只負責編排與旗標分流。
// ============================================================================
import * as React from "react";
import { AidvKit } from "@/components/design-kit/AidvKit";
import { SaveToVault, VaultBrowser } from "@/components/design-kit/PromptVault";
import type { VaultEntry } from "@/components/design-kit/PromptVault";
import type { PromptVaultAdapter } from "@/adapters/types";
import { usePromptVault, type SavePayload, type SourceWorkflow } from "./usePromptVault";
import { PROMPT_VAULT_ADOPTION } from "./promptVaultAdoptionFlags";

export interface PromptVaultAdoptionProps {
  /** 來源工作流：跨 /video /social 重用的唯一差異點。 */
  sourceWorkflow: SourceWorkflow;
  /** DI：預設真實 promptLibrary.* tRPC adapter；測試／demo 可注入 fake。 */
  adapter?: PromptVaultAdapter;
  /** 目前生成結果要存的 prompt；null＝尚無可存內容（存庫鈕 no-op）。 */
  payload?: SavePayload | null;
  /** 重用回呼：再生成／插入素材／複製編輯（殼自行決定如何餵回生成流程）。 */
  onApply?: (entry: VaultEntry) => void;
  /**
   * 閉環開關。預設讀 PROMPT_VAULT_ADOPTION 旗標：
   *   true  → 存庫控制 ＋ 詞庫瀏覽器並列（完整閉環）。
   *   false → 收起為單側（依 only 決定顯示存或瀏覽）。
   * 顯式傳值優先於旗標，方便測試與漸進採用。
   */
  closedLoop?: boolean;
  /** closedLoop=false 時顯示哪一側；預設 "browse"。 */
  only?: "save" | "browse";
  /** 區塊標題（可關閉，殼若自帶標題可傳 null）。 */
  heading?: React.ReactNode;
  className?: string;
}

const HEADING_ID = "promptvault-adoption-heading";

/**
 * 共用提示詞庫採用元件：生成 → 存庫 → 重用閉環。可被 /video /social 任一殼引用。
 */
export function PromptVaultAdoption({
  sourceWorkflow,
  adapter,
  payload = null,
  onApply,
  closedLoop,
  only = "browse",
  heading = "提示詞庫 · 存庫與重用",
  className,
}: PromptVaultAdoptionProps) {
  const showClosedLoop = closedLoop ?? PROMPT_VAULT_ADOPTION;
  const showSave = showClosedLoop || only === "save";
  const showBrowse = showClosedLoop || only === "browse";

  const vault = usePromptVault({ sourceWorkflow, adapter, onApply, autoLoad: showBrowse });

  const doSave = React.useCallback(() => {
    if (payload) void vault.save(payload);
  }, [payload, vault]);

  return (
    <AidvKit
      as="section"
      className={className}
      aria-labelledby={heading != null ? HEADING_ID : undefined}
    >
      <div className="flex flex-col gap-4">
        {heading != null && (
          <h3
            id={HEADING_ID}
            className="font-serif text-[15px] font-semibold text-[var(--text)]"
          >
            {heading}
          </h3>
        )}

        {showSave && (
          <SaveToVault
            state={vault.saveState}
            autoDraft={vault.autoDraft}
            onToggleAuto={vault.toggleAutoDraft}
            onSave={doSave}
            onRetry={doSave}
          />
        )}

        {showBrowse && (
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
        )}
      </div>
    </AidvKit>
  );
}

export default PromptVaultAdoption;
