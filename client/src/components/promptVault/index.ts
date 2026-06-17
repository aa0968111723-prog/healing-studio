// U-9 共用 PromptVault 接線層 — 殼以 ENABLE_PROMPT_VAULT 旗標掛載這些容器。
export { usePromptVault, toVaultEntry } from "./usePromptVault";
export type {
  UsePromptVault,
  SavePayload,
  SourceWorkflow,
  BrowseState,
} from "./usePromptVault";
export { PromptVaultPanel, SaveToVaultControl } from "./PromptVaultPanel";
// U-9 採用閉環：跨 /video /social 可重用的單一「生成→存庫→重用」元件 ＋ 採用旗標。
export { PromptVaultAdoption, default as PromptVaultAdoptionDefault } from "./PromptVaultAdoption";
export type { PromptVaultAdoptionProps } from "./PromptVaultAdoption";
export { PROMPT_VAULT_ADOPTION } from "./promptVaultAdoptionFlags";
