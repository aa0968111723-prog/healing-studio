import { useMemo } from "react";
import { useLocation } from "wouter";
import { ConsistencyVault } from "@/components/ConsistencyVault";
import { Layers } from "lucide-react";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";

export default function VaultPage() {
  // 全站新手引導
  usePageTour("vault");
  const [, navigate] = useLocation();

  // ── PageAgent：光球可從保險庫跳到工作室 / 角色鍛造所 ───────────
  const VAULT_NAV_ALLOWLIST = useMemo<Set<string>>(
    () => new Set(["/studio", "/image-studio", "/models", "/assets"]),
    []
  );
  const vaultAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "navigate",
        label: "前往工作室或模型庫",
        hint: "/studio、/image-studio、/models、/assets",
      },
    ],
    []
  );

  useRegisterPageAgent({
    pageId: "vault",
    pageLabel: "一致性保險庫",
    pagePath: "/vault",
    capabilities: vaultAgentCapabilities,
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (action.type === "navigate") {
        if (!VAULT_NAV_ALLOWLIST.has(action.path)) {
          return { ok: false, reason: `navigation blocked: ${action.path}` };
        }
        navigate(action.path);
        return { ok: true, message: `已導航到 ${action.path}` };
      }
      return {
        ok: false,
        reason: `unsupported on vault: ${action.type}`,
      };
    },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="hs-h1 !mb-0 text-foreground flex items-center gap-2">
          <Layers className="w-6 h-6" />
          一致性保險庫
        </h1>
        <p className="hs-small !mb-0 text-muted-foreground mt-1">
          管理角色與場景參考圖，確保跨作品的風格一致性。可拖放至創作工作室使用。
        </p>
      </div>

      {/* Full Vault Component */}
      <div className="max-w-2xl">
        <ConsistencyVault />
      </div>
    </div>
  );
}
