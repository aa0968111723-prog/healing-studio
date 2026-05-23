/**
 * commander-create-intent.test.ts — M1-B createIntent Skeleton
 *
 * 測 commanderService，用 vi.mock 攔 ./db。重點：
 *   1. createIntent 只寫 DB，狀態 pending、estimatedCostUsd null、不呼叫外部 API
 *   2. 無 projectId 仍可建立 run，hasProjectContext=false
 *   3. 帶不屬於使用者的 projectId → forbidden；不存在 → not_found（權限）
 *   4. getRun / listRunsByProject 都檢查擁有者
 *   5. decimal / date 欄位正確映射成 number|null / ISO 字串
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const createOrchestrationRunMock = vi.fn();
const getOrchestrationRunMock = vi.fn();
const getOrchestrationRunsByProjectMock = vi.fn();
const getCreativeProjectMock = vi.fn();

vi.mock("./db", () => ({
  createOrchestrationRun: (...a: unknown[]) => createOrchestrationRunMock(...a),
  getOrchestrationRun: (...a: unknown[]) => getOrchestrationRunMock(...a),
  getOrchestrationRunsByProject: (...a: unknown[]) =>
    getOrchestrationRunsByProjectMock(...a),
  getCreativeProject: (...a: unknown[]) => getCreativeProjectMock(...a),
}));

import {
  createIntent,
  getRun,
  listRunsByProject,
} from "./subsystems/commander/commanderService";
import { CommanderAccessError } from "./subsystems/commander/contracts";

const OWNER = 42;

function rowFrom(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: OWNER,
    projectId: null,
    teamId: null,
    mode: "create",
    intent: "做一支禪修短片",
    status: "pending",
    commander: null,
    planJson: null,
    contextPacketIdsJson: null,
    toolCallsJson: null,
    citationsJson: null,
    searchResultsJson: null,
    estimatedCostUsd: null,
    actualCostUsd: null,
    errorMessage: null,
    createdAt: new Date("2026-05-23T00:00:00.000Z"),
    updatedAt: new Date("2026-05-23T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  createOrchestrationRunMock.mockReset();
  getOrchestrationRunMock.mockReset();
  getOrchestrationRunsByProjectMock.mockReset();
  getCreativeProjectMock.mockReset();
});

describe("createIntent — writes a pending run only", () => {
  it("creates a run with status pending and null cost, without a project", async () => {
    createOrchestrationRunMock.mockResolvedValue(7);
    getOrchestrationRunMock.mockResolvedValue(rowFrom({ id: 7 }));

    const view = await createIntent({
      userId: OWNER,
      mode: "create",
      intent: "做一支禪修短片",
    });

    // Persisted exactly once; no project ownership lookup when projectId omitted.
    expect(createOrchestrationRunMock).toHaveBeenCalledTimes(1);
    const writeArg = createOrchestrationRunMock.mock.calls[0][0];
    expect(writeArg).toMatchObject({
      userId: OWNER,
      projectId: null,
      mode: "create",
      intent: "做一支禪修短片",
      status: "pending",
      estimatedCostUsd: null,
    });
    expect(getCreativeProjectMock).not.toHaveBeenCalled();

    expect(view.id).toBe(7);
    expect(view.status).toBe("pending");
    expect(view.estimatedCostUsd).toBeNull();
    expect(view.hasProjectContext).toBe(false);
    expect(view.createdAt).toBe("2026-05-23T00:00:00.000Z");
  });

  it("links to a project the user owns and marks hasProjectContext", async () => {
    getCreativeProjectMock.mockResolvedValue({ id: 5, userId: OWNER });
    createOrchestrationRunMock.mockResolvedValue(8);
    getOrchestrationRunMock.mockResolvedValue(
      rowFrom({ id: 8, projectId: 5, mode: "director" }),
    );

    const view = await createIntent({
      userId: OWNER,
      projectId: 5,
      mode: "director",
      intent: "分鏡這場戲",
    });

    expect(getCreativeProjectMock).toHaveBeenCalledWith(5);
    expect(view.projectId).toBe(5);
    expect(view.hasProjectContext).toBe(true);
  });

  it("rejects a projectId owned by another user (forbidden)", async () => {
    getCreativeProjectMock.mockResolvedValue({ id: 5, userId: 999 });

    await expect(
      createIntent({ userId: OWNER, projectId: 5, mode: "create", intent: "x" }),
    ).rejects.toMatchObject({ reason: "forbidden" });
    expect(createOrchestrationRunMock).not.toHaveBeenCalled();
  });

  it("rejects a missing projectId (not_found)", async () => {
    getCreativeProjectMock.mockResolvedValue(null);

    await expect(
      createIntent({ userId: OWNER, projectId: 123, mode: "create", intent: "x" }),
    ).rejects.toBeInstanceOf(CommanderAccessError);
    expect(createOrchestrationRunMock).not.toHaveBeenCalled();
  });
});

describe("getRun — owner only", () => {
  it("returns the run for its owner with mapped decimal cost", async () => {
    getOrchestrationRunMock.mockResolvedValue(
      rowFrom({ id: 3, estimatedCostUsd: "0.250000" }),
    );
    const view = await getRun(OWNER, 3);
    expect(view.id).toBe(3);
    expect(view.estimatedCostUsd).toBe(0.25);
  });

  it("throws forbidden for a run owned by someone else", async () => {
    getOrchestrationRunMock.mockResolvedValue(rowFrom({ id: 3, userId: 999 }));
    await expect(getRun(OWNER, 3)).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("throws not_found when the run does not exist", async () => {
    getOrchestrationRunMock.mockResolvedValue(null);
    await expect(getRun(OWNER, 3)).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("listRunsByProject — owner only", () => {
  it("verifies project ownership before listing", async () => {
    getCreativeProjectMock.mockResolvedValue({ id: 5, userId: OWNER });
    getOrchestrationRunsByProjectMock.mockResolvedValue([
      rowFrom({ id: 1, projectId: 5 }),
      rowFrom({ id: 2, projectId: 5 }),
    ]);

    const views = await listRunsByProject(OWNER, 5);
    expect(getCreativeProjectMock).toHaveBeenCalledWith(5);
    expect(views).toHaveLength(2);
    expect(views.every(v => v.hasProjectContext)).toBe(true);
  });

  it("throws forbidden when the project is not the user's", async () => {
    getCreativeProjectMock.mockResolvedValue({ id: 5, userId: 999 });
    await expect(listRunsByProject(OWNER, 5)).rejects.toMatchObject({
      reason: "forbidden",
    });
    expect(getOrchestrationRunsByProjectMock).not.toHaveBeenCalled();
  });
});
