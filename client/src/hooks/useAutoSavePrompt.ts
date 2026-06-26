import { useCallback } from "react";
import { ENABLE_PROMPT_VAULT } from "@/config/promptVaultFlags";
import type { PromptVaultAdapter } from "@/adapters/types";
import { usePromptVault } from "@/components/promptVault/usePromptVault";
import type { SavePayload, SourceWorkflow } from "@/components/promptVault/usePromptVault";

export interface UseAutoSavePromptOptions {
  sourceWorkflow: SourceWorkflow;
  /** DI: test can inject a fake adapter. */
  adapter?: PromptVaultAdapter;
}

/**
 * AIDV-287: Fires-and-forgets a prompt save to promptVault on generation success.
 * No-op when ENABLE_PROMPT_VAULT is off (default) or content is empty.
 */
export function useAutoSavePrompt({ sourceWorkflow, adapter }: UseAutoSavePromptOptions) {
  const vault = usePromptVault({ sourceWorkflow, adapter, autoLoad: false });

  const trySave = useCallback(
    (payload: SavePayload) => {
      if (!ENABLE_PROMPT_VAULT) return;
      if (!payload.content.trim()) return;
      void vault.save(payload);
    },
    [vault.save],
  );

  return { trySave };
}
