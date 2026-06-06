// ============================================================================
// social/usePosting.ts — 取得第 6 條接縫（PostingProvider）的 React 入口
// ----------------------------------------------------------------------------
// 把 createPosting() memo 成 hook，並把 SpineProvider 的 provider/faults 餵進去（故障
// 注入可演發佈限流）。不修改 SpineProvider（純加法）；adapters 層保持無框架依賴。
// ============================================================================
import { useMemo } from "react";
import { useSpine } from "@/providers/SpineProvider";
import { createPosting } from "@/adapters/posting";
import type { PostingRegistry } from "@/adapters/posting.types";

export function usePosting(): PostingRegistry {
  const spine = useSpine();
  // 只建一次；getProvider/getFaults 以閉包讀 spine 當下值（與 P0 adapters 同模式）。
  return useMemo(
    () => createPosting({ getProvider: () => spine.provider, getFaults: () => spine.faults }),
    // spine 物件每 render 變動，但我們只要建一次；故意空依賴並用 getter 讀最新值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
