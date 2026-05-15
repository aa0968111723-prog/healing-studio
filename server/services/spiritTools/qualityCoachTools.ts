/**
 * server/services/spiritTools/qualityCoachTools.ts
 *
 * 巧巧 (quality-coach) 的真實工具集 — 把「主動提示詞改寫教練」從
 * 「system prompt 嘴砲 + 客戶端 char Jaccard 啟發式」升級成「會呼叫
 * 真正的 shared/qualityCoachEngine 拿確定性診斷的 AI agent」。
 *
 * 之前的問題：
 *   - shared/agent-skills.ts:194 寫 tools=[] → 巧巧沒有任何後端工具
 *   - 巧巧 system prompt 寫的「公式 7 維度」沒對應 server 端事實，LLM
 *     會自己編出「主體+動作+場景…」沒辦法 cross-check 真的有沒有缺
 *   - 客戶端的 detectStrugglingPrompt 用字元 Jaccard 對中文偏誤大，
 *     建議又是硬寫死的「午後光線, 35mm 淺景深」對 video / music / voice
 *     完全不適用
 *
 * 本檔提供四個工具，全部走純函式（不寫 DB、不打 LLM）：
 *   ① qualityCoach.diagnose(prompt, modality?)    — 7 維度命中 + 0-100 分 + issues
 *   ② qualityCoach.rewrite(prompt, opts)           — 補齊缺失維度的可貼版本
 *   ③ qualityCoach.compare(promptA, promptB)       — 兩條 prompt A/B 比較
 *   ④ qualityCoach.getTemplates(modality, style?)  — 該模態的照樣造句模板
 */

import {
  comparePrompts,
  detectModality,
  getTemplates,
  PROMPT_DIMENSIONS,
  rewritePrompt,
  scorePrompt,
  type CompareResult,
  type PromptDiagnosis,
  type PromptDimension,
  type QualityModality,
  type RewriteResult,
  type TemplateSpec,
} from "../../../shared/qualityCoachEngine";

// ─── Validation ──────────────────────────────────────────────────────────

const MODALITY_VALUES: ReadonlyArray<QualityModality> = [
  "image",
  "video",
  "music",
  "voice",
  "general",
];

function coerceModality(
  raw: unknown,
  fallback: () => QualityModality,
): QualityModality {
  if (typeof raw === "string") {
    const lower = raw.toLowerCase() as QualityModality;
    if ((MODALITY_VALUES as ReadonlyArray<string>).includes(lower)) return lower;
  }
  return fallback();
}

function coerceDimensions(
  raw: unknown,
): ReadonlyArray<PromptDimension> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid = new Set(PROMPT_DIMENSIONS as ReadonlyArray<string>);
  const out: PromptDimension[] = [];
  for (const v of raw) {
    if (typeof v === "string" && valid.has(v)) out.push(v as PromptDimension);
  }
  return out.length > 0 ? out : undefined;
}

// ─── Tool: diagnose ──────────────────────────────────────────────────────

export interface DiagnoseInput {
  prompt: string;
  modality?: QualityModality;
}

export interface DiagnoseResult extends PromptDiagnosis {
  /** 給 LLM 的一句話總結，便於直接回給使用者 */
  oneLineSummary: string;
}

/**
 * 診斷 prompt 品質。回傳 7 維度命中 + 0-100 分 + 缺哪幾個維度 + 一條
 * next-step 建議。LLM 拿到後可以直接照講，不需要自己再算。
 */
export function diagnose(input: DiagnoseInput): DiagnoseResult {
  const prompt = (input.prompt ?? "").toString().trim();
  if (!prompt) {
    return {
      modality: input.modality ?? "general",
      dimensions: [],
      score: 0,
      missingDimensions: [],
      presentDimensions: [],
      issues: ["prompt 是空的"],
      nextStepSuggestion: "丟一段你的草稿給我，至少幾個字也好。",
      stats: {
        length: 0,
        wordCount: 0,
        hasMixedScript: false,
        qualityWordOverload: false,
      },
      oneLineSummary: "空 prompt — 還沒東西可看，請貼草稿。",
    };
  }
  const modality = input.modality ?? detectModality(prompt);
  const diag = scorePrompt(prompt, modality);
  const oneLineSummary = (() => {
    if (diag.score >= 80) return `這條 prompt ${diag.score} 分，覆蓋面已經很好，可以送出試試。`;
    if (diag.score >= 60) return `這條 prompt ${diag.score} 分（${diag.modality}）。${diag.nextStepSuggestion}`;
    if (diag.score >= 30) return `這條 prompt 只有 ${diag.score} 分 — ${diag.issues[0] ?? "覆蓋不夠"}。${diag.nextStepSuggestion}`;
    return `這條 prompt 才 ${diag.score} 分，模型很難猜到你想要的。${diag.nextStepSuggestion}`;
  })();
  return { ...diag, oneLineSummary };
}

// ─── Tool: rewrite ───────────────────────────────────────────────────────

export interface RewriteInput {
  prompt: string;
  modality?: QualityModality;
  /** 只補這些維度（不傳則補齊全部缺失） */
  onlyFillDimensions?: ReadonlyArray<PromptDimension>;
  /** 風格提示（保留欄位，目前透傳到 RewriteResult.explanation） */
  style?: string;
  /** 是否同時回診斷（預設 true，給 LLM 用一次 tool call 拿完整資料） */
  includeDiagnosis?: boolean;
}

