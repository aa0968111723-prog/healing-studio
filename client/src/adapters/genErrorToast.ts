// ============================================================================
// adapters/genErrorToast.ts — 生成錯誤的單一 toast 契約（AIDV-160 後續修補）
// ----------------------------------------------------------------------------
// 問題：成本守門中止（cost-blocked）時，generation adapter 會先 emit 一個
//   `cost-blocked` 事件（caller 在事件處理器裡顯示**友善**的
//   「免費引擎暫時無法使用 · 未扣點」toast），接著 reject 一個
//   AdapterCostBlockedError。若 caller 的 outer try/catch 又無差別地 fire 一個
//   通用「生成失敗」toast，使用者會看到「兩個」堆疊的錯誤 toast，且第二個帶
//   「硬失敗」語氣（全部 provider 皆失敗），與 types.ts 對 AdapterCostBlockedError
//   承諾的「冷靜地請改選其他引擎」UX 互相矛盾。
//
// 解法（單一真相源）：所有呼叫 generation.generate(...) 的 UI，在 catch 區塊開頭
//   先用 `isCostBlockedError(err)` 判斷；若為 cost-blocked 則**不**再 fire 通用
//   失敗 toast（友善 toast 已在事件處理器顯示過），只設定 idle/error 狀態並 return。
//   確保 cost-blocked 情境**恰好一個、冷靜措辭**的 toast。
//
// 把判斷集中在這裡（而非三處各自 `instanceof`），避免三個 caller 的邏輯日後漂移。
// ============================================================================
import { AdapterCostBlockedError } from "./types";

/**
 * 是否為「成本守門中止」錯誤（免費引擎不可用、守門不無聲跨界扣付費點而中止）。
 *
 * caller 用法：
 * ```ts
 * } catch (err) {
 *   if (isCostBlockedError(err)) {
 *     setStatus("idle"); // 不是硬失敗；友善 cost-blocked toast 已於事件處理器顯示
 *     return;            // 不再 fire 通用「生成失敗」toast → 恰好一個 toast
 *   }
 *   setStatus("error");
 *   toast.error("生成失敗", { ... });
 * }
 * ```
 *
 * 用 `instanceof` 為主、`name` 為輔——跨 bundle/HMR 邊界時 instanceof 偶失準，
 * 以類別名再保險一層（fail 方向仍是「視為 cost-blocked → 抑制第二個 toast」，
 * 最壞情況只是少一個通用 toast，不會多扣點、也不會誤吞真正的硬失敗 toast，
 * 因為僅當錯誤確實由 AdapterCostBlockedError 構造時 name 才會等於此值）。
 */
export function isCostBlockedError(err: unknown): err is AdapterCostBlockedError {
  return (
    err instanceof AdapterCostBlockedError ||
    (err instanceof Error && err.name === "AdapterCostBlockedError")
  );
}
