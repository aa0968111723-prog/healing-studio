// ============================================================================
// adapters/dataStore.trpc.ts — DataStoreAdapter（真實 tRPC 版，預設）
// ----------------------------------------------------------------------------
// 接點（GitNexus 驗證存在，main HEAD 2888a36）：
//   listProjects      → creativeProject.list            ✅
//   getProject        → creativeProject.get             ✅
//   getProjectSummary → creativeProject.getContextSummary ✅（/create 用）
//   listModels        → aiModels.list                   ✅
//   listNews          → news.list                       🔧（sense 僅 inferIntent，無 feed）
//   listTemplates     → showcase.templates              ◑ 待建 → 不存在時回 []（過渡重用 block_combos）
//
// tRPC 邊界以 `client as any` 寬鬆化（輸入/輸出 schema 於 P1 接線最終核對）；介面強型別。
// ============================================================================
import type {
  AdapterDeps, DataStoreAdapter,
} from "./types";
import { AdapterError } from "./types";
import type { CreativeProject, CreativeProjectSummary, ModelEntry, NewsItem, Template } from "@/spine/types";
import { getTrpcClient } from "./trpcClient";

export function makeDataStoreTrpc(_deps: AdapterDeps): DataStoreAdapter {
  const client = getTrpcClient() as unknown as any;

  async function listProjects(): Promise<CreativeProjectSummary[]> {
    try {
      const rows = await client.creativeProject.list.query();
      return (Array.isArray(rows) ? rows : rows?.items ?? []).map((r: any): CreativeProjectSummary => ({
        id: String(r.id),
        name: r.name ?? r.title ?? "未命名專案",
        emoji: r.emoji,
        type: r.type,
        updatedAt: r.updatedAt ? new Date(r.updatedAt).getTime() : undefined,
      }));
    } catch (err) {
      throw new AdapterError("listProjects failed", { seam: "dataStore", procedure: "creativeProject.list", cause: err });
    }
  }

  async function getProject(projectId: number): Promise<CreativeProject | null> {
    try {
      const r = await client.creativeProject.get.query({ id: projectId });
      return (r ?? null) as CreativeProject | null;
    } catch (err) {
      throw new AdapterError("getProject failed", { seam: "dataStore", procedure: "creativeProject.get", cause: err });
    }
  }

  async function getProjectSummary(projectId: number): Promise<unknown | null> {
    try {
      return (await client.creativeProject.getContextSummary.query({ projectId })) ?? null;
    } catch (err) {
      throw new AdapterError("getProjectSummary failed", { seam: "dataStore", procedure: "creativeProject.getContextSummary", cause: err });
    }
  }

  async function listModels(): Promise<ModelEntry[]> {
    try {
      const rows = await client.aiModels.list.query();
      return (Array.isArray(rows) ? rows : rows?.items ?? []) as ModelEntry[];
    } catch (err) {
      throw new AdapterError("listModels failed", { seam: "dataStore", procedure: "aiModels.list", cause: err });
    }
  }

  async function listNews(): Promise<NewsItem[]> {
    try {
      const rows = await client.news.list.query();
      return (Array.isArray(rows) ? rows : rows?.items ?? []) as NewsItem[];
    } catch (err) {
      throw new AdapterError("listNews failed", { seam: "dataStore", procedure: "news.list", cause: err });
    }
  }

  async function listTemplates(): Promise<Template[]> {
    // ◑ showcase.templates 待建：不存在/失敗時回 []（不讓社群版型缺口阻斷 UI）。
    try {
      const rows = await client.showcase.templates.query();
      return (Array.isArray(rows) ? rows : rows?.items ?? []) as Template[];
    } catch {
      return [];
    }
  }

  return { listProjects, getProject, getProjectSummary, listModels, listNews, listTemplates };
}