export interface RewriteResultWithDiag extends RewriteResult {
  diagnosis?: PromptDiagnosis;
}

/**
 * 把缺的維度補上，回傳可直接貼到輸入框的 rewritten prompt。
 * 不會改動使用者原有的字 — 只在尾端追加缺的維度片段。
 */
export function rewrite(input: RewriteInput): RewriteResultWithDiag {
  const prompt = (input.prompt ?? "").toString();
  const modality = input.modality ?? detectModality(prompt);
  const rw = rewritePrompt(prompt, {
    modality,
    onlyFillDimensions: input.onlyFillDimensions,
    style: input.style,
  });
  const includeDiag = input.includeDiagnosis !== false;
  return {
    ...rw,
    diagnosis: includeDiag ? scorePrompt(prompt, modality) : undefined,
  };
}

// ─── Tool: compare ───────────────────────────────────────────────────────

export interface CompareInput {
  promptA: string;
  promptB: string;
  modality?: QualityModality;
}

export type CompareToolResult = CompareResult;

/**
 * 對兩條 prompt 做 A/B 比較 — 用於使用者「我這版改完比上一版好嗎？」場景。
 * LLM 拿到 winner + gained/lost dimensions + summary 就能直接回答。
 */
export function compare(input: CompareInput): CompareToolResult {
  const promptA = (input.promptA ?? "").toString();
  const promptB = (input.promptB ?? "").toString();
  return comparePrompts(promptA, promptB, input.modality);
}

// ─── Tool: getTemplates ──────────────────────────────────────────────────

export interface GetTemplatesInput {
  modality: QualityModality;
  /** 可選風格篩選 — 不命中時 fallback 回該模態全部模板 */
  styleHint?: string;
}

export interface GetTemplatesResult {
  modality: QualityModality;
  count: number;
  templates: ReadonlyArray<TemplateSpec>;
}

/**
 * 列該模態的「照樣造句」模板。LLM 在使用者問「給我一個模板」「我不知道怎麼寫」
 * 時拿來丟給使用者。
 */
export function getTemplatesTool(input: GetTemplatesInput): GetTemplatesResult {
  const modality = input.modality;
  const list = getTemplates(modality, input.styleHint);
  return {
    modality,
    count: list.length,
    templates: list,
  };
}

// ─── Dispatcher 邊界 helper (給 agentToolExecutor) ────────────────────────

export type QualityCoachToolName =
  | "qualityCoach.diagnose"
  | "qualityCoach.rewrite"
  | "qualityCoach.compare"
  | "qualityCoach.getTemplates";

export interface QualityCoachCall {
  name: QualityCoachToolName;
  args: Record<string, unknown>;
}

export interface QualityCoachResponse {
  name: QualityCoachToolName;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * 純函式 dispatcher — 把 args 從 unknown 強制成正確型別後丟給對應工具。
 * agentToolExecutor 會在這層之上補上 usedTool / 錯誤包裝。
 */
export function dispatchQualityCoach(call: QualityCoachCall): QualityCoachResponse {
  try {
    const args = call.args ?? {};
    switch (call.name) {
      case "qualityCoach.diagnose": {
        const prompt = typeof args.prompt === "string" ? args.prompt : "";
        if (!prompt.trim()) {
          return { name: call.name, ok: false, error: "prompt is required" };
        }
        const modality = coerceModality(args.modality, () => detectModality(prompt));
        return {
          name: call.name,
          ok: true,
          data: diagnose({ prompt, modality }),
        };
      }
      case "qualityCoach.rewrite": {
        const prompt = typeof args.prompt === "string" ? args.prompt : "";
        if (!prompt.trim()) {
          return { name: call.name, ok: false, error: "prompt is required" };
        }
        const modality = coerceModality(args.modality, () => detectModality(prompt));
        return {
          name: call.name,
          ok: true,
          data: rewrite({
            prompt,
            modality,
            onlyFillDimensions: coerceDimensions(args.onlyFillDimensions),
            style: typeof args.style === "string" ? args.style : undefined,
            includeDiagnosis: args.includeDiagnosis !== false,
          }),
        };
      }
      case "qualityCoach.compare": {
        const promptA = typeof args.promptA === "string" ? args.promptA : "";
        const promptB = typeof args.promptB === "string" ? args.promptB : "";
        if (!promptA.trim() || !promptB.trim()) {
          return {
            name: call.name,
            ok: false,
            error: "promptA and promptB are required",
          };
        }
        const modality = coerceModality(args.modality, () =>
          detectModality(promptA + "\n" + promptB),
        );
        return {
          name: call.name,
          ok: true,
          data: compare({ promptA, promptB, modality }),
        };
      }
      case "qualityCoach.getTemplates": {
        const modality = coerceModality(args.modality, () => "image");
        const styleHint =
          typeof args.styleHint === "string" ? args.styleHint : undefined;
        return {
          name: call.name,
          ok: true,
          data: getTemplatesTool({ modality, styleHint }),
        };
      }
      default: {
        const exhaustive: never = call.name;
        return {
          name: exhaustive,
          ok: false,
          error: `unknown qualityCoach tool: ${String(call.name)}`,
        };
      }
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
