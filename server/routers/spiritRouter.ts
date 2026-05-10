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

// 從 SPIRIT_FAMILY 把 15 位精靈鍵抓出來做 zod enum，這樣未來新增/重命名
// 精靈時只需要動 shared/orb-agent-roles.ts。
const ALL_AGENT_ROLES = Object.keys(SPIRIT_FAMILY) as [AgentRole, ...AgentRole[]];
const agentRoleSchema = z.enum(ALL_AGENT_ROLES);

const invokeInputSchema = z.object({
  spirit: agentRoleSchema,
  modelId: z.string().min(1, "modelId 不能為空"),
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
});
