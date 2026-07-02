// @vitest-environment jsdom
/**
 * BackgroundTasksContext — AIDV-589 Context 層整合測試
 *
 * SPEC 要求「元件/Context 層測試」：這裡驗證 SSE onmessage 的實際接線
 * （SegmentProgressLabel.test.tsx 用 mock context，蓋不到這層）——
 * - segment 事件（legacy 直發 / unified envelope 兩種形狀）正確寫入
 *   segmentProgress 並以 jobId 為 key；
 * - 非 segment 事件不改變 segmentProgress reference（零多餘 re-render）；
 * - complete 事件行為與 main 基準等價：previewUrls 快取、refetch、
 *   checkStudioJob 同步、es.close()——segment 分支不得干擾；
 * - complete 之後抵達的 segment_completed 依 EventSource 規範不再派發
 *   （readyState=CLOSED）→ 固定「SSE 路徑必漏尾段事件」為文件化事實，
 *   這正是 SegmentProgressLabel 需要 resultJson fallback 的原因。
 *
 * 沿用 ProjectsContext.real.test.tsx 慣例：vi.mock("@/lib/trpc") 手刻
 * provider 會碰到的 procedure 樹；EventSource 以規範相容的 stub 取代
 * （close 後 emit 不派發）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

// ── 可程式化 mock 狀態 ────────────────────────────────────────────────────
const activeJobsState: { data: unknown[] } = { data: [] };
const refetchSpy = vi.fn();
const checkStudioJobFetch = vi.fn(async (_input: { jobId: number }) => null);

const utilsStub = {
  generate: { checkStudioJob: { fetch: checkStudioJobFetch } },
  accountant: { estimate: { fetch: vi.fn(async () => ({ totalPoints: 0 })) } },
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => utilsStub,
    generate: {
      activeJobs: {
        useQuery: () => ({
          data: activeJobsState.data,
          isLoading: false,
          refetch: refetchSpy,
        }),
      },
      submitStudioJob: {
        useMutation: () => ({ mutateAsync: vi.fn(async () => ({ jobId: 1 })) }),
      },
    },
    credits: {
      myBalance: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

vi.mock("./PersonalSettingsContext", () => ({
  usePersonalSettings: () => ({
    settings: { soundEnabled: false, desktopNotif: false },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/proactiveEventBus", () => ({
  ProactiveEventBus: { publish: vi.fn() },
}));

vi.mock("@/lib/spiritWatchers", () => ({
  getRecentPlatformMention: vi.fn(() => null),
}));

// 預設組態（UNIFIED_SSE_ROUTER=false → legacy 每-job 端點）；
// envelope 解包不依賴此旗標，unified 形狀照樣要能被解出。
vi.mock("@/config/featureFlags", () => ({ UNIFIED_SSE_ROUTER: false }));

import {
  BackgroundTasksProvider,
  useBackgroundTasks,
} from "./BackgroundTasksContext";

// ── 規範相容的 EventSource stub ───────────────────────────────────────────
// 依 WHATWG 規範：close() 後 readyState=CLOSED，之後的 message 不再派發。
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  url: string;
  readyState = FakeEventSource.OPEN;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  /** 模擬 server 推一則 SSE message；CLOSED 後依規範丟棄（回傳 false）。 */
  emit(payload: unknown): boolean {
    if (this.readyState === FakeEventSource.CLOSED) return false;
    this.onmessage?.({ data: JSON.stringify(payload) });
    return true;
  }
}

function makeJobRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    jobType: "video",
    status: "processing",
    progress: 10,
    progressMessage: "影片生成 - 分鏡 #1",
    resultJson: {
      studioType: "video",
      sourceStudio: "director",
      segmentIndex: 0,
      totalTasks: 3,
      label: "影片生成 - 分鏡 #1",
    },
    errorMessage: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <BackgroundTasksProvider>{children}</BackgroundTasksProvider>;
}

/** render provider＋probe，並等掛載後的立即 checkStudioJob 輪詢 flush 完。 */
async function setup() {
  const rendered = renderHook(() => useBackgroundTasks(), { wrapper });
  await act(async () => {});
  // 掛載期的 refetch / checkStudioJob 呼叫不屬於待測行為 → 歸零
  refetchSpy.mockClear();
  checkStudioJobFetch.mockClear();
  return rendered;
}

