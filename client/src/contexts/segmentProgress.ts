/**
 * segmentProgress — AIDV-589 分段 SSE 進度純函式
 *
 * 前端消費 server 既有的 `segment_started` / `segment_completed` SSE 事件
 * （見 types/sse-events.ts、server/routers/director.ts、server/routes/webhookFal.ts），
 * 維護 per-jobId 的分段進度狀態。
 *
 * 設計原則：
 * - 純函式、零依賴，方便窮盡矩陣測試，也避免與 BackgroundTasksContext
 *   其他在飛修改互相衝突。
 * - 永不 throw：欄位缺失 / 型別錯誤 / 亂序 / 重複事件一律靜默降級
 *   （回傳原 state），未收到事件時 state 為 undefined → UI 與現行 100% 一致。
 * - segmentIndex 為 0-based（server 端 `index: i`，顯示時 +1），
 *   `of` 為總分段數。
 */

export interface SegmentProgressState {
  /** 1-based 目前分段編號（顯示用「第 X/N 段」的 X） */
  currentSegment: number;
  /** 總分段數（>= 1） */
  totalSegments: number;
  /** 目前分段是否已收到 segment_completed */
  completed: boolean;
}

export type SegmentEventType = "segment_started" | "segment_completed";

/** 判斷事件 type 是否為分段事件（narrowing helper，永不 throw）。 */
export function isSegmentEventType(type: unknown): type is SegmentEventType {
  return type === "segment_started" || type === "segment_completed";
}

/** 安全轉成非負整數；不合法回傳 null。 */
function toNonNegativeInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : null;
}

/**
 * Reducer：把一則（可能不可信的）SSE 事件套用到既有分段進度上。
 *
 * 安全矩陣：
 * - 非物件 / type 不符 / 缺 segmentIndex → 回傳 prev（靜默忽略）
 * - `of` 缺失或 < 1 → 退回 prev.totalSegments；兩者皆無（含 0 段）→ 忽略
 * - 亂序（舊分段編號晚到）→ 不倒退，維持 prev
 * - 重複（同分段同狀態）→ 回傳原 reference，避免多餘 re-render
 * - 同分段 completed 後又收到 started（重送）→ 不降級回未完成
 * - segmentIndex 超過總數 → clamp 到 totalSegments
 */
export function applySegmentEvent(
  prev: SegmentProgressState | undefined,
  raw: unknown
): SegmentProgressState | undefined {
  try {
    if (raw == null || typeof raw !== "object") return prev;
    const ev = raw as Record<string, unknown>;
    if (!isSegmentEventType(ev.type)) return prev;

    const idx = toNonNegativeInt(ev.segmentIndex);
    if (idx == null) return prev; // 缺 segmentIndex → 無法定位分段

    const ofValue = toNonNegativeInt(ev.of);
    const total = ofValue != null && ofValue >= 1 ? ofValue : prev?.totalSegments;
    if (total == null || total < 1) return prev; // 0 段 / 無總數 → 不顯示

    const current = Math.min(idx + 1, total);
    const completed = ev.type === "segment_completed";

    if (prev && total === prev.totalSegments) {
      // 亂序：舊分段事件晚到 → 不倒退
      if (current < prev.currentSegment) return prev;
      if (current === prev.currentSegment) {
        // 重複 started 不得把已完成的分段降回未完成
        if (prev.completed && !completed) return prev;
        // 完全相同 → 回傳原 reference（呼叫端可用 === 判斷免 re-render）
        if (prev.completed === completed) return prev;
      }
    }

    return { currentSegment: current, totalSegments: total, completed };
  } catch {
    return prev;
  }
}

/**
 * AIDV-589 fallback：從 activeJobs 輪詢帶回的 job resultJson 推導分段進度。
 *
 * 為什麼需要：兩個 segment SSE 事件在現行 server 下都「結構性收不到」——
 * (1) segment_started 在建立 job 的同一個 tRPC mutation 內同步 emit
 *     （server/routers/director.ts），client 要等 activeJobs 輪詢發現新 jobId
 *     才開 EventSource，而 generationBus 無 replay/快照 → 必然訂閱太晚；
 * (2) segment_completed 在 complete 之後才 emit（server/routes/webhookFal.ts），
 *     legacy SSE 路由收到 complete 即同步 unsubscribe、unified 路由下 client
 *     也已 es.close() → 必然漏接。
 * 因此輪詢路徑的 resultJson（director 的 executeGenerationTask 持久化的
 * segmentIndex / totalTasks / sourceStudio）是唯一保證可達的資料來源；
 * SSE reducer 保留為 server 修正後的即時增強層。
 *
 * 安全矩陣（與 applySegmentEvent 同精神，永不 throw）：
 * - meta 非物件 / sourceStudio 不是 "director" → null（非導演分段任務不顯示）
 * - segmentIndex 缺失或不合法 → null
 * - totalTasks 缺失或 < 1 → null（director 建 job 當下尚未寫入 totalTasks，
 *   dispatch 成功後的 updateBackgroundJob 才有 → 此前安靜不顯示）
 * - segmentIndex 超過總數 → clamp 到 totalSegments
 * - completed 一律 false（輪詢層只知道「這個分段任務存在」，完成與否由
 *   job status 本身表達；TaskRow 只在 processing/queued 時渲染本標籤）
 */
export function deriveSegmentProgressFromJobMeta(
  meta: unknown
): SegmentProgressState | null {
  try {
    if (meta == null || typeof meta !== "object") return null;
    const m = meta as Record<string, unknown>;
    if (m.sourceStudio !== "director") return null;
    const idx = toNonNegativeInt(m.segmentIndex);
    const total = toNonNegativeInt(m.totalTasks);
    if (idx == null || total == null || total < 1) return null;
    return {
      currentSegment: Math.min(idx + 1, total),
      totalSegments: total,
      completed: false,
    };
  } catch {
    return null;
  }
}

/**
 * 把分段進度格式化成 zh-TW 進度文案「第 X/N 段」。
 * state 缺失或不合法時回傳 null（呼叫端 render null → 零回歸）。
 */
export function formatSegmentProgress(
  state: SegmentProgressState | null | undefined
): string | null {
  try {
    if (!state) return null;
    const current = toNonNegativeInt(state.currentSegment);
    const total = toNonNegativeInt(state.totalSegments);
    if (current == null || total == null || current < 1 || total < 1) return null;
    return `第 ${Math.min(current, total)}/${total} 段`;
  } catch {
    return null;
  }
}
