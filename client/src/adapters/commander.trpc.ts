// ============================================================================
// adapters/commander.trpc.ts — CommanderAdapter（真實 tRPC 版，預設）
// ----------------------------------------------------------------------------
// 🔧 GitNexus 校正（§D.2/§E，main HEAD 2888a36）：
//   directorReply   → director.chat                              ✅（33 procedures 之一）
//   createIntent    → commander.createIntent（原 commander.plan 不存在；唯一 plan: 在 spiritRouter）
//                     commanderService.ts:createIntent(L80–105) 已內建 assertProjectOwnership ACL
//   getRun          → commander.getRun                           🔧
//   listRuns        → commander.listRunsByProject                🔧
//   breakdownScript → director.importScript（AIDV-180 修復：原 analyzeScriptOverview 契約不符）
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
      //
      // AIDV-152：契約對齊。server director.chat 的 input schema 是
      // { messages: [{role,content}], saveToNotes, personality, projectId? }，
      // 而非舊的 { persona, message }。修正前送舊欄位會被 Zod 擋下，projectId
      // 永遠到不了 server，世界框架注入路徑形同死碼。此處把單則 message 包成
      // messages 陣列、persona 對映 personality（兩者皆 calm|creative|technical），
      // 並原樣帶上 active projectId（旗標 ENABLE_DIRECTOR_WORLD_CONTEXT 在
      // server 端 gate；旗標 OFF 時 projectId 純被忽略，零行為改變）。
      const r = await client.director.chat.mutate({
        messages: [{ role: "user", content: input.message }],
        saveToNotes: false,
        personality: input.persona,
        projectId: input.projectId ?? undefined,
      });
      // server 回傳 { research, script, personality }。對話文字取 research；
      // 舊的 text/reply/message 欄位保留向後相容（mock 或未來 shape 變動）。
      const r2 = r as Record<string, unknown> | null | undefined;
      const text =
        (typeof r2?.text === "string" && r2.text) ||
        (typeof r2?.reply === "string" && r2.reply) ||
        (typeof r2?.message === "string" && r2.message) ||
        (typeof r2?.research === "string" && r2.research) ||
        "";
      return {
        role: "ai",
        persona: input.persona,
        text: String(text),
        agent: String(r2?.agent ?? "director"),
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
    // AIDV-180: 修復契約不符 (前端送 script string，analyzeScriptOverview 要 segments[])。
    // 改用 importScript 直接接受原始腳本字串，並將 ScriptSegment[] 對映成 ScriptBreakdown。
    try {
      const imported = await client.director.importScript.mutate({
        rawContent: script,
        title: "引導式腳本",
      });
      const segs: any[] = Array.isArray(imported?.segments) ? imported.segments : [];
      const shots = segs.map((seg: any, i: number) => ({
        title: String(seg?.storyboard?.sceneHeading || `鏡 ${i + 1}`),
        route: "text" as const,
        characters: Array.isArray(seg?.characters) ? seg.characters : [],
        scene: String(seg?.storyboard?.visualDescription ?? seg?.rawText ?? "").slice(0, 60),
      }));
      const allChars = Array.from(new Set(segs.flatMap((s: any) => Array.isArray(s?.characters) ? s.characters : [])));
      const allScenes = Array.from(new Set(segs.map((s: any) => String(s?.storyboard?.sceneHeading ?? "")).filter(Boolean)));
      return {
        acts: [{ title: String(imported?.title || "腳本"), shots }],
        characters: allChars,
        scenes: allScenes,
      };
    } catch (err) {
      throw new AdapterError(
        "breakdownScript failed",
        { seam: "commander", procedure: "director.importScript", cause: err },
      );
    }
  }

  return { directorReply, createIntent, getRun, listRuns, breakdownScript };
}
