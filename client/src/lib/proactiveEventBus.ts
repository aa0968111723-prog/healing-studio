/**
 * client/src/lib/proactiveEventBus.ts
 *
 * 15 精靈：主動精靈（財財 / 巧巧 / 守守）的事件匯流排。純 client-side 的
 * pub/sub — 各個模組（聊天輸入、cost telemetry、TRPC error boundary）只要
 * `publish(eventName, payload)` 就能讓對應精靈跳出來「主動關心」。
 *
 * 為什麼自己做不用既有 EventEmitter？因為要：
 *   1. 跟 SPIRIT_PROACTIVE_TRIGGERS 的事件型別精準對齊（編譯期就能抓到拼錯）
 *   2. 每個事件有自己 typed payload，編寫 listener 不用 `as` 強轉
 *   3. 可以節流（同一事件 N 秒內只觸發一次）— 防止使用者每打 1 字就被巧巧打擾
 *
 * 沒有 server-side bus — 三位主動精靈都是「使用者眼前的事」，事件源就在
 * client（input 變化、TRPC mutation 失敗、page navigation）。如果未來要從
 * server push（例如背景跑批跑完通知），再加 SSE 訂閱層即可。
 */

import type { ProactiveTriggerEvent } from "../../../shared/orb-agent-roles";

/**
 * Per-event payload schema. 加新事件時：
 *   1. shared/orb-agent-roles.ts 的 `ProactiveTriggerEvent` 加 union member
 *   2. 這裡的 `ProactiveEventPayloads` 加對應 entry
 *   3. SPIRIT_PROACTIVE_TRIGGERS 加 spec
 * 缺一就會編譯錯（這就是設計）。
 */
export interface ProactiveEventPayloads {
  monthly_spend_threshold: { usedPct: number; remainingCredits: number; topModel: string };
  expensive_op_about_to_run: { predicted: number; pctOfRemaining: number; opLabel: string };
  low_quality_generation: { issue: string; sampleCount: number; rewrittenPrompt?: string };
  prompt_too_short: { prompt: string; suggestedAddition: string };
  site_error_detected: { endpoint: string; errorCode: string | number; workaround: string };
  page_perf_bad: { tti: number; alternativePage?: string };
  feature_not_used: { featureName: string; lastSeenAt?: number };
  /**
   * 對話歷史接近 client-side compaction 上限。`usedPct` 是
   * MAX(usedChars/MAX_CHAT_REQUEST_CHARS, messageCount/MAX_CHAT_REQUEST_MESSAGES)
   * × 100，到 80 以上才該觸發。`conversationTitle` 是當前對話的標題，
   * 卡片用來提示使用者舊話題會留在哪一頁。
   */
  context_near_full: {
    usedPct: number;
    messageCount: number;
    usedChars: number;
    capChars: number;
    conversationTitle: string;
  };
  // 7 位新增精靈帶來的事件
  ip_risk_detected: {
    /** 觸發詞（例如「迪士尼角色」「特定政治人物姓名」） */
    trigger: string;
    /** 風險等級：高 / 中 / 低 */
    riskLevel: "高" | "中" | "低" | string;
    /** 為何有風險，一句話 */
    reason: string;
    /** 建議的安全改寫，使用者可一鍵套用 */
    safeRewrite: string;
  };
  credential_leak_detected: {
    /** 偵測到的類型：API key / token / password / private key */
    credentialType: string;
    /** 截掉敏感字串只保留 prefix（顯示用） */
    snippet: string;
  };
  user_stuck_detected: {
    /** 在哪個頁面 / 哪個區塊 */
    pageHint: string;
    /** 觀察到的狀況描述 */
    detail: string;
  };
  team_status_overview: {
    runningCount: number;
    queuedCount: number;
    completedCount: number;
    /** 建議的下一棒精靈暱稱 */
    nextSpirit: string;
  };
  social_post_ready: {
    /** 圖 / 影 / 文章 */
    assetType: string;
    /** IG / TikTok / YouTube / 小紅書 */
    platform: string;
    /** 推薦發文時段（例如「週四 19:00」） */
    timing: string;
  };
  notes_capture_suggested: {
    snippet: string;
    folderHint: string;
    searchHint: string;
  };
  settings_drift_detected: {
    settingName: string;
  };
}

type Listener<E extends ProactiveTriggerEvent> = (payload: ProactiveEventPayloads[E]) => void;

class ProactiveEventBusImpl {
  private listeners: Map<ProactiveTriggerEvent, Set<Listener<ProactiveTriggerEvent>>> = new Map();
  /** 節流：(eventKey + opaqueDedupeKey) → 上次發送時間。同一事件同一 dedupe 30s 內只發一次。 */
  private lastFired: Map<string, number> = new Map();
  private static readonly DEFAULT_DEDUPE_MS = 30_000;

  subscribe<E extends ProactiveTriggerEvent>(event: E, listener: Listener<E>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<ProactiveTriggerEvent>);
    return () => {
      set?.delete(listener as Listener<ProactiveTriggerEvent>);
    };
  }

  /**
   * Publish an event. 所有 subscriber 同步呼叫；listener 內如果丟錯不會拖垮其他 listener。
   *
   * @param dedupeKey 防止短時間重複觸發（例如使用者連打 5 個字都觸發 prompt_too_short）。
   *                  同一 (event, dedupeKey) 在 dedupeMs 內只會放行第一次。
   */
  publish<E extends ProactiveTriggerEvent>(
    event: E,
    payload: ProactiveEventPayloads[E],
    options?: { dedupeKey?: string; dedupeMs?: number }
  ): boolean {
    const key = `${event}::${options?.dedupeKey ?? ""}`;
    const dedupeMs = options?.dedupeMs ?? ProactiveEventBusImpl.DEFAULT_DEDUPE_MS;
    const now = Date.now();
    const last = this.lastFired.get(key) ?? 0;
    if (now - last < dedupeMs) return false;
    this.lastFired.set(key, now);

    const set = this.listeners.get(event);
    if (!set || set.size === 0) return true;
    for (const listener of set) {
      try {
        (listener as Listener<E>)(payload);
      } catch (err) {
        console.warn("[proactiveEventBus] listener threw", { event, err });
      }
    }
    return true;
  }

  /** Test helper — clear all listeners + dedupe cache. Not for prod use. */
  reset(): void {
    this.listeners.clear();
    this.lastFired.clear();
  }
}

export const ProactiveEventBus = new ProactiveEventBusImpl();
