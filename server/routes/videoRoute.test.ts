// @vitest-environment node
/**
 * videoRoute.test.ts — REST /api/video endpoint unit tests (AIDV-735/AIDV-736)
 *
 * Acceptance:
 *   ✅ GET /api/video returns paginated list
 *   ✅ GET /api/video with cursor/limit/search params
 *   ✅ GET /api/video returns 401 when unauthenticated
 *   ✅ POST /api/video creates a project and returns 201
 *   ✅ POST /api/video returns 400 on invalid input
 *   ✅ GET /api/video/:id returns 404 for missing project
 *   ✅ GET /api/video/:id returns 403 for wrong owner
 *   ✅ GET /api/video/:id returns project for correct owner
 *   ✅ PUT /api/video/:id updates and returns new version
 *   ✅ PUT /api/video/:id returns 409 on version conflict
 *   ✅ DELETE /api/video/:id returns 501
 *   ✅ POST /api/video/:id/process returns 501
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../middleware/verifyToken", () => ({
  verifyToken: (_req: any, _res: any, next: any) => next(),
}));

const mockGetVideoProjectsByUserPaged = vi.fn();
const mockGetVideoProject = vi.fn();
const mockCreateVideoProject = vi.fn();
const mockUpdateVideoProject = vi.fn();
const mockRecordAuditEvent = vi.fn();

vi.mock("../db", () => ({
  getVideoProjectsByUserPaged: (...a: any[]) => mockGetVideoProjectsByUserPaged(...a),
  getVideoProject: (...a: any[]) => mockGetVideoProject(...a),
  createVideoProject: (...a: any[]) => mockCreateVideoProject(...a),
  updateVideoProject: (...a: any[]) => mockUpdateVideoProject(...a),
}));

vi.mock("../services/audit/auditLog", () => ({
  recordAuditEvent: (...a: any[]) => mockRecordAuditEvent(...a),
}));

vi.mock("../../drizzle/schema", () => ({
  VIDEO_OUTPUT_SPEC_DEFAULT: { resolution: "1080p", fps: 30, codec: "h264" },
}));

vi.mock("../utils/sanitize", () => ({
  sanitizePlainText: (s: string) => s,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 42,
    title: "測試影片",
    aspectRatio: "16:9",
    outputSpec: { resolution: "1080p", fps: 30, codec: "h264" },
    version: 1,
    deadlineAt: null,
    priorityClass: "standard",
    outputStoragePath: null,
    outputSignedUrl: null,
    outputExpiresAt: null,
    createdAt: new Date("2026-06-29T00:00:00Z"),
    updatedAt: new Date("2026-06-29T00:00:00Z"),
    ...overrides,
  };
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
  };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
  return res;
}

function mockReq(userId: number | undefined, opts: {
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  headers?: Record<string, string>;
} = {}) {
  return {
    user: userId != null ? { id: userId, role: "user" } : undefined,
    query: opts.query ?? {},
    body: opts.body ?? {},
    params: opts.params ?? {},
    headers: opts.headers ?? {},
    ip: "127.0.0.1",
  };
}

async function getRouteHandlers() {
  const { videoRouter } = await import("./videoRoute");
  const router = videoRouter as any;
  function handler(method: string, path: string): (...args: any[]) => Promise<void> {
    const layer = router.stack?.find(
      (l: any) => l.route?.path === path && l.route?.methods?.[method]
    );
    const stack: any[] = layer?.route?.stack ?? [];
    // skip verifyToken (first middleware), take last real handler
    const fn = stack[stack.length - 1]?.handle;
    if (!fn) throw new Error(`Handler not found: ${method.toUpperCase()} ${path}`);
    return fn;
  }
  return {
    listHandler: handler("get", "/api/video"),
    createHandler: handler("post", "/api/video"),
    getHandler: handler("get", "/api/video/:id"),
    updateHandler: handler("put", "/api/video/:id"),
    deleteHandler: handler("delete", "/api/video/:id"),
    processHandler: handler("post", "/api/video/:id/process"),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/video", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVideoProjectsByUserPaged.mockResolvedValue({
      items: [makeProject()],
      nextCursor: null,
    });
  });

  it("returns paginated list for authenticated user", async () => {
    const { listHandler } = await getRouteHandlers();
    const req = mockReq(42);
    const res = mockRes();
    await listHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).items).toHaveLength(1);
    expect((res.body as any).nextCursor).toBeNull();
    expect(mockGetVideoProjectsByUserPaged).toHaveBeenCalledWith({
      userId: 42,
      limit: 20,
      cursor: undefined,
      search: undefined,
    });
  });

  it("passes cursor and limit from query", async () => {
    const { listHandler } = await getRouteHandlers();
    const req = mockReq(42, { query: { cursor: "5", limit: "10", search: "test" } });
    const res = mockRes();
    await listHandler(req, res);
    expect(mockGetVideoProjectsByUserPaged).toHaveBeenCalledWith({
      userId: 42,
      limit: 10,
      cursor: 5,
      search: "test",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    const { listHandler } = await getRouteHandlers();
    const req = mockReq(undefined);
    const res = mockRes();
    await listHandler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid limit", async () => {
    const { listHandler } = await getRouteHandlers();
    const req = mockReq(42, { query: { limit: "999" } });
    const res = mockRes();
    await listHandler(req, res);
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/video", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateVideoProject.mockResolvedValue(99);
    mockGetVideoProject.mockResolvedValue(makeProject({ id: 99, userId: 42 }));
  });

  it("creates a project and returns 201", async () => {
    const { createHandler } = await getRouteHandlers();
    const req = mockReq(42, {
      body: { title: "新影片", aspectRatio: "9:16", priorityClass: "express" },
    });
    const res = mockRes();
    await createHandler(req, res);
    expect(res.statusCode).toBe(201);
    expect((res.body as any).id).toBe(99);
    expect(mockRecordAuditEvent).toHaveBeenCalledOnce();
  });

  it("returns 400 for empty title", async () => {
    const { createHandler } = await getRouteHandlers();
    const req = mockReq(42, { body: { title: "" } });
    const res = mockRes();
    await createHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    const { createHandler } = await getRouteHandlers();
    const req = mockReq(undefined, { body: { title: "test" } });
    const res = mockRes();
    await createHandler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/video/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns project for correct owner", async () => {
    mockGetVideoProject.mockResolvedValue(makeProject({ id: 1, userId: 42 }));
    const { getHandler } = await getRouteHandlers();
    const req = mockReq(42, { params: { id: "1" } });
    const res = mockRes();
    await getHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).id).toBe(1);
  });

  it("returns 404 when project does not exist", async () => {
    mockGetVideoProject.mockResolvedValue(null);
    const { getHandler } = await getRouteHandlers();
    const req = mockReq(42, { params: { id: "999" } });
    const res = mockRes();
    await getHandler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when project belongs to different user", async () => {
    mockGetVideoProject.mockResolvedValue(makeProject({ id: 1, userId: 99 }));
    const { getHandler } = await getRouteHandlers();
    const req = mockReq(42, { params: { id: "1" } });
    const res = mockRes();
    await getHandler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for non-numeric ID", async () => {
    const { getHandler } = await getRouteHandlers();
    const req = mockReq(42, { params: { id: "abc" } });
    const res = mockRes();
    await getHandler(req, res);
    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /api/video/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates project and returns new version", async () => {
    mockGetVideoProject.mockResolvedValue(makeProject({ id: 1, userId: 42, version: 3 }));
    mockUpdateVideoProject.mockResolvedValue({ updated: true });
    const { updateHandler } = await getRouteHandlers();
    const req = mockReq(42, {
      params: { id: "1" },
      body: { title: "新標題", expectedVersion: 3 },
    });
    const res = mockRes();
    await updateHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).ok).toBe(true);
    expect((res.body as any).version).toBe(4);
    expect(res.headers["ETag"]).toBe('"4"');
  });

  it("returns 409 on version conflict", async () => {
    mockGetVideoProject.mockResolvedValue(makeProject({ id: 1, userId: 42, version: 3 }));
    mockUpdateVideoProject.mockResolvedValue({ updated: false });
    const { updateHandler } = await getRouteHandlers();
    const req = mockReq(42, {
      params: { id: "1" },
      body: { title: "X", expectedVersion: 2 },
    });
    const res = mockRes();
    await updateHandler(req, res);
    expect(res.statusCode).toBe(409);
    expect((res.body as any).code).toBe("CONFLICT");
  });

  it("returns 404 when project not found", async () => {
    mockGetVideoProject.mockResolvedValue(null);
    const { updateHandler } = await getRouteHandlers();
    const req = mockReq(42, { params: { id: "1" }, body: {} });
    const res = mockRes();
    await updateHandler(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/video/:id", () => {
  it("returns 501 Not Implemented", async () => {
    const { deleteHandler } = await getRouteHandlers();
    const req = mockReq(42, { params: { id: "1" } });
    const res = mockRes();
    await deleteHandler(req, res);
    expect(res.statusCode).toBe(501);
    expect((res.body as any).code).toBe("NOT_IMPLEMENTED");
  });
});

describe("POST /api/video/:id/process", () => {
  it("returns 501 Not Implemented", async () => {
    const { processHandler } = await getRouteHandlers();
    const req = mockReq(42, { params: { id: "1" } });
    const res = mockRes();
    await processHandler(req, res);
    expect(res.statusCode).toBe(501);
    expect((res.body as any).code).toBe("NOT_IMPLEMENTED");
  });
});
