/**
 * spiritRouter.ts — tRPC 端點：讓精靈真的去打 fal.ai 模型
 *
 * 對前端 / orb chat 暴露兩個動作：
 *   - spirit.listModels({ spirit })         — 列該精靈可用的所有 fal 模型
 *   - spirit.invoke({ spirit, modelId, … }) — 真實呼叫該精靈授權內的模型
 *
 * 授權雙保險：spiritDispatcher 內會檢查一次、dispatchFalTask 內再檢查一次；
 * 任一層 reject 都會回 FalDispatchResult { success: false, error }，不打 API、
 * 不扣點。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { invokeSpiritModel } from "../services/spiritDispatcher";
import { getFalModelsForSpirit } from "../services/falModels";
import {
  SPIRIT_FAMILY,
  getCategoriesForSpirit,
  type AgentRole,
} from "../../shared/orb-agent-roles";
import {
  planFromGoal,
  runPlan,
  getStatus as getPlanStatus,
  controlPlan,
  listRuns as listPlanRuns,
  replanOnFailure,
  executeStep as executePlanStep,
} from "../services/spiritTools/planExecutorTools";

// 從 SPIRIT_FAMILY 把 15 位精靈鍵抓出來做 zod enum，這樣未來新增/重命名
// 精靈時只需要動 shared/orb-agent-roles.ts。
const ALL_AGENT_ROLES = Object.keys(SPIRIT_FAMILY) as [AgentRole, ...AgentRole[]];
const agentRoleSchema = z.enum(ALL_AGENT_ROLES);

const invokeInputSchema = z.object({
  spirit: agentRoleSchema,
  /**
   * 省略時 server 會用 pickDefaultModelForSpirit 為該精靈挑一個 —— 給 orb
   * chat 這種使用者只 @ 精靈但沒選模型的路徑用。
   */
  modelId: z.string().min(1).optional(),
  prompt: z.string().optional(),
  imageUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
  audioUrl: z.string().url().optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().int().optional(),
  numInferenceSteps: z.number().int().positive().optional(),
  guidanceScale: z.number().positive().optional(),
  imageSize: z.string().optional(),
  aspectRatio: z.string().optional(),
  durationSec: z.number().positive().optional(),
  strength: z.number().min(0).max(1).optional(),
  loraUrl: z.string().url().optional(),
  loraScale: z.number().optional(),
  numFrames: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  voiceId: z.string().optional(),
  speed: z.number().positive().optional(),
  exaggeration: z.number().optional(),
  trainingSteps: z.number().int().positive().optional(),
  learningRate: z.number().positive().optional(),
  stylePrompt: z.string().optional(),
  charCount: z.number().int().nonnegative().optional(),
  modelParams: z.record(z.string(), z.unknown()).optional(),
});

export const spiritRouter = router({
  /**
   * 列該精靈所有可用 fal 模型。前端可用來呈現「圖圖能挑哪些圖模型」、
   * 「影影能挑哪些影模型」的下拉選單。
   */
  listModels: protectedProcedure
    .input(z.object({ spirit: agentRoleSchema }))
    .query(({ input }) => {
      const models = getFalModelsForSpirit(input.spirit).map(m => ({
        modelId: m.modelId,
        label: m.label,
        category: m.category,
        tier: m.tier,
        description: m.description,
      }));
      return {
        spirit: input.spirit,
        categories: getCategoriesForSpirit(input.spirit),
        models,
      };
    }),

  /**
   * 真的去打 fal.ai 模型。不在白名單內 → 直接回 success:false，不打 API。
   * 在白名單內 → 走 dispatchFalTask，含降級鏈、超時保護、LangSmith 追蹤、
   * 點數扣繳；回傳 FalDispatchResult。
   *
   * 之所以做成 mutation：真實 API 會扣點 / 產生不可逆內容（生成圖片影片）。
   */
  invoke: protectedProcedure
    .input(invokeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await invokeSpiritModel({
        ...input,
        userId: ctx.user.id,
      });
      return result;
    }),

  // ────────────────────────────────────────────────────────────────────────
  // 步步（plan-executor）的 agent 端點：規劃 + 執行 + 控制 + 修補
  //
  // 對前端 GlobalOrbChat 暴露五個 mutation / query：
  //   - plan        : 把使用者自然語言 goal 餵給 agentPlanner，回傳預演卡
  //   - run         : 啟動已建立的 plan（非同步，立刻回 status）
  //   - status      : 查詢 plan / 每步進度，給 UI 輪詢用
  //   - control     : pause / resume / cancel
  //   - replan      : 失敗後用 LLM 重排剩餘步驟
  //   - listRuns    : 列使用者近期 plan
  //   - runStep     : 單獨跑指定步（debug / step-by-step UI）
  //
  // 這些端點刻意做成 protectedProcedure — plan 是「真的會花點數 / 動工具」
  // 的入口，沒登入不該存取。
  // ────────────────────────────────────────────────────────────────────────

  plan: protectedProcedure
    .input(
      z.object({
        goal: z.string().min(2).max(2000),
        context: z.string().max(2000).optional(),
        maxSteps: z.number().int().positive().max(40).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return planFromGoal({
        userId: ctx.user.id,
        userRole: "user",
        goal: input.goal,
        context: input.context,
        maxSteps: input.maxSteps,
      });
    }),

  run: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        async: z.boolean().optional(),
        /**
         * Explicit user acknowledgement that high-risk steps may execute.
         * Without this, plans containing risk:high / requiresHuman:true tools
         * park at "awaiting_approval" instead of dispatching — see the P1
         * review on PR #642.
         */
        approveHighRisk: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return runPlan({
        userId: ctx.user.id,
        planId: input.planId,
        async: input.async,
        approveHighRisk: input.approveHighRisk,
      });
    }),

  status: protectedProcedure
    .input(z.object({ planId: z.string().min(1) }))
    .query(({ input, ctx }) => {
      return getPlanStatus({ userId: ctx.user.id, planId: input.planId });
    }),

  control: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        action: z.enum(["pause", "resume", "cancel"]),
      })
    )
    .mutation(({ input, ctx }) => {
      return controlPlan({
        userId: ctx.user.id,
        planId: input.planId,
        action: input.action,
      });
    }),

  replan: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        hint: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return replanOnFailure({
        userId: ctx.user.id,
        userRole: "user",
        planId: input.planId,
        hint: input.hint,
      });
    }),

  listRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).optional() }))
    .query(({ input, ctx }) => {
      return listPlanRuns({ userId: ctx.user.id, limit: input.limit });
    }),

  runStep: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        stepIndex: z.number().int().nonnegative().optional(),
        stepId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return executePlanStep({
        userId: ctx.user.id,
        planId: input.planId,
        stepIndex: input.stepIndex,
        stepId: input.stepId,
      });
    }),
});
