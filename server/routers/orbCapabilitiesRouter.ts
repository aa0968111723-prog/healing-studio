/**
 * orbCapabilitiesRouter.ts — 全站光球能力探索 API
 *
 * 暴露 manifest-driven 的能力清單給前端、debug 工具或外部整合，無需 server
 * restart：只要 `shared/appRegistry.ts` 增刪條目就會即時反映。
 *
 * 對應「需求 2 — 自動偵測全站更新」：頁面新增後光球能立即知道存在哪些新工具/
 * 路由，不需要硬編碼。前端 UI 也可以用這支 endpoint 動態生成 onboarding 卡。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  serializeRegistryForSiteKnowledge,
  type SerializableAppRegistryItem,
} from "../../shared/appRegistry";
import {
  getImageEditModelCatalog,
  suggestImageEditModelsByPrompt,
} from "../services/orbModelCatalog";

export interface OrbCapabilitiesPayload {
  /** appRegistry 全部條目（含路徑、別名、quickActions、orbHints） */
  pages: SerializableAppRegistryItem[];
  /** Manifest 產生時間，前端可用來判斷是否需要重抓 */
  generatedAt: number;
  /** Manifest 條目數量，便於 UI 顯示「目前光球能掌握 X 個頁面」 */
  pageCount: number;
  imageEditModelCount: number;
}

export const orbCapabilitiesRouter = router({
  /**
   * GET /trpc/orbCapabilities.list
   * 登入查詢:回傳全站可被光球代理操作的頁面清單。
   *
   * H1 修復:從 publicProcedure 改 protectedProcedure。原本未登入者也能拿到全站
   * 頁面 manifest(path / aliases / orbHints / quickActions),等於把站內地圖
   * 白送給爬蟲。確認過 client 與 server 都沒人呼叫(0 callers),改 protected
   * 對既有功能零影響;若未來真有公開需求,移回 publicProcedure 即可。
   *
   * 不接收任何輸入,純讀 manifest。前端可長 cache,並在管理後台「掃描頁面」
   * 操作後重抓。
   */
  list: protectedProcedure.query((): OrbCapabilitiesPayload => {
    const pages = serializeRegistryForSiteKnowledge();
    const imageEditModels = getImageEditModelCatalog();
    return {
      pages,
      generatedAt: Date.now(),
      pageCount: pages.length,
      imageEditModelCount: imageEditModels.length,
    };
  }),

  /**
   * 根據使用者提示詞推測「圖片編輯」模型建議順序。
   * H1 同上,從 public 改 protected,避免未登入者用任意 prompt 燒 keyword 比對。
   */
  suggestImageEditModels: protectedProcedure
    .input(z.object({ prompt: z.string().min(1) }))
    .query(({ input }) => ({
      prompt: input.prompt,
      models: suggestImageEditModelsByPrompt(input.prompt),
    })),

});
