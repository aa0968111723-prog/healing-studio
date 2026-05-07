/**
 * orbProxyRouter.ts — 全站光球代理新增能力的 tRPC 端點。
 *
 * 目前只暴露 `unifiedSearch`：把使用者一句話「找我之前做的森林圖／我的筆記
 * 提到 X／教學文件 Y」變成跨資產／筆記／生成歷史／學習中心的單一查詢，
 * 回傳一份可直接渲染為跳轉卡片的清單。
 *
 * 端點故意保留為 protectedProcedure，因為跨表搜尋會曝露使用者私人資產。
 * 學習中心是公開內容，但與私資料同行為一致路徑（要求登入）較清楚。
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { orbUnifiedSearch } from "../services/orbUnifiedSearch";

const SEARCH_KIND_SCHEMA = z.enum(["asset", "note", "history", "tutorial"]);

export const orbProxyRouter = router({
  unifiedSearch: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        types: z.array(SEARCH_KIND_SCHEMA).max(4).optional(),
        perTypeLimit: z.number().int().min(1).max(10).optional(),
        totalLimit: z.number().int().min(1).max(20).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const items = await orbUnifiedSearch({
        userId: ctx.user.id,
        query: input.query,
        types: input.types,
        perTypeLimit: input.perTypeLimit,
        totalLimit: input.totalLimit,
      });
      return {
        query: input.query,
        items,
        countByKind: items.reduce<Record<string, number>>((acc, it) => {
          acc[it.kind] = (acc[it.kind] ?? 0) + 1;
          return acc;
        }, {}),
      };
    }),
});

export type OrbProxyRouter = typeof orbProxyRouter;
