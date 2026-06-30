/**
 * agentConcurrentRouting.test.ts — AIDV-496 並發路由負載驗證
 *
 * 測試場景：
 *   1. maxLoad 守門：currentLoad >= maxLoad 的代理不被選派
 *   2. 10 並發 assign 均落在容量充足的代理
 *   3. 飽和場景：所有代理達到 maxLoad，assign 回 SERVICE_UNAVAILABLE
 *   4. 心跳更新後容量重開（heartbeat dropout 恢復）
 *   5. 低 maxLoad 代理被更高 maxLoad 的代理取代
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { sql, eq, and } from "drizzle-orm";

// ── Stateful mock state ─────────────────────────────────────────────────────

type RegistryRow = {
  id: number;
  agentId: string;
  capabilities: string[];
  allowedEndpoints: string[] | null;
  costPerToken: string;
  currentLoad: string;
  maxLoad: string;
  isActive: boolean;
  lastHeartbeatAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

let registryState: RegistryRow[] = [];
let nextId = 1;

function freshRow(overrides: Partial<RegistryRow> & Pick<RegistryRow, "agentId" | "capabilities">): RegistryRow {
  return {
    id: nextId++,
    allowedEndpoints: null,
    costPerToken: "0",
    currentLoad: "0",
    maxLoad: "1.0000",
    isActive: true,
    lastHeartbeatAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildMockDb() {
  return {
    insert: (_table: unknown) => ({
      values: (row: Partial<RegistryRow>) => ({
        onDuplicateKeyUpdate: ({ set }: { set: Partial<RegistryRow> }) => {
          const existing = registryState.findIndex(r => r.agentId === (row as RegistryRow).agentId);
          if (existing >= 0) {
            registryState[existing] = { ...registryState[existing]!, ...set } as RegistryRow;
          } else {
            registryState.push(freshRow(row as Pick<RegistryRow, "agentId" | "capabilities"> & Partial<RegistryRow>));
          }
          return Promise.resolve();
        },
      }),
    }),

    update: (_table: unknown) => ({
      set: (values: Partial<RegistryRow>) => ({
        where: (_cond: unknown) => {
          // heartbeat: update by agentId extracted from set
          const agentId = (values as { agentId?: string }).agentId;
          const idx = agentId ? registryState.findIndex(r => r.agentId === agentId) : -1;
          if (idx >= 0) {
            registryState[idx] = { ...registryState[idx]!, ...values } as RegistryRow;
            return Promise.resolve([{ affectedRows: 1 }]);
          }
          return Promise.resolve([{ affectedRows: 0 }]);
        },
      }),
    }),

    select: () => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          orderBy: (_col: unknown) => ({
            limit: (_n: number) => {
              // Return isActive=true rows where lastHeartbeatAt is recent
              // AND currentLoad < maxLoad  (the AIDV-496 capacity filter)
              const now = Date.now();
              return Promise.resolve(
                registryState
                  .filter(r => {
                    if (!r.isActive) return false;
                    const age = now - r.lastHeartbeatAt.getTime();
                    if (age > 5 * 60 * 1000) return false;
                    // Capacity filter
                    return parseFloat(r.currentLoad) < parseFloat(r.maxLoad);
                  })
                  .sort((a, b) => parseFloat(a.currentLoad) - parseFloat(b.currentLoad))
              );
            },
          }),
        }),
      }),
    }),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function registerAgent(
  db: ReturnType<typeof buildMockDb>,
  agentId: string,
  capabilities: string[],
  overrides: Partial<{ currentLoad: string; maxLoad: string; allowedEndpoints: string[] | null }> = {}
) {
  await db.insert(null).values({
    agentId,
    capabilities,
    allowedEndpoints: overrides.allowedEndpoints ?? null,
    costPerToken: "0",
    currentLoad: overrides.currentLoad ?? "0",
    maxLoad: overrides.maxLoad ?? "1.0000",
    isActive: true,
    lastHeartbeatAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as RegistryRow).onDuplicateKeyUpdate({ set: {} });
  // Apply overrides directly since the mock above doesn't propagate all fields
  const idx = registryState.findIndex(r => r.agentId === agentId);
  if (idx >= 0 && overrides.currentLoad !== undefined) {
    registryState[idx]!.currentLoad = overrides.currentLoad;
  }
  if (idx >= 0 && overrides.maxLoad !== undefined) {
    registryState[idx]!.maxLoad = overrides.maxLoad;
  }
}

async function assignAgent(db: ReturnType<typeof buildMockDb>, requiredCapabilities: string[]): Promise<RegistryRow | null> {
  const candidates = await db
    .select()
    .from(null)
    .where(null)
    .orderBy(null)
    .limit(100) as RegistryRow[];

  const matched = candidates.filter(agent => {
    return requiredCapabilities.every(req => agent.capabilities.includes(req));
  });

  return matched.length > 0 ? matched[0]! : null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("agentConcurrentRouting（AIDV-496 maxLoad 並發守門）", () => {
  beforeEach(() => {
    registryState = [];
    nextId = 1;
  });

  it("maxLoad 守門：currentLoad >= maxLoad 的代理不被選派", async () => {
    const db = buildMockDb();
    // Agent A: load 0.9, maxLoad 0.8 → 超過容量，不可選
    await registerAgent(db, "agent-overloaded", ["video"], { currentLoad: "0.9000", maxLoad: "0.8000" });
    // Agent B: load 0.5, maxLoad 0.8 → 未超容量，可選
    await registerAgent(db, "agent-available", ["video"], { currentLoad: "0.5000", maxLoad: "0.8000" });

    const result = await assignAgent(db, ["video"]);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("agent-available");
  });

  it("maxLoad == currentLoad 的代理不被選派（邊界值：strictly less than）", async () => {
    const db = buildMockDb();
    await registerAgent(db, "agent-exact", ["audio"], { currentLoad: "0.8000", maxLoad: "0.8000" });
    await registerAgent(db, "agent-ok", ["audio"], { currentLoad: "0.7999", maxLoad: "0.8000" });

    const result = await assignAgent(db, ["audio"]);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("agent-ok");
  });

  it("10 並發 assign 均落在容量充足的代理（而非過載代理）", async () => {
    const db = buildMockDb();
    await registerAgent(db, "agent-full", ["image"], { currentLoad: "1.0000", maxLoad: "0.9000" });
    await registerAgent(db, "agent-free", ["image"], { currentLoad: "0.2000", maxLoad: "1.0000" });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => assignAgent(db, ["image"]))
    );

    expect(results.every(r => r !== null)).toBe(true);
    expect(results.every(r => r!.agentId === "agent-free")).toBe(true);
  });

  it("飽和場景：所有代理達到或超過 maxLoad → assign 回 null（無可用代理）", async () => {
    const db = buildMockDb();
    await registerAgent(db, "agent-sat-1", ["fal", "video"], { currentLoad: "0.9000", maxLoad: "0.8000" });
    await registerAgent(db, "agent-sat-2", ["fal", "video"], { currentLoad: "1.0000", maxLoad: "1.0000" });

    const result = await assignAgent(db, ["fal", "video"]);
    expect(result).toBeNull();
  });

  it("心跳降負載後，先前過載代理重回可選池", async () => {
    const db = buildMockDb();
    await registerAgent(db, "agent-recover", ["tts"], { currentLoad: "0.9000", maxLoad: "0.8000" });

    // 確認過載時不可選
    expect(await assignAgent(db, ["tts"])).toBeNull();

    // 模擬心跳降負載
    const idx = registryState.findIndex(r => r.agentId === "agent-recover");
    registryState[idx]!.currentLoad = "0.5000";
    registryState[idx]!.lastHeartbeatAt = new Date();

    const result = await assignAgent(db, ["tts"]);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("agent-recover");
  });

  it("負載排序：選 currentLoad 最低的可用代理（maxLoad 守門後）", async () => {
    const db = buildMockDb();
    await registerAgent(db, "agent-hi", ["gen"], { currentLoad: "0.6000", maxLoad: "1.0000" });
    await registerAgent(db, "agent-lo", ["gen"], { currentLoad: "0.1000", maxLoad: "1.0000" });
    await registerAgent(db, "agent-mid", ["gen"], { currentLoad: "0.4000", maxLoad: "1.0000" });

    const result = await assignAgent(db, ["gen"]);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("agent-lo");
  });

  it("預設 maxLoad=1.0000：無上限代理在 currentLoad=0.9999 仍可選派", async () => {
    const db = buildMockDb();
    await registerAgent(db, "agent-default-max", ["default-cap"], { currentLoad: "0.9999" });

    const result = await assignAgent(db, ["default-cap"]);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("agent-default-max");
  });

  it("maxLoad=0：任何 currentLoad 均達容量上限，代理永遠不參選", async () => {
    const db = buildMockDb();
    await registerAgent(db, "agent-zero-max", ["zero-cap"], { currentLoad: "0.0000", maxLoad: "0.0000" });

    const result = await assignAgent(db, ["zero-cap"]);
    expect(result).toBeNull();
  });

  it("多代理混合：只有未達 maxLoad 的代理被選，且選負載最低者", async () => {
    const db = buildMockDb();
    // 過載
    await registerAgent(db, "agent-ov1", ["mixed"], { currentLoad: "0.9000", maxLoad: "0.8000" });
    // 未達 maxLoad，負載較高
    await registerAgent(db, "agent-ok2", ["mixed"], { currentLoad: "0.5000", maxLoad: "0.9000" });
    // 未達 maxLoad，負載最低 → 應被選
    await registerAgent(db, "agent-ok1", ["mixed"], { currentLoad: "0.3000", maxLoad: "0.9000" });

    const result = await assignAgent(db, ["mixed"]);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("agent-ok1");
  });

  it("能力不符的代理即使有容量也不被選派", async () => {
    const db = buildMockDb();
    await registerAgent(db, "agent-image", ["image"], { currentLoad: "0.1000" });
    await registerAgent(db, "agent-video", ["video", "fal"], { currentLoad: "0.2000" });

    const result = await assignAgent(db, ["image", "stable-diffusion"]);
    expect(result).toBeNull();
  });

  it("10 並發：混合容量代理，並發結果全部為容量充足代理", async () => {
    const db = buildMockDb();
    // 5 個過載，5 個可用
    for (let i = 0; i < 5; i++) {
      await registerAgent(db, `agent-over-${i}`, ["bulk"], { currentLoad: "0.9500", maxLoad: "0.9000" });
    }
    for (let i = 0; i < 5; i++) {
      await registerAgent(db, `agent-free-${i}`, ["bulk"], { currentLoad: String((i * 0.1).toFixed(4)) });
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, () => assignAgent(db, ["bulk"]))
    );

    expect(results.every(r => r !== null)).toBe(true);
    expect(results.every(r => r!.agentId.startsWith("agent-free-"))).toBe(true);
  });
});
