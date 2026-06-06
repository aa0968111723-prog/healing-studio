// ============================================================================
// adapters/commander.trpc.ts — CommanderAdapter（真實 tRPC 版，預設）
// ----------------------------------------------------------------------------
// 🔧 GitNexus 校正（§D.2/§E，main HEAD 2888a36）：
//   directorReply   → director.chat                              ✅（33 procedures 之一）
//   createIntent    → commander.createIntent（原 commander.plan 不存在；唯一 plan: 在 spiritRouter）
//                     commanderService.ts:createIntent(L80–105) 已內建 assertProjectOwnership ACL
//   getRun          → commander.getRun                           🔧
//   listRuns        → commander.listRunsByProject                🔧
//   breakdownScript → director.breakdown 待建（M3）。過渡：director.analyzeScriptOverview +
//                     director.generateVideoScript（原 generateVideoScriptFromBrief 不存在）。
//
// tRPC 邊界以 `client as any` 寬鬆化；介面強型別。
// ============================================================================
import type {
  AdapterDeps, CommanderAdapter, DirectorReplyInput, DirectorReply,
  CommanderPlan, ScriptBreakdown,
} from "./types";
import { AdapterError } from "./types";
import type { OrchestrationRun, OrchestrationStep } from "@/spine/types";
import { getTrpcClient } from "./trpcClient";

export function makeCommanderTrpc(_deps: AdapterDeps): CommanderAdapter {
  const client = getTrpcClient() as unknown as any;

  async function directorReply(input: DirectorReplyInput): Promise<DirectorReply> {
    try {
      // ✅ director.chat — CO-STAR 雙引擎 × RAG × 三人格（LLM 走伺服器端 OpenRouter→Claude）
      const r = await client.director.chat.mutate({
        persona: input.persona, message: input.message, projectId: input.projectId ?? undefined,
      });
      return {
        role: "ai",
        persona: input.persona,
        text: String(r?.text ?? r?.reply ?? r?.message ?? ""),
        agent: String(r?.agent ?? "director"),
      };
    } catch (err) {
      throw new AdapterError("directorReply failed", { seam: "commander", procedure: "director.chat", cause: err });
    }
  }

  function toSteps(raw: any): OrchestrationStep[] {
    const arr = raw?.steps ?? raw?.toolCalls ?? [];
    return (Array.isArray(arr) ? arr : []).map((s: any): OrchestrationStep => ({
      tool: String(s.tool ?? s.name ?? "step"),
      cost: Number(s.cost ?? s.costUsd ?? 0),
      note: String(s.note ?? s.summary ?? ""),
    }));
  }

  async function createIntent(input: { intent: string; projectId?: number | null }): Promise<CommanderPlan> {
    try {
      // 🔧 commander.createIntent（先計畫、按開始才動；已內建 ACL 守門）
      const r = await client.commander.createIntent.mutate({
        intent: input.intent, projectId: input.projectId ?? undefined,
      });
      const steps = toSteps(r);
      return {
        runId: r?.runId ?? r?.id,
        goal: String(r?.goal ?? input.intent),
        steps,
        totalCost: Number(r?.totalCost ?? steps.reduce((a, s) => a + s.cost, 0)),
      };
    } catch (err) {
      throw new AdapterError("createIntent failed", { seam: "commander", procedure: "commander.createIntent", cause: err });
    }
  }

  async function getRun(runId: string): Promise<OrchestrationRun | null> {
    try {
      const r = await client.commander.getRun.query({ runId });
      if (!r) return null;
      return {
        id: String(r.id ?? runId), intent: String(r.intent ?? ""), steps: toSteps(r),
        totalCost: Number(r.totalCost ?? 0), citations: r.citations ?? [], ts: String(r.ts ?? r.createdAt ?? ""),
      };
    } catch (err) {
      throw new AdapterError("getRun failed", { seam: "commander", procedure: "commander.getRun", cause: err });
    }
  }

  async function listRuns(projectId: number): Promise<OrchestrationRun[]> {
    try {
      const rows = await client.commander.listRunsByProject.query({ projectId });
      return (Array.isArray(rows) ? rows : rows?.items ?? []).map((r: any): OrchestrationRun => ({
        id: String(r.id), intent: String(r.intent ?? ""), steps: toSteps(r),
        totalCost: Number(r.totalCost ?? 0), citations: r.citations ?? [], ts: String(r.ts ?? r.createdAt ?? ""),
      }));
    } catch (err) {
      throw new AdapterError("listRuns failed", { seam: "commander", procedure: "commander.listRunsByProject", cause: err });
    }
  }

  async function breakdownScript(script: string, projectId?: number | null): Promise<ScriptBreakdown> {
    // 🔧 過渡組合：director.breakdown 待建（M3）。先用 analyzeScriptOverview + generateVideoScript。
    try {
      const overview = await client.director.analyzeScriptOverview.mutate({ script, projectId: projectId ?? undefined });
      const scripted = await client.director.generateVideoScript.mutate({
        script, overview, projectId: projectId ?? undefined,
      });
      const acts = (scripted?.acts ?? overview?.acts ?? []).map((a: any) => ({
        title: String(a.title ?? "幕"),
        shots: (a.shots ?? []).map((sh: any) => ({
          title: String(sh.title ?? ""),
          route: (sh.route === "ref" ? "ref" : "text") as "text" | "ref",
          characters: sh.characters ?? [],
          scene: String(sh.scene ?? ""),
        })),
      }));
      return {
        acts,
        characters: scripted?.characters ?? overview?.characters ?? [],
        scenes: scripted?.scenes ?? overview?.scenes ?? [],
      };
    } catch (err) {
      throw new AdapterError(
        "breakdownScript failed（過渡用 analyzeScriptOverview+generateVideoScript；正式 director.breakdown M3 待建）",
        { seam: "commander", procedure: "director.analyzeScriptOverview", cause: err },
      );
    }
  }

  return { directorReply, createIntent, getRun, listRuns, breakdownScript };
}
