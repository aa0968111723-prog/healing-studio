/**
 * useIntentInference — 代理意圖推論前端觸發鉤子
 *
 * 監聽 Sense Engine 特徵累積，達到閾值後非同步觸發
 * Gemini Director 意圖推論，結果暫存供後續元件消費。
 *
 * 觸發條件（任一滿足即觸發）：
 * 1. 特徵事件累積 ≥ minEvents（預設 5）
 * 2. 工作階段時長 ≥ minSessionMs（預設 30s）
 * 3. 出現高信號事件（scrollHesitation / clickAbort）
 *
 * 防抖機制：同一工作階段最多推論 3 次，間隔 ≥ 60s。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { useSenseEngine } from "./useSenseEngine";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IntentResult {
  intentType: string;
  intentLabel: string;
  confidence: number;
  psychologicalInsight: string;
  suggestedAction: string;
  actionDetail: string;
  detectedAesthetics: string[];
  preferredModality: string;
  inferredAt: number;
}

interface UseIntentInferenceOptions {
  /** 最少事件數才觸發推論，預設 5 */
  minEvents?: number;
  /** 最短工作階段時長（ms）才觸發推論，預設 30000 */
  minSessionMs?: number;
  /** 同一工作階段最多推論次數，預設 3 */
  maxInferences?: number;
  /** 兩次推論最短間隔（ms），預設 60000 */
  cooldownMs?: number;
  /** 是否啟用，預設 true */
  enabled?: boolean;
}

// ─── Storage ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "sense_intent_result";
const INFERENCE_COUNT_KEY = "sense_inference_count";

function loadCachedResult(): IntentResult | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cacheResult(result: IntentResult) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {
    // silent
  }
}

function getInferenceCount(): number {
  try {
    return parseInt(sessionStorage.getItem(INFERENCE_COUNT_KEY) || "0", 10);
  } catch {
    return 0;
  }
}

function incrementInferenceCount() {
  try {
    const count = getInferenceCount() + 1;
    sessionStorage.setItem(INFERENCE_COUNT_KEY, String(count));
  } catch {
    // silent
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useIntentInference(
  engine: ReturnType<typeof useSenseEngine>,
  options: UseIntentInferenceOptions = {},
) {
  const {
    minEvents = 5,
    minSessionMs = 30_000,
    maxInferences = 3,
    cooldownMs = 60_000,
    enabled = true,
  } = options;

  const [result, setResult] = useState<IntentResult | null>(loadCachedResult);
  const [isInferring, setIsInferring] = useState(false);
  const lastInferredAt = useRef<number>(0);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inferMutation = trpc.sense.inferIntent.useMutation();

  // ── Core inference function ──
  const runInference = useCallback(async () => {
    if (!enabled || isInferring) return;

    // Check cooldown
    const now = Date.now();
    if (now - lastInferredAt.current < cooldownMs) return;

    // Check max inferences
    if (getInferenceCount() >= maxInferences) return;

    const events = engine.getEvents();
    const summary = engine.getFeatureSummary();

    // Check minimum events
    if (events.length < minEvents) return;

    // Check minimum session duration
    const sessionDuration = now - summary.sessionStartedAt;
    if (sessionDuration < minSessionMs) return;

    setIsInferring(true);
    lastInferredAt.current = now;

    try {
      const response = await inferMutation.mutateAsync({
        events,
        summary,
      });

      const intentResult: IntentResult = {
        ...response,
        inferredAt: now,
      };

      setResult(intentResult);
      cacheResult(intentResult);
      incrementInferenceCount();
    } catch (err) {
      console.warn("[IntentInference] Inference failed:", err);
    } finally {
      setIsInferring(false);
    }
  }, [enabled, isInferring, cooldownMs, maxInferences, engine, minEvents, minSessionMs, inferMutation]);

  // ── Auto-trigger: periodic check ──
  useEffect(() => {
    if (!enabled) return;

    // Check every 10 seconds if conditions are met
    checkIntervalRef.current = setInterval(() => {
      const events = engine.getEvents();
      const summary = engine.getFeatureSummary();
      const now = Date.now();

      // Skip if already inferring or on cooldown
      if (isInferring) return;
      if (now - lastInferredAt.current < cooldownMs) return;
      if (getInferenceCount() >= maxInferences) return;

      // ── Trigger conditions ──

      // Condition 1: Enough events accumulated
      const hasEnoughEvents = events.length >= minEvents;

      // Condition 2: High-signal events detected (scrollHesitation or clickAbort)
      const highSignalEvents = events.filter(
        (e) => e.type === "scrollHesitation" || e.type === "clickAbort"
      );
      const hasHighSignal = highSignalEvents.length >= 1;

      // Condition 3: Session long enough
      const sessionDuration = now - summary.sessionStartedAt;
      const sessionLongEnough = sessionDuration >= minSessionMs;

      // Trigger if: (enough events AND session long enough) OR high signal detected
      if ((hasEnoughEvents && sessionLongEnough) || (hasHighSignal && events.length >= 3)) {
        runInference();
      }
    }, 10_000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [enabled, isInferring, cooldownMs, maxInferences, minEvents, minSessionMs, engine, runInference]);

  // ── Manual trigger ──
  const triggerInference = useCallback(() => {
    runInference();
  }, [runInference]);

  // ── Clear result ──
  const clearResult = useCallback(() => {
    setResult(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    /** 最新的推論結果 */
    result,
    /** 是否正在推論中 */
    isInferring,
    /** 手動觸發推論 */
    triggerInference,
    /** 清除推論結果 */
    clearResult,
    /** 本次工作階段已推論次數 */
    inferenceCount: getInferenceCount(),
  };
}
