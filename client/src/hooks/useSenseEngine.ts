/**
 * Sense Engine — 首頁微行為追蹤引擎
 *
 * 輕量級行為監聽器，追蹤使用者在首頁的微行為特徵：
 * - cardDwell: 在某張卡片上停留超過閾值（預設 5s）
 * - scrollHesitation: 在某區域反覆上下滾動超過閾值次數未點擊
 * - hoverIntent: 滑鼠進入卡片後的意圖分析（停留 vs 快速掃過）
 * - clickAbort: mousedown 後未 mouseup（猶豫點擊）
 * - sectionVisit: 區塊進入視野的次數與累計時間
 *
 * 所有特徵暫存於 sessionStorage + React Context 雙層，
 * 供後續 AI 推薦引擎消費。
 */

import { useCallback, useEffect, useRef } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SenseEventType =
  | "cardDwell"
  | "scrollHesitation"
  | "hoverIntent"
  | "clickAbort"
  | "sectionVisit"
  | "rapidScan";

export interface SenseEvent {
  type: SenseEventType;
  timestamp: number;
  /** 觸發事件的元素識別（卡片 ID、區塊名稱等） */
  targetId: string;
  /** 額外元資料 */
  meta: Record<string, unknown>;
}

export interface CardDwellMeta {
  dwellMs: number;
  cardTitle: string;
  cardModality?: string;
  cardTags?: string[];
}

export interface ScrollHesitationMeta {
  directionChanges: number;
  totalScrollDistance: number;
  durationMs: number;
  sectionName: string;
}

export interface HoverIntentMeta {
  hoverMs: number;
  /** 滑鼠移動距離（px），低距離 = 高意圖 */
  mouseTravel: number;
  intentScore: number; // 0-1, 1 = 高意圖
  cardTitle: string;
}

export interface ClickAbortMeta {
  holdMs: number;
  cardTitle: string;
}

export interface RapidScanMeta {
  cardsScanned: number;
  scanDurationMs: number;
  avgDwellMs: number;
}

// ─── Storage Key ────────────────────────────────────────────────────────────

const STORAGE_KEY = "sense_engine_events";
const MAX_EVENTS = 200;

