/**
 * ProactiveNotificationCenter.tsx — 主動精靈（財財 / 巧巧 / 守守）的通知中心。
 *
 * 取代原本由 sonner toast 直接呈現的 inline / blocking 事件，改成「使用者要打
 * 勾才會消失」的卡片堆疊。同時尊重使用者偏好：
 *   1. mutedSpirits → 該位精靈所有事件直接吞掉
 *   2. proactiveTriggerSettings[event].enabled = false → 單一事件關掉
 *   3. proactiveTriggerSettings[event].minIntervalMs → 同事件兩次顯現的最短間隔
 *   4. proactiveTriggerSettings[event].requireAck → 是否需要打勾才消失
 *
 * surface 路由策略：
 *   - blocking → 一律進中心（卡片）+ 必須打勾，無視 requireAck
 *   - inline   → 進中心；requireAck=false 時自動關（保留 sonner-style 行為）
 *   - toast    → 預設仍走 sonner（短期 8s 自動消失）；requireAck=true 時也升級
 *                 進中心，讓使用者完全控制
 *
 * Mount 一次在 DashboardLayout 即可；元件本身既訂閱 bus 也渲染卡片。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import {
  SPIRIT_PROACTIVE_TRIGGERS,
  type ProactiveTriggerEvent,
} from "@shared/orb-agent-roles";
import {
  resolveProactiveTriggerSettings,
  type ProactiveTriggerSettingsMap,
} from "@shared/agent-preferences";
import { ProactiveEventBus } from "./proactiveEventBus";
import { getSpiritVisual } from "./spiritsVisual";

interface QueuedNotification {
  id: string;
  event: ProactiveTriggerEvent;
  spiritRole: string;
  emoji: string;
  nickname: string;
  gradient: string;
  message: string;
  surface: "toast" | "inline" | "blocking";
  requireAck: boolean;
  createdAt: number;
  /**
   * Optional CTA button rendered next to the ack button. Used by events
   * that imply an action the user might want to take inline (e.g.
   * `context_near_full` → 「開新對話」). Pressing the action also
   * acknowledges the card.
   */
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ProactiveNotificationCenterProps {
  /** 使用者偏好中的靜音精靈 id 列表 — 該位精靈的事件會直接跳過。 */
  mutedSpirits: string[];
  /** 使用者偏好中的 per-event 設定。 */
  triggerSettings: ProactiveTriggerSettingsMap;
  /**
   * 全域 kill-switch — 對應 `agentPreferences.orbProactiveSuggestions`。false
   * 時整個中心不訂閱任何事件，不論 per-event setting 如何。Defaults to true
   * so callers that don't yet pass the prop keep the legacy behaviour.
   */
  globallyEnabled?: boolean;
  /**
   * 使用者收藏的精靈 id（`agentPreferences.favoriteSpirits`）。被收藏的精靈
   * 觸發事件時，原本 `surface: "toast"` 的 8s 自動消失會升級為 ack 卡片，
   * 確保使用者有時間反應。Muted spirits 仍直接跳過。
   */
  favoriteSpirits?: string[];
  /**
   * Optional per-event CTA buttons. Keyed by ProactiveTriggerEvent id.
   * When the event surfaces a card, the card gets an extra button next
   * to the ack one with `label`; clicking calls `onClick(payload)` and
   * dismisses the card. Used for `context_near_full` → "開新對話" today.
   */
  eventActions?: Partial<
    Record<
      ProactiveTriggerEvent,
      { label: string; onClick: (payload: unknown) => void }
    >
  >;
}

/**
 * 把 SpiritProactiveTriggerSpec.defaultPrompt 裡的 `{token}` 替換成 payload 同名欄位。
 */
function fillTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = payload[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

export function ProactiveNotificationCenter({
  mutedSpirits,
  triggerSettings,
  globallyEnabled = true,
  favoriteSpirits = [],
  eventActions,
}: ProactiveNotificationCenterProps) {
  const [queue, setQueue] = useState<QueuedNotification[]>([]);
  const mutedSet = useMemo(() => new Set(mutedSpirits), [mutedSpirits]);
  const favoriteSet = useMemo(() => new Set(favoriteSpirits), [favoriteSpirits]);

  // Track per-event 上次顯示時間 — 配合 user-set minIntervalMs 做節流。state 而
  // 非 ref，使被 ack 後若使用者開短 interval，重新發新一筆能立即比對最新值。
  const [lastSurfaceAt, setLastSurfaceAt] = useState<Record<string, number>>({});

  // F2 fix: throttle gate compares against MAX(last-surfaced, last-dismissed).
  // Without tracking dismissals separately, a user who acks a card and gets
  // hit by the same event 3 seconds later would see a fresh card — bypassing
  // the per-event minIntervalMs they configured.
  const dismissedAtRef = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    setQueue(prev => {
      const target = prev.find(n => n.id === id);
      if (target) {
        dismissedAtRef.current[target.event] = Date.now();
      }
      return prev.filter(n => n.id !== id);
    });
  }, []);

  // F1 fix: when the global kill-switch flips off → on, the throttle window
  // should reset. Without this, a user who disables suggestions for 10 min
  // then re-enables them would see throttle history from 10 min ago and the
  // event might fire instantly on re-enable. Same teardown clears the
  // pending queue so a stale card doesn't outlive the disable period.
  useEffect(() => {
    if (!globallyEnabled) {
      setLastSurfaceAt({});
      dismissedAtRef.current = {};
      setQueue([]);
    }
  }, [globallyEnabled]);

  useEffect(() => {
    // 0) Global kill-switch (orbProactiveSuggestions=false) — 不訂閱任何事件。
    if (!globallyEnabled) return;
    const unsubscribers: Array<() => void> = [];

    for (const trigger of SPIRIT_PROACTIVE_TRIGGERS) {
      // 1) 先看 muted — 整位精靈被靜音直接跳過所有事件
      if (mutedSet.has(trigger.spirit)) continue;

      const spirit = getSpiritVisual(trigger.spirit);
      if (!spirit) continue;
      const isFavorite = favoriteSet.has(trigger.spirit);

      const unsub = ProactiveEventBus.subscribe(
        trigger.event as ProactiveTriggerEvent,
        (payload: unknown) => {
          // 2) Per-event setting — disabled 直接吞
          const settings = resolveProactiveTriggerSettings(
            trigger.event as ProactiveTriggerEvent,
            triggerSettings,
          );
          if (!settings.enabled) return;

          // 3) Per-event interval throttle (overrides bus 預設的 30s).
          //    Compare against the LATER of last-surfaced and last-dismissed
          //    so a user who dismissed a card 3s ago doesn't get the same
          //    event re-shown until minIntervalMs has elapsed since dismiss.
          const now = Date.now();
          const lastSurface = lastSurfaceAt[trigger.event] ?? 0;
          const lastDismiss = dismissedAtRef.current[trigger.event] ?? 0;
          const lastTouch = Math.max(lastSurface, lastDismiss);
          if (now - lastTouch < settings.minIntervalMs) return;

          const message = fillTemplate(
            trigger.defaultPrompt,
            payload as Record<string, unknown>,
          );

          // blocking 永遠進中心並強制 ack；其他 surface 看 requireAck。
          // 收藏的精靈（favoriteSpirits）強制升級到 ack 卡片，避免 8s toast
          // 沖過去使用者沒看到。
          const requireAck =
            trigger.surface === "blocking" || settings.requireAck || isFavorite;

          // toast surface + 不要 ack：保留原本 sonner 短期行為，不進中心。
          if (trigger.surface === "toast" && !requireAck) {
            const headline = `${spirit.emoji} ${spirit.nickname}`;
            toast(headline, { description: message, duration: 8_000 });
            setLastSurfaceAt(prev => ({ ...prev, [trigger.event]: now }));
            return;
          }

          const id = `${trigger.event}_${now}_${Math.random().toString(36).slice(2, 6)}`;
          // Bind the per-event CTA at queue-time. We snapshot the payload
          // so a stale event later in the queue still hits with the
          // values it was emitted with (not the most recent emission).
          const actionSpec = eventActions?.[trigger.event as ProactiveTriggerEvent];
          const cardAction = actionSpec
            ? {
                label: actionSpec.label,
                onClick: () => actionSpec.onClick(payload),
              }
            : undefined;
          setQueue(prev => {
            // 同一事件已在佇列中就不疊一張新的，避免 spam（使用者改設 interval=5s
            // 但事件源連發 5 次的場景）。
            if (prev.some(n => n.event === trigger.event)) return prev;
            return [
              ...prev,
              {
                id,
                event: trigger.event as ProactiveTriggerEvent,
                spiritRole: trigger.spirit,
                emoji: spirit.emoji,
                nickname: spirit.nickname,
                gradient: spirit.gradient,
                message,
                surface: trigger.surface,
                requireAck,
                createdAt: now,
                ...(cardAction ? { action: cardAction } : {}),
              },
            ];
          });
          setLastSurfaceAt(prev => ({ ...prev, [trigger.event]: now }));
        },
      );
      unsubscribers.push(unsub);
    }

    return () => {
      for (const u of unsubscribers) u();
    };
    // 把 mutedSet / favouriteSet / triggerSettings 換成穩定 hash 才不會每次
    // prefs 物件 re-create 都重訂閱 — listener 內每次拉最新值即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    globallyEnabled,
    mutedSpirits.join("|"),
    favoriteSpirits.join("|"),
    JSON.stringify(triggerSettings),
  ]);

  if (queue.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-[min(360px,calc(100vw-2rem))]"
      data-testid="proactive-notification-center"
    >
      {queue.map(n => (
        <ProactiveCard
          key={n.id}
          notification={n}
          onAck={() => dismiss(n.id)}
          onClose={n.requireAck ? null : () => dismiss(n.id)}
        />
      ))}
    </div>
  );
}

