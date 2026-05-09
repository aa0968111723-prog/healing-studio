/**
 * client/src/lib/proactiveSpiritEvents.ts
 *
 * 15 精靈：把 `ProactiveEventBus` 的事件接到 sonner toast，讓三位主動精靈
 * （財財 / 巧巧 / 守守）真的能在事件發生時跳出來「主動關心」。
 *
 * 流程：
 *   bus.publish("prompt_too_short", { ... })
 *     → 這支 listener 看 SPIRIT_PROACTIVE_TRIGGERS 找出該事件的 spirit + surface
 *     → 抓使用者偏好的 mutedSpirits，被靜音的精靈直接跳過
 *     → render fillTemplate(defaultPrompt, payload) 進 toast
 *
 * 在 React 元件樹的最外圈用 useProactiveSpiritEvents() mount 一次即可。
 */

import { useEffect } from "react";
import { toast } from "sonner";
import {
  SPIRIT_PROACTIVE_TRIGGERS,
  type ProactiveTriggerEvent,
} from "../../../shared/orb-agent-roles";
import { ProactiveEventBus, type ProactiveEventPayloads } from "./proactiveEventBus";
import { getSpiritVisual } from "./spiritsVisual";

/**
 * 把 SpiritProactiveTriggerSpec.defaultPrompt 裡的 `{token}` 替換成 payload 同名欄位。
 * 找不到的 token 留空字串（不要漏出原始 `{usedPct}` 給使用者看到）。
 */
function fillTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = payload[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Mount once at app root. 訂閱 SPIRIT_PROACTIVE_TRIGGERS 中所有事件，
 * 觸發時把對應精靈的訊息顯示為 toast / inline / blocking dialog。
 *
 * @param mutedSpirits 使用者偏好中的靜音精靈 id 列表 — 該位精靈的事件會直接跳過。
 * @param options
 *   - `enabled` (default true): when false, skip ALL subscriptions so the
 *     user gets zero proactive toasts. Honours the
 *     `orbProactiveSuggestions=false` preference end-to-end.
 *   - `favoriteSpirits`: spirits the user has starred. Their events are
 *     promoted from auto-dismiss `toast` to persistent `inline` so the
 *     user has time to respond — matches the AgentSettingsSheet copy
 *     that promised "ProactiveEventBus 優先通知".
 */
export function useProactiveSpiritEvents(
  mutedSpirits: string[] = [],
  options: { enabled?: boolean; favoriteSpirits?: string[] } = {}
): void {
  const enabled = options.enabled !== false;
  const favoriteSpirits = options.favoriteSpirits ?? [];
  useEffect(() => {
    if (!enabled) return;
    const mutedSet = new Set(mutedSpirits);
    const favoriteSet = new Set(favoriteSpirits);
    const unsubscribers: Array<() => void> = [];

    for (const trigger of SPIRIT_PROACTIVE_TRIGGERS) {
      if (mutedSet.has(trigger.spirit)) continue;
      const spirit = getSpiritVisual(trigger.spirit);
      if (!spirit) continue;
      const isFavorite = favoriteSet.has(trigger.spirit);

      const unsub = ProactiveEventBus.subscribe(
        trigger.event as ProactiveTriggerEvent,
        // 內部我們不知道哪個 event 對到哪個 payload，但 trigger.event ↔ trigger
        // 的對應在 SPIRIT_PROACTIVE_TRIGGERS 是固定的，所以 listener 收到的
        // payload 形狀一定能 fillTemplate。
        (payload: unknown) => {
          const message = fillTemplate(
            trigger.defaultPrompt,
            payload as Record<string, unknown>
          );
          const headline = `${spirit.emoji} ${spirit.nickname}`;

          // surface 對 toast lib 的對映：
          //   toast    → 一般 toast（auto-dismiss）— favorites 升級到 inline
          //   inline   → 持久 toast（只能手動關），讓使用者有時間反應
          //   blocking → 持久 toast + 額外用 console.warn 標 critical（短期作法；
          //              下一輪會換成 AlertDialog 真正擋住操作）
          if (trigger.surface === "blocking") {
            console.warn("[proactive_blocking]", trigger.event, payload);
            toast.warning(headline, { description: message, duration: Infinity });
          } else if (trigger.surface === "inline" || isFavorite) {
            // Favourite spirits: keep their notifications on screen until
            // explicitly dismissed even if the trigger spec only asked
            // for a fleeting toast.
            toast(headline, { description: message, duration: Infinity });
          } else {
            toast(headline, { description: message, duration: 8_000 });
          }
        }
      );
      unsubscribers.push(unsub);
    }

    return () => {
      for (const u of unsubscribers) u();
    };
    // Re-subscribe when the muted / favourite sets change. We stringify
    // the arrays so a fresh array literal with the same contents doesn't
    // cause a churn loop.
  }, [enabled, mutedSpirits.join("|"), favoriteSpirits.join("|")]);
}

// Re-export for convenience — 想直接 publish 的呼叫端只 import 這一個檔案就夠。
export { ProactiveEventBus };
export type { ProactiveEventPayloads };
