/**
 * server/services/serverDeploymentMode.ts
 *
 * 偵測「我是不是跑在多 instance 部署環境」並對 in-memory state 的子系統
 * (orbScheduler / planExecutor PLAN_STORE 等)發一次性警告,避免 operator
 * 在沒讀 README 的情況下直接 scale-out 後遇到「對話狀態漂移 / cron 雙跑
 * / plan 跨 worker 404」這類 silent split-brain。
 *
 * 為什麼需要這支:H6 + L4 兩條 architectural 缺陷(planExecutor PLAN_STORE
 * 與 orbScheduler jobRegistry)目前都是 process-local in-memory,sticky
 * session / distributed lock 改造尚未完成。在改造完之前,至少 operator
 * 要在 stdout 看到一條明顯警告,知道目前部署模式只能跑 single instance。
 *
 * 偵測訊號(按優先級):
 *   1. NODE_APP_INSTANCE / PM2_INSTANCE_ID >= 1  ← PM2 cluster mode
 *   2. K8S_POD_NAME / KUBERNETES_PORT             ← Kubernetes
 *   3. WORKER_ID env                              ← 通用 worker id
 *   4. process.env.NODE_CLUSTER_WORKERS           ← Node cluster module
 *
 * 沒命中任一條 → 預設 single-instance,不發警告。
 * 命中任一條 → 發一次警告,並把「目前運作子系統」列出來讓 operator 知道
 * 哪些是 in-memory + 部署需要 sticky session 才能正確運作。
 */

const KNOWN_MULTI_INSTANCE_ENV_VARS = [
  // PM2 cluster mode:NODE_APP_INSTANCE / pm_id 都會被設成 >= 0 的字串
  "NODE_APP_INSTANCE",
  "PM2_INSTANCE_ID",
  // Kubernetes pod identity
  "KUBERNETES_PORT",
  "K8S_POD_NAME",
  // Node.js cluster module(較罕見直接用)
  "NODE_CLUSTER_WORKERS",
  // 通用 worker id 約定
  "WORKER_ID",
  "INSTANCE_ID",
] as const;

let warned = false;

/**
 * @returns 偵測訊號 + 是否觸發警告
 */
export function detectDeploymentMode(): {
  isLikelyMultiInstance: boolean;
  signals: readonly string[];
  reason: string;
} {
  const signals: string[] = [];
  for (const key of KNOWN_MULTI_INSTANCE_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined && value !== "" && value !== "0") {
      signals.push(`${key}=${value}`);
    }
  }
  const isLikelyMultiInstance = signals.length > 0;
  return {
    isLikelyMultiInstance,
    signals,
    reason: isLikelyMultiInstance
      ? `Detected multi-instance signals: ${signals.join(", ")}`
      : "No multi-instance signals detected (assuming single-instance deployment)",
  };
}

/**
 * 子系統(orbScheduler / planExecutor / ...)在 boot 時呼叫這支,把自己的
 * 名字 + 受影響的行為列出來。多 instance 部署下印出一條明顯警告;單
 * instance 則安靜。整個 process 生命週期只警告一次,避免 log 洪水。
 *
 * @param subsystemName e.g. "orbScheduler" / "planExecutor"
 * @param affectedBehavior 一行說明在多 instance 下會出什麼問題
 */
export function warnIfMultiInstanceSingleton(
  subsystemName: string,
  affectedBehavior: string
): void {
  const mode = detectDeploymentMode();
  if (!mode.isLikelyMultiInstance) return;
  if (warned) {
    // 已經為前一個子系統警告過,本次只追加一行 affected 列表,不重發 banner
    // eslint-disable-next-line no-console
    console.warn(
      `[deployment]   - ${subsystemName}: ${affectedBehavior}`
    );
    return;
  }
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    [
      "",
      "═══════════════════════════════════════════════════════════════",
      "[deployment] ⚠️  MULTI-INSTANCE DEPLOYMENT DETECTED",
      `[deployment] ${mode.reason}`,
      "[deployment]",
      "[deployment] The following subsystems still use process-local",
      "[deployment] in-memory state. Without sticky sessions or a shared",
      "[deployment] store (Redis), each worker has its own copy:",
      `[deployment]   - ${subsystemName}: ${affectedBehavior}`,
      "[deployment]",
      "[deployment] Mitigation (until distributed lock / Redis lands):",
      "[deployment]   - Deploy with sticky session (same user → same worker)",
      "[deployment]   - OR scale down to 1 instance",
      "[deployment]",
      "[deployment] Tracked as architectural backlog: H6 (PLAN_STORE) /",
      "[deployment] L4 (orbScheduler leader election).",
      "═══════════════════════════════════════════════════════════════",
      "",
    ].join("\n")
  );
}

/** Test-only:重置 warned flag 給單元測試清狀態。 */
export function __unsafe_resetDeploymentWarnedForTests(): void {
  warned = false;
}
