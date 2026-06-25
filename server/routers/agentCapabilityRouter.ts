/**
 * agentCapabilityRouter.ts — AIDV-323 多代理路由基礎層
 *
 * 收斂 AIDV-317（路由盲派）：提供動態代理能力登記 API，
 * 解決「任務無法依專長/負載最佳派工」問題。
 *
 * 端點：
 *   register    — 代理上線登記 capabilities + costPerToken
 *   heartbeat   — 心跳更新 currentLoad（0–1）
 *   assign      — 依 capability match + load 最低選派代理
 *   listActive  — 列出所有活躍代理（管理/除錯用）
 */

import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { getDb } from "../db";
import { agentDynamicRegistry } from "../../drizzle/schema";

const capabilitySchema = z.array(z.string().min(1).max(64)).min(1).max(32);

export const agentCapabilityRouter = router({
  /**
   * 代理上線登記：首次上線或更新 capabilities + costPerToken。
   * 使用 upsert — agentId 已存在時更新，不存在時新建。
   */
  register: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1).max(64),
        capabilities: capabilitySchema,
        costPerToken: z.number().min(0).max(1).default(0),
        /** Agent Scope allowlist（AIDV-331）：此代理被允許執行的 endpoint scope */
        allowedEndpoints: z.array(z.string().min(1).max(64)).max(64).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });
      }

      await db
        .insert(agentDynamicRegistry)
        .values({
          agentId: input.agentId,
          capabilities: input.capabilities,
          allowedEndpoints: input.allowedEndpoints ?? null,
          costPerToken: String(input.costPerToken),
          currentLoad: "0",
          isActive: true,
        })
        .onDuplicateKeyUpdate({
          set: {
            capabilities: input.capabilities,
            allowedEndpoints: input.allowedEndpoints ?? null,
            costPerToken: String(input.costPerToken),
            isActive: true,
            lastHeartbeatAt: sql`NOW()`,
          },
        });

      logger.info("agent_registered", { agentId: input.agentId, capabilities: input.capabilities });

      return { success: true, agentId: input.agentId };
    }),

  /**
   * 心跳更新：代理定期回報當前負載（0=空閒，1=滿載）。
   * 超過 5 分鐘未心跳的代理視為離線，assign 不會選派。
   */
  heartbeat: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1).max(64),
        currentLoad: z.number().min(0).max(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });
      }

      const result = await db
        .update(agentDynamicRegistry)
        .set({
          currentLoad: String(input.currentLoad),
          isActive: true,
          lastHeartbeatAt: sql`NOW()`,
        })
        .where(eq(agentDynamicRegistry.agentId, input.agentId));

      if ((result[0] as { affectedRows?: number }).affectedRows === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `代理 ${input.agentId} 未登記，請先呼叫 register`,
        });
      }

      return { success: true, agentId: input.agentId, currentLoad: input.currentLoad };
    }),

  /**
   * 任務派工：根據 requiredCapabilities 篩選活躍代理，
   * 從符合的代理中選 currentLoad 最低者回傳。
   * 5 分鐘內無心跳的代理視為離線不參選。
   */
  assign: protectedProcedure
    .input(
      z.object({
        taskType: z.string().min(1).max(64),
        requiredCapabilities: capabilitySchema,
        /** Agent Scope（AIDV-331）：呼叫端宣告此任務需要哪些 scope */
        requiredScope: z.array(z.string().min(1).max(64)).max(16).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });
      }

      // X-Agent-Priority header → priority hint（AIDV-331 Priority Queue）
      const rawPriority = (ctx.req.headers["x-agent-priority"] as string | undefined)
        ?.toLowerCase()
        .trim();
      const priority =
        rawPriority === "urgent" || rawPriority === "normal" || rawPriority === "background"
          ? rawPriority
          : "normal";

      // 取出 5 分鐘內有心跳的活躍代理（上限 100 筆，負載排序）
      const candidates = await db
        .select()
        .from(agentDynamicRegistry)
        .where(
          and(
            eq(agentDynamicRegistry.isActive, true),
            sql`${agentDynamicRegistry.lastHeartbeatAt} >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)`
          )
        )
        .orderBy(agentDynamicRegistry.currentLoad)
        .limit(100);

      // 在應用層過 capability match + scope 驗證（避免複雜 JSON 查詢）
      const matched = candidates.filter(agent => {
        const caps = agent.capabilities as string[];
        if (!input.requiredCapabilities.every(req => caps.includes(req))) return false;
        // Agent Scope 守門：若任務有 requiredScope，代理的 allowedEndpoints 必須全包含
        if (input.requiredScope && input.requiredScope.length > 0) {
          const allowed = (agent.allowedEndpoints as string[] | null) ?? [];
          if (!input.requiredScope.every(s => allowed.includes(s))) return false;
        }
        return true;
      });

      if (matched.length === 0) {
        const scopeMsg =
          input.requiredScope && input.requiredScope.length > 0
            ? `; scope [${input.requiredScope.join(", ")}] 未被授權`
            : "";
        return {
          agentId: null,
          reason: `無符合 capabilities [${input.requiredCapabilities.join(", ")}]${scopeMsg} 的活躍代理`,
        };
      }

      const best = matched[0]!;
      logger.info("agent_assigned", {
        taskType: input.taskType,
        agentId: best.agentId,
        currentLoad: best.currentLoad,
        priority,
        candidates: matched.length,
      });

      return {
        agentId: best.agentId,
        currentLoad: Number(best.currentLoad),
        capabilities: best.capabilities as string[],
        costPerToken: Number(best.costPerToken),
        priority,
        allowedEndpoints: (best.allowedEndpoints as string[] | null) ?? [],
      };
    }),

  /**
   * 列出活躍代理（管理/除錯用）。
   */
  listActive: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { agents: [] };

    const agents = await db
      .select({
        agentId: agentDynamicRegistry.agentId,
        capabilities: agentDynamicRegistry.capabilities,
        currentLoad: agentDynamicRegistry.currentLoad,
        costPerToken: agentDynamicRegistry.costPerToken,
        lastHeartbeatAt: agentDynamicRegistry.lastHeartbeatAt,
      })
      .from(agentDynamicRegistry)
      .where(eq(agentDynamicRegistry.isActive, true))
      .orderBy(agentDynamicRegistry.currentLoad)
      .limit(50);

    return {
      agents: agents.map(a => ({
        agentId: a.agentId,
        capabilities: a.capabilities as string[],
        currentLoad: Number(a.currentLoad),
        costPerToken: Number(a.costPerToken),
        lastHeartbeatAt: a.lastHeartbeatAt,
      })),
    };
  }),
});
