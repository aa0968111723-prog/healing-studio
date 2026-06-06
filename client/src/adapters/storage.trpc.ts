// ============================================================================
// adapters/storage.trpc.ts — StorageAdapter（真實 tRPC 版，預設）
// ----------------------------------------------------------------------------
// 🔧 GitNexus 校正（§D.3，main HEAD 2888a36）：
//   recordGenResult → generate.recordGenResult（既有回寫點；回退鏈每跳落點，
//                     而非另造寫入路徑）→ digital_asset_library
//                     （project_asset_links / asset_generation_events 為 M2 待建表）
//   exportToAssets  → vault.exportToAssets（consistency_vault 角色定版匯出資產庫）
//
// 實體物件儲存（r2 | gcs | supabase）由伺服器端在生成 job 內處理；前端 StorageAdapter
// 只負責「結果回寫 / 匯出」這層。putObject/getSignedUrl（直傳）屬 STORAGE_PROVIDER 的
// P4 範圍，先以 AdapterError 明示未開放，避免誤用。
//
// tRPC 邊界以 `client as any` 寬鬆化；介面強型別。
// ============================================================================
import type { AdapterDeps, StorageAdapter, RecordedAsset } from "./types";
import { AdapterError } from "./types";
import type { GenKind, ProviderId } from "@/spine/types";
import { getTrpcClient } from "./trpcClient";

export function makeStorageTrpc(_deps: AdapterDeps): StorageAdapter {
  const client = getTrpcClient() as unknown as any;

  async function recordGenResult(input: {
    projectId?: number; shotNo?: string; kind: GenKind; provider: ProviderId;
    model: string; costUsd: number; seed?: number; assetUrl?: string;
  }): Promise<RecordedAsset> {
    try {
      // 🔧 generate.recordGenResult — 生成結果回寫資產庫（既有回寫點）
      const r = await client.generate.recordGenResult.mutate({
        projectId: input.projectId, shotNo: input.shotNo, kind: input.kind, provider: input.provider,
        model: input.model, costUsd: input.costUsd, seed: input.seed, assetUrl: input.assetUrl,
      });
      return {
        id: String(r?.id ?? r?.assetId ?? ""),
        kind: input.kind, provider: input.provider, modelId: input.model,
        costUsd: input.costUsd, assetUrl: r?.assetUrl ?? input.assetUrl,
      };
    } catch (err) {
      throw new AdapterError("recordGenResult failed", { seam: "storage", procedure: "generate.recordGenResult", cause: err });
    }
  }

  async function exportToAssets(input: { projectId: number; vaultId: string }): Promise<{ ok: boolean }> {
    try {
      // 🔧 vault.exportToAssets（vault 僅 CRUD + exportToAssets）
      await client.vault.exportToAssets.mutate({ projectId: input.projectId, id: input.vaultId });
      return { ok: true };
    } catch (err) {
      throw new AdapterError("exportToAssets failed", { seam: "storage", procedure: "vault.exportToAssets", cause: err });
    }
  }

  return { recordGenResult, exportToAssets };
}
