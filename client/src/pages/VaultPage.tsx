import { useMemo } from "react";
import { useLocation } from "wouter";
import { ConsistencyVault } from "@/components/ConsistencyVault";
import { Layers } from "lucide-react";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { AssetModelSubpageGuide } from "@/components/AssetModelSubpageGuide";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";

// 2026-05 合併:原本 VaultPage 同時管「一致性錨點」與「成品輸出庫」兩條
// 子分頁。但成品輸出庫讀 backgroundJobs.status="completed",與 數位資產庫
// (digital_asset_library) 是同一批資料 — 使用者抱怨「不知道要到哪裡找」。
// 修 PR #680 之後 fal.ai / Suno 路徑都會把產出寫進 digital_asset_library,
// 所以成品輸出庫的子分頁正式併入 數位資產庫,本頁只保留純粹的角色錨點。

export default function VaultPage() {
  usePageTour("vault");
  const [, navigate] = useLocation();

  const VAULT_NAV_ALLOWLIST = useMemo<Set<string>>(
    () =>
      new Set([
        "/studio",
        "/image-studio",
        "/video-studio",
        "/pro-studio",
        "/models",
        "/assets",
        "/history",
      ]),
    []
  );
  const vaultAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "navigate",
        label: "前往工作室或模型庫",
        options: [
          { id: "/studio", label: "創作工作室", meta: { bestFor: "快速套用一致性素材", tip: "先拖角色錨點再生成" } },
          { id: "/image-studio", label: "圖片創作室", meta: { bestFor: "角色視覺定稿", tip: "先固定臉部與服裝特徵" } },
          { id: "/video-studio", label: "影片創作室", meta: { bestFor: "為一致性角色配動作", tip: "套用相同 LoRA 參考圖" } },
          { id: "/pro-studio", label: "音樂配音室", meta: { bestFor: "為角色配聲音線", tip: "保留聲音設定到 vault" } },
          { id: "/models", label: "角色鍛造所", meta: { bestFor: "模型版本治理", tip: "保留穩定版避免回滾風險" } },
          { id: "/assets", label: "數位資產庫", meta: { bestFor: "查看所有成品", tip: "原成品輸出庫已併入此頁" } },
          { id: "/history", label: "歷史紀錄", meta: { bestFor: "回看歷次版本", tip: "從歷史挑出基準版" } },
        ],
        hint: "/studio、/image-studio、/video-studio、/pro-studio、/models、/assets、/history",
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
      return { ok: false, reason: `unsupported on vault: ${action.type}` };
    },
  });

  return (
    <div className="page-shell page-shell-narrow space-y-6">
      <header className="page-header">
        <p className="page-eyebrow">Vault</p>
        <h1 className="page-title flex items-center gap-2">
          <Layers className="w-6 h-6" />
          一致性保險庫
        </h1>
        <p className="page-subtitle">
          管理角色錨點與參考圖。完成的圖/影/音/語音作品已併入「數位資產庫」。
        </p>
      </header>

      <AssetModelSubpageGuide page="vault" />

      <div className="max-w-2xl">
        <ConsistencyVault />
      </div>
    </div>
  );
}
