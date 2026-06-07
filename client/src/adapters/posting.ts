// ============================================================================
// adapters/posting.ts — 第 6 條接縫組裝點（composition root；對齊 adapters/index.ts）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §6.2。
//
// 【P5 預設：mock】發佈通道是 /social 唯一無現況實作的能力，故與前五接縫相反——
//   預設 mock（零金鑰可演整條排程→發佈→permalink）。要接真實：
//     VITE_POSTING_PROVIDER = mock | postiz     （預設 mock）
//   接 Postiz 時實作 makePostingPostiz()（呼叫 Postiz API/MCP），只翻旗標，UI 不改。
//
// 【誠實標示缺口】postiz 尚未接線：選 postiz 時回一個「未配置」provider，呼叫即丟清楚
//   錯誤（不假裝可用），對齊 P0 AdapterPendingError 的精神。
// ============================================================================
import type { PostingProvider, PostingDeps, PostingRegistry, PublishReq, ExternalRef } from "./posting.types";
import { makePostingMock } from "./posting.mock";

function readMode(): "mock" | "postiz" {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    const v = env?.["VITE_POSTING_PROVIDER"];
    if (typeof v === "string" && v.trim().toLowerCase() === "postiz") return "postiz";
  } catch {
    /* import.meta 不可用 → 預設 mock */
  }
  return "mock";
}

/** postiz 佔位：尚未接線；任何呼叫都誠實丟錯（不靜默假成功）。 */
function makePostingPostizStub(): PostingProvider {
  const notWired = (proc: string): never => {
    throw new Error(
      `POSTING_PROVIDER=postiz 尚未接線（${proc}）。需 Postiz token 與 PostizPostingAdapter；` +
        `目前請用 VITE_POSTING_PROVIDER=mock 演練，或手動下載多尺寸包發佈。`,
    );
  };
  return {
    async publish(_req: PublishReq) {
      return notWired("publish");
    },
    async getStatus(_ref: ExternalRef) {
      return notWired("getStatus");
    },
    async cancel(_ref: ExternalRef) {
      return notWired("cancel");
    },
  };
}

/** 依 env 組出第 6 條接縫。預設 mock；postiz 為待接 stub。 */
export function createPosting(deps: PostingDeps = {}): PostingRegistry {
  const mode = readMode();
  const posting = mode === "postiz" ? makePostingPostizStub() : makePostingMock(deps);
  return { posting, meta: { posting: mode } };
}
