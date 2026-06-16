// U-9 共用 PromptVault 接線層 — 殼以 ENABLE_PROMPT_VAULT 旗標掛載這些容器。
export { usePromptVault, toVaultEntry } from "./usePromptVault";
export type {
  UsePromptVault,
  SavePayload,
  SourceWorkflow,
  BrowseState,
} from "./usePromptVault";
export { PromptVaultPanel, SaveToVaultControl } from "./PromptVaultPanel";