interface ProactiveCardProps {
  notification: QueuedNotification;
  onAck: () => void;
  /** 不需要 ack 的卡片才有 X close button；blocking 一定得打勾。 */
  onClose: (() => void) | null;
}

function ProactiveCard({ notification, onAck, onClose }: ProactiveCardProps) {
  const isBlocking = notification.surface === "blocking";
  return (
    <div
      role={isBlocking ? "alertdialog" : "status"}
      aria-live={isBlocking ? "assertive" : "polite"}
      className={`relative rounded-xl border shadow-lg backdrop-blur-md p-3 text-sm transition-all ${
        isBlocking
          ? "bg-rose-50/95 dark:bg-rose-950/80 border-rose-300 dark:border-rose-800"
          : "bg-white/95 dark:bg-slate-900/85 border-border/60"
      }`}
      data-testid={`proactive-card-${notification.event}`}
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-1 right-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          aria-label="關閉"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex items-start gap-2">
        <div
          className={`shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br ${notification.gradient} flex items-center justify-center text-base shadow-sm`}
        >
          {isBlocking ? (
            <AlertTriangle className="w-4.5 h-4.5 text-white" />
          ) : (
            <span className="text-white">{notification.emoji}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground">
            {notification.emoji} {notification.nickname}
            {isBlocking && (
              <span className="ml-1 text-[10px] uppercase font-mono text-rose-600 dark:text-rose-300">
                blocking
              </span>
            )}
          </div>
          <div className="mt-0.5 text-foreground/90 leading-snug whitespace-pre-wrap">
            {notification.message}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {notification.action && (
          <button
            type="button"
            onClick={() => {
              notification.action?.onClick();
              onAck();
            }}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-semibold bg-sky-500 hover:bg-sky-600 text-white"
            data-testid={`proactive-card-action-${notification.event}`}
          >
            {notification.action.label}
          </button>
        )}
        <button
          type="button"
          onClick={onAck}
          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-semibold ${
            isBlocking
              ? "bg-rose-600 hover:bg-rose-700 text-white"
              : "bg-emerald-500 hover:bg-emerald-600 text-white"
          }`}
          data-testid={`proactive-card-ack-${notification.event}`}
        >
          <Check className="w-3 h-3" />
          {isBlocking ? "我看到了，先停下" : "知道了"}
        </button>
      </div>
    </div>
  );
}