function sourceForJob(jobId: number): FakeEventSource {
  const es = FakeEventSource.instances.find(s =>
    s.url.endsWith(`/api/generation-events/${jobId}`)
  );
  if (!es) throw new Error(`no EventSource opened for job ${jobId}`);
  return es;
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.instances = [];
  activeJobsState.data = [makeJobRow(101)];
  refetchSpy.mockClear();
  checkStudioJobFetch.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BackgroundTasksContext — segment SSE 接線 (AIDV-589)", () => {
  it("為每個進行中 job 開 legacy 每-job SSE 端點", async () => {
    await setup();
    expect(FakeEventSource.instances.map(s => s.url)).toContain(
      "/api/generation-events/101"
    );
  });

  it("legacy 直發 segment_started → segmentProgress 以 jobId 為 key 正確寫入", async () => {
    const { result } = await setup();
    expect(result.current.segmentProgress).toEqual({});
    act(() => {
      sourceForJob(101).emit({
        type: "segment_started",
        segmentId: "seg-1",
        segmentIndex: 1,
        of: 5,
        stage: "video",
        userId: 1,
        at: Date.now(),
      });
    });
    expect(result.current.segmentProgress[101]).toEqual({
      currentSegment: 2,
      totalSegments: 5,
      completed: false,
    });
  });

  it("unified envelope（bus_id=generation 包 payload）→ 解包後同樣寫入", async () => {
    const { result } = await setup();
    act(() => {
      sourceForJob(101).emit({
        bus_id: "generation",
        sequence_no: 7,
        timestamp: Date.now(),
        payload: {
          type: "segment_completed",
          segmentId: "seg-0",
          segmentIndex: 0,
          of: 3,
          stage: "video",
        },
      });
    });
    expect(result.current.segmentProgress[101]).toEqual({
      currentSegment: 1,
      totalSegments: 3,
      completed: true,
    });
  });

  it("非 segment 事件（progress/heartbeat/非 JSON）→ segmentProgress reference 不變", async () => {
    const { result } = await setup();
    const before = result.current.segmentProgress;
    act(() => {
      const es = sourceForJob(101);
      es.emit({ type: "progress", progress: 50, message: "生成中" });
      es.onmessage?.({ data: "not-json" }); // heartbeat / 髒資料不 throw
    });
    expect(result.current.segmentProgress).toBe(before);
  });

  it("多 job 併行時 segment 事件各自 keyed，不互相汙染", async () => {
    activeJobsState.data = [makeJobRow(101), makeJobRow(102)];
    const { result } = await setup();
    act(() => {
      sourceForJob(102).emit({ type: "segment_started", segmentIndex: 2, of: 4 });
    });
    expect(result.current.segmentProgress[102]).toEqual({
      currentSegment: 3,
      totalSegments: 4,
      completed: false,
    });
    expect(result.current.segmentProgress[101]).toBeUndefined();
  });

  it("complete 行為與基準等價：previewUrls 快取＋refetch＋checkStudioJob＋es.close()", async () => {
    const { result } = await setup();
    const es = sourceForJob(101);
    act(() => {
      es.emit({ type: "segment_started", segmentIndex: 0, of: 3 });
    });
    await act(async () => {
      es.emit({ type: "complete", preview_url: "https://cdn.example/p.mp4" });
    });
    expect(result.current.previewUrls[101]).toBe("https://cdn.example/p.mp4");
    expect(refetchSpy).toHaveBeenCalled();
    expect(checkStudioJobFetch).toHaveBeenCalledWith({ jobId: 101 });
    expect(es.readyState).toBe(FakeEventSource.CLOSED);
    // segment 分支不得干擾 complete；既有 segment state 保留
    expect(result.current.segmentProgress[101]).toEqual({
      currentSegment: 1,
      totalSegments: 3,
      completed: false,
    });
  });

  it("error 事件同樣 refetch＋close，且不觸碰 segmentProgress", async () => {
    const { result } = await setup();
    const es = sourceForJob(101);
    const before = result.current.segmentProgress;
    await act(async () => {
      es.emit({ type: "error", message: "boom" });
    });
    expect(refetchSpy).toHaveBeenCalled();
    expect(es.readyState).toBe(FakeEventSource.CLOSED);
    expect(result.current.segmentProgress).toBe(before);
  });

  it("【文件化事實】complete 之後的 segment_completed 依規範不派發 → SSE 必漏尾段（fallback 存在理由）", async () => {
    const { result } = await setup();
    const es = sourceForJob(101);
    act(() => {
      es.emit({ type: "segment_started", segmentIndex: 2, of: 3 });
    });
    await act(async () => {
      es.emit({ type: "complete" });
    });
    // server（webhookFal）先 emit complete 再 emit segment_completed；
    // client 收到 complete 即 close → 後續訊息被丟棄，永遠停在未完成。
    let delivered = true;
    act(() => {
      delivered = es.emit({ type: "segment_completed", segmentIndex: 2, of: 3 });
    });
    expect(delivered).toBe(false);
    expect(result.current.segmentProgress[101]).toEqual({
      currentSegment: 3,
      totalSegments: 3,
      completed: false, // 尾段 completed 永遠收不到 —— UI 靠 resultJson fallback
    });
  });

  it("tasks mapping 把 resultJson 原樣帶給 UI（fallback 資料鏈完整）", async () => {
    const { result } = await setup();
    const task = result.current.tasks.find(t => t.jobId === 101);
    expect(task?.studioType).toBe("video");
    expect(task?.resultJson).toMatchObject({
      sourceStudio: "director",
      segmentIndex: 0,
      totalTasks: 3,
    });
  });
});