function loadEvents(): SenseEvent[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistEvents(events: SenseEvent[]) {
  try {
    // 只保留最新的 MAX_EVENTS 筆
    const trimmed = events.slice(-MAX_EVENTS);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // sessionStorage 滿了就靜默失敗
  }
}

// ─── Main Hook ──────────────────────────────────────────────────────────────

interface SenseEngineOptions {
  /** 卡片停留閾值（ms），預設 5000 */
  dwellThreshold?: number;
  /** 滾動方向變化閾值，預設 3 */
  scrollHesitationThreshold?: number;
  /** Hover 意圖判定閾值（ms），預設 2000 */
  hoverIntentThreshold?: number;
  /** 是否啟用，預設 true */
  enabled?: boolean;
}

export function useSenseEngine(options: SenseEngineOptions = {}) {
  const {
    dwellThreshold = 5000,
    scrollHesitationThreshold = 3,
    hoverIntentThreshold = 2000,
    enabled = true,
  } = options;

  const eventsRef = useRef<SenseEvent[]>(loadEvents());
  const isEnabledRef = useRef(enabled);

  useEffect(() => {
    isEnabledRef.current = enabled;
  }, [enabled]);

  // ── Emit event ──
  // Batch writes to sessionStorage: accumulate events in-memory and flush periodically
  const pendingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const FLUSH_INTERVAL = 3000; // flush every 3 seconds

  const flushToStorage = useCallback(() => {
    persistEvents(eventsRef.current);
    pendingFlushRef.current = null;
  }, []);

  const emit = useCallback(
    (event: SenseEvent) => {
      if (!isEnabledRef.current) return;

      // 使用 requestIdleCallback 避免阻塞主線程
      const schedule =
        window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1));
      schedule(() => {
        eventsRef.current = [...eventsRef.current, event].slice(-MAX_EVENTS);
        // Batch: schedule a flush if not already pending
        if (!pendingFlushRef.current) {
          pendingFlushRef.current = setTimeout(flushToStorage, FLUSH_INTERVAL);
        }
      });
    },
    [flushToStorage]
  );

  // ── Get all events ──
  const getEvents = useCallback((): SenseEvent[] => {
    return eventsRef.current;
  }, []);

  // ── Get events by type ──
  const getEventsByType = useCallback((type: SenseEventType): SenseEvent[] => {
    return eventsRef.current.filter(e => e.type === type);
  }, []);

  // ── Get feature summary ──
  const getFeatureSummary = useCallback(() => {
    const events = eventsRef.current;
    const dwells = events.filter(e => e.type === "cardDwell");
    const hesitations = events.filter(e => e.type === "scrollHesitation");
    const intents = events.filter(e => e.type === "hoverIntent");
    const aborts = events.filter(e => e.type === "clickAbort");
    const scans = events.filter(e => e.type === "rapidScan");

    // 提取使用者偏好的模態
    const modalityCounts: Record<string, number> = {};
    dwells.forEach(e => {
      const m = e.meta as unknown as CardDwellMeta;
      if (m.cardModality)
        modalityCounts[m.cardModality] =
          (modalityCounts[m.cardModality] || 0) + 1;
    });

    // 提取高意圖卡片
    const highIntentCards = intents
      .filter(e => (e.meta as unknown as HoverIntentMeta).intentScore > 0.6)
      .map(e => {
        const m = e.meta as unknown as HoverIntentMeta;
        return {
          targetId: e.targetId,
          title: m.cardTitle,
          score: m.intentScore,
        };
      });

    // 提取猶豫區域
    const hesitationSections = hesitations.map(e => {
      const m = e.meta as unknown as ScrollHesitationMeta;
      return {
        section: m.sectionName,
        directionChanges: m.directionChanges,
      };
    });

    return {
      totalEvents: events.length,
      dwellCount: dwells.length,
      hesitationCount: hesitations.length,
      highIntentCards,
      hesitationSections,
      modalityPreference: modalityCounts,
      abortCount: aborts.length,
      rapidScanCount: scans.length,
      sessionStartedAt: events[0]?.timestamp || Date.now(),
    };
  }, []);

  // ── Clear events ──
  const clearEvents = useCallback(() => {
    eventsRef.current = [];
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Card Dwell Tracker
  // ═══════════════════════════════════════════════════════════════════════════

  const cardTimers = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; enteredAt: number }>
  >(new Map());

  const trackCardEnter = useCallback(
    (
      cardId: string,
      cardTitle: string,
      cardModality?: string,
      cardTags?: string[]
    ) => {
      if (!isEnabledRef.current) return;

      // 清除舊計時器
      const existing = cardTimers.current.get(cardId);
      if (existing) clearTimeout(existing.timer);

      const enteredAt = Date.now();
      const timer = setTimeout(() => {
        const dwellMs = Date.now() - enteredAt;
        emit({
          type: "cardDwell",
          timestamp: Date.now(),
          targetId: cardId,
          meta: {
            dwellMs,
            cardTitle,
            cardModality,
            cardTags,
          } satisfies CardDwellMeta,
        });
      }, dwellThreshold);

      cardTimers.current.set(cardId, { timer, enteredAt });
    },
    [dwellThreshold, emit]
  );

  const trackCardLeave = useCallback((cardId: string) => {
    const existing = cardTimers.current.get(cardId);
    if (existing) {
      clearTimeout(existing.timer);
      cardTimers.current.delete(cardId);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Scroll Hesitation Tracker
  // ═══════════════════════════════════════════════════════════════════════════

  const scrollState = useRef<{
    sectionName: string;
    lastDirection: "up" | "down" | null;
    directionChanges: number;
    totalDistance: number;
    startedAt: number;
    lastScrollY: number;
    hasClicked: boolean;
    debounceTimer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const trackScrollStart = useCallback((sectionName: string) => {
    if (!isEnabledRef.current) return;

    scrollState.current = {
      sectionName,
      lastDirection: null,
      directionChanges: 0,
      totalDistance: 0,
      startedAt: Date.now(),
      lastScrollY: window.scrollY,
      hasClicked: false,
      debounceTimer: null,
    };
  }, []);

  const trackScrollMove = useCallback(() => {
    if (!isEnabledRef.current || !scrollState.current) return;

    const state = scrollState.current;
    const currentY = window.scrollY;
    const delta = currentY - state.lastScrollY;

    if (Math.abs(delta) < 5) return; // 忽略微小移動

    const direction: "up" | "down" = delta > 0 ? "down" : "up";
    state.totalDistance += Math.abs(delta);

    if (state.lastDirection && direction !== state.lastDirection) {
      state.directionChanges++;

      // 達到閾值且未點擊 → 記錄猶豫事件
      if (
        state.directionChanges >= scrollHesitationThreshold &&
        !state.hasClicked
      ) {
        emit({
          type: "scrollHesitation",
          timestamp: Date.now(),
          targetId: `section-${state.sectionName}`,
          meta: {
            directionChanges: state.directionChanges,
            totalScrollDistance: state.totalDistance,
            durationMs: Date.now() - state.startedAt,
            sectionName: state.sectionName,
          } satisfies ScrollHesitationMeta,
        });
        // 重置計數避免重複觸發
        state.directionChanges = 0;
        state.startedAt = Date.now();
        state.totalDistance = 0;
      }
    }

    state.lastDirection = direction;
    state.lastScrollY = currentY;
  }, [scrollHesitationThreshold, emit]);

  const trackScrollClick = useCallback(() => {
    if (scrollState.current) {
      scrollState.current.hasClicked = true;
    }
  }, []);

  const trackScrollEnd = useCallback(() => {
    scrollState.current = null;
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Hover Intent Tracker
  // ═══════════════════════════════════════════════════════════════════════════

  const hoverState = useRef<
    Map<
      string,
      {
        enteredAt: number;
        startX: number;
        startY: number;
        totalTravel: number;
        lastX: number;
        lastY: number;
        cardTitle: string;
      }
    >
  >(new Map());

  const trackHoverStart = useCallback(
    (cardId: string, cardTitle: string, x: number, y: number) => {
      if (!isEnabledRef.current) return;

      hoverState.current.set(cardId, {
        enteredAt: Date.now(),
        startX: x,
        startY: y,
        totalTravel: 0,
        lastX: x,
        lastY: y,
        cardTitle,
      });
    },
    []
  );

  const trackHoverMove = useCallback((cardId: string, x: number, y: number) => {
    const state = hoverState.current.get(cardId);
    if (!state) return;

    const dx = x - state.lastX;
    const dy = y - state.lastY;
    state.totalTravel += Math.sqrt(dx * dx + dy * dy);
    state.lastX = x;
    state.lastY = y;
  }, []);

  const trackHoverEnd = useCallback(
    (cardId: string) => {
      const state = hoverState.current.get(cardId);
      if (!state) return;

      const hoverMs = Date.now() - state.enteredAt;
      hoverState.current.delete(cardId);

      // 只記錄有意義的 hover（>500ms）
      if (hoverMs < 500) return;

      // 意圖分數：停留越久 + 移動越少 = 越高意圖
      const timeScore = Math.min(hoverMs / hoverIntentThreshold, 1);
      // 低移動距離 = 高意圖（凝視），高移動距離 = 低意圖（掃過）
      const travelNorm = Math.min(state.totalTravel / 500, 1);
      const travelScore = 1 - travelNorm;
      const intentScore =
        Math.round((timeScore * 0.6 + travelScore * 0.4) * 100) / 100;

      emit({
        type: "hoverIntent",
        timestamp: Date.now(),
        targetId: cardId,
        meta: {
          hoverMs,
          mouseTravel: Math.round(state.totalTravel),
          intentScore,
          cardTitle: state.cardTitle,
        } satisfies HoverIntentMeta,
      });
    },
    [hoverIntentThreshold, emit]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Click Abort Tracker
  // ═══════════════════════════════════════════════════════════════════════════

  const clickAbortState = useRef<
    Map<string, { downAt: number; cardTitle: string }>
  >(new Map());

  const trackMouseDown = useCallback((cardId: string, cardTitle: string) => {
    if (!isEnabledRef.current) return;
    clickAbortState.current.set(cardId, { downAt: Date.now(), cardTitle });
  }, []);

  const trackMouseUp = useCallback((cardId: string) => {
    clickAbortState.current.delete(cardId);
  }, []);

  const trackMouseLeaveWhileDown = useCallback(
    (cardId: string) => {
      const state = clickAbortState.current.get(cardId);
      if (!state) return;

      const holdMs = Date.now() - state.downAt;
      clickAbortState.current.delete(cardId);

      // 只記錄有意義的猶豫（>200ms 按住後離開）
      if (holdMs < 200) return;

      emit({
        type: "clickAbort",
        timestamp: Date.now(),
        targetId: cardId,
        meta: {
          holdMs,
          cardTitle: state.cardTitle,
        } satisfies ClickAbortMeta,
      });
    },
    [emit]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Rapid Scan Tracker (快速掃過多張卡片)
  // ═══════════════════════════════════════════════════════════════════════════

  const scanBuffer = useRef<{ cardId: string; enteredAt: number }[]>([]);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trackRapidScanEnter = useCallback(
    (cardId: string) => {
      if (!isEnabledRef.current) return;

      scanBuffer.current.push({ cardId, enteredAt: Date.now() });

      // 重置掃描視窗計時器
      if (scanTimer.current) clearTimeout(scanTimer.current);
      scanTimer.current = setTimeout(() => {
        const buf = scanBuffer.current;
        if (buf.length >= 4) {
          const totalMs =
            (buf[buf.length - 1]?.enteredAt || 0) - (buf[0]?.enteredAt || 0);
          const avgDwell = totalMs / buf.length;

          // 快速掃過 = 平均停留 <2s 且掃過 4+ 張
          if (avgDwell < 2000) {
            emit({
              type: "rapidScan",
              timestamp: Date.now(),
              targetId: "showcase-masonry",
              meta: {
                cardsScanned: buf.length,
                scanDurationMs: totalMs,
                avgDwellMs: Math.round(avgDwell),
              } satisfies RapidScanMeta,
            });
          }
        }
        scanBuffer.current = [];
      }, 3000);
    },
    [emit]
  );

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      // 清除所有計時器
      cardTimers.current.forEach(({ timer }) => clearTimeout(timer));
      cardTimers.current.clear();
      hoverState.current.clear();
      clickAbortState.current.clear();
      if (scanTimer.current) clearTimeout(scanTimer.current);
      if (scrollState.current?.debounceTimer)
        clearTimeout(scrollState.current.debounceTimer);
      // Flush any pending batched events to sessionStorage
      if (pendingFlushRef.current) {
        clearTimeout(pendingFlushRef.current);
        persistEvents(eventsRef.current);
      }
    };
  }, []);

  return {
    // Event access
    getEvents,
    getEventsByType,
    getFeatureSummary,
    clearEvents,

    // Card dwell tracking
    trackCardEnter,
    trackCardLeave,

    // Scroll hesitation tracking
    trackScrollStart,
    trackScrollMove,
    trackScrollClick,
    trackScrollEnd,

    // Hover intent tracking
    trackHoverStart,
    trackHoverMove,
    trackHoverEnd,

    // Click abort tracking
    trackMouseDown,
    trackMouseUp,
    trackMouseLeaveWhileDown,

    // Rapid scan tracking
    trackRapidScanEnter,
  };
}

// ─── Convenience: Card Sense Props Generator ────────────────────────────────

/**
 * 產生卡片元素需要的事件處理器 props，
 * 一次綁定 dwell + hover intent + click abort + rapid scan 追蹤。
 */
export function useCardSenseProps(
  engine: ReturnType<typeof useSenseEngine>,
  cardId: string,
  cardTitle: string,
  cardModality?: string,
  cardTags?: string[]
) {
  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      engine.trackCardEnter(cardId, cardTitle, cardModality, cardTags);
      engine.trackHoverStart(cardId, cardTitle, e.clientX, e.clientY);
      engine.trackRapidScanEnter(cardId);
    },
    [engine, cardId, cardTitle, cardModality, cardTags]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      engine.trackHoverMove(cardId, e.clientX, e.clientY);
    },
    [engine, cardId]
  );

  const handleMouseLeave = useCallback(() => {
    engine.trackCardLeave(cardId);
    engine.trackHoverEnd(cardId);
    engine.trackMouseLeaveWhileDown(cardId);
  }, [engine, cardId]);

  const handleMouseDown = useCallback(() => {
    engine.trackMouseDown(cardId, cardTitle);
  }, [engine, cardId, cardTitle]);

  const handleMouseUp = useCallback(() => {
    engine.trackMouseUp(cardId);
  }, [engine, cardId]);

  return {
    onMouseEnter: handleMouseEnter,
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    onMouseDown: handleMouseDown,
    onMouseUp: handleMouseUp,
  };
}

// ─── Convenience: Section Scroll Tracker ────────────────────────────────────

/**
 * 為特定區塊綁定滾動猶豫追蹤。
 * 回傳一個 ref callback，附加到區塊容器上。
 */
export function useSectionScrollSense(
  engine: ReturnType<typeof useSenseEngine>,
  sectionName: string
) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const scrollHandlerRef = useRef<(() => void) | null>(null);
  const isInViewRef = useRef(false);

  const refCallback = useCallback(
    (node: HTMLElement | null) => {
      // 清除舊的 observer
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (scrollHandlerRef.current) {
        window.removeEventListener("scroll", scrollHandlerRef.current);
        scrollHandlerRef.current = null;
      }

      if (!node) return;

      // 偵測區塊是否在視野中
      observerRef.current = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting && !isInViewRef.current) {
            isInViewRef.current = true;
            engine.trackScrollStart(sectionName);

            // 開始監聽滾動
            const handler = () => {
              if (isInViewRef.current) {
                engine.trackScrollMove();
              }
            };
            scrollHandlerRef.current = handler;
            window.addEventListener("scroll", handler, { passive: true });
          } else if (!entry?.isIntersecting && isInViewRef.current) {
            isInViewRef.current = false;
            engine.trackScrollEnd();

            if (scrollHandlerRef.current) {
              window.removeEventListener("scroll", scrollHandlerRef.current);
              scrollHandlerRef.current = null;
            }
          }
        },
        { threshold: 0.2 }
      );

      observerRef.current.observe(node);
    },
    [engine, sectionName]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect();
      if (scrollHandlerRef.current) {
        window.removeEventListener("scroll", scrollHandlerRef.current);
      }
    };
  }, []);

  return refCallback;
}
