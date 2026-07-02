/**
 * videoProject.router.test.ts — AIDV-241 樂觀鎖 CAS + AIDV-337 稽核軌跡驗收測試
 *
 * 驗收條件：
 *   1. 無 expectedVersion → 直接成功（向下相容）
 *   2. expectedVersion 正確 → 更新成功
 *   3. expectedVersion 過期 → CONFLICT(409)
 *   4. 專案不存在 → NOT_FOUND
 *   5. 非本人 → FORBIDDEN
 *   6. list/get/create 回傳包含 version 欄位
 *   AIDV-337:
 *   7. create/update/save/duplicate/restoreSnapshot 均呼叫 recordAuditEvent
 *   8. 帶 X-Agent-Id header 時 agentId 寫入 metadata
 *   9. 帶 ctx.requestId 時 traceId 寫入 metadata
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { videoProjectRouter } from "../videoProject";

vi.mock("../../db", () => ({
  createVideoProject: vi.fn(),
  getVideoProject: vi.fn(),
  getVideoProjectsByUser: vi.fn(),
  getVideoProjectsByUserPaged: vi.fn(),
  updateVideoProject: vi.fn(),
  duplicateVideoProject: vi.fn(),
  createProjectSnapshot: vi.fn(),
  listProjectSnapshots: vi.fn(),
  getProjectSnapshot: vi.fn(),
  getDigitalAsset: vi.fn(),
  getUserSubscription: vi.fn(),
}));

vi.mock("../../services/audit/auditLog", () => ({
  recordAuditEvent: vi.fn(),
  extractRequestSource: vi.fn(() => ({})),
}));

import * as db from "../../db";
import * as auditLog from "../../services/audit/auditLog";

const ctx: any = {
  user: { id: 7, role: "user" },
  req: { headers: {}, ip: "127.0.0.1" },
  requestId: "req-test-001",
};

const baseProject = {
  id: 55,
  userId: 7,
  creativeProjectId: null,
  title: "測試影片",
  aspectRatio: "16:9" as const,
  version: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("videoProjectRouter — 基本 CRUD", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create 回傳 id + version", async () => {
    (db.createVideoProject as any).mockResolvedValue(55);
    (db.getVideoProject as any).mockResolvedValue(baseProject);

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.create({ title: "測試影片" });
    expect(result.id).toBe(55);
    expect(result.version).toBe(2);
  });

  it("get 回傳 version", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.get({ id: 55 });
    expect(result.version).toBe(2);
  });

  it("list 回傳 { items, nextCursor }，items 含 version 欄位", async () => {
    (db.getVideoProjectsByUserPaged as any).mockResolvedValue({ items: [baseProject], nextCursor: null });

    const caller = videoProjectRouter.createCaller(ctx);
    const res = await caller.list();
    expect(res.items[0].version).toBe(2);
    expect(res.nextCursor).toBeNull();
  });

  it("get 非本人 → FORBIDDEN", async () => {
    (db.getVideoProject as any).mockResolvedValue({ ...baseProject, userId: 99 });

    const caller = videoProjectRouter.createCaller(ctx);
    await expect(caller.get({ id: 55 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("AIDV-270 多模態輸入素材 — videoProject.create/update inputAssets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create 帶 inputAssets → 下傳 createVideoProject 並回傳於結果", async () => {
    const inputAssets = [
      { type: "image", url: "https://cdn.x/style.png", role: "style_reference" },
      { type: "audio", url: "https://cdn.x/bgm.mp3", role: "background_music" },
    ];
    (db.createVideoProject as any).mockResolvedValue(55);
    (db.getVideoProject as any).mockResolvedValue({ ...baseProject, inputAssets });

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.create({ title: "多模態", inputAssets: inputAssets as any });
    expect(db.createVideoProject).toHaveBeenCalledWith(
      expect.objectContaining({ inputAssets })
    );
    expect(result.inputAssets).toEqual(inputAssets);
  });

  it("create 省略 inputAssets → createVideoProject 收到 null，回傳空陣列", async () => {
    (db.createVideoProject as any).mockResolvedValue(55);
    (db.getVideoProject as any).mockResolvedValue(baseProject);

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.create({ title: "純文字" });
    expect(db.createVideoProject).toHaveBeenCalledWith(
      expect.objectContaining({ inputAssets: null })
    );
    expect(result.inputAssets).toEqual([]);
  });

  it("create inputAssets 角色↔模態不一致 → BAD_REQUEST（契約層擋下）", async () => {
    const caller = videoProjectRouter.createCaller(ctx);
    await expect(
      caller.create({
        title: "壞素材",
        inputAssets: [{ type: "audio", url: "https://cdn.x/x.mp3", role: "style_reference" }] as any,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createVideoProject).not.toHaveBeenCalled();
  });

  it("update inputAssets → patch 帶 inputAssets 下傳", async () => {
    const inputAssets = [{ type: "image", url: "https://cdn.x/a.jpg", role: "product_shot" }];
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.update({ id: 55, inputAssets: inputAssets as any });
    expect(db.updateVideoProject).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ inputAssets }),
      { expectedVersion: undefined }
    );
  });

  it("update inputAssets:null → 清空", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.update({ id: 55, inputAssets: null });
    expect(db.updateVideoProject).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ inputAssets: null }),
      { expectedVersion: undefined }
    );
  });
});

describe("AIDV-270 多模態輸入素材 — duplicate / restore / list 帶素材", () => {
  beforeEach(() => vi.clearAllMocks());

  it("duplicateVideoProject（db 層）insert values 帶 inputAssets（source-anchored：本測試 mock 掉整個 db，改以源碼釘住複製欄位清單）", () => {
    // 此測試檔以 vi.mock 全面替換 ../../db，無法行為驗證 db 層的 insert；
    // 改用 repo 慣例的源碼靜態抽取（仿 RefundDetailLink.test.tsx）釘住
    // duplicateVideoProject 的 values 物件確實複製 inputAssets——被移除即紅。
    const dbSrc = readFileSync(resolve(__dirname, "../../db.ts"), "utf8");
    const fnStart = dbSrc.indexOf("export async function duplicateVideoProject");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = dbSrc.slice(fnStart, dbSrc.indexOf("return result[0].insertId", fnStart));
    expect(fnBody).toContain("inputAssets: source.inputAssets ?? undefined");
  });

  it("restoreSnapshot → pre-restore 快照含 inputAssets（回溯後素材不遺失）", async () => {
    const inputAssets = [
      { type: "image", url: "https://cdn.x/style.png", role: "style_reference" },
    ];
    (db.getVideoProject as any).mockResolvedValue({ ...baseProject, inputAssets });
    (db.getProjectSnapshot as any).mockResolvedValue({ id: 3, projectId: 55, snapshot: {} });
    (db.createProjectSnapshot as any).mockResolvedValue(undefined);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.restoreSnapshot({ projectId: 55, snapshotId: 3 });

    expect(db.createProjectSnapshot).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ inputAssets }),
      "pre-restore"
    );
  });

  it("list items 帶正規化 inputAssets（null → []、有值原樣）", async () => {
    const inputAssets = [
      { type: "audio", url: "https://cdn.x/bgm.mp3", role: "background_music" },
    ];
    (db.getVideoProjectsByUserPaged as any).mockResolvedValue({
      items: [baseProject, { ...baseProject, id: 56, inputAssets }],
      nextCursor: null,
    });

    const caller = videoProjectRouter.createCaller(ctx);
    const res = await caller.list();
    expect(res.items[0].inputAssets).toEqual([]);
    expect(res.items[1].inputAssets).toEqual(inputAssets);
  });
});

describe("AIDV-241 樂觀鎖 — videoProject.update optimistic lock", () => {
  beforeEach(() => vi.clearAllMocks());

  it("無 expectedVersion → 無版本檢查，直接成功", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.update({ id: 55, title: "新標題" });
    expect(result.ok).toBe(true);
    expect(db.updateVideoProject).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ title: "新標題" }),
      { expectedVersion: undefined }
    );
  });

  it("expectedVersion 正確 → 更新成功", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.update({ id: 55, aspectRatio: "9:16", expectedVersion: 2 });
    expect(result.ok).toBe(true);
    expect(db.updateVideoProject).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ aspectRatio: "9:16" }),
      { expectedVersion: 2 }
    );
  });

  it("expectedVersion 過期（version 不符）→ CONFLICT 409", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: false });

    const caller = videoProjectRouter.createCaller(ctx);
    await expect(
      caller.update({ id: 55, title: "衝突更新", expectedVersion: 0 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("專案不存在 → NOT_FOUND", async () => {
    (db.getVideoProject as any).mockResolvedValue(null);

    const caller = videoProjectRouter.createCaller(ctx);
    await expect(
      caller.update({ id: 999, title: "X" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("非本人 → FORBIDDEN", async () => {
    (db.getVideoProject as any).mockResolvedValue({ ...baseProject, userId: 99 });

    const caller = videoProjectRouter.createCaller(ctx);
    await expect(
      caller.update({ id: 55, title: "X" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("AIDV-307 videoProject.list — 游標分頁", () => {
  beforeEach(() => vi.clearAllMocks());

  it("無輸入 → 預設 limit=20、cursor=null、search=null，限本人 userId", async () => {
    (db.getVideoProjectsByUserPaged as any).mockResolvedValue({ items: [], nextCursor: null });

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.list();
    expect(db.getVideoProjectsByUserPaged).toHaveBeenCalledWith({
      userId: 7,
      limit: 20,
      cursor: null,
      search: null,
    });
  });

  it("傳入 cursor/limit/search → 原樣下傳 DB 層（AIDV-576 cursor 為 opaque 字串）", async () => {
    (db.getVideoProjectsByUserPaged as any).mockResolvedValue({ items: [], nextCursor: null });

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.list({ cursor: "1700000000000_100", limit: 5, search: "品牌" });
    expect(db.getVideoProjectsByUserPaged).toHaveBeenCalledWith({
      userId: 7,
      limit: 5,
      cursor: "1700000000000_100",
      search: "品牌",
    });
  });

  it("回傳 nextCursor（複合游標字串）供前端載入下一頁", async () => {
    (db.getVideoProjectsByUserPaged as any).mockResolvedValue({
      items: [baseProject, { ...baseProject, id: 40 }],
      nextCursor: "1700000000000_40",
    });

    const caller = videoProjectRouter.createCaller(ctx);
    const res = await caller.list({ limit: 2 });
    expect(res.items).toHaveLength(2);
    expect(res.nextCursor).toBe("1700000000000_40");
  });

  it("limit 超過 50 → Zod 驗證失敗（BAD_REQUEST）", async () => {
    const caller = videoProjectRouter.createCaller(ctx);
    await expect(caller.list({ limit: 999 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.getVideoProjectsByUserPaged).not.toHaveBeenCalled();
  });

  it("cursor 空字串 → Zod 驗證失敗（BAD_REQUEST）", async () => {
    const caller = videoProjectRouter.createCaller(ctx);
    await expect(caller.list({ cursor: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.getVideoProjectsByUserPaged).not.toHaveBeenCalled();
  });
});

// ─── AIDV-337 稽核軌跡接線測試 ───────────────────────────────────────────────
describe("AIDV-337 videoProject — 代理操作稽核軌跡", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create → recordAuditEvent 以 videoProject.create 動作呼叫", async () => {
    (db.createVideoProject as any).mockResolvedValue(55);
    (db.getVideoProject as any).mockResolvedValue(baseProject);

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.create({ title: "稽核測試" });

    expect(auditLog.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "videoProject.create",
        targetType: "videoProject",
        targetId: 55,
        actorUserId: 7,
      })
    );
  });

  it("create 帶 X-Agent-Id header → agentId 寫入 metadata", async () => {
    (db.createVideoProject as any).mockResolvedValue(55);
    (db.getVideoProject as any).mockResolvedValue(baseProject);

    const agentCtx = {
      ...ctx,
      req: { headers: { "x-agent-id": "script-agent-01" }, ip: "127.0.0.1" },
    };
    const caller = videoProjectRouter.createCaller(agentCtx);
    await caller.create({ title: "代理建立" });

    expect(auditLog.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          agentId: "script-agent-01",
          traceId: "req-test-001",
        }),
      })
    );
  });

  it("update 成功 → recordAuditEvent 以 videoProject.update 動作呼叫", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.update({ id: 55, title: "更新稽核測試" });

    expect(auditLog.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "videoProject.update",
        targetType: "videoProject",
        targetId: 55,
      })
    );
  });

  it("update 版本衝突（CONFLICT）→ recordAuditEvent 不呼叫", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: false });

    const caller = videoProjectRouter.createCaller(ctx);
    await expect(caller.update({ id: 55, title: "衝突", expectedVersion: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(auditLog.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("duplicate → recordAuditEvent 以 videoProject.duplicate 動作呼叫", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.duplicateVideoProject as any).mockResolvedValue(99);

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.duplicate({ sourceId: 55 });

    expect(auditLog.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "videoProject.duplicate",
        targetType: "videoProject",
        targetId: 99,
        metadata: expect.objectContaining({ sourceId: 55 }),
      })
    );
  });

  it("save 成功 → recordAuditEvent 以 videoProject.save 動作呼叫", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.save({ id: 55, title: "存檔" });

    expect(auditLog.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "videoProject.save",
        targetType: "videoProject",
        targetId: 55,
      })
    );
  });

  it("save 帶 agentId → snapshot source 含 agent 前綴", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });
    (db.createProjectSnapshot as any).mockResolvedValue(undefined);

    const agentCtx = {
      ...ctx,
      req: { headers: { "x-agent-id": "voice-agent-02" }, ip: "127.0.0.1" },
    };
    const caller = videoProjectRouter.createCaller(agentCtx);
    await caller.save({ id: 55, snapshotData: { foo: "bar" } });

    expect(db.createProjectSnapshot).toHaveBeenCalledWith(
      55,
      { foo: "bar" },
      "agent:voice-agent-02"
    );
  });

  it("restoreSnapshot → recordAuditEvent 以 videoProject.restore 動作呼叫", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.getProjectSnapshot as any).mockResolvedValue({ id: 3, projectId: 55, snapshot: {} });
    (db.createProjectSnapshot as any).mockResolvedValue(undefined);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    await caller.restoreSnapshot({ projectId: 55, snapshotId: 3 });

    expect(auditLog.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "videoProject.restore",
        targetType: "videoProject",
        targetId: 55,
        metadata: expect.objectContaining({ snapshotId: 3 }),
      })
    );
  });
});

describe("AIDV-255 outputSpecEntitlement — 4K 付費判定", () => {
  beforeEach(() => vi.clearAllMocks());

  it("付費方案（premium/active）→ isPaid=true", async () => {
    (db.getUserSubscription as any).mockResolvedValue({ planId: "premium", status: "active" });
    const caller = videoProjectRouter.createCaller(ctx);
    const res = await caller.outputSpecEntitlement();
    expect(res.isPaid).toBe(true);
    expect(res.planId).toBe("premium");
  });

  it("免費方案 → isPaid=false", async () => {
    (db.getUserSubscription as any).mockResolvedValue({ planId: "free", status: "active" });
    const caller = videoProjectRouter.createCaller(ctx);
    const res = await caller.outputSpecEntitlement();
    expect(res.isPaid).toBe(false);
  });

  it("查無方案（null）→ fail-closed isPaid=false", async () => {
    (db.getUserSubscription as any).mockResolvedValue(null);
    const caller = videoProjectRouter.createCaller(ctx);
    const res = await caller.outputSpecEntitlement();
    expect(res.isPaid).toBe(false);
    expect(res.planId).toBe("free");
  });

  it("付費方案但已取消（cancelled）→ isPaid=false", async () => {
    (db.getUserSubscription as any).mockResolvedValue({ planId: "premium", status: "cancelled" });
    const caller = videoProjectRouter.createCaller(ctx);
    const res = await caller.outputSpecEntitlement();
    expect(res.isPaid).toBe(false);
  });
});
