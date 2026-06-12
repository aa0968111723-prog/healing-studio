// ============================================================================
// adapters/promptVault.trpc.ts — PromptVaultAdapter（真實 tRPC 版，預設）
// ----------------------------------------------------------------------------
// Wave 1（W1-3）新增的第六條接縫。對應真實 procedure（全部已驗證存在）：
//   listPrompts        → promptLibrary.list（分頁 {items,total,page,pageSize,totalPages}）
//   getPrompt          → promptLibrary.getById（NOT_FOUND → null）
//   createPrompt       → promptLibrary.create（title 必填 — 缺 title 曾被 zod 靜默退回，已校正）
//   incrementUseCount  → promptLibrary.incrementUseCount
//   listLinkedAssets   → promptLibrary.linkedAssets（🔧 junction 0075，PR #864）
//   listLinkedPrompts  → assets.linkedPrompts（🔧 同上）
//
// 薄接縫原則（00 總覽 §3.1-2）：只做「方法 → procedure」轉譯＋防禦式映射，
// 不放業務邏輯、不放快取。tRPC 邊界以 `client as any` 寬鬆化；介面強型別。
// ============================================================================
import type {
  AdapterDeps, PromptVaultAdapter, PromptVaultItem, PromptVaultPage,
  PromptLinkedAsset, PromptLinkedPrompt,
} from "./types";
import { AdapterError } from "./types";
import { getTrpcClient } from "./trpcClient";

function toItem(r: any): PromptVaultItem {
  return {
    id: Number(r?.id ?? 0),
    title: String(r?.title ?? ""),
    content: String(r?.content ?? ""),
    category: String(r?.category ?? "general"),
    tags: Array.isArray(r?.tags) ? r.tags.map((t: any) => String(t)) : [],
    isFavorite: Boolean(r?.isFavorite ?? false),
    useCount: Number(r?.useCount ?? 0),
    modelHint: r?.modelHint ? String(r.modelHint) : undefined,
    updatedAt: r?.updatedAt ? new Date(r.updatedAt).getTime() : undefined,
  };
}

export function makePromptVaultTrpc(_deps: AdapterDeps): PromptVaultAdapter {
  const client = getTrpcClient() as unknown as any;

  async function listPrompts(input?: {
    category?: string; search?: string; favoritesOnly?: boolean; page?: number; pageSize?: number;
  }): Promise<PromptVaultPage> {
    try {
      const r = await client.promptLibrary.list.query({
        ...(input?.category ? { category: input.category } : {}),
        ...(input?.search ? { search: input.search } : {}),
        ...(input?.favoritesOnly ? { favoritesOnly: true } : {}),
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 20,
      });
      return {
        items: (r?.items ?? []).map(toItem),
        total: Number(r?.total ?? 0),
        page: Number(r?.page ?? 1),
        pageSize: Number(r?.pageSize ?? 20),
        totalPages: Number(r?.totalPages ?? 0),
      };
    } catch (err) {
      throw new AdapterError("listPrompts failed", { seam: "promptVault", procedure: "promptLibrary.list", cause: err });
    }
  }

  async function getPrompt(id: number): Promise<PromptVaultItem | null> {
    try {
      const r = await client.promptLibrary.getById.query({ id });
      return r ? toItem(r) : null;
    } catch (err: any) {
      // 非本人 / 不存在 → 伺服器丟 NOT_FOUND；接縫語意為回 null（UI 顯示空態，不彈錯）。
      if (err?.data?.code === "NOT_FOUND" || err?.shape?.data?.code === "NOT_FOUND") return null;
      throw new AdapterError("getPrompt failed", { seam: "promptVault", procedure: "promptLibrary.getById", cause: err });
    }
  }

  async function createPrompt(input: {
    title: string; content: string; category?: string; tags?: string[]; modelHint?: string;
  }): Promise<{ id: number }> {
    try {
      // title 必填（zod min(1)）—— 缺 title 曾讓建立靜默失敗（promptLibrary.create 前例），
      // 接縫層先行擋下，給呼叫端明確錯誤而非伺服器 400。
      if (!input.title?.trim()) {
        throw new AdapterError("createPrompt: title 必填", { seam: "promptVault", procedure: "promptLibrary.create" });
      }
      const r = await client.promptLibrary.create.mutate({
        title: input.title.trim(),
        content: input.content,
        ...(input.category ? { category: input.category } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.modelHint ? { modelHint: input.modelHint } : {}),
      });
      return { id: Number(r?.id ?? 0) };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError("createPrompt failed", { seam: "promptVault", procedure: "promptLibrary.create", cause: err });
    }
  }

  async function incrementUseCount(id: number): Promise<void> {
    try {
      await client.promptLibrary.incrementUseCount.mutate({ id });
    } catch (err) {
      throw new AdapterError("incrementUseCount failed", { seam: "promptVault", procedure: "promptLibrary.incrementUseCount", cause: err });
    }
  }

  async function listLinkedAssets(promptId: number): Promise<PromptLinkedAsset[]> {
    try {
      // 🔧 promptLibrary.linkedAssets — junction 0075（PR #864）；表空回 []，讀取不掛旗標。
      const rows = await client.promptLibrary.linkedAssets.query({ promptId });
      return (rows ?? []).map((r: any): PromptLinkedAsset => ({
        relation: String(r?.relation ?? "derived"),
        linkedAt: r?.linkedAt ? new Date(r.linkedAt).getTime() : undefined,
        asset: {
          id: Number(r?.asset?.id ?? 0),
          title: String(r?.asset?.title ?? ""),
          assetType: String(r?.asset?.assetType ?? "image"),
          fileUrl: r?.asset?.fileUrl ? String(r.asset.fileUrl) : undefined,
          thumbnailUrl: r?.asset?.thumbnailUrl ? String(r.asset.thumbnailUrl) : undefined,
          modelId: r?.asset?.modelId ? String(r.asset.modelId) : undefined,
        },
      }));
    } catch (err) {
      throw new AdapterError("listLinkedAssets failed", { seam: "promptVault", procedure: "promptLibrary.linkedAssets", cause: err });
    }
  }

  async function listLinkedPrompts(assetId: number): Promise<PromptLinkedPrompt[]> {
    try {
      // 🔧 assets.linkedPrompts — junction 0075 反向。
      const rows = await client.assets.linkedPrompts.query({ assetId });
      return (rows ?? []).map((r: any): PromptLinkedPrompt => ({
        relation: String(r?.relation ?? "derived"),
        linkedAt: r?.linkedAt ? new Date(r.linkedAt).getTime() : undefined,
        prompt: {
          id: Number(r?.prompt?.id ?? 0),
          title: String(r?.prompt?.title ?? ""),
          content: String(r?.prompt?.content ?? ""),
          category: String(r?.prompt?.category ?? "general"),
          modelHint: r?.prompt?.modelHint ? String(r.prompt.modelHint) : undefined,
        },
      }));
    } catch (err) {
      throw new AdapterError("listLinkedPrompts failed", { seam: "promptVault", procedure: "assets.linkedPrompts", cause: err });
    }
  }

  return { listPrompts, getPrompt, createPrompt, incrementUseCount, listLinkedAssets, listLinkedPrompts };
}
