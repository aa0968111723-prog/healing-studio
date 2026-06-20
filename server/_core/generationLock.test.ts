/**
 * generationLock.test.ts — AIDV-20 生成防重複提交鎖
 *
 * 驗收：
 *   - acquire 成功取得 token；同 key 第二次併發 → NX 失敗 → GENERATION_LOCKED
 *   - release 只刪自己的鎖（CAS-del）：別人的 token 刪不掉、釋放後 key 重新可取
 *   - TTL 過期後 key 自動可再取（自動釋放，不會永久卡死）
 *   - fail-open：後端 setNxPx 拋錯 → acquire 仍回 token（放行）、不 throw
 *   - 旗標 OFF：不上鎖（永遠拿得到 token、release no-op）
 *   - 不同 payload → 不同 key → 可並行；相同 payload → 同 key → 互斥
 *
 * 鎖邏輯純函式化 + 可注入 mock store，無需真實 Redis。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GenerationLockService,
  InMemoryGenerationLockStore,
  GENERATION_LOCKED,
  buildGenerationLockKey,
  buildGenerationTaskLockKey,
  hashGenerationPayload,
  DEFAULT_TASK_LOCK_TTL_MS,
  type GenerationLockStore,
} from "./generationLock";

// 直接控制旗標：env.validated 的 serverEnv.ENABLE_GENERATION_LOCK 讀自 schema，
// 但 isEnabled() 實際讀 serverEnv。為了不依賴 process.env 解析時機，這裡用 vi.mock
// 提供可變的 serverEnv 物件。
const mockEnv = { ENABLE_GENERATION_LOCK: "true" as string };
vi.mock("./env.validated", () => ({
  get serverEnv() {
    return mockEnv;
  },
}));

beforeEach(() => {
  mockEnv.ENABLE_GENERATION_LOCK = "true";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hashGenerationPayload / buildGenerationLockKey", () => {
  it("相同 payload → 相同 hash；不同 payload → 不同 hash", () => {
    const a = hashGenerationPayload({ segments: [1, 2], opts: { m: ["image"] } });
    const b = hashGenerationPayload({ segments: [1, 2], opts: { m: ["image"] } });
    const c = hashGenerationPayload({ segments: [1, 3], opts: { m: ["image"] } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("key 含 userId：同 payload 不同 user → 不同 key（各自獨立）", () => {
    const payload = { segments: [1] };
    const k1 = buildGenerationLockKey(1, payload);
    const k2 = buildGenerationLockKey(2, payload);
    expect(k1).not.toBe(k2);
    expect(k1.startsWith("gen-lock:1:")).toBe(true);
    expect(k2.startsWith("gen-lock:2:")).toBe(true);
  });

  it("同 user 同 payload → 同 key（互斥）；同 user 不同 payload → 不同 key（可並行）", () => {
    const same1 = buildGenerationLockKey(7, { segments: [1] });
    const same2 = buildGenerationLockKey(7, { segments: [1] });
    const diff = buildGenerationLockKey(7, { segments: [2] });
    expect(same1).toBe(same2);
    expect(same1).not.toBe(diff);
  });
});

describe("buildGenerationTaskLockKey — 單任務執行鎖 key（防重複付費生成）", () => {
  const task = {
    segmentId: "seg-1",
    modality: "image",
    modelId: "fal-ai/flux/dev",
    prompt: "a cat",
    params: { aspect_ratio: "16:9" },
  };

  it("相同 task identity → 相同 key（同任務雙擊互斥）", () => {
    const a = buildGenerationTaskLockKey(1, task);
    const b = buildGenerationTaskLockKey(1, { ...task });
    expect(a).toBe(b);
  });

  it("任一欄位不同（modelId / prompt / params / modality / segmentId）→ 不同 key（可並行）", () => {
    const base = buildGenerationTaskLockKey(1, task);
    expect(buildGenerationTaskLockKey(1, { ...task, modelId: "fal-ai/flux/schnell" })).not.toBe(base);
    expect(buildGenerationTaskLockKey(1, { ...task, prompt: "a dog" })).not.toBe(base);
    expect(buildGenerationTaskLockKey(1, { ...task, modality: "video" })).not.toBe(base);
    expect(buildGenerationTaskLockKey(1, { ...task, segmentId: "seg-2" })).not.toBe(base);
    expect(buildGenerationTaskLockKey(1, { ...task, params: { aspect_ratio: "9:16" } })).not.toBe(base);
  });

  it("同 task 不同 user → 不同 key（各自獨立的付費生成）", () => {
    expect(buildGenerationTaskLockKey(1, task)).not.toBe(buildGenerationTaskLockKey(2, task));
  });

  it("task key 與 planning key 命名空間不相撞（:task: 區隔）", () => {
    const taskKey = buildGenerationTaskLockKey(1, task);
    const planKey = buildGenerationLockKey(1, task);
    expect(taskKey).not.toBe(planKey);
    expect(taskKey.startsWith("gen-lock:task:1:")).toBe(true);
    expect(planKey.startsWith("gen-lock:1:")).toBe(true);
  });

  it("DEFAULT_TASK_LOCK_TTL_MS 為正數且短於 planning TTL（任務鎖窗口較緊）", () => {
    expect(DEFAULT_TASK_LOCK_TTL_MS).toBeGreaterThan(0);
    expect(DEFAULT_TASK_LOCK_TTL_MS).toBeLessThan(180_000);
  });
});

describe("per-task 執行鎖 — 端到端互斥 / 重試放行（模擬 executeGenerationTask）", () => {
  let svc: GenerationLockService;
  const task = {
    segmentId: "seg-1",
    modality: "image",
    modelId: "fal-ai/flux/dev",
    prompt: "a cat",
    params: {},
  };

  beforeEach(() => {
    svc = new GenerationLockService(new InMemoryGenerationLockStore());
  });
  afterEach(() => svc.destroy());

  it("同任務併發第二次提交 → GENERATION_LOCKED（在扣點前就被擋）", async () => {
    const key = buildGenerationTaskLockKey(42, task);
    const first = await svc.acquire(key, DEFAULT_TASK_LOCK_TTL_MS);
    expect(first).not.toBe(GENERATION_LOCKED);
    const second = await svc.acquire(key, DEFAULT_TASK_LOCK_TTL_MS);
    expect(second).toBe(GENERATION_LOCKED);
  });

  it("失敗任務先 release（finally）後重試 → 可重新取得鎖（合法重試不被擋）", async () => {
    const key = buildGenerationTaskLockKey(42, task);
    const token = (await svc.acquire(key, DEFAULT_TASK_LOCK_TTL_MS)) as string;
    // 原任務 submit 結束（finally release）
    await svc.release(key, token);
    // 使用者按重試
    const retry = await svc.acquire(key, DEFAULT_TASK_LOCK_TTL_MS);
    expect(retry).not.toBe(GENERATION_LOCKED);
  });
});

describe("acquire / release — 基本互斥語意", () => {
  let svc: GenerationLockService;
  let store: InMemoryGenerationLockStore;

  beforeEach(() => {
    store = new InMemoryGenerationLockStore();
    svc = new GenerationLockService(store);
  });

  afterEach(() => {
    svc.destroy();
  });

  it("acquire 成功回 token（uuid 字串），key 被標記為持有中", async () => {
    const key = "gen-lock:1:abc";
    const token = await svc.acquire(key);
    expect(typeof token).toBe("string");
    expect(token).not.toBe(GENERATION_LOCKED);
    expect(svc._isHeld(key)).toBe(true);
  });

  it("同 key 第二次 acquire（前一個未釋放）→ NX 失敗 → GENERATION_LOCKED", async () => {
    const key = "gen-lock:1:abc";
    const first = await svc.acquire(key);
    expect(first).not.toBe(GENERATION_LOCKED);
    const second = await svc.acquire(key);
    expect(second).toBe(GENERATION_LOCKED);
  });

  it("release 後同 key 可重新 acquire", async () => {
    const key = "gen-lock:1:abc";
    const token = (await svc.acquire(key)) as string;
    const released = await svc.release(key, token);
    expect(released).toBe(true);
    expect(svc._isHeld(key)).toBe(false);
    const again = await svc.acquire(key);
    expect(again).not.toBe(GENERATION_LOCKED);
  });

  it("不同 key 可同時持有（不同生成並行）", async () => {
    const a = await svc.acquire("gen-lock:1:aaa");
    const b = await svc.acquire("gen-lock:1:bbb");
    expect(a).not.toBe(GENERATION_LOCKED);
    expect(b).not.toBe(GENERATION_LOCKED);
  });
});

describe("release — CAS-del 只刪自己的鎖", () => {
  let svc: GenerationLockService;

  beforeEach(() => {
    svc = new GenerationLockService(new InMemoryGenerationLockStore());
  });
  afterEach(() => svc.destroy());

  it("用錯誤 token 釋放 → 刪不掉（不誤刪他人鎖）", async () => {
    const key = "gen-lock:1:abc";
    await svc.acquire(key); // 真 token 不外洩
    const removed = await svc.release(key, "someone-elses-token");
    expect(removed).toBe(false);
    expect(svc._isHeld(key)).toBe(true); // 鎖仍在
  });

  it("TTL 過期後原 holder 已逾時，後續 acquire 取得新鎖；舊 token release 不會誤刪新鎖", async () => {
    const key = "gen-lock:1:abc";
    const staleToken = (await svc.acquire(key, 20)) as string; // 20ms TTL
    // 等 TTL 過
    await new Promise(r => setTimeout(r, 40));
    // 第二位使用者取得新鎖
    const freshToken = await svc.acquire(key);
    expect(freshToken).not.toBe(GENERATION_LOCKED);
    // 舊 holder 遲來 release：CAS 不符 → 不刪新鎖
    const removedStale = await svc.release(key, staleToken);
    expect(removedStale).toBe(false);
    expect(svc._isHeld(key)).toBe(true);
  });
});

describe("TTL 自動釋放", () => {
  it("TTL 過期後 key 自動變回可取（不需顯式 release）", async () => {
    const svc = new GenerationLockService(new InMemoryGenerationLockStore());
    const key = "gen-lock:1:abc";
    const first = await svc.acquire(key, 20);
    expect(first).not.toBe(GENERATION_LOCKED);
    // 未過期 → 仍被鎖
    expect(await svc.acquire(key)).toBe(GENERATION_LOCKED);
    // 過 TTL
    await new Promise(r => setTimeout(r, 40));
    const after = await svc.acquire(key);
    expect(after).not.toBe(GENERATION_LOCKED);
    svc.destroy();
  });
});

describe("fail-open — 後端出錯一律放行", () => {
  it("setNxPx 拋錯 → acquire 仍回 token（不 throw、放行生成）", async () => {
    const throwingStore: GenerationLockStore = {
      setNxPx: () => Promise.reject(new Error("backend down")),
      casDel: () => Promise.resolve(false),
    };
    const svc = new GenerationLockService(throwingStore);
    const token = await svc.acquire("gen-lock:1:abc");
    expect(token).not.toBe(GENERATION_LOCKED);
    expect(typeof token).toBe("string");
    expect(svc.getStats().failOpen).toBe(1);
  });

  it("setNxPx 逾時（永遠 pending）→ 200ms 後 fail-open 放行", async () => {
    const hangingStore: GenerationLockStore = {
      setNxPx: () => new Promise<boolean>(() => {}), // 永不 resolve
      casDel: () => Promise.resolve(false),
    };
    const svc = new GenerationLockService(hangingStore);
    const token = await svc.acquire("gen-lock:1:abc");
    expect(token).not.toBe(GENERATION_LOCKED);
    expect(svc.getStats().failOpen).toBe(1);
  }, 1_000);

  it("release 後端拋錯 → 不 throw、回 false（鎖交給 TTL 回收）", async () => {
    const store: GenerationLockStore = {
      setNxPx: () => Promise.resolve(true),
      casDel: () => Promise.reject(new Error("backend down")),
    };
    const svc = new GenerationLockService(store);
    const token = (await svc.acquire("gen-lock:1:abc")) as string;
    await expect(svc.release("gen-lock:1:abc", token)).resolves.toBe(false);
  });
});

describe("旗標 ENABLE_GENERATION_LOCK", () => {
  it('OFF（"false"）→ 永遠不鎖：同 key 兩次 acquire 皆回 token', async () => {
    mockEnv.ENABLE_GENERATION_LOCK = "false";
    const svc = new GenerationLockService(new InMemoryGenerationLockStore());
    const key = "gen-lock:1:abc";
    const a = await svc.acquire(key);
    const b = await svc.acquire(key);
    expect(a).not.toBe(GENERATION_LOCKED);
    expect(b).not.toBe(GENERATION_LOCKED);
    svc.destroy();
  });

  it('OFF（"0"）→ release 為 no-op（回 false）', async () => {
    mockEnv.ENABLE_GENERATION_LOCK = "0";
    const svc = new GenerationLockService(new InMemoryGenerationLockStore());
    const token = (await svc.acquire("gen-lock:1:abc")) as string;
    await expect(svc.release("gen-lock:1:abc", token)).resolves.toBe(false);
    svc.destroy();
  });

  it('預設（""）→ 視為 ON（會上鎖）', async () => {
    mockEnv.ENABLE_GENERATION_LOCK = "";
    const svc = new GenerationLockService(new InMemoryGenerationLockStore());
    const key = "gen-lock:1:abc";
    expect(await svc.acquire(key)).not.toBe(GENERATION_LOCKED);
    expect(await svc.acquire(key)).toBe(GENERATION_LOCKED);
    svc.destroy();
  });
});

describe("withLock — 便利包裝", () => {
  let svc: GenerationLockService;
  beforeEach(() => {
    svc = new GenerationLockService(new InMemoryGenerationLockStore());
  });
  afterEach(() => svc.destroy());

  it("取得鎖 → 跑 fn → finally 釋放（之後同 key 可再取）", async () => {
    const key = "gen-lock:1:abc";
    const result = await svc.withLock(
      key,
      async () => "done",
      () => "locked"
    );
    expect(result).toBe("done");
    expect(svc._isHeld(key)).toBe(false);
  });

  it("已被鎖 → 呼叫 onLocked（不跑 fn）", async () => {
    const key = "gen-lock:1:abc";
    await svc.acquire(key); // 先佔住
    const fn = vi.fn(async () => "ran");
    const result = await svc.withLock(key, fn, () => "locked");
    expect(result).toBe("locked");
    expect(fn).not.toHaveBeenCalled();
  });

  it("fn 拋錯 → 仍會在 finally 釋放鎖", async () => {
    const key = "gen-lock:1:abc";
    await expect(
      svc.withLock(
        key,
        async () => {
          throw new Error("boom");
        },
        () => "locked"
      )
    ).rejects.toThrow("boom");
    expect(svc._isHeld(key)).toBe(false);
  });
});

describe("setStore — 開機時把後端從記憶體換成 Redis（call-site 不變）", () => {
  it("換 store 後 acquire/release 改走新 store", async () => {
    const svc = new GenerationLockService(new InMemoryGenerationLockStore());
    const calls: string[] = [];
    const fakeRedis: GenerationLockStore = {
      setNxPx: (k) => {
        calls.push(`set:${k}`);
        return Promise.resolve(true);
      },
      casDel: (k) => {
        calls.push(`del:${k}`);
        return Promise.resolve(true);
      },
    };
    svc.setStore(fakeRedis);
    const token = (await svc.acquire("gen-lock:1:abc")) as string;
    expect(typeof token).toBe("string");
    await svc.release("gen-lock:1:abc", token);
    expect(calls).toEqual(["set:gen-lock:1:abc", "del:gen-lock:1:abc"]);
    svc.destroy();
  });

  it("換成相同實例 → no-op（不會把它 destroy 掉）", async () => {
    const mem = new InMemoryGenerationLockStore();
    const svc = new GenerationLockService(mem);
    svc.setStore(mem);
    // 仍可正常上鎖（沒被誤 destroy）
    expect(await svc.acquire("gen-lock:1:abc")).not.toBe(GENERATION_LOCKED);
    svc.destroy();
  });
});

describe("self-heal — fail-open 後補刪「晚到的鎖」（修 latent orphan 坑）", () => {
  // 模擬：acquire 的 setNxPx race 已 timeout/err（立即 reject），但寫入其實晚一拍
  // 才真的落到後端 → 留下一把沒人追蹤的鎖。self-heal 應以自己的 token 補刪。
  class LateLandingStore implements GenerationLockStore {
    held = new Map<string, string>();
    casDelTokens: string[] = [];
    setNxPx(key: string, token: string): Promise<boolean> {
      setTimeout(() => this.held.set(key, token), 5);
      return Promise.reject(new Error("slow ack"));
    }
    casDel(key: string, token: string): Promise<boolean> {
      this.casDelTokens.push(token);
      if (this.held.get(key) === token) {
        this.held.delete(key);
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }
  }

  it("acquire 放行後，self-heal 用自己的 token CAS-del 掉晚到的鎖", async () => {
    const store = new LateLandingStore();
    const svc = new GenerationLockService(store, {
      selfHealAttempts: 5,
      selfHealIntervalMs: 10,
    });
    const key = "gen-lock:1:abc";
    const token = (await svc.acquire(key)) as string;
    expect(typeof token).toBe("string"); // 放行（fail-open）
    expect(svc.getStats().failOpen).toBe(1);

    await svc._drainSelfHeals();
    expect(store.held.has(key)).toBe(false); // 晚到的鎖已被補刪
    expect(store.casDelTokens).toContain(token); // 用「自己的」token 刪
    expect(svc.getStats().selfHealed).toBe(1);
    svc.destroy();
  });

  it("後端持續不可用（連 casDel 都 reject）→ 不 throw、selfHealed=0、仍放行", async () => {
    const downStore: GenerationLockStore = {
      setNxPx: () => Promise.reject(new Error("down")),
      casDel: () => Promise.reject(new Error("down")),
    };
    const svc = new GenerationLockService(downStore, {
      selfHealAttempts: 2,
      selfHealIntervalMs: 5,
    });
    const token = await svc.acquire("gen-lock:1:abc");
    expect(token).not.toBe(GENERATION_LOCKED);
    await svc._drainSelfHeals();
    expect(svc.getStats().selfHealed).toBe(0);
    svc.destroy();
  });

  it("destroy() 會取消還沒跑完的 self-heal（不外洩 timer）", async () => {
    const store = new LateLandingStore();
    const svc = new GenerationLockService(store, {
      selfHealAttempts: 10,
      selfHealIntervalMs: 50,
    });
    await svc.acquire("gen-lock:1:abc"); // 觸發 self-heal（首次 sleep 50ms 內）
    svc.destroy(); // 立刻拆除
    await svc._drainSelfHeals(); // 應很快結束，不會跑滿 10 次
    expect(svc.getStats().selfHealed).toBe(0);
  });
});
